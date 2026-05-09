import type { VisualBlock } from '../editor/types';
import type { VisualSection } from '../editor/types';
import { findVirtualDirectoryForBlock } from '../cli-core/virtual-file-system';
import { getSectionId } from '../section-ops';
import type { HvySearchProvider, HvySearchRequest, HvySearchResult, SearchCategory } from './types';

const CATEGORY_ORDER: SearchCategory[] = ['tags', 'contents', 'description'];

export const builtInSearchProvider: HvySearchProvider = (request) => {
  const query = request.query.trim();
  if (!query) {
    return [];
  }
  const categories = CATEGORY_ORDER.filter((category) => request.categories.includes(category));
  const results: HvySearchResult[] = [];
  const seen = new Set<string>();

  const visitSection = (section: VisualSection): void => {
    if (section.isGhost) {
      return;
    }
    for (const category of categories) {
      const candidates = getSectionCandidates(section, category);
      addMatches({
        request,
        results,
        seen,
        category,
        targetKind: 'section',
        section,
        targetId: getSectionId(section),
        label: section.title.trim() || getSectionId(section) || 'Untitled section',
        candidates,
      });
    }
    visitBlocks(request, section, section.blocks, results, seen, categories);
    section.children.forEach(visitSection);
  };

  request.document.sections.forEach(visitSection);
  return results.sort((left, right) => {
    const categoryOrder = CATEGORY_ORDER.indexOf(left.category) - CATEGORY_ORDER.indexOf(right.category);
    return categoryOrder !== 0 ? categoryOrder : left.label.localeCompare(right.label, undefined, { sensitivity: 'base' });
  });
};

function visitBlocks(
  request: HvySearchRequest,
  section: VisualSection,
  blocks: VisualBlock[],
  results: HvySearchResult[],
  seen: Set<string>,
  categories: SearchCategory[]
): void {
  for (const block of blocks) {
    for (const category of categories) {
      const candidates = getBlockCandidates(block, category);
      addMatches({
        request,
        results,
        seen,
        category,
        targetKind: 'block',
        section,
        block,
        targetId: block.schema.id.trim(),
        targetPath: findVirtualDirectoryForBlock(request.document, block) ?? undefined,
        label: getBlockLabel(block, section),
        candidates,
      });
    }
    visitBlocks(request, section, block.schema.containerBlocks ?? [], results, seen, categories);
    visitBlocks(request, section, block.schema.componentListBlocks ?? [], results, seen, categories);
    visitBlocks(request, section, block.schema.expandableStubBlocks?.children ?? [], results, seen, categories);
    visitBlocks(request, section, block.schema.expandableContentBlocks?.children ?? [], results, seen, categories);
    visitBlocks(request, section, (block.schema.gridItems ?? []).map((item) => item.block), results, seen, categories);
  }
}

function addMatches(options: {
  request: HvySearchRequest;
  results: HvySearchResult[];
  seen: Set<string>;
  category: SearchCategory;
  targetKind: 'section' | 'block';
  section: VisualSection;
  block?: VisualBlock;
  targetId: string;
  targetPath?: string;
  label: string;
  candidates: Array<{ field: string; value: string }>;
}): void {
  const query = options.request.query.trim();
  if (!query) {
    return;
  }
  for (const candidate of options.candidates) {
    const matchIndex = findMatchIndex(candidate.value, query, options.request.caseSensitive);
    if (matchIndex < 0) {
      continue;
    }
    const key = [
      options.category,
      options.targetKind,
      options.section.key,
      options.block?.id ?? '',
      candidate.field,
    ].join(':');
    if (options.seen.has(key)) {
      continue;
    }
    options.seen.add(key);
    options.results.push({
      id: `search-${options.results.length + 1}`,
      category: options.category,
      targetKind: options.targetKind,
      sectionKey: options.section.key,
      ...(options.block ? { blockId: options.block.id } : {}),
      targetId: options.targetId,
      ...(options.targetPath ? { targetPath: options.targetPath } : {}),
      label: options.label,
      preview: createPreview(candidate.value, matchIndex, query.length),
      matchedText: candidate.value.slice(matchIndex, matchIndex + query.length),
      sourceField: candidate.field,
    });
  }
}

function findMatchIndex(value: string, query: string, caseSensitive: boolean): number {
  return caseSensitive ? value.indexOf(query) : value.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
}

function createPreview(value: string, matchIndex: number, length: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 220) {
    return normalized;
  }
  const rawStart = Math.max(0, matchIndex - 80);
  const start = rawStart > 0 ? rawStart : 0;
  const end = Math.min(value.length, matchIndex + length + 120);
  return `${start > 0 ? '...' : ''}${value.slice(start, end).replace(/\s+/g, ' ').trim()}${end < value.length ? '...' : ''}`;
}

function getSectionCandidates(section: VisualSection, category: SearchCategory): Array<{ field: string; value: string }> {
  if (category === 'tags') {
    return [{ field: 'tags', value: section.tags }];
  }
  if (category === 'description') {
    return [{ field: 'description', value: section.description }];
  }
  return [{ field: 'title', value: section.title }];
}

function getBlockCandidates(block: VisualBlock, category: SearchCategory): Array<{ field: string; value: string }> {
  if (category === 'tags') {
    return [{ field: 'tags', value: block.schema.tags }];
  }
  if (category === 'description') {
    return [{ field: 'description', value: block.schema.description }];
  }
  return [
    { field: 'text', value: block.text },
    { field: 'xref title', value: block.schema.xrefTitle },
    { field: 'xref detail', value: block.schema.xrefDetail },
    { field: 'container title', value: block.schema.containerTitle },
    { field: 'image alt', value: block.schema.imageAlt },
    { field: 'table columns', value: block.schema.tableColumns.join(' ') },
    { field: 'table cells', value: block.schema.tableRows.flatMap((row) => row.cells).join(' ') },
    { field: 'plugin config', value: JSON.stringify(block.schema.pluginConfig ?? {}) },
  ];
}

function getBlockLabel(block: VisualBlock, section: VisualSection): string {
  return block.schema.xrefTitle.trim()
    || block.schema.containerTitle.trim()
    || block.schema.id.trim()
    || `${block.schema.component} in ${section.title.trim() || getSectionId(section) || 'section'}`;
}
