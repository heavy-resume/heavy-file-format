import type { VisualBlock, VisualSection } from '../editor/types';
import type { ReaderViewFilter, ReaderViewModifier, VisualDocument } from '../types';
import { findBlockForVirtualDirectory, findSectionForVirtualDirectory } from '../cli-core/virtual-file-system';

export type ReaderViewTargetKind = 'section' | 'block';
export type ReaderViewTargetKey = `${ReaderViewTargetKind}:${string}`;

export interface ReaderViewContext {
  modifiersByTarget: Map<ReaderViewTargetKey, Set<ReaderViewModifier>>;
}

export function createReaderViewContext(
  document: VisualDocument,
  filter: ReaderViewFilter,
  warn: (message: string) => void = console.warn
): ReaderViewContext {
  const modifiersByTarget = new Map<ReaderViewTargetKey, Set<ReaderViewModifier>>();
  const entries = Object.entries(filter);
  if (entries.length === 0) {
    return { modifiersByTarget };
  }

  const idTargets = collectIdTargets(document.sections);

  for (const [rawTarget, rawModifiers] of entries) {
    const target = rawTarget.trim();
    const modifiers = normalizeReaderViewModifiers(rawModifiers);
    if (!target || modifiers.size === 0) {
      continue;
    }

    const matchedTargets = idTargets.get(target);
    if (matchedTargets?.length) {
      addModifiers(modifiersByTarget, matchedTargets, modifiers);
      continue;
    }

    const pathTargets = resolvePathTargets(document, target);
    if (pathTargets.length > 0) {
      addModifiers(modifiersByTarget, pathTargets, modifiers);
      continue;
    }

    warn(`[hvy:reader-view] Unknown reader view target: ${target}`);
  }

  return { modifiersByTarget };
}

export function getSectionReaderViewTargetKey(section: VisualSection): ReaderViewTargetKey {
  return `section:${section.key}`;
}

export function getBlockReaderViewTargetKey(block: VisualBlock): ReaderViewTargetKey {
  return `block:${block.id}`;
}

export function getReaderViewModifiers(context: ReaderViewContext, targetKey: ReaderViewTargetKey): Set<ReaderViewModifier> {
  return context.modifiersByTarget.get(targetKey) ?? new Set<ReaderViewModifier>();
}

export function hasReaderViewModifier(context: ReaderViewContext, targetKey: ReaderViewTargetKey, modifier: ReaderViewModifier): boolean {
  return context.modifiersByTarget.get(targetKey)?.has(modifier) ?? false;
}

export function orderReaderViewTargets<T>(
  items: T[],
  context: ReaderViewContext,
  getTargetKey: (item: T) => ReaderViewTargetKey,
  _activatedTargets: Set<string>
): T[] {
  const visible = items.filter((item) => !hasReaderViewModifier(context, getTargetKey(item), 'hidden'));
  const standard: T[] = [];
  const dimmed: T[] = [];
  for (const item of visible) {
    const targetKey = getTargetKey(item);
    if (hasReaderViewModifier(context, targetKey, 'dimmed')) {
      dimmed.push(item);
    } else {
      standard.push(item);
    }
  }
  return [...standard, ...dimmed];
}

function normalizeReaderViewModifiers(rawModifiers: ReaderViewModifier[]): Set<ReaderViewModifier> {
  const allowed = new Set<ReaderViewModifier>(['highlight', 'collapse', 'dimmed', 'hidden']);
  return new Set(rawModifiers.filter((modifier): modifier is ReaderViewModifier => allowed.has(modifier)));
}

function addModifiers(
  modifiersByTarget: Map<ReaderViewTargetKey, Set<ReaderViewModifier>>,
  targets: ReaderViewTargetKey[],
  modifiers: Set<ReaderViewModifier>
): void {
  for (const target of targets) {
    const existing = modifiersByTarget.get(target) ?? new Set<ReaderViewModifier>();
    for (const modifier of modifiers) {
      existing.add(modifier);
    }
    modifiersByTarget.set(target, existing);
  }
}

function collectIdTargets(sections: VisualSection[]): Map<string, ReaderViewTargetKey[]> {
  const targets = new Map<string, ReaderViewTargetKey[]>();
  const add = (id: string, targetKey: ReaderViewTargetKey): void => {
    const normalized = id.trim();
    if (!normalized) {
      return;
    }
    targets.set(normalized, [...(targets.get(normalized) ?? []), targetKey]);
  };
  const visitBlocks = (blocks: VisualBlock[]): void => {
    for (const block of blocks) {
      add(block.schema.id, getBlockReaderViewTargetKey(block));
      visitBlocks(block.schema.containerBlocks ?? []);
      visitBlocks(block.schema.componentListBlocks ?? []);
      visitBlocks(block.schema.expandableStubBlocks?.children ?? []);
      visitBlocks(block.schema.expandableContentBlocks?.children ?? []);
      visitBlocks((block.schema.gridItems ?? []).map((item) => item.block));
    }
  };
  const visitSection = (section: VisualSection): void => {
    if (section.isGhost) {
      return;
    }
    add(section.customId, getSectionReaderViewTargetKey(section));
    visitBlocks(section.blocks);
    section.children.forEach(visitSection);
  };
  sections.forEach(visitSection);
  return targets;
}

function resolvePathTargets(document: VisualDocument, target: string): ReaderViewTargetKey[] {
  if (!target.startsWith('/') && !target.startsWith('.')) {
    return [];
  }
  const section = findSectionForVirtualDirectory(document, target);
  if (section) {
    return [getSectionReaderViewTargetKey(section)];
  }
  const block = findBlockForVirtualDirectory(document, target);
  if (block) {
    return [getBlockReaderViewTargetKey(block)];
  }
  return [];
}
