import { beforeEach, expect, test, vi } from 'vitest';

import { createEmptyBlock, createEmptySection } from '../src/document-factory';
import { exportCurrentDocumentPdf, exportCurrentDocumentPdfWithTemplateBytes } from '../src/pdf-export/action';
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
  buildImportPlanForDocument: vi.fn(async () => ({
    status: 'ready',
    steps: [{ sectionTitle: 'Summary', instruction: 'Fill summary', target: { kind: 'body', id: 'summary' } }],
  })),
  importTextIntoDocument: vi.fn(async () => ({ status: 'complete', message: 'Imported.' })),
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
  state.pdfTemplateImportModal = { isRunning: false, status: null, error: null };

  await exportCurrentDocumentPdfWithTemplateBytes(serializeDocumentBytes(template), 'template.phvy');

  expect(buildImportPlanForDocument).toHaveBeenCalledWith(
    expect.objectContaining({ extension: '.phvy' }),
    expect.objectContaining({
      sourceName: 'resume.hvy',
      sourceText: expect.stringContaining('PDF export source text.'),
    })
  );
  expect(importTextIntoDocument).toHaveBeenCalledWith(
    expect.objectContaining({ extension: '.phvy' }),
    expect.objectContaining({
      sourceName: 'resume.hvy',
      steps: [{ sectionTitle: 'Summary', instruction: 'Fill summary', target: { kind: 'body', id: 'summary' } }],
    })
  );
  expect(vi.mocked(buildImportPlanForDocument).mock.calls[0]?.[1].sourceText).not.toContain('<!--hvy');
  expect(vi.mocked(buildImportPlanForDocument).mock.calls[0]?.[1].sourceText).not.toContain('hvy_version');
  expect(exportHvyPdf).toHaveBeenCalledWith(expect.objectContaining({ extension: '.phvy' }), { filename: 'resume.pdf' });
});
