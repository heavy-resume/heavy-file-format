import type { VisualBlock } from './editor/types';
import { state } from './state';
import { flattenSections, formatSectionTitle, getSectionId } from './section-ops';
import { resolveBaseComponentFromMeta } from './component-defs';

export function normalizeXrefTarget(target: string): string {
  const trimmed = target.trim();
  return trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
}

export function getXrefTargetOptions(tagFilter = ''): Array<{ value: string; label: string; title: string; detail: string }> {
  const seen = new Set<string>();
  const options: Array<{ value: string; label: string; title: string; detail: string }> = [];
  const requestedTags = normalizeTagFilter(tagFilter);
  const add = (value: string, title: string, detail = ''): void => {
    const normalized = normalizeXrefTarget(value);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    options.push({ value: normalized, title, detail, label: formatXrefOptionLabel(title, detail, normalized) });
  };

  flattenSections(state.document.sections)
    .filter((section) => !section.isGhost)
    .filter((section) => section.customId.trim().length > 0)
    .filter((section) => matchesTagFilter(section.tags, requestedTags))
    .forEach((section) => {
      add(getSectionId(section), formatSectionTitle(section.title), section.description.trim());
    });

  visitBlocksForXrefOptions(requestedTags, add);

  return options.sort(compareXrefTargetOptions);
}

export function isXrefTargetValid(target: string, tagFilter = ''): boolean {
  const normalized = normalizeXrefTarget(target);
  if (normalized.length === 0 || /^[a-z][a-z0-9+.-]*:/i.test(normalized)) {
    return true;
  }
  return getXrefTargetOptions(tagFilter).some((option) => option.value === normalized);
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

export function applyXrefTargetDefaults(block: VisualBlock): void {
  const target = normalizeXrefTarget(block.schema.xrefTarget);
  if (!target) {
    return;
  }
  const option = getXrefTargetOptions(block.schema.xrefTargetTagFilter).find((item) => item.value === target);
  if (!option) {
    return;
  }
  if (!block.schema.xrefTitle.trim()) {
    block.schema.xrefTitle = option.title;
  }
  if (!block.schema.xrefDetail.trim()) {
    block.schema.xrefDetail = option.detail;
  }
}

function visitBlocksForXrefOptions(
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
      const id = block.schema.id.trim();
      if (id.length > 0 && matchesTagFilter(combinedTags, requestedTags)) {
        add(id, describeBlockTarget(block), describeBlockTargetDetail(block));
      }
      const childTags = shouldPropagateXrefTargetTags(block) ? combinedTags : inheritedTags;
      visitList(block.schema.containerBlocks ?? [], childTags);
      visitList(block.schema.componentListBlocks ?? [], childTags);
      visitList((block.schema.gridItems ?? []).map((item) => item.block), childTags);
      visitList(block.schema.expandableStubBlocks?.children ?? [], childTags);
      visitList(block.schema.expandableContentBlocks?.children ?? [], childTags);
    });
  };

  const visitSections = (sections: typeof state.document.sections, inheritedTags: string): void => {
    sections.forEach((section) => {
      const sectionTags = combineTags(inheritedTags, section.tags);
      visitList(section.blocks, sectionTags);
      visitSections(section.children, sectionTags);
    });
  };

  visitSections(state.document.sections, '');
}

function shouldPropagateXrefTargetTags(block: VisualBlock): boolean {
  const baseComponent = resolveBaseComponentFromMeta(block.schema.component, state.document.meta);
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

function combineTags(...values: string[]): string {
  return values.filter((value) => value.trim().length > 0).join(', ');
}

function parseTags(value: string): string[] {
  const seen = new Set<string>();
  return value
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

function cleanXrefDisplayValue(value: string): string {
  const trimmed = value.trim();
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

function cleanMarkdownText(value: string): string {
  const cleaned = value
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

function hasTemplateToken(value: string): boolean {
  return /{%\s*[A-Za-z_][A-Za-z0-9_-]*\s*(?:\|\s*(?:text|block)\s*)?%}/.test(value);
}
