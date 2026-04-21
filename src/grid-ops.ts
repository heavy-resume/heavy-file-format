import type { GridItem, VisualBlock } from './editor/types';
import type { JsonObject } from './hvy/types';
import { makeId } from './utils';

export function coerceGridColumns(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.min(6, Math.round(value)));
  }
  if (typeof value === 'string') {
    const parsedInt = Number.parseInt(value, 10);
    if (!Number.isNaN(parsedInt)) {
      return Math.max(1, Math.min(6, parsedInt));
    }
    const tokens = value
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
    if (tokens.length > 0) {
      return Math.max(1, Math.min(6, tokens.length));
    }
  }
  return 2;
}

export function createGridItem(
  _index: number,
  _columns: number,
  createBlock: (component: string, skip: boolean) => VisualBlock
): GridItem {
  return { id: makeId('griditem'), block: createBlock('text', true) };
}

export function parseGridItems(
  candidate: JsonObject,
  columns: number,
  component: string,
  createBlock: (component: string, skip: boolean) => VisualBlock,
  parseBlock: (raw: unknown) => VisualBlock
): GridItem[] {
  const items: GridItem[] = [];
  if (Array.isArray(candidate.gridItems)) {
    (candidate.gridItems as unknown[]).forEach((raw) => {
      if (!raw || typeof raw !== 'object') {
        return;
      }
      const item = raw as JsonObject;
      items.push({
        id: typeof item.id === 'string' ? item.id : makeId('griditem'),
        block: item.block ? parseBlock(item.block) : (() => {
          const block = createBlock(typeof item.component === 'string' ? item.component : 'text', true);
          block.text = typeof item.content === 'string' ? item.content : '';
          return block;
        })(),
      });
    });
    return items;
  }

  if (candidate.gridItems && typeof candidate.gridItems === 'object') {
    const keyedItems = candidate.gridItems as Record<string, unknown>;
    Object.values(keyedItems).forEach((raw) => {
      if (!raw || typeof raw !== 'object') {
        return;
      }
      const item = raw as JsonObject;
      items.push({
        id: makeId('griditem'),
        block: (() => {
          const block = createBlock(typeof item.component === 'string' ? item.component : 'text', true);
          block.text = typeof item.content === 'string' ? item.content : '';
          return block;
        })(),
      });
    });
    if (items.length > 0) {
      return items;
    }
  }

  const legacyKeysRaw = typeof candidate.gridKeys === 'string' ? candidate.gridKeys : '';
  const legacyKeys = legacyKeysRaw
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
  const legacyValues =
    typeof candidate.gridValues === 'object' && candidate.gridValues ? (candidate.gridValues as Record<string, unknown>) : {};
  legacyKeys.forEach((key) => {
    items.push({
      id: makeId('griditem'),
      block: (() => {
        const block = createBlock('text', true);
        block.text = typeof legacyValues[key] === 'string' ? (legacyValues[key] as string) : '';
        return block;
      })(),
    });
  });

  if (items.length === 0 && component === 'grid') {
    return [createGridItem(0, columns, createBlock), createGridItem(1, columns, createBlock)];
  }
  return items;
}
