import type { VisualBlock } from '../../types';

const TRAILING_ITEM_WORDS = /(?:[-_\s]+(?:record|entry|item|component|card|block|list))+$/i;

export function getComponentListItemLabel(block: VisualBlock): string {
  const customLabel = block.schema.componentListItemLabel.trim();
  if (customLabel.length > 0) {
    return customLabel;
  }
  return humanizeComponentListComponent(block.schema.componentListComponent || 'item');
}

export function getComponentListAddLabel(block: VisualBlock): string {
  return `Add ${toTitleCase(getComponentListItemLabel(block))}`;
}

export function getComponentListEditLabel(block: VisualBlock): string {
  return `Edit ${pluralizeLabel(getComponentListItemLabel(block))}`;
}

export function hasComponentListItems(block: VisualBlock): boolean {
  return block.schema.componentListBlocks.some((child) => child.schema.component === block.schema.componentListComponent);
}

function humanizeComponentListComponent(componentName: string): string {
  const normalized = componentName
    .trim()
    .replace(TRAILING_ITEM_WORDS, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.length > 0 ? normalized : 'item';
}

function pluralizeLabel(label: string): string {
  if (/[\/&]/.test(label)) {
    return label;
  }
  const words = label.split(' ');
  const last = words[words.length - 1] ?? '';
  if (!last || /s$/i.test(last)) {
    return label;
  }
  if (/[^aeiou]y$/i.test(last)) {
    words[words.length - 1] = `${last.slice(0, -1)}ies`;
    return words.join(' ');
  }
  words[words.length - 1] = `${last}s`;
  return words.join(' ');
}

function toTitleCase(label: string): string {
  return label.replace(/\b[a-z]/g, (char) => char.toUpperCase());
}
