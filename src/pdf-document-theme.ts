import type { VisualDocument } from './types';
import type { JsonObject } from './hvy/types';
import { cssFragmentTriggersNetwork } from './css-sanitizer';
import { isExternalCssAllowed } from './reference-config';
import { resolvePdfPageDimensions, resolvePdfPageSettings } from './pdf-page-settings';

export const PDF_DOCUMENT_DEFAULT_BACKGROUND_COLOR = '#ffffff';
export const PDF_DOCUMENT_DEFAULT_TEXT_COLOR = '#000000';

export interface PdfDocumentThemeColors {
  backgroundColor: string;
  textColor: string;
}

export function getPdfDocumentThemeColors(document: Pick<VisualDocument, 'meta'>): PdfDocumentThemeColors {
  const colors = getDocumentThemeColors(document.meta);
  return {
    backgroundColor: colors['--hvy-bg'] || PDF_DOCUMENT_DEFAULT_BACKGROUND_COLOR,
    textColor: colors['--hvy-text'] || PDF_DOCUMENT_DEFAULT_TEXT_COLOR,
  };
}

export function getPdfDocumentViewerThemeVariables(document: Pick<VisualDocument, 'meta'>): Record<string, string> {
  const colors = getDocumentThemeColors(document.meta);
  const backgroundColor = colors['--hvy-bg'] || PDF_DOCUMENT_DEFAULT_BACKGROUND_COLOR;
  const textColor = colors['--hvy-text'] || PDF_DOCUMENT_DEFAULT_TEXT_COLOR;
  const textAlt = colors['--hvy-text-alt'] || textColor;
  const textMuted = colors['--hvy-text-muted'] || textAlt;
  return {
    ...colors,
    '--hvy-bg': backgroundColor,
    '--hvy-bg-alt': colors['--hvy-bg-alt'] || backgroundColor,
    '--hvy-surface': colors['--hvy-surface'] || backgroundColor,
    '--hvy-surface-alt': colors['--hvy-surface-alt'] || backgroundColor,
    '--hvy-text': textColor,
    '--hvy-text-alt': textAlt,
    '--hvy-text-muted': textMuted,
  };
}

export function renderPdfDocumentViewerThemeStyle(document: Pick<VisualDocument, 'meta'>, escapeAttr: (value: string) => string): string {
  const allowExternal = isExternalCssAllowed();
  return Object.entries({
    ...getPdfDocumentViewerThemeVariables(document),
    ...getPdfDocumentPageGuideVariables(document),
  })
    .map(([name, value]) => {
      const fallback = name.includes('text') ? PDF_DOCUMENT_DEFAULT_TEXT_COLOR : PDF_DOCUMENT_DEFAULT_BACKGROUND_COLOR;
      const safeValue = allowExternal || !cssFragmentTriggersNetwork(value) ? value : fallback;
      return `${name}: ${escapeAttr(safeValue)};`;
    })
    .join(' ');
}

export function getPdfDocumentPageGuideVariables(document: Pick<VisualDocument, 'meta'>): Record<string, string> {
  const settings = resolvePdfPageDimensions(resolvePdfPageSettings(document.meta));
  const [left, top, right, bottom] = settings.pageMargins;
  const printableWidth = Math.max(1, settings.pageSize.width - left - right);
  const printableHeight = Math.max(1, settings.pageSize.height - top - bottom);
  return {
    '--hvy-pdf-page-width': String(settings.pageSize.width),
    '--hvy-pdf-page-height': String(settings.pageSize.height),
    '--hvy-pdf-printable-width': String(printableWidth),
    '--hvy-pdf-printable-height': String(printableHeight),
    '--hvy-pdf-margin-left': String(left),
    '--hvy-pdf-margin-top': String(top),
    '--hvy-pdf-margin-right': String(right),
    '--hvy-pdf-margin-bottom': String(bottom),
  };
}

export function renderPdfDocumentPageGuides(document: Pick<VisualDocument, 'meta'>): string {
  const settings = resolvePdfPageSettings(document.meta);
  const debugClass = settings.debug ? ' is-debug' : '';
  const style = Object.entries(getPdfDocumentPageGuideVariables(document))
    .map(([name, value]) => `${name}: ${escapeStyleAttribute(value)};`)
    .join(' ');
  return `<div class="phvy-page-guide-layer${debugClass}" style="${style}" aria-hidden="true"></div>`;
}

function escapeStyleAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function getDocumentThemeColors(meta: VisualDocument['meta']): Record<string, string> {
  const themeRaw = meta.theme;
  if (!themeRaw || typeof themeRaw !== 'object') {
    return {};
  }
  const colorsRaw = (themeRaw as JsonObject).colors;
  if (!colorsRaw || typeof colorsRaw !== 'object' || Array.isArray(colorsRaw)) {
    return {};
  }
  const colors: Record<string, string> = {};
  for (const [key, value] of Object.entries(colorsRaw as JsonObject)) {
    if (typeof value === 'string') {
      colors[key] = value;
    }
  }
  return colors;
}
