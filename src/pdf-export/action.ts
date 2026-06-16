import { getRenderApp, state } from '../state';
import { deserializeDocumentBytes } from '../serialization';
import { normalizeFilename } from '../utils';
import { isPdfDocument } from '../pdf-document-capabilities';
import { buildImportPlanForDocument, importTextIntoDocument } from '../ai-document-import';
const DEFAULT_IMPORT_MAX_CONTEXT_CHARS = 60_000;
import { exportHvyPdf } from './export';
import { exportDocumentSourceMarkdown } from '../document-source-markdown';
import type { HvyImportTraceCall } from '../ai-document-import';
import type { ChatTokenUsage, PdfTemplateImportModalState, PdfTemplateImportRequestLogEntry, PdfTemplateImportStepState } from '../types';

export const ENABLE_PDF_TEMPLATE_IMPORT_STEPPER = import.meta.env?.VITE_HVY_ENABLE_PDF_IMPORT_STEPPER === 'true';

let pendingPdfTemplateImportLlmResume: (() => void) | null = null;

export function runNextPdfTemplateImportLlmStep(): boolean {
  const resume = pendingPdfTemplateImportLlmResume;
  if (!resume) {
    return false;
  }
  pendingPdfTemplateImportLlmResume = null;
  if (state.pdfTemplateImportModal) {
    state.pdfTemplateImportModal = {
      ...state.pdfTemplateImportModal,
      awaitingLlmStep: false,
      awaitingLlmStepId: null,
    };
    getRenderApp()();
  }
  resume();
  return true;
}

export async function exportCurrentDocumentPdf(): Promise<void> {
  if (!isPdfDocument(state.document)) {
    state.pdfTemplateImportModal = createPdfTemplateImportModalState();
    return;
  }
  const baseName = normalizeFilename(state.filename || 'document.hvy').replace(/\.(hvy|thvy|phvy|md|markdown)$/i, '');
  await exportHvyPdf(state.document, { filename: `${baseName}.pdf` });
}

export async function exportCurrentDocumentPdfWithTemplateBytes(bytes: Uint8Array, templateFilename: string): Promise<void> {
  const sourceDocument = state.document;
  const sourceText = exportDocumentSourceMarkdown(sourceDocument);
  const pdfTemplate = deserializeDocumentBytes(bytes, '.phvy');
  const baseName = normalizeFilename(state.filename || 'document.hvy').replace(/\.(hvy|thvy|phvy|md|markdown)$/i, '');
  const updateStatus = (status: string, stepId?: string): void => {
    if (!state.pdfTemplateImportModal) {
      return;
    }
    const steps = stepId ? updateStepStatus(state.pdfTemplateImportModal.steps, stepId, 'running') : state.pdfTemplateImportModal.steps;
    state.pdfTemplateImportModal = {
      ...state.pdfTemplateImportModal,
      isRunning: true,
      status,
      error: null,
      steps,
    };
    getRenderApp()();
  };
  const completeStep = (stepId: string): void => {
    if (!state.pdfTemplateImportModal) return;
    state.pdfTemplateImportModal = {
      ...state.pdfTemplateImportModal,
      steps: updateStepStatus(state.pdfTemplateImportModal.steps, stepId, 'complete'),
    };
    getRenderApp()();
  };
  const completeRunningLlmSteps = (): void => {
    if (!state.pdfTemplateImportModal) return;
    state.pdfTemplateImportModal = {
      ...state.pdfTemplateImportModal,
      steps: state.pdfTemplateImportModal.steps.map((step) =>
        step.status === 'running' && step.id.startsWith('ai-import-') ? { ...step, status: 'complete' } : step
      ),
    };
    getRenderApp()();
  };
  const failRunningSteps = (): void => {
    if (!state.pdfTemplateImportModal) return;
    state.pdfTemplateImportModal = {
      ...state.pdfTemplateImportModal,
      awaitingLlmStep: false,
      awaitingLlmStepId: null,
      steps: state.pdfTemplateImportModal.steps.map((step) => step.status === 'running' ? { ...step, status: 'error' } : step),
    };
  };
  const recordLlmStepStart = (debugLabel: string): void => {
    if (!state.pdfTemplateImportModal) return;
    const label = formatPdfTemplateImportLlmStepLabel(debugLabel);
    state.pdfTemplateImportModal = {
      ...state.pdfTemplateImportModal,
      steps: ensurePdfTemplateImportStep(state.pdfTemplateImportModal.steps, debugLabel, label).map((step) =>
        step.id === debugLabel ? { ...step, status: 'running' } : step
      ),
    };
    getRenderApp()();
  };
  const waitForLlmStep = async (debugLabel: string): Promise<void> => {
    recordLlmStepStart(debugLabel);
    if (!ENABLE_PDF_TEMPLATE_IMPORT_STEPPER) {
      return;
    }
    if (!state.pdfTemplateImportModal) return;
    state.pdfTemplateImportModal = {
      ...state.pdfTemplateImportModal,
      awaitingLlmStep: true,
      awaitingLlmStepId: debugLabel,
      status: `Ready to run ${formatPdfTemplateImportLlmStepLabel(debugLabel)}.`,
    };
    getRenderApp()();
    await new Promise<void>((resolve) => {
      pendingPdfTemplateImportLlmResume = resolve;
    });
  };
  const recordLlmRequestLog = (entry: PdfTemplateImportRequestLogEntry): void => {
    if (!state.pdfTemplateImportModal) return;
    state.pdfTemplateImportModal = {
      ...state.pdfTemplateImportModal,
      requestLog: [
        ...state.pdfTemplateImportModal.requestLog.filter((item) => item.callIndex !== entry.callIndex),
        entry,
      ],
    };
    getRenderApp()();
  };
  const recordLlmTokenUsage = (debugLabel: string, usage: ChatTokenUsage): void => {
    if (!state.pdfTemplateImportModal) return;
    const label = formatPdfTemplateImportLlmStepLabel(debugLabel);
    const steps = ensurePdfTemplateImportStep(state.pdfTemplateImportModal.steps, debugLabel, label).map((step) =>
      step.id === debugLabel
        ? { ...step, status: 'complete' as const, tokenUsage: addTokenUsage(step.tokenUsage, usage) }
        : step
    );
    state.pdfTemplateImportModal = {
      ...state.pdfTemplateImportModal,
      steps,
      totalTokenUsage: addTokenUsage(state.pdfTemplateImportModal.totalTokenUsage, usage),
    };
    getRenderApp()();
  };
  if (state.pdfTemplateImportModal) {
    updateStatus(`Planning import into ${templateFilename || 'PHVY template'}.`, 'plan');
  }

  try {
    const plan = await buildImportPlanForDocument(pdfTemplate, {
      sourceText,
      instructions: 'Import the incoming data into this PHVY PDF template before export.',
      llm: { settings: state.chat.settings },
      requestMode: 'pdf-template-import',
      maxContextChars: DEFAULT_IMPORT_MAX_CONTEXT_CHARS,
      beforeLlmCall: ENABLE_PDF_TEMPLATE_IMPORT_STEPPER ? (event) => waitForLlmStep(event.debugLabel) : undefined,
      onTraceEvent: (event) => {
        if (event.type === 'call-start') recordLlmRequestLog(toPdfTemplateImportRequestLogEntry(event.call));
      },
      onTokenUsage: (event) => recordLlmTokenUsage(event.debugLabel, event.usage),
      onProgress: (event) => {
        if (event.message) updateStatus(event.message, 'plan');
      },
    });
    if (plan.status !== 'ready' || !plan.steps?.length) {
      throw new Error(plan.message || 'PDF template import did not return a usable plan.');
    }
    completeRunningLlmSteps();
    completeStep('plan');

    updateStatus('Importing incoming data into PHVY template.', 'import');
    const result = await importTextIntoDocument(pdfTemplate, {
      sourceText,
      instructions: 'Fill the PHVY PDF template with source-backed content for PDF export.',
      steps: plan.steps,
      llm: { settings: state.chat.settings },
      requestMode: 'pdf-template-import',
      maxContextChars: DEFAULT_IMPORT_MAX_CONTEXT_CHARS,
      beforeLlmCall: ENABLE_PDF_TEMPLATE_IMPORT_STEPPER ? (event) => waitForLlmStep(event.debugLabel) : undefined,
      onTraceEvent: (event) => {
        if (event.type === 'call-start') recordLlmRequestLog(toPdfTemplateImportRequestLogEntry(event.call));
      },
      onTokenUsage: (event) => recordLlmTokenUsage(event.debugLabel, event.usage),
      onProgress: (event) => {
        if (event.message) updateStatus(event.message, 'import');
      },
    });
    if (result.status !== 'complete') {
      throw new Error(result.message || 'PDF template import failed.');
    }
    completeRunningLlmSteps();
    completeStep('import');

    updateStatus('Rendering PDF.', 'render');
    await exportHvyPdf(pdfTemplate, { filename: `${baseName}.pdf` });
    completeStep('render');
  } catch (error) {
    pendingPdfTemplateImportLlmResume = null;
    failRunningSteps();
    throw error;
  }
}

export function createPdfTemplateImportModalState(): PdfTemplateImportModalState {
  return {
    isRunning: false,
    status: null,
    error: null,
    steps: [
      createPdfTemplateImportStep('read', 'Read PHVY template', 'pending'),
      createPdfTemplateImportStep('plan', 'Plan import', 'pending'),
      createPdfTemplateImportStep('import', 'Import source content', 'pending'),
      createPdfTemplateImportStep('render', 'Render PDF', 'pending'),
    ],
    totalTokenUsage: {},
    awaitingLlmStep: false,
    awaitingLlmStepId: null,
    requestLog: [],
  };
}

function toPdfTemplateImportRequestLogEntry(call: HvyImportTraceCall): PdfTemplateImportRequestLogEntry {
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
      ...(call.request.maxContextChars !== undefined ? { maxContextChars: call.request.maxContextChars } : {}),
    },
  };
}

function createPdfTemplateImportStep(
  id: string,
  label: string,
  status: PdfTemplateImportStepState['status']
): PdfTemplateImportStepState {
  return {
    id,
    label,
    status,
    tokenUsage: {},
  };
}

function updateStepStatus(
  steps: PdfTemplateImportStepState[],
  id: string,
  status: PdfTemplateImportStepState['status']
): PdfTemplateImportStepState[] {
  return steps.map((step) => step.id === id ? { ...step, status } : step);
}

function ensurePdfTemplateImportStep(
  steps: PdfTemplateImportStepState[],
  id: string,
  label: string
): PdfTemplateImportStepState[] {
  return steps.some((step) => step.id === id) ? steps : [...steps, createPdfTemplateImportStep(id, label, 'pending')];
}

function addTokenUsage(current: ChatTokenUsage, next: ChatTokenUsage): ChatTokenUsage {
  return {
    ...(sumTokenField(current.inputTokens, next.inputTokens, 'inputTokens')),
    ...(sumTokenField(current.outputTokens, next.outputTokens, 'outputTokens')),
    ...(sumTokenField(current.totalTokens, next.totalTokens, 'totalTokens')),
    ...(sumTokenField(current.cachedTokens, next.cachedTokens, 'cachedTokens')),
    ...(sumTokenField(current.reasoningTokens, next.reasoningTokens, 'reasoningTokens')),
  };
}

function sumTokenField(current: number | undefined, next: number | undefined, key: keyof ChatTokenUsage): Partial<ChatTokenUsage> {
  return typeof current === 'number' || typeof next === 'number'
    ? { [key]: (current ?? 0) + (next ?? 0) }
    : {};
}

function formatPdfTemplateImportLlmStepLabel(debugLabel: string): string {
  if (debugLabel === 'ai-import-plan') return 'Choose import sections';
  if (debugLabel === 'ai-import-section-dedupe') return 'Dedupe import sections';
  if (debugLabel.startsWith('ai-import-preplan-data:')) return `Extract preplanned group ${debugLabel.split(':').at(-1) ?? ''}`.trim();
  if (debugLabel === 'ai-import-missing-sections') return 'Check missing sections';
  if (debugLabel.startsWith('ai-import-template-values:')) return `Fill template section ${debugLabel.split(':')[1] ?? ''}`.trim();
  if (debugLabel.startsWith('ai-import-section-data:')) return `Extract source section ${debugLabel.split(':')[1] ?? ''}`.trim();
  if (debugLabel.startsWith('ai-import-section-hvy:')) return `Write source section ${debugLabel.split(':')[1] ?? ''}`.trim();
  if (debugLabel.startsWith('ai-import-fill-ins:')) return `Fill placeholder pass ${debugLabel.split(':')[1] ?? ''}`.trim();
  return debugLabel;
}
