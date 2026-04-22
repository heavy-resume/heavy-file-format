import type { JsonObject } from './hvy/types';

export function getDocumentSectionDefaultCss(documentMeta: JsonObject): string {
  const sectionDefaults = documentMeta.section_defaults;
  if (!sectionDefaults || typeof sectionDefaults !== 'object' || Array.isArray(sectionDefaults)) {
    return '';
  }

  const css = (sectionDefaults as Record<string, unknown>).css;
  return typeof css === 'string' ? css : '';
}

export function mergeDocumentCss(defaultCss: string, explicitCss: string): string {
  const parts = [defaultCss.trim(), explicitCss.trim()].filter((value) => value.length > 0);
  return parts.join(' ');
}
