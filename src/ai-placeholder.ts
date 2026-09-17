import type { VisualBlock } from './editor/types';

export function isAiEditablePlaceholderTextBlock(block: VisualBlock | null | undefined): boolean {
  if (!block || block.schema.component !== 'text') {
    return false;
  }
  // Saved content can match its placeholder; only empty content is unfinished.
  return block.schema.placeholder.trim().length > 0 && block.text.trim().length === 0;
}
