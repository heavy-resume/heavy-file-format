import { getRenderApp, state } from '../state';
import { normalizeFilename } from '../utils';
import { exportHvyPdf } from './export';
import { createPdfExportPlanFromPrompt } from './planning';
import { getPdfExportPlanModalTemplates, renderPdfExportPlanModalPrompt } from './plan-modal-templates';
import type { HvyPdfExportPromptTemplate } from './types';

type BoundAsyncRunner = <T>(action: () => Promise<T>) => Promise<T>;

function createPdfExportPlanModalState(template: HvyPdfExportPromptTemplate, status: string | null = null): typeof state.pdfExportPlanModal {
  return {
    templateId: template.id,
    values: Object.fromEntries(Object.keys(template.variables).map((name) => [name, ''])),
    isRunning: false,
    status,
    error: null,
    plan: null,
  };
}

export async function openPdfExportPlannerOrExport(): Promise<void> {
  const templates = getPdfExportPlanModalTemplates(state.document);
  if (templates.length > 0) {
    const documentTemplates = state.document.meta.export_prompt_templates;
    if (Array.isArray(documentTemplates) && documentTemplates.length > 0) {
      state.pdfExportPlanModal = createPdfExportPlanModalState(templates[0]);
      getRenderApp()();
      return;
    }
  }
  const baseName = normalizeFilename(state.filename || 'document.hvy').replace(/\.(hvy|thvy|md)$/i, '');
  try {
    await exportHvyPdf(state.document, { filename: `${baseName}.pdf` });
  } catch (error) {
    if (!isUnsupportedPdfExportError(error)) {
      throw error;
    }
    state.pdfExportPlanModal = createPdfExportPlanModalState(
      templates[0],
      'This document has PDF-unsupported content. Create an export strategy to hide or adapt it before generating the PDF.'
    );
    getRenderApp()();
  }
}

function isUnsupportedPdfExportError(error: unknown): boolean {
  return error instanceof Error && /PDF export cannot render component/.test(error.message);
}

export function bindPdfExportPlanModal(app: HTMLElement, runInBoundRuntimeAsync: BoundAsyncRunner): void {
  const pdfExportPlanForm = app.querySelector<HTMLFormElement>('#pdfExportPlanForm');
  pdfExportPlanForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    void runInBoundRuntimeAsync(async () => {
      const modal = state.pdfExportPlanModal;
      if (!modal || modal.isRunning) {
        return;
      }
      modal.isRunning = true;
      modal.status = 'Planning PDF export...';
      modal.error = null;
      modal.plan = null;
      getRenderApp()();
      try {
        const currentContentView = Object.keys(state.readerView).length > 0 ? state.readerView : undefined;
        const renderedPrompt = renderPdfExportPlanModalPrompt(state.document, modal.templateId, modal.values);
        const plan = await createPdfExportPlanFromPrompt({
          document: state.document,
          prompt: renderedPrompt,
          ...(currentContentView ? { currentContentView } : {}),
        });
        const freshModal = state.pdfExportPlanModal;
        if (!freshModal || freshModal.templateId !== modal.templateId) {
          return;
        }
        freshModal.plan = plan;
        freshModal.status = plan.diagnostics.some((entry) => entry.severity === 'error')
          ? 'Plan needs attention before export.'
          : 'Plan ready for review.';
      } catch (error) {
        const freshModal = state.pdfExportPlanModal;
        if (freshModal) {
          freshModal.error = error instanceof Error ? error.message : 'PDF export planning failed.';
          freshModal.status = null;
        }
      } finally {
        const freshModal = state.pdfExportPlanModal;
        if (freshModal) {
          freshModal.isRunning = false;
        }
        getRenderApp()();
      }
    });
  });

  app.querySelector<HTMLSelectElement>('#pdfExportTemplateSelect')?.addEventListener('change', (event) => {
    const select = event.target as HTMLSelectElement | null;
    if (!select) {
      return;
    }
    const template = getPdfExportPlanModalTemplates(state.document).find((entry) => entry.id === select.value);
    if (!template) {
      return;
    }
    state.pdfExportPlanModal = createPdfExportPlanModalState(template);
    getRenderApp()();
  });

  app.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-pdf-export-value]').forEach((field) => {
    field.addEventListener('input', () => {
      const modal = state.pdfExportPlanModal;
      const name = field.dataset.pdfExportValue;
      if (!modal || !name) {
        return;
      }
      modal.values[name] = field.value;
      modal.plan = null;
      modal.error = null;
      modal.status = null;
    });
  });

  app.querySelectorAll<HTMLElement>('[data-action="close-pdf-export-plan"]').forEach((button) => {
    button.addEventListener('click', () => {
      state.pdfExportPlanModal = null;
      getRenderApp()();
    });
  });

  app.querySelector<HTMLButtonElement>('[data-action="export-pdf-plan"]')?.addEventListener('click', () => {
    void runInBoundRuntimeAsync(async () => {
      const modal = state.pdfExportPlanModal;
      const plan = modal?.plan;
      if (!modal || !plan || modal.isRunning || plan.diagnostics.some((entry) => entry.severity === 'error')) {
        return;
      }
      modal.isRunning = true;
      modal.status = 'Generating PDF...';
      modal.error = null;
      getRenderApp()();
      try {
        const baseName = normalizeFilename(state.filename || 'document.hvy').replace(/\.(hvy|thvy|md)$/i, '');
        await exportHvyPdf(state.document, {
          filename: `${baseName}.pdf`,
          contentView: plan.contentView,
          strategy: plan.strategy,
        });
        state.pdfExportPlanModal = null;
      } catch (error) {
        const freshModal = state.pdfExportPlanModal;
        if (freshModal) {
          freshModal.error = error instanceof Error ? error.message : 'PDF export failed.';
        }
      } finally {
        const freshModal = state.pdfExportPlanModal;
        if (freshModal) {
          freshModal.isRunning = false;
        }
        getRenderApp()();
      }
    });
  });
}
