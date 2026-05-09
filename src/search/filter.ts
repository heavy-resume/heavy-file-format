import type { VisualBlock, VisualSection } from '../editor/types';
import type { SearchState } from './types';

const FILTER_CONTEXT_DEPTH = 1;

export interface SearchFilterContext {
  active: boolean;
  filtering: boolean;
  filterMode: SearchState['filterMode'];
  matchedSections: Set<string>;
  matchedBlocks: Set<string>;
  visibleSections: Set<string>;
  visibleBlocks: Set<string>;
  query: string;
  caseSensitive: boolean;
}

export function createSearchFilterContext(sections: VisualSection[], search: SearchState): SearchFilterContext {
  const matchedSections = new Set<string>();
  const matchedBlocks = new Set<string>();
  const visibleSections = new Set<string>();
  const visibleBlocks = new Set<string>();
  const active = search.submittedQuery.trim().length > 0;
  const filtering = search.filterEnabled && active;
  if (!active) {
    return {
      active: false,
      filtering: false,
      filterMode: search.filterMode,
      matchedSections,
      matchedBlocks,
      visibleSections,
      visibleBlocks,
      query: '',
      caseSensitive: search.caseSensitive,
    };
  }

  for (const result of search.results) {
    if (result.targetKind === 'section') {
      matchedSections.add(result.sectionKey);
    } else if (result.blockId) {
      matchedBlocks.add(result.blockId);
    }
  }

  const visitSection = (section: VisualSection, ancestors: VisualSection[]): boolean => {
    const sectionMatched = matchedSections.has(section.key);
    let visible = sectionMatched;
    for (const block of section.blocks) {
      visible = visitBlock(block, sectionMatched) || visible;
    }
    for (const child of section.children) {
      visible = (sectionMatched ? markSectionTreeVisible(child) : visitSection(child, [...ancestors, section])) || visible;
    }
    if (visible) {
      visibleSections.add(section.key);
      ancestors.forEach((ancestor) => visibleSections.add(ancestor.key));
      if (!sectionMatched && filtering) {
        section.blocks.forEach((block) => markBlockContextVisible(block, FILTER_CONTEXT_DEPTH));
      }
    }
    return visible;
  };

  const visitBlock = (block: VisualBlock, forceVisible = false): boolean => {
    let visible = forceVisible || matchedBlocks.has(block.id);
    for (const child of block.schema.containerBlocks ?? []) {
      visible = visitBlock(child, forceVisible) || visible;
    }
    for (const child of block.schema.componentListBlocks ?? []) {
      visible = visitBlock(child, forceVisible) || visible;
    }
    for (const child of block.schema.expandableStubBlocks?.children ?? []) {
      visible = visitBlock(child, forceVisible) || visible;
    }
    let expandedContentVisible = false;
    for (const child of block.schema.expandableContentBlocks?.children ?? []) {
      const childVisible = visitBlock(child, forceVisible);
      expandedContentVisible = childVisible || expandedContentVisible;
      visible = childVisible || visible;
    }
    for (const item of block.schema.gridItems ?? []) {
      visible = visitBlock(item.block, forceVisible) || visible;
    }
    if (expandedContentVisible && !forceVisible) {
      for (const child of block.schema.expandableStubBlocks?.children ?? []) {
        markBlockTreeVisible(child);
      }
    }
    if (visible) {
      visibleBlocks.add(block.id);
      if (filtering && !forceVisible) {
        markBlockStructuralContextVisible(block);
      }
    }
    return visible;
  };

  const markBlockTreeVisible = (block: VisualBlock): void => {
    visibleBlocks.add(block.id);
    block.schema.containerBlocks.forEach(markBlockTreeVisible);
    block.schema.componentListBlocks.forEach(markBlockTreeVisible);
    block.schema.expandableStubBlocks.children.forEach(markBlockTreeVisible);
    block.schema.expandableContentBlocks.children.forEach(markBlockTreeVisible);
    block.schema.gridItems.forEach((item) => markBlockTreeVisible(item.block));
  };

  const markBlockContextVisible = (block: VisualBlock, depth: number): void => {
    visibleBlocks.add(block.id);
    if (depth <= 0) {
      return;
    }
    block.schema.containerBlocks.forEach((child) => markBlockContextVisible(child, depth - 1));
    block.schema.gridItems.forEach((item) => markBlockContextVisible(item.block, depth - 1));
  };

  const markBlockStructuralContextVisible = (block: VisualBlock): void => {
    block.schema.containerBlocks.forEach((child) => visibleBlocks.add(child.id));
    block.schema.expandableStubBlocks.children.forEach(markExpandableContextChildVisible);
    block.schema.expandableContentBlocks.children.forEach(markExpandableContextChildVisible);
    block.schema.gridItems.forEach((item) => visibleBlocks.add(item.block.id));
  };

  const markExpandableContextChildVisible = (block: VisualBlock): void => {
    if (isTransparentLayoutBlock(block)) {
      markTransparentLayoutContextVisible(block);
      return;
    }
    visibleBlocks.add(block.id);
  };

  const markTransparentLayoutContextVisible = (block: VisualBlock): void => {
    visibleBlocks.add(block.id);
    block.schema.containerBlocks.forEach((child) => {
      if (isTransparentLayoutBlock(child)) {
        markTransparentLayoutContextVisible(child);
        return;
      }
      visibleBlocks.add(child.id);
    });
    block.schema.gridItems.forEach((item) => {
      if (isTransparentLayoutBlock(item.block)) {
        markTransparentLayoutContextVisible(item.block);
        return;
      }
      visibleBlocks.add(item.block.id);
    });
  };

  const isTransparentLayoutBlock = (block: VisualBlock): boolean =>
    block.schema.component === 'grid'
    || block.schema.component === 'container'
    || block.schema.component === 'component-list'
    || block.schema.gridItems.length > 0
    || block.schema.containerBlocks.length > 0;

  const markSectionTreeVisible = (section: VisualSection): boolean => {
    visibleSections.add(section.key);
    section.blocks.forEach((block) => visitBlock(block, true));
    section.children.forEach(markSectionTreeVisible);
    return true;
  };

  sections.forEach((section) => visitSection(section, []));
  return {
    active,
    filtering,
    filterMode: search.filterMode,
    matchedSections,
    matchedBlocks,
    visibleSections,
    visibleBlocks,
    query: search.submittedQuery,
    caseSensitive: search.caseSensitive,
  };
}

export function isSectionSearchVisible(context: SearchFilterContext, section: VisualSection): boolean {
  return !context.filtering || context.filterMode !== 'hide' || context.visibleSections.has(section.key);
}

export function isBlockSearchVisible(context: SearchFilterContext, block: VisualBlock): boolean {
  return !context.filtering || context.filterMode !== 'hide' || context.visibleBlocks.has(block.id);
}

export function isSectionSearchMatch(context: SearchFilterContext, section: VisualSection): boolean {
  return context.active && context.matchedSections.has(section.key);
}

export function isBlockSearchMatch(context: SearchFilterContext, block: VisualBlock): boolean {
  return context.active && context.matchedBlocks.has(block.id);
}

export function isSectionSearchDeprioritized(context: SearchFilterContext, section: VisualSection): boolean {
  return context.filtering && context.filterMode === 'deprioritize' && !context.visibleSections.has(section.key);
}

export function isBlockSearchDeprioritized(context: SearchFilterContext, block: VisualBlock): boolean {
  return context.filtering && context.filterMode === 'deprioritize' && !context.visibleBlocks.has(block.id);
}
