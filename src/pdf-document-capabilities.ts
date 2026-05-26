import { resolveBaseComponentFromMeta } from './component-defs';
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
    || baseComponent === 'grid'
    || baseComponent === 'image';
}

export function isPdfAllowedComponent(componentName: string, meta: Record<string, unknown> | null | undefined): boolean {
  return isPdfAllowedBaseComponent(resolveBaseComponentFromMeta(componentName, meta));
}

export function filterPdfAllowedComponentDefs(
  defs: ComponentDefinition[],
  meta: Record<string, unknown> | null | undefined
): ComponentDefinition[] {
  return defs.filter((def) => isPdfAllowedComponent(def.name, meta));
}
