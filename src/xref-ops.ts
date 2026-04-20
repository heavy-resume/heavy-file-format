import type { VisualBlock } from './editor/types';
import { state } from './state';
import { flattenSections, formatSectionTitle, getSectionId, visitBlocks } from './section-ops';

export function normalizeXrefTarget(target: string): string {
  const trimmed = target.trim();
  return trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
}

export function getXrefTargetOptions(): Array<{ value: string; label: string }> {
  const seen = new Set<string>();
  const options: Array<{ value: string; label: string }> = [];
  const add = (value: string, label: string): void => {
    const normalized = normalizeXrefTarget(value);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    options.push({ value: normalized, label });
  };

  flattenSections(state.document.sections)
    .filter((section) => !section.isGhost)
    .forEach((section) => {
      add(getSectionId(section), `${formatSectionTitle(section.title)} (${getSectionId(section)})`);
    });

  visitBlocks(state.document.sections, (block) => {
    const id = block.schema.id.trim();
    if (id.length === 0) {
      return;
    }
    add(id, `${describeBlockTarget(block)} (${id})`);
  });

  return options;
}

export function isXrefTargetValid(target: string): boolean {
  const normalized = normalizeXrefTarget(target);
  if (normalized.length === 0 || /^[a-z][a-z0-9+.-]*:/i.test(normalized)) {
    return true;
  }
  return getXrefTargetOptions().some((option) => option.value === normalized);
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
