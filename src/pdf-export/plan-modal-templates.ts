import type { VisualDocument } from '../types';
import { getPdfExportPromptTemplates, renderPdfExportPromptTemplate } from './prompt-templates';
import type { HvyPdfExportPromptTemplate } from './types';

export const FALLBACK_PDF_EXPORT_TEMPLATE_ID = 'reference-generic-pdf-export';

const FALLBACK_PDF_EXPORT_TEMPLATE: HvyPdfExportPromptTemplate = {
  id: FALLBACK_PDF_EXPORT_TEMPLATE_ID,
  label: 'Generic PDF export',
  description: 'Create an export strategy for this document.',
  prompt: [
    'Plan a PDF export for this document.',
    'If any visible component cannot be rendered by the PDF backend, hide it unless a specific export adapter exists or the user explicitly asks to include it.',
    '',
    '{% export_context | block %}',
  ].join('\n'),
  variables: {
    export_context: {
      label: 'Export context',
      placeholder: 'Optional: describe the audience, goal, selection criteria, or anything that should shape this PDF.',
      helpText: 'Leave blank to create a basic export strategy.',
      type: 'block',
      required: false,
    },
  },
};

export function getPdfExportPlanModalTemplates(document: VisualDocument): HvyPdfExportPromptTemplate[] {
  const templates = getPdfExportPromptTemplates(document);
  return templates.length > 0 ? templates : [FALLBACK_PDF_EXPORT_TEMPLATE];
}

export function renderPdfExportPlanModalPrompt(
  document: VisualDocument,
  templateId: string,
  values: Record<string, string>
): string {
  if (templateId === FALLBACK_PDF_EXPORT_TEMPLATE_ID) {
    return FALLBACK_PDF_EXPORT_TEMPLATE.prompt.replace('{% export_context | block %}', values.export_context ?? '').trim();
  }
  return renderPdfExportPromptTemplate(document, templateId, values);
}
