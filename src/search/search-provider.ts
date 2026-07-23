import type { VisualBlock } from '../editor/types';
import type { VisualSection } from '../editor/types';
import { findVirtualDirectoryForBlock } from '../cli-core/virtual-file-system';
import { getSectionId } from '../section-ops';
import { getTextCaptionMarkdown } from '../caption';
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
  caption: 'Caption',
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
  let documentOrder = 0;

  const visitSection = (section: VisualSection): void => {
    if (section.isGhost) {
      return;
    }
    const sectionOrder = documentOrder;
    documentOrder += 1;
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
        documentOrder: sectionOrder,
        candidates,
      });
    }
    documentOrder = visitBlocks(
      request,
      section,
      section.blocks,
      results,
      seen,
      categories,
      [getSectionLabel(section)],
      documentOrder,
      section.description.trim()
    );
    section.children.forEach(visitSection);
  };

  request.document.sections.forEach(visitSection);
  return results.sort((left, right) => {
    const categoryOrder = getSearchCategoryOrder(left.category) - getSearchCategoryOrder(right.category);
    if (categoryOrder !== 0) {
      return categoryOrder;
    }
    return (left.documentOrder ?? 0) - (right.documentOrder ?? 0);
  });
};

function visitBlocks(
  request: HvySearchRequest,
  section: VisualSection,
  blocks: VisualBlock[],
  results: HvySearchResult[],
  seen: Set<string>,
  categories: SearchCategory[],
  contextTrail: string[],
  documentOrder: number,
  nearestLocationLabel: string
): number {
  for (const block of blocks) {
    const blockOrder = documentOrder;
    documentOrder += 1;
    const label = getBlockLabel(block, section);
    const blockLocationLabel = getBlockLocationLabel(block) || nearestLocationLabel;
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
        label,
        locationLabel: blockLocationLabel,
        contextLabel: getContextLabel(contextTrail, label),
        documentOrder: blockOrder,
        candidates,
      });
    }
    const childTrail = appendContextLabel(contextTrail, getBlockContextLabel(block));
    documentOrder = visitBlocks(request, section, block.schema.containerBlocks ?? [], results, seen, categories, childTrail, documentOrder, blockLocationLabel);
    documentOrder = visitBlocks(request, section, block.schema.componentListBlocks ?? [], results, seen, categories, childTrail, documentOrder, blockLocationLabel);
    documentOrder = visitBlocks(request, section, block.schema.expandableStubBlocks?.children ?? [], results, seen, categories, childTrail, documentOrder, getExpandableLocationLabel(block, 'stub') || blockLocationLabel);
    documentOrder = visitBlocks(request, section, block.schema.expandableContentBlocks?.children ?? [], results, seen, categories, childTrail, documentOrder, getExpandableLocationLabel(block, 'expanded') || blockLocationLabel);
    documentOrder = visitBlocks(request, section, (block.schema.gridItems ?? []).map((item) => item.block), results, seen, categories, childTrail, documentOrder, blockLocationLabel);
  }
  return documentOrder;
}

function getSearchCategoryOrder(category: HvySearchResult['category']): number {
  const order = CATEGORY_ORDER.indexOf(category as SearchCategory);
  return order >= 0 ? order : CATEGORY_ORDER.length;
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
  locationLabel?: string;
  contextLabel: string;
  documentOrder: number;
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
  const targetPath = options.targetPath ?? (options.block ? findVirtualDirectoryForBlock(options.request.document, options.block) ?? undefined : undefined);
  options.results.push({
    id: `search-${options.results.length + 1}`,
    category: options.category,
    targetKind: options.targetKind,
    sectionKey: options.section.key,
    ...(options.block ? { blockId: options.block.id } : {}),
    targetId: options.targetId,
    ...(targetPath ? { targetPath } : {}),
    label: options.label,
    ...(options.locationLabel?.trim() ? { locationLabel: options.locationLabel.trim() } : {}),
    contextLabel: options.contextLabel,
    preview: firstMatch.preview,
    matchedText: firstMatch.matchedText,
    sourceField: summarizeMatches(matches, options.category),
    matches,
    documentOrder: options.documentOrder,
  });
}

function getBlockLocationLabel(block: VisualBlock): string {
  return block.schema.description.trim();
}

function getExpandableLocationLabel(block: VisualBlock, pane: 'stub' | 'expanded'): string {
  return pane === 'stub'
    ? (block.schema.expandableStubDescription ?? '').trim()
    : (block.schema.expandableContentDescription ?? '').trim();
}

function findMatchIndex(value: string, query: string, caseSensitive: boolean): number {
  return caseSensitive ? value.indexOf(query) : value.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
}

function createPreview(value: string, matchIndex: number, length: number): string {
  const normalized = cleanSearchResultText(value);
  if (normalized.length <= 220) {
    return normalized;
  }
  const rawStart = Math.max(0, matchIndex - 80);
  const start = rawStart > 0 ? rawStart : 0;
  const end = Math.min(value.length, matchIndex + length + 120);
  return `${start > 0 ? '...' : ''}${cleanSearchResultText(value.slice(start, end))}${end < value.length ? '...' : ''}`;
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
    return [{ field: 'tags', label: FIELD_LABELS.tags, value: block.schema.tags ?? '' }];
  }
  if (category === 'description') {
    return [
      { field: 'description', label: FIELD_LABELS.description, value: block.schema.description ?? '' },
      { field: 'expandableStubDescription', label: 'Stub description', value: block.schema.expandableStubDescription ?? '' },
      { field: 'expandableContentDescription', label: 'Expanded description', value: block.schema.expandableContentDescription ?? '' },
    ];
  }
  return [
    { field: 'text', label: FIELD_LABELS.text, value: block.text },
    { field: 'xrefTitle', label: FIELD_LABELS.xrefTitle, value: block.schema.xrefTitle ?? '' },
    { field: 'xrefDetail', label: FIELD_LABELS.xrefDetail, value: block.schema.xrefDetail ?? '' },
    { field: 'containerTitle', label: FIELD_LABELS.containerTitle, value: block.schema.containerTitle ?? '' },
    { field: 'imageAlt', label: FIELD_LABELS.imageAlt, value: block.schema.imageAlt ?? '' },
    { field: 'caption', label: FIELD_LABELS.caption, value: getTextCaptionMarkdown(block.schema.caption) },
    { field: 'tableColumns', label: FIELD_LABELS.tableColumns, value: (block.schema.tableColumns ?? []).join(' ') },
    { field: 'tableCells', label: FIELD_LABELS.tableCells, value: (block.schema.tableRows ?? []).flatMap((row) => row.cells).join(' ') },
    { field: 'pluginConfig', label: FIELD_LABELS.pluginConfig, value: JSON.stringify(block.schema.pluginConfig ?? {}) },
  ];
}

function getBlockLabel(block: VisualBlock, section: VisualSection): string {
  return (block.schema.xrefTitle ?? '').trim()
    || (block.schema.containerTitle ?? '').trim()
    || firstLine(block.text)
    || getTextCaptionMarkdown(block.schema.caption).trim()
    || (block.schema.imageAlt ?? '').trim()
    || (block.schema.id ?? '').trim()
    || getSectionLabel(section);
}

function getBlockContextLabel(block: VisualBlock): string {
  return (block.schema.xrefTitle ?? '').trim()
    || (block.schema.containerTitle ?? '').trim()
    || firstLine(block.text)
    || getTextCaptionMarkdown(block.schema.caption).trim()
    || (block.schema.imageAlt ?? '').trim();
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
  const line = cleanSearchResultText(value);
  return line.length > 82 ? `${line.slice(0, 81).trim()}...` : line;
}

function cleanSearchResultText(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^#{1,6}\s+/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
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
