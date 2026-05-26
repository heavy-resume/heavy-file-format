import { beforeEach, expect, test, vi } from 'vitest';

import { createEmptyBlock, createEmptySection } from '../src/document-factory';
import { exportCurrentDocumentPdf } from '../src/pdf-export/action';
import { exportHvyPdf } from '../src/pdf-export/export';
import { initCallbacks, initState, state } from '../src/state';
import { createTestState } from './serialization-test-helpers';
import type { VisualDocument } from '../src/types';

vi.mock('../src/pdf-export/export', () => ({
  exportHvyPdf: vi.fn(async () => {}),
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

test('export PDF uses deterministic export instead of opening the legacy plan modal', async () => {
  await exportCurrentDocumentPdf();

  expect(state.pdfExportPlanModal).toBeNull();
  expect(exportHvyPdf).toHaveBeenCalledWith(state.document, { filename: 'resume.pdf' });
});

test('export PDF names PHVY output with a PDF extension', async () => {
  state.document.extension = '.phvy';
  state.filename = 'resume.phvy';

  await exportCurrentDocumentPdf();

  expect(state.pdfExportPlanModal).toBeNull();
  expect(exportHvyPdf).toHaveBeenCalledWith(state.document, { filename: 'resume.pdf' });
});
