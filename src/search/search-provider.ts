import type { VisualBlock } from '../editor/types';
import type { VisualSection } from '../editor/types';
import { findVirtualDirectoryForBlock } from '../cli-core/virtual-file-system';
import { getSectionId } from '../section-ops';
import type { HvySearchMatch, HvySearchProvider, HvySearchRequest, HvySearchResult, SearchCategory } from './types';

const CATEGORY_ORDER: SearchCategory[] = ['tags', 'contents', 'description'];
const FIELD_LABELS: Record<string, string> = {
  tags: 'Tags',
  description: 'Description',
  title: 'Title',
  text: 'Text',
  xrefTitle: 'Title',
  xrefDetail: 'Detail',
  containerTitle: 'Title',
  imageAlt: 'Alt text',
  tableColumns: 'Table',
  tableCells: 'Table',
  pluginConfig: 'Plugin',
};

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
        label: getSectionLabel(section),
        contextLabel: 'Section',
        candidates,
      });
    }
    visitBlocks(request, section, section.blocks, results, seen, categories, [getSectionLabel(section)]);
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
  categories: SearchCategory[],
  contextTrail: string[]
): void {
  for (const block of blocks) {
    const label = getBlockLabel(block, section);
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
        label,
        contextLabel: getContextLabel(contextTrail, label),
        candidates,
      });
    }
    const childTrail = appendContextLabel(contextTrail, getBlockContextLabel(block));
    visitBlocks(request, section, block.schema.containerBlocks ?? [], results, seen, categories, childTrail);
    visitBlocks(request, section, block.schema.componentListBlocks ?? [], results, seen, categories, childTrail);
    visitBlocks(request, section, block.schema.expandableStubBlocks?.children ?? [], results, seen, categories, childTrail);
    visitBlocks(request, section, block.schema.expandableContentBlocks?.children ?? [], results, seen, categories, childTrail);
    visitBlocks(request, section, (block.schema.gridItems ?? []).map((item) => item.block), results, seen, categories, childTrail);
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
  contextLabel: string;
  candidates: Array<{ field: string; label: string; value: string }>;
}): void {
  const query = options.request.query.trim();
  if (!query) {
    return;
  }
  const matches: HvySearchMatch[] = [];
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
    matches.push({
      field: candidate.field,
      label: candidate.label,
      preview: createPreview(candidate.value, matchIndex, query.length),
      matchedText: candidate.value.slice(matchIndex, matchIndex + query.length),
    });
  }
  if (matches.length === 0) {
    return;
  }
  const firstMatch = matches[0]!;
  options.results.push({
    id: `search-${options.results.length + 1}`,
    category: options.category,
    targetKind: options.targetKind,
    sectionKey: options.section.key,
    ...(options.block ? { blockId: options.block.id } : {}),
    targetId: options.targetId,
    ...(options.targetPath ? { targetPath: options.targetPath } : {}),
    label: options.label,
    contextLabel: options.contextLabel,
    preview: firstMatch.preview,
    matchedText: firstMatch.matchedText,
    sourceField: summarizeMatches(matches, options.category),
    matches,
  });
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

function getSectionCandidates(section: VisualSection, category: SearchCategory): Array<{ field: string; label: string; value: string }> {
  if (category === 'tags') {
    return [{ field: 'tags', label: FIELD_LABELS.tags, value: section.tags }];
  }
  if (category === 'description') {
    return [{ field: 'description', label: FIELD_LABELS.description, value: section.description }];
  }
  return [{ field: 'title', label: FIELD_LABELS.title, value: section.title }];
}

function getBlockCandidates(block: VisualBlock, category: SearchCategory): Array<{ field: string; label: string; value: string }> {
  if (category === 'tags') {
    return [{ field: 'tags', label: FIELD_LABELS.tags, value: block.schema.tags }];
  }
  if (category === 'description') {
    return [{ field: 'description', label: FIELD_LABELS.description, value: block.schema.description }];
  }
  return [
    { field: 'text', label: FIELD_LABELS.text, value: block.text },
    { field: 'xrefTitle', label: FIELD_LABELS.xrefTitle, value: block.schema.xrefTitle },
    { field: 'xrefDetail', label: FIELD_LABELS.xrefDetail, value: block.schema.xrefDetail },
    { field: 'containerTitle', label: FIELD_LABELS.containerTitle, value: block.schema.containerTitle },
    { field: 'imageAlt', label: FIELD_LABELS.imageAlt, value: block.schema.imageAlt },
    { field: 'tableColumns', label: FIELD_LABELS.tableColumns, value: block.schema.tableColumns.join(' ') },
    { field: 'tableCells', label: FIELD_LABELS.tableCells, value: block.schema.tableRows.flatMap((row) => row.cells).join(' ') },
    { field: 'pluginConfig', label: FIELD_LABELS.pluginConfig, value: JSON.stringify(block.schema.pluginConfig ?? {}) },
  ];
}

function getBlockLabel(block: VisualBlock, section: VisualSection): string {
  return block.schema.xrefTitle.trim()
    || block.schema.containerTitle.trim()
    || firstLine(block.text)
    || block.schema.imageAlt.trim()
    || block.schema.id.trim()
    || getSectionLabel(section);
}

function getBlockContextLabel(block: VisualBlock): string {
  return block.schema.xrefTitle.trim()
    || block.schema.containerTitle.trim()
    || firstLine(block.text)
    || block.schema.imageAlt.trim();
}

function getSectionLabel(section: VisualSection): string {
  return section.title.trim() || getSectionId(section) || 'Untitled section';
}

function getContextLabel(contextTrail: string[], label: string): string {
  return contextTrail.filter((part) => part && part !== label).slice(-3).join(' / ');
}

function appendContextLabel(contextTrail: string[], label: string): string[] {
  if (!label || contextTrail[contextTrail.length - 1] === label) {
    return contextTrail;
  }
  return [...contextTrail, label];
}

function firstLine(value: string): string {
  const line = value.replace(/\s+/g, ' ').trim();
  return line.length > 82 ? `${line.slice(0, 81).trim()}...` : line;
}

function summarizeMatches(matches: HvySearchMatch[], category: SearchCategory): string {
  const labels = [...new Set(matches.map((match) => match.label))];
  if (matches.length === 1) {
    return labels[0] ?? category;
  }
  if (labels.length === 1) {
    return `${matches.length} ${labels[0]!.toLocaleLowerCase()} matches`;
  }
  return `${matches.length} matches in ${labels.slice(0, 2).join(' + ')}${labels.length > 2 ? ` + ${labels.length - 2} more` : ''}`;
}
