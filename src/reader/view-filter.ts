import type { VisualBlock, VisualSection } from '../editor/types';
import type { ReaderViewFilter, ReaderViewModifier, VisualDocument } from '../types';
import { findBlockForVirtualDirectory, findSectionForVirtualDirectory } from '../cli-core/virtual-file-system';

export type ReaderViewTargetKind = 'section' | 'block';
export type ReaderViewTargetKey = `${ReaderViewTargetKind}:${string}`;

export interface ReaderViewContext {
  modifiersByTarget: Map<ReaderViewTargetKey, Set<ReaderViewModifier>>;
  priorityRankByTarget: Map<ReaderViewTargetKey, number>;
}

export function createReaderViewContext(
  document: VisualDocument,
  filter: ReaderViewFilter,
  warn: (message: string) => void = console.warn
): ReaderViewContext {
  const modifiersByTarget = new Map<ReaderViewTargetKey, Set<ReaderViewModifier>>();
  const directPriorityRankByTarget = new Map<ReaderViewTargetKey, number>();
  const priorityRankByTarget = new Map<ReaderViewTargetKey, number>();
  const entries = Object.entries(filter);
  if (entries.length === 0) {
    return { modifiersByTarget, priorityRankByTarget };
  }

  const { idTargets, parentByTarget } = collectReaderViewTargets(document.sections);

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

  for (const [targetKey, modifiers] of modifiersByTarget) {
    if (modifiers.has('hidden')) {
      continue;
    }
    const rank = modifiers.has('highlight') ? 2 : modifiers.has('priority') ? 1 : 0;
    if (rank === 0) {
      continue;
    }
    directPriorityRankByTarget.set(targetKey, rank);
    let current: ReaderViewTargetKey | undefined = targetKey;
    while (current) {
      priorityRankByTarget.set(current, Math.max(priorityRankByTarget.get(current) ?? 0, rank));
      current = parentByTarget.get(current);
    }
  }
  for (const [targetKey, inheritedRank] of priorityRankByTarget) {
    if (inheritedRank >= 2 && directPriorityRankByTarget.get(targetKey) === 1) {
      priorityRankByTarget.set(targetKey, 3);
    }
  }

  return { modifiersByTarget, priorityRankByTarget };
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

export function getReaderViewPriorityRank(context: ReaderViewContext, targetKey: ReaderViewTargetKey): number {
  if (hasReaderViewModifier(context, targetKey, 'hidden')) {
    return 0;
  }
  return context.priorityRankByTarget.get(targetKey) ?? 0;
}

export function isReaderViewPrioritized(context: ReaderViewContext, targetKey: ReaderViewTargetKey): boolean {
  return getReaderViewPriorityRank(context, targetKey) > 0;
}

export function orderReaderViewTargets<T>(
  items: T[],
  context: ReaderViewContext,
  getTargetKey: (item: T) => ReaderViewTargetKey,
  _activatedTargets: Set<string>
): T[] {
  const visible = items.filter((item) => !hasReaderViewModifier(context, getTargetKey(item), 'hidden'));
  const boostedPriority: T[] = [];
  const highlightedPriority: T[] = [];
  const plainPriority: T[] = [];
  const standard: T[] = [];
  const dimmed: T[] = [];
  for (const item of visible) {
    const targetKey = getTargetKey(item);
    if (hasReaderViewModifier(context, targetKey, 'dimmed')) {
      dimmed.push(item);
    } else if (getReaderViewPriorityRank(context, targetKey) >= 3) {
      boostedPriority.push(item);
    } else if (getReaderViewPriorityRank(context, targetKey) >= 2) {
      highlightedPriority.push(item);
    } else if (getReaderViewPriorityRank(context, targetKey) > 0) {
      plainPriority.push(item);
    } else {
      standard.push(item);
    }
  }
  return [...boostedPriority, ...highlightedPriority, ...plainPriority, ...standard, ...dimmed];
}

function normalizeReaderViewModifiers(rawModifiers: ReaderViewModifier[]): Set<ReaderViewModifier> {
  const allowed = new Set<ReaderViewModifier>(['highlight', 'priority', 'collapse', 'dimmed', 'hidden']);
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

function collectReaderViewTargets(sections: VisualSection[]): {
  idTargets: Map<string, ReaderViewTargetKey[]>;
  parentByTarget: Map<ReaderViewTargetKey, ReaderViewTargetKey>;
} {
  const idTargets = new Map<string, ReaderViewTargetKey[]>();
  const parentByTarget = new Map<ReaderViewTargetKey, ReaderViewTargetKey>();
  const add = (id: string, targetKey: ReaderViewTargetKey): void => {
    const normalized = id.trim();
    if (!normalized) {
      return;
    }
    idTargets.set(normalized, [...(idTargets.get(normalized) ?? []), targetKey]);
  };
  const visitBlocks = (blocks: VisualBlock[], parent: ReaderViewTargetKey): void => {
    for (const block of blocks) {
      const targetKey = getBlockReaderViewTargetKey(block);
      parentByTarget.set(targetKey, parent);
      add(block.schema.id, targetKey);
      visitBlocks(block.schema.containerBlocks ?? [], targetKey);
      visitBlocks(block.schema.componentListBlocks ?? [], targetKey);
      visitBlocks(block.schema.expandableStubBlocks?.children ?? [], targetKey);
      visitBlocks(block.schema.expandableContentBlocks?.children ?? [], targetKey);
      visitBlocks((block.schema.gridItems ?? []).map((item) => item.block), targetKey);
    }
  };
  const visitSection = (section: VisualSection, parent?: ReaderViewTargetKey): void => {
    if (section.isGhost) {
      return;
    }
    const targetKey = getSectionReaderViewTargetKey(section);
    if (parent) {
      parentByTarget.set(targetKey, parent);
    }
    add(section.customId, targetKey);
    visitBlocks(section.blocks, targetKey);
    section.children.forEach((child) => visitSection(child, targetKey));
  };
  sections.forEach((section) => visitSection(section));
  return { idTargets, parentByTarget };
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
