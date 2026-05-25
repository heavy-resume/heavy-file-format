import { requestProxyCompletion } from '../chat/chat';
import { getReferenceAppConfig } from '../reference-config';
import { buildSemanticFilterCandidates, buildSemanticFilterWindows } from '../search/semantic-candidates';
import { runSemanticFilterWindows } from '../search/semantic-filter';
import type { HvySemanticFilterMatch } from '../search/types';
import { state } from '../state';
import type { ReaderViewFilter, VisualDocument } from '../types';
import { resolveBaseComponentFromMeta } from '../component-defs';
import { findVirtualDirectoryForBlock, findVirtualDirectoryForSection } from '../cli-core/virtual-file-system';
import type { VisualBlock, VisualSection } from '../editor/types';
import { preparePdfExport } from './export';
import { renderPdfExportPromptTemplate } from './prompt-templates';
import { mergePdfExportStrategies } from './strategy';
import type {
  CreatePdfExportPlanFromPromptOptions,
  CreatePdfExportPlanOptions,
  HvyPdfExportAllowedTarget,
  HvyPdfExportPlan,
  HvyPdfExportPlanDecision,
  HvyPdfExportPlanDiagnostic,
  HvyPdfExportStrategy,
  HvyPdfExportStrategyProvider,
  HvyPdfExportStrategyProviderResponse,
  HvyPdfExportStrategyRule,
  HvyPdfExportUnsupportedComponent,
} from './types';

const ALLOWED_EXPORT_ACTIONS = [
  'include',
  'hide',
  'dim',
  'highlight',
  'expand',
  'collapse',
  'stubOnly',
  'contentOnly',
  'stubThenContent',
  'keepTogether',
  'keepWithNext',
  'allowSplit',
  'asHeading',
  'asBody',
  'asMetadata',
  'asSidebar',
  'pageBreakBefore',
  'pageBreakAfter',
  'pdfStyle',
  'adapter',
];

const SUPPORTED_BASE_COMPONENTS = new Set([
  'text',
  'code',
  'container',
  'component-list',
  'grid',
  'expandable',
  'table',
  'image',
  'carousel',
  'xref-card',
]);

const STRATEGY_PROMPT_MAX_CANDIDATES = 80;
const STRATEGY_PROMPT_MAX_TARGETS = 260;
const STRATEGY_PROMPT_MAX_SUMMARY_CHARS = 260;
const STRATEGY_PROMPT_MAX_LABEL_CHARS = 120;

export async function createPdfExportPlan(options: CreatePdfExportPlanOptions): Promise<HvyPdfExportPlan> {
  const renderedPrompt = renderPdfExportPromptTemplate(options.document, options.templateId, options.values);
  return createPdfExportPlanFromPrompt({
    document: options.document,
    prompt: renderedPrompt,
    ...(options.currentContentView ? { currentContentView: options.currentContentView } : {}),
    ...(options.strategyProvider ? { strategyProvider: options.strategyProvider } : {}),
    ...(options.semanticFilterProvider !== undefined ? { semanticFilterProvider: options.semanticFilterProvider } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

export async function createPdfExportPlanFromPrompt(options: CreatePdfExportPlanFromPromptOptions): Promise<HvyPdfExportPlan> {
  const renderedPrompt = options.prompt.trim();
  if (!renderedPrompt) {
    throw new Error('PDF export planning prompt is required.');
  }
  const candidates = buildSemanticFilterCandidates(options.document, { maxCandidateSummaryChars: 1_200 });
  const diagnostics: HvyPdfExportPlanDiagnostic[] = [];
  const currentContentView = options.currentContentView ?? {};
  const semanticProvider = options.semanticFilterProvider ?? getReferenceAppConfig().semanticFilterProvider ?? null;
  const semanticMatches =
    Object.keys(currentContentView).length > 0 || !semanticProvider
      ? []
      : await runExportSemanticFilter(options.document, renderedPrompt, semanticProvider, options.signal);
  if (!semanticProvider && Object.keys(currentContentView).length === 0) {
    diagnostics.push({ severity: 'warning', message: 'Semantic filtering is not configured; strategy planning will use the full document candidate packet.' });
  }

  const semanticContentView = buildContentViewFromSemanticMatches(candidates, semanticMatches);
  const baseContentView = mergeReaderViewFilters(semanticContentView, currentContentView);
  const unsupportedComponents = collectUnsupportedComponents(options.document);
  const allowedTargets = collectAllowedTargets(options.document);
  const provider = options.strategyProvider ?? defaultPdfExportStrategyProvider;
  const providerResponse = await provider({
    renderedPrompt,
    documentTitle: typeof options.document.meta.title === 'string' ? options.document.meta.title : undefined,
    candidates,
    semanticMatches,
    currentContentView: baseContentView,
    unsupportedComponents,
    allowedTargets,
    allowedActions: ALLOWED_EXPORT_ACTIONS,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const normalized = normalizeStrategyProviderResponse(providerResponse);
  const contentView = mergeReaderViewFilters(baseContentView, normalized.contentView);
  const strategy = normalized.strategy;
  diagnostics.push(...validateStrategyRules(strategy.rules ?? [], allowedTargets, ALLOWED_EXPORT_ACTIONS));
  diagnostics.push(...await validatePreparedExport(options.document, contentView, strategy));
  return {
    renderedPrompt,
    contentView,
    strategy,
    diagnostics,
    decisions: normalized.decisions,
    ...(typeof strategy.prepScript === 'string' ? { prepScript: strategy.prepScript } : {}),
    previewStats: {
      contentNodeCount: diagnostics.some((entry) => entry.severity === 'error')
        ? 0
        : (await preparePdfExport(options.document, { contentView, strategy })).docDefinition.content.length,
      matchedCandidateCount: semanticMatches.length,
      unsupportedVisibleComponentCount: unsupportedComponents.length,
    },
  };
}

async function runExportSemanticFilter(
  document: VisualDocument,
  prompt: string,
  provider: NonNullable<CreatePdfExportPlanFromPromptOptions['semanticFilterProvider']>,
  signal: AbortSignal | undefined
): Promise<HvySemanticFilterMatch[]> {
  const packet = buildSemanticFilterWindows({ document, prompt, ...(signal ? { signal } : {}) });
  return runSemanticFilterWindows({
    prompt,
    provider,
    windows: packet.windows,
    documentTitle: typeof document.meta.title === 'string' ? document.meta.title : undefined,
    ...(signal ? { signal } : {}),
  });
}

async function defaultPdfExportStrategyProvider(
  request: Parameters<HvyPdfExportStrategyProvider>[0]
): Promise<HvyPdfExportStrategyProviderResponse> {
  const output = await requestProxyCompletion({
    settings: state.chat.settings,
    messages: [{
      id: 'pdf-export-plan',
      role: 'user',
      content: 'Create the PDF export strategy now.',
    }],
    context: buildStrategyProviderPrompt(request),
    responseInstructions: [
      'Return exactly one JSON object and no prose.',
      'The object may contain contentView, rules, prepScript, decisions, and notes.',
      'Use only targets from allowedTargets. Do not invent ids, paths, tags, components, or aliases.',
      'Use only allowedActions. Hide unsupported components unless the prompt explicitly needs them and an adapter exists.',
    ].join('\n'),
    mode: 'qa',
    debugLabel: 'pdf-export-plan',
    ...(request.signal ? { signal: request.signal } : {}),
  });
  return parseStrategyProviderJson(output);
}

function buildStrategyProviderPrompt(request: Parameters<HvyPdfExportStrategyProvider>[0]): string {
  const compactPacket = buildCompactStrategyProviderPromptPacket(request);
  return [
    'You are planning a PDF export for a structured HVY document.',
    '',
    'User export prompt:',
    JSON.stringify(request.renderedPrompt),
    '',
    'Allowed strategy actions:',
    JSON.stringify(request.allowedActions),
    '',
    'Planning packet:',
    JSON.stringify(compactPacket),
    '',
    'Packet notes:',
    '- candidates are compact summaries; use ids, paths, components, baseComponents, and tags exactly as provided.',
    '- allowedTargets may be truncated for prompt size, but unsupported components and matched/current-view targets are prioritized.',
    '- Prefer broad stable rules such as component, baseComponent, tag, sectionTag, or componentTag when appropriate.',
  ].join('\n');
}

function buildCompactStrategyProviderPromptPacket(request: Parameters<HvyPdfExportStrategyProvider>[0]): Record<string, unknown> {
  const targetPriorityIds = new Set<string>();
  const targetPriorityPaths = new Set<string>();
  for (const unsupported of request.unsupportedComponents) {
    targetPriorityIds.add(unsupported.id);
    if (unsupported.path) targetPriorityPaths.add(unsupported.path);
  }
  for (const target of Object.keys(request.currentContentView)) {
    targetPriorityIds.add(target);
    targetPriorityPaths.add(target);
  }
  const matchedCandidateIds = new Set(request.semanticMatches.map((match) => match.candidateId));
  for (const candidate of request.candidates) {
    if (matchedCandidateIds.has(candidate.candidateId)) {
      targetPriorityIds.add(candidate.targetId);
      if (candidate.targetRef) targetPriorityIds.add(candidate.targetRef);
      if (candidate.targetPath) targetPriorityPaths.add(candidate.targetPath);
    }
  }
  const prioritizedTargets = request.allowedTargets.filter((target) =>
    targetPriorityIds.has(target.id) || (target.path ? targetPriorityPaths.has(target.path) : false)
  );
  const remainingTargets = request.allowedTargets.filter((target) => !prioritizedTargets.includes(target));
  const allowedTargets = [...prioritizedTargets, ...remainingTargets]
    .slice(0, STRATEGY_PROMPT_MAX_TARGETS)
    .map(compactAllowedTarget);
  const matchedCandidates = request.candidates
    .filter((candidate) => matchedCandidateIds.has(candidate.candidateId))
    .sort((left, right) => left.documentOrder - right.documentOrder);
  const fallbackCandidates = request.candidates
    .filter((candidate) => !matchedCandidateIds.has(candidate.candidateId))
    .sort((left, right) => left.documentOrder - right.documentOrder);
  const candidates = [...matchedCandidates, ...fallbackCandidates]
    .slice(0, STRATEGY_PROMPT_MAX_CANDIDATES)
    .map(compactSemanticCandidate);
  return {
    documentTitle: request.documentTitle,
    currentContentView: request.currentContentView,
    semanticMatches: request.semanticMatches.map((match) => ({
      candidateId: match.candidateId,
      ...(typeof match.score === 'number' ? { score: match.score } : {}),
      ...(match.reason ? { reason: truncatePromptText(match.reason, STRATEGY_PROMPT_MAX_SUMMARY_CHARS) } : {}),
    })),
    unsupportedComponents: request.unsupportedComponents.map((component) => ({
      id: component.id,
      component: component.component,
      baseComponent: component.baseComponent,
      ...(component.path ? { path: component.path } : {}),
      label: truncatePromptText(component.label, STRATEGY_PROMPT_MAX_LABEL_CHARS),
    })),
    allowedTargets,
    candidates,
    counts: {
      totalAllowedTargets: request.allowedTargets.length,
      includedAllowedTargets: allowedTargets.length,
      totalCandidates: request.candidates.length,
      includedCandidates: candidates.length,
      semanticMatches: request.semanticMatches.length,
      unsupportedComponents: request.unsupportedComponents.length,
    },
  };
}

function compactAllowedTarget(target: HvyPdfExportAllowedTarget): Record<string, unknown> {
  return {
    kind: target.kind,
    id: target.id,
    ...(target.path ? { path: target.path } : {}),
    ...(target.component ? { component: target.component } : {}),
    ...(target.baseComponent ? { baseComponent: target.baseComponent } : {}),
    ...(target.tags.length ? { tags: target.tags.slice(0, 8) } : {}),
    label: truncatePromptText(target.label, STRATEGY_PROMPT_MAX_LABEL_CHARS),
  };
}

function compactSemanticCandidate(candidate: ReturnType<typeof buildSemanticFilterCandidates>[number]): Record<string, unknown> {
  return {
    candidateId: candidate.candidateId,
    targetKind: candidate.targetKind,
    targetId: candidate.targetId,
    ...(candidate.targetRef ? { targetRef: candidate.targetRef } : {}),
    ...(candidate.targetPath ? { targetPath: candidate.targetPath } : {}),
    label: truncatePromptText(candidate.label, STRATEGY_PROMPT_MAX_LABEL_CHARS),
    ...(candidate.contextLabel ? { contextLabel: truncatePromptText(candidate.contextLabel, STRATEGY_PROMPT_MAX_LABEL_CHARS) } : {}),
    ...(candidate.tags.length ? { tags: candidate.tags.slice(0, 8) } : {}),
    ...(candidate.description ? { description: truncatePromptText(candidate.description, STRATEGY_PROMPT_MAX_SUMMARY_CHARS) } : {}),
    summary: truncatePromptText(candidate.summary, STRATEGY_PROMPT_MAX_SUMMARY_CHARS),
    documentOrder: candidate.documentOrder,
    truncated: candidate.truncated,
  };
}

function truncatePromptText(value: string, maxChars: number): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length <= maxChars ? trimmed : `${trimmed.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function parseStrategyProviderJson(output: string): HvyPdfExportStrategyProviderResponse {
  const trimmed = output.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('PDF export strategy provider must return a JSON object.');
  }
  return parsed as HvyPdfExportStrategyProviderResponse;
}

function normalizeStrategyProviderResponse(response: HvyPdfExportStrategyProviderResponse): {
  contentView: ReaderViewFilter;
  strategy: HvyPdfExportStrategy;
  decisions: HvyPdfExportPlanDecision[];
} {
  const strategy = mergePdfExportStrategies(response.strategy, {
    ...(Array.isArray(response.rules) ? { rules: response.rules } : {}),
    ...(typeof response.prepScript === 'string' && response.prepScript.trim() ? { prepScript: response.prepScript } : {}),
  });
  return {
    contentView: normalizeContentView(response.contentView),
    strategy,
    decisions: Array.isArray(response.decisions) ? response.decisions.map(normalizeDecision).filter(Boolean) as HvyPdfExportPlanDecision[] : [],
  };
}

function normalizeContentView(value: unknown): ReaderViewFilter {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const allowed = new Set(['highlight', 'priority', 'collapse', 'dimmed', 'hidden']);
  const next: ReaderViewFilter = {};
  for (const [target, modifiers] of Object.entries(value as ReaderViewFilter)) {
    if (!Array.isArray(modifiers)) continue;
    const clean = modifiers.filter((modifier) => allowed.has(modifier));
    if (target.trim() && clean.length) {
      next[target.trim()] = clean;
    }
  }
  return next;
}

function normalizeDecision(value: unknown): HvyPdfExportPlanDecision | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const source = value as Record<string, unknown>;
  const target = typeof source.target === 'string' ? source.target.trim() : '';
  const action = typeof source.action === 'string' ? source.action.trim() : '';
  const reason = typeof source.reason === 'string' ? source.reason.trim() : '';
  if (!target || !action) {
    return null;
  }
  return {
    target,
    action,
    reason,
    ...(typeof source.confidence === 'number' && Number.isFinite(source.confidence) ? { confidence: source.confidence } : {}),
  };
}

function buildContentViewFromSemanticMatches(
  candidates: ReturnType<typeof buildSemanticFilterCandidates>,
  matches: HvySemanticFilterMatch[]
): ReaderViewFilter {
  const candidatesById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const view: ReaderViewFilter = {};
  for (const match of matches) {
    const candidate = candidatesById.get(match.candidateId);
    const target = candidate?.targetPath || candidate?.targetRef || candidate?.targetId;
    if (target) {
      view[target] = ['priority', 'highlight'];
    }
  }
  return view;
}

function mergeReaderViewFilters(base: ReaderViewFilter, overlay: ReaderViewFilter): ReaderViewFilter {
  const next: ReaderViewFilter = { ...base };
  for (const [target, modifiers] of Object.entries(overlay)) {
    next[target] = modifiers;
  }
  return next;
}

function validateStrategyRules(
  rules: HvyPdfExportStrategyRule[],
  allowedTargets: HvyPdfExportAllowedTarget[],
  allowedActions: string[]
): HvyPdfExportPlanDiagnostic[] {
  const diagnostics: HvyPdfExportPlanDiagnostic[] = [];
  const ids = new Set(allowedTargets.map((target) => target.id).filter(Boolean));
  const paths = new Set(allowedTargets.map((target) => target.path).filter((value): value is string => !!value));
  const components = new Set(allowedTargets.map((target) => target.component).filter((value): value is string => !!value));
  const baseComponents = new Set(allowedTargets.map((target) => target.baseComponent).filter((value): value is string => !!value));
  const tags = new Set(allowedTargets.flatMap((target) => target.tags));
  const allowedActionSet = new Set(allowedActions);
  const targetKeys = new Set(['id', 'path', 'component', 'baseComponent', 'tag', 'sectionTag', 'componentTag', 'predicate']);
  rules.forEach((rule, index) => {
    if (rule.predicate) {
      diagnostics.push({ severity: 'error', message: `PDF export rule ${index + 1} uses predicate; AI-generated predicates are not allowed.` });
      return;
    }
    for (const key of Object.keys(rule)) {
      if (!targetKeys.has(key) && !allowedActionSet.has(key)) {
        diagnostics.push({ severity: 'error', message: `PDF export rule ${index + 1} uses unsupported action or field: ${key}` });
      }
    }
    const targetCount = ['id', 'path', 'component', 'baseComponent', 'tag', 'sectionTag', 'componentTag']
      .filter((key) => typeof (rule as Record<string, unknown>)[key] === 'string' && String((rule as Record<string, unknown>)[key]).trim()).length;
    if (targetCount === 0) {
      diagnostics.push({ severity: 'error', message: `PDF export rule ${index + 1} has no target.` });
      return;
    }
    if (rule.id && !ids.has(rule.id)) diagnostics.push({ severity: 'error', message: `Unknown PDF export target id: ${rule.id}`, target: rule.id });
    if (rule.path && !paths.has(rule.path)) diagnostics.push({ severity: 'error', message: `Unknown PDF export target path: ${rule.path}`, target: rule.path });
    if (rule.component && !components.has(rule.component)) diagnostics.push({ severity: 'error', message: `Unknown PDF export component target: ${rule.component}`, target: rule.component });
    if (rule.baseComponent && !baseComponents.has(rule.baseComponent)) diagnostics.push({ severity: 'error', message: `Unknown PDF export base component target: ${rule.baseComponent}`, target: rule.baseComponent });
    if (rule.tag && !tags.has(rule.tag)) diagnostics.push({ severity: 'error', message: `Unknown PDF export tag target: ${rule.tag}`, target: rule.tag });
    if (rule.sectionTag && !tags.has(rule.sectionTag)) diagnostics.push({ severity: 'error', message: `Unknown PDF export section tag target: ${rule.sectionTag}`, target: rule.sectionTag });
    if (rule.componentTag && !tags.has(rule.componentTag)) diagnostics.push({ severity: 'error', message: `Unknown PDF export component tag target: ${rule.componentTag}`, target: rule.componentTag });
  });
  return diagnostics;
}

async function validatePreparedExport(
  document: VisualDocument,
  contentView: ReaderViewFilter,
  strategy: HvyPdfExportStrategy
): Promise<HvyPdfExportPlanDiagnostic[]> {
  try {
    const result = await preparePdfExport(document, { contentView, strategy });
    const serialized = JSON.stringify(result.docDefinition.content);
    const diagnostics: HvyPdfExportPlanDiagnostic[] = [];
    if (serialized.includes('<!--hvy') || serialized.includes('<!-- value')) {
      diagnostics.push({ severity: 'error', message: 'PDF export output contains raw HVY markers.' });
    }
    if (result.docDefinition.content.length === 0) {
      diagnostics.push({ severity: 'error', message: 'PDF export output is empty.' });
    }
    return diagnostics;
  } catch (error) {
    return [{ severity: 'error', message: error instanceof Error ? error.message : 'PDF export validation failed.' }];
  }
}

function collectAllowedTargets(document: VisualDocument): HvyPdfExportAllowedTarget[] {
  const targets: HvyPdfExportAllowedTarget[] = [];
  const visitBlocks = (blocks: VisualBlock[]): void => {
    for (const block of blocks) {
      const baseComponent = resolveBaseComponentFromMeta(block.schema.component, document.meta);
      targets.push({
        kind: 'component',
        id: block.schema.id || block.id,
        ...(findVirtualDirectoryForBlock(document, block) ? { path: findVirtualDirectoryForBlock(document, block) ?? undefined } : {}),
        component: block.schema.component,
        baseComponent,
        tags: splitTags(block.schema.tags),
        label: block.schema.description || block.schema.id || block.schema.component,
      });
      visitBlocks(block.schema.containerBlocks ?? []);
      visitBlocks(block.schema.componentListBlocks ?? []);
      visitBlocks((block.schema.gridItems ?? []).map((item) => item.block));
      visitBlocks(block.schema.expandableStubBlocks?.children ?? []);
      visitBlocks(block.schema.expandableContentBlocks?.children ?? []);
    }
  };
  const visitSection = (section: VisualSection): void => {
    targets.push({
      kind: 'section',
      id: section.customId || section.key,
      ...(findVirtualDirectoryForSection(document, section) ? { path: findVirtualDirectoryForSection(document, section) ?? undefined } : {}),
      tags: splitTags(section.tags),
      label: section.title || section.customId || section.key,
    });
    visitBlocks(section.blocks);
    section.children.forEach(visitSection);
  };
  document.sections.forEach(visitSection);
  return targets;
}

function collectUnsupportedComponents(document: VisualDocument): HvyPdfExportUnsupportedComponent[] {
  const unsupported: HvyPdfExportUnsupportedComponent[] = [];
  const visit = (blocks: VisualBlock[]): void => {
    for (const block of blocks) {
      const baseComponent = resolveBaseComponentFromMeta(block.schema.component, document.meta);
      if (!SUPPORTED_BASE_COMPONENTS.has(baseComponent) && !block.schema.editorOnly) {
        unsupported.push({
          id: block.schema.id || block.id,
          component: block.schema.component,
          baseComponent,
          ...(findVirtualDirectoryForBlock(document, block) ? { path: findVirtualDirectoryForBlock(document, block) ?? undefined } : {}),
          label: block.schema.description || block.schema.plugin || block.schema.component,
        });
      }
      visit(block.schema.containerBlocks ?? []);
      visit(block.schema.componentListBlocks ?? []);
      visit((block.schema.gridItems ?? []).map((item) => item.block));
      visit(block.schema.expandableStubBlocks?.children ?? []);
      visit(block.schema.expandableContentBlocks?.children ?? []);
    }
  };
  const visitSection = (section: VisualSection): void => {
    visit(section.blocks);
    section.children.forEach(visitSection);
  };
  document.sections.forEach(visitSection);
  return unsupported;
}

function splitTags(tags: string): string[] {
  return tags.split(/[,\s]+/).map((tag) => tag.trim()).filter(Boolean);
}
