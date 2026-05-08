import type { SortKeyValue, VisualBlock } from '../../types';

export interface ComponentListDisplayState {
  sortKey: string;
  direction: 'asc' | 'desc';
  groupKey: string;
  groupCollapsedPreviewRem: number;
}

export interface ComponentListResolvedGroup {
  key: string;
  label: string;
  strongestValue: SortKeyValue;
  blocks: VisualBlock[];
}

export type ComponentListResolvedItems =
  | { kind: 'items'; display: ComponentListDisplayState; blocks: VisualBlock[] }
  | { kind: 'groups'; display: ComponentListDisplayState; groups: ComponentListResolvedGroup[]; missingBlocks: VisualBlock[] };

export interface ComponentListRuntimeViewState {
  sortKey: string;
  sortKeyOverride: boolean;
  reversed: boolean;
  groupKey?: string;
}

const SORT_VIEW_MARKER = '::sort=';
const REVERSED_VIEW_SUFFIX = '::reversed';
const GROUP_VIEW_MARKER = '::group=';

export function encodeComponentListRuntimeView(state: ComponentListRuntimeViewState): string {
  return `${SORT_VIEW_MARKER}${encodeURIComponent(state.sortKey)}${state.reversed ? REVERSED_VIEW_SUFFIX : ''}${
    typeof state.groupKey === 'string' ? `${GROUP_VIEW_MARKER}${encodeURIComponent(state.groupKey)}` : ''
  }`;
}

export function parseComponentListRuntimeView(value = ''): ComponentListRuntimeViewState {
  const groupIndex = value.indexOf(GROUP_VIEW_MARKER);
  const withoutGroup = groupIndex >= 0 ? value.slice(0, groupIndex) : value;
  const groupKey = groupIndex >= 0 ? decodeURIComponent(value.slice(groupIndex + GROUP_VIEW_MARKER.length)) : undefined;
  const withSortMarker = withoutGroup.startsWith(SORT_VIEW_MARKER);
  const withoutSortMarker = withSortMarker ? withoutGroup.slice(SORT_VIEW_MARKER.length) : withoutGroup;
  const reversed = withoutSortMarker.endsWith(REVERSED_VIEW_SUFFIX);
  const sortKeyRaw = reversed ? withoutSortMarker.slice(0, -REVERSED_VIEW_SUFFIX.length) : withoutSortMarker;
  return { sortKey: decodeURIComponent(sortKeyRaw), sortKeyOverride: withSortMarker || sortKeyRaw.length > 0, reversed, groupKey };
}

export function getComponentListDisplayState(block: VisualBlock, runtimeViewId = ''): ComponentListDisplayState {
  const runtime = parseComponentListRuntimeView(runtimeViewId.trim());
  const direction = runtime.reversed ? reverseDirection(block.schema.componentListDefaultSortDirection) : block.schema.componentListDefaultSortDirection;
  return {
    sortKey: runtime.sortKeyOverride ? runtime.sortKey : block.schema.componentListDefaultSortKey.trim(),
    direction,
    groupKey: typeof runtime.groupKey === 'string' ? runtime.groupKey : block.schema.componentListDefaultGroupKey.trim(),
    groupCollapsedPreviewRem: block.schema.componentListGroupCollapsedPreviewRem,
  };
}

export function resolveComponentListItems(block: VisualBlock, runtimeViewId = ''): ComponentListResolvedItems {
  const display = getComponentListDisplayState(block, runtimeViewId);
  const blocks = block.schema.componentListBlocks ?? [];
  const sortedBlocks = display.sortKey ? sortBlocksByKey(blocks, display.sortKey, display.direction) : blocks;
  if (!display.groupKey.trim()) {
    return { kind: 'items', display, blocks: sortedBlocks };
  }
  const groupsByKey = new Map<string, { blocks: VisualBlock[]; strongestValue: SortKeyValue; firstIndex: number }>();
  const missingBlocks: VisualBlock[] = [];
  blocks.forEach((item, index) => {
    const groupValue = item.schema.sortKeys[display.groupKey];
    if (typeof groupValue === 'undefined') {
      missingBlocks.push(item);
      return;
    }
    const groupKey = String(groupValue);
    const sortValue = display.sortKey ? item.schema.sortKeys[display.sortKey] : undefined;
    const existing = groupsByKey.get(groupKey);
    if (!existing) {
      groupsByKey.set(groupKey, {
        blocks: [item],
        strongestValue: typeof sortValue === 'undefined' ? groupValue : sortValue,
        firstIndex: index,
      });
      return;
    }
    existing.blocks.push(item);
    if (isStronger(sortValue, existing.strongestValue, display.direction)) {
      existing.strongestValue = sortValue ?? existing.strongestValue;
    }
  });
  const groups = [...groupsByKey.entries()]
    .map(([key, group]) => ({
      key,
      label: key,
      strongestValue: group.strongestValue,
      blocks: display.sortKey ? sortBlocksByKey(group.blocks, display.sortKey, display.direction) : group.blocks,
      firstIndex: group.firstIndex,
    }))
    .sort((left, right) => {
      if (!display.sortKey) {
        return left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: 'base' }) || left.firstIndex - right.firstIndex;
      }
      const compared = compareSortValues(left.strongestValue, right.strongestValue, display.direction);
      return compared || left.firstIndex - right.firstIndex;
    })
    .map(({ firstIndex: _firstIndex, ...group }) => group);
  return {
    kind: 'groups',
    display,
    groups,
    missingBlocks: display.sortKey ? sortBlocksByKey(missingBlocks, display.sortKey, display.direction) : missingBlocks,
  };
}

function sortBlocksByKey(blocks: VisualBlock[], sortKey: string, direction: 'asc' | 'desc'): VisualBlock[] {
  return blocks
    .map((block, index) => ({ block, index }))
    .sort((left, right) => {
      const leftValue = left.block.schema.sortKeys[sortKey];
      const rightValue = right.block.schema.sortKeys[sortKey];
      const leftMissing = typeof leftValue === 'undefined';
      const rightMissing = typeof rightValue === 'undefined';
      if (leftMissing && rightMissing) {
        return left.index - right.index;
      }
      if (leftMissing) {
        return 1;
      }
      if (rightMissing) {
        return -1;
      }
      return compareSortValues(leftValue, rightValue, direction) || left.index - right.index;
    })
    .map((item) => item.block);
}

function isStronger(candidate: SortKeyValue | undefined, current: SortKeyValue, direction: 'asc' | 'desc'): boolean {
  if (typeof candidate === 'undefined') {
    return false;
  }
  return compareSortValues(candidate, current, direction) < 0;
}

function compareSortValues(left: SortKeyValue, right: SortKeyValue, direction: 'asc' | 'desc'): number {
  const multiplier = direction === 'desc' ? -1 : 1;
  if (typeof left === 'number' && typeof right === 'number') {
    return (left - right) * multiplier;
  }
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' }) * multiplier;
}

function reverseDirection(direction: 'asc' | 'desc'): 'asc' | 'desc' {
  return direction === 'asc' ? 'desc' : 'asc';
}
