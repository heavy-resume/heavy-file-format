import type { VisualBlock } from './editor/types';
import { state } from './state';
import { flattenSections, formatSectionTitle, getSectionId } from './section-ops';

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
    .filter((section) => matchesTagFilter(section.tags, requestedTags))
    .forEach((section) => {
      add(getSectionId(section), formatSectionTitle(section.title), section.description.trim());
    });

  visitBlocksForXrefOptions(requestedTags, add);

  return options;
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
  if (block.schema.xrefTitle.trim().length > 0) {
    return block.schema.xrefTitle.trim();
  }
  const firstTableCell = block.schema.expandableStubBlocks.children
    .flatMap((stubBlock) => stubBlock.schema.tableRows)
    .flatMap((row) => row.cells)
    .find((cell) => cell.trim().length > 0);
  if (firstTableCell) {
    return firstTableCell.trim();
  }
  return component;
}

export function describeBlockTargetDetail(block: VisualBlock): string {
  if (block.schema.xrefDetail.trim().length > 0) {
    return block.schema.xrefDetail.trim();
  }
  if (block.schema.description.trim().length > 0) {
    return block.schema.description.trim();
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
      visitList(block.schema.containerBlocks ?? [], combinedTags);
      visitList(block.schema.componentListBlocks ?? [], combinedTags);
      visitList((block.schema.gridItems ?? []).map((item) => item.block), combinedTags);
      visitList(block.schema.expandableStubBlocks?.children ?? [], combinedTags);
      visitList(block.schema.expandableContentBlocks?.children ?? [], combinedTags);
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
