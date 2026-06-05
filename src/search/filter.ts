import type { VisualBlock, VisualSection } from '../editor/types';
import type { SearchState } from './types';
import { parseTags } from '../editor/tag-editor';

const FILTER_CONTEXT_DEPTH = 1;

export interface SearchFilterContext {
  active: boolean;
  filtering: boolean;
  filterMode: SearchState['filterMode'];
  matchedSections: Set<string>;
  matchedBlocks: Set<string>;
  visibleSections: Set<string>;
  visibleBlocks: Set<string>;
  excludedBlocks: Set<string>;
  query: string;
  caseSensitive: boolean;
}

export function createSearchFilterContext(sections: VisualSection[], search: SearchState): SearchFilterContext {
  const matchedSections = new Set<string>();
  const matchedBlocks = new Set<string>();
  const semanticMatchedBlocks = new Set<string>();
  const matchedTargetIds = new Set<string>();
  const semanticMatchedTargetIds = new Set<string>();
  const visibleSections = new Set<string>();
  const visibleBlocks = new Set<string>();
  const excludedBlocks = new Set<string>();
  const excludeTags = parseTags(search.submittedExcludeTags ?? '');
  const hasSubmittedQuery = search.submittedQuery.trim().length > 0;
  const active = hasSubmittedQuery || excludeTags.length > 0;
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
      excludedBlocks,
      query: '',
      caseSensitive: search.caseSensitive,
    };
  }

  addExcludedBlocksByTags(sections, excludeTags, excludedBlocks);

  for (const result of search.results) {
    addResultTargetIds(result, matchedTargetIds);
    if (result.category === 'semantic') {
      addResultTargetIds(result, semanticMatchedTargetIds);
    }
    if (result.targetKind === 'section') {
      matchedSections.add(result.sectionKey);
    } else if (result.blockId) {
      matchedBlocks.add(result.blockId);
      if (result.category === 'semantic') {
        semanticMatchedBlocks.add(result.blockId);
      }
    }
  }
  addDocumentTargetIdsForDirectMatches(sections, matchedSections, matchedBlocks, semanticMatchedBlocks, matchedTargetIds, semanticMatchedTargetIds);
  addXrefMatchesForMatchedTargets(sections, matchedTargetIds, semanticMatchedTargetIds, matchedBlocks, semanticMatchedBlocks);

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
    const semanticBlockMatched = semanticMatchedBlocks.has(block.id);
    let visible = forceVisible || matchedBlocks.has(block.id) || (filtering && !hasSubmittedQuery && !excludedBlocks.has(block.id));
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
      if (semanticBlockMatched && !forceVisible) {
        markBlockTreeVisible(block);
      }
      visibleBlocks.add(block.id);
      if (filtering && !forceVisible) {
        markBlockStructuralContextVisible(block);
      }
    }
    if (excludedBlocks.has(block.id)) {
      visibleBlocks.delete(block.id);
      return false;
    }
    return visible;
  };

  const markBlockTreeVisible = (block: VisualBlock): void => {
    if (!excludedBlocks.has(block.id)) {
      visibleBlocks.add(block.id);
    }
    (block.schema.containerBlocks ?? []).forEach(markBlockTreeVisible);
    (block.schema.componentListBlocks ?? []).forEach(markBlockTreeVisible);
    (block.schema.expandableStubBlocks?.children ?? []).forEach(markBlockTreeVisible);
    (block.schema.expandableContentBlocks?.children ?? []).forEach(markBlockTreeVisible);
    (block.schema.gridItems ?? []).forEach((item) => markBlockTreeVisible(item.block));
  };

  const markBlockContextVisible = (block: VisualBlock, depth: number): void => {
    if (!excludedBlocks.has(block.id)) {
      visibleBlocks.add(block.id);
    }
    if (depth <= 0) {
      return;
    }
    (block.schema.containerBlocks ?? []).forEach((child) => markBlockContextVisible(child, depth - 1));
    (block.schema.gridItems ?? []).forEach((item) => markBlockContextVisible(item.block, depth - 1));
  };

  const markBlockStructuralContextVisible = (block: VisualBlock): void => {
    (block.schema.containerBlocks ?? []).forEach((child) => addVisibleBlock(child));
    (block.schema.expandableStubBlocks?.children ?? []).forEach(markExpandableContextChildVisible);
    (block.schema.expandableContentBlocks?.children ?? []).forEach(markExpandableContextChildVisible);
    (block.schema.gridItems ?? []).forEach((item) => addVisibleBlock(item.block));
  };

  const markExpandableContextChildVisible = (block: VisualBlock): void => {
    if (isTransparentLayoutBlock(block)) {
      markTransparentLayoutContextVisible(block);
      return;
    }
    addVisibleBlock(block);
  };

  const markTransparentLayoutContextVisible = (block: VisualBlock): void => {
    addVisibleBlock(block);
    (block.schema.containerBlocks ?? []).forEach((child) => {
      if (isTransparentLayoutBlock(child)) {
        markTransparentLayoutContextVisible(child);
        return;
      }
      addVisibleBlock(child);
    });
    (block.schema.gridItems ?? []).forEach((item) => {
      if (isTransparentLayoutBlock(item.block)) {
        markTransparentLayoutContextVisible(item.block);
        return;
      }
      addVisibleBlock(item.block);
    });
  };

  const isTransparentLayoutBlock = (block: VisualBlock): boolean =>
    block.schema.component === 'grid'
    || block.schema.component === 'container'
    || block.schema.component === 'component-list'
    || (block.schema.gridItems ?? []).length > 0
    || (block.schema.containerBlocks ?? []).length > 0;

  const markSectionTreeVisible = (section: VisualSection): boolean => {
    visibleSections.add(section.key);
    section.blocks.forEach((block) => visitBlock(block, true));
    section.children.forEach(markSectionTreeVisible);
    return true;
  };

  const addVisibleBlock = (block: VisualBlock): void => {
    if (!excludedBlocks.has(block.id)) {
      visibleBlocks.add(block.id);
    }
  };

  sections.forEach((section) => visitSection(section, []));
  (search.clearedSectionKeys ?? []).forEach((sectionKey) => {
    const section = findSectionByKey(sections, sectionKey);
    if (section) {
      markSectionTreeVisible(section);
    }
  });
  (search.clearedBlockIds ?? []).forEach((blockId) => {
    for (const section of sections) {
      const block = findBlockInSection(section, blockId);
      if (block) {
        markBlockTreeVisible(block);
        visibleSections.add(section.key);
        return;
      }
    }
  });
  return {
    active,
    filtering,
    filterMode: search.filterMode,
    matchedSections,
    matchedBlocks,
    visibleSections,
    visibleBlocks,
    excludedBlocks,
    query: search.submittedQuery,
    caseSensitive: search.caseSensitive,
  };
}

function addExcludedBlocksByTags(sections: VisualSection[], excludeTags: string[], excludedBlocks: Set<string>): void {
  if (excludeTags.length === 0) {
    return;
  }
  const normalizedExcludeTags = new Set(excludeTags.map(normalizeTag));
  const visitBlock = (block: VisualBlock): void => {
    if (parseTags(block.schema.tags ?? '').some((tag) => normalizedExcludeTags.has(normalizeTag(tag)))) {
      excludedBlocks.add(block.id);
    }
    for (const child of getBlockChildren(block)) {
      visitBlock(child);
    }
  };
  for (const section of sections) {
    section.blocks.forEach(visitBlock);
    addExcludedBlocksByTags(section.children, excludeTags, excludedBlocks);
  }
}

function normalizeTag(tag: string): string {
  return tag.trim().toLocaleLowerCase();
}

function addResultTargetIds(result: SearchState['results'][number], targetIds: Set<string>): void {
  addNormalizedTargetId(targetIds, result.targetId);
  addTargetPathIds(result.targetPath, targetIds);
  if (result.targetKind === 'section') {
    addNormalizedTargetId(targetIds, result.sectionKey);
  } else {
    addNormalizedTargetId(targetIds, result.blockId);
  }
}

function addTargetPathIds(targetPath: string | undefined, targetIds: Set<string>): void {
  for (const part of targetPath?.split('/').filter(Boolean) ?? []) {
    if (part !== 'body') {
      addNormalizedTargetId(targetIds, part);
    }
  }
}

function addDocumentTargetIdsForDirectMatches(
  sections: VisualSection[],
  matchedSections: Set<string>,
  matchedBlocks: Set<string>,
  semanticMatchedBlocks: Set<string>,
  matchedTargetIds: Set<string>,
  semanticMatchedTargetIds: Set<string>
): void {
  for (const section of sections) {
    if (matchedSections.has(section.key)) {
      addNormalizedTargetId(matchedTargetIds, section.customId);
      addNormalizedTargetId(matchedTargetIds, section.key);
    }
    for (const block of section.blocks) {
      addBlockTargetIdsForDirectMatches(block, matchedBlocks, semanticMatchedBlocks, matchedTargetIds, semanticMatchedTargetIds);
    }
    addDocumentTargetIdsForDirectMatches(section.children, matchedSections, matchedBlocks, semanticMatchedBlocks, matchedTargetIds, semanticMatchedTargetIds);
  }
}

function addBlockTargetIdsForDirectMatches(
  block: VisualBlock,
  matchedBlocks: Set<string>,
  semanticMatchedBlocks: Set<string>,
  matchedTargetIds: Set<string>,
  semanticMatchedTargetIds: Set<string>
): void {
  if (matchedBlocks.has(block.id)) {
    addNormalizedTargetId(matchedTargetIds, block.id);
    addNormalizedTargetId(matchedTargetIds, block.schema.id);
  }
  if (semanticMatchedBlocks.has(block.id)) {
    addNormalizedTargetId(semanticMatchedTargetIds, block.id);
    addNormalizedTargetId(semanticMatchedTargetIds, block.schema.id);
  }
  for (const child of getBlockChildren(block)) {
    addBlockTargetIdsForDirectMatches(child, matchedBlocks, semanticMatchedBlocks, matchedTargetIds, semanticMatchedTargetIds);
  }
}

function addXrefMatchesForMatchedTargets(
  sections: VisualSection[],
  matchedTargetIds: Set<string>,
  semanticMatchedTargetIds: Set<string>,
  matchedBlocks: Set<string>,
  semanticMatchedBlocks: Set<string>
): void {
  for (const section of sections) {
    for (const block of section.blocks) {
      addXrefBlockMatchesForMatchedTargets(block, matchedTargetIds, semanticMatchedTargetIds, matchedBlocks, semanticMatchedBlocks);
    }
    addXrefMatchesForMatchedTargets(section.children, matchedTargetIds, semanticMatchedTargetIds, matchedBlocks, semanticMatchedBlocks);
  }
}

function addXrefBlockMatchesForMatchedTargets(
  block: VisualBlock,
  matchedTargetIds: Set<string>,
  semanticMatchedTargetIds: Set<string>,
  matchedBlocks: Set<string>,
  semanticMatchedBlocks: Set<string>
): void {
  const xrefTarget = normalizeLocalTargetId(block.schema.xrefTarget);
  if (xrefTarget && matchedTargetIds.has(xrefTarget)) {
    matchedBlocks.add(block.id);
    if (semanticMatchedTargetIds.has(xrefTarget)) {
      semanticMatchedBlocks.add(block.id);
    }
  }
  for (const child of getBlockChildren(block)) {
    addXrefBlockMatchesForMatchedTargets(child, matchedTargetIds, semanticMatchedTargetIds, matchedBlocks, semanticMatchedBlocks);
  }
}

function addNormalizedTargetId(targetIds: Set<string>, value?: string): void {
  const targetId = normalizeLocalTargetId(value);
  if (targetId) {
    targetIds.add(targetId);
  }
}

function normalizeLocalTargetId(value?: string): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return '';
  }
  return trimmed.startsWith('#') ? trimmed.slice(1).trim() : trimmed;
}

function getBlockChildren(block: VisualBlock): VisualBlock[] {
  return [
    ...(block.schema.containerBlocks ?? []),
    ...(block.schema.componentListBlocks ?? []),
    ...(block.schema.expandableStubBlocks?.children ?? []),
    ...(block.schema.expandableContentBlocks?.children ?? []),
    ...(block.schema.gridItems ?? []).map((item) => item.block),
  ];
}

function findSectionByKey(sections: VisualSection[], sectionKey: string): VisualSection | null {
  for (const section of sections) {
    if (section.key === sectionKey) {
      return section;
    }
    const child = findSectionByKey(section.children, sectionKey);
    if (child) {
      return child;
    }
  }
  return null;
}

function findBlockInSection(section: VisualSection, blockId: string): VisualBlock | null {
  for (const block of section.blocks) {
    const found = findBlockInTree(block, blockId);
    if (found) {
      return found;
    }
  }
  for (const child of section.children) {
    const found = findBlockInSection(child, blockId);
    if (found) {
      return found;
    }
  }
  return null;
}

function findBlockInTree(block: VisualBlock, blockId: string): VisualBlock | null {
  if (block.id === blockId) {
    return block;
  }
  for (const child of [
    ...(block.schema.containerBlocks ?? []),
    ...(block.schema.componentListBlocks ?? []),
    ...(block.schema.expandableStubBlocks?.children ?? []),
    ...(block.schema.expandableContentBlocks?.children ?? []),
    ...(block.schema.gridItems ?? []).map((item) => item.block),
  ]) {
    const found = findBlockInTree(child, blockId);
    if (found) {
      return found;
    }
  }
  return null;
}

export function isSectionSearchVisible(context: SearchFilterContext, section: VisualSection): boolean {
  return !context.filtering || context.filterMode !== 'hide' || context.visibleSections.has(section.key);
}

export function isBlockSearchVisible(context: SearchFilterContext, block: VisualBlock): boolean {
  return !context.filtering || context.filterMode !== 'hide' || (!context.excludedBlocks.has(block.id) && context.visibleBlocks.has(block.id));
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
  return context.filtering && context.filterMode === 'deprioritize' && (context.excludedBlocks.has(block.id) || !context.visibleBlocks.has(block.id));
}

export function orderSearchFilteredSections(
  sections: VisualSection[],
  context: SearchFilterContext,
  options: { isPriority?: (section: VisualSection) => boolean } = {}
): VisualSection[] {
  if (!context.filtering || context.filterMode !== 'deprioritize') {
    return sections;
  }
  const prioritySections: VisualSection[] = [];
  const matchingSections: VisualSection[] = [];
  const deprioritizedSections: VisualSection[] = [];
  for (const section of sections) {
    if (options.isPriority?.(section)) {
      prioritySections.push(section);
    } else if (context.visibleSections.has(section.key)) {
      matchingSections.push(section);
    } else {
      deprioritizedSections.push(section);
    }
  }
  return [...prioritySections, ...matchingSections, ...deprioritizedSections];
}
