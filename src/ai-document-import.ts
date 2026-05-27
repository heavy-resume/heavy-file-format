import { requestProxyCompletion, type HostChatClient, type ProxyCompletionParams } from './chat/chat';
import { deserializeDocumentWithDiagnostics, serializeBlockFragment, serializeDocumentHeaderYaml, serializeSectionFragment } from './serialization';
import type { GridItem, VisualBlock, VisualSection } from './editor/types';
import { cloneReusableBlock, cloneReusableSection, cloneReusableSchema, defaultBlockSchema } from './document-factory';
import { findSectionByKey, findSectionContainer, formatSectionTitle, getSectionId, visitBlocks } from './section-ops';
import type { ChatMessage, ChatSettings, ChatTokenUsage, ComponentDefinition, ComponentTemplateFlavor, SectionDefinition, SectionTemplateFlavor, VisualDocument } from './types';
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
  extractReusableTemplateVariablesFromFlavor,
  extractReusableTemplateVariablesFromSectionDefinition,
  extractReusableTemplateVariablesFromSectionFlavor,
  type ReusableTemplateVariable,
} from './reusable-template-values';
import { applyTextFillInValueAtIndex, findTextFillInMarkers, hasTextFillInMarker, removeTextFillInMarkers } from './text-fill-in';
import { runImportXrefPass } from './ai-import-xrefs';
import { validateLockedSectionStructure } from './locked-structure';

export type HvyImportProgressPhase = 'starting' | 'thinking' | 'linting' | 'complete';
type HvyLlmCallPhase = HvyImportProgressPhase | 'tool_call';
type HvyImportOperation = 'plan' | 'execute';

export interface HvyImportProgressEvent {
  phase: HvyImportProgressPhase;
  message?: string;
}

export interface HvyImportLlmOptions {
  settings: ChatSettings;
  client?: HostChatClient | null;
  stages?: Partial<Record<HvyImportLlmStage, ChatSettings>>;
}

export type HvyImportLlmStage =
  | 'sectionPlanner'
  | 'preplannedSectionPlanner'
  | 'additionalSections'
  | 'dedupe'
  | 'sectionDataCollection'
  | 'templateSectionWriter'
  | 'rawSectionWriter'
  | 'fillIns'
  | 'xrefs';

export interface HvyImportLlmStepEvent {
  callIndex: number;
  debugLabel: string;
  phase: HvyLlmCallPhase;
}

export interface HvyImportTraceRequest {
  settings: ChatSettings;
  messages: ChatMessage[];
  context: string;
  responseInstructions: string;
  systemInstructions?: string;
  mode: ProxyCompletionParams['mode'];
  maxContextChars?: number;
}

export interface HvyImportTraceResponse {
  output: string;
}

export interface HvyImportTraceCall {
  callIndex: number;
  stage: HvyImportLlmStage;
  debugLabel: string;
  phase: HvyLlmCallPhase;
  request: HvyImportTraceRequest;
  response?: HvyImportTraceResponse;
  error?: string;
}

export interface HvyImportTraceRun {
  calls: HvyImportTraceCall[];
}

export interface HvyImportTraceEvent {
  type: 'call-start' | 'call-complete' | 'call-error';
  run: HvyImportTraceRun;
  call: HvyImportTraceCall;
}

export interface HvyImportTokenUsageEvent {
  callIndex: number;
  stage: HvyImportLlmStage;
  debugLabel: string;
  phase: HvyLlmCallPhase;
  usage: ChatTokenUsage;
}

export interface HvyImportTraceRecorder {
  run: HvyImportTraceRun;
  recordCompletion(stage: HvyImportLlmStage, phase: HvyLlmCallPhase, params: ProxyCompletionParams): Promise<string>;
}

export interface BuildImportPlanOptions {
  sourceName?: string;
  sourceText: string;
  instructions?: string;
  llm?: HvyImportLlmOptions;
  requestMode?: ProxyCompletionParams['mode'];
  maxContextChars?: number;
  trace?: boolean;
  onTraceEvent?: (event: HvyImportTraceEvent) => void;
  onTokenUsage?: (event: HvyImportTokenUsageEvent) => void;
  beforeLlmCall?: (event: HvyImportLlmStepEvent) => Promise<void> | void;
  onProgress?: (event: HvyImportProgressEvent) => void;
  signal?: AbortSignal;
}

export interface BuildImportPlanResult {
  status: 'ready' | 'aborted' | 'error';
  steps?: ImportPlanStep[];
  message?: string;
  trace?: HvyImportTraceRun;
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
  preplanGroupIndex?: number;
  preplanTargetId?: string;
  extractedInformation?: string;
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
  sectionFlavors: ImportTemplateSectionFlavor[];
  lists: ImportTemplateListStructure[];
  componentDefs: ComponentDefinition[];
};

type ImportTemplateSectionFlavor = {
  name: string;
  description: string;
  variables: ReusableTemplateVariable[];
  template: VisualSection;
};

type ImportTemplateListStructure = {
  key: string;
  title: string;
  listBlockId: string;
  itemComponent: string;
  baseVariables: ReusableTemplateVariable[];
  variables: ReusableTemplateVariable[];
  itemTemplate: VisualBlock;
  flavors: ImportTemplateListFlavor[];
  jsonSchema: ImportTemplateJsonSchema;
};

type ImportTemplateListFlavor = {
  name: string;
  description: string;
  variables: ReusableTemplateVariable[];
  itemTemplate: VisualBlock;
};

type ImportTemplateFillInTarget = {
  name: string;
  label: string;
  blockId: string;
  markerIndex?: number;
};

const IMPORT_TEMPLATE_FLAVOR_FIELD = '_flavor';
const IMPORT_TEMPLATE_SECTION_FLAVOR_FIELD = '_sectionFlavor';
const IMPORT_STABLE_SYSTEM_INSTRUCTIONS = [
  'You are performing an HVY import workflow.',
  'Use the supplied import context only for this request.',
  'Return only the response format requested in the latest import task.',
].join('\n');

interface AppliedImportSectionResult {
  message: string;
  sectionKey: string;
}

interface CreatedImportXrefTarget {
  id: string;
  title: string;
  kind: string;
  sectionTitle: string;
  sectionId: string;
  sectionKey: string;
  component: string;
  text: string;
}

interface ImportFillInTarget {
  key: string;
  label: string;
  sectionKey: string;
  sectionTitle: string;
  blockId: string;
  block: VisualBlock;
  markerIndex?: number;
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
  preplanGroupIndex?: number;
  preplanTargetId?: string;
  extractedInformation?: string;
  target?: ImportPlanTarget;
};

export interface ImportFromTextOptions {
  sourceName?: string;
  sourceText: string;
  instructions?: string;
  steps: ImportPlanStepInput[];
  llm?: HvyImportLlmOptions;
  requestMode?: ProxyCompletionParams['mode'];
  maxContextChars?: number;
  trace?: boolean;
  onTraceEvent?: (event: HvyImportTraceEvent) => void;
  onTokenUsage?: (event: HvyImportTokenUsageEvent) => void;
  beforeLlmCall?: (event: HvyImportLlmStepEvent) => Promise<void> | void;
  onProgress?: (event: HvyImportProgressEvent) => void;
  signal?: AbortSignal;
}

export interface ImportFromTextResult {
  status: 'complete' | 'aborted' | 'error';
  message?: string;
  trace?: HvyImportTraceRun;
}

export async function buildImportPlanForDocument(
  document: VisualDocument,
  options: BuildImportPlanOptions
): Promise<BuildImportPlanResult> {
  const traceRecorder = createImportTraceRecorder(options);
  options.onProgress?.({ phase: 'starting', message: `Preparing import plan for ${formatImportSourceProgress(options.sourceName)}.` });
  try {
    const preplanSteps = buildImportPlanStepsFromPreplan(document);
    if (preplanSteps.length > 0) {
      const llm = requireImportLlm(options.llm);
      throwIfAborted(options.signal);
      const beforeLlmCall = createImportLlmStepper(options.beforeLlmCall, options.signal);
      options.onProgress?.({ phase: 'thinking', message: 'Extracting preplanned section information.' });
      const extractedSteps = await preparePreplannedImportSteps(document, options, preplanSteps, llm, beforeLlmCall, traceRecorder);
      const requestMode = getImportRequestMode(options);
      const filteredSteps = filterImportPlanStepsForRequestMode(extractedSteps, document, requestMode);
      if (filteredSteps.length === 0) {
        return withImportTrace({ status: 'error', message: 'The import preplan did not return usable source-backed sections.' }, options, traceRecorder);
      }
      options.onProgress?.({ phase: 'complete', message: 'Import plan is ready.' });
      return withImportTrace({ status: 'ready', steps: filteredSteps }, options, traceRecorder);
    }
    const llm = requireImportLlm(options.llm);
    throwIfAborted(options.signal);
    options.onProgress?.({ phase: 'thinking', message: 'Reviewing the template and imported document.' });
    const beforeLlmCall = createImportLlmStepper(options.beforeLlmCall, options.signal);
    const requestMode = getImportRequestMode(options);
    const response = await requestTracedImportCompletion(traceRecorder, 'sectionPlanner', 'thinking', {
      settings: getImportStageSettings(llm, 'sectionPlanner'),
      client: llm.client,
      messages: [
        {
          id: 'ai-import-plan-task',
          role: 'user',
          content: buildImportTaskMessage(
            buildImportPlanPrompt(options.sourceName, options.instructions, requestMode),
            buildImportPlanResponseInstructions(requestMode)
          ),
        },
      ],
      context: buildImportPlanContext(document, options.sourceName, options.sourceText),
      responseInstructions: buildImportPlanResponseInstructions(requestMode),
      systemInstructions: IMPORT_STABLE_SYSTEM_INSTRUCTIONS,
      mode: requestMode,
      maxContextChars: options.maxContextChars,
      debugLabel: 'ai-import-plan',
      beforeRequest: beforeLlmCall?.('thinking'),
      signal: options.signal,
    });
    throwIfAborted(options.signal);
    const steps = filterImportPlanStepsForRequestMode(parseImportPlanSteps(response, document), document, requestMode);
    if (steps.length === 0) {
      return withImportTrace({ status: 'error', message: 'The import planner did not return a usable plan.' }, options, traceRecorder);
    }
    options.onProgress?.({ phase: 'thinking', message: 'Deduping planned import sections.' });
    const dedupedSteps = await dedupeImportPlanStepsWithModel(steps, document, llm, beforeLlmCall, requestMode, options.maxContextChars, options.signal, traceRecorder);
    if (dedupedSteps.length === 0) {
      return withImportTrace({ status: 'error', message: 'The import planner did not return a usable plan after deduping.' }, options, traceRecorder);
    }
    options.onProgress?.({ phase: 'complete', message: 'Import plan is ready.' });
    return withImportTrace({ status: 'ready', steps: dedupedSteps }, options, traceRecorder);
  } catch (error) {
    if (isAbortError(error)) {
      return withImportTrace({ status: 'aborted', message: 'Import planning was aborted.' }, options, traceRecorder);
    }
    logImportFailure('plan', error, options, traceRecorder);
    return withImportTrace({ status: 'error', message: error instanceof Error ? error.message : 'Import planning failed.' }, options, traceRecorder);
  }
}

export async function importTextIntoDocument(
  document: VisualDocument,
  options: ImportFromTextOptions & {
    onMutation?: (group?: string) => void;
    onSectionApplied?: (result: string) => Promise<void> | void;
    onImportFillInsApplied?: (result: string) => Promise<void> | void;
    onImportXrefsApplied?: (result: string) => Promise<void> | void;
    onImportPrepared?: (result: string) => Promise<void> | void;
    onImportFinalized?: (result: string) => Promise<void> | void;
  }
): Promise<ImportFromTextResult> {
  const traceRecorder = createImportTraceRecorder(options);
  const steps = normalizeImportPlanSteps(options.steps, document);
  if (steps.length === 0) {
    return withImportTrace({ status: 'error', message: 'Import requires at least one approved plan step.' }, options, traceRecorder);
  }
  const pdfTemplateImportPlanError = validatePdfTemplateImportExecutablePlan(steps, document, getImportRequestMode(options));
  if (pdfTemplateImportPlanError) {
    return withImportTrace({ status: 'error', message: pdfTemplateImportPlanError }, options, traceRecorder);
  }
  options.onProgress?.({ phase: 'starting', message: `Importing ${formatImportSourceProgress(options.sourceName)}.` });
  try {
    const llm = requireImportLlm(options.llm);
    const beforeLlmCall = createImportLlmStepper(options.beforeLlmCall, options.signal);
    throwIfAborted(options.signal);
    for (const step of steps) {
      resolveImportStepApplication(document, step);
    }
    const executableSteps = steps;
    if (executableSteps.length === 0) {
      options.onProgress?.({ phase: 'complete', message: 'Imported 0 sections.' });
      return withImportTrace({ status: 'complete', message: 'Imported 0 sections.' }, options, traceRecorder);
    }
    const created: string[] = [];
    const appliedSections: AppliedImportSectionResult[] = [];
    const rawGeneratedSectionKeys: string[] = [];
    for (const [index, step] of executableSteps.entries()) {
      const application = resolveImportStepApplication(document, step);
      throwIfAborted(options.signal);
      if (step.importMode === 'template') {
        const templateStructure = resolveImportTemplateStructureForStep(document, step);
        if (!templateStructure) {
          return withImportTrace({ status: 'error', message: `Import section ${index + 1} does not have a usable template structure.` }, options, traceRecorder);
        }
        options.onProgress?.({ phase: 'thinking', message: `Filling template section ${index + 1} of ${steps.length}.` });
        const valuesMessages: ChatMessage[] = [
          {
            id: `ai-import-template-values-${index + 1}-task`,
            role: 'user',
            content: buildImportTaskMessage(
              buildImportTemplateValuesPrompt(options.sourceName, options.instructions, step, index, executableSteps.length),
              buildImportTemplateValuesResponseInstructions(templateStructure)
            ),
          },
        ];
        const valuesRequest: ProxyCompletionParams = {
          settings: getImportStageSettings(llm, 'templateSectionWriter'),
          client: llm.client,
          messages: valuesMessages,
          context: buildImportTemplateValuesContext(document, options.sourceName, options.sourceText, executableSteps, index, created, application, templateStructure, step.extractedInformation),
          responseInstructions: buildImportTemplateValuesResponseInstructions(templateStructure),
          systemInstructions: IMPORT_STABLE_SYSTEM_INSTRUCTIONS,
          mode: getImportRequestMode(options),
          maxContextChars: options.maxContextChars,
          debugLabel: `ai-import-template-values:${index + 1}`,
          beforeRequest: beforeLlmCall?.('thinking'),
          signal: options.signal,
        };
        let valuesResponse = await requestTracedImportCompletion(traceRecorder, 'templateSectionWriter', 'thinking', valuesRequest);
        throwIfAborted(options.signal);
        let values = parseImportTemplateValuesResponse(valuesResponse, templateStructure);
        if (values.ok === false) {
          options.onProgress?.({
            phase: 'thinking',
            message: `Template values for section ${index + 1} were invalid; retrying with the expected schema.`,
          });
          valuesResponse = await requestTracedImportCompletion(traceRecorder, 'templateSectionWriter', 'thinking', {
            ...valuesRequest,
            messages: [
              ...valuesRequest.messages,
              {
                id: `ai-import-template-values-${index + 1}-repair`,
                role: 'user',
                content: [
                  'The previous response was invalid.',
                  values.message,
                  '',
                  'Return one corrected JSON object using exactly the documented schema.',
                  'Include every required key, omit keys that are not in the schema, and use empty strings or empty arrays when source data is unavailable.',
                  '',
                  `Previous response:\n${valuesResponse}`,
                ].join('\n'),
              },
            ],
            debugLabel: `ai-import-template-values:${index + 1}:repair`,
            beforeRequest: beforeLlmCall?.('thinking'),
          });
          throwIfAborted(options.signal);
          values = parseImportTemplateValuesResponse(valuesResponse, templateStructure);
          if (values.ok === false) {
            return withImportTrace({ status: 'error', message: `Import section ${index + 1} returned invalid template values. ${values.message}` }, options, traceRecorder);
          }
        }
        options.onProgress?.({ phase: 'thinking', message: `Applying section ${index + 1}.` });
        const result = applyGeneratedImportTemplateSection(document, application, templateStructure, values.value, options.onMutation);
        created.push(result.message);
        appliedSections.push(result);
        await options.onSectionApplied?.(result.message);
        continue;
      }
      const information = step.extractedInformation;
      if (!information) {
        options.onProgress?.({ phase: 'thinking', message: `Extracting section data ${index + 1} of ${executableSteps.length}.` });
        const informationResponse = await requestTracedImportCompletion(traceRecorder, 'sectionDataCollection', 'thinking', {
          settings: getImportStageSettings(llm, 'sectionDataCollection'),
          client: llm.client,
          messages: [
            {
              id: `ai-import-section-data-${index + 1}-task`,
              role: 'user',
              content: buildImportTaskMessage(
                buildImportSectionInformationPrompt(options.sourceName, options.instructions, step, index, executableSteps.length),
                buildImportSectionInformationResponseInstructions()
              ),
            },
          ],
          context: buildImportSectionInformationContext(document, options.sourceName, options.sourceText, executableSteps, index, created, application),
          responseInstructions: buildImportSectionInformationResponseInstructions(),
          systemInstructions: IMPORT_STABLE_SYSTEM_INSTRUCTIONS,
          mode: getImportRequestMode(options),
          maxContextChars: options.maxContextChars,
          debugLabel: `ai-import-section-data:${index + 1}`,
          beforeRequest: beforeLlmCall?.('thinking'),
          signal: options.signal,
        });
        throwIfAborted(options.signal);
        step.extractedInformation = parseImportSectionInformationResponse(informationResponse) ?? undefined;
        if (!step.extractedInformation) {
          return withImportTrace({ status: 'error', message: `Import section ${index + 1} did not return usable section information.` }, options, traceRecorder);
        }
      }
      options.onProgress?.({ phase: 'thinking', message: `Generating HVY section ${index + 1} of ${executableSteps.length}.` });
      const hvyRequest: ProxyCompletionParams = {
        settings: getImportStageSettings(llm, 'rawSectionWriter'),
        client: llm.client,
        messages: [
          {
            id: `ai-import-section-hvy-${index + 1}-task`,
            role: 'user',
            content: buildImportTaskMessage(
              buildImportSectionHvyPrompt(options.sourceName, options.instructions, step, index, executableSteps.length),
              buildImportSectionHvyResponseInstructions()
            ),
          },
        ],
        context: buildImportSectionHvyContext(document, step.extractedInformation!, application),
        responseInstructions: buildImportSectionHvyResponseInstructions(),
        systemInstructions: IMPORT_STABLE_SYSTEM_INSTRUCTIONS,
        mode: getImportRequestMode(options),
        maxContextChars: options.maxContextChars,
        debugLabel: `ai-import-section-hvy:${index + 1}`,
        beforeRequest: beforeLlmCall?.('thinking'),
        signal: options.signal,
      };
      let hvyResponse = await requestTracedImportCompletion(traceRecorder, 'rawSectionWriter', 'thinking', hvyRequest);
      throwIfAborted(options.signal);
      let generated = parseAndValidateImportGeneratedSectionResponse(hvyResponse, document.meta, application);
      if (generated.ok === false) {
        options.onProgress?.({
          phase: 'thinking',
          message: `Generated HVY for section ${index + 1} was invalid; retrying with the validation error.`,
        });
        hvyResponse = await requestTracedImportCompletion(traceRecorder, 'rawSectionWriter', 'thinking', {
          ...hvyRequest,
          messages: [
            ...hvyRequest.messages,
            {
              id: `ai-import-section-hvy-${index + 1}-repair`,
              role: 'user',
              content: [
                'The previous response was invalid.',
                generated.message,
                '',
                'Return one corrected JSON object using exactly the documented schema.',
                'The `hvy` value must contain exactly one complete valid HVY section.',
                'Fix the parser or validation error directly. Do not include prose or markdown fences.',
                '',
                `Previous response:\n${hvyResponse}`,
              ].join('\n'),
            },
          ],
          debugLabel: `ai-import-section-hvy:${index + 1}:repair`,
          beforeRequest: beforeLlmCall?.('thinking'),
        });
        throwIfAborted(options.signal);
        generated = parseAndValidateImportGeneratedSectionResponse(hvyResponse, document.meta, application);
        if (generated.ok === false) {
          return withImportTrace({ status: 'error', message: `Import section ${index + 1} returned invalid HVY. ${generated.message}` }, options, traceRecorder);
        }
      }
      options.onProgress?.({ phase: 'thinking', message: `Applying section ${index + 1}.` });
      const result = applyGeneratedImportSection(document, application, generated.section, options.onMutation);
      created.push(result.message);
      appliedSections.push(result);
      rawGeneratedSectionKeys.push(result.sectionKey);
      await options.onSectionApplied?.(result.message);
    }
    const importedSectionKeys = appliedSections.map((result) => result.sectionKey).filter(Boolean);
    let createdTargets = collectCreatedImportXrefTargets(document, importedSectionKeys);
    const fillInTargets = collectImportFillInTargets(document, rawGeneratedSectionKeys);
    if (fillInTargets.length > 0) {
      options.onProgress?.({ phase: 'thinking', message: 'Filling remaining imported placeholders.' });
      await fillImportedSectionPlaceholders(document, options, llm, beforeLlmCall, traceRecorder, importedSectionKeys, createdTargets, fillInTargets);
      await options.onImportFillInsApplied?.('Filled remaining placeholders in imported sections.');
    }
    createdTargets = collectCreatedImportXrefTargets(document, importedSectionKeys);
    options.onProgress?.({ phase: 'thinking', message: 'Filling imported xref lists.' });
    const xrefsApplied = await runImportXrefPass(document, options, llm, beforeLlmCall, traceRecorder, importedSectionKeys, createdTargets);
    if (xrefsApplied > 0) {
      await options.onImportXrefsApplied?.(`Filled ${xrefsApplied} imported xref list${xrefsApplied === 1 ? '' : 's'}.`);
    }
    const message = `Imported ${created.length} section${created.length === 1 ? '' : 's'}.`;
    await options.onImportPrepared?.(message);
    if (fillInTargets.length > 0 || xrefsApplied > 0) {
      options.onMutation?.('ai-edit:import-finalize');
      await options.onImportFinalized?.(message);
    }
    options.onProgress?.({ phase: 'complete', message });
    return withImportTrace({ status: 'complete', message }, options, traceRecorder);
  } catch (error) {
    if (isAbortError(error)) {
      return withImportTrace({ status: 'aborted', message: 'Import was aborted.' }, options, traceRecorder);
    }
    logImportFailure('execute', error, options, traceRecorder, steps);
    return withImportTrace({ status: 'error', message: error instanceof Error ? error.message : 'Import failed.' }, options, traceRecorder);
  }
}

function buildImportPlanPrompt(sourceName: string | undefined, instructions: string | undefined, requestMode: ProxyCompletionParams['mode']): string {
  if (isPdfTemplateImportMode(requestMode)) {
    return buildPdfTemplateImportPlanPrompt(sourceName, instructions);
  }
  return [
    `Find the sections needed to create a document ${formatImportSourceReference(sourceName)}.`,
    '',
    'You have the current HVY template section outline and the incoming data in context. Do not use tools. Do not mutate anything.',
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

function buildPdfTemplateImportPlanPrompt(sourceName: string | undefined, instructions?: string): string {
  return [
    `Choose PHVY template slots to fill ${formatImportSourceReference(sourceName)}.`,
    '',
    'You have the PHVY PDF template section outline and incoming data in context. Do not use tools. Do not mutate anything.',
    'Treat the PHVY as a fixed PDF layout, not as a source document to duplicate.',
    'Plan from the available PHVY body sections and reusable/template definitions, not from the incoming data section list.',
    'Use each existing PHVY body section at most once.',
    'Merge, summarize, and prioritize incoming topics to fit the selected PHVY slots.',
    'Cut lower-priority incoming data when it does not fit the PHVY layout.',
    'Do not create arbitrary blank sections.',
    'Only plan optional extra sections from explicit reusable/template definitions that are marked repeatable.',
    'Use each reusable/template definition at most once; repeatable means the section may exist, not that it should be duplicated.',
    'Each step should name the PHVY slot or optional template section being filled. Keep the plan short.',
    'Do not copy specific source facts into the plan. Names, dates, entity names, labels, links, bullets, metrics, and other exact facts will be extracted in a later step.',
    'Use only facts present in the incoming data.',
    instructions?.trim() ? ['Additional import instructions:', instructions.trim()].join('\n') : '',
  ].filter(Boolean).join('\n');
}

function buildImportTaskMessage(prompt: string, responseInstructions: string): string {
  return [
    prompt.trim(),
    '',
    '=== BEGIN RESPONSE INSTRUCTIONS ===',
    responseInstructions.trim(),
    '=== END RESPONSE INSTRUCTIONS ===',
  ].join('\n');
}

function buildImportPlanContext(document: VisualDocument, sourceName: string | undefined, sourceText: string): string {
  return [
    buildImportGuidanceFrame(document),
    '',
    '=== BEGIN TEMPLATE SECTIONS ===',
    'Template section inventory for resolving section targets; this is not an ordering requirement:',
    buildImportTemplateSectionOutline(document),
    '=== END TEMPLATE SECTIONS ===',
    '',
    '=== BEGIN SOURCE DOCUMENT ===',
    ...formatImportSourceNameLines(sourceName),
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
      definition.repeatable ? 'repeatable' : '',
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

function formatImportSourceReference(sourceName: string | undefined): string {
  const name = trimImportString(sourceName);
  return name ? `from "${name}"` : 'from incoming data';
}

function formatImportSourceNameLines(sourceName: string | undefined): string[] {
  const name = trimImportString(sourceName);
  return name ? [`Source name: ${name}`] : [];
}

function formatImportSourceProgress(sourceName: string | undefined): string {
  return trimImportString(sourceName) || 'incoming data';
}

function getImportSectionDefinitions(document: VisualDocument): SectionDefinition[] {
  const definitions = document.meta.section_defs;
  return Array.isArray(definitions)
    ? definitions.filter((item): item is SectionDefinition => !!item && typeof item === 'object' && 'name' in item && 'template' in item)
    : [];
}

function buildImportPlanResponseInstructions(requestMode: ProxyCompletionParams['mode'] = 'document-edit'): string {
  if (isPdfTemplateImportMode(requestMode)) {
    return buildPdfTemplateImportPlanResponseInstructions();
  }
  return [
    'Return exactly one JSON object and no prose.',
    'Shape:',
    '{"steps":[{"section":"Blip Overview","sectionId":"blip-overview"},{"section":"Widget Records","templateName":"Widget Records"},{"section":"Extra Notes"}]}',
    '',
    'Use `sectionId` only for an existing body section id from the template section outline.',
    'Use `templateName` only for a reusable/template section name from the template section outline.',
    'When no listed section fits a distinct source-backed topic, include only `section` so execution may create a new blank section.',
    'Each step should be a section to create from the incoming data. Try to fit data to the template and only add sections if needed. Things outside the intent of the incoming data can be discarded.',
    'Do not include `instruction` unless a section title alone would be ambiguous.',
    'If `instruction` is needed, keep it structural and very short. Do not list exact facts.',
    'Do not copy specific source facts into the plan; do not include names, dates, entity names, labels, links, bullets, metrics, or other exact source details.',
    'Every step must be unconditional and source-backed. The planner must make the section decision now from the incoming data.',
    'Do not include steps containing conditional language such as "if", "only if", "otherwise", "as needed", "when needed", "if present", "if available", "if applicable", "unless", "may", "might", or "leave unmodified".',
    'Do not impose a step count limit. Use as many steps as needed so each final document section has its own step.',
    'Do not write bundled steps such as "add Alpha, Beta, Gamma, and Delta sections"; split that into one step per section.',
    'Do not include component-level steps such as "add each item card"; those details belong inside the later one-shot HVY section generation.',
  ].join('\n');
}

function buildPdfTemplateImportPlanResponseInstructions(): string {
  return [
    'Return exactly one JSON object and no prose.',
    'Shape:',
    '{"steps":[{"section":"Blip Overview","sectionId":"blip-overview"},{"section":"Widget Records","templateName":"Widget Records"}]}',
    '',
    'Use `sectionId` only for an existing PHVY body section id from the template section outline.',
    'Use `templateName` only for a reusable/template section name from the template section outline.',
    'Do not include steps with only `section`; PDF-template import must not create arbitrary blank sections.',
    'Use each existing PHVY body section id at most once.',
    'Use each reusable/template section at most once, even when the template outline marks it repeatable.',
    'Repeatable means a reusable/template section may be included as an optional section; repeated items belong inside that section, not in duplicate section steps.',
    'Plan one step per PHVY slot or optional template section to fill.',
    'Merge multiple incoming topics into the same PHVY slot when the template has fewer slots than the incoming data has sections.',
    'Omit lower-priority incoming data when it does not fit the PHVY layout.',
    'Do not include `instruction` unless a section title alone would be ambiguous.',
    'If `instruction` is needed, keep it structural and very short. Do not list exact facts.',
    'Do not copy specific source facts into the plan; do not include names, dates, entity names, labels, links, bullets, metrics, or other exact source details.',
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

async function dedupeImportPlanStepsWithModel(
  steps: ImportPlanStep[],
  document: VisualDocument,
  llm: HvyImportLlmOptions,
  beforeLlmCall: ReturnType<typeof createImportLlmStepper>,
  requestMode: ProxyCompletionParams['mode'],
  maxContextChars: number | undefined,
  signal?: AbortSignal,
  traceRecorder?: HvyImportTraceRecorder
): Promise<ImportPlanStep[]> {
  const dedupeSteps = filterImportPlanStepsForRequestMode(steps, document, requestMode);
  if (dedupeSteps.length <= 1) {
    return dedupeSteps;
  }
  const candidates = buildImportSectionDedupeCandidates(dedupeSteps);
  const response = await requestTracedImportCompletion(traceRecorder, 'dedupe', 'thinking', {
    settings: getImportStageSettings(llm, 'dedupe'),
    client: llm.client,
    messages: [
      {
        id: 'ai-import-section-dedupe-task',
        role: 'user',
        content: buildImportTaskMessage(
          buildImportSectionDedupePrompt(candidates, requestMode),
          buildImportSectionDedupeResponseInstructions(candidates)
        ),
      },
    ],
    context: '',
    responseInstructions: buildImportSectionDedupeResponseInstructions(candidates),
    systemInstructions: IMPORT_STABLE_SYSTEM_INSTRUCTIONS,
    mode: requestMode,
    maxContextChars,
    debugLabel: 'ai-import-section-dedupe',
    beforeRequest: beforeLlmCall?.('thinking'),
    signal,
  });
  throwIfAborted(signal);
  const keepIds = parseImportSectionDedupeResponse(response, candidates);
  const keepSet = new Set(keepIds);
  return filterImportPlanStepsForRequestMode(candidates.filter((candidate) => keepSet.has(candidate.id)).map((candidate) => candidate.step), document, requestMode);
}

interface ImportSectionDedupeCandidate {
  id: string;
  step: ImportPlanStep;
}

function buildImportSectionDedupeCandidates(steps: ImportPlanStep[]): ImportSectionDedupeCandidate[] {
  const used = new Set<string>();
  return steps.map((step) => {
    const base = getImportSectionDedupeCandidateBaseId(step);
    let id = base;
    let suffix = 2;
    while (used.has(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    used.add(id);
    return { id, step };
  });
}

function getImportSectionDedupeCandidateBaseId(step: ImportPlanStep): string {
  return slugImportSectionDedupeId(
    step.preplanTargetId
    || step.target.id
    || step.target.name
    || step.target.title
    || step.sectionTitle
  );
}

function slugImportSectionDedupeId(value: string | undefined): string {
  return normalizeImportMissingSectionTitle(value).replace(/\s+/g, '-') || 'section';
}

function buildImportSectionDedupePrompt(candidates: ImportSectionDedupeCandidate[], requestMode: ProxyCompletionParams['mode'] = 'document-edit'): string {
  if (isPdfTemplateImportMode(requestMode)) {
    return [
      'Deduplicate this candidate PDF-template import section list.',
      '',
      'You are given only PHVY slot candidates. Do not infer from incoming data. Do not use tools.',
      'Keep at most one section for each PHVY body or reusable/template target.',
      'Prefer sections listed first when candidates target the same slot.',
      'Keep multiple candidates only when they represent genuinely different PHVY slots.',
      'Do not keep blank section candidates.',
      '',
      'Candidate sections:',
      ...candidates.map((candidate) => `- id="${candidate.id}" ${formatImportPlanSectionDedupeCandidate(candidate.step)}`),
    ].join('\n');
  }
  return [
    'Deduplicate this candidate import section list.',
    '',
    'You are given only section candidates. Do not infer from incoming data. Do not use tools.',
    'Keep one section for each distinct final document role.',
    'When candidates have the same role, prefer an existing body section over a reusable/template section, and prefer either of those over a blank section.',
    'Only keep a blank section when no body or reusable/template candidate covers that same role.',
    'Prefer sections listed first.',
    'Drop later candidates that are basically the same section, a renamed version, or a subset/showcase/summary of another candidate.',
    'If two sections are genuinely different document roles, keep both.',
    '',
    'Candidate sections:',
    ...candidates.map((candidate) => `- id="${candidate.id}" ${formatImportPlanSectionDedupeCandidate(candidate.step)}`),
  ].join('\n');
}

function formatImportPlanSectionDedupeCandidate(step: ImportPlanStep): string {
  const targetLabel = formatImportPlanTarget(step.target);
  return [
    `section="${step.sectionTitle}"`,
    `target_kind="${step.target.kind}"`,
    `target="${targetLabel}"`,
  ].join(' ');
}

function buildImportSectionDedupeResponseInstructions(candidates: ImportSectionDedupeCandidate[]): string {
  return [
    'Return exactly one JSON object and no prose.',
    'Shape:',
    '{"keep":["section-id","another-section-id"]}',
    '',
    '`keep` must be an array of candidate id strings to keep.',
    `Use only these candidate ids: ${candidates.map((candidate) => candidate.id).join(', ')}.`,
    'Preserve the original order of kept candidates.',
    'Do not include duplicate ids.',
  ].join('\n');
}

function parseImportSectionDedupeResponse(response: string, candidates: ImportSectionDedupeCandidate[]): string[] {
  const parsed = parseImportJsonObject(response);
  const keep = parsed?.keep;
  if (!Array.isArray(keep)) {
    return [];
  }
  const allowed = new Set(candidates.map((candidate) => candidate.id));
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of keep) {
    const id = typeof value === 'string' ? value.trim() : '';
    if (!allowed.has(id) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(id);
  }
  return candidates.map((candidate) => candidate.id).filter((id) => seen.has(id));
}

type ImportPreplanGroup = {
  steps: ImportPlanStep[];
};

function buildImportPlanStepsFromPreplan(document: VisualDocument): ImportPlanStep[] {
  return getImportPreplanGroups(document).flatMap((group) => group.steps);
}

function getImportPreplanGroups(document: VisualDocument): ImportPreplanGroup[] {
  const raw = document.meta.importPreplan;
  if (!Array.isArray(raw)) {
    return [];
  }
  const candidates = getImportTemplateSectionCandidates(document);
  const groups: ImportPreplanGroup[] = [];
  raw.forEach((entry) => {
    const ids = (Array.isArray(entry) ? entry : [entry])
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean);
    const steps = ids.flatMap((id) => {
      const candidate = resolveImportPreplanTarget(id, candidates);
      if (!candidate) {
        return [];
      }
        const target = candidateToImportPlanTarget(candidate);
        const templateStructure = safeBuildImportTemplateStructureDescriptor(candidates, target);
        return [{
          sectionTitle: candidate.title,
          instruction: buildDefaultImportPlanInstruction(candidate.title),
          target,
          preplanGroupIndex: groups.length,
          preplanTargetId: id,
          ...(templateStructure ? { importMode: 'template' as const } : {}),
          ...(templateStructure ? { templateStructure: toPublicImportTemplateStructure(templateStructure) } : {}),
        }];
      });
    if (steps.length > 0) {
      groups.push({ steps });
    }
  });
  return groups;
}

function resolveImportPreplanTarget(id: string, candidates: ImportTemplateSectionCandidate[]): ImportTemplateSectionCandidate | null {
  const body = candidates.find((candidate) => candidate.source === 'body' && candidate.id === id);
  if (body) {
    return body;
  }
  const definitionByKey = candidates.find((candidate) => candidate.source === 'definition' && candidate.definitionKey === id);
  if (definitionByKey) {
    return definitionByKey;
  }
  return candidates.find((candidate) => candidate.source === 'definition' && candidate.id === id) ?? null;
}

async function preparePreplannedImportSteps(
  document: VisualDocument,
  options: Pick<BuildImportPlanOptions, 'sourceName' | 'sourceText' | 'instructions' | 'onProgress' | 'signal' | 'requestMode' | 'maxContextChars'>,
  steps: ImportPlanStep[],
  llm: HvyImportLlmOptions,
  beforeLlmCall: ReturnType<typeof createImportLlmStepper>,
  traceRecorder?: HvyImportTraceRecorder
): Promise<ImportPlanStep[]> {
  const extracted: ImportPlanStep[] = [];
  const groups = groupImportPreplanSteps(steps);
  for (const [groupIndex, groupSteps] of groups.entries()) {
    options.onProgress?.({ phase: 'thinking', message: `Extracting import group ${groupIndex + 1} of ${groups.length}.` });
    const response = await requestTracedImportCompletion(traceRecorder, 'preplannedSectionPlanner', 'thinking', {
      settings: getImportStageSettings(llm, 'preplannedSectionPlanner'),
      client: llm.client,
      messages: [
        {
          id: 'ai-import-preplan-source',
          role: 'user',
          content: buildImportPreplanDataSourceMessage(options.sourceName, options.sourceText, steps),
        },
        {
          id: `ai-import-preplan-data-${groupIndex + 1}-task`,
          role: 'user',
          content: buildImportTaskMessage(
            buildImportPreplanDataTaskMessage(document, options.sourceName, options.instructions, groupSteps, groupIndex, groups.length),
            buildImportPreplanDataResponseInstructions()
          ),
        },
      ],
      context: '',
      responseInstructions: buildImportPreplanDataResponseInstructions(),
      systemInstructions: IMPORT_STABLE_SYSTEM_INSTRUCTIONS,
      mode: getImportRequestMode(options),
      maxContextChars: options.maxContextChars,
      debugLabel: `ai-import-preplan-data:${groupIndex + 1}`,
      beforeRequest: beforeLlmCall?.('thinking'),
      signal: options.signal,
    });
    throwIfAborted(options.signal);
    const informationById = parseImportPreplanDataResponse(response);
    for (const step of groupSteps) {
      const id = getImportPlanStepTargetId(step);
      const information = id ? informationById.get(id) : '';
      if (information) {
        extracted.push({ ...step, extractedInformation: information });
      }
    }
  }
  options.onProgress?.({ phase: 'thinking', message: 'Checking for missing import sections.' });
  const missingResponse = await requestTracedImportCompletion(traceRecorder, 'additionalSections', 'thinking', {
    settings: getImportStageSettings(llm, 'additionalSections'),
    client: llm.client,
    messages: [
      {
        id: 'ai-import-missing-sections-task',
        role: 'user',
        content: buildImportTaskMessage(
          buildImportMissingSectionsPrompt(options.sourceName, options.instructions),
          buildImportMissingSectionsResponseInstructions()
        ),
      },
    ],
    context: buildImportMissingSectionsContext(document, options.sourceName, options.sourceText, steps, extracted),
    responseInstructions: buildImportMissingSectionsResponseInstructions(),
    systemInstructions: IMPORT_STABLE_SYSTEM_INSTRUCTIONS,
    mode: getImportRequestMode(options),
    maxContextChars: options.maxContextChars,
    debugLabel: 'ai-import-missing-sections',
    beforeRequest: beforeLlmCall?.('thinking'),
    signal: options.signal,
  });
  throwIfAborted(options.signal);
  const missingSteps = parseImportMissingSectionsResponse(missingResponse, document, steps, extracted);
  const candidates = [...extracted, ...missingSteps];
  if (candidates.length <= 1) {
    return candidates;
  }
  return dedupeImportPlanStepsWithModel(candidates, document, llm, beforeLlmCall, getImportRequestMode(options), options.maxContextChars, options.signal, traceRecorder);
}

function groupImportPreplanSteps(steps: ImportPlanStep[]): ImportPlanStep[][] {
  const groups = new Map<number, ImportPlanStep[]>();
  for (const step of steps) {
    const index = typeof step.preplanGroupIndex === 'number' ? step.preplanGroupIndex : groups.size;
    const group = groups.get(index) ?? [];
    group.push(step);
    groups.set(index, group);
  }
  return [...groups.entries()].sort(([left], [right]) => left - right).map(([, group]) => group);
}

function getImportPlanStepTargetId(step: ImportPlanStep): string {
  return step.preplanTargetId || step.target.id || step.target.name || step.sectionTitle;
}

function buildImportPreplanDataSourceMessage(
  sourceName: string | undefined,
  sourceText: string,
  steps: ImportPlanStep[]
): string {
  return [
    '=== BEGIN SOURCE DOCUMENT ===',
    ...formatImportSourceNameLines(sourceName),
    '```text',
    sourceText,
    '```',
    '=== END SOURCE DOCUMENT ===',
    '',
    'Approved import section plan:',
    ...steps.map((step, stepIndex) => `${stepIndex + 1}. ${formatImportPlanStep(step)} (${formatImportPlanTarget(step.target)})`),
  ].join('\n');
}

function buildImportPreplanDataTaskMessage(
  document: VisualDocument,
  sourceName: string | undefined,
  instructions: string | undefined,
  groupSteps: ImportPlanStep[],
  index: number,
  total: number
): string {
  return [
    `Extract source information for import group ${index + 1} of ${total} ${formatImportSourceReference(sourceName)}.`,
    '',
    '=== BEGIN TARGET SECTION APPLICATIONS ===',
    groupSteps.map((step) => {
      const application = resolveImportStepApplication(document, step);
      return [
        `Target key: ${getImportPlanStepTargetId(step)}`,
        buildImportSectionApplicationFrame(document, application),
      ].join('\n');
    }).join('\n\n'),
    '=== END TARGET SECTION APPLICATIONS ===',
    '',
    '=== BEGIN CURRENT TASK ===',
    'Extract and organize only source facts relevant to the listed target sections.',
    'Return one object keyed by the exact section ids listed in the response instructions.',
    'For section ids with actual source facts, return an object with `import_selection` and `information`.',
    'Set `import_selection` to `has_data_include` only when `information` contains concrete source-backed facts for that section.',
    'If a section has no source-backed facts, omit the key or return an object with `import_selection: "no_data_exclude"`.',
    'Use this grouped pass to distinguish confusable categories before assigning facts, such as skills versus tools or technologies.',
    'Use only facts present in the imported source text. Do not invent dates, titles, entity names, labels, categories, metrics, links, or other factual details.',
    'Do not treat template availability, matched section names, placeholders, descriptions, or schema labels as source facts.',
    'Preserve exact source dates, names, titles, entity names, labels, category names, and terminology unless the approved step or host instructions explicitly say to normalize them.',
    '',
    'Target section ids for this group:',
    ...groupSteps.map((step) => `- ${getImportPlanStepTargetId(step)}`),
    '',
    buildImportGuidanceFrame(document),
    instructions?.trim() ? ['Additional import instructions:', instructions.trim()].join('\n') : '',
    '=== END CURRENT TASK ===',
  ].filter(Boolean).join('\n');
}

function buildImportPreplanDataResponseInstructions(): string {
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['sections'],
    properties: {
      sections: {
        type: 'object',
        additionalProperties: {
          type: 'object',
          additionalProperties: false,
          required: ['import_selection', 'information'],
          properties: {
            import_selection: { type: 'string', enum: ['has_data_include', 'no_data_exclude'] },
            information: { type: 'string' },
          },
        },
      },
    },
  };
  return [
    'Return exactly one JSON object and no prose.',
    'Use this JSON schema:',
    JSON.stringify(schema),
    '',
    '`sections` must be an object keyed only by exact section ids listed in the latest user task.',
    'Each value must be an object with `import_selection` and `information`.',
    '`import_selection` must be `has_data_include` only when `information` contains concrete source facts for this section.',
    '`import_selection` must be `no_data_exclude` when the section has no concrete source facts.',
    '`information` must be a concise text document of only the imported facts used for that section.',
    'Do not use `has_data_include` for statements that merely say information is missing, absent, generic, unavailable, or not source-backed.',
    'An omitted key, an empty string value, or an object with `import_selection: "no_data_exclude"` means the section is excluded.',
  ].join('\n');
}

function parseImportPreplanDataResponse(response: string): Map<string, string> {
  const parsed = parseImportJsonObject(response);
  const sections = parsed?.sections;
  const result = new Map<string, string>();
  if (!sections || typeof sections !== 'object' || Array.isArray(sections)) {
    return result;
  }
  for (const [key, value] of Object.entries(sections as Record<string, unknown>)) {
    const information = parseImportPreplanSectionInformation(value);
    if (information) {
      result.set(key, information);
    }
  }
  return result;
}

function parseImportPreplanSectionInformation(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return '';
  }
  const section = value as { import_selection?: unknown; information?: unknown };
  if (section.import_selection !== 'has_data_include') {
    return '';
  }
  return typeof section.information === 'string' ? section.information.trim() : '';
}

function buildImportMissingSectionsPrompt(sourceName: string | undefined, instructions?: string): string {
  return [
    `Identify missing import sections ${formatImportSourceReference(sourceName)}.`,
    '',
    'Review what the preplanned import has already seen, then add only source-backed sections that are still missing and needed.',
    'You may choose a remaining body section, a reusable section template, or a blank section as the starting point.',
    'Do not duplicate any section or fact already assigned to a preplanned section.',
    'Use only facts present in the imported source text.',
    instructions?.trim() ? ['Additional import instructions:', instructions.trim()].join('\n') : '',
  ].filter(Boolean).join('\n');
}

function buildImportMissingSectionsContext(
  document: VisualDocument,
  sourceName: string | undefined,
  sourceText: string,
  allPreplanSteps: ImportPlanStep[],
  extractedSteps: ImportPlanStep[]
): string {
  const seenTargets = new Set(allPreplanSteps.map((step) => formatImportPlanTarget(step.target)));
  const remaining = getImportTemplateSectionCandidates(document)
    .filter((candidate) => candidate.sectionDefinition?.repeatable === true || !seenTargets.has(formatImportPlanTarget(candidateToImportPlanTarget(candidate))));
  return [
    buildImportGuidanceFrame(document),
    '',
    '=== BEGIN SOURCE DOCUMENT ===',
    ...formatImportSourceNameLines(sourceName),
    '```text',
    sourceText,
    '```',
    '=== END SOURCE DOCUMENT ===',
    '',
    '=== BEGIN ALREADY SEEN SECTIONS ===',
    extractedSteps.length > 0
      ? extractedSteps.map((step) => `- ${getImportPlanStepTargetId(step)}: ${step.extractedInformation}`).join('\n')
      : '- No preplanned sections returned source-backed information.',
    '=== END ALREADY SEEN SECTIONS ===',
    '',
    '=== BEGIN REMAINING STARTING POINTS ===',
    remaining.length > 0
      ? remaining.map((candidate) => {
        const target = candidateToImportPlanTarget(candidate);
        return `- ${formatImportPlanTarget(target)}`;
      }).join('\n')
      : '- No unused body sections or reusable section templates remain.',
    '- blank section: use only for a distinct source-backed missing topic that would not duplicate any already seen or remaining section.',
    '=== END REMAINING STARTING POINTS ===',
  ].join('\n');
}

function buildImportMissingSectionsResponseInstructions(): string {
  return [
    'Return exactly one JSON object and no prose.',
    'Shape:',
    '{"sections":{"Blip Records":{"target":{"kind":"definition","name":"Blip Section"},"information":"Source-backed facts."},"Widget Notes":{"target":{"kind":"blank","title":"Widget Notes"},"information":"Source-backed facts."}}}',
    '',
    '`sections` is an object whose keys are new section names.',
    '`target` may be a body section, definition section, or blank section using the same target shape as import plan steps.',
    'Use a body or definition target only when it exactly matches one listed remaining starting point. Otherwise use a blank section target.',
    'Use a blank section target only for source-backed information that cannot reasonably belong to an existing, planned, body, or definition section.',
    'Do not use a blank section target for a topic that is a renamed version, showcase, summary, or subset of an already seen body or definition section.',
    'Do not invent body ids, definition names, reusable template names, or aliases.',
    '`information` is a concise text document of only the source facts for that missing section.',
    'Return {"sections":{}} when no source-backed sections are missing.',
  ].join('\n');
}

function parseImportMissingSectionsResponse(
  response: string,
  document: VisualDocument,
  allPreplanSteps: ImportPlanStep[],
  extractedSteps: ImportPlanStep[]
): ImportPlanStep[] {
  const parsed = parseImportJsonObject(response);
  const sections = parsed?.sections;
  if (!sections || typeof sections !== 'object' || Array.isArray(sections)) {
    return [];
  }
  const seenTargets = new Set([...allPreplanSteps, ...extractedSteps].map((step) => formatImportPlanTarget(step.target)));
  const seenSectionTitles = new Set(
    [...allPreplanSteps, ...extractedSteps]
      .flatMap((step) => [step.sectionTitle, step.target.title])
      .map(normalizeImportMissingSectionTitle)
      .filter(Boolean)
  );
  const candidates = getImportTemplateSectionCandidates(document);
  const result: ImportPlanStep[] = [];
  for (const [sectionName, raw] of Object.entries(sections as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      continue;
    }
    const value = raw as { target?: unknown; information?: unknown };
    const information = typeof value.information === 'string' ? value.information.trim() : '';
    if (!information) {
      continue;
    }
    const title = sectionName.trim() || 'Imported Section';
    if (seenSectionTitles.has(normalizeImportMissingSectionTitle(title))) {
      continue;
    }
    const normalizedTarget = normalizeImportPlanTarget(value.target, candidates, title);
    const candidate = findImportCandidateForTarget(candidates, normalizedTarget);
    const target = normalizedTarget.kind !== 'blank' && !candidate
      ? { kind: 'blank' as const, title }
      : normalizedTarget;
    const targetCandidate = findImportCandidateForTarget(candidates, target);
    if (seenTargets.has(formatImportPlanTarget(target)) && targetCandidate?.sectionDefinition?.repeatable !== true) {
      continue;
    }
    const templateStructure = safeBuildImportTemplateStructureDescriptor(candidates, target);
    result.push({
      sectionTitle: title,
      instruction: buildDefaultImportPlanInstruction(title),
      target,
      extractedInformation: information,
      ...(templateStructure ? { importMode: 'template' as const, templateStructure: toPublicImportTemplateStructure(templateStructure) } : {}),
    });
  }
  return result;
}

function normalizeImportMissingSectionTitle(value: string | undefined): string {
  return trimImportString(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
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

function filterImportPlanStepsForRequestMode(
  steps: ImportPlanStep[],
  document: VisualDocument,
  requestMode: ProxyCompletionParams['mode']
): ImportPlanStep[] {
  if (!isPdfTemplateImportMode(requestMode)) {
    return steps;
  }
  const candidates = getImportTemplateSectionCandidates(document);
  const usedTargets = new Set<string>();
  return steps.filter((step) => {
    if (step.target.kind === 'blank') {
      return false;
    }
    const candidate = findImportCandidateForTarget(candidates, step.target);
    if (!candidate) {
      return false;
    }
    const key = formatImportPlanTarget(candidateToImportPlanTarget(candidate));
    if (usedTargets.has(key)) {
      return false;
    }
    usedTargets.add(key);
    return true;
  });
}

function validatePdfTemplateImportExecutablePlan(
  steps: ImportPlanStep[],
  document: VisualDocument,
  requestMode: ProxyCompletionParams['mode']
): string | null {
  if (!isPdfTemplateImportMode(requestMode)) {
    return null;
  }
  const candidates = getImportTemplateSectionCandidates(document);
  const usedTargets = new Map<string, number>();
  for (const [index, step] of steps.entries()) {
    if (step.target.kind === 'blank') {
      return `PDF template import cannot create a blank section for import section ${index + 1}.`;
    }
    const candidate = findImportCandidateForTarget(candidates, step.target);
    if (!candidate) {
      return `PDF template import target was not found for import section ${index + 1}: ${formatImportPlanTarget(step.target)}.`;
    }
    const key = formatImportPlanTarget(candidateToImportPlanTarget(candidate));
    const previous = usedTargets.get(key);
    if (previous !== undefined) {
      return `PDF template import cannot use non-repeatable target "${key}" for both import section ${previous + 1} and ${index + 1}.`;
    }
    usedTargets.set(key, index);
  }
  return null;
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
    const templateStructure = safeBuildImportTemplateStructureDescriptor(candidates, target);
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
    preplanGroupIndex?: unknown;
    preplanTargetId?: unknown;
    extractedInformation?: unknown;
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
  const templateStructure = safeBuildImportTemplateStructureDescriptor(candidates, target);
  const templateStructureId = typeof value.templateStructureId === 'string' && value.templateStructureId.trim()
    ? value.templateStructureId.trim()
    : undefined;
  const preplanGroupIndex = typeof value.preplanGroupIndex === 'number' && Number.isInteger(value.preplanGroupIndex)
    ? value.preplanGroupIndex
    : undefined;
  const preplanTargetId = typeof value.preplanTargetId === 'string' && value.preplanTargetId.trim()
    ? value.preplanTargetId.trim()
    : undefined;
  const extractedInformation = typeof value.extractedInformation === 'string' && value.extractedInformation.trim()
    ? value.extractedInformation.trim()
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
    ...(importMode || templateStructure ? { importMode: importMode ?? 'template' } : {}),
    ...(templateStructureId ? { templateStructureId } : {}),
    ...(templateStructure ? { templateStructure: toPublicImportTemplateStructure(templateStructure) } : {}),
    ...(preplanGroupIndex !== undefined ? { preplanGroupIndex } : {}),
    ...(preplanTargetId ? { preplanTargetId } : {}),
    ...(extractedInformation ? { extractedInformation } : {}),
  };
}

function safeBuildImportTemplateStructureDescriptor(candidates: ImportTemplateSectionCandidate[], target: ImportPlanTarget): ImportTemplateStructureInternal | null {
  try {
    return buildImportTemplateStructureDescriptor(candidates, target);
  } catch (error) {
    console.debug('[hvy:import-plan] template structure unavailable', error);
    return null;
  }
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
  const sectionFlavors = getImportTemplateSectionFlavors(candidate.sectionDefinition).map((flavor) => {
    const flavorListVariableNames = new Set(
      collectImportTemplateListStructures(flavor.template, candidate.componentDefs)
        .flatMap((list) => list.variables.map((variable) => variable.name))
    );
    const flavorFillInVariables = collectImportTemplateSectionFillInVariables(flavor.template)
      .filter((variable) => !flavor.variables.some((existing) => existing.name === variable.name));
    return {
      ...flavor,
      variables: mergeImportTemplateVariables([flavor.variables, flavorFillInVariables])
        .filter((variable) => !flavorListVariableNames.has(variable.name)),
    };
  });
  const sectionVariables = (candidate.sectionDefinition
    ? extractReusableTemplateVariablesFromSectionDefinition(candidate.sectionDefinition)
    : extractReusableTemplateVariables(candidate.section))
    .filter((variable) => !listVariableNames.has(variable.name));
  const sectionFillInVariables = collectImportTemplateSectionFillInVariables(candidate.section)
    .filter((variable) => !listVariableNames.has(variable.name) && !sectionVariables.some((existing) => existing.name === variable.name));
  const effectiveSectionVariables = mergeImportTemplateVariables([sectionVariables, sectionFillInVariables]);
  const allSectionVariables = mergeImportTemplateVariables([
    effectiveSectionVariables,
    ...sectionFlavors.map((flavor) => flavor.variables),
  ]);
  const properties: Record<string, ImportTemplateJsonSchemaProperty> = {};
  const required: string[] = [];
  if (sectionFlavors.length > 0) {
    properties[IMPORT_TEMPLATE_SECTION_FLAVOR_FIELD] = {
      type: 'string',
      title: 'Section flavor',
      description: `Choose one section template flavor: ${sectionFlavors.map((flavor) => `${flavor.name} (${flavor.description || 'No description'})`).join('; ')}.`,
    };
    required.push(IMPORT_TEMPLATE_SECTION_FLAVOR_FIELD);
  }
  for (const variable of allSectionVariables) {
    properties[variable.name] = templateVariableToJsonSchemaProperty(variable);
  }
  if (sectionFlavors.length === 0) {
    for (const variable of effectiveSectionVariables) {
      required.push(variable.name);
    }
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
    sectionVariables: effectiveSectionVariables,
    sectionFlavors,
    lists,
    componentDefs: candidate.componentDefs,
  };
}

function hasImportTemplateStructureFields(structure: ImportTemplateStructureInternal): boolean {
  return structure.sectionVariables.length > 0 || structure.sectionFlavors.length > 0 || structure.lists.length > 0;
}

function getImportTemplateSectionFlavors(definition: SectionDefinition | undefined): ImportTemplateSectionFlavor[] {
  if (!definition || !Array.isArray(definition.flavors)) {
    return [];
  }
  const flavors = definition.flavors
    .filter((flavor): flavor is SectionTemplateFlavor & { name: string } => !!flavor && typeof flavor === 'object' && typeof flavor.name === 'string' && flavor.name.trim().length > 0 && !!flavor.template)
    .map((flavor) => ({
      name: flavor.name.trim(),
      description: typeof flavor.description === 'string' ? flavor.description.trim() : '',
      variables: extractReusableTemplateVariablesFromSectionFlavor(flavor),
      template: cloneReusableSection(flavor.template),
    }));
  return flavors.length > 1 ? flavors : [];
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

function collectImportTemplateSectionFillInVariables(section: VisualSection): ReusableTemplateVariable[] {
  const used = new Set<string>();
  const variables: ReusableTemplateVariable[] = [];
  collectImportTemplateFillInVariablesFromSection(section, used, variables);
  return variables;
}

function collectImportTemplateFillInVariablesFromSection(section: VisualSection, used: Set<string>, variables: ReusableTemplateVariable[]): void {
  collectImportTemplateFillInVariablesFromBlocks(section.blocks, used, variables);
  for (const child of section.children) {
    collectImportTemplateFillInVariablesFromSection(child, used, variables);
  }
}

function collectImportTemplateFillInVariablesFromBlock(block: VisualBlock): ReusableTemplateVariable[] {
  const variables: ReusableTemplateVariable[] = [];
  collectImportTemplateFillInVariablesFromBlocks([block], new Set(), variables);
  return variables;
}

function collectImportTemplateFillInVariablesFromBlocks(blocks: VisualBlock[], used: Set<string>, variables: ReusableTemplateVariable[]): void {
  for (const block of blocks) {
    collectImportTemplateFillInVariablesForBlock(block, used, variables);
    collectImportTemplateFillInVariablesFromBlocks(block.schema.containerBlocks ?? [], used, variables);
    collectImportTemplateFillInVariablesFromBlocks(block.schema.componentListBlocks ?? [], used, variables);
    collectImportTemplateFillInVariablesFromBlocks(block.schema.gridItems?.map((item) => item.block) ?? [], used, variables);
    collectImportTemplateFillInVariablesFromBlocks(block.schema.expandableStubBlocks?.children ?? [], used, variables);
    collectImportTemplateFillInVariablesFromBlocks(block.schema.expandableContentBlocks?.children ?? [], used, variables);
  }
}

function collectImportTemplateFillInVariablesForBlock(block: VisualBlock, used: Set<string>, variables: ReusableTemplateVariable[]): void {
  const targets = collectImportTemplateFillInTargetsForBlock(block, used);
  for (const target of targets) {
    variables.push({ name: target.name, type: 'text', label: target.label });
  }
}

function uniqueImportTemplateVariableName(base: string, used: Set<string>): string {
  let name = base || 'value';
  let index = 2;
  while (used.has(name)) {
    name = `${base || 'value'}_${index}`;
    index += 1;
  }
  used.add(name);
  return name;
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
  const def = componentDefs.find((item) => item.name === itemComponent);
  const flavors = getImportTemplateListFlavors(def, itemComponent);
  const baseVariables = block.schema.componentListBlocks.length > 0
    ? extractReusableTemplateVariables(itemTemplate)
    : getImportTemplateListItemVariables(itemTemplate, itemComponent, componentDefs);
  const baseFillInVariables = collectImportTemplateFillInVariablesFromBlock(itemTemplate)
    .filter((variable) => !baseVariables.some((existing) => existing.name === variable.name));
  const effectiveBaseVariables = mergeImportTemplateVariables([baseVariables, baseFillInVariables]);
  const variables = mergeImportTemplateVariables([
    effectiveBaseVariables,
    ...flavors.map((flavor) => flavor.variables),
  ]);
  if (variables.length === 0) {
    return null;
  }
  const properties: Record<string, ImportTemplateJsonSchemaProperty> = {};
  const required: string[] = [];
  if (flavors.length > 0) {
    properties[IMPORT_TEMPLATE_FLAVOR_FIELD] = {
      type: 'string',
      title: 'Flavor',
      description: `Choose one component template flavor for this item: ${flavors.map((flavor) => `${flavor.name} (${flavor.description || 'No description'})`).join('; ')}.`,
    };
    required.push(IMPORT_TEMPLATE_FLAVOR_FIELD);
  }
  for (const variable of variables) {
    properties[variable.name] = templateVariableToJsonSchemaProperty(variable);
  }
  if (flavors.length === 0) {
    for (const variable of effectiveBaseVariables) {
      required.push(variable.name);
    }
  }
  const baseKey = block.schema.id.trim() || itemComponent || 'items';
  const key = uniqueImportTemplateListKey(toImportJsonPropertyName(baseKey), usedKeys);
  return {
    key,
    title: block.schema.componentListItemLabel.trim() || itemComponent || key,
    listBlockId: block.schema.id.trim() || block.id,
    itemComponent,
    baseVariables: effectiveBaseVariables,
    variables,
    itemTemplate,
    flavors,
    jsonSchema: {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    },
  };
}

function getImportTemplateListFlavors(def: ComponentDefinition | undefined, itemComponent: string): ImportTemplateListFlavor[] {
  if (!def || !Array.isArray(def.flavors)) {
    return [];
  }
  const flavors = def.flavors
    .filter((flavor): flavor is ComponentTemplateFlavor & { name: string } => !!flavor && typeof flavor === 'object' && typeof flavor.name === 'string' && flavor.name.trim().length > 0)
    .map((flavor) => {
      const itemTemplate = createImportTemplateFlavorBlock(flavor, itemComponent);
      const variables = extractReusableTemplateVariablesFromFlavor(flavor);
      const fillInVariables = collectImportTemplateFillInVariablesFromBlock(itemTemplate)
        .filter((variable) => !variables.some((existing) => existing.name === variable.name));
      return {
        name: flavor.name.trim(),
        description: typeof flavor.description === 'string' ? flavor.description.trim() : '',
        variables: mergeImportTemplateVariables([variables, fillInVariables]),
        itemTemplate,
      };
    })
    .filter((flavor) => flavor.variables.length > 0);
  return flavors.length > 1 ? flavors : [];
}

function createImportTemplateFlavorBlock(flavor: ComponentTemplateFlavor, itemComponent: string): VisualBlock {
  if (flavor.template) {
    const item = cloneReusableBlock(flavor.template);
    item.schema.component = itemComponent;
    return item;
  }
  if (flavor.schema) {
    return {
      id: '',
      text: '',
      schema: cloneReusableSchema(flavor.schema, itemComponent),
      schemaMode: false,
    };
  }
  return {
    id: '',
    text: '',
    schema: defaultBlockSchema(itemComponent),
    schemaMode: false,
  };
}

function mergeImportTemplateVariables(groups: ReusableTemplateVariable[][]): ReusableTemplateVariable[] {
  const byName = new Map<string, ReusableTemplateVariable>();
  for (const group of groups) {
    for (const variable of group) {
      if (!byName.has(variable.name)) {
        byName.set(variable.name, variable);
      }
    }
  }
  return [...byName.values()];
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
  return value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_') || 'items';
}

function buildImportSectionInformationPrompt(sourceName: string | undefined, instructions: string | undefined, step: ImportPlanStep, index: number, total: number): string {
  return [
    `Extract source information for one import section ${formatImportSourceReference(sourceName)}.`,
    '',
    `Approved section step ${index + 1} of ${total}: ${formatImportPlanStep(step)}`,
    '',
    'Extract and organize only the source facts relevant to this one approved section.',
    'Do not generate HVY in this step.',
    'Use only facts present in the imported source text. Do not invent dates, titles, entity names, labels, categories, metrics, links, or other factual details.',
    'Preserve exact source dates, names, titles, entity names, labels, category names, and terminology unless the approved step or host instructions explicitly say to normalize them.',
    instructions?.trim() ? ['Additional import instructions:', instructions.trim()].join('\n') : '',
  ].filter(Boolean).join('\n');
}

function buildImportSectionInformationContext(
  document: VisualDocument,
  sourceName: string | undefined,
  sourceText: string,
  steps: ImportPlanStep[],
  activeIndex: number,
  createdSections: string[],
  application: ImportStepApplication
): string {
  return [
    buildImportGuidanceFrame(document),
    '',
    '=== BEGIN SOURCE DOCUMENT ===',
    ...formatImportSourceNameLines(sourceName),
    '```text',
    sourceText,
    '```',
    '=== END SOURCE DOCUMENT ===',
    '',
    buildImportSectionApplicationFrame(document, application),
    '',
    buildImportRelationshipFrame(document),
    '',
    'Approved import section plan:',
    ...steps.map((step, index) => `${index + 1}. ${index < activeIndex ? '[created]' : index === activeIndex ? '[current]' : '[pending]'} ${formatImportPlanStep(step)} (${formatImportPlanTarget(step.target)})`),
    ...(createdSections.length > 0 ? ['', 'Previously created section results:', ...createdSections] : []),
  ].join('\n');
}

function buildImportSectionHvyPrompt(sourceName: string | undefined, instructions: string | undefined, step: ImportPlanStep, index: number, total: number): string {
  return [
    `Generate one complete HVY section ${formatImportSourceReference(sourceName)}.`,
    '',
    `Approved section step ${index + 1} of ${total}: ${formatImportPlanStep(step)}`,
    '',
    'Use the extracted section information as the source of truth for facts.',
    'Build the section as raw HVY using the matched template as structural guidance.',
    'Reuse the template component shapes where they fit, including custom record components, component-list items, tables, and containers.',
    'IDs are for navigation and exact xref targets. Do not repeat IDs and do not add IDs to local layout/prose components just to name them.',
    'Do not put `id` on xref-card components; xref-card points at another component with `xrefTarget` and does not need its own navigation ID.',
    'When reusing a matched grid, preserve the template grid shape, `gridColumns`, slot count, and slot order. Do not add extra grid cells for prose, notes, accomplishments, or repeated records.',
    'For custom components whose base type is expandable, put `<!--hvy:expandable:stub {}-->` and `<!--hvy:expandable:content {}-->` directly under the custom component directive. Do not create a separate sibling `<!--hvy:expandable {}-->` block.',
    'Use LLM-only closing comments for every nested container, component-template/custom component, component-list item slot, and expandable slot, for example `<!-- /container -->`, `<!-- /foo-record -->`, `<!-- /component-list:0 -->`, `<!-- /expandable:stub -->`. These closing comments are required.',
    'Do not close only the slots; close the containing component-template/custom component too, for example `<!-- /foo-record -->` after its expandable slots.',
    'Leave template fill-in placeholders alone when the source has no value for them. Do not replace a fill-in with an empty text block.',
    'When this section creates records that other sections may reference, give those records stable source-backed ids.',
    'Do not create xref-card entries or fill xref component lists in this step. A final backend xref pass will create those after all sections and fill-ins are complete.',
    'Return exactly one top-level section. Do not return multiple sections. Do not return a component fragment without its section wrapper.',
    'Return raw HVY only; do not call or describe tools.',
    'Do not HTML-escape HVY directives. Use literal `<!--` and `-->`, not `&lt;!--` or `--&gt;`.',
    'Do not use facts that are not present in the extracted section information.',
    instructions?.trim() ? ['Additional import instructions:', instructions.trim()].join('\n') : '',
  ].filter(Boolean).join('\n');
}

function buildImportSectionHvyContext(document: VisualDocument, information: string, application: ImportStepApplication): string {
  return [
    buildImportGuidanceFrame(document),
    '',
    '=== BEGIN HVY FORMAT REFERENCE ===',
    'The following HVY document is a syntax and component reference only. It is not the task, not the incoming data, and not the output contract.',
    'Use it to understand valid HVY section/component structure and examples. Follow the separate response instructions for what to return.',
    '',
    importHvyFormatReference.trim(),
    '=== END HVY FORMAT REFERENCE ===',
    '',
    buildImportSectionApplicationFrame(document, application),
    '',
    buildImportRelationshipFrame(document),
    '',
    buildImportParagraphStyleFrame(document),
    '',
    '=== BEGIN SECTION INFORMATION ===',
    information,
    '=== END SECTION INFORMATION ===',
  ].join('\n');
}

function buildImportTemplateValuesPrompt(sourceName: string | undefined, instructions: string | undefined, step: ImportPlanStep, index: number, total: number): string {
  return [
    `Fill one HVY template JSON object ${formatImportSourceReference(sourceName)}.`,
    '',
    `Approved section step ${index + 1} of ${total}: ${formatImportPlanStep(step)}`,
    '',
    'Return only source-backed JSON values that fit the provided schema.',
    'Use empty strings for scalar fields that have no source-backed value.',
    'Use empty arrays for repeatable lists that have no source-backed items.',
    'Preserve exact source dates, names, titles, entity names, labels, category names, and terminology unless host instructions explicitly say to normalize them.',
    instructions?.trim() ? ['Additional import instructions:', instructions.trim()].join('\n') : '',
  ].filter(Boolean).join('\n');
}

function buildImportTemplateValuesContext(
  document: VisualDocument,
  sourceName: string | undefined,
  sourceText: string,
  steps: ImportPlanStep[],
  activeIndex: number,
  createdSections: string[],
  application: ImportStepApplication,
  templateStructure: ImportTemplateStructureInternal,
  extractedInformation?: string
): string {
  const sourceOrInformationFrame = extractedInformation?.trim()
    ? [
      '=== BEGIN SECTION INFORMATION ===',
      extractedInformation.trim(),
      '=== END SECTION INFORMATION ===',
    ].join('\n')
    : [
      '=== BEGIN SOURCE DOCUMENT ===',
      ...formatImportSourceNameLines(sourceName),
      '```text',
      sourceText,
      '```',
      '=== END SOURCE DOCUMENT ===',
    ].join('\n');
  return [
    buildImportGuidanceFrame(document),
    '',
    sourceOrInformationFrame,
    '',
    buildImportSectionApplicationFrame(document, application),
    '',
    buildImportRelationshipFrame(document),
    '',
    ...(hasImportTemplateFlavorOptions(templateStructure) ? ['', buildImportTemplateFlavorFrame(templateStructure)] : []),
    '',
    '=== BEGIN TEMPLATE JSON SCHEMA ===',
    JSON.stringify(templateStructure.jsonSchema, null, 2),
    '=== END TEMPLATE JSON SCHEMA ===',
    '',
    'Approved import section plan:',
    ...steps.map((planStep, index) => `${index + 1}. ${index < activeIndex ? '[created]' : index === activeIndex ? '[current]' : '[pending]'} ${formatImportPlanStep(planStep)} (${formatImportPlanTarget(planStep.target)})`),
    ...(createdSections.length > 0 ? ['', 'Previously created section results:', ...createdSections] : []),
  ].join('\n');
}

function hasImportTemplateFlavorOptions(templateStructure: ImportTemplateStructureInternal): boolean {
  return templateStructure.sectionFlavors.length > 0 || templateStructure.lists.some((list) => list.flavors.length > 0);
}

function buildImportTemplateFlavorFrame(templateStructure: ImportTemplateStructureInternal): string {
  const lines: string[] = [];
  if (templateStructure.sectionFlavors.length > 0) {
    lines.push(`Section template "${templateStructure.label}" has flavor options:`);
    for (const flavor of templateStructure.sectionFlavors) {
      lines.push(`- ${flavor.name}: ${flavor.description || 'No description provided.'}`);
      lines.push(`  Variables for ${flavor.name}: ${formatImportTemplateVariableNames(flavor.variables)}`);
      const flavorLists = getImportTemplateListsForSectionFlavor(templateStructure, flavor);
      for (const list of flavorLists) {
        lines.push(`  List "${list.key}" variables for ${flavor.name}: ${formatImportTemplateVariableNames(list.baseVariables)}`);
      }
    }
    lines.push('');
  }
  for (const list of templateStructure.lists) {
    if (list.flavors.length === 0) {
      continue;
    }
    lines.push(`List "${list.key}" uses component template "${list.itemComponent}" and has flavor options:`);
    for (const flavor of list.flavors) {
      lines.push(`- ${flavor.name}: ${flavor.description || 'No description provided.'}`);
      lines.push(`  Variables for ${flavor.name}: ${formatImportTemplateVariableNames(flavor.variables)}`);
    }
  }
  return [
    '=== BEGIN TEMPLATE FLAVORS ===',
    [
      'If `_sectionFlavor` is required, pick the best section template flavor before filling the remaining fields.',
      'For each item in a listed array, pick the best `_flavor` from these options before filling the remaining fields.',
      'After choosing a flavor, fill the variables for that chosen template. Do not include variables from a different unchosen template.',
      ...lines,
    ].join('\n'),
    '=== END TEMPLATE FLAVORS ===',
  ].join('\n');
}

function formatImportTemplateVariableNames(variables: ReusableTemplateVariable[]): string {
  return variables.length > 0 ? variables.map((variable) => variable.name).join(', ') : '(none)';
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
  definitionKey: string;
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
  const sectionDefinitions = getImportSectionDefinitions(document);
  const appendSections = (sections: VisualSection[]): void => {
    for (const section of sections) {
      if (section.exclude_from_import === true) {
        continue;
      }
      const sectionDefinition = findImportSectionDefinitionForBodySection(sectionDefinitions, section);
      candidates.push({
        title: trimImportString(section.title) || trimImportString(section.customId) || 'Untitled section',
        id: trimImportString(section.customId),
        definitionKey: '',
        name: '',
        section,
        source: 'body',
        componentDefs,
        sectionDefinition,
      });
      appendSections(section.children);
    }
  };
  appendSections(document.sections);
  for (const definition of sectionDefinitions) {
    if (definition.template.exclude_from_import === true) {
      continue;
    }
    candidates.push({
      title: trimImportString(definition.name) || trimImportString(definition.template.title) || trimImportString(definition.template.customId) || 'Untitled section',
      id: trimImportString(definition.template.customId),
      definitionKey: getImportSectionDefinitionKey(definition),
      name: trimImportString(definition.name),
      section: definition.template,
      source: 'definition',
      componentDefs,
      sectionDefinition: definition,
    });
  }
  return candidates;
}

function findImportSectionDefinitionForBodySection(definitions: SectionDefinition[], section: VisualSection): SectionDefinition | undefined {
  const templateKey = trimImportString(section.templateKey);
  if (templateKey) {
    const byTemplateKey = definitions.find((definition) => getImportSectionDefinitionKey(definition) === templateKey);
    if (byTemplateKey) {
      return byTemplateKey;
    }
  }
  const sectionId = trimImportString(section.customId);
  return sectionId
    ? definitions.find((definition) => trimImportString(definition.template.customId) === sectionId)
    : undefined;
}

function getImportSectionDefinitionKey(definition: SectionDefinition): string {
  return trimImportString(definition.key) || trimImportString(definition.name);
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
    serializeImportMatchedSectionTemplate(application.target.section, document.meta),
    '=== END MATCHED SECTION TEMPLATE ===',
    reusableDefinitionFrame,
    '=== END SECTION APPLICATION ===',
  ].filter(Boolean).join('\n');
}

function serializeImportMatchedSectionTemplate(section: VisualSection, documentMeta: VisualDocument['meta']): string {
  const template = cloneImportPromptSection(section);
  dedupeRedundantImportPromptBlocks(template.blocks, documentMeta);
  template.children.forEach((child) => dedupeRedundantImportPromptSection(child, documentMeta));
  return serializeSectionFragment(template, documentMeta);
}

function cloneImportPromptSection(section: VisualSection): VisualSection {
  return {
    ...section,
    blocks: section.blocks.map((block) => cloneReusableBlock(block)),
    children: section.children.map(cloneImportPromptSection),
  };
}

function dedupeRedundantImportPromptSection(section: VisualSection, documentMeta: VisualDocument['meta']): void {
  dedupeRedundantImportPromptBlocks(section.blocks, documentMeta);
  section.children.forEach((child) => dedupeRedundantImportPromptSection(child, documentMeta));
}

function dedupeRedundantImportPromptBlocks(blocks: VisualBlock[], documentMeta: VisualDocument['meta']): void {
  for (const block of blocks) {
    dedupeRedundantImportPromptBlocks(getImportPromptBlocks(block.schema.containerBlocks), documentMeta);
    dedupeRedundantImportPromptBlocks(getImportPromptBlocks(block.schema.componentListBlocks), documentMeta);
    for (const item of getImportPromptGridItems(block.schema.gridItems)) {
      dedupeRedundantImportPromptBlocks([item.block], documentMeta);
    }
    dedupeRedundantImportPromptBlocks(getImportPromptBlocks(block.schema.expandableStubBlocks?.children), documentMeta);
    dedupeRedundantImportPromptBlocks(getImportPromptBlocks(block.schema.expandableContentBlocks?.children), documentMeta);

    if (resolveBaseComponentFromMeta(block.schema.component, documentMeta) !== 'component-list') {
      continue;
    }
    const seen = new Set<string>();
    block.schema.componentListBlocks = getImportPromptBlocks(block.schema.componentListBlocks).filter((item) => {
      const key = getImportPromptListItemDedupeKey(item, documentMeta);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }
}

function getImportPromptBlocks(value: unknown): VisualBlock[] {
  return Array.isArray(value) ? value.filter(isImportPromptBlock) : [];
}

function getImportPromptGridItems(value: unknown): GridItem[] {
  return Array.isArray(value)
    ? value.filter((item): item is GridItem => !!item && typeof item === 'object' && isImportPromptBlock((item as GridItem).block))
    : [];
}

function isImportPromptBlock(value: unknown): value is VisualBlock {
  return !!value && typeof value === 'object' && !!(value as VisualBlock).schema;
}

function getImportPromptListItemDedupeKey(block: VisualBlock, documentMeta: VisualDocument['meta']): string {
  return serializeBlockFragment(block, documentMeta).replace(/\s+/g, ' ').trim();
}

function buildImportReusableDefinitionFrame(document: VisualDocument, section: VisualSection): string {
  const componentDefs = collectImportReferencedComponentDefinitions(document, section);
  if (componentDefs.length === 0) {
    return '';
  }
  return [
    '=== BEGIN MATCHED REUSABLE DEFINITIONS ===',
    'Component template examples referenced by the matched section/template, including nested component templates:',
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
    block.schema.containerBlocks = getImportPromptBlocks(block.schema.containerBlocks);
    if (block.schema.containerBlocks.length === 0) {
      block.schema.containerBlocks.push(createImportExampleTextBlock('Example child content.'));
    }
    block.schema.containerTitle ||= 'Example group';
  } else if (baseType === 'expandable') {
    block.schema.expandableStubBlocks = block.schema.expandableStubBlocks ?? { lock: false, children: [] };
    block.schema.expandableContentBlocks = block.schema.expandableContentBlocks ?? { lock: false, children: [] };
    if (block.schema.expandableStubBlocks.children.length === 0) {
      block.schema.expandableStubBlocks.children.push(createImportExampleTextBlock('Example summary'));
    }
    if (block.schema.expandableContentBlocks.children.length === 0) {
      block.schema.expandableContentBlocks.children.push(createImportExampleTextBlock('Example expanded details.'));
    }
    block.schema.expandableAlwaysShowStub = true;
  } else if (baseType === 'component-list') {
    block.schema.componentListComponent ||= 'text';
    block.schema.componentListBlocks = getImportPromptBlocks(block.schema.componentListBlocks);
    if (block.schema.componentListBlocks.length === 0) {
      block.schema.componentListBlocks.push(createImportExampleTextBlock('Example list item.'));
    }
  } else if (baseType === 'grid') {
    block.schema.gridColumns = block.schema.gridColumns || 2;
    block.schema.gridItems = getImportPromptGridItems(block.schema.gridItems);
    if (block.schema.gridItems.length === 0) {
      block.schema.gridItems.push(
        { id: 'example-left', block: createImportExampleTextBlock('Left example content.') },
        { id: 'example-right', block: createImportExampleTextBlock('Right example content.') }
      );
    }
  } else if (baseType === 'table') {
    block.schema.tableColumns = Array.isArray(block.schema.tableColumns) ? block.schema.tableColumns : [];
    block.schema.tableRows = Array.isArray(block.schema.tableRows) ? block.schema.tableRows : [];
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
): AppliedImportSectionResult {
  if (application.kind === 'blank') {
    throw new Error('Forced template import requires a matched template section.');
  }
  const generated = instantiateImportTemplateSection(document, application.target.section, templateStructure, values);
  onMutation?.('ai-edit:section');
  if (application.kind === 'replace') {
    const target = application.target.section;
    const location = findSectionContainer(document.sections, target.key);
    if (!location) {
      throw new Error(`Matched section "${target.title}" could not be found.`);
    }
    adjustImportSectionLevel(generated, target.level);
    generated.key = target.key;
    generated.customId = trimImportString(target.customId) || application.target.id || generated.customId;
    location.container.splice(location.index, 1, generated);
    return {
      message: `Replaced section "${target.title}" with "${generated.title}" (${getSectionId(generated)}).`,
      sectionKey: generated.key,
    };
  }
  adjustImportSectionLevel(generated, 1);
  document.sections.push(generated);
  return {
    message: `Inserted section "${generated.title}" (${getSectionId(generated)}) at the bottom.`,
    sectionKey: generated.key,
  };
}

function instantiateImportTemplateSection(document: VisualDocument, template: VisualSection, templateStructure: ImportTemplateStructureInternal, values: ImportTemplateValues): VisualSection {
  const sectionFlavorName = typeof values[IMPORT_TEMPLATE_SECTION_FLAVOR_FIELD] === 'string' ? values[IMPORT_TEMPLATE_SECTION_FLAVOR_FIELD].trim() : '';
  const sectionFlavor = templateStructure.sectionFlavors.find((flavor) => flavor.name === sectionFlavorName);
  const section = cloneReusableSection(sectionFlavor?.template ?? template);
  markImportedSectionVisible(section);
  const sectionVariables = sectionFlavor?.variables ?? templateStructure.sectionVariables;
  const lists = getImportTemplateListsForSectionFlavor(templateStructure, sectionFlavor);
  const scalarValues: Record<string, string> = {};
  for (const variable of sectionVariables) {
    const value = values[variable.name];
    scalarValues[variable.name] = typeof value === 'string' ? value : '';
  }
  applyReusableSectionTemplateValues(section, scalarValues, sectionVariables);
  applyImportTemplateFillInValuesToSection(section, scalarValues);
  const usedIds = collectImportUsedIds(document);
  if (section.customId.trim()) {
    usedIds.add(section.customId.trim());
  }
  for (const list of lists) {
    replaceImportTemplateListItems(document, section, list, Array.isArray(values[list.key]) ? values[list.key] as Array<Record<string, string>> : [], usedIds);
  }
  return section;
}

function mergeImportTemplateListStructures(baseLists: ImportTemplateListStructure[], selectedLists: ImportTemplateListStructure[]): ImportTemplateListStructure[] {
  return baseLists.map((baseList) => selectedLists.find((selectedList) => selectedList.key === baseList.key || selectedList.itemComponent === baseList.itemComponent) ?? baseList);
}

function getImportTemplateListsForSectionFlavor(
  templateStructure: ImportTemplateStructureInternal,
  sectionFlavor?: ImportTemplateSectionFlavor
): ImportTemplateListStructure[] {
  if (!sectionFlavor) {
    return templateStructure.lists;
  }
  return mergeImportTemplateListStructures(
    templateStructure.lists,
    collectImportTemplateListStructures(sectionFlavor.template, templateStructure.componentDefs)
  );
}

function replaceImportTemplateListItems(document: VisualDocument, section: VisualSection, list: ImportTemplateListStructure, items: Array<Record<string, string>>, usedIds: Set<string>): void {
  const block = findImportTemplateListBlock(section.blocks, list.listBlockId, list.itemComponent);
  if (!block) {
    return;
  }
  block.schema.componentListBlocks = items.map((itemValues) => {
    const flavorName = itemValues[IMPORT_TEMPLATE_FLAVOR_FIELD]?.trim() ?? '';
    const flavor = list.flavors.find((candidate) => candidate.name === flavorName);
    const item = cloneReusableBlock(flavor?.itemTemplate ?? list.itemTemplate);
    if (list.itemComponent) {
      item.schema.component = list.itemComponent;
    }
    const { [IMPORT_TEMPLATE_FLAVOR_FIELD]: _flavor, ...templateValues } = itemValues;
    const variables = flavor?.variables ?? list.baseVariables;
    applyReusableTemplateValues(item, templateValues, variables);
    applyImportTemplateFillInValuesToBlock(item, templateValues);
    autoPopulateImportTemplateItemId(document, item, itemValues, variables, usedIds);
    return item;
  });
}

function applyImportTemplateFillInValuesToSection(section: VisualSection, values: Record<string, string>): void {
  const used = new Set<string>();
  applyImportTemplateFillInValuesToBlocks(section.blocks, values, used);
  for (const child of section.children) {
    applyImportTemplateFillInValuesToSectionWithUsed(child, values, used);
  }
}

function applyImportTemplateFillInValuesToSectionWithUsed(section: VisualSection, values: Record<string, string>, used: Set<string>): void {
  applyImportTemplateFillInValuesToBlocks(section.blocks, values, used);
  for (const child of section.children) {
    applyImportTemplateFillInValuesToSectionWithUsed(child, values, used);
  }
}

function applyImportTemplateFillInValuesToBlock(block: VisualBlock, values: Record<string, string>): void {
  applyImportTemplateFillInValuesToBlocks([block], values, new Set());
}

function applyImportTemplateFillInValuesToBlocks(blocks: VisualBlock[], values: Record<string, string>, used: Set<string>): void {
  for (const block of blocks) {
    applyImportTemplateFillInValuesForBlock(block, values, used);
    applyImportTemplateFillInValuesToBlocks(block.schema.containerBlocks ?? [], values, used);
    applyImportTemplateFillInValuesToBlocks(block.schema.componentListBlocks ?? [], values, used);
    applyImportTemplateFillInValuesToBlocks(block.schema.gridItems?.map((item) => item.block) ?? [], values, used);
    applyImportTemplateFillInValuesToBlocks(block.schema.expandableStubBlocks?.children ?? [], values, used);
    applyImportTemplateFillInValuesToBlocks(block.schema.expandableContentBlocks?.children ?? [], values, used);
  }
}

function applyImportTemplateFillInValuesForBlock(block: VisualBlock, values: Record<string, string>, used: Set<string>): void {
  const targets = collectImportTemplateFillInTargetsForBlock(block, used);
  if (targets.length === 0) {
    return;
  }
  const markerTargets = targets.filter((target) => typeof target.markerIndex === 'number');
  for (const target of markerTargets) {
    const value = values[target.name]?.trim();
    if (value) {
      block.text = applyTextFillInValueAtIndex(block.text, target.markerIndex!, value);
    }
  }
  const wholeBlockTarget = targets.find((target) => target.markerIndex === undefined);
  const wholeBlockValue = wholeBlockTarget ? values[wholeBlockTarget.name]?.trim() : '';
  if (wholeBlockValue && block.schema.fillIn === true) {
    block.text = wholeBlockValue;
  }
  if (block.schema.fillIn === true && !hasTextFillInMarker(block.text) && block.text.trim().length > 0) {
    block.schema.fillIn = false;
  }
}

function collectImportTemplateFillInTargetsForBlock(block: VisualBlock, used: Set<string>): ImportTemplateFillInTarget[] {
  if (resolveBaseComponentFromMeta(block.schema.component, null) !== 'text') {
    return [];
  }
  const markers = findTextFillInMarkers(block.text);
  if (markers.length === 0 && block.schema.fillIn !== true) {
    return [];
  }
  if (markers.length === 0) {
    const label = trimImportString(block.schema.placeholder) || firstImportVisibleText(block) || trimImportString(block.schema.id) || 'value';
    const name = uniqueImportTemplateVariableName(toImportJsonPropertyName(label), used);
    return [{
      name,
      label: label.trim() || humanizeImportId(name) || 'Value',
      blockId: trimImportString(block.schema.id),
    }];
  }
  return markers.map((marker, markerIndex) => {
    const label = marker.placeholder || trimImportString(block.schema.placeholder) || trimImportString(block.schema.id) || 'value';
    const name = uniqueImportTemplateVariableName(toImportJsonPropertyName(label), used);
    return {
      name,
      label: label.trim() || humanizeImportId(name) || 'Value',
      blockId: trimImportString(block.schema.id),
      markerIndex,
    };
  });
}

function autoPopulateImportTemplateItemId(
  document: VisualDocument,
  item: VisualBlock,
  values: Record<string, string>,
  variables: ReusableTemplateVariable[],
  usedIds: Set<string>
): void {
  if (item.schema.id.trim() || !isImportTemplateItemLikelyXrefTarget(document, item)) {
    return;
  }
  const source = item.schema.xrefTitle.trim()
    || firstImportVisibleText(item)
    || variables.map((variable) => values[variable.name]?.trim()).find(Boolean)
    || '';
  const id = uniqueImportGeneratedId(toImportStableId(source), usedIds);
  if (id) {
    item.schema.id = id;
  }
}

function isImportTemplateItemLikelyXrefTarget(document: VisualDocument, item: VisualBlock): boolean {
  const base = resolveBaseComponentFromMeta(item.schema.component, document.meta);
  return item.schema.tags.trim().length > 0
    || item.schema.xrefTitle.trim().length > 0
    || item.schema.xrefDetail.trim().length > 0
    || (item.schema.component.trim().length > 0 && item.schema.component !== base);
}

function collectImportUsedIds(document: VisualDocument): Set<string> {
  const ids = new Set<string>();
  const visitSection = (section: VisualSection): void => {
    const sectionId = getSectionId(section).trim();
    if (sectionId) {
      ids.add(sectionId);
    }
    visitBlocks([section], (block) => {
      const id = block.schema.id.trim();
      if (id) {
        ids.add(id);
      }
    });
    section.children.forEach(visitSection);
  };
  document.sections.forEach(visitSection);
  return ids;
}

function uniqueImportGeneratedId(base: string, usedIds: Set<string>): string {
  if (!base) {
    return '';
  }
  let id = base;
  let index = 2;
  while (usedIds.has(id)) {
    id = `${base}-${index}`;
    index += 1;
  }
  usedIds.add(id);
  return id;
}

function toImportStableId(value: string): string {
  return value.trim().toLowerCase()
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .slice(0, 80);
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
  const title = trimImportString(block.schema.xrefTitle)
    || trimImportString(block.schema.containerTitle)
    || firstImportVisibleText(block)
    || humanizeImportId(trimImportString(block.schema.id))
    || block.schema.component;
  return title;
}

function describeImportXrefTargetDetail(block: VisualBlock): string {
  return trimImportString(block.schema.xrefDetail) || trimImportString(block.schema.description);
}

function firstImportVisibleText(block: VisualBlock): string {
  const own = trimImportString(block.text).replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').trim();
  if (own) {
    return own.slice(0, 120);
  }
  const tableRows = Array.isArray(block.schema.tableRows) ? block.schema.tableRows : [];
  for (const row of tableRows) {
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
  generated: VisualSection,
  onMutation?: (group?: string) => void
): AppliedImportSectionResult {
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
    return {
      message: `Replaced section "${target.title}" with "${generated.title}" (${getSectionId(generated)}).`,
      sectionKey: generated.key,
    };
  }
  adjustImportSectionLevel(generated, 1);
  document.sections.push(generated);
  return {
    message: `Inserted section "${generated.title}" (${getSectionId(generated)}) at the bottom.`,
    sectionKey: generated.key,
  };
}

function parseImportGeneratedSectionResponse(
  response: string,
  documentMeta: VisualDocument['meta']
): { ok: true; section: VisualSection } | { ok: false; message: string } {
  const hvy = parseImportSectionHvyResponse(response);
  if (!hvy) {
    return { ok: false, message: 'Return valid JSON with a top-level `hvy` string containing one complete HVY section.' };
  }
  try {
    return { ok: true, section: parseGeneratedImportSection(hvy, documentMeta) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

function parseAndValidateImportGeneratedSectionResponse(
  response: string,
  documentMeta: VisualDocument['meta'],
  application: ImportStepApplication
): { ok: true; section: VisualSection } | { ok: false; message: string } {
  const generated = parseImportGeneratedSectionResponse(response, documentMeta);
  if (generated.ok === false) {
    return generated;
  }
  if (application.kind !== 'blank') {
    preserveTemplateFillIns(generated.section, application.target.section);
  }
  const errors = validateGeneratedImportLocks(application, generated.section, documentMeta);
  if (errors.length > 0) {
    return {
      ok: false,
      message: [
        'Generated HVY changes locked template content.',
        ...errors.map((error) => `- ${error}`),
      ].join('\n'),
    };
  }
  return generated;
}

function validateGeneratedImportLocks(
  application: ImportStepApplication,
  generated: VisualSection,
  documentMeta: VisualDocument['meta']
): string[] {
  if (application.kind === 'blank') {
    return [];
  }
  return validateLockedSectionStructure(application.target.section, generated, documentMeta)
    .map((error) => error.message);
}

function collectCreatedImportXrefTargets(document: VisualDocument, sectionKeys: string[]): CreatedImportXrefTarget[] {
  const targets: CreatedImportXrefTarget[] = [];
  const seen = new Set<string>();
  for (const sectionKey of sectionKeys) {
    const section = findSectionByKey(document.sections, sectionKey);
    if (!section) {
      continue;
    }
    const sectionId = getSectionId(section);
    if (sectionId && !seen.has(sectionId)) {
      seen.add(sectionId);
      targets.push({
        id: sectionId,
        title: formatSectionTitle(section.title),
        kind: 'section',
        sectionTitle: formatSectionTitle(section.title),
        sectionId,
        sectionKey,
        component: 'section',
        text: section.description.trim(),
      });
    }
    visitBlocks([section], (block) => {
      const id = block.schema.id.trim();
      if (!id || seen.has(id)) {
        return;
      }
      seen.add(id);
      targets.push({
        id,
        title: describeImportXrefTargetBlock(block),
        kind: resolveBaseComponentFromMeta(block.schema.component, document.meta),
        sectionTitle: formatSectionTitle(section.title),
        sectionId,
        sectionKey,
        component: block.schema.component,
        text: firstImportVisibleText(block) || describeImportXrefTargetDetail(block),
      });
    });
  }
  return targets;
}

function collectImportFillInTargets(document: VisualDocument, sectionKeys: string[]): ImportFillInTarget[] {
  const targets: ImportFillInTarget[] = [];
  for (const sectionKey of sectionKeys) {
    const section = findSectionByKey(document.sections, sectionKey);
    if (!section) {
      continue;
    }
    visitBlocks([section], (block) => {
      const blockId = trimImportString(block.schema.id);
      const fillInKeys = findTextFillInMarkers(block.text);
      const placeholder = trimImportString(block.schema.placeholder);
      const isBlankPlaceholder = placeholder.length > 0
        && block.text.trim().length === 0
        && resolveBaseComponentFromMeta(block.schema.component, document.meta) === 'text';
      const useWholeBlockFillIn = block.schema.fillIn === true
        && (fillInKeys.length === 0 || isImportPureFillInMarkerText(block.text));
      if (!blockId && block.schema.fillIn !== true && fillInKeys.length === 0 && !isBlankPlaceholder) {
        return;
      }
      const key = blockId || uniqueImportGeneratedId(toImportStableId(`${formatSectionTitle(section.title)} ${placeholder || 'placeholder'}`), new Set(targets.map((target) => target.key)));
      if (useWholeBlockFillIn) {
        targets.push({
          key,
          label: placeholder || firstImportVisibleText(block) || blockId,
          sectionKey,
          sectionTitle: formatSectionTitle(section.title),
          blockId: blockId || key,
          block,
        });
      }
      if (!useWholeBlockFillIn) {
        fillInKeys.forEach((marker, markerIndex) => {
          targets.push({
            key: `${key}:value:${markerIndex + 1}`,
            label: marker.placeholder || placeholder || blockId,
            sectionKey,
            sectionTitle: formatSectionTitle(section.title),
            blockId: blockId || key,
            block,
            markerIndex,
          });
        });
      }
      if (isBlankPlaceholder && block.schema.fillIn !== true && fillInKeys.length === 0) {
        targets.push({
          key,
          label: placeholder,
          sectionKey,
          sectionTitle: formatSectionTitle(section.title),
          blockId: blockId || key,
          block,
        });
      }
    });
  }
  return targets;
}

function isImportPureFillInMarkerText(text: string): boolean {
  return text.replace(/<!--\s*value\b[\s\S]*?-->/gi, '').trim().length === 0;
}

async function fillImportedSectionPlaceholders(
  document: VisualDocument,
  options: ImportFromTextOptions,
  llm: HvyImportLlmOptions,
  beforeLlmCall: ReturnType<typeof createImportLlmStepper>,
  traceRecorder: HvyImportTraceRecorder | undefined,
  sectionKeys: string[],
  createdTargets: CreatedImportXrefTarget[],
  fillInTargets: ImportFillInTarget[]
): Promise<void> {
  const targetsBySection = new Map<string, ImportFillInTarget[]>();
  for (const target of fillInTargets) {
    const list = targetsBySection.get(target.sectionKey) ?? [];
    list.push(target);
    targetsBySection.set(target.sectionKey, list);
  }
  const sections = sectionKeys
    .map((key) => findSectionByKey(document.sections, key))
    .filter((section): section is VisualSection => !!section && (targetsBySection.get(section.key)?.length ?? 0) > 0);
  for (const [index, section] of sections.entries()) {
    const targets = targetsBySection.get(section.key) ?? [];
    throwIfAborted(options.signal);
    const response = await requestTracedImportCompletion(traceRecorder, 'fillIns', 'thinking', {
      settings: getImportStageSettings(llm, 'fillIns'),
      client: llm.client,
      messages: [
        {
          id: `ai-import-fill-ins-${index + 1}-task`,
          role: 'user',
          content: buildImportTaskMessage(
            buildImportFillInPrompt(options.sourceName, options.instructions, section, targets, index, sections.length),
            buildImportFillInResponseInstructions(targets)
          ),
        },
      ],
      context: buildImportFillInContext(document, options.sourceName, options.sourceText, section, createdTargets, targets),
      responseInstructions: buildImportFillInResponseInstructions(targets),
      systemInstructions: IMPORT_STABLE_SYSTEM_INSTRUCTIONS,
      mode: getImportRequestMode(options),
      maxContextChars: options.maxContextChars,
      debugLabel: `ai-import-fill-ins:${index + 1}`,
      beforeRequest: beforeLlmCall?.('thinking'),
      signal: options.signal,
    });
    throwIfAborted(options.signal);
    applyImportFillInResponses(targets, parseImportFillInResponse(response));
  }
}

function buildImportFillInPrompt(sourceName: string | undefined, instructions: string | undefined, section: VisualSection, targets: ImportFillInTarget[], index: number, total: number): string {
  return [
    `Fill remaining placeholders for imported section ${index + 1} of ${total} ${formatImportSourceReference(sourceName)}.`,
    '',
    `Section: ${formatSectionTitle(section.title)} (${getSectionId(section) || section.key})`,
    '',
    'Use the original incoming data, not the earlier extracted notes, so low-level details can still be recovered.',
    'Return an empty string for a key when the source does not contain a source-backed value.',
    'Do not invent facts, dates, names, metrics, links, or xref targets.',
    'Placeholder keys:',
    ...targets.map((target) => `- ${target.key}: ${target.label}`),
    instructions?.trim() ? ['Additional import instructions:', instructions.trim()].join('\n') : '',
  ].filter(Boolean).join('\n');
}

function buildImportFillInContext(document: VisualDocument, sourceName: string | undefined, sourceText: string, section: VisualSection, createdTargets: CreatedImportXrefTarget[], targets: ImportFillInTarget[]): string {
  return [
    buildImportGuidanceFrame(document),
    '',
    '=== BEGIN SOURCE DOCUMENT ===',
    ...formatImportSourceNameLines(sourceName),
    '```text',
    sourceText,
    '```',
    '=== END SOURCE DOCUMENT ===',
    '',
    buildCreatedImportXrefTargetFrame(createdTargets),
    '',
    '=== BEGIN FILL-IN TARGETS ===',
    targets.map((target) => `- ${target.key}: section="${target.sectionTitle}" block="${target.blockId}" label="${target.label}"`).join('\n'),
    '=== END FILL-IN TARGETS ===',
    '',
    '=== BEGIN CURRENT IMPORTED SECTION ===',
    serializeSectionFragment(section, document.meta),
    '=== END CURRENT IMPORTED SECTION ===',
  ].join('\n');
}

function buildCreatedImportXrefTargetFrame(createdTargets: CreatedImportXrefTarget[]): string {
  return [
    '=== BEGIN CREATED IMPORT TARGETS ===',
    createdTargets.length > 0
      ? createdTargets.map((target) => [
        `- ${target.id}: ${target.title} [${target.kind}]`,
        `  section: ${target.sectionTitle}${target.sectionId ? ` (${target.sectionId})` : ''}`,
        target.component ? `  component: ${target.component}` : '',
        target.text ? `  peek: ${target.text}` : '',
      ].filter(Boolean).join('\n')).join('\n')
      : '- No created import targets.',
    '=== END CREATED IMPORT TARGETS ===',
  ].join('\n');
}

function buildImportFillInResponseInstructions(targets: ImportFillInTarget[]): string {
  const fills = Object.fromEntries(targets.map((target) => [target.key, 'Source-backed HVY/text for this fill-in, or empty string.']));
  return [
    'Return exactly one JSON object and no prose.',
    'Shape:',
    JSON.stringify({ fills }),
    '',
    '`fills` must be an object keyed only by the listed fill-in keys.',
    'Each value may be plain text or a small HVY block fragment appropriate for the placeholder.',
    'Use an empty string when there is no source-backed value.',
  ].join('\n');
}

function parseImportFillInResponse(response: string): Map<string, string> {
  const parsed = parseImportJsonObject(response);
  const fills = parsed?.fills;
  const result = new Map<string, string>();
  if (!fills || typeof fills !== 'object' || Array.isArray(fills)) {
    return result;
  }
  for (const [key, value] of Object.entries(fills as Record<string, unknown>)) {
    if (typeof value === 'string') {
      const normalized = normalizeImportJsonStringValue(value).trim();
      if (normalized) {
        result.set(key, normalized);
      }
    }
  }
  return result;
}

function applyImportFillInResponses(targets: ImportFillInTarget[], fills: Map<string, string>): void {
  if (fills.size === 0) {
    return;
  }
  for (const target of targets) {
    const value = fills.get(target.key);
    if (!value) {
      continue;
    }
    const block = target.block;
    if (typeof target.markerIndex === 'number') {
      block.text = applyTextFillInValueAtIndex(block.text, target.markerIndex, value);
      if (block.schema.fillIn === true && !hasTextFillInMarker(block.text) && block.text.trim().length > 0) {
        block.schema.fillIn = false;
      }
    } else if (block.schema.fillIn === true) {
      block.text = value;
      block.schema.fillIn = false;
    }
  }
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
  markImportedSectionVisible(section);
  visitBlocks([section], (block) => {
    if (resolveBaseComponentFromMeta(block.schema.component, documentMeta) === 'xref-card') {
      block.schema.id = '';
    }
  });
}

function markImportedSectionVisible(section: VisualSection): void {
  section.hideIfUnmodified = false;
  section.children.forEach(markImportedSectionVisible);
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

function buildImportSectionHvyResponseInstructions(): string {
  return [
    'Return exactly one JSON object and no prose.',
    'Shape:',
    '{"hvy":"<!--hvy: {\\"id\\":\\"section-id\\"}-->\\n#! Section Title\\n\\n <!--hvy:text {}-->\\n  Section content"}',
    '',
    '`hvy` must be one complete valid HVY section, not a whole document and not a standalone component.',
    'The HVY section must include exactly one section directive and one `#!` section heading.',
    'Use literal HVY directive comments. Do not HTML-escape `<`, `>`, or directive JSON quotes.',
    'Use LLM-only closing comments for nested containers, component-template/custom components, component-list item slots, and expandable slots. Example: `<!--hvy:container {}--> ... <!-- /container -->`.',
    'When returning a component-template/custom component with slots, close both the slots and the component itself.',
  ].join('\n');
}

function buildImportTemplateValuesResponseInstructions(templateStructure: ImportTemplateStructureInternal): string {
  return [
    'Return exactly one JSON object and no prose.',
    'Shape:',
    '{"values":{...}}',
    '',
    '`values` must use only keys listed in this JSON schema. Required keys are listed in the schema.',
    'When `_sectionFlavor` or `_flavor` is present, choose the flavor first and include only the variables for that chosen flavor plus shared variables.',
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
  return validateImportTemplateValuesForStructure(values as Record<string, unknown>, templateStructure);
}

function validateImportTemplateValuesForStructure(
  raw: Record<string, unknown>,
  templateStructure: ImportTemplateStructureInternal
): { ok: true; value: ImportTemplateValues } | { ok: false; message: string } {
  const normalized: ImportTemplateValues = {};
  if (templateStructure.sectionFlavors.length > 0) {
    const flavorName = raw[IMPORT_TEMPLATE_SECTION_FLAVOR_FIELD];
    const allowed = templateStructure.sectionFlavors.map((candidate) => candidate.name);
    if (typeof flavorName !== 'string' || !allowed.includes(flavorName)) {
      return {
        ok: false,
        message: `Template values must choose a valid _sectionFlavor: ${allowed.join(', ')}.`,
      };
    }
    normalized[IMPORT_TEMPLATE_SECTION_FLAVOR_FIELD] = flavorName;
  }
  const sectionFlavor = typeof normalized[IMPORT_TEMPLATE_SECTION_FLAVOR_FIELD] === 'string'
    ? templateStructure.sectionFlavors.find((candidate) => candidate.name === normalized[IMPORT_TEMPLATE_SECTION_FLAVOR_FIELD])
    : undefined;
  const sectionVariables = sectionFlavor?.variables ?? templateStructure.sectionVariables;
  const lists = getImportTemplateListsForSectionFlavor(templateStructure, sectionFlavor);
  const expected = [
    ...(templateStructure.sectionFlavors.length > 0 ? [IMPORT_TEMPLATE_SECTION_FLAVOR_FIELD] : []),
    ...sectionVariables.map((variable) => variable.name),
    ...lists.map((list) => list.key),
  ];
  const keyCheck = validateImportTemplateObjectKeys(raw, expected, 'Template values');
  if (keyCheck) {
    return keyCheck;
  }
  for (const variable of sectionVariables) {
    const value = raw[variable.name];
    if (typeof value !== 'string') {
      return { ok: false, message: `Template value "${variable.name}" must be a string.` };
    }
    normalized[variable.name] = normalizeImportJsonStringValue(value);
  }
  for (const list of lists) {
    const items = raw[list.key];
    if (!Array.isArray(items)) {
      return { ok: false, message: `Template value "${list.key}" must be an array.` };
    }
    const normalizedItems: Array<Record<string, string>> = [];
    for (const [index, item] of items.entries()) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return { ok: false, message: `Template value "${list.key}" item ${index + 1} must be an object.` };
      }
      const itemResult = validateImportTemplateListItemValues(item as Record<string, unknown>, list, `${list.key}" item ${index + 1}`);
      if (itemResult.ok === false) {
        return itemResult;
      }
      normalizedItems.push(itemResult.value);
    }
    normalized[list.key] = normalizedItems;
  }
  return { ok: true, value: normalized };
}

function validateImportTemplateListItemValues(
  raw: Record<string, unknown>,
  list: ImportTemplateListStructure,
  label: string
): { ok: true; value: Record<string, string> } | { ok: false; message: string } {
  const normalized: Record<string, string> = {};
  if (list.flavors.length > 0) {
    const flavorName = raw[IMPORT_TEMPLATE_FLAVOR_FIELD];
    const allowed = list.flavors.map((flavor) => flavor.name);
    if (typeof flavorName !== 'string' || !allowed.includes(flavorName)) {
      return {
        ok: false,
        message: `Template value "${label}" must choose a valid _flavor: ${allowed.join(', ')}.`,
      };
    }
    normalized[IMPORT_TEMPLATE_FLAVOR_FIELD] = flavorName;
  }
  const flavor = typeof normalized[IMPORT_TEMPLATE_FLAVOR_FIELD] === 'string'
    ? list.flavors.find((candidate) => candidate.name === normalized[IMPORT_TEMPLATE_FLAVOR_FIELD])
    : undefined;
  const variables = flavor?.variables ?? list.baseVariables;
  const expected = [
    ...(list.flavors.length > 0 ? [IMPORT_TEMPLATE_FLAVOR_FIELD] : []),
    ...variables.map((variable) => variable.name),
  ];
  const keyCheck = validateImportTemplateObjectKeys(raw, expected, `Template value "${label}"`);
  if (keyCheck) {
    return keyCheck;
  }
  for (const variable of variables) {
    const value = raw[variable.name];
    if (typeof value !== 'string') {
      return { ok: false, message: `Template value "${label}" field "${variable.name}" must be a string.` };
    }
    normalized[variable.name] = normalizeImportJsonStringValue(value);
  }
  return { ok: true, value: normalized };
}

function normalizeImportJsonStringValue(value: string): string {
  return importValueIsOnlyFillInMarker(value) ? '' : value;
}

function importValueIsOnlyFillInMarker(value: string): boolean {
  if (!hasTextFillInMarker(value)) {
    return false;
  }
  return removeTextFillInMarkers(value)
    .split(/\r?\n/)
    .every((line) => stripImportMarkdownScaffold(line).trim().length === 0);
}

function stripImportMarkdownScaffold(line: string): string {
  return line
    .replace(/^\s{0,3}#{1,6}\s*/, '')
    .replace(/^\s{0,3}>\s?/, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/^\s*[-*_]{3,}\s*$/, '')
    .replace(/[\\`*_~#[\]()!>-]/g, '');
}

function validateImportTemplateObjectKeys(raw: Record<string, unknown>, expected: string[], label: string): { ok: false; message: string } | null {
  const expectedSet = new Set(expected);
  const actual = Object.keys(raw);
  const missing = expected.filter((key) => !Object.prototype.hasOwnProperty.call(raw, key));
  const extra = actual.filter((key) => !expectedSet.has(key));
  if (missing.length > 0 || extra.length > 0) {
    return {
      ok: false,
      message: [
        `${label} must exactly match expected keys.`,
        `Expected keys: ${expected.length > 0 ? expected.join(', ') : '(none)'}.`,
        missing.length > 0 ? `Missing keys: ${missing.join(', ')}.` : '',
        extra.length > 0 ? `Extra keys: ${extra.join(', ')}.` : '',
      ].filter(Boolean).join(' '),
    };
  }
  return null;
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

function getImportStageSettings(llm: HvyImportLlmOptions, stage: HvyImportLlmStage): ChatSettings {
  return llm.stages?.[stage] ?? llm.settings;
}

function getImportRequestMode(options: { requestMode?: ProxyCompletionParams['mode'] }): ProxyCompletionParams['mode'] {
  return options.requestMode ?? 'document-edit';
}

function isPdfTemplateImportMode(requestMode: ProxyCompletionParams['mode']): boolean {
  return requestMode === 'pdf-template-import';
}

function createImportTraceRecorder(options: Pick<BuildImportPlanOptions, 'trace' | 'onTraceEvent' | 'onTokenUsage'>): HvyImportTraceRecorder | undefined {
  const run: HvyImportTraceRun = { calls: [] };
  const emit = (type: HvyImportTraceEvent['type'], call: HvyImportTraceCall): void => {
    options.onTraceEvent?.({
      type,
      run: { calls: run.calls.map(copyImportTraceCall) },
      call: copyImportTraceCall(call),
    });
  };
  return {
    run,
    async recordCompletion(stage, phase, params) {
      const call: HvyImportTraceCall = {
        callIndex: run.calls.length + 1,
        stage,
        debugLabel: params.debugLabel?.trim() || 'chat',
        phase,
        request: copyImportTraceRequest(params),
      };
      run.calls.push(call);
      emit('call-start', call);
      try {
        const output = await requestProxyCompletion({
          ...params,
          onTokenUsage: (usage) => {
            params.onTokenUsage?.(usage);
            options.onTokenUsage?.({
              callIndex: call.callIndex,
              stage,
              debugLabel: call.debugLabel,
              phase,
              usage,
            });
          },
        });
        call.response = { output };
        emit('call-complete', call);
        return output;
      } catch (error) {
        call.error = error instanceof Error ? error.message : String(error);
        emit('call-error', call);
        throw error;
      }
    },
  };
}

function logImportFailure(
  operation: HvyImportOperation,
  error: unknown,
  options: Pick<BuildImportPlanOptions, 'sourceName'>,
  traceRecorder: HvyImportTraceRecorder | undefined,
  steps?: ImportPlanStep[]
): void {
  const lastCall = traceRecorder?.run.calls.at(-1);
  console.error('[hvy:import] import failed', {
    operation,
    sourceName: options.sourceName,
    ...(steps ? { steps: steps.map(formatImportFailureStep) } : {}),
    ...(lastCall ? { lastLlmCall: formatImportFailureCall(lastCall) } : {}),
    error,
  });
}

function formatImportFailureStep(step: ImportPlanStep): Record<string, unknown> {
  return {
    sectionTitle: step.sectionTitle,
    target: step.target,
    importMode: step.importMode ?? 'hvy',
    ...(step.preplanGroupIndex !== undefined ? { preplanGroupIndex: step.preplanGroupIndex } : {}),
    ...(step.preplanTargetId ? { preplanTargetId: step.preplanTargetId } : {}),
  };
}

function formatImportFailureCall(call: HvyImportTraceCall): Record<string, unknown> {
  return {
    callIndex: call.callIndex,
    stage: call.stage,
    debugLabel: call.debugLabel,
    phase: call.phase,
    provider: call.request.settings.provider,
    model: call.request.settings.model,
    ...(call.response ? { responseCharacters: call.response.output.length } : {}),
    ...(call.error ? { error: call.error } : {}),
  };
}

function withImportTrace<Result extends BuildImportPlanResult | ImportFromTextResult>(
  result: Result,
  options: Pick<BuildImportPlanOptions, 'trace'>,
  traceRecorder: HvyImportTraceRecorder | undefined
): Result {
  if (!options.trace || !traceRecorder) {
    return result;
  }
  return {
    ...result,
    trace: traceRecorder.run,
  };
}

async function requestTracedImportCompletion(
  traceRecorder: HvyImportTraceRecorder | undefined,
  stage: HvyImportLlmStage,
  phase: HvyLlmCallPhase,
  params: ProxyCompletionParams
): Promise<string> {
  if (!traceRecorder) {
    return requestProxyCompletion(params);
  }
  return traceRecorder.recordCompletion(stage, phase, params);
}

function copyImportTraceRequest(params: ProxyCompletionParams): HvyImportTraceRequest {
  return {
    settings: { ...params.settings },
    messages: params.messages.map((message) => ({ ...message })),
    context: params.context,
    responseInstructions: params.responseInstructions,
    ...(params.systemInstructions !== undefined ? { systemInstructions: params.systemInstructions } : {}),
    mode: params.mode,
    ...(params.maxContextChars !== undefined ? { maxContextChars: params.maxContextChars } : {}),
  };
}

function copyImportTraceCall(call: HvyImportTraceCall): HvyImportTraceCall {
  return {
    callIndex: call.callIndex,
    stage: call.stage,
    debugLabel: call.debugLabel,
    phase: call.phase,
    request: {
      settings: { ...call.request.settings },
      messages: call.request.messages.map((message) => ({ ...message })),
      context: call.request.context,
      responseInstructions: call.request.responseInstructions,
      ...(call.request.systemInstructions !== undefined ? { systemInstructions: call.request.systemInstructions } : {}),
      mode: call.request.mode,
    },
    ...(call.response ? { response: { ...call.response } } : {}),
    ...(call.error !== undefined ? { error: call.error } : {}),
  };
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
