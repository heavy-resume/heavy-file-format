import type { VisualBlock } from './editor/types';
import type { VisualDocument } from './types';
import { flattenSections, visitBlocks } from './section-ops';
import { sanitizeOptionalId } from './utils';

export interface AutoBlockIdContext {
  document: VisualDocument;
  inheritedTags?: string;
  sourceValues?: Record<string, string>;
}

export function assignAutoBlockId(block: VisualBlock, context: AutoBlockIdContext): void {
  if (block.schema.id.trim().length > 0) {
    return;
  }
  const tags = parseTags(joinTags(context.inheritedTags ?? '', block.schema.tags));
  if (tags.length === 0) {
    return;
  }
  const sourceSlug = getSourceSlug(block, context.sourceValues);
  if (!sourceSlug) {
    return;
  }
  const prefix = sanitizeOptionalId(tags[0] ?? '');
  if (!prefix) {
    return;
  }
  if (!block.schema.tags.trim() && context.inheritedTags?.trim()) {
    block.schema.tags = context.inheritedTags.trim();
  }
  block.schema.id = makeUniqueId(`${prefix}-${sourceSlug}`, context.document, block);
}

function getSourceSlug(block: VisualBlock, sourceValues: Record<string, string> | undefined): string {
  const value = Object.values(sourceValues ?? {}).find((item) => item.trim().length > 0);
  return sanitizeOptionalId(value ?? getFirstVisibleText(block));
}

function getFirstVisibleText(block: VisualBlock): string {
  const text = cleanText(block.text);
  if (text) {
    return text;
  }
  for (const row of block.schema.tableRows ?? []) {
    const cell = row.cells.map(cleanText).find(Boolean);
    if (cell) {
      return cell;
    }
  }
  return [
    ...(block.schema.expandableStubBlocks?.children ?? []),
    ...(block.schema.expandableContentBlocks?.children ?? []),
    ...(block.schema.containerBlocks ?? []),
    ...(block.schema.componentListBlocks ?? []),
    ...(block.schema.gridItems ?? []).map((item) => item.block),
  ].map(getFirstVisibleText).find(Boolean) ?? '';
}

function cleanText(value: string): string {
  return value
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\^section-heading\^/g, ' ')
    .replace(/^#{1,6}\s*/gm, ' ')
    .replace(/[\\`*_~#[\]()!>-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function makeUniqueId(baseId: string, document: VisualDocument, currentBlock: VisualBlock): string {
  const used = new Set<string>();
  flattenSections(document.sections).forEach((section) => {
    used.add(section.key);
    if (section.customId.trim()) {
      used.add(section.customId.trim());
    }
  });
  visitBlocks(document.sections, (block) => {
    if (block !== currentBlock && block.schema.id.trim()) {
      used.add(block.schema.id.trim());
    }
  });
  if (!used.has(baseId)) {
    return baseId;
  }
  let index = 2;
  while (used.has(`${baseId}-${index}`)) {
    index += 1;
  }
  return `${baseId}-${index}`;
}

function parseTags(value: string): string[] {
  const seen = new Set<string>();
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => {
      const normalized = tag.toLowerCase();
      if (!normalized || seen.has(normalized)) {
        return false;
      }
      seen.add(normalized);
      return true;
    });
}

function joinTags(...values: string[]): string {
  return values.filter((value) => value.trim().length > 0).join(', ');
}
