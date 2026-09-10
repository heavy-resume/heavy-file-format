import type { JsonObject } from './hvy/types';
import { getStyleSpacing, updateStyleSpacingCss } from './text-line-styles';

export const DEFAULT_PARAGRAPH_SPACING = '0.45rem';
const DOCUMENT_PARAGRAPH_SPACING = /^(?:0|(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|ch|ex|cap|ic|lh|rlh|vw|vh|vmin|vmax|cqw|cqh|cqi|cqb|cqmin|cqmax|cm|mm|q|in|pc|pt|%))$/i;

export function isDocumentParagraphSpacing(value: unknown): value is string {
  return typeof value === 'string' && DOCUMENT_PARAGRAPH_SPACING.test(value.trim());
}

export function getDocumentParagraphSpacing(meta: Record<string, unknown> | null | undefined): string {
  const typography = meta?.typography;
  if (!typography || typeof typography !== 'object' || Array.isArray(typography)) {
    return DEFAULT_PARAGRAPH_SPACING;
  }
  const value = (typography as JsonObject).paragraphSpacing;
  if (!isDocumentParagraphSpacing(value)) {
    return DEFAULT_PARAGRAPH_SPACING;
  }
  const sanitized = isDocumentParagraphSpacing(value)
    ? extractMarginTop(updateStyleSpacingCss('', 'margin-top', value.trim()))
    : '';
  return sanitized || DEFAULT_PARAGRAPH_SPACING;
}

export function writeDocumentParagraphSpacing(meta: JsonObject, value: string): void {
  const typography = meta.typography && typeof meta.typography === 'object' && !Array.isArray(meta.typography)
    ? { ...(meta.typography as JsonObject) }
    : {};
  const sanitized = isDocumentParagraphSpacing(value)
    ? extractMarginTop(updateStyleSpacingCss('', 'margin-top', value.trim()))
    : '';
  typography.paragraphSpacing = sanitized || DEFAULT_PARAGRAPH_SPACING;
  meta.typography = typography;
}

export function getParagraphGapCss(spacing: string, multiples: number): string {
  if (multiples <= 1) return spacing;
  const match = spacing.match(/^(\d*\.?\d+)(.*)$/);
  if (!match) return spacing;
  const value = Number(match[1]) * multiples;
  return `${Number(value.toFixed(6))}${match[2]}`;
}

export function getParagraphSplitMarginTop(
  css: string,
  meta: Record<string, unknown> | null | undefined,
  lineBoundaries: number
): string {
  const targetGap = getParagraphGapCss(getDocumentParagraphSpacing(meta), lineBoundaries);
  const precedingBottomMargin = getStyleSpacing(css)['margin-bottom'] || '0';
  if (precedingBottomMargin === '0') return targetGap;
  const target = parseSimpleLength(targetGap);
  const preceding = parseSimpleLength(precedingBottomMargin);
  if (target && preceding && target.unit === preceding.unit) {
    return `${Number(Math.max(0, target.value - preceding.value).toFixed(6))}${target.unit}`;
  }
  return `calc(${targetGap} - ${precedingBottomMargin})`;
}

function parseSimpleLength(value: string): { value: number; unit: string } | null {
  const match = value.trim().match(/^(\d*\.?\d+)(.*)$/);
  return match ? { value: Number(match[1]), unit: match[2] } : null;
}

function extractMarginTop(css: string): string {
  return css.match(/(?:^|;)\s*margin-top:\s*([^;]+)/i)?.[1]?.trim() ?? '';
}
