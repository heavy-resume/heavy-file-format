import { requestProxyCompletion, type HostChatClient } from './chat/chat';
import { deserializeDocumentWithDiagnostics, serializeBlockFragment, serializeDocumentHeaderYaml, serializeSectionFragment } from './serialization';
import type { VisualBlock, VisualSection } from './editor/types';
import { cloneReusableBlock, cloneReusableSection, cloneReusableSchema, defaultBlockSchema } from './document-factory';
import { findSectionContainer, formatSectionTitle, getSectionId, visitBlocks } from './section-ops';
import type { ChatSettings, ComponentDefinition, SectionDefinition, VisualDocument } from './types';
import { isAbortError, throwIfAborted } from './ai-document-loop-state';
import { resolveBaseComponentFromMeta } from './component-defs';
import importHvyFormatReference from './ai-import-hvy-format-reference.hvy?raw';
import { getTextLineStyleLabel, getTextLineStylesFromMeta } from './text-line-styles';
import { getDocumentAiContext, getDocumentAiImportGuidance } from './document-ai-context';
import {
  applyReusableSectionTemplateValues,
  applyReusableTemplateValues,
  extractReusableTemplateVariables,
  extractReusableTemplateVariablesFromDefinition,
  extractReusableTemplateVariablesFromSectionDefinition,
  type ReusableTemplateVariable,
} from './reusable-template-values';

export type HvyImportProgressPhase = 'starting' | 'thinking' | 'linting' | 'complete';
type HvyLlmCallPhase = HvyImportProgressPhase | 'tool_call';

export interface HvyImportProgressEvent {
  phase: HvyImportProgressPhase;
  message?: string;
}

export interface HvyImportLlmOptions {
  settings: ChatSettings;
  client?: HostChatClient | null;
}

export interface HvyImportLlmStepEvent {
  callIndex: number;
  debugLabel: string;
  phase: HvyLlmCallPhase;
}

export interface BuildImportPlanOptions {
  sourceName: string;
  sourceText: string;
  instructions?: string;
  llm?: HvyImportLlmOptions;
  beforeLlmCall?: (event: HvyImportLlmStepEvent) => Promise<void> | void;
  onProgress?: (event: HvyImportProgressEvent) => void;
  signal?: AbortSignal;
}

export interface BuildImportPlanResult {
  status: 'ready' | 'aborted' | 'error';
  steps?: ImportPlanStep[];
  message?: string;
}

export type ImportPlanTargetKind = 'body' | 'definition' | 'blank';

export interface ImportPlanTarget {
  kind: ImportPlanTargetKind;
  id?: string;
  title?: string;
  name?: string;
}

export interface ImportPlanStep {
  sectionTitle: string;
  instruction: string;
  target: ImportPlanTarget;
  importMode?: 'template' | 'hvy';
  templateStructureId?: string;
  templateStructure?: ImportTemplateStructureDescriptor;
}

export interface ImportTemplateStructureDescriptor {
  id: string;
  label: string;
  target: ImportPlanTarget;
  jsonSchema: ImportTemplateJsonSchema;
}

export interface ImportTemplateJsonSchema {
  type: 'object';
  properties: Record<string, ImportTemplateJsonSchemaProperty>;
  required: string[];
  additionalProperties: false;
}

export type ImportTemplateJsonSchemaProperty =
  | { type: 'string'; title: string; description?: string }
  | { type: 'array'; title: string; items: ImportTemplateJsonSchema; description?: string };

type ImportTemplateScalarSchemaProperty = Extract<ImportTemplateJsonSchemaProperty, { type: 'string' }>;

type ImportTemplateStructureInternal = ImportTemplateStructureDescriptor & {
  sectionVariables: ReusableTemplateVariable[];
  lists: ImportTemplateListStructure[];
};

type ImportTemplateListStructure = {
  key: string;
  title: string;
  listBlockId: string;
  itemComponent: string;
  variables: ReusableTemplateVariable[];
  itemTemplate: VisualBlock;
  jsonSchema: ImportTemplateJsonSchema;
};

export interface PlannedImportXrefTarget {
  id: string;
  title: string;
  kind?: string;
  description: string;
}

export type ImportPlanStepInput = string | ImportPlanStep | {
  sectionTitle?: string;
  section?: string;
  title?: string;
  instruction?: string;
  step?: string;
  sectionId?: string;
  bodyId?: string;
  templateName?: string;
  definitionName?: string;
  importMode?: string;
  templateStructureId?: string;
  target?: ImportPlanTarget;
};

export interface ImportFromTextOptions {
  sourceName: string;
  sourceText: string;
  instructions?: string;
  steps: ImportPlanStepInput[];
  llm?: HvyImportLlmOptions;
  beforeLlmCall?: (event: HvyImportLlmStepEvent) => Promise<void> | void;
  onProgress?: (event: HvyImportProgressEvent) => void;
  signal?: AbortSignal;
}

export interface ImportFromTextResult {
  status: 'complete' | 'aborted' | 'error';
  message?: string;
}

export async function buildImportPlanForDocument(
  document: VisualDocument,
  options: BuildImportPlanOptions
): Promise<BuildImportPlanResult> {
  options.onProgress?.({ phase: 'starting', message: `Preparing import plan for ${options.sourceName}.` });
  try {
    const llm = requireImportLlm(options.llm);
    throwIfAborted(options.signal);
    options.onProgress?.({ phase: 'thinking', message: 'Reviewing the template and imported document.' });
    const beforeLlmCall = createImportLlmStepper(options.beforeLlmCall, options.signal)?.('thinking');
    const response = await requestProxyCompletion({
      settings: llm.settings,
      client: llm.client,
      messages: [
        {
          id: crypto.randomUUID(),
          role: 'user',
          content: buildImportPlanPrompt(options.sourceName, options.instructions),
        },
      ],
      context: buildImportPlanContext(document, options.sourceName, options.sourceText),
      responseInstructions: buildImportPlanResponseInstructions(),
      mode: 'document-edit',
      debugLabel: 'ai-import-plan',
      beforeRequest: beforeLlmCall,
      signal: options.signal,
    });
    throwIfAborted(options.signal);
    const steps = parseImportPlanSteps(response, document);
    if (steps.length === 0) {
      return { status: 'error', message: 'The import planner did not return a usable plan.' };
    }
    options.onProgress?.({ phase: 'complete', message: 'Import plan is ready.' });
    return { status: 'ready', steps };
  } catch (error) {
    if (isAbortError(error)) {
      return { status: 'aborted', message: 'Import planning was aborted.' };
    }
    return { status: 'error', message: error instanceof Error ? error.message : 'Import planning failed.' };
  }
}

export async function importTextIntoDocument(
  document: VisualDocument,
  options: ImportFromTextOptions & {
    onMutation?: (group?: string) => void;
    onSectionApplied?: (result: string) => Promise<void> | void;
  }
): Promise<ImportFromTextResult> {
  const steps = normalizeImportPlanSteps(options.steps, document);
  if (steps.length === 0) {
    return { status: 'error', message: 'Import requires at least one approved plan step.' };
  }
  options.onProgress?.({ phase: 'starting', message: `Importing ${options.sourceName}.` });
  try {
    const llm = requireImportLlm(options.llm);
    const beforeLlmCall = createImportLlmStepper(options.beforeLlmCall, options.signal);
    throwIfAborted(options.signal);
    for (const step of steps) {
      resolveImportStepApplication(document, step);
    }
    options.onProgress?.({ phase: 'thinking', message: 'Identifying planned xref targets.' });
    const xrefResponse = await requestProxyCompletion({
      settings: llm.settings,
      client: llm.client,
      messages: [
        {
          id: crypto.randomUUID(),
          role: 'user',
          content: buildImportXrefTargetPrompt(options.sourceName, options.instructions),
        },
      ],
      context: buildImportXrefTargetContext(document, options.sourceName, options.sourceText, steps),
      responseInstructions: buildImportXrefTargetResponseInstructions(),
      mode: 'document-edit',
      debugLabel: 'ai-import-xref-targets',
      beforeRequest: beforeLlmCall?.('thinking'),
      signal: options.signal,
    });
    throwIfAborted(options.signal);
    const plannedXrefTargets = parseImportXrefTargetResponse(xrefResponse);
    if (!plannedXrefTargets) {
      return { status: 'error', message: 'Import did not return a usable planned xref target inventory.' };
    }
    const created: string[] = [];
    for (const [index, step] of steps.entries()) {
      const application = resolveImportStepApplication(document, step);
      throwIfAborted(options.signal);
      if (step.importMode === 'template') {
        const templateStructure = resolveImportTemplateStructureForStep(document, step);
        if (!templateStructure) {
          return { status: 'error', message: `Import section ${index + 1} does not have a usable template structure.` };
        }
        options.onProgress?.({ phase: 'thinking', message: `Filling template section ${index + 1} of ${steps.length}.` });
        const valuesResponse = await requestProxyCompletion({
          settings: llm.settings,
          client: llm.client,
          messages: [
            {
              id: crypto.randomUUID(),
              role: 'user',
              content: buildImportTemplateValuesPrompt(options.sourceName, options.instructions, step, index, steps.length),
            },
          ],
          context: buildImportTemplateValuesContext(document, options.sourceName, options.sourceText, steps, index, created, application, plannedXrefTargets, templateStructure),
          responseInstructions: buildImportTemplateValuesResponseInstructions(templateStructure),
          mode: 'document-edit',
          debugLabel: `ai-import-template-values:${index + 1}`,
          beforeRequest: beforeLlmCall?.('thinking'),
          signal: options.signal,
        });
        throwIfAborted(options.signal);
        const values = parseImportTemplateValuesResponse(valuesResponse, templateStructure);
        if (values.ok === false) {
          return { status: 'error', message: `Import section ${index + 1} returned invalid template values. ${values.message}` };
        }
        options.onProgress?.({ phase: 'thinking', message: `Applying section ${index + 1}.` });
        const result = applyGeneratedImportTemplateSection(document, application, templateStructure, values.value, options.onMutation);
        created.push(result);
        await options.onSectionApplied?.(result);
        continue;
      }
      options.onProgress?.({ phase: 'thinking', message: `Extracting section data ${index + 1} of ${steps.length}.` });
      const informationResponse = await requestProxyCompletion({
        settings: llm.settings,
        client: llm.client,
        messages: [
          {
            id: crypto.randomUUID(),
            role: 'user',
            content: buildImportSectionInformationPrompt(options.sourceName, options.instructions, step, index, steps.length),
          },
        ],
        context: buildImportSectionInformationContext(document, options.sourceName, options.sourceText, steps, index, created, application, plannedXrefTargets),
        responseInstructions: buildImportSectionInformationResponseInstructions(),
        mode: 'document-edit',
        debugLabel: `ai-import-section-data:${index + 1}`,
        beforeRequest: beforeLlmCall?.('thinking'),
        signal: options.signal,
      });
      throwIfAborted(options.signal);
      const information = parseImportSectionInformationResponse(informationResponse);
      if (!information) {
        return { status: 'error', message: `Import section ${index + 1} did not return usable section information.` };
      }
      options.onProgress?.({ phase: 'thinking', message: `Generating HVY section ${index + 1} of ${steps.length}.` });
      const hvyResponse = await requestProxyCompletion({
        settings: llm.settings,
        client: llm.client,
        messages: [
          {
            id: crypto.randomUUID(),
            role: 'user',
            content: buildImportSectionHvyPrompt(options.sourceName, options.instructions, step, index, steps.length),
          },
        ],
        context: buildImportSectionHvyContext(document, information, application, plannedXrefTargets),
        responseInstructions: buildImportSectionHvyResponseInstructions(),
        mode: 'document-edit',
        debugLabel: `ai-import-section-hvy:${index + 1}`,
        beforeRequest: beforeLlmCall?.('thinking'),
        signal: options.signal,
      });
      throwIfAborted(options.signal);
      const hvy = parseImportSectionHvyResponse(hvyResponse);
      if (!hvy) {
        return { status: 'error', message: `Import section ${index + 1} did not return a usable HVY section.` };
      }
      options.onProgress?.({ phase: 'thinking', message: `Applying section ${index + 1}.` });
      const result = applyGeneratedImportSection(document, application, hvy, options.onMutation);
      created.push(result);
      await options.onSectionApplied?.(result);
    }
    options.onProgress?.({ phase: 'complete', message: `Imported ${created.length} section${created.length === 1 ? '' : 's'}.` });
    return { status: 'complete', message: `Imported ${created.length} section${created.length === 1 ? '' : 's'}.` };
  } catch (error) {
    if (isAbortError(error)) {
      return { status: 'aborted', message: 'Import was aborted.' };
    }
    return { status: 'error', message: error instanceof Error ? error.message : 'Import failed.' };
  }
}

function buildImportPlanPrompt(sourceName: string, instructions?: string): string {
  return [
    `Find the sections needed to create a document from "${sourceName}".`,
    '',
    'You have the current HVY template section outline and the imported source document in context. Do not use tools. Do not mutate anything.',
    'Treat the current document primarily as a starting template/scaffold for a new document.',
    'The template section list is a target inventory, not an ordering requirement. Existing body sections are replaced in place during execution.',
    'Plan section-sized work only. Each approved step will later generate one complete raw HVY section in one shot.',
    'Use one step per final document section. Do not make separate component-level steps and do not bundle multiple sections into one step.',
    'Each step must explicitly identify the matching existing body section by sectionId, the matching reusable template by templateName, or omit both when no listed section fits.',
    'Each step should name the final section. Keep the plan short.',
    'Do not copy specific source facts into the plan. Names, dates, entity names, labels, links, bullets, metrics, and other exact facts will be extracted in a later step.',
    'Decide from the imported source text whether each section exists. If the source contains a distinct section, create a concrete step for it. If it does not, omit that section entirely.',
    'Do not write conditional, optional, fallback, verification, or leave-unchanged steps.',
    'Use only facts present in the imported source text.',
    'Preserve exact source data without alteration.',
    instructions?.trim() ? ['Additional import instructions:', instructions.trim()].join('\n') : '',
  ].filter(Boolean).join('\n');
}

function buildImportPlanContext(document: VisualDocument, sourceName: string, sourceText: string): string {
  return [
    buildImportGuidanceFrame(document),
    '',
    '=== BEGIN TEMPLATE SECTIONS ===',
    'Template section inventory for resolving section targets; this is not an ordering requirement:',
    buildImportTemplateSectionOutline(document),
    '=== END TEMPLATE SECTIONS ===',
    '',
    '=== BEGIN SOURCE DOCUMENT ===',
    `Source name: ${sourceName}`,
    '```text',
    sourceText,
    '```',
    '=== END SOURCE DOCUMENT ===',
  ].join('\n');
}

function buildImportTemplateSectionOutline(document: VisualDocument): string {
  const lines: string[] = [];
  const appendSections = (sections: VisualDocument['sections'], depth: number): void => {
    for (const section of sections) {
      const title = trimImportString(section.title) || trimImportString(section.customId) || 'Untitled section';
      const id = trimImportString(section.customId);
      const details = [
        id ? `id: ${id}` : '',
        section.location !== 'main' ? `location: ${section.location}` : '',
        section.hideIfUnmodified ? 'template scaffold' : '',
      ].filter(Boolean);
      lines.push(`${'  '.repeat(depth)}- body: ${title}${details.length > 0 ? ` (${details.join(', ')})` : ''}`);
      appendSections(section.children, depth + 1);
    }
  };
  appendSections(document.sections, 0);
  for (const definition of getImportSectionDefinitions(document)) {
    const template = definition.template;
    const templateId = trimImportString(template.customId);
    const definitionName = trimImportString(definition.name);
    const title = definitionName || trimImportString(template.title) || templateId || 'Untitled section';
    const details = [
      templateId ? `id: ${templateId}` : '',
      definitionName ? `name: ${definitionName}` : '',
      template.location !== 'main' ? `location: ${template.location}` : '',
    ].filter(Boolean);
    lines.push(`- definition: ${title}${details.length > 0 ? ` (${details.join(', ')})` : ''}`);
    const childSections = template.children;
    for (const child of childSections) {
      const childId = trimImportString(child.customId);
      const childTitle = trimImportString(child.title) || childId || 'Untitled section';
      lines.push(`  - definition child: ${childTitle}${childId ? ` (id: ${childId})` : ''}`);
    }
  }
  return lines.length > 0 ? lines.join('\n') : '- No template sections';
}

function trimImportString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function getImportSectionDefinitions(document: VisualDocument): SectionDefinition[] {
  const definitions = document.meta.section_defs;
  return Array.isArray(definitions)
    ? definitions.filter((item): item is SectionDefinition => !!item && typeof item === 'object' && 'name' in item && 'template' in item)
    : [];
}

function buildImportPlanResponseInstructions(): string {
  return [
    'Return exactly one JSON object and no prose.',
    'Shape:',
    '{"steps":[{"section":"Blip Overview","sectionId":"blip-overview"},{"section":"Widget Records","templateName":"Widget Records"},{"section":"Extra Notes"}]}',
    '',
    'Use `sectionId` only for an existing body section id from the template section outline.',
    'Use `templateName` only for a reusable/template section name from the template section outline.',
    'When no listed section fits, include only `section` so execution creates a new blank section.',
    'Each step should be a section to create from the source document. Try to fit data to the template and only add sections if needed. Things outside the intent of the source document can be discarded.',
    'Do not include `instruction` unless a section title alone would be ambiguous.',
    'If `instruction` is needed, keep it structural and very short. Do not list exact facts.',
    'Do not copy specific source facts into the plan; do not include names, dates, entity names, labels, links, bullets, metrics, or other exact source details.',
    'Every step must be unconditional and source-backed. The planner must make the section decision now from the imported source document.',
    'Do not include steps containing conditional language such as "if", "only if", "otherwise", "as needed", "when needed", "if present", "if available", "if applicable", "unless", "may", "might", or "leave unmodified".',
    'Do not impose a step count limit. Use as many steps as needed so each final document section has its own step.',
    'Do not write bundled steps such as "add Alpha, Beta, Gamma, and Delta sections"; split that into one step per section.',
    'Do not include component-level steps such as "add each item card"; those details belong inside the later one-shot HVY section generation.',
  ].join('\n');
}

function parseImportPlanSteps(response: string, document: VisualDocument): ImportPlanStep[] {
  const trimmed = response.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]?.trim();
  const jsonText = fenced ?? trimmed;
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return [];
    }
    const maybePlan = parsed as { steps?: unknown; tool?: unknown };
    if (maybePlan.tool !== undefined && maybePlan.tool !== 'plan') {
      return [];
    }
    return normalizeImportPlanSteps(Array.isArray(maybePlan.steps) ? maybePlan.steps : [], document);
  } catch {
    return [];
  }
}

function isConditionalImportPlanStep(step: string): boolean {
  return /\b(?:if|otherwise|unless|may|might)\b|\bonly\s+if\b|\bas\s+needed\b|\bwhen\s+needed\b|\bif\s+(?:present|available|applicable|needed)\b|\bleave\s+(?:the\s+)?(?:template'?s\s+)?[\s\S]{0,80}\bunmodified\b/i.test(step);
}

function normalizeImportPlanSteps(steps: ImportPlanStepInput[], document: VisualDocument): ImportPlanStep[] {
  const candidates = getImportTemplateSectionCandidates(document);
  const normalized: ImportPlanStep[] = [];
  for (const rawStep of steps) {
    const step = normalizeImportPlanStep(rawStep, candidates);
    if (!step || isConditionalImportPlanStep(formatImportPlanStep(step))) {
      return [];
    }
    normalized.push(step);
  }
  return normalized;
}

function normalizeImportPlanStep(rawStep: ImportPlanStepInput | unknown, candidates: ImportTemplateSectionCandidate[]): ImportPlanStep | null {
  if (typeof rawStep === 'string') {
    const text = rawStep.trim();
    if (!text) {
      return null;
    }
    const fallback = selectBestImportCandidate(candidates, text);
    const sectionTitle = fallback?.title ?? inferImportSectionTitleFromStep(text);
    const target = fallback ? candidateToImportPlanTarget(fallback) : { kind: 'blank' as const, title: sectionTitle };
    const templateStructure = buildImportTemplateStructureDescriptor(candidates, target);
    return {
      sectionTitle,
      instruction: looksLikeImportInstruction(text) ? text : buildDefaultImportPlanInstruction(sectionTitle),
      target,
      ...(templateStructure ? { templateStructure: toPublicImportTemplateStructure(templateStructure) } : {}),
    };
  }
  if (!rawStep || typeof rawStep !== 'object') {
    return null;
  }
  const value = rawStep as {
    sectionTitle?: unknown;
    section?: unknown;
    title?: unknown;
    instruction?: unknown;
    target?: unknown;
    step?: unknown;
    sectionId?: unknown;
    bodyId?: unknown;
    templateName?: unknown;
    definitionName?: unknown;
    importMode?: unknown;
    templateStructureId?: unknown;
  };
  const explicitSectionTitle = typeof value.sectionTitle === 'string' && value.sectionTitle.trim()
    ? value.sectionTitle.trim()
    : typeof value.section === 'string' && value.section.trim()
      ? value.section.trim()
      : typeof value.title === 'string' && value.title.trim()
        ? value.title.trim()
        : '';
  const instruction = typeof value.instruction === 'string'
    ? value.instruction.trim()
    : typeof value.step === 'string'
      ? value.step.trim()
      : '';
  const target = normalizeImportPlanTarget(
    buildImportPlanTargetFromStepShorthand(value) ?? value.target,
    candidates,
    instruction || explicitSectionTitle
  );
  const sectionTitle = explicitSectionTitle || target.title?.trim() || inferImportSectionTitleFromStep(instruction);
  if (!sectionTitle) {
    return null;
  }
  const templateStructure = buildImportTemplateStructureDescriptor(candidates, target);
  const templateStructureId = typeof value.templateStructureId === 'string' && value.templateStructureId.trim()
    ? value.templateStructureId.trim()
    : undefined;
  const importMode = value.importMode === 'template'
    ? 'template'
    : value.importMode === 'hvy'
      ? 'hvy'
      : undefined;
  return {
    sectionTitle,
    instruction: instruction || buildDefaultImportPlanInstruction(sectionTitle),
    target,
    ...(importMode ? { importMode } : {}),
    ...(templateStructureId ? { templateStructureId } : {}),
    ...(templateStructure ? { templateStructure: toPublicImportTemplateStructure(templateStructure) } : {}),
  };
}

function buildImportPlanTargetFromStepShorthand(value: {
  sectionId?: unknown;
  bodyId?: unknown;
  templateName?: unknown;
  definitionName?: unknown;
  title?: unknown;
  section?: unknown;
  sectionTitle?: unknown;
}): ImportPlanTarget | null {
  const sectionId = typeof value.sectionId === 'string' && value.sectionId.trim()
    ? value.sectionId.trim()
    : typeof value.bodyId === 'string' && value.bodyId.trim()
      ? value.bodyId.trim()
      : '';
  if (sectionId) {
    return { kind: 'body', id: sectionId };
  }
  const templateName = typeof value.templateName === 'string' && value.templateName.trim()
    ? value.templateName.trim()
    : typeof value.definitionName === 'string' && value.definitionName.trim()
      ? value.definitionName.trim()
      : '';
  if (templateName) {
    return { kind: 'definition', name: templateName };
  }
  return null;
}

function normalizeImportPlanTarget(rawTarget: unknown, candidates: ImportTemplateSectionCandidate[], instruction: string): ImportPlanTarget {
  if (!rawTarget || typeof rawTarget !== 'object') {
    const fallback = selectBestImportCandidate(candidates, instruction);
    return fallback ? candidateToImportPlanTarget(fallback) : { kind: 'blank', title: inferImportSectionTitleFromStep(instruction) };
  }
  const value = rawTarget as { kind?: unknown; source?: unknown; id?: unknown; title?: unknown; name?: unknown };
  const rawKind = typeof value.kind === 'string'
    ? value.kind
    : typeof value.source === 'string'
      ? value.source
      : 'blank';
  const kind: ImportPlanTargetKind = rawKind === 'body' || rawKind === 'definition' ? rawKind : 'blank';
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  if (kind === 'blank') {
    return { kind, title: title || inferImportSectionTitleFromStep(instruction) };
  }
  const match = findImportCandidateForTarget(candidates, {
    kind,
    id: id || undefined,
    name: name || undefined,
    title: title || undefined,
  });
  if (match) {
    return candidateToImportPlanTarget(match);
  }
  return {
    kind,
    id: id || undefined,
    name: name || undefined,
    title: title || name || id || undefined,
  };
}

function candidateToImportPlanTarget(candidate: ImportTemplateSectionCandidate): ImportPlanTarget {
  return {
    kind: candidate.source,
    id: candidate.id || undefined,
    title: candidate.title,
    name: candidate.name || undefined,
  };
}

function inferImportSectionTitleFromStep(step: string): string {
  const match = step.match(/\b(?:the\s+)?([A-Z][A-Za-z0-9 &/+-]{1,80}?)\s+section\b/);
  return match?.[1]?.trim() || step.replace(/^(?:create|add|build|generate)\s+(?:the\s+)?/i, '').replace(/\s+from\b[\s\S]*$/i, '').trim() || 'Imported Section';
}

function looksLikeImportInstruction(text: string): boolean {
  return /\b(?:create|add|build|generate|replace|update|fill)\b/i.test(text) || text.split(/\s+/).length > 4;
}

function buildDefaultImportPlanInstruction(sectionTitle: string): string {
  return `Create the ${sectionTitle} section.`;
}

function formatImportPlanStep(step: ImportPlanStep): string {
  return `${step.sectionTitle}: ${step.instruction}`;
}

function toPublicImportTemplateStructure(structure: ImportTemplateStructureInternal): ImportTemplateStructureDescriptor {
  return {
    id: structure.id,
    label: structure.label,
    target: structure.target,
    jsonSchema: structure.jsonSchema,
  };
}

function buildImportTemplateStructureDescriptor(candidates: ImportTemplateSectionCandidate[], target: ImportPlanTarget): ImportTemplateStructureInternal | null {
  if (target.kind === 'blank') {
    return null;
  }
  const candidate = findImportCandidateForTarget(candidates, target);
  if (!candidate) {
    return null;
  }
  const structure = buildImportTemplateStructureForCandidate(candidate);
  return structure && hasImportTemplateStructureFields(structure) ? structure : null;
}

function buildImportTemplateStructureForCandidate(candidate: ImportTemplateSectionCandidate): ImportTemplateStructureInternal | null {
  const lists = collectImportTemplateListStructures(candidate.section, candidate.componentDefs);
  const listVariableNames = new Set(lists.flatMap((list) => list.variables.map((variable) => variable.name)));
  const sectionVariables = (candidate.sectionDefinition
    ? extractReusableTemplateVariablesFromSectionDefinition(candidate.sectionDefinition)
    : extractReusableTemplateVariables(candidate.section))
    .filter((variable) => !listVariableNames.has(variable.name));
  const properties: Record<string, ImportTemplateJsonSchemaProperty> = {};
  const required: string[] = [];
  for (const variable of sectionVariables) {
    properties[variable.name] = templateVariableToJsonSchemaProperty(variable);
    required.push(variable.name);
  }
  for (const list of lists) {
    properties[list.key] = {
      type: 'array',
      title: list.title,
      description: `Repeatable ${list.title} items.`,
      items: list.jsonSchema,
    };
    required.push(list.key);
  }
  const target = candidateToImportPlanTarget(candidate);
  return {
    id: getImportTemplateStructureId(candidate),
    label: `${candidate.title} template`,
    target,
    jsonSchema: {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    },
    sectionVariables,
    lists,
  };
}

function hasImportTemplateStructureFields(structure: ImportTemplateStructureInternal): boolean {
  return structure.sectionVariables.length > 0 || structure.lists.length > 0;
}

function getImportTemplateStructureId(candidate: ImportTemplateSectionCandidate): string {
  const raw = candidate.source === 'definition'
    ? `definition:${candidate.name || candidate.id || candidate.title}`
    : `body:${candidate.id || candidate.title}`;
  return raw.toLowerCase().replace(/[^a-z0-9:_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function templateVariableToJsonSchemaProperty(variable: ReusableTemplateVariable): ImportTemplateScalarSchemaProperty {
  return {
    type: 'string',
    title: variable.label,
    description: variable.type === 'block' ? 'May contain multiple lines.' : 'Single-line value.',
  };
}

function collectImportTemplateListStructures(section: VisualSection, componentDefs: ComponentDefinition[]): ImportTemplateListStructure[] {
  const lists: ImportTemplateListStructure[] = [];
  const usedKeys = new Set<string>();
  const collectFromBlocks = (blocks: VisualBlock[]): void => {
    for (const block of blocks) {
      if (block.schema.component === 'component-list') {
        const list = buildImportTemplateListStructure(block, usedKeys, componentDefs);
        if (list) {
          lists.push(list);
        }
      }
      collectFromBlocks(block.schema.containerBlocks ?? []);
      collectFromBlocks(block.schema.componentListBlocks ?? []);
      collectFromBlocks(block.schema.gridItems?.map((item) => item.block) ?? []);
      collectFromBlocks(block.schema.expandableStubBlocks?.children ?? []);
      collectFromBlocks(block.schema.expandableContentBlocks?.children ?? []);
    }
  };
  collectFromBlocks(section.blocks);
  for (const child of section.children) {
    lists.push(...collectImportTemplateListStructures(child, componentDefs));
  }
  return lists;
}

function buildImportTemplateListStructure(block: VisualBlock, usedKeys: Set<string>, componentDefs: ComponentDefinition[]): ImportTemplateListStructure | null {
  const itemComponent = block.schema.componentListComponent.trim();
  const itemTemplate = findImportTemplateListItemTemplate(block, itemComponent, componentDefs);
  if (!itemTemplate) {
    return null;
  }
  const variables = getImportTemplateListItemVariables(itemTemplate, itemComponent, componentDefs);
  if (variables.length === 0) {
    return null;
  }
  const properties: Record<string, ImportTemplateJsonSchemaProperty> = {};
  const required: string[] = [];
  for (const variable of variables) {
    properties[variable.name] = templateVariableToJsonSchemaProperty(variable);
    required.push(variable.name);
  }
  const baseKey = block.schema.id.trim() || itemComponent || 'items';
  const key = uniqueImportTemplateListKey(toImportJsonPropertyName(baseKey), usedKeys);
  return {
    key,
    title: block.schema.componentListItemLabel.trim() || itemComponent || key,
    listBlockId: block.schema.id.trim() || block.id,
    itemComponent,
    variables,
    itemTemplate,
    jsonSchema: {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    },
  };
}

function findImportTemplateListItemTemplate(block: VisualBlock, itemComponent: string, componentDefs: ComponentDefinition[]): VisualBlock | null {
  if (block.schema.componentListBlocks.length > 0) {
    return cloneReusableBlock(block.schema.componentListBlocks[0]!);
  }
  if (!itemComponent) {
    return null;
  }
  const def = componentDefs.find((item) => item.name === itemComponent);
  if (!def) {
    return null;
  }
  if (def.template) {
    const item = cloneReusableBlock(def.template);
    item.schema.component = itemComponent;
    return item;
  }
  if (def.schema) {
    return {
      id: '',
      text: '',
      schema: cloneReusableSchema(def.schema, itemComponent),
      schemaMode: false,
    };
  }
  return null;
}

function getImportTemplateListItemVariables(itemTemplate: VisualBlock, itemComponent: string, componentDefs: ComponentDefinition[]): ReusableTemplateVariable[] {
  const def = componentDefs.find((item) => item.name === itemComponent);
  const variables = def
    ? extractReusableTemplateVariablesFromDefinition(def)
    : [];
  return variables.length > 0
    ? variables
    : extractReusableTemplateVariables(itemTemplate);
}

function uniqueImportTemplateListKey(baseKey: string, usedKeys: Set<string>): string {
  let key = baseKey || 'items';
  let index = 2;
  while (usedKeys.has(key)) {
    key = `${baseKey || 'items'}_${index}`;
    index += 1;
  }
  usedKeys.add(key);
  return key;
}

function toImportJsonPropertyName(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_') || 'items';
}

function buildImportXrefTargetPrompt(sourceName: string, instructions?: string): string {
  return [
    `Identify planned xref targets for import source "${sourceName}".`,
    '',
    'This is not a tool loop. Do not generate HVY and do not mutate anything.',
    'Read the approved section plan and source document, then list referenceable targets that later sections may create or reference.',
    'A target can be a final section or any source-backed reusable record, item, entity, event, category, or other referenceable document object.',
    'Use stable HVY ids that section generation can later use as exact `xrefTarget` values, even if the target section or record has not been generated yet.',
    'Give each target a short title, optional kind/tag, and exactly one sentence describing what it is.',
    'Use only source-backed targets. Do not include placeholders, conditionals, or speculative references.',
    instructions?.trim() ? ['Additional import instructions:', instructions.trim()].join('\n') : '',
  ].filter(Boolean).join('\n');
}

function buildImportXrefTargetContext(document: VisualDocument, sourceName: string, sourceText: string, steps: ImportPlanStep[]): string {
  return [
    buildImportGuidanceFrame(document),
    '',
    '=== BEGIN TEMPLATE SECTIONS ===',
    'Template section inventory for resolving section targets; this is not an ordering requirement:',
    buildImportTemplateSectionOutline(document),
    '=== END TEMPLATE SECTIONS ===',
    '',
    'Approved import section plan:',
    ...steps.map((step, index) => `${index + 1}. ${formatImportPlanStep(step)} (${formatImportPlanTarget(step.target)})`),
    '',
    '=== BEGIN SOURCE DOCUMENT ===',
    `Source name: ${sourceName}`,
    '```text',
    sourceText,
    '```',
    '=== END SOURCE DOCUMENT ===',
  ].join('\n');
}

function buildImportSectionInformationPrompt(sourceName: string, instructions: string | undefined, step: ImportPlanStep, index: number, total: number): string {
  return [
    `Extract source information for one import section from "${sourceName}".`,
    '',
    `Approved section step ${index + 1} of ${total}: ${formatImportPlanStep(step)}`,
    '',
    'This is not a tool loop. Do not plan the next action and do not ask to inspect anything.',
    'Extract and organize only the source facts relevant to this one approved section.',
    'Do not generate HVY in this step.',
    'Use only facts present in the imported source text. Do not invent dates, titles, entity names, labels, categories, metrics, links, or other factual details.',
    'Preserve exact source dates, names, titles, entity names, labels, category names, and terminology unless the approved step or host instructions explicitly say to normalize them.',
    instructions?.trim() ? ['Additional import instructions:', instructions.trim()].join('\n') : '',
  ].filter(Boolean).join('\n');
}

function buildImportSectionInformationContext(
  document: VisualDocument,
  sourceName: string,
  sourceText: string,
  steps: ImportPlanStep[],
  activeIndex: number,
  createdSections: string[],
  application: ImportStepApplication,
  plannedXrefTargets: PlannedImportXrefTarget[]
): string {
  return [
    buildImportGuidanceFrame(document),
    '',
    buildImportSectionApplicationFrame(document, application),
    '',
    buildImportRelationshipFrame(document),
    '',
    buildImportPlannedXrefTargetFrame(plannedXrefTargets),
    '',
    '=== BEGIN SOURCE DOCUMENT ===',
    `Source name: ${sourceName}`,
    '```text',
    sourceText,
    '```',
    '=== END SOURCE DOCUMENT ===',
    '',
    'Approved import section plan:',
    ...steps.map((step, index) => `${index + 1}. ${index < activeIndex ? '[created]' : index === activeIndex ? '[current]' : '[pending]'} ${formatImportPlanStep(step)} (${formatImportPlanTarget(step.target)})`),
    ...(createdSections.length > 0 ? ['', 'Previously created section results:', ...createdSections] : []),
  ].join('\n');
}

function buildImportSectionHvyPrompt(sourceName: string, instructions: string | undefined, step: ImportPlanStep, index: number, total: number): string {
  return [
    `Generate one complete HVY section for import source "${sourceName}".`,
    '',
    `Approved section step ${index + 1} of ${total}: ${formatImportPlanStep(step)}`,
    '',
    'This is not a tool loop. Do not plan the next action and do not ask to inspect anything.',
    'Use the extracted section information as the source of truth for facts.',
    'Build the section as raw HVY using the matched template as structural guidance.',
    'Reuse the template component shapes where they fit, including custom record components, component-list items, tables, containers, and xref-card components.',
    'IDs are for navigation and exact xref targets. Do not repeat IDs and do not add IDs to local layout/prose components just to name them.',
    'Do not put `id` on xref-card components; xref-card points at another component with `xrefTarget` and does not need its own navigation ID.',
    'When reusing a matched grid, preserve the template grid shape, `gridColumns`, slot count, and slot order. Do not add extra grid cells for prose, notes, accomplishments, or repeated records.',
    'For custom components whose base type is expandable, put `<!--hvy:expandable:stub {}-->` and `<!--hvy:expandable:content {}-->` directly under the custom component directive. Do not create a separate sibling `<!--hvy:expandable {}-->` block.',
    'Use LLM-only closing comments for every nested container, reusable/custom component, component-list item slot, and expandable slot, for example `<!-- /container -->`, `<!-- /foo-record -->`, `<!-- /component-list:0 -->`, `<!-- /expandable:stub -->`. These closing comments are required.',
    'Do not close only the slots; close the containing reusable/custom component too, for example `<!-- /foo-record -->` after its expandable slots.',
    'Leave template fill-in placeholders alone when the source has no value for them. Do not replace a fill-in with an empty text block.',
    'When this section creates records that other sections may reference, give those records stable source-backed ids.',
    'When this section references imported records, use `xref-card` with an exact `xrefTarget` from the existing or planned relationship inventory. Do not invent xref targets.',
    'Do not manually create reciprocal/generated xrefs; document update scripts may create those after import mutations.',
    'Return exactly one top-level section. Do not return multiple sections. Do not return a component fragment without its section wrapper.',
    'Return raw HVY only; do not call or describe tools.',
    'Do not HTML-escape HVY directives. Use literal `<!--` and `-->`, not `&lt;!--` or `--&gt;`.',
    'Do not use facts that are not present in the extracted section information.',
    instructions?.trim() ? ['Additional import instructions:', instructions.trim()].join('\n') : '',
  ].filter(Boolean).join('\n');
}

function buildImportSectionHvyContext(document: VisualDocument, information: string, application: ImportStepApplication, plannedXrefTargets: PlannedImportXrefTarget[]): string {
  return [
    buildImportGuidanceFrame(document),
    '',
    buildImportSectionApplicationFrame(document, application),
    '',
    buildImportRelationshipFrame(document),
    '',
    buildImportPlannedXrefTargetFrame(plannedXrefTargets),
    '',
    buildImportParagraphStyleFrame(document),
    '',
    '=== BEGIN SECTION INFORMATION ===',
    information,
    '=== END SECTION INFORMATION ===',
    '',
    '=== BEGIN HVY FORMAT REFERENCE ===',
    'The following HVY document is a syntax and component reference only. It is not the task, not the source document, and not the output contract.',
    'Use it to understand valid HVY section/component structure and examples. Follow the separate response instructions for what to return.',
    '',
    importHvyFormatReference.trim(),
    '=== END HVY FORMAT REFERENCE ===',
  ].join('\n');
}

function buildImportTemplateValuesPrompt(sourceName: string, instructions: string | undefined, step: ImportPlanStep, index: number, total: number): string {
  return [
    `Fill one HVY template JSON object for import source "${sourceName}".`,
    '',
    `Approved section step ${index + 1} of ${total}: ${formatImportPlanStep(step)}`,
    '',
    'This is not a tool loop. Do not generate HVY and do not mutate anything.',
    'Return only source-backed JSON values that fit the provided schema.',
    'Use empty strings for scalar fields that have no source-backed value.',
    'Use empty arrays for repeatable lists that have no source-backed items.',
    'Preserve exact source dates, names, titles, entity names, labels, category names, and terminology unless host instructions explicitly say to normalize them.',
    instructions?.trim() ? ['Additional import instructions:', instructions.trim()].join('\n') : '',
  ].filter(Boolean).join('\n');
}

function buildImportTemplateValuesContext(
  document: VisualDocument,
  sourceName: string,
  sourceText: string,
  steps: ImportPlanStep[],
  activeIndex: number,
  createdSections: string[],
  application: ImportStepApplication,
  plannedXrefTargets: PlannedImportXrefTarget[],
  templateStructure: ImportTemplateStructureInternal
): string {
  return [
    buildImportGuidanceFrame(document),
    '',
    buildImportSectionApplicationFrame(document, application),
    '',
    buildImportRelationshipFrame(document),
    '',
    buildImportPlannedXrefTargetFrame(plannedXrefTargets),
    '',
    '=== BEGIN TEMPLATE JSON SCHEMA ===',
    JSON.stringify(templateStructure.jsonSchema, null, 2),
    '=== END TEMPLATE JSON SCHEMA ===',
    '',
    '=== BEGIN SOURCE DOCUMENT ===',
    `Source name: ${sourceName}`,
    '```text',
    sourceText,
    '```',
    '=== END SOURCE DOCUMENT ===',
    '',
    'Approved import section plan:',
    ...steps.map((planStep, index) => `${index + 1}. ${index < activeIndex ? '[created]' : index === activeIndex ? '[current]' : '[pending]'} ${formatImportPlanStep(planStep)} (${formatImportPlanTarget(planStep.target)})`),
    ...(createdSections.length > 0 ? ['', 'Previously created section results:', ...createdSections] : []),
  ].join('\n');
}

function buildImportGuidanceFrame(document: VisualDocument): string {
  const aiContext = getDocumentAiContext(document);
  const importGuidance = getDocumentAiImportGuidance(document);
  if (!aiContext && !importGuidance) {
    return [
      '=== BEGIN DOCUMENT AI IMPORT GUIDANCE ===',
      'No document-level AI import guidance is defined.',
      '=== END DOCUMENT AI IMPORT GUIDANCE ===',
    ].join('\n');
  }
  return [
    '=== BEGIN DOCUMENT AI IMPORT GUIDANCE ===',
    aiContext ? ['General AI context:', aiContext].join('\n') : '',
    importGuidance ? ['Import guidance:', importGuidance].join('\n') : '',
    '=== END DOCUMENT AI IMPORT GUIDANCE ===',
  ].filter(Boolean).join('\n');
}

function buildImportParagraphStyleFrame(document: VisualDocument): string {
  const styles = Object.entries(getTextLineStylesFromMeta(document.meta))
    .sort(([left], [right]) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
  return [
    '=== BEGIN DOCUMENT PARAGRAPH STYLES ===',
    'Existing paragraph styles available for text line markers:',
    styles.length > 0
      ? styles.map(([name, style]) => `- ${name}: label="${getTextLineStyleLabel(name, style)}"; css="${style.css}"; marker="^${name}^"`).join('\n')
      : '- No paragraph styles are defined for this document.',
    'Use these marker names exactly when styling individual lines inside `text` blocks. Do not invent paragraph style names.',
    '=== END DOCUMENT PARAGRAPH STYLES ===',
  ].join('\n');
}

type ImportTemplateSectionCandidate = {
  title: string;
  id: string;
  name: string;
  section: VisualSection;
  source: 'body' | 'definition';
  componentDefs: ComponentDefinition[];
  sectionDefinition?: SectionDefinition;
};

type ImportStepApplication =
  | { kind: 'replace'; target: ImportTemplateSectionCandidate }
  | { kind: 'append-from-definition'; target: ImportTemplateSectionCandidate }
  | { kind: 'blank'; title: string };

function getImportTemplateSectionCandidates(document: VisualDocument): ImportTemplateSectionCandidate[] {
  const candidates: ImportTemplateSectionCandidate[] = [];
  const componentDefs = Array.isArray(document.meta.component_defs) ? document.meta.component_defs : [];
  const appendSections = (sections: VisualSection[]): void => {
    for (const section of sections) {
      candidates.push({
        title: trimImportString(section.title) || trimImportString(section.customId) || 'Untitled section',
        id: trimImportString(section.customId),
        name: '',
        section,
        source: 'body',
        componentDefs,
        sectionDefinition: undefined,
      });
      appendSections(section.children);
    }
  };
  appendSections(document.sections);
  for (const definition of getImportSectionDefinitions(document)) {
    candidates.push({
      title: trimImportString(definition.name) || trimImportString(definition.template.title) || trimImportString(definition.template.customId) || 'Untitled section',
      id: trimImportString(definition.template.customId),
      name: trimImportString(definition.name),
      section: definition.template,
      source: 'definition',
      componentDefs,
      sectionDefinition: definition,
    });
  }
  return candidates;
}

function resolveImportStepApplication(document: VisualDocument, step: ImportPlanStep): ImportStepApplication {
  const candidates = getImportTemplateSectionCandidates(document);
  if (step.target.kind === 'blank') {
    return { kind: 'blank', title: step.sectionTitle || step.target.title || 'Imported Section' };
  }
  if (step.target.kind === 'body' || step.target.kind === 'definition') {
    const explicit = findImportCandidateForTarget(candidates, step.target);
    if (explicit) {
      return explicit.source === 'body'
        ? { kind: 'replace', target: explicit }
        : { kind: 'append-from-definition', target: explicit };
    }
    throw new Error(`Import plan target was not found: ${formatImportPlanTarget(step.target)}.`);
  }
  return { kind: 'blank', title: step.sectionTitle || step.target.title || 'Imported Section' };
}

function findImportCandidateForTarget(candidates: ImportTemplateSectionCandidate[], target: ImportPlanTarget): ImportTemplateSectionCandidate | null {
  return candidates.find((candidate) => {
    if (candidate.source !== target.kind) {
      return false;
    }
    if (!target.id && !target.name && !target.title) {
      return false;
    }
    if (target.id && candidate.id !== target.id) {
      return false;
    }
    if (target.name && candidate.name !== target.name) {
      return false;
    }
    if (target.title && candidate.title !== target.title) {
      return false;
    }
    return true;
  }) ?? null;
}

function selectBestImportCandidate(candidates: ImportTemplateSectionCandidate[], text: string): ImportTemplateSectionCandidate | null {
  const normalizedStep = normalizeImportMatchText(text);
  const scored = scoreImportTemplateSectionCandidates(candidates, normalizedStep)
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.candidate ?? null;
}

function scoreImportTemplateSectionCandidates(candidates: ImportTemplateSectionCandidate[], normalizedStep: string): Array<{ candidate: ImportTemplateSectionCandidate; score: number }> {
  return candidates.map((candidate) => {
    const title = normalizeImportMatchText(candidate.title);
    const id = normalizeImportMatchText(candidate.section.customId);
    const titleWords = title.split(' ').filter((word) => word.length > 2);
    const titleOverlap = titleWords.filter((word) => normalizedStep.includes(word)).length;
    const score = (title && normalizedStep.includes(title) ? 100 : 0)
      + (id && normalizedStep.includes(id) ? 50 : 0)
      + titleOverlap;
    return { candidate, score };
  });
}

function normalizeImportMatchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function formatImportPlanTarget(target: ImportPlanTarget): string {
  if (target.kind === 'blank') {
    return `blank section${target.title ? `: ${target.title}` : ''}`;
  }
  return `${target.kind} section${target.title ? `: ${target.title}` : ''}${target.id ? ` (${target.id})` : ''}${target.name ? ` [${target.name}]` : ''}`;
}

function buildImportSectionApplicationFrame(document: VisualDocument, application: ImportStepApplication): string {
  if (application.kind === 'blank') {
    return [
      '=== BEGIN SECTION APPLICATION ===',
      'Application: create an empty new section from scratch.',
      `Section title: ${application.title}`,
      'No matching template/body section was selected for this step.',
      '=== END SECTION APPLICATION ===',
    ].join('\n');
  }
  const action = application.kind === 'replace'
    ? 'replace existing body section'
    : 'append new section from reusable/template section';
  const reusableDefinitionFrame = buildImportReusableDefinitionFrame(document, application.target.section);
  return [
    '=== BEGIN SECTION APPLICATION ===',
    `Application: ${action}.`,
    `Matched section kind: ${application.target.source}`,
    `Matched section title: ${application.target.title}`,
    application.target.id ? `Matched section id: ${application.target.id}` : '',
    application.target.name ? `Matched section name: ${application.target.name}` : '',
    '',
    '=== BEGIN MATCHED SECTION TEMPLATE ===',
    serializeSectionFragment(application.target.section, document.meta),
    '=== END MATCHED SECTION TEMPLATE ===',
    reusableDefinitionFrame,
    '=== END SECTION APPLICATION ===',
  ].filter(Boolean).join('\n');
}

function buildImportReusableDefinitionFrame(document: VisualDocument, section: VisualSection): string {
  const componentDefs = collectImportReferencedComponentDefinitions(document, section);
  if (componentDefs.length === 0) {
    return '';
  }
  return [
    '=== BEGIN MATCHED REUSABLE DEFINITIONS ===',
    'Reusable component examples referenced by the matched section/template, including nested reusable components:',
    componentDefs.map((def) => formatImportReusableDefinitionExample(def, document.meta)).join('\n\n'),
    '=== END MATCHED REUSABLE DEFINITIONS ===',
  ].join('\n');
}

function formatImportReusableDefinitionExample(def: ComponentDefinition, documentMeta: VisualDocument['meta']): string {
  const example = createImportReusableDefinitionExample(def);
  const details = [
    `Component: ${def.name}`,
    def.baseType ? `Base type: ${def.baseType}` : '',
    def.description ? `Description: ${def.description}` : '',
  ].filter(Boolean);
  return [
    details.join('\n'),
    'Example HVY:',
    '```hvy',
    serializeBlockFragment(example, documentMeta),
    '```',
  ].join('\n');
}

function createImportReusableDefinitionExample(def: ComponentDefinition): VisualBlock {
  const baseType = def.baseType ? resolveBaseComponentFromMeta(def.baseType, null) : '';
  const template = def.template
    ? cloneReusableBlock(def.template)
    : {
        id: '',
        text: '',
        schema: def.schema ? cloneReusableSchema(def.schema, def.name) : defaultBlockSchema(def.name),
        schemaMode: false,
      };
  template.schema.component = def.name;
  if (!def.template) {
    seedImportReusableDefinitionFallbackExample(template, baseType);
  }
  replaceImportTemplateVariablesInBlock(template, def.templateVariables ?? {});
  return template;
}

function seedImportReusableDefinitionFallbackExample(block: VisualBlock, baseType: string): void {
  if (baseType === 'text') {
    block.text ||= 'Example source-backed text.';
  } else if (baseType === 'code') {
    block.text ||= 'const example = "source-backed value";';
    block.schema.codeLanguage = block.schema.codeLanguage || 'ts';
  } else if (baseType === 'container') {
    if (block.schema.containerBlocks.length === 0) {
      block.schema.containerBlocks.push(createImportExampleTextBlock('Example child content.'));
    }
    block.schema.containerTitle ||= 'Example group';
  } else if (baseType === 'expandable') {
    if (block.schema.expandableStubBlocks.children.length === 0) {
      block.schema.expandableStubBlocks.children.push(createImportExampleTextBlock('Example summary'));
    }
    if (block.schema.expandableContentBlocks.children.length === 0) {
      block.schema.expandableContentBlocks.children.push(createImportExampleTextBlock('Example expanded details.'));
    }
    block.schema.expandableAlwaysShowStub = true;
  } else if (baseType === 'component-list') {
    block.schema.componentListComponent ||= 'text';
    if (block.schema.componentListBlocks.length === 0) {
      block.schema.componentListBlocks.push(createImportExampleTextBlock('Example list item.'));
    }
  } else if (baseType === 'grid') {
    block.schema.gridColumns = block.schema.gridColumns || 2;
    if (block.schema.gridItems.length === 0) {
      block.schema.gridItems.push(
        { id: 'example-left', block: createImportExampleTextBlock('Left example content.') },
        { id: 'example-right', block: createImportExampleTextBlock('Right example content.') }
      );
    }
  } else if (baseType === 'table') {
    if (block.schema.tableColumns.length === 0 || isDefaultImportExampleTableColumns(block.schema.tableColumns)) {
      block.schema.tableColumns = ['Example', 'Detail'];
    }
    if (block.schema.tableRows.length === 0) {
      block.schema.tableRows.push({ cells: block.schema.tableColumns.map((column) => `${column} value`) });
    }
  } else if (baseType === 'xref-card') {
    block.schema.xrefTitle = block.schema.xrefTitle || 'EXAMPLE_TARGET_TITLE';
    block.schema.xrefDetail = block.schema.xrefDetail || 'Short source-backed detail';
    block.schema.xrefTarget = block.schema.xrefTarget || 'example-target-id';
    block.schema.id = '';
  } else if (baseType === 'image') {
    block.schema.imageFile ||= 'example-image.png';
    block.schema.imageAlt ||= 'Example image alt text';
  } else if (baseType === 'button') {
    block.schema.buttonLabel ||= 'Example action';
    block.schema.buttonPrompt ||= 'Use the selected source-backed content to produce the requested output.';
  } else if (baseType === 'plugin') {
    block.schema.plugin ||= 'example.plugin.id';
  }
}

function isDefaultImportExampleTableColumns(columns: string[]): boolean {
  return columns.length === 2 && columns[0] === 'Column 1' && columns[1] === 'Column 2';
}

function createImportExampleTextBlock(text: string): VisualBlock {
  return {
    id: '',
    text,
    schema: defaultBlockSchema('text'),
    schemaMode: false,
  };
}

function replaceImportTemplateVariablesInBlock(block: VisualBlock, variables: ComponentDefinition['templateVariables']): void {
  block.text = replaceImportTemplateVariablesInText(block.text, variables);
  block.schema = replaceImportTemplateVariablesInValue(block.schema, variables) as VisualBlock['schema'];
}

function replaceImportTemplateVariablesInValue(value: unknown, variables: ComponentDefinition['templateVariables']): unknown {
  if (typeof value === 'string') {
    return replaceImportTemplateVariablesInText(value, variables);
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceImportTemplateVariablesInValue(item, variables));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
        key,
        replaceImportTemplateVariablesInValue(entryValue, variables),
      ])
    );
  }
  return value;
}

function replaceImportTemplateVariablesInText(text: string, variables: ComponentDefinition['templateVariables']): string {
  return text.replace(/\{%\s*([a-zA-Z0-9_-]+)(?:\s*\|[^%]+)?\s*%\}/g, (_match, name: string) => {
    const label = variables?.[name]?.label;
    return toImportTemplateVariableExampleName(label || name);
  });
}

function toImportTemplateVariableExampleName(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase() || 'VARIABLE_NAME';
}

function collectImportReferencedComponentDefinitions(document: VisualDocument, section: VisualSection): ComponentDefinition[] {
  const defs = Array.isArray(document.meta?.component_defs) ? document.meta.component_defs : [];
  const byName = new Map(defs.map((def) => [def.name, def]));
  const seen = new Set<string>();
  const referenced: ComponentDefinition[] = [];
  const queue: string[] = [];

  const enqueueFromValue = (value: unknown): void => {
    collectImportComponentNamesFromValue(value).forEach((name) => {
      if (byName.has(name) && !seen.has(name)) {
        queue.push(name);
      }
    });
  };

  enqueueFromValue(section);
  while (queue.length > 0) {
    const name = queue.shift()!;
    if (seen.has(name)) {
      continue;
    }
    const def = byName.get(name);
    if (!def) {
      continue;
    }
    seen.add(name);
    referenced.push(def);
    enqueueFromValue(def.baseType);
    enqueueFromValue(def.schema);
    enqueueFromValue(def.template);
  }

  return referenced;
}

function collectImportComponentNamesFromValue(value: unknown): Set<string> {
  const names = new Set<string>();
  const visited = new WeakSet<object>();
  const walk = (candidate: unknown, key?: string): void => {
    if (typeof candidate === 'string') {
      if (key === 'component' || key === 'baseType' || key === 'componentListComponent' || key === 'expandableStubComponent' || key === 'expandableContentComponent') {
        names.add(candidate);
      }
      return;
    }
    if (!candidate || typeof candidate !== 'object') {
      return;
    }
    if (visited.has(candidate)) {
      return;
    }
    visited.add(candidate);
    if (Array.isArray(candidate)) {
      candidate.forEach((item) => walk(item));
      return;
    }
    Object.entries(candidate as Record<string, unknown>).forEach(([entryKey, entryValue]) => {
      walk(entryValue, entryKey);
    });
  };
  walk(value);
  return names;
}

function buildImportRelationshipFrame(document: VisualDocument): string {
  const targets = collectImportXrefTargets(document).slice(0, 120);
  const xrefs = collectImportXrefs(document).slice(0, 120);
  return [
    '=== BEGIN DOCUMENT RELATIONSHIPS ===',
    'Existing xref targets available before this section is generated:',
    targets.length > 0
      ? targets.map((target) => `- ${target.id}: ${target.title}${target.detail ? ` - ${target.detail}` : ''}${target.tags ? ` [tags: ${target.tags}]` : ''}`).join('\n')
      : '- No existing xref targets yet.',
    '',
    'Existing xref-card references already present before this section is generated:',
    xrefs.length > 0
      ? xrefs.map((xref) => `- ${xref.id || '(no id)'}: ${xref.title || '(untitled)'}${xref.detail ? ` - ${xref.detail}` : ''} -> ${xref.target}`).join('\n')
      : '- No existing xref-card references yet.',
    '=== END DOCUMENT RELATIONSHIPS ===',
  ].join('\n');
}

function buildImportPlannedXrefTargetFrame(targets: PlannedImportXrefTarget[]): string {
  return [
    '=== BEGIN PLANNED XREF TARGETS ===',
    'Planned xref targets from this import, including targets that may not exist in the document yet:',
    targets.length > 0
      ? targets.map((target) => `- ${target.id}: ${target.title}${target.kind ? ` [${target.kind}]` : ''} - ${target.description}`).join('\n')
      : '- No planned xref targets were identified for this import.',
    '=== END PLANNED XREF TARGETS ===',
  ].join('\n');
}

function collectImportXrefTargets(document: VisualDocument): Array<{ id: string; title: string; detail: string; tags: string }> {
  const seen = new Set<string>();
  const targets: Array<{ id: string; title: string; detail: string; tags: string }> = [];
  const add = (id: string, title: string, detail = '', tags = ''): void => {
    const normalized = id.trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    targets.push({
      id: normalized,
      title: title.trim() || normalized,
      detail: detail.trim(),
      tags: tags.trim(),
    });
  };
  const visitSections = (sections: VisualSection[], inheritedTags = ''): void => {
    for (const section of sections) {
      const tags = combineImportTags(inheritedTags, section.tags);
      add(getSectionId(section), formatSectionTitle(section.title), section.description, tags);
      visitSections(section.children, tags);
    }
  };
  visitSections(document.sections);
  visitBlocks(document.sections, (block) => {
    const id = block.schema.id.trim();
    if (!id) {
      return;
    }
    if (!isImportReferenceableBlock(document, block)) {
      return;
    }
    add(id, describeImportXrefTargetBlock(block), describeImportXrefTargetDetail(block), block.schema.tags);
  });
  return targets;
}

function isImportReferenceableBlock(document: VisualDocument, block: VisualBlock): boolean {
  const baseComponent = resolveBaseComponentFromMeta(block.schema.component, document.meta);
  return baseComponent !== 'text'
    || block.schema.tags.trim().length > 0
    || block.schema.xrefTitle.trim().length > 0
    || block.schema.xrefDetail.trim().length > 0
    || block.schema.description.trim().length > 0;
}

function collectImportXrefs(document: VisualDocument): Array<{ id: string; title: string; detail: string; target: string }> {
  const xrefs: Array<{ id: string; title: string; detail: string; target: string }> = [];
  visitBlocks(document.sections, (block) => {
    if (resolveBaseComponentFromMeta(block.schema.component, document.meta) !== 'xref-card') {
      return;
    }
    const target = block.schema.xrefTarget.trim();
    if (!target) {
      return;
    }
    xrefs.push({
      id: block.schema.id.trim(),
      title: block.schema.xrefTitle.trim(),
      detail: block.schema.xrefDetail.trim(),
      target,
    });
  });
  return xrefs;
}

function resolveImportTemplateStructureForStep(document: VisualDocument, step: ImportPlanStep): ImportTemplateStructureInternal | null {
  const candidates = getImportTemplateSectionCandidates(document);
  const structure = buildImportTemplateStructureDescriptor(candidates, step.target);
  if (!structure) {
    return null;
  }
  if (step.templateStructureId && step.templateStructureId !== structure.id) {
    return null;
  }
  return structure;
}

function applyGeneratedImportTemplateSection(
  document: VisualDocument,
  application: ImportStepApplication,
  templateStructure: ImportTemplateStructureInternal,
  values: ImportTemplateValues,
  onMutation?: (group?: string) => void
): string {
  if (application.kind === 'blank') {
    throw new Error('Forced template import requires a matched template section.');
  }
  const generated = instantiateImportTemplateSection(application.target.section, templateStructure, values);
  onMutation?.('ai-edit:section');
  if (application.kind === 'replace') {
    const target = application.target.section;
    const location = findSectionContainer(document.sections, target.key);
    if (!location) {
      throw new Error(`Matched section "${target.title}" could not be found.`);
    }
    adjustImportSectionLevel(generated, target.level);
    generated.key = target.key;
    location.container.splice(location.index, 1, generated);
    return `Replaced section "${target.title}" with "${generated.title}" (${getSectionId(generated)}).`;
  }
  adjustImportSectionLevel(generated, 1);
  document.sections.push(generated);
  return `Inserted section "${generated.title}" (${getSectionId(generated)}) at the bottom.`;
}

function instantiateImportTemplateSection(template: VisualSection, templateStructure: ImportTemplateStructureInternal, values: ImportTemplateValues): VisualSection {
  const section = cloneReusableSection(template);
  const scalarValues: Record<string, string> = {};
  for (const variable of templateStructure.sectionVariables) {
    const value = values[variable.name];
    scalarValues[variable.name] = typeof value === 'string' ? value : '';
  }
  applyReusableSectionTemplateValues(section, scalarValues, templateStructure.sectionVariables);
  for (const list of templateStructure.lists) {
    replaceImportTemplateListItems(section, list, Array.isArray(values[list.key]) ? values[list.key] as Array<Record<string, string>> : []);
  }
  return section;
}

function replaceImportTemplateListItems(section: VisualSection, list: ImportTemplateListStructure, items: Array<Record<string, string>>): void {
  const block = findImportTemplateListBlock(section.blocks, list.listBlockId, list.itemComponent);
  if (!block) {
    return;
  }
  block.schema.componentListBlocks = items.map((itemValues) => {
    const item = cloneReusableBlock(list.itemTemplate);
    if (list.itemComponent) {
      item.schema.component = list.itemComponent;
    }
    applyReusableTemplateValues(item, itemValues, list.variables);
    return item;
  });
}

function findImportTemplateListBlock(blocks: VisualBlock[], listBlockId: string, itemComponent?: string): VisualBlock | null {
  for (const block of blocks) {
    if (
      block.id === listBlockId
      || block.schema.id.trim() === listBlockId
      || (block.schema.component === 'component-list' && itemComponent && block.schema.componentListComponent === itemComponent)
    ) {
      return block;
    }
    const nested = findImportTemplateListBlock([
      ...(block.schema.containerBlocks ?? []),
      ...(block.schema.componentListBlocks ?? []),
      ...(block.schema.gridItems?.map((item) => item.block) ?? []),
      ...(block.schema.expandableStubBlocks?.children ?? []),
      ...(block.schema.expandableContentBlocks?.children ?? []),
    ], listBlockId, itemComponent);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function describeImportXrefTargetBlock(block: VisualBlock): string {
  const title = block.schema.xrefTitle.trim()
    || block.schema.containerTitle.trim()
    || firstImportVisibleText(block)
    || humanizeImportId(block.schema.id)
    || block.schema.component;
  return title;
}

function describeImportXrefTargetDetail(block: VisualBlock): string {
  return block.schema.xrefDetail.trim() || block.schema.description.trim();
}

function firstImportVisibleText(block: VisualBlock): string {
  const own = block.text.replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').trim();
  if (own) {
    return own.slice(0, 120);
  }
  for (const row of block.schema.tableRows) {
    const cell = row.cells.map((value) => value.replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').trim()).find(Boolean);
    if (cell) {
      return cell.slice(0, 120);
    }
  }
  return '';
}

function humanizeImportId(id: string): string {
  return id.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function combineImportTags(...values: string[]): string {
  return values.map((value) => value.trim()).filter(Boolean).join(', ');
}

function applyGeneratedImportSection(
  document: VisualDocument,
  application: ImportStepApplication,
  hvy: string,
  onMutation?: (group?: string) => void
): string {
  const generated = parseGeneratedImportSection(hvy, document.meta);
  if (application.kind !== 'blank') {
    preserveTemplateFillIns(generated, application.target.section);
  }
  onMutation?.('ai-edit:section');
  if (application.kind === 'replace') {
    const target = application.target.section;
    const location = findSectionContainer(document.sections, target.key);
    if (!location) {
      throw new Error(`Matched section "${target.title}" could not be found.`);
    }
    adjustImportSectionLevel(generated, target.level);
    const previousKey = target.key;
    generated.key = previousKey;
    location.container.splice(location.index, 1, generated);
    return `Replaced section "${target.title}" with "${generated.title}" (${getSectionId(generated)}).`;
  }
  adjustImportSectionLevel(generated, 1);
  document.sections.push(generated);
  return `Inserted section "${generated.title}" (${getSectionId(generated)}) at the bottom.`;
}

function parseGeneratedImportSection(hvy: string, documentMeta: VisualDocument['meta']): VisualSection {
  const normalizedHvy = normalizeLlmHvySafetyClosures(hvy).trim();
  const header = serializeDocumentHeaderYaml({
    meta: documentMeta,
    extension: '.hvy',
    sections: [],
    attachments: [],
  });
  const parsed = deserializeDocumentWithDiagnostics(`---\n${header.trim()}\n---\n\n${normalizedHvy}\n`, '.hvy');
  const errors = parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  if (errors.length > 0) {
    throw new Error(`Generated HVY section is invalid. ${errors.map((diagnostic) => diagnostic.message).join(' ')}`);
  }
  if (parsed.document.sections.length !== 1) {
    throw new Error('Generated HVY must contain exactly one top-level section.');
  }
  const section = parsed.document.sections[0]!;
  sanitizeGeneratedImportSection(section, documentMeta);
  return section;
}

function sanitizeGeneratedImportSection(section: VisualSection, documentMeta: VisualDocument['meta']): void {
  visitBlocks([section], (block) => {
    if (resolveBaseComponentFromMeta(block.schema.component, documentMeta) === 'xref-card') {
      block.schema.id = '';
    }
  });
}

function normalizeLlmHvySafetyClosures(hvy: string): string {
  const lines = hvy.split(/\r?\n/);
  const closeNames = new Set<string>();
  for (const line of lines) {
    const close = line.match(/^\s*<!--\s*\/([a-z][a-z0-9-]*(?::[a-z0-9-]+)*)\s*-->\s*$/i);
    if (close?.[1]) {
      closeNames.add(close[1].toLowerCase());
    }
  }
  if (closeNames.size === 0) {
    return hvy;
  }

  const stack: Array<{ name: string; indent: number }> = [];
  const normalized: string[] = [];
  for (const line of lines) {
    const close = line.match(/^\s*<!--\s*\/([a-z][a-z0-9-]*(?::[a-z0-9-]+)*)\s*-->\s*$/i);
    if (close?.[1]) {
      const name = close[1].toLowerCase();
      const index = stack.map((entry) => entry.name).lastIndexOf(name);
      if (index >= 0) {
        stack.splice(index);
      }
      continue;
    }

    let nextLine = line;
    const top = stack[stack.length - 1];
    if (top && nextLine.trim().length > 0) {
      const indent = countImportLineIndent(nextLine);
      const floor = top.indent + 1;
      if (indent < floor) {
        nextLine = `${' '.repeat(floor - indent)}${nextLine}`;
      }
    }

    normalized.push(nextLine);
    const open = nextLine.match(/^(\s*)<!--hvy:([a-z][a-z0-9-]*(?::[a-z0-9-]+)*)\s*\{.*\}\s*-->\s*$/i);
    if (open?.[2] && shouldTrackImportSafetyOpen(open[2], closeNames)) {
      stack.push({
        name: open[2].toLowerCase(),
        indent: open[1]?.length ?? 0,
      });
    }
  }
  return normalized.join('\n');
}

function shouldTrackImportSafetyOpen(name: string, closeNames: Set<string>): boolean {
  const normalized = name.toLowerCase();
  if (closeNames.has(normalized)) {
    return true;
  }
  return !IMPORT_SAFETY_LEAF_DIRECTIVES.has(normalized);
}

const IMPORT_SAFETY_LEAF_DIRECTIVES = new Set([
  'button',
  'chart',
  'db-table',
  'fill-in',
  'form-field',
  'image',
  'link',
  'script',
  'table',
  'text',
  'xref-card',
]);

function countImportLineIndent(line: string): number {
  return line.match(/^ */)?.[0].length ?? 0;
}

function preserveTemplateFillIns(generated: VisualSection, template: VisualSection): void {
  const templateFillIns = new Map<string, VisualBlock>();
  visitBlocks([template], (block) => {
    const id = block.schema.id.trim();
    if (id && block.schema.fillIn === true) {
      templateFillIns.set(id, block);
    }
  });
  if (templateFillIns.size === 0) {
    return;
  }
  preserveTemplateFillInsInList(generated.blocks, templateFillIns);
  for (const child of generated.children) {
    preserveTemplateFillIns(child, template);
  }
}

function preserveTemplateFillInsInList(blocks: VisualBlock[], templateFillIns: Map<string, VisualBlock>): void {
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!;
    const template = templateFillIns.get(block.schema.id.trim());
    if (template && isBlankGeneratedFillInReplacement(block)) {
      blocks[index] = cloneReusableBlock(template);
      continue;
    }
    preserveTemplateFillInsInList(block.schema.containerBlocks ?? [], templateFillIns);
    preserveTemplateFillInsInList(block.schema.componentListBlocks ?? [], templateFillIns);
    for (const item of block.schema.gridItems ?? []) {
      const replacement = preserveTemplateFillInBlock(item.block, templateFillIns);
      if (replacement) {
        item.block = replacement;
      } else {
        preserveTemplateFillInsInList([item.block], templateFillIns);
      }
    }
    preserveTemplateFillInsInList(block.schema.expandableStubBlocks?.children ?? [], templateFillIns);
    preserveTemplateFillInsInList(block.schema.expandableContentBlocks?.children ?? [], templateFillIns);
  }
}

function preserveTemplateFillInBlock(block: VisualBlock, templateFillIns: Map<string, VisualBlock>): VisualBlock | null {
  const template = templateFillIns.get(block.schema.id.trim());
  return template && isBlankGeneratedFillInReplacement(block) ? cloneReusableBlock(template) : null;
}

function isBlankGeneratedFillInReplacement(block: VisualBlock): boolean {
  return block.schema.fillIn !== true
    && block.text.trim().length === 0
    && (block.schema.placeholder.trim().length === 0 || block.schema.placeholder.trim().toLowerCase() === 'blank');
}

function adjustImportSectionLevel(section: VisualSection, targetLevel: number): void {
  const delta = targetLevel - section.level;
  const visit = (candidate: VisualSection): void => {
    candidate.level = Math.min(Math.max(candidate.level + delta, 1), 6);
    candidate.children.forEach(visit);
  };
  visit(section);
}

function buildImportSectionInformationResponseInstructions(): string {
  return [
    'Return exactly one JSON object and no prose.',
    'Shape:',
    '{"information":"Source facts assigned to this one section, in plain text."}',
    '',
    '`information` is a concise text document of only the imported facts used for this section.',
  ].join('\n');
}

function buildImportXrefTargetResponseInstructions(): string {
  return [
    'Return exactly one JSON object and no prose.',
    'Shape:',
    '{"targets":[{"id":"foo-bar","title":"Foo Bar","kind":"bazz","description":"A nonsense word"}]}',
    '',
    '`id` must be a stable HVY id suitable for exact `xrefTarget` use.',
    '`title` is the short display label.',
    '`kind` is optional and should be a compact tag used for filtering like items.',
    '`description` must be exactly one sentence about what the target is.',
    'Return {"targets":[]} if no source-backed xref targets are useful.',
  ].join('\n');
}

function buildImportSectionHvyResponseInstructions(): string {
  return [
    'Return exactly one JSON object and no prose.',
    'Shape:',
    '{"hvy":"<!--hvy: {\\"id\\":\\"section-id\\"}-->\\n#! Section Title\\n\\n <!--hvy:text {}-->\\n  Section content"}',
    '',
    '`hvy` must be one complete valid HVY section, not a whole document and not a standalone component.',
    'The HVY section must include exactly one section directive and one `#!` section heading.',
    'Use literal HVY directive comments. Do not HTML-escape `<`, `>`, or directive JSON quotes.',
    'Use LLM-only closing comments for nested containers, reusable/custom components, component-list item slots, and expandable slots. Example: `<!--hvy:container {}--> ... <!-- /container -->`.',
    'When returning a reusable/custom component with slots, close both the slots and the reusable/custom component itself.',
  ].join('\n');
}

function buildImportTemplateValuesResponseInstructions(templateStructure: ImportTemplateStructureInternal): string {
  return [
    'Return exactly one JSON object and no prose.',
    'Shape:',
    '{"values":{...}}',
    '',
    '`values` must match this JSON schema exactly:',
    JSON.stringify(templateStructure.jsonSchema, null, 2),
    'Do not include HVY, markdown fences, explanations, or keys not listed in the schema.',
  ].join('\n');
}

type ImportTemplateValues = Record<string, string | Array<Record<string, string>>>;

function parseImportTemplateValuesResponse(
  response: string,
  templateStructure: ImportTemplateStructureInternal
): { ok: true; value: ImportTemplateValues } | { ok: false; message: string } {
  const parsed = parseImportJsonObject(response);
  if (!parsed) {
    return { ok: false, message: 'Return valid JSON with a top-level `values` object.' };
  }
  const values = parsed.values;
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return { ok: false, message: 'Top-level `values` must be an object.' };
  }
  return validateImportTemplateValues(values as Record<string, unknown>, templateStructure.jsonSchema);
}

function validateImportTemplateValues(raw: Record<string, unknown>, schema: ImportTemplateJsonSchema): { ok: true; value: ImportTemplateValues } | { ok: false; message: string } {
  const expected = Object.keys(schema.properties);
  const expectedSet = new Set(expected);
  const actual = Object.keys(raw);
  const missing = expected.filter((key) => !Object.prototype.hasOwnProperty.call(raw, key));
  const extra = actual.filter((key) => !expectedSet.has(key));
  if (missing.length > 0 || extra.length > 0) {
    return {
      ok: false,
      message: [
        'Template values must exactly match expected keys.',
        `Expected keys: ${expected.length > 0 ? expected.join(', ') : '(none)'}.`,
        missing.length > 0 ? `Missing keys: ${missing.join(', ')}.` : '',
        extra.length > 0 ? `Extra keys: ${extra.join(', ')}.` : '',
      ].filter(Boolean).join(' '),
    };
  }
  const normalized: ImportTemplateValues = {};
  for (const key of expected) {
    const property = schema.properties[key]!;
    const value = raw[key];
    if (property.type === 'string') {
      if (typeof value !== 'string') {
        return { ok: false, message: `Template value "${key}" must be a string.` };
      }
      normalized[key] = value;
      continue;
    }
    if (!Array.isArray(value)) {
      return { ok: false, message: `Template value "${key}" must be an array.` };
    }
    const items: Array<Record<string, string>> = [];
    for (const [index, item] of value.entries()) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return { ok: false, message: `Template value "${key}" item ${index + 1} must be an object.` };
      }
      const itemResult = validateImportTemplateValues(item as Record<string, unknown>, property.items);
      if (itemResult.ok === false) {
        return { ok: false, message: `Template value "${key}" item ${index + 1}: ${itemResult.message}` };
      }
      items.push(Object.fromEntries(Object.entries(itemResult.value).map(([itemKey, itemValue]) => [itemKey, String(itemValue)])));
    }
    normalized[key] = items;
  }
  return { ok: true, value: normalized };
}

function parseImportXrefTargetResponse(response: string): PlannedImportXrefTarget[] | null {
  const parsed = parseImportJsonObject(response);
  if (!parsed || !Array.isArray(parsed.targets)) {
    return null;
  }
  const seen = new Set<string>();
  const targets: PlannedImportXrefTarget[] = [];
  for (const raw of parsed.targets) {
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    const value = raw as Record<string, unknown>;
    const id = sanitizeImportXrefId(value.id);
    if (!id || seen.has(id)) {
      continue;
    }
    const title = trimImportString(value.title) || id;
    const kind = trimImportString(value.kind);
    const description = normalizeImportXrefDescription(value.description);
    if (!description) {
      continue;
    }
    seen.add(id);
    targets.push({
      id,
      title,
      ...(kind ? { kind } : {}),
      description,
    });
  }
  return targets;
}

function sanitizeImportXrefId(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
    : '';
}

function normalizeImportXrefDescription(value: unknown): string {
  const text = trimImportString(value).replace(/\s+/g, ' ');
  if (!text) {
    return '';
  }
  const sentence = text.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() || text;
  return sentence.length > 240 ? `${sentence.slice(0, 237).trim()}...` : sentence;
}

function parseImportSectionInformationResponse(response: string): string | null {
  const parsed = parseImportJsonObject(response);
  if (!parsed) {
    return null;
  }
  const information = typeof parsed.information === 'string' ? parsed.information.trim() : '';
  return information || null;
}

function parseImportSectionHvyResponse(response: string): string | null {
  const parsed = parseImportJsonObject(response);
  if (!parsed) {
    return null;
  }
  const hvy = typeof parsed.hvy === 'string'
    ? parsed.hvy.trim()
    : typeof parsed.sectionHvy === 'string'
      ? parsed.sectionHvy.trim()
      : '';
  return hvy ? normalizeHtmlEscapedHvyDirectives(hvy) : null;
}

function normalizeHtmlEscapedHvyDirectives(hvy: string): string {
  return hvy.replace(/&lt;!--([\s\S]*?)--&gt;/gi, (_match, inner: string) => {
    const directive = inner
      .replace(/&quot;|&#34;|&#x22;/gi, '"')
      .replace(/&apos;|&#39;|&#x27;/gi, "'")
      .replace(/&amp;/gi, '&');
    return `<!--${directive}-->`;
  });
}

function parseImportJsonObject(response: string): Record<string, unknown> | null {
  const trimmed = response.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]?.trim();
  const jsonText = fenced ?? trimmed;
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function requireImportLlm(llm: HvyImportLlmOptions | undefined): HvyImportLlmOptions {
  if (!llm) {
    throw new Error('Import requires an LLM configuration.');
  }
  return llm;
}

function createImportLlmStepper(
  beforeLlmCall: BuildImportPlanOptions['beforeLlmCall'] | undefined,
  signal: AbortSignal | undefined
): ((phase: HvyLlmCallPhase) => ((debugLabel: string) => Promise<void>) | undefined) | undefined {
  if (!beforeLlmCall) {
    return undefined;
  }
  let callIndex = 0;
  return (phase) => async (debugLabel) => {
    throwIfAborted(signal);
    callIndex += 1;
    await beforeLlmCall({
      callIndex,
      debugLabel,
      phase,
    });
    throwIfAborted(signal);
  };
}
