import { resolveBaseComponentFromMeta } from './component-defs';
import { getHostPlugin } from './plugins/registry';
import { areTablesEnabled } from './reference-config';
import type { ComponentDefinition, VisualDocument } from './types';

export function isPdfDocument(document: Pick<VisualDocument, 'extension'>): boolean {
  return document.extension === '.phvy';
}

export function isPdfAllowedBaseComponent(baseComponent: string): boolean {
  if (baseComponent === 'table') {
    return areTablesEnabled();
  }
  return baseComponent === 'text'
    || baseComponent === 'container'
    || baseComponent === 'component-list'
    || baseComponent === 'grid'
    || baseComponent === 'image';
}

export function isPdfAllowedComponent(componentName: string, meta: Record<string, unknown> | null | undefined): boolean {
  return isPdfAllowedBaseComponent(resolveBaseComponentFromMeta(componentName, meta));
}

export function isPdfAllowedPlugin(pluginId: string): boolean {
  return typeof getHostPlugin(pluginId)?.pdf?.renderStatic === 'function';
}

export function isPdfAllowedComponentInstance(
  componentName: string,
  meta: Record<string, unknown> | null | undefined,
  pluginId?: string
): boolean {
  if (componentName === 'plugin') {
    return typeof pluginId === 'string' && pluginId.trim().length > 0 && isPdfAllowedPlugin(pluginId.trim());
  }
  return isPdfAllowedComponent(componentName, meta);
}

export function filterPdfAllowedComponentDefs(
  defs: ComponentDefinition[],
  meta: Record<string, unknown> | null | undefined
): ComponentDefinition[] {
  return defs.filter((def) => isPdfAllowedComponent(def.name, meta));
}
