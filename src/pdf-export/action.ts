import { state } from '../state';
import { normalizeFilename } from '../utils';
import { exportHvyPdf } from './export';

export async function exportCurrentDocumentPdf(): Promise<void> {
  const baseName = normalizeFilename(state.filename || 'document.hvy').replace(/\.(hvy|thvy|phvy|md|markdown)$/i, '');
  await exportHvyPdf(state.document, { filename: `${baseName}.pdf` });
}
