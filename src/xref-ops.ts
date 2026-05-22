import type { VisualBlock } from './editor/types';
import { state } from './state';
import { flattenSections, formatSectionTitle, getSectionId } from './section-ops';
import { getComponentDefsFromMeta, resolveBaseComponentFromMeta } from './component-defs';
import type { VisualDocument } from './types';

export function normalizeXrefTarget(target: unknown): string {
  const trimmed = readXrefString(target);
  return trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
}

export interface XrefTargetOption {
  value: string;
  label: string;
  title: string;
  detail: string;
}

export function getXrefTargetOptions(tagFilter = ''): XrefTargetOption[] {
  return getXrefTargetOptionsForDocument(state.document, tagFilter);
}

export function getXrefTargetOptionsForDocument(document: VisualDocument, tagFilter = ''): XrefTargetOption[] {
  const seen = new Set<string>();
  const options: XrefTargetOption[] = [];
  const requestedTags = normalizeTagFilter(tagFilter);
  const add = (value: string, title: string, detail = ''): void => {
    const normalized = normalizeXrefTarget(value);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    options.push({ value: normalized, title, detail, label: formatXrefOptionLabel(title, detail, normalized) });
  };

  flattenSections(document.sections)
    .filter((section) => !section.isGhost)
    .filter((section) => section.customId.trim().length > 0)
    .filter((section) => matchesTagFilter(section.tags, requestedTags))
    .forEach((section) => {
      add(getSectionId(section), formatSectionTitle(section.title), section.description.trim());
    });

  visitBlocksForXrefOptions(document, requestedTags, add);

  return options.sort(compareXrefTargetOptions);
}

export function isXrefTargetValid(target: string, tagFilter = ''): boolean {
  const normalized = normalizeXrefTarget(target);
  if (normalized.length === 0 || /^[a-z][a-z0-9+.-]*:/i.test(normalized)) {
    return true;
  }
  return getXrefTargetOptions(tagFilter).some((option) => option.value === normalized);
}

export function getXrefTargetTagFilterForComponent(document: VisualDocument, componentName: string): string {
  const component = readXrefString(componentName);
  if (!component) {
    return '';
  }
  const definition = getComponentDefsFromMeta(document.meta).find((item) => item.name === component);
  const schema = definition?.template?.schema ?? definition?.schema;
  const filter = schema && typeof schema === 'object' && !Array.isArray(schema)
    ? (schema as { xrefTargetTagFilter?: unknown }).xrefTargetTagFilter
    : '';
  return typeof filter === 'string' ? filter.trim() : '';
}

export function getEffectiveXrefTargetTagFilter(document: VisualDocument, block: VisualBlock): string {
  const localFilter = readXrefString(block.schema.xrefTargetTagFilter);
  return localFilter || getXrefTargetTagFilterForComponent(document, block.schema.component);
}

export function describeBlockTarget(block: VisualBlock): string {
  const component = block.schema.component;
  const xrefTitle = cleanXrefDisplayValue(block.schema.xrefTitle);
  if (xrefTitle.length > 0) {
    return xrefTitle;
  }
  const visibleText = getFirstVisibleTargetText(block);
  if (visibleText.length > 0) {
    return visibleText;
  }
  const idTitle = humanizeTargetId(block.schema.id);
  if (idTitle.length > 0) {
    return idTitle;
  }
  return component;
}

export function describeBlockTargetDetail(block: VisualBlock): string {
  const xrefDetail = cleanXrefDisplayValue(block.schema.xrefDetail);
  if (xrefDetail.length > 0) {
    return xrefDetail;
  }
  const description = cleanXrefDisplayValue(block.schema.description);
  if (description.length > 0) {
    return description;
  }
  return '';
}

export function applyXrefTargetDefaults(block: VisualBlock, previousTarget = ''): void {
  const target = normalizeXrefTarget(block.schema.xrefTarget);
  if (!target) {
    return;
  }
  const options = getXrefTargetOptions(getEffectiveXrefTargetTagFilter(state.document, block));
  const option = options.find((item) => item.value === target);
  if (!option) {
    return;
  }
  const previousOption = previousTarget
    ? options.find((item) => item.value === normalizeXrefTarget(previousTarget))
    : undefined;
  const title = readXrefString(block.schema.xrefTitle);
  const detail = readXrefString(block.schema.xrefDetail);
  if (!title || title === previousOption?.title) {
    block.schema.xrefTitle = option.title;
  }
  if (!detail || detail === previousOption?.detail) {
    block.schema.xrefDetail = option.detail;
  }
}

function visitBlocksForXrefOptions(
  document: VisualDocument,
  requestedTags: string[],
  add: (value: string, title: string, detail?: string) => void
): void {
  const seen = new Set<VisualBlock>();
  const visitList = (blocks: VisualBlock[], inheritedTags: string): void => {
    blocks.forEach((block) => {
      if (seen.has(block)) {
        return;
      }
      seen.add(block);
      const combinedTags = combineTags(inheritedTags, block.schema.tags);
      const id = readXrefString(block.schema.id);
      if (id.length > 0 && matchesTagFilter(combinedTags, requestedTags)) {
        add(id, describeBlockTarget(block), describeBlockTargetDetail(block));
      }
      const childTags = shouldPropagateXrefTargetTags(document, block) ? combinedTags : inheritedTags;
      visitList(block.schema.containerBlocks ?? [], childTags);
      visitList(block.schema.componentListBlocks ?? [], childTags);
      visitList((block.schema.gridItems ?? []).map((item) => item.block), childTags);
      visitList(block.schema.expandableStubBlocks?.children ?? [], childTags);
      visitList(block.schema.expandableContentBlocks?.children ?? [], childTags);
    });
  };

  const visitSections = (sections: VisualDocument['sections'], inheritedTags: string): void => {
    sections.forEach((section) => {
      const sectionTags = combineTags(inheritedTags, section.tags);
      visitList(section.blocks, sectionTags);
      visitSections(section.children, sectionTags);
    });
  };

  visitSections(document.sections, '');
}

function shouldPropagateXrefTargetTags(document: VisualDocument, block: VisualBlock): boolean {
  const baseComponent = resolveBaseComponentFromMeta(readXrefString(block.schema.component) || 'text', document.meta);
  return baseComponent === 'component-list'
    || baseComponent === 'container'
    || baseComponent === 'grid';
}

function matchesTagFilter(tags: string, requestedTags: string[]): boolean {
  if (requestedTags.length === 0) {
    return true;
  }
  const targetTags = new Set(parseTags(tags).map((tag) => tag.toLowerCase()));
  return requestedTags.some((tag) => targetTags.has(tag));
}

function formatXrefOptionLabel(title: string, detail: string, value: string): string {
  const label = detail ? `${title} - ${detail}` : title;
  return `${label} (${value})`;
}

function compareXrefTargetOptions(
  left: { value: string; title: string; detail: string; label: string },
  right: { value: string; title: string; detail: string; label: string }
): number {
  return left.title.localeCompare(right.title, undefined, { numeric: true, sensitivity: 'base' })
    || left.value.localeCompare(right.value, undefined, { numeric: true, sensitivity: 'base' });
}

function normalizeTagFilter(tagFilter: string): string[] {
  return parseTags(tagFilter).map((tag) => tag.toLowerCase());
}

function combineTags(...values: unknown[]): string {
  return values.map(readXrefString).filter((value) => value.length > 0).join(', ');
}

function parseTags(value: unknown): string[] {
  const seen = new Set<string>();
  return readXrefString(value)
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => {
      const normalized = tag.toLowerCase();
      if (!normalized || seen.has(normalized)) {
        return false;
      }
      seen.add(normalized);
      return true;
    });
}

function cleanXrefDisplayValue(value: unknown): string {
  const trimmed = readXrefString(value);
  return trimmed.length > 0 && !hasTemplateToken(trimmed) ? trimmed : '';
}

function getFirstVisibleTargetText(block: VisualBlock): string {
  const ownText = cleanMarkdownText(block.text);
  if (ownText.length > 0) {
    return ownText;
  }
  for (const row of block.schema.tableRows ?? []) {
    const cell = row.cells.map(cleanMarkdownText).find((item) => item.length > 0);
    if (cell) {
      return cell;
    }
  }
  return [
    ...(block.schema.expandableStubBlocks?.children ?? []),
    ...(block.schema.expandableContentBlocks?.children ?? []),
    ...(block.schema.containerBlocks ?? []),
    ...(block.schema.componentListBlocks ?? []),
    ...(block.schema.gridItems ?? []).map((item) => item.block),
  ].map(getFirstVisibleTargetText).find((item) => item.length > 0) ?? '';
}

function cleanMarkdownText(value: unknown): string {
  const cleaned = readXrefString(value)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\^[a-z0-9_-]+\^/gi, ' ')
    .replace(/^#{1,6}\s*/gm, ' ')
    .replace(/[\\`*_~#[\]()!>-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return hasTemplateToken(cleaned) ? '' : cleaned;
}

function humanizeTargetId(value: string): string {
  const stripped = normalizeXrefTarget(value)
    .replace(/^(skill|tool|project|history|education)-/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function readXrefString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function hasTemplateToken(value: string): boolean {
  return /{%\s*[A-Za-z_][A-Za-z0-9_-]*\s*(?:\|\s*(?:text|block)\s*)?%}/.test(value);
}
