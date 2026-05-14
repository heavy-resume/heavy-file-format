import type { VisualBlock } from './editor/types';
import { TEXT_FILL_IN_MARKER } from './text-fill-in';

export function isAiEditablePlaceholderTextBlock(block: VisualBlock | null | undefined): boolean {
  if (!block || block.schema.component !== 'text') {
    return false;
  }
  const placeholder = normalizePlaceholderText(block.schema.placeholder);
  if (!placeholder) {
    return false;
  }
  if (block.text.trim().length === 0) {
    return true;
  }
  const visibleText = normalizePlaceholderText(block.text.replaceAll(TEXT_FILL_IN_MARKER, ''));
  return visibleText.length > 0 && placeholder.includes(visibleText);
}

function normalizePlaceholderText(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line
      .replace(/^\s{0,3}#{1,6}\s*/, '')
      .replace(/^\s{0,3}>\s?/, '')
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
      .replace(/^\s*[-*_]{3,}\s*$/, '')
      .replace(/[\\`*_~#[\]()!>-]/g, '')
      .trim()
    )
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
