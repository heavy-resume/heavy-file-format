import { stringify as stringifyYaml } from 'yaml';
import type { BlockSchema, GridItem, TableRow, VisualBlock, VisualSection } from './editor/types';
import type { HvySection, JsonObject } from './hvy/types';
import { parseHvy } from './hvy/parser';
import type { DocumentAttachment, VisualDocument } from './types';
import { makeId, sanitizeOptionalId } from './utils';
import { getSectionId } from './section-ops';
import { resolveBaseComponent, isBuiltinComponentName } from './component-defs';
import {
  defaultBlockSchema,
  schemaFromUnknown,
  createEmptyBlock,
} from './document-factory';

export interface HvyDiagnostic {
  severity: 'warning' | 'error';
  code: string;
  message: string;
}

export interface DeserializeDocumentResult {
  document: VisualDocument;
  diagnostics: HvyDiagnostic[];
}

export const HVY_TAIL_SENTINEL = '--HVY-TAIL--';

export function deserializeDocument(text: string, extension: VisualDocument['extension']): VisualDocument {
  return deserializeDocumentWithDiagnostics(text, extension).document;
}

export function deserializeDocumentBytes(bytes: Uint8Array, extension: VisualDocument['extension']): VisualDocument {
  return deserializeDocumentBytesWithDiagnostics(bytes, extension).document;
}

export function deserializeDocumentWithDiagnostics(
  text: string,
  extension: VisualDocument['extension']
): DeserializeDocumentResult {
  const extractedTail = splitSerializedTailText(text);
  const parsed = parseHvy(extractedTail.text, extension);
  const meta = { ...parsed.meta };
  if (typeof meta.hvy_version === 'undefined') {
    meta.hvy_version = 0.1;
  }

  const diagnostics = parsed.errors.map((message) => mapParserErrorToDiagnostic(message));
  const document: VisualDocument = {
    extension,
    meta,
    sections: parsed.sections.map((section) => mapParsedSection(section, meta, diagnostics)),
    attachments: extractedTail.attachments,
  };

  validateDocumentSemantics(document, diagnostics);

  return {
    document,
    diagnostics,
  };
}

export function deserializeDocumentBytesWithDiagnostics(
  bytes: Uint8Array,
  extension: VisualDocument['extension']
): DeserializeDocumentResult {
  const extractedTail = splitSerializedTailBytes(bytes);
  const result = deserializeDocumentWithDiagnostics(extractedTail.text, extension);
  result.document.attachments = extractedTail.attachments;
  return result;
}

export function wrapHvyFragmentAsDocument(
  source: string,
  options?: { sectionId?: string; title?: string; meta?: JsonObject }
): string {
  const sectionId = options?.sectionId?.trim() || 'rsp';
  const title = options?.title?.trim() || 'Response';
  const meta: JsonObject = {
    hvy_version: 0.1,
    ...(options?.meta ?? {}),
  };
  const frontMatter = stringifyYaml(meta).trimEnd();
  return `---
${frontMatter}
---

<!--hvy: {"id":"${escapeHvyJsonString(sectionId)}"}-->
#! ${title}

${source.trim()}
`;
}

export function getHvyResponseDiagnostics(source: string): HvyDiagnostic[] {
  return deserializeDocumentWithDiagnostics(wrapHvyFragmentAsDocument(source), '.hvy').diagnostics;
}

export function getHvyDiagnosticUsageHint(diagnostic: HvyDiagnostic): string {
  switch (diagnostic.code) {
    case 'invalid_front_matter':
      return 'Use valid YAML between `---` lines, or omit front matter.';
    case 'invalid_doc_directive_json':
      return 'Document directives must be JSON objects like `<!--hvy:doc {}-->`.';
    case 'invalid_css_directive_json':
      return 'CSS directives must be JSON objects like `<!--hvy:css {}-->`.';
    case 'invalid_subsection_directive_json':
      return 'Subsection directives must be JSON objects like `<!--hvy:subsection {"id":"child"}-->`.';
    case 'invalid_section_directive_json':
      return 'Section directives must be JSON objects like `<!--hvy: {"id":"section-id"}-->`.';
    case 'unclosed_css_fence':
      return 'Close CSS blocks with the same fence, for example ```css ... ```.';
    case 'invalid_block_directive_json':
      return 'Component directives must use JSON objects like `<!--hvy:text {}-->`.';
    case 'invalid_slot_index':
      return 'Indexed slots use numeric indexes like `<!--hvy:component-list:0 {}-->`.';
    case 'expandable_slot_without_parent':
      return 'Put expandable slots under `<!--hvy:expandable {}-->`, then add `stub` or `content`.';
    case 'grid_slot_without_parent':
      return 'Put grid slots under `<!--hvy:grid {"gridColumns":2}-->`, then add `<!--hvy:grid:0 {}-->`.';
    case 'component_list_slot_without_parent':
      return 'Put list slots under `<!--hvy:component-list {"componentListComponent":"text"}-->`.';
    case 'container_slot_without_parent':
      return 'Put container slots under `<!--hvy:container {}-->`, then add `<!--hvy:container:0 {}-->`.';
    case 'table_detail_slots_not_supported':
      return 'Tables are non-interactive in HVY. Wrap the table in `<!--hvy:expandable {}-->` for reveal/hide behavior.';
    case 'expandable_missing_stub':
      return 'An expandable needs a stub slot like `<!--hvy:expandable:stub {}-->`.';
    case 'expandable_missing_content':
      return 'An expandable needs a content slot like `<!--hvy:expandable:content {}-->`.';
    case 'xref_card_missing_title':
      return 'An xref-card needs `xrefTitle`, for example `<!--hvy:xref-card {"xrefTitle":"Label"}-->`.';
    case 'xref_card_missing_target':
      return 'Add `xrefTarget`, for example `<!--hvy:xref-card {"xrefTarget":"section-id"}-->`.';
    default:
      return 'Return valid HVY with proper section and component directives.';
  }
}

function mapParsedSection(section: HvySection, documentMeta: JsonObject, diagnostics: HvyDiagnostic[]): VisualSection {
  const sectionMeta = section.meta as JsonObject;
  const customId = sanitizeOptionalId(typeof sectionMeta.id === 'string' ? sectionMeta.id : section.id);
  const blocks = parseBlocks(section.contentMarkdown, sectionMeta, documentMeta, diagnostics, section.title || section.id || 'Untitled Section');

  return {
    key: makeId('section'),
    customId,
    contained: sectionMeta.contained !== false,
    lock: sectionMeta.lock === true,
    idEditorOpen: false,
    isGhost: false,
    title: section.title || 'Untitled Section',
    level: section.level,
    expanded: sectionMeta.expanded === false ? false : true,
    highlight: sectionMeta.highlight === true,
    customCss: typeof sectionMeta.custom_css === 'string' ? sectionMeta.custom_css : '',
    tags: typeof sectionMeta.tags === 'string' ? sectionMeta.tags : '',
    description: typeof sectionMeta.description === 'string' ? sectionMeta.description : '',
    location: sectionMeta.location === 'sidebar' ? 'sidebar' : 'main',
    blocks,
    children: section.children.map((child) => mapParsedSection(child, documentMeta, diagnostics)),
  };
}

function parseBlocks(
  contentMarkdown: string,
  sectionMeta: JsonObject,
  documentMeta: JsonObject,
  diagnostics: HvyDiagnostic[],
  sectionLabel: string
): VisualBlock[] {
  const schemas = Array.isArray(sectionMeta.blocks) ? (sectionMeta.blocks as JsonObject[]) : [];
  const lines = contentMarkdown.split(/\r?\n/);
  const directivePattern = /^<!--hvy:([a-z][a-z0-9-]*(?::[a-z0-9-]+)*)\s*(\{.*\})\s*-->$/i;

  type BlockAttach =
    | { kind: 'top' }
    | { kind: 'expandable'; parent: VisualBlock; part: 0 | 1 }
    | { kind: 'grid'; parent: VisualBlock; meta: JsonObject }
    | { kind: 'component-list'; parent: VisualBlock; slotIndex?: number }
    | { kind: 'container'; parent: VisualBlock };
  type StructuredFrame =
    | { kind: 'component'; block: VisualBlock; attach: BlockAttach; indent: number }
    | { kind: 'slot-expandable'; parent: VisualBlock; part: 0 | 1; indent: number }
    | { kind: 'slot-grid'; parent: VisualBlock; meta: JsonObject; indent: number }
    | { kind: 'slot-component-list'; parent: VisualBlock; slotIndex: number; indent: number }
    | { kind: 'slot-container'; parent: VisualBlock; indent: number };

  const blocks: VisualBlock[] = [];
  const frames: StructuredFrame[] = [];
  const componentListOrder = new WeakMap<VisualBlock, Array<{ block: VisualBlock; slotIndex: number | null; sequence: number }>>();
  let currentText: string[] = [];
  let currentSchema: BlockSchema = defaultBlockSchema();
  let currentAttach: BlockAttach = { kind: 'top' };
  let currentHasDirective = false;
  let currentIndent = 0;
  let currentTextIndent = 0;
  let sequenceCounter = 0;

  const resolveParsedBase = (componentName: string): string => {
    if (isBuiltinComponentName(componentName)) {
      return componentName;
    }
    const defs = Array.isArray(documentMeta.component_defs) ? (documentMeta.component_defs as JsonObject[]) : [];
    const def = defs.find((item) => item && typeof item.name === 'string' && item.name === componentName);
    return typeof def?.baseType === 'string' ? def.baseType : 'text';
  };

  const flush = (): void => {
    if (!currentHasDirective && currentText.length === 0) {
      return;
    }
    const normalizedText = normalizeParsedBlockText(currentText, currentTextIndent);
    if (!currentHasDirective && normalizedText.trim().length === 0) {
      currentText = [];
      return;
    }
    // When plain text appears inside an open container frame (no explicit directive
    // set the attach), implicitly route it into that container rather than top level.
    let effectiveAttach = currentAttach;
    if (!currentHasDirective && effectiveAttach.kind === 'top') {
      effectiveAttach = getCurrentAttach();
    }
    const block: VisualBlock = {
      id: makeId('block'),
      text: normalizedText,
      schema: currentSchema,
      schemaMode: false,
    };
    attachBlock(block, effectiveAttach);
    currentText = [];
    currentSchema = defaultBlockSchema();
    currentAttach = { kind: 'top' };
    currentHasDirective = false;
    currentTextIndent = 0;
  };

  const closeFrame = (): void => {
    flush();
    const frame = frames.pop();
    if (frame?.kind === 'component') {
      attachBlock(frame.block, frame.attach);
    }
  };

  const closeFramesUntil = (parentBase: string | null): VisualBlock | undefined => {
    flush();
    if (parentBase === null) {
      while (frames.length > 0) {
        closeFrame();
      }
      return undefined;
    }
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      if (frame.kind === 'component' && resolveParsedBase(frame.block.schema.component) === parentBase) {
        break;
      }
      closeFrame();
    }
    const frame = frames[frames.length - 1];
    return frame?.kind === 'component' ? frame.block : undefined;
  };

  const closeFramesAtOrAboveIndent = (indent: number): void => {
    flush();
    while (frames.length > 0 && shouldCloseFrameForIndent(frames[frames.length - 1], indent)) {
      closeFrame();
    }
  };

  const getCurrentAttach = (): BlockAttach => {
    const frame = frames[frames.length - 1];
    if (!frame) {
      return { kind: 'top' };
    }
    if (frame.kind === 'slot-expandable') {
      return { kind: 'expandable', parent: frame.parent, part: frame.part };
    }
    if (frame.kind === 'slot-grid') {
      return { kind: 'grid', parent: frame.parent, meta: frame.meta };
    }
    if (frame.kind === 'slot-component-list') {
      return { kind: 'component-list', parent: frame.parent, slotIndex: frame.slotIndex };
    }
    if (frame.kind === 'slot-container') {
      return { kind: 'container', parent: frame.parent };
    }
    const base = resolveParsedBase(frame.block.schema.component);
    if (base === 'component-list') {
      return { kind: 'component-list', parent: frame.block };
    }
    if (base === 'container') {
      return { kind: 'container', parent: frame.block };
    }
    return { kind: 'top' };
  };

  const findOrCreateParentFrame = (
    parentBase: 'expandable' | 'grid' | 'component-list' | 'container',
    lineNumber: number,
    code: HvyDiagnostic['code'],
    message: string
  ): VisualBlock => {
    const parent = closeFramesUntil(parentBase);
    if (parent) {
      return parent;
    }
    diagnostics.push({
      severity: 'warning',
      code,
      message: formatSectionDiagnostic(sectionLabel, lineNumber, message),
    });
    const fallback = createEmptyBlock(parentBase, true);
    frames.push({
      kind: 'component',
      block: fallback,
      attach: { kind: 'top' },
      indent: Math.max(0, currentIndent - 1),
    });
    return fallback;
  };

  const attachBlock = (block: VisualBlock, attach: BlockAttach): void => {
    if (attach.kind === 'expandable') {
      if (attach.part === 0) {
        attach.parent.schema.expandableStubBlocks.children.push(block);
      } else {
        attach.parent.schema.expandableContentBlocks.children.push(block);
      }
      return;
    }
    if (attach.kind === 'grid') {
      attach.parent.schema.gridItems.push({
        id: typeof attach.meta.id === 'string' ? attach.meta.id : makeId('griditem'),
        block,
      });
      return;
    }
    if (attach.kind === 'component-list') {
      const items = componentListOrder.get(attach.parent) ?? [];
      items.push({
        block,
        slotIndex: typeof attach.slotIndex === 'number' ? attach.slotIndex : null,
        sequence: sequenceCounter++,
      });
      items.sort((left, right) => {
        if (left.slotIndex === null && right.slotIndex === null) {
          return left.sequence - right.sequence;
        }
        if (left.slotIndex === null) {
          return -1;
        }
        if (right.slotIndex === null) {
          return 1;
        }
        if (left.slotIndex !== right.slotIndex) {
          return left.slotIndex - right.slotIndex;
        }
        return left.sequence - right.sequence;
      });
      componentListOrder.set(attach.parent, items);
      attach.parent.schema.componentListBlocks = items.map((item) => item.block);
      return;
    }
    if (attach.kind === 'container') {
      attach.parent.schema.containerBlocks.push(block);
      return;
    }
    blocks.push(block);
  };

  const openOrQueueBlock = (schema: BlockSchema, attach: BlockAttach): void => {
    const base = resolveParsedBase(schema.component);
    if (base === 'expandable') {
      schema.expandableStubBlocks = { lock: false, children: [] };
      schema.expandableContentBlocks = { lock: false, children: [] };
    } else if (base === 'grid') {
      schema.gridItems = [];
    } else if (base === 'component-list') {
      schema.componentListBlocks = [];
    } else if (base === 'container') {
      schema.containerBlocks = [];
    } else {
      currentSchema = schema;
      currentAttach = attach;
      currentHasDirective = true;
      currentTextIndent = currentIndent + 1;
      return;
    }

    frames.push({
      kind: 'component',
      block: {
        id: makeId('block'),
        text: '',
        schema,
        schemaMode: false,
      },
      attach,
      indent: currentIndent,
    });
  };

  lines.forEach((line, lineIndex) => {
    const match = line.trim().match(directivePattern);
    if (!match) {
      currentText.push(line);
      return;
    }

    currentIndent = (line.match(/^( *)/) ?? ['', ''])[1].length;
    closeFramesAtOrAboveIndent(currentIndent);

    const directive = (match[1] ?? 'block').toLowerCase();
    const [name, ...rawParts] = directive.split(':');
    const indexes = rawParts.map((part) => Number.parseInt(part, 10));
    const allIndexesValid = indexes.every((index) => Number.isFinite(index));

    try {
      const parsed = JSON.parse(match[2] ?? '{}') as JsonObject;

      if (name === 'expandable' && rawParts.length === 1 && (rawParts[0] === 'stub' || rawParts[0] === 'content')) {
        const parent = findOrCreateParentFrame(
          'expandable',
          lineIndex + 1,
          'expandable_slot_without_parent',
          'Expandable stub/content was provided without an enclosing expandable block.'
        );
        const part: 0 | 1 = rawParts[0] === 'stub' ? 0 : 1;
        const keys = Object.keys(parsed);
        const slotMetadataOnly = keys.every((key) => key === 'lock' || key === 'css' || key === 'customCss' || key === 'custom_css');
        if (!slotMetadataOnly) {
          return;
        }
        if (parsed.lock === true) {
          if (part === 0) {
            parent.schema.expandableStubBlocks.lock = true;
          } else {
            parent.schema.expandableContentBlocks.lock = true;
          }
        }
        const slotCss =
          typeof parsed.css === 'string'
            ? parsed.css
            : typeof parsed.customCss === 'string'
            ? parsed.customCss
            : typeof parsed.custom_css === 'string'
            ? parsed.custom_css
            : '';
        if (part === 0) {
          parent.schema.expandableStubCss = slotCss;
        } else {
          parent.schema.expandableContentCss = slotCss;
        }
        frames.push({
          kind: 'slot-expandable',
          parent,
          part,
          indent: currentIndent,
        });
        return;
      }

      if (rawParts.length > 0 && !allIndexesValid) {
        diagnostics.push({
          severity: 'error',
          code: 'invalid_slot_index',
          message: formatSectionDiagnostic(sectionLabel, lineIndex + 1, `Directive "${directive}" uses a non-numeric slot index.`),
        });
        return;
      }

      if (name === 'grid' && indexes.length === 1) {
        if (typeof parsed.component === 'string' || typeof parsed.type === 'string') {
          return;
        }
        const parent = findOrCreateParentFrame(
          'grid',
          lineIndex + 1,
          'grid_slot_without_parent',
          'Grid slot was provided without an enclosing grid block.'
        );
        frames.push({
          kind: 'slot-grid',
          parent,
          meta: parsed,
          indent: currentIndent,
        });
      } else if (name === 'component-list' && indexes.length === 1) {
        if (typeof parsed.component === 'string' || typeof parsed.type === 'string') {
          return;
        }
        const parent = findOrCreateParentFrame(
          'component-list',
          lineIndex + 1,
          'component_list_slot_without_parent',
          'Component-list slot was provided without an enclosing component-list block.'
        );
        frames.push({
          kind: 'slot-component-list',
          parent,
          slotIndex: indexes[0],
          indent: currentIndent,
        });
      } else if (name === 'container' && indexes.length === 1) {
        if (typeof parsed.component === 'string' || typeof parsed.type === 'string') {
          return;
        }
        const parent = findOrCreateParentFrame(
          'container',
          lineIndex + 1,
          'container_slot_without_parent',
          'Container slot was provided without an enclosing container block.'
        );
        frames.push({
          kind: 'slot-container',
          parent,
          indent: currentIndent,
        });
      } else if (name === 'table' && indexes.length === 2) {
        diagnostics.push({
          severity: 'error',
          code: 'table_detail_slots_not_supported',
          message: formatSectionDiagnostic(
            sectionLabel,
            lineIndex + 1,
            'Table detail slots are not supported. Wrap the table in an expandable for reveal/hide behavior.'
          ),
        });
      } else {
        if (directive === 'block') {
          openOrQueueBlock(schemaFromUnknown(parsed), getCurrentAttach());
        } else {
          openOrQueueBlock(schemaFromUnknown({ ...parsed, component: directive }), getCurrentAttach());
        }
      }
    } catch {
      diagnostics.push({
        severity: 'error',
        code: 'invalid_block_directive_json',
        message: formatSectionDiagnostic(sectionLabel, lineIndex + 1, `Directive "${directive}" has invalid JSON.`),
      });
      currentSchema = defaultBlockSchema();
      currentAttach = { kind: 'top' };
      currentHasDirective = false;
    }
  });

  flush();
  while (frames.length > 0) {
    closeFrame();
  }

  if (blocks.length === 0) {
    return [];
  }

  return blocks.map((block, index) => ({
    ...block,
    schema: schemaFromUnknown(schemas[index] ?? block.schema),
  }));
}

function mapParserErrorToDiagnostic(message: string): HvyDiagnostic {
  const lineMatch = message.match(/^Line (\d+):\s*(.*)$/);
  const linePrefix = lineMatch ? `Line ${lineMatch[1]}: ` : '';
  const detail = lineMatch ? lineMatch[2] : message;

  if (detail === 'invalid hvy:doc directive JSON.') {
    return { severity: 'error', code: 'invalid_doc_directive_json', message: `${linePrefix}Document directive has invalid JSON.` };
  }
  if (detail === 'invalid hvy:css directive JSON.') {
    return { severity: 'error', code: 'invalid_css_directive_json', message: `${linePrefix}CSS directive has invalid JSON.` };
  }
  if (detail === 'invalid hvy:subsection directive JSON.') {
    return { severity: 'error', code: 'invalid_subsection_directive_json', message: `${linePrefix}Subsection directive has invalid JSON.` };
  }
  if (detail === 'invalid section hvy directive JSON.') {
    return { severity: 'error', code: 'invalid_section_directive_json', message: `${linePrefix}Section directive has invalid JSON.` };
  }
  if (detail === 'unclosed CSS fence.') {
    return { severity: 'error', code: 'unclosed_css_fence', message: `${linePrefix}CSS fence is not closed.` };
  }
  if (message === 'Invalid YAML front matter.') {
    return { severity: 'error', code: 'invalid_front_matter', message };
  }
  return { severity: 'warning', code: 'parse_warning', message };
}

function formatSectionDiagnostic(sectionLabel: string, lineNumber: number, detail: string): string {
  return `Section "${sectionLabel}", line ${lineNumber}: ${detail}`;
}

function escapeHvyJsonString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function validateDocumentSemantics(document: VisualDocument, diagnostics: HvyDiagnostic[]): void {
  for (const section of document.sections) {
    validateSectionSemantics(section, diagnostics);
  }
}

function validateSectionSemantics(section: VisualSection, diagnostics: HvyDiagnostic[]): void {
  for (const block of section.blocks) {
    validateBlockSemantics(block, section.title || section.customId || 'Untitled Section', diagnostics);
  }
  for (const child of section.children) {
    validateSectionSemantics(child, diagnostics);
  }
}

function validateBlockSemantics(block: VisualBlock, sectionLabel: string, diagnostics: HvyDiagnostic[]): void {
  const baseComponent = resolveBaseComponent(block.schema.component);

  if (baseComponent === 'expandable') {
    if ((block.schema.expandableStubBlocks.children ?? []).length === 0) {
      diagnostics.push({
        severity: 'error',
        code: 'expandable_missing_stub',
        message: `Section "${sectionLabel}": expandable block is missing stub content.`,
      });
    }
    if ((block.schema.expandableContentBlocks.children ?? []).length === 0) {
      diagnostics.push({
        severity: 'error',
        code: 'expandable_missing_content',
        message: `Section "${sectionLabel}": expandable block is missing expanded content.`,
      });
    }
  }

  if (baseComponent === 'xref-card') {
    if (block.schema.xrefTitle.trim().length === 0) {
      diagnostics.push({
        severity: 'error',
        code: 'xref_card_missing_title',
        message: `Section "${sectionLabel}": xref-card is missing xrefTitle.`,
      });
    }
    if (block.schema.xrefTarget.trim().length === 0) {
      diagnostics.push({
        severity: 'warning',
        code: 'xref_card_missing_target',
        message: `Section "${sectionLabel}": xref-card is missing xrefTarget and will be disabled.`,
      });
    }
  }

  for (const child of block.schema.containerBlocks ?? []) {
    validateBlockSemantics(child, sectionLabel, diagnostics);
  }
  for (const child of block.schema.componentListBlocks ?? []) {
    validateBlockSemantics(child, sectionLabel, diagnostics);
  }
  for (const child of block.schema.expandableStubBlocks?.children ?? []) {
    validateBlockSemantics(child, sectionLabel, diagnostics);
  }
  for (const child of block.schema.expandableContentBlocks?.children ?? []) {
    validateBlockSemantics(child, sectionLabel, diagnostics);
  }
  for (const item of block.schema.gridItems ?? []) {
    validateBlockSemantics(item.block, sectionLabel, diagnostics);
  }
}

function normalizeParsedBlockText(lines: string[], indent: number): string {
  if (lines.length === 0) {
    return '';
  }

  const prefix = ' '.repeat(indent);
  const stripped = lines.map((line) => (indent > 0 && line.startsWith(prefix) ? line.slice(indent) : line));
  let start = 0;
  let end = stripped.length;

  while (start < end && stripped[start]?.trim().length === 0) {
    start += 1;
  }
  while (end > start && stripped[end - 1]?.trim().length === 0) {
    end -= 1;
  }

  return stripCommonIndent(stripped.slice(start, end)).join('\n');
}

function stripCommonIndent(lines: string[]): string[] {
  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => (line.match(/^ */) ?? [''])[0].length);
  const minIndent = indents.length > 0 ? Math.min(...indents) : 0;

  if (minIndent === 0) {
    return lines;
  }

  const prefix = ' '.repeat(minIndent);
  return lines.map((line) => (line.startsWith(prefix) ? line.slice(minIndent) : line));
}

function shouldCloseFrameForIndent(
  frame:
    | { kind: 'component'; indent: number }
    | { kind: 'slot-expandable'; indent: number }
    | { kind: 'slot-grid'; indent: number }
    | { kind: 'slot-component-list'; indent: number }
    | { kind: 'slot-container'; indent: number }
    | { kind: 'slot-table-details'; indent: number },
  indent: number
): boolean {
  if (frame.kind === 'component') {
    return frame.indent >= indent;
  }
  return frame.indent > indent;
}

const BLOCK_ARRAY_KEYS = ['containerBlocks', 'componentListBlocks'];
const EXPANDABLE_PART_KEYS = ['expandableStubBlocks', 'expandableContentBlocks'];

// Serialize a component def to clean YAML format:
// - strips `component` from schema (redundant with `baseType`)
// - strips `template` (runtime-only)
// - uses { component: name } shorthand for custom component blocks in nested lists
function serializeComponentDef(raw: JsonObject): JsonObject {
  const result: JsonObject = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'template') continue; // runtime-only; derived from schema
    if (key === 'schema') {
      if (value && typeof value === 'object') {
        result.schema = cleanComponentDefSchema(value as JsonObject);
      }
    } else {
      result[key] = value;
    }
  }
  return result;
}

function cleanComponentDefSchema(schema: JsonObject): JsonObject {
  const result: JsonObject = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'component') continue; // redundant with baseType
    if (key === 'schemaMode') continue; // editor state
    if (key === 'id' && (value === '' || value === null || value === undefined)) continue;
    if (BLOCK_ARRAY_KEYS.includes(key) && Array.isArray(value)) {
      result[key] = value.map((block) => cleanComponentDefBlock(block as JsonObject));
    } else if (EXPANDABLE_PART_KEYS.includes(key) && value && typeof value === 'object' && !Array.isArray(value)) {
      const part = value as { lock?: boolean; children?: JsonObject[] };
      result[key] = {
        lock: part.lock ?? false,
        children: Array.isArray(part.children) ? part.children.map((block) => cleanComponentDefBlock(block)) : [],
      };
    } else if (key === 'gridItems' && Array.isArray(value)) {
      result[key] = value.map((item) => {
        const obj = item as JsonObject;
        return obj.block ? { ...obj, block: cleanComponentDefBlock(obj.block as JsonObject) } : obj;
      });
    } else {
      result[key] = value;
    }
  }
  return result;
}

function cleanComponentDefBlock(block: JsonObject): JsonObject {
  // Determine component from either the shorthand { component } or { schema: { component } } format
  const component = (() => {
    if (block.schema && typeof block.schema === 'object') {
      const s = block.schema as JsonObject;
      if (typeof s.component === 'string') return s.component;
    }
    if (typeof block.component === 'string') return block.component;
    return undefined;
  })();

  if (component && !isBuiltinComponentName(component)) {
    // Custom component: use shorthand — the template defines everything else
    return { component };
  }

  // Builtin component: keep text + recursively clean schema
  const result: JsonObject = {};
  if (typeof block.text === 'string') result.text = block.text;
  if (block.schema && typeof block.schema === 'object') {
    result.schema = cleanComponentDefSchema(block.schema as JsonObject);
  }
  return result;
}

export function serializeDocument(document: VisualDocument): string {
  const frontMatter = `---\n${serializeDocumentHeaderYaml(document)}\n---\n`;
  const body = document.sections
    .filter((section) => !section.isGhost)
    .map((section) => serializeSection(section, 1))
    .join('\n')
    .trim();
  const textBody = `${frontMatter}\n${body}\n`;
  return appendSerializedTailPreamble(textBody, document.attachments);
}

export function serializeDocumentBytes(document: VisualDocument): Uint8Array {
  const encoder = new TextEncoder();
  const textBytes = encoder.encode(serializeDocument(document));
  const tailBytes = concatAttachmentBytes(document.attachments);
  if (tailBytes.length === 0) {
    return textBytes;
  }

  const combined = new Uint8Array(textBytes.length + tailBytes.length);
  combined.set(textBytes, 0);
  combined.set(tailBytes, textBytes.length);
  return combined;
}

function concatAttachmentBytes(attachments: DocumentAttachment[]): Uint8Array {
  const total = attachments.reduce((sum, entry) => sum + entry.bytes.length, 0);
  if (total === 0) {
    return new Uint8Array();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const entry of attachments) {
    combined.set(entry.bytes, offset);
    offset += entry.bytes.length;
  }
  return combined;
}

export function serializeDocumentHeaderYaml(document: VisualDocument): string {
  const rawMeta = stripEditorStateFromSerializedValue(document.meta) as JsonObject;
  const serializedMeta: JsonObject = { ...rawMeta };
  if (Array.isArray(serializedMeta.component_defs)) {
    serializedMeta.component_defs = (serializedMeta.component_defs as unknown[])
      .filter((def): def is JsonObject => !!def && typeof def === 'object')
      .map((def) => serializeComponentDef(def));
  }
  const headerMeta = {
    ...serializedMeta,
    hvy_version: document.meta.hvy_version ?? 0.1,
  };
  return stringifyYaml(headerMeta).trim();
}

export function serializeBlockFragment(block: VisualBlock): string {
  return serializeBlock(block, 0).trim();
}

function stripEditorStateFromSerializedValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripEditorStateFromSerializedValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const cleaned: JsonObject = {};
  Object.entries(value as JsonObject).forEach(([key, item]) => {
    if (key === 'schemaMode') {
      return;
    }
    cleaned[key] = stripEditorStateFromSerializedValue(item) as JsonObject[keyof JsonObject];
  });
  return cleaned;
}

function appendSerializedTailPreamble(text: string, attachments: DocumentAttachment[]): string {
  if (attachments.length === 0) {
    return text;
  }

  const trimmed = text.endsWith('\n') ? text.slice(0, -1) : text;
  const directives = attachments
    .map((attachment) => {
      const meta: JsonObject = { id: attachment.id, ...attachment.meta, length: attachment.bytes.length };
      return `<!--hvy:tail ${JSON.stringify(meta)}-->`;
    })
    .join('\n');
  return `${trimmed}\n${directives}\n${HVY_TAIL_SENTINEL}\n`;
}

function parseTailDirectives(directiveBlock: string): DocumentAttachment[] | null {
  const lines = directiveBlock.split('\n').filter((line) => line.length > 0);
  if (lines.length === 0) {
    return null;
  }
  const attachments: DocumentAttachment[] = [];
  for (const line of lines) {
    const match = line.match(/^<!--hvy:tail\s+(\{.*\})\s*-->$/);
    if (!match) {
      return null;
    }
    try {
      const parsed = JSON.parse(match[1] ?? '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
      }
      const obj = parsed as JsonObject;
      const id = typeof obj.id === 'string' ? obj.id : '';
      const meta: JsonObject = { ...obj };
      delete meta.id;
      delete meta.length;
      attachments.push({
        id,
        meta,
        bytes: new Uint8Array(),
      });
    } catch {
      return null;
    }
  }
  return attachments;
}

function splitSerializedTailText(text: string): { text: string; attachments: DocumentAttachment[] } {
  const normalized = text.replace(/\r\n/g, '\n');
  const sentinelTail = `\n${HVY_TAIL_SENTINEL}\n`;
  const sentinelTailNoNewline = `\n${HVY_TAIL_SENTINEL}`;
  let sentinelIndex = -1;
  let sentinelLength = 0;
  if (normalized.endsWith(sentinelTail)) {
    sentinelIndex = normalized.length - sentinelTail.length;
    sentinelLength = sentinelTail.length;
  } else if (normalized.endsWith(sentinelTailNoNewline)) {
    sentinelIndex = normalized.length - sentinelTailNoNewline.length;
    sentinelLength = sentinelTailNoNewline.length;
  } else {
    return { text, attachments: [] };
  }

  // Find start of consecutive hvy:tail directive block.
  let directiveStart = sentinelIndex;
  while (directiveStart > 0) {
    const prevNewline = normalized.lastIndexOf('\n', directiveStart - 1);
    const lineStart = prevNewline + 1;
    const lineEnd = directiveStart;
    const candidate = normalized.slice(lineStart, lineEnd);
    if (/^<!--hvy:tail\s+\{.*\}\s*-->$/.test(candidate)) {
      directiveStart = prevNewline;
    } else {
      break;
    }
  }

  if (directiveStart === sentinelIndex) {
    return { text, attachments: [] };
  }

  const directiveBlock = normalized.slice(directiveStart + 1, sentinelIndex);
  const attachments = parseTailDirectives(directiveBlock);
  if (!attachments) {
    return { text, attachments: [] };
  }

  const remainingText = normalized.slice(0, directiveStart);
  // Account for sentinel length consumed (text-only path: no bytes).
  void sentinelLength;
  return {
    text: remainingText,
    attachments,
  };
}

function splitSerializedTailBytes(bytes: Uint8Array): { text: string; attachments: DocumentAttachment[] } {
  const decoder = new TextDecoder();
  const decoded = decoder.decode(bytes);
  const normalized = decoded.replace(/\r\n/g, '\n');
  const sentinelNeedle = `\n${HVY_TAIL_SENTINEL}\n`;
  const sentinelIndex = normalized.lastIndexOf(sentinelNeedle);
  if (sentinelIndex < 0) {
    return { text: decoded, attachments: [] };
  }

  // Find consecutive hvy:tail directive block immediately preceding the sentinel.
  let directiveStart = sentinelIndex;
  while (directiveStart > 0) {
    const prevNewline = normalized.lastIndexOf('\n', directiveStart - 1);
    const lineStart = prevNewline + 1;
    const lineEnd = directiveStart;
    const candidate = normalized.slice(lineStart, lineEnd);
    if (/^<!--hvy:tail\s+\{.*\}\s*-->$/.test(candidate)) {
      directiveStart = prevNewline;
    } else {
      break;
    }
  }

  if (directiveStart === sentinelIndex) {
    return { text: decoded, attachments: [] };
  }

  const directiveBlock = normalized.slice(directiveStart + 1, sentinelIndex);
  const parsedAttachments = parseTailDirectives(directiveBlock);
  if (!parsedAttachments) {
    return { text: decoded, attachments: [] };
  }

  // Read length from each directive line for byte splitting.
  const lengths: number[] = [];
  const directiveLines = directiveBlock.split('\n').filter((line) => line.length > 0);
  for (const line of directiveLines) {
    const match = line.match(/^<!--hvy:tail\s+(\{.*\})\s*-->$/);
    if (!match) {
      return { text: decoded, attachments: [] };
    }
    try {
      const parsed = JSON.parse(match[1] ?? '{}') as JsonObject;
      const length = typeof parsed.length === 'number' ? parsed.length : -1;
      lengths.push(length);
    } catch {
      return { text: decoded, attachments: [] };
    }
  }

  const encoder = new TextEncoder();
  const tailStart = encoder.encode(normalized.slice(0, sentinelIndex + sentinelNeedle.length)).length;
  const tailBytes = bytes.slice(tailStart);

  let offset = 0;
  for (let i = 0; i < parsedAttachments.length; i += 1) {
    const declared = lengths[i] ?? -1;
    const length = declared >= 0
      ? declared
      : i === parsedAttachments.length - 1
        ? tailBytes.length - offset
        : 0;
    parsedAttachments[i].bytes = tailBytes.slice(offset, offset + length);
    offset += length;
  }

  return {
    text: normalized.slice(0, directiveStart),
    attachments: parsedAttachments,
  };
}

function serializeSection(section: VisualSection, level: number): string {
  const heading = `#! ${section.title}`;
  const meta: JsonObject = {
    id: getSectionId(section),
    lock: section.lock,
    expanded: section.expanded,
    highlight: section.highlight,
  };
  if (!section.contained) {
    meta.contained = false;
  }
  if (section.customCss.trim().length > 0) {
    meta.custom_css = section.customCss;
  }
  if (section.tags.trim().length > 0) {
    meta.tags = section.tags;
  }
  if (section.description.trim().length > 0) {
    meta.description = section.description;
  }
  if (section.location === 'sidebar') {
    meta.location = 'sidebar';
  }

  const directive = `<!--hvy: ${JSON.stringify(meta)}-->`;

  const blockText = section.blocks
    .map((block) => serializeBlock(block, 1))
    .join('\n\n');

  const children = section.children
    .filter((child) => !child.isGhost)
    .map((child) => serializeSection(child, level + 1))
    .join('\n\n');

  return `${directive}\n${heading}\n\n${blockText}${children ? `\n\n${children}` : ''}`;
}

function serializeBlockSchema(
  schema: BlockSchema,
  options: {
    omitComponent?: boolean;
    omitContainerBlocks?: boolean;
    omitComponentListBlocks?: boolean;
    omitExpandableBlocks?: boolean;
    omitGridItems?: boolean;
  } = {}
): JsonObject {
  const component = resolveBaseComponent(schema.component);
  const defaults = defaultBlockSchema(component);
  const payload: JsonObject = {};

  addIfChanged(payload, 'id', schema.id, defaults.id);
  if (!options.omitComponent) {
    payload.component = schema.component;
  }
  addIfChanged(payload, 'lock', schema.lock, defaults.lock);
  addIfChanged(payload, 'align', schema.align, defaults.align);
  addIfChanged(payload, 'slot', schema.slot, defaults.slot);
  addIfChanged(payload, 'css', schema.customCss, defaults.customCss);
  addIfChanged(payload, 'tags', schema.tags, defaults.tags);
  addIfChanged(payload, 'description', schema.description, defaults.description);
  addIfChanged(payload, 'placeholder', schema.placeholder, defaults.placeholder);

  if (component === 'xref-card') {
    addIfChanged(payload, 'xrefTitle', schema.xrefTitle, defaults.xrefTitle);
    addIfChanged(payload, 'xrefDetail', schema.xrefDetail, defaults.xrefDetail);
    addIfChanged(payload, 'xrefTarget', schema.xrefTarget, defaults.xrefTarget);
  }
  if (component === 'code') {
    addIfChanged(payload, 'codeLanguage', schema.codeLanguage, defaults.codeLanguage);
  }
  if (component === 'container') {
    if (!options.omitContainerBlocks) {
      addBlockArrayIfPresent(payload, 'containerBlocks', schema.containerBlocks);
    }
  }
  if (component === 'component-list') {
    addIfChanged(payload, 'componentListComponent', schema.componentListComponent, defaults.componentListComponent);
    if (!options.omitComponentListBlocks) {
      addBlockArrayIfPresent(payload, 'componentListBlocks', schema.componentListBlocks);
    }
  }
  if (component === 'grid') {
    addIfChanged(payload, 'gridColumns', schema.gridColumns, defaults.gridColumns);
    if (!options.omitGridItems && schema.gridItems.length > 0) {
      payload.gridItems = schema.gridItems.map((item) => ({
        id: item.id,
        block: serializeVisualBlock(item.block),
      }));
    }
  }
  if (component === 'plugin') {
    addIfChanged(payload, 'plugin', schema.plugin, defaults.plugin);
    if (Object.keys(schema.pluginConfig).length > 0) {
      payload.pluginConfig = stripEditorStateFromSerializedValue(schema.pluginConfig) as JsonObject;
    }
  }
  if (component === 'expandable') {
    addIfChanged(payload, 'expandableAlwaysShowStub', schema.expandableAlwaysShowStub, defaults.expandableAlwaysShowStub);
    addIfChanged(payload, 'expandableExpanded', schema.expandableExpanded, defaults.expandableExpanded);
    // Stub/content blocks are serialized as nested block directives, not inline in schema JSON.
  }
  if (component === 'table') {
    addIfChanged(payload, 'tableColumns', schema.tableColumns, defaults.tableColumns);
    addIfChanged(payload, 'tableShowHeader', schema.tableShowHeader, defaults.tableShowHeader);
    if (schema.tableRows.length > 0) {
      payload.tableRows = schema.tableRows.map((row) => serializeTableRow(row));
    }
  }
  if (component === 'image') {
    addIfChanged(payload, 'imageFile', schema.imageFile, defaults.imageFile);
    addIfChanged(payload, 'imageAlt', schema.imageAlt, defaults.imageAlt);
  }

  return payload;
}

function serializeBlock(
  block: VisualBlock,
  indent: number,
  override?: { name: string; schema?: JsonObject }
): string {
  const blockDirective = override ?? serializeBlockDirective(block.schema);
  const schemaDirective = `${' '.repeat(indent)}<!--hvy:${blockDirective.name} ${JSON.stringify(blockDirective.schema)}-->`;
  const nested = serializeNestedBlocks(block, indent + 1);
  const text = indentMultiline(block.text.trim(), indent + 1);
  return [schemaDirective, text, nested].filter((part) => part.length > 0).join('\n');
}

function serializeBlockDirective(schema: BlockSchema): { name: string; schema: JsonObject } {
  const component = schema.component.trim();
  if (/^[a-z][a-z0-9-]*$/i.test(component) && !['block', 'doc', 'css', 'subsection'].includes(component)) {
    return {
      name: component,
      schema: serializeBlockSchema(schema, { omitComponent: true, ...nestedBlockOmitOptions(schema) }),
    };
  }
  return {
    name: 'block',
    schema: serializeBlockSchema(schema, nestedBlockOmitOptions(schema)),
  };
}

function indentMultiline(text: string, indent: number): string {
  if (text.length === 0) {
    return '';
  }
  const prefix = ' '.repeat(indent);
  return text
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

function serializeSlotDirective(name: string, schema: JsonObject, indent: number): string {
  return `${' '.repeat(indent)}<!--hvy:${name} ${JSON.stringify(schema)}-->`;
}

function serializeSlotWithChild(name: string, schema: JsonObject, child: VisualBlock, indent: number): string {
  return [serializeSlotDirective(name, schema, indent), serializeBlock(child, indent + 1)].join('\n\n');
}

function buildExpandablePartPayload(expandableBlock: VisualBlock, part: 0 | 1, lock: boolean): JsonObject {
  const payload: JsonObject = {};
  const css = part === 0 ? expandableBlock.schema.expandableStubCss : expandableBlock.schema.expandableContentCss;
  if (lock) {
    payload.lock = true;
  }
  if (css.trim().length > 0) {
    payload.css = css;
  }
  return payload;
}

function serializeExpandablePart(
  expandableBlock: VisualBlock,
  children: VisualBlock[],
  part: 0 | 1,
  lock: boolean,
  indent: number
): string {
  const name = `expandable:${part === 0 ? 'stub' : 'content'}`;
  const payload = buildExpandablePartPayload(expandableBlock, part, lock);
  if (children.length === 0) {
    return Object.keys(payload).length > 0 ? serializeSlotDirective(name, payload, indent) : '';
  }
  return [
    serializeSlotDirective(name, payload, indent),
    children.map((child) => serializeBlock(child, indent + 1)).join('\n\n'),
  ].join('\n\n');
}

function serializeGridItemBlock(item: GridItem, index: number, indent: number): string {
  return serializeSlotWithChild(
    `grid:${index}`,
    {
      id: item.id,
    },
    item.block,
    indent
  );
}

function serializeComponentListItemBlock(block: VisualBlock, index: number, indent: number): string {
  return serializeSlotWithChild(`component-list:${index}`, {}, block, indent);
}

function serializeContainerItemBlock(block: VisualBlock, index: number, indent: number): string {
  return serializeSlotWithChild(`container:${index}`, {}, block, indent);
}

function serializeNestedBlocks(block: VisualBlock, indent: number): string {
  const component = resolveBaseComponent(block.schema.component);
  if (component === 'expandable') {
    const stub = block.schema.expandableStubBlocks;
    const content = block.schema.expandableContentBlocks;
    const stubPart = serializeExpandablePart(block, stub.children, 0, stub.lock, indent);
    const contentPart = serializeExpandablePart(block, content.children, 1, content.lock, indent);
    return [stubPart, contentPart].filter((part) => part.length > 0).join('\n\n');
  }
  if (component === 'grid') {
    return block.schema.gridItems.map((item, index) => serializeGridItemBlock(item, index, indent)).join('\n\n');
  }
  if (component === 'component-list') {
    return block.schema.componentListBlocks
      .map((innerBlock, index) => serializeComponentListItemBlock(innerBlock, index, indent))
      .join('\n\n');
  }
  if (component === 'container') {
    return block.schema.containerBlocks.map((innerBlock, index) => serializeContainerItemBlock(innerBlock, index, indent)).join('\n\n');
  }
  return '';
}

function nestedBlockOmitOptions(schema: BlockSchema): Parameters<typeof serializeBlockSchema>[1] {
  const component = resolveBaseComponent(schema.component);
  return {
    omitContainerBlocks: component === 'container',
    omitComponentListBlocks: component === 'component-list',
    omitExpandableBlocks: component === 'expandable',
    omitGridItems: component === 'grid',
  };
}

function serializeVisualBlock(block: VisualBlock): JsonObject {
  return {
    text: block.text,
    schema: serializeBlockSchema(block.schema),
  };
}

function serializeTableRow(row: TableRow): JsonObject {
  const serialized: JsonObject = { cells: row.cells };
  return serialized;
}

function addBlockArrayIfPresent(payload: JsonObject, key: string, blocks: VisualBlock[]): void {
  if (blocks.length === 0) {
    return;
  }
  payload[key] = blocks.map((block) => serializeVisualBlock(block));
}

function addIfChanged(payload: JsonObject, key: string, value: unknown, defaultValue: unknown): void {
  if (value === defaultValue) {
    return;
  }
  if (typeof value === 'string' && value.length === 0) {
    return;
  }
  payload[key] = value as JsonObject[keyof JsonObject];
}
