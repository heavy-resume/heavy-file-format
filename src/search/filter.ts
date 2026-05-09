import type { VisualBlock, VisualSection } from '../editor/types';
import type { SearchState } from './types';

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
    }
    return visible;
  };

  const visitBlock = (block: VisualBlock, forceVisible = false): boolean => {
    let visible = forceVisible || matchedBlocks.has(block.id);
    const nestedLists = [
      block.schema.containerBlocks ?? [],
      block.schema.componentListBlocks ?? [],
      block.schema.expandableStubBlocks?.children ?? [],
      block.schema.expandableContentBlocks?.children ?? [],
      (block.schema.gridItems ?? []).map((item) => item.block),
    ];
    for (const nested of nestedLists) {
      for (const child of nested) {
        visible = visitBlock(child, forceVisible) || visible;
      }
    }
    if (visible) {
      visibleBlocks.add(block.id);
    }
    return visible;
  };

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
