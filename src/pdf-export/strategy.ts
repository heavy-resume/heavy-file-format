import type { VisualBlock, VisualSection } from '../editor/types';
import type { ReaderViewFilter, ReaderViewModifier, VisualDocument } from '../types';
import { findBlockForVirtualDirectory, findSectionForVirtualDirectory } from '../cli-core/virtual-file-system';
import { resolveBaseComponentFromMeta } from '../component-defs';
import {
  getBlockReaderViewTargetKey,
  getReaderViewModifiers,
  getSectionReaderViewTargetKey,
  createReaderViewContext,
} from '../reader/view-filter';
import { normalizePdfPageMargins, resolvePdfPageSettings } from '../pdf-page-settings';
import type {
  HvyPdfExportDecision,
  HvyPdfExportResolvedStrategy,
  HvyPdfExportRuleRecorder,
  HvyPdfExportStrategy,
  HvyPdfExportStrategyDefaults,
  HvyPdfExportStrategyRule,
  HvyPdfExportVisibility,
  HvyPdfExportPane,
  HvyPdfExportRole,
  HvyPdfUnsupportedPluginPolicy,
  HvyPdfExportExpansionPolicy,
  HvyPdfExportSidebarPolicy,
} from './types';

type TargetKey = `section:${string}` | `block:${string}`;

const DEFAULT_DECISION: HvyPdfExportDecision = {
  visibility: 'include',
  keepTogether: false,
  keepWithNext: false,
  allowSplit: true,
  pageBreakBefore: false,
  pageBreakAfter: false,
  pdfStyle: {},
};

export function createPdfExportRuleRecorder(): HvyPdfExportRuleRecorder {
  const rules: HvyPdfExportStrategyRule[] = [];
  const toTarget = (idOrTag: string): Pick<HvyPdfExportStrategyRule, 'id' | 'tag'> => {
    const value = String(idOrTag ?? '').trim();
    return value.startsWith('#') ? { id: value.slice(1) } : { tag: value };
  };
  return {
    hide(idOrTag) {
      rules.push({ ...toTarget(idOrTag), hide: true });
    },
    include(idOrTag) {
      rules.push({ ...toTarget(idOrTag), include: true });
    },
    expand(idOrTag) {
      rules.push({ ...toTarget(idOrTag), expand: true });
    },
    keep_together(idOrTag) {
      rules.push({ ...toTarget(idOrTag), keepTogether: true });
    },
    style(idOrTag, style) {
      rules.push({ ...toTarget(idOrTag), pdfStyle: { ...(style ?? {}) } });
    },
    strategy(rule) {
      if (Array.isArray(rule)) {
        rules.push(...rule);
      } else {
        rules.push(rule);
      }
    },
    getStrategy() {
      return { rules: rules.slice() };
    },
  };
}

export function mergePdfExportStrategies(
  base?: HvyPdfExportStrategy | null,
  overlay?: HvyPdfExportStrategy | null
): HvyPdfExportStrategy {
  return {
    defaults: { ...(base?.defaults ?? {}), ...(overlay?.defaults ?? {}) },
    prepScript: overlay?.prepScript ?? base?.prepScript,
    rules: [...(base?.rules ?? []), ...(overlay?.rules ?? [])],
  };
}

export function resolvePdfExportStrategy(
  document: VisualDocument,
  strategy: HvyPdfExportStrategy | null | undefined,
  contentView: ReaderViewFilter | null | undefined = {}
): HvyPdfExportResolvedStrategy {
  const decisions = new Map<TargetKey, HvyPdfExportDecision>();
  const sectionsByKey = new Map<string, VisualSection>();
  const blocksById = new Map<string, VisualBlock>();
  collectDocumentTargets(document, sectionsByKey, blocksById);
  applyContentView(document, contentView ?? {}, decisions);

  for (const rule of strategy?.rules ?? []) {
    const targets = resolveRuleTargets(document, rule, sectionsByKey, blocksById);
    for (const target of targets) {
      const previous = decisions.get(target) ?? cloneDecision(DEFAULT_DECISION);
      decisions.set(target, applyRule(previous, rule));
    }
  }

  return {
    defaults: normalizeDefaults(document, strategy?.defaults),
    getSectionDecision(sectionKey) {
      return cloneDecision(decisions.get(`section:${sectionKey}`) ?? DEFAULT_DECISION);
    },
    getBlockDecision(blockId) {
      return cloneDecision(decisions.get(`block:${blockId}`) ?? DEFAULT_DECISION);
    },
  };
}

function collectDocumentTargets(
  document: VisualDocument,
  sectionsByKey: Map<string, VisualSection>,
  blocksById: Map<string, VisualBlock>
): void {
  const visitBlocks = (blocks: VisualBlock[]): void => {
    for (const block of blocks) {
      blocksById.set(block.id, block);
      visitBlocks(block.schema.containerBlocks ?? []);
      visitBlocks(block.schema.componentListBlocks ?? []);
      visitBlocks((block.schema.gridItems ?? []).map((item) => item.block));
      visitBlocks(block.schema.expandableStubBlocks?.children ?? []);
      visitBlocks(block.schema.expandableContentBlocks?.children ?? []);
    }
  };
  const visitSection = (section: VisualSection): void => {
    sectionsByKey.set(section.key, section);
    visitBlocks(section.blocks);
    section.children.forEach(visitSection);
  };
  document.sections.forEach(visitSection);
}

function applyContentView(
  document: VisualDocument,
  contentView: ReaderViewFilter,
  decisions: Map<TargetKey, HvyPdfExportDecision>
): void {
  const context = createReaderViewContext(document, contentView, () => {});
  const applyModifiers = (target: TargetKey, modifiers: Set<ReaderViewModifier>): void => {
    if (modifiers.size === 0) {
      return;
    }
    const decision = decisions.get(target) ?? cloneDecision(DEFAULT_DECISION);
    if (modifiers.has('hidden')) decision.visibility = 'hide';
    if (modifiers.has('dimmed') && decision.visibility !== 'hide') decision.visibility = 'dim';
    if (modifiers.has('highlight') && decision.visibility !== 'hide') decision.visibility = 'highlight';
    if (modifiers.has('collapse')) decision.pane = 'collapse';
    if ((modifiers.has('priority') || modifiers.has('highlight')) && decision.pane !== 'collapse') {
      decision.pane = 'expand';
    }
    decisions.set(target, decision);
  };
  const visitBlocks = (blocks: VisualBlock[]): void => {
    for (const block of blocks) {
      const target = getBlockReaderViewTargetKey(block);
      applyModifiers(target, getReaderViewModifiers(context, target));
      visitBlocks(block.schema.containerBlocks ?? []);
      visitBlocks(block.schema.componentListBlocks ?? []);
      visitBlocks((block.schema.gridItems ?? []).map((item) => item.block));
      visitBlocks(block.schema.expandableStubBlocks?.children ?? []);
      visitBlocks(block.schema.expandableContentBlocks?.children ?? []);
    }
  };
  const visitSection = (section: VisualSection): void => {
    const target = getSectionReaderViewTargetKey(section);
    applyModifiers(target, getReaderViewModifiers(context, target));
    visitBlocks(section.blocks);
    section.children.forEach(visitSection);
  };
  document.sections.forEach(visitSection);
}

function resolveRuleTargets(
  document: VisualDocument,
  rule: HvyPdfExportStrategyRule,
  sectionsByKey: Map<string, VisualSection>,
  blocksById: Map<string, VisualBlock>
): TargetKey[] {
  const targets = new Set<TargetKey>();
  if (rule.path) {
    const section = findSectionForVirtualDirectory(document, rule.path);
    if (section) targets.add(`section:${section.key}`);
    const block = findBlockForVirtualDirectory(document, rule.path);
    if (block) targets.add(`block:${block.id}`);
  }
  if (rule.id) {
    const id = rule.id.trim();
    for (const section of sectionsByKey.values()) {
      if (section.customId === id || section.key === id) targets.add(`section:${section.key}`);
    }
    for (const block of blocksById.values()) {
      if (block.schema.id === id || block.id === id) targets.add(`block:${block.id}`);
    }
  }
  if (rule.predicate) {
    for (const section of sectionsByKey.values()) {
      if (rule.predicate({
        kind: 'section',
        key: section.key,
        id: section.customId || section.key,
        tags: section.tags,
        title: section.title,
        location: section.location,
      })) {
        targets.add(`section:${section.key}`);
      }
    }
    for (const block of blocksById.values()) {
      const base = resolveBaseComponentFromMeta(block.schema.component, document.meta);
      if (rule.predicate({
        kind: 'component',
        blockId: block.id,
        id: block.schema.id || block.id,
        component: block.schema.component,
        baseComponent: base,
        tags: block.schema.tags,
      })) {
        targets.add(`block:${block.id}`);
      }
    }
  }
  for (const section of sectionsByKey.values()) {
    if (rule.tag && hasTag(section.tags, rule.tag)) targets.add(`section:${section.key}`);
    if (rule.sectionTag && hasTag(section.tags, rule.sectionTag)) targets.add(`section:${section.key}`);
  }
  for (const block of blocksById.values()) {
    const base = resolveBaseComponentFromMeta(block.schema.component, document.meta);
    if (rule.component && block.schema.component === rule.component) targets.add(`block:${block.id}`);
    if (rule.baseComponent && base === rule.baseComponent) targets.add(`block:${block.id}`);
    if (rule.tag && hasTag(block.schema.tags, rule.tag)) targets.add(`block:${block.id}`);
    if (rule.componentTag && hasTag(block.schema.tags, rule.componentTag)) targets.add(`block:${block.id}`);
  }
  return [...targets];
}

function applyRule(previous: HvyPdfExportDecision, rule: HvyPdfExportStrategyRule): HvyPdfExportDecision {
  const next = cloneDecision(previous);
  const visibility = getRuleVisibility(rule);
  if (visibility && (previous.visibility !== 'hide' || visibility === 'include')) next.visibility = visibility;
  const pane = getRulePane(rule);
  if (pane) next.pane = pane;
  const role = getRuleRole(rule);
  if (role) next.role = role;
  if (typeof rule.keepTogether === 'boolean') next.keepTogether = rule.keepTogether;
  if (typeof rule.keepWithNext === 'boolean') next.keepWithNext = rule.keepWithNext;
  if (typeof rule.allowSplit === 'boolean') next.allowSplit = rule.allowSplit;
  if (typeof rule.pageBreakBefore === 'boolean') next.pageBreakBefore = rule.pageBreakBefore;
  if (typeof rule.pageBreakAfter === 'boolean') next.pageBreakAfter = rule.pageBreakAfter;
  if (rule.pdfStyle) next.pdfStyle = { ...next.pdfStyle, ...rule.pdfStyle };
  if (typeof rule.adapter === 'string') next.adapter = rule.adapter;
  return next;
}

function getRuleVisibility(rule: HvyPdfExportStrategyRule): HvyPdfExportVisibility | null {
  if (rule.include) return 'include';
  if (rule.hide) return 'hide';
  if (rule.dim) return 'dim';
  if (rule.highlight) return 'highlight';
  return null;
}

function getRulePane(rule: HvyPdfExportStrategyRule): HvyPdfExportPane | null {
  if (rule.expand) return 'expand';
  if (rule.collapse) return 'collapse';
  if (rule.stubOnly) return 'stubOnly';
  if (rule.contentOnly) return 'contentOnly';
  if (rule.stubThenContent) return 'stubThenContent';
  return null;
}

function getRuleRole(rule: HvyPdfExportStrategyRule): HvyPdfExportRole | null {
  if (rule.asHeading) return 'heading';
  if (rule.asBody) return 'body';
  if (rule.asMetadata) return 'metadata';
  if (rule.asSidebar) return 'sidebar';
  return null;
}

function normalizeDefaults(document: VisualDocument, defaults: HvyPdfExportStrategyDefaults | undefined): HvyPdfExportResolvedStrategy['defaults'] {
  const pageSettings = resolvePdfPageSettings(document.meta, defaults);
  return {
    pageSize: pageSettings.pageSize,
    pageMargins: normalizePdfPageMargins(pageSettings.pageMargins),
    debugPageBounds: pageSettings.debug,
    font: defaults?.font ?? 'Roboto',
    expansionPolicy: normalizeExpansionPolicy(defaults?.expansionPolicy),
    includeSidebar: normalizeSidebarPolicy(defaults?.includeSidebar),
    unsupportedPluginPolicy: normalizeUnsupportedPluginPolicy(defaults?.unsupportedPluginPolicy),
  };
}

function normalizeExpansionPolicy(value: HvyPdfExportStrategyDefaults['expansionPolicy']): HvyPdfExportExpansionPolicy {
  return value === 'all-expanded' || value === 'authored' ? value : 'view-aware';
}

function normalizeUnsupportedPluginPolicy(value: HvyPdfExportStrategyDefaults['unsupportedPluginPolicy']): HvyPdfUnsupportedPluginPolicy {
  if (value === 'placeholder' || value === 'hide') return value;
  return 'error';
}

function normalizeSidebarPolicy(value: HvyPdfExportStrategyDefaults['includeSidebar']): HvyPdfExportSidebarPolicy {
  if (value === true) return 'include';
  if (value === false) return 'exclude';
  return value === 'include' || value === 'exclude' ? value : 'inline-after-main';
}

function cloneDecision(decision: HvyPdfExportDecision): HvyPdfExportDecision {
  return {
    ...decision,
    pdfStyle: { ...decision.pdfStyle },
  };
}

function hasTag(tags: string, tag: string): boolean {
  const target = tag.trim();
  if (!target) {
    return false;
  }
  return tags.split(/[,\s]+/).some((entry) => entry === target);
}
