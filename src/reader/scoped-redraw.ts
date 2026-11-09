import type { VisualBlock, VisualSection } from '../editor/types';
import { ensureDocumentAttachmentStore } from '../attachment-store';
import { getDatabaseChangeRevision } from '../database-change-tracker';
import { FORM_PLUGIN_ID } from '../plugins/registry';
import type { VisualDocument } from '../types';

/**
 * Decides whether a script edit can update the reader without rebuilding the page. A partial redraw can
 * leave content stale, so this only allows edits known to affect nothing but themselves, compared against
 * what the page last showed so that changes from any source are seen. Everything else needs a full redraw.
 * tests/scoped-redraw-staleness.spec.ts checks the results against a full redraw.
 */

interface RenderedBlock {
  sectionKey: string;
  blockId: string;
  component: string;
  plugin: string;
  editorOnly: boolean;
  text: string;
  pluginConfig: string;
  /** Everything else about the block, with its children reduced to their ids. */
  own: string;
}

interface RenderedDocument {
  header: string;
  sections: string;
  blocks: Map<string, RenderedBlock>;
  hasRepeatedBlocks: boolean;
}

export interface ScopedReaderRedrawOptions {
  document: VisualDocument;
  refreshBlock: (sectionKey: string, blockId: string) => boolean;
  refreshPlugins: () => void;
  afterRefresh: () => void;
  /** Plugins edited the document while refreshing, which is otherwise only found by a whole-document check. */
  onEditedDuringRefresh: () => void;
}

// Text that can affect other blocks or depends on them: annotations, placeholders, answers and template values.
const TEXT_WITH_OUTSIDE_EFFECTS = /<!--|\{%|^\s*\((?: |x|X)?\)\s/m;

const renderedDocuments = new WeakMap<VisualDocument, RenderedDocument>();

function blockIds(blocks: VisualBlock[] | undefined): string[] {
  return (blocks ?? []).map((block) => block.id);
}

function captureOwnBlockState(block: VisualBlock): string {
  const { pluginConfig: _pluginConfig, ...schema } = block.schema;
  return JSON.stringify({
    ...schema,
    containerBlocks: blockIds(schema.containerBlocks),
    componentListBlocks: blockIds(schema.componentListBlocks),
    gridItems: (schema.gridItems ?? []).map((item) => ({ ...item, block: item.block.id })),
    expandableStubBlocks: { ...schema.expandableStubBlocks, children: blockIds(schema.expandableStubBlocks?.children) },
    expandableContentBlocks: { ...schema.expandableContentBlocks, children: blockIds(schema.expandableContentBlocks?.children) },
  });
}

function captureRenderedDocument(document: VisualDocument): RenderedDocument {
  const rendered: RenderedDocument = {
    header: JSON.stringify(document.meta),
    sections: JSON.stringify(document.sections.map((section) => ({ ...section, blocks: blockIds(section.blocks) }))),
    blocks: new Map(),
    hasRepeatedBlocks: false,
  };
  const visit = (section: VisualSection, blocks: VisualBlock[] | undefined): void => {
    for (const block of blocks ?? []) {
      const key = `${section.key}\u0000${block.id}`;
      if (rendered.blocks.has(key)) {
        rendered.hasRepeatedBlocks = true;
      }
      rendered.blocks.set(key, {
        sectionKey: section.key,
        blockId: block.id,
        component: block.schema.component,
        plugin: block.schema.plugin ?? '',
        editorOnly: block.schema.editorOnly === true,
        text: block.text,
        pluginConfig: JSON.stringify(block.schema.pluginConfig ?? null),
        own: captureOwnBlockState(block),
      });
      visit(section, block.schema.containerBlocks);
      visit(section, block.schema.componentListBlocks);
      visit(section, block.schema.expandableStubBlocks?.children);
      visit(section, block.schema.expandableContentBlocks?.children);
      visit(section, (block.schema.gridItems ?? []).map((item) => item.block));
    }
  };
  document.sections.forEach((section) => visit(section, section.blocks));
  return rendered;
}

/** Text blocks to replace, or null when the difference needs a full redraw. Forms re-render themselves. */
function planScopedRedraw(previous: RenderedDocument, next: RenderedDocument): RenderedBlock[] | null {
  if (
    previous.hasRepeatedBlocks
    || next.hasRepeatedBlocks
    || previous.header !== next.header
    || previous.sections !== next.sections
    || previous.blocks.size !== next.blocks.size
  ) {
    return null;
  }
  const textBlocks: RenderedBlock[] = [];
  for (const [key, block] of next.blocks) {
    const before = previous.blocks.get(key);
    if (!before || before.own !== block.own) {
      return null;
    }
    if (before.text === block.text && before.pluginConfig === block.pluginConfig) {
      continue;
    }
    if (block.plugin === FORM_PLUGIN_ID) {
      continue;
    }
    if (
      block.component !== 'text'
      || before.pluginConfig !== block.pluginConfig
      || TEXT_WITH_OUTSIDE_EFFECTS.test(before.text)
      || TEXT_WITH_OUTSIDE_EFFECTS.test(block.text)
    ) {
      return null;
    }
    // Partial redraws only run in the viewer, which never renders editor-only blocks.
    if (!block.editorOnly) {
      textBlocks.push(block);
    }
  }
  return textBlocks;
}

function isSameRenderedDocument(left: RenderedDocument, right: RenderedDocument): boolean {
  if (left.header !== right.header || left.sections !== right.sections || left.blocks.size !== right.blocks.size) {
    return false;
  }
  for (const [key, block] of right.blocks) {
    const other = left.blocks.get(key);
    if (!other || other.text !== block.text || other.pluginConfig !== block.pluginConfig || other.own !== block.own) {
      return false;
    }
  }
  return true;
}

// What a block comparison cannot see: writes to the database and to attachments.
function captureEditCounters(document: VisualDocument): string {
  return `${getDatabaseChangeRevision(document)}:${ensureDocumentAttachmentStore(document).getVersion()}`;
}

/** Records what a full redraw just showed. */
export function rememberRenderedDocument(document: VisualDocument): void {
  renderedDocuments.set(document, captureRenderedDocument(document));
}

/** Returns false when the caller must do a full redraw, which also applies after a partial attempt. */
export function runScopedReaderRedraw(options: ScopedReaderRedrawOptions): boolean {
  const previous = renderedDocuments.get(options.document);
  if (!previous) {
    return false;
  }
  const next = captureRenderedDocument(options.document);
  const textBlocks = planScopedRedraw(previous, next);
  if (!textBlocks || !textBlocks.every((block) => options.refreshBlock(block.sectionKey, block.blockId))) {
    return false;
  }
  renderedDocuments.set(options.document, next);
  const editsBeforeRefresh = captureEditCounters(options.document);
  options.refreshPlugins();
  options.afterRefresh();
  if (
    editsBeforeRefresh !== captureEditCounters(options.document)
    || !isSameRenderedDocument(next, captureRenderedDocument(options.document))
  ) {
    options.onEditedDuringRefresh();
  }
  return true;
}
