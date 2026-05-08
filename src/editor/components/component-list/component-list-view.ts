import type { ComponentListView, SortKeyValue, VisualBlock } from '../../types';

export interface ComponentListResolvedGroup {
  key: string;
  label: string;
  strongestValue: SortKeyValue;
  blocks: VisualBlock[];
}

export type ComponentListResolvedItems =
  | { kind: 'items'; view: ComponentListView | null; blocks: VisualBlock[] }
  | { kind: 'groups'; view: ComponentListView; groups: ComponentListResolvedGroup[]; missingBlocks: VisualBlock[] };

export interface ComponentListRuntimeViewState {
  viewId: string;
  reversed: boolean;
}

const REVERSED_VIEW_SUFFIX = '::reversed';

export function encodeComponentListRuntimeView(state: ComponentListRuntimeViewState): string {
  return `${state.viewId}${state.reversed ? REVERSED_VIEW_SUFFIX : ''}`;
}

export function parseComponentListRuntimeView(value = ''): ComponentListRuntimeViewState {
  return value.endsWith(REVERSED_VIEW_SUFFIX)
    ? { viewId: value.slice(0, -REVERSED_VIEW_SUFFIX.length), reversed: true }
    : { viewId: value, reversed: false };
}

export function getComponentListActiveView(block: VisualBlock, runtimeViewId = ''): ComponentListView | null {
  const views = block.schema.componentListViews;
  if (views.length === 0) {
    return null;
  }
  const runtime = parseComponentListRuntimeView(runtimeViewId.trim());
  const selected = runtime.viewId || block.schema.componentListDefaultView.trim();
  const view = views.find((candidate) => candidate.id === selected) ?? views[0] ?? null;
  return view && runtime.reversed ? reverseComponentListView(view) : view;
}

export function resolveComponentListItems(block: VisualBlock, runtimeViewId = ''): ComponentListResolvedItems {
  const view = getComponentListActiveView(block, runtimeViewId);
  const blocks = block.schema.componentListBlocks ?? [];
  if (!view) {
    return { kind: 'items', view, blocks };
  }
  const sortedBlocks = sortBlocksByKey(blocks, view.sortKey, view.direction);
  if (!view.groupKey.trim()) {
    return { kind: 'items', view, blocks: sortedBlocks };
  }
  const groupsByKey = new Map<string, { blocks: VisualBlock[]; strongestValue: SortKeyValue; firstIndex: number }>();
  const missingBlocks: VisualBlock[] = [];
  blocks.forEach((item, index) => {
    const groupValue = item.schema.sortKeys[view.groupKey];
    if (typeof groupValue === 'undefined') {
      missingBlocks.push(item);
      return;
    }
    const groupKey = String(groupValue);
    const sortValue = item.schema.sortKeys[view.sortKey];
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
    if (isStronger(sortValue, existing.strongestValue, view.groupDirection)) {
      existing.strongestValue = sortValue;
    }
  });
  const groups = [...groupsByKey.entries()]
    .map(([key, group]) => ({
      key,
      label: key,
      strongestValue: group.strongestValue,
      blocks: sortBlocksByKey(group.blocks, view.sortKey, view.direction),
      firstIndex: group.firstIndex,
    }))
    .sort((left, right) => {
      const compared = compareSortValues(left.strongestValue, right.strongestValue, view.groupDirection);
      return compared || left.firstIndex - right.firstIndex;
    })
    .map(({ firstIndex: _firstIndex, ...group }) => group);
  return {
    kind: 'groups',
    view,
    groups,
    missingBlocks: sortBlocksByKey(missingBlocks, view.sortKey, view.direction),
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

function reverseComponentListView(view: ComponentListView): ComponentListView {
  const direction = reverseDirection(view.direction);
  return {
    ...view,
    direction,
    groupDirection: reverseDirection(view.groupDirection || view.direction),
  };
}

function reverseDirection(direction: 'asc' | 'desc'): 'asc' | 'desc' {
  return direction === 'asc' ? 'desc' : 'asc';
}
