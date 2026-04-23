import type { JsonObject } from './hvy/types';

export function getDocumentComponentDefaultCss(documentMeta: JsonObject, componentName: string): string {
  const componentDefaults = documentMeta.component_defaults;
  if (!componentDefaults || typeof componentDefaults !== 'object' || Array.isArray(componentDefaults)) {
    return '';
  }

  const config = (componentDefaults as Record<string, unknown>)[componentName];
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return '';
  }

  const css = (config as Record<string, unknown>).css;
  return typeof css === 'string' ? css : '';
}
