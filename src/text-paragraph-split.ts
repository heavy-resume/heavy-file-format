import type { VisualBlock } from './editor/types';
import type { VisualDocument } from './types';
import { resolveBaseComponentFromMeta } from './component-defs';
import { createEmptyBlock } from './document-factory';
import { findSectionByKey } from './section-ops';
import { getRichEditorSerializableHtml, normalizeEditorMarkdownWhitespace, normalizeMarkdownLists, turndown } from './markdown';
import { getParagraphSplitMarginTop } from './document-typography';
import { updateStyleSpacingCss } from './text-line-styles';

export function splitTextParagraphsOnCommit(
  document: VisualDocument,
  sectionKey: string,
  blockId: string,
  editable: HTMLElement
): VisualBlock[] | null {
  const section = findSectionByKey(document.sections, sectionKey);
  if (!section) return null;
  const location = findSplittableBlockLocation(section.blocks, blockId);
  const block = location?.container[location.index];
  if (!location || !block || resolveBaseComponentFromMeta(block.schema.component, document.meta) !== 'text') {
    return null;
  }

  const topLevel = Array.from(editable.childNodes).filter(
    (node) => node.nodeType !== Node.TEXT_NODE || (node.textContent ?? '').trim().length > 0
  );
  if (topLevel.length < 2 || topLevel.some((node) => !(node instanceof HTMLParagraphElement))) {
    return null;
  }
  if (topLevel.some((node) => (node as HTMLParagraphElement).querySelector('.hvy-inline-checkbox'))) {
    return null;
  }

  const paragraphEntries = topLevel.map((node) => ({
    node: node as HTMLParagraphElement,
    markdown: serializeParagraph(node as HTMLParagraphElement),
  }));
  const paragraphGroups: Array<{ markdown: string; gapBefore: number }> = [];
  let pendingEmptyParagraphs = 0;
  for (const entry of paragraphEntries) {
    if (isEmptyParagraph(entry.node) || entry.markdown.trim().length === 0) {
      if (paragraphGroups.length > 0) pendingEmptyParagraphs += 1;
      continue;
    }
    if (paragraphGroups.length === 0 || pendingEmptyParagraphs > 0) {
      paragraphGroups.push({
        markdown: entry.markdown,
        gapBefore: paragraphGroups.length === 0 ? 0 : pendingEmptyParagraphs + 1,
      });
    } else {
      const current = paragraphGroups.at(-1)!;
      current.markdown = `${current.markdown}\n\n${entry.markdown}`;
    }
    pendingEmptyParagraphs = 0;
  }
  if (paragraphGroups.length < 2) return null;

  const splitBlocks = paragraphGroups.map((group, index) => {
    if (index === 0) {
      block.text = group.markdown;
      return block;
    }
    const next = createEmptyBlock(block.schema.component, false, document.meta);
    copySplitPresentation(block, next);
    next.text = group.markdown;
    next.schema.css = updateStyleSpacingCss(
      next.schema.css,
      'margin-top',
      getParagraphSplitMarginTop(block.schema.css, document.meta, group.gapBefore)
    );
    return next;
  });

  location.container.splice(location.index, 1, ...splitBlocks);
  if (location.directSectionBlock) {
    const lastId = splitBlocks.at(-1)?.id;
    if (lastId) {
      section.children.forEach((child) => {
        if (child.renderAfterBlockId === blockId) child.renderAfterBlockId = lastId;
      });
    }
  }
  return splitBlocks;
}

function serializeParagraph(paragraph: HTMLParagraphElement): string {
  const shell = paragraph.ownerDocument.createElement('div');
  shell.appendChild(paragraph.cloneNode(true));
  return normalizeMarkdownLists(normalizeEditorMarkdownWhitespace(
    turndown.turndown(getRichEditorSerializableHtml(shell))
  ));
}

function isEmptyParagraph(paragraph: HTMLParagraphElement): boolean {
  const clone = paragraph.cloneNode(true) as HTMLParagraphElement;
  clone.querySelectorAll('br').forEach((lineBreak) => lineBreak.remove());
  return (clone.textContent ?? '').replace(/[\u200b\u00a0]/g, '').trim().length === 0
    && clone.children.length === 0;
}

function copySplitPresentation(source: VisualBlock, target: VisualBlock): void {
  target.schema.editorOnly = source.schema.editorOnly;
  target.schema.lock = source.schema.lock;
  target.schema.align = source.schema.align;
  target.schema.slot = source.schema.slot;
  target.schema.css = source.schema.css;
  target.schema.showCopy = source.schema.showCopy;
}

function findSplittableBlockLocation(
  blocks: VisualBlock[],
  blockId: string,
  directSectionBlock = true,
  seen = new Set<VisualBlock>()
): { container: VisualBlock[]; index: number; directSectionBlock: boolean } | null {
  const index = blocks.findIndex((block) => block.id === blockId);
  if (index >= 0) return { container: blocks, index, directSectionBlock };
  for (const block of blocks) {
    if (seen.has(block)) continue;
    seen.add(block);
    for (const children of [
      block.schema.containerBlocks ?? [],
      block.schema.componentListBlocks ?? [],
      block.schema.expandableStubBlocks?.children ?? [],
      block.schema.expandableContentBlocks?.children ?? [],
    ]) {
      const nested = findSplittableBlockLocation(children, blockId, false, seen);
      if (nested) return nested;
    }
  }
  return null;
}
