import type { JsonObject } from './hvy/types';
import type { HvyPdfExportStrategyDefaults } from './pdf-export/types';

export const PDF_DOCUMENT_DEFAULT_PAGE_SIZE = { width: 612, height: 792 };
export const PDF_DOCUMENT_DEFAULT_PAGE_MARGINS: [number, number, number, number] = [54, 54, 54, 54];
export const PDF_DOCUMENT_DEFAULT_PAGE_MARGIN_LENGTHS: [string, string, string, string] = ['0.75in', '0.75in', '0.75in', '0.75in'];

export interface PdfPageSettings {
  pageSize: string | { width: number; height: number };
  pageMargins: PdfPageMargins;
  debug: boolean;
}

export type PdfPageMarginLength = number | string;
export type PdfPageMargins = PdfPageMarginLength | [PdfPageMarginLength, PdfPageMarginLength] | [PdfPageMarginLength, PdfPageMarginLength, PdfPageMarginLength, PdfPageMarginLength];

export interface ResolvedPdfPageSettings {
  pageSize: { width: number; height: number };
  pageMargins: [number, number, number, number];
  debug: boolean;
}

export function readPdfPageSettingsFromMeta(meta: JsonObject | null | undefined): Partial<PdfPageSettings> {
  const raw = meta?.pdf_page;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const value = raw as JsonObject;
  const pageSize = readPageSize(value.size);
  const pageMargins = readPageMargins(value.margins);
  return {
    ...(pageSize ? { pageSize } : {}),
    ...(pageMargins !== null ? { pageMargins } : {}),
    ...(typeof value.debug === 'boolean' ? { debug: value.debug } : {}),
  };
}

export function resolvePdfPageSettings(
  meta: JsonObject | null | undefined,
  strategyDefaults: HvyPdfExportStrategyDefaults | undefined = {}
): PdfPageSettings {
  const metaSettings = readPdfPageSettingsFromMeta(meta);
  return {
    pageSize: strategyDefaults.pageSize ?? metaSettings.pageSize ?? 'LETTER',
    pageMargins: strategyDefaults.pageMargins ?? metaSettings.pageMargins ?? PDF_DOCUMENT_DEFAULT_PAGE_MARGINS,
    debug: metaSettings.debug ?? false,
  };
}

export function resolvePdfPageDimensions(settings: Pick<PdfPageSettings, 'pageSize' | 'pageMargins' | 'debug'>): ResolvedPdfPageSettings {
  return {
    pageSize: normalizePdfPageSize(settings.pageSize),
    pageMargins: normalizePdfPageMargins(settings.pageMargins),
    debug: settings.debug,
  };
}

export function normalizePdfPageSize(pageSize: PdfPageSettings['pageSize']): { width: number; height: number } {
  if (typeof pageSize !== 'string') {
    return {
      width: isPositiveFiniteNumber(pageSize.width) ? pageSize.width : PDF_DOCUMENT_DEFAULT_PAGE_SIZE.width,
      height: isPositiveFiniteNumber(pageSize.height) ? pageSize.height : PDF_DOCUMENT_DEFAULT_PAGE_SIZE.height,
    };
  }
  const normalized = pageSize.trim().toUpperCase();
  if (normalized === 'A4') return { width: 595.28, height: 841.89 };
  if (normalized === 'LEGAL') return { width: 612, height: 1008 };
  if (normalized === 'TABLOID' || normalized === 'LEDGER') return { width: 792, height: 1224 };
  return PDF_DOCUMENT_DEFAULT_PAGE_SIZE;
}

export function normalizePdfPageMargins(pageMargins: PdfPageMargins): [number, number, number, number] {
  if (typeof pageMargins === 'number' || typeof pageMargins === 'string') {
    const margin = Math.max(0, pdfPageLengthToPoints(pageMargins) ?? PDF_DOCUMENT_DEFAULT_PAGE_MARGINS[0]);
    return [margin, margin, margin, margin];
  }
  if (pageMargins.length === 2) {
    const horizontal = Math.max(0, pdfPageLengthToPoints(pageMargins[0]) ?? PDF_DOCUMENT_DEFAULT_PAGE_MARGINS[0]);
    const vertical = Math.max(0, pdfPageLengthToPoints(pageMargins[1]) ?? PDF_DOCUMENT_DEFAULT_PAGE_MARGINS[1]);
    return [horizontal, vertical, horizontal, vertical];
  }
  return [
    Math.max(0, pdfPageLengthToPoints(pageMargins[0]) ?? PDF_DOCUMENT_DEFAULT_PAGE_MARGINS[0]),
    Math.max(0, pdfPageLengthToPoints(pageMargins[1]) ?? PDF_DOCUMENT_DEFAULT_PAGE_MARGINS[1]),
    Math.max(0, pdfPageLengthToPoints(pageMargins[2]) ?? PDF_DOCUMENT_DEFAULT_PAGE_MARGINS[2]),
    Math.max(0, pdfPageLengthToPoints(pageMargins[3]) ?? PDF_DOCUMENT_DEFAULT_PAGE_MARGINS[3]),
  ];
}

export function readPdfPageMetaObject(meta: JsonObject): JsonObject {
  const raw = meta.pdf_page;
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as JsonObject) } : {};
}

function readPageSize(value: unknown): PdfPageSettings['pageSize'] | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const width = (value as JsonObject).width;
    const height = (value as JsonObject).height;
    if (isPositiveFiniteNumber(width) && isPositiveFiniteNumber(height)) {
      return { width, height };
    }
  }
  return null;
}

function readPageMargins(value: unknown): PdfPageSettings['pageMargins'] | null {
  if (isPdfPageMarginLength(value)) {
    return value;
  }
  if (!Array.isArray(value) || (value.length !== 2 && value.length !== 4)) {
    return null;
  }
  if (value.every(isPdfPageMarginLength)) {
    return value as [PdfPageMarginLength, PdfPageMarginLength] | [PdfPageMarginLength, PdfPageMarginLength, PdfPageMarginLength, PdfPageMarginLength];
  }
  return null;
}

export function isPdfPageMarginLength(value: unknown): value is PdfPageMarginLength {
  if (isPositiveFiniteNumber(value) || value === 0) {
    return true;
  }
  return typeof value === 'string' && pdfPageLengthToPoints(value) !== null;
}

export function isPdfPageMarginsInput(value: unknown): boolean {
  if (isPdfPageMarginLength(value)) {
    return true;
  }
  return Array.isArray(value) && (value.length === 2 || value.length === 4) && value.every(isPdfPageMarginLength);
}

export function pdfPageLengthToPoints(value: PdfPageMarginLength): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  const match = /^(\d*\.?\d+)\s*(in|cm|mm|pt)$/i.exec(value.trim());
  if (!match) {
    return null;
  }
  const amount = Number.parseFloat(match[1] ?? '');
  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }
  const unit = (match[2] ?? '').toLowerCase();
  if (unit === 'in') return amount * 72;
  if (unit === 'cm') return amount * 72 / 2.54;
  if (unit === 'mm') return amount * 72 / 25.4;
  if (unit === 'pt') return amount;
  return null;
}

export function formatPdfPointsAsInches(points: number): string {
  const inches = points / 72;
  return Number.isInteger(inches) ? String(inches) : inches.toFixed(3).replace(/0+$/g, '').replace(/\.$/, '');
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
