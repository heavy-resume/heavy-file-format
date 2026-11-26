import type { ComponentDefinition, SectionDefinition } from './types';

export function getComponentDefsFromMeta(meta: Record<string, unknown> | null | undefined): ComponentDefinition[] {
  const defs = meta?.component_defs;
  if (!Array.isArray(defs)) {
    return [];
  }
  return defs.filter((item): item is ComponentDefinition => !!item && typeof item === 'object' && 'name' in item);
}

export function getSectionDefsFromMeta(meta: Record<string, unknown> | null | undefined): SectionDefinition[] {
  const defs = meta?.section_defs;
  if (!Array.isArray(defs)) {
    return [];
  }
  return defs.filter((item): item is SectionDefinition => !!item && typeof item === 'object' && 'name' in item && 'template' in item);
}

export function getSectionTemplateKey(def: SectionDefinition): string {
  return def.key?.trim() || def.name.trim();
}

export function isBuiltinComponentName(componentName: string): boolean {
  return ['text', 'code', 'image', 'carousel', 'button', 'expandable', 'table', 'container', 'component-list', 'grid', 'plugin', 'xref-card', 'location-marker', 'encrypted'].includes(componentName);
}

export function resolveBaseComponentFromMeta(
  componentName: string,
  meta: Record<string, unknown> | null | undefined
): string {
  if (isBuiltinComponentName(componentName)) {
    return componentName;
  }
  const def = getComponentDefsFromMeta(meta).find((item) => item.name === componentName);
  return def?.baseType || 'text';
}
