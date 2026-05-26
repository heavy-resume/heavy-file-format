import { beforeEach, expect, test, vi } from 'vitest';

import { createEmptyBlock, createEmptySection } from '../src/document-factory';
import {
  createPdfTemplateImportModalState,
  exportCurrentDocumentPdf,
  exportCurrentDocumentPdfWithTemplateBytes,
} from '../src/pdf-export/action';
import { buildImportPlanForDocument, importTextIntoDocument } from '../src/ai-document-import';
import { exportHvyPdf } from '../src/pdf-export/export';
import { serializeDocumentBytes } from '../src/serialization';
import { initCallbacks, initState, state } from '../src/state';
import { createTestState } from './serialization-test-helpers';
import type { VisualDocument } from '../src/types';

vi.mock('../src/pdf-export/export', () => ({
  exportHvyPdf: vi.fn(async () => {}),
}));

vi.mock('../src/ai-document-import', () => ({
  buildImportPlanForDocument: vi.fn(async (_document, options) => {
    options.onTraceEvent?.({
      type: 'call-start',
      run: { calls: [] },
      call: {
        callIndex: 1,
        stage: 'sectionPlanner',
        debugLabel: 'ai-import-plan',
        phase: 'thinking',
        request: {
          settings: { provider: 'openai', model: 'gpt-5-mini' },
          messages: [{ id: 'plan', role: 'user', content: 'Plan exact message.' }],
          context: 'exact plan context',
          responseInstructions: 'exact plan instructions',
          mode: 'pdf-template-import',
          maxContextChars: options.maxContextChars,
        },
      },
    });
    await options.beforeLlmCall?.({ callIndex: 1, debugLabel: 'ai-import-plan', phase: 'thinking' });
    options.onTokenUsage?.({
      callIndex: 1,
      stage: 'sectionPlanner',
      debugLabel: 'ai-import-plan',
      phase: 'thinking',
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    });
    return {
      status: 'ready',
      steps: [{ sectionTitle: 'Summary', instruction: 'Fill summary', target: { kind: 'body', id: 'summary' } }],
    };
  }),
  importTextIntoDocument: vi.fn(async (_document, options) => {
    options.onTraceEvent?.({
      type: 'call-start',
      run: { calls: [] },
      call: {
        callIndex: 2,
        stage: 'templateSectionWriter',
        debugLabel: 'ai-import-template-values:1',
        phase: 'thinking',
        request: {
          settings: { provider: 'openai', model: 'gpt-5-mini' },
          messages: [{ id: 'template', role: 'user', content: 'Template exact message.' }],
          context: 'exact template context',
          responseInstructions: 'exact template instructions',
          mode: 'pdf-template-import',
          maxContextChars: options.maxContextChars,
        },
      },
    });
    await options.beforeLlmCall?.({ callIndex: 1, debugLabel: 'ai-import-template-values:1', phase: 'thinking' });
    options.onTokenUsage?.({
      callIndex: 1,
      stage: 'templateSectionWriter',
      debugLabel: 'ai-import-template-values:1',
      phase: 'thinking',
      usage: { inputTokens: 80, outputTokens: 10, totalTokens: 90 },
    });
    return { status: 'complete', message: 'Imported.' };
  }),
}));

function createDocumentWithExportTemplate(): VisualDocument {
  const section = createEmptySection(1, 'Summary');
  section.key = 'section-summary';
  section.customId = 'summary';
  section.blocks = [createEmptyBlock('text')];
  section.blocks[0].text = 'PDF export source text.';
  return {
    meta: {
      title: 'PDF Export Fixture',
      export_prompt_templates: [
        {
          id: 'old-planner',
          label: 'Old planner',
          prompt: 'Plan a PDF export.\n\n{% target_context | block %}',
          variables: {
            target_context: { label: 'Target context', type: 'block', required: true },
          },
        },
      ],
    },
    extension: '.hvy',
    attachments: [],
    sections: [section],
  };
}

beforeEach(() => {
  vi.mocked(exportHvyPdf).mockClear();
  vi.mocked(buildImportPlanForDocument).mockClear();
  vi.mocked(importTextIntoDocument).mockClear();
  initCallbacks({
    renderApp: () => {},
    refreshReaderPanels: () => {},
    refreshModalPreview: () => {},
    componentRenderHelpers: null,
    readerRenderer: null,
  });
  initState(createTestState(createDocumentWithExportTemplate()));
  state.filename = 'resume.hvy';
});

test('export PDF opens PHVY template picker for HVY documents', async () => {
  await exportCurrentDocumentPdf();

  expect(state.pdfTemplateImportModal).toEqual({
    isRunning: false,
    status: null,
    error: null,
    steps: [
      { id: 'read', label: 'Read PHVY template', status: 'pending', tokenUsage: {} },
      { id: 'plan', label: 'Plan import', status: 'pending', tokenUsage: {} },
      { id: 'import', label: 'Import source content', status: 'pending', tokenUsage: {} },
      { id: 'render', label: 'Render PDF', status: 'pending', tokenUsage: {} },
    ],
    totalTokenUsage: {},
    awaitingLlmStep: false,
    awaitingLlmStepId: null,
    requestLog: [],
  });
  expect(exportHvyPdf).not.toHaveBeenCalled();
});

test('export PDF names PHVY output with a PDF extension', async () => {
  state.document.extension = '.phvy';
  state.filename = 'resume.phvy';

  await exportCurrentDocumentPdf();

  expect(state.pdfExportPlanModal).toBeNull();
  expect(exportHvyPdf).toHaveBeenCalledWith(state.document, { filename: 'resume.pdf' });
});

test('export PDF imports HVY source into selected PHVY before rendering', async () => {
  const template = createDocumentWithExportTemplate();
  template.extension = '.phvy';
  state.pdfTemplateImportModal = createPdfTemplateImportModalState();

  await exportCurrentDocumentPdfWithTemplateBytes(serializeDocumentBytes(template), 'template.phvy');

  expect(state.pdfTemplateImportModal?.requestLog[0]?.request.messages[0]?.content).toBe('Plan exact message.');
  expect(state.pdfTemplateImportModal?.requestLog[0]?.request.maxContextChars).toBe(60_000);
  expect(state.pdfTemplateImportModal?.requestLog[1]?.request.context).toBe('exact template context');
  expect(state.pdfTemplateImportModal?.awaitingLlmStep).toBe(false);
  expect(state.pdfTemplateImportModal?.awaitingLlmStepId).toBeNull();

  expect(buildImportPlanForDocument).toHaveBeenCalledWith(
    expect.objectContaining({ extension: '.phvy' }),
    expect.objectContaining({
      sourceText: expect.stringContaining('PDF export source text.'),
      requestMode: 'pdf-template-import',
      maxContextChars: 60_000,
      beforeLlmCall: undefined,
    })
  );
  expect(importTextIntoDocument).toHaveBeenCalledWith(
    expect.objectContaining({ extension: '.phvy' }),
    expect.objectContaining({
      steps: [{ sectionTitle: 'Summary', instruction: 'Fill summary', target: { kind: 'body', id: 'summary' } }],
      requestMode: 'pdf-template-import',
      maxContextChars: 60_000,
      beforeLlmCall: undefined,
    })
  );
  expect(vi.mocked(buildImportPlanForDocument).mock.calls[0]?.[1]).not.toHaveProperty('sourceName');
  expect(vi.mocked(importTextIntoDocument).mock.calls[0]?.[1]).not.toHaveProperty('sourceName');
  expect(vi.mocked(buildImportPlanForDocument).mock.calls[0]?.[1].sourceText).not.toContain('<!--hvy');
  expect(vi.mocked(buildImportPlanForDocument).mock.calls[0]?.[1].sourceText).not.toContain('hvy_version');
  expect(state.pdfTemplateImportModal?.totalTokenUsage).toEqual({ inputTokens: 180, outputTokens: 30, totalTokens: 210 });
  expect(state.pdfTemplateImportModal?.steps).toEqual([
    { id: 'read', label: 'Read PHVY template', status: 'pending', tokenUsage: {} },
    { id: 'plan', label: 'Plan import', status: 'complete', tokenUsage: {} },
    { id: 'import', label: 'Import source content', status: 'complete', tokenUsage: {} },
    { id: 'render', label: 'Render PDF', status: 'complete', tokenUsage: {} },
    { id: 'ai-import-plan', label: 'Choose import sections', status: 'complete', tokenUsage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } },
    { id: 'ai-import-template-values:1', label: 'Fill template section 1', status: 'complete', tokenUsage: { inputTokens: 80, outputTokens: 10, totalTokens: 90 } },
  ]);
  expect(state.pdfTemplateImportModal?.requestLog.map((entry) => entry.debugLabel)).toEqual([
    'ai-import-plan',
    'ai-import-template-values:1',
  ]);
  expect(exportHvyPdf).toHaveBeenCalledWith(expect.objectContaining({ extension: '.phvy' }), { filename: 'resume.pdf' });
});
