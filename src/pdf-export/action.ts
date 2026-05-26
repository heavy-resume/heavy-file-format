import { getRenderApp, state } from '../state';
import { deserializeDocumentBytes } from '../serialization';
import { normalizeFilename } from '../utils';
import { isPdfDocument } from '../pdf-document-capabilities';
import { buildImportPlanForDocument, importTextIntoDocument } from '../ai-document-import';
import { exportHvyPdf } from './export';
import { exportDocumentSourceMarkdown } from '../document-source-markdown';

export async function exportCurrentDocumentPdf(): Promise<void> {
  if (!isPdfDocument(state.document)) {
    state.pdfTemplateImportModal = {
      isRunning: false,
      status: null,
      error: null,
    };
    return;
  }
  const baseName = normalizeFilename(state.filename || 'document.hvy').replace(/\.(hvy|thvy|phvy|md|markdown)$/i, '');
  await exportHvyPdf(state.document, { filename: `${baseName}.pdf` });
}

export async function exportCurrentDocumentPdfWithTemplateBytes(bytes: Uint8Array, templateFilename: string): Promise<void> {
  const sourceDocument = state.document;
  const sourceName = normalizeFilename(state.filename || 'document.hvy');
  const sourceText = exportDocumentSourceMarkdown(sourceDocument);
  const pdfTemplate = deserializeDocumentBytes(bytes, '.phvy');
  const baseName = sourceName.replace(/\.(hvy|thvy|phvy|md|markdown)$/i, '');
  const updateStatus = (status: string): void => {
    if (!state.pdfTemplateImportModal) {
      return;
    }
    state.pdfTemplateImportModal = {
      ...state.pdfTemplateImportModal,
      isRunning: true,
      status,
      error: null,
    };
    getRenderApp()();
  };
  if (state.pdfTemplateImportModal) {
    updateStatus(`Planning import into ${templateFilename || 'PHVY template'}.`);
  }

  const plan = await buildImportPlanForDocument(pdfTemplate, {
    sourceName,
    sourceText,
    instructions: 'Import the source document into this PHVY PDF template before export.',
    llm: { settings: state.chat.settings },
    onProgress: (event) => {
      if (event.message) updateStatus(event.message);
    },
  });
  if (plan.status !== 'ready' || !plan.steps?.length) {
    throw new Error(plan.message || 'PDF template import did not return a usable plan.');
  }

  updateStatus('Importing source document into PHVY template.');
  const result = await importTextIntoDocument(pdfTemplate, {
    sourceName,
    sourceText,
    instructions: 'Fill the PHVY PDF template with source-backed content for PDF export.',
    steps: plan.steps,
    llm: { settings: state.chat.settings },
    onProgress: (event) => {
      if (event.message) updateStatus(event.message);
    },
  });
  if (result.status !== 'complete') {
    throw new Error(result.message || 'PDF template import failed.');
  }

  updateStatus('Rendering PDF.');
  await exportHvyPdf(pdfTemplate, { filename: `${baseName}.pdf` });
}
