import { DEFAULT_BLOCK_CSS } from './document-factory';
import type { JsonObject } from './hvy/types';
import type { VisualDocument } from './types';

export function formatStyleDefaultsSummary(document: VisualDocument): string[] {
  return [
    `- section default css: "${formatSectionDefaultCss(document.meta)}"`,
    `- implicit block default css: "${DEFAULT_BLOCK_CSS}" (applied to component instances when unchanged; omitted from serialized HVY)`,
    ...formatComponentDefaultCss(document.meta),
  ];
}

function formatSectionDefaultCss(meta: JsonObject): string {
  const sectionDefaults = meta.section_defaults;
  if (!sectionDefaults || typeof sectionDefaults !== 'object' || Array.isArray(sectionDefaults)) {
    return '(none)';
  }
  const css = (sectionDefaults as JsonObject).css;
  return typeof css === 'string' && css.trim().length > 0 ? css.trim() : '(none)';
}

function formatComponentDefaultCss(meta: JsonObject): string[] {
  const componentDefaults = meta.component_defaults;
  if (!componentDefaults || typeof componentDefaults !== 'object' || Array.isArray(componentDefaults)) {
    return ['- component default css: (none)'];
  }
  const lines = Object.entries(componentDefaults as Record<string, unknown>)
    .map(([componentName, value]) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return '';
      }
      const css = (value as JsonObject).css;
      return typeof css === 'string' && css.trim().length > 0
        ? `- component default css ${componentName}: "${css.trim()}"`
        : '';
    })
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
  return lines.length > 0 ? lines : ['- component default css: (none)'];
}
