import { state, REUSABLE_SECTION_DEF_PREFIX } from './state';
import { escapeAttr, escapeHtml, renderOption } from './utils';
import type { ComponentDefinition, SectionDefinition } from './types';
import { areTablesEnabled } from './reference-config';

let warnedAboutMissingState = false;

export function getComponentDefs(): ComponentDefinition[] {
  return getComponentDefsFromMeta(getDocumentMetaOrNull());
}

export function getComponentDefsFromMeta(meta: Record<string, unknown> | null | undefined): ComponentDefinition[] {
  const defs = meta?.component_defs;
  if (!Array.isArray(defs)) {
    return [];
  }
  return defs.filter((item): item is ComponentDefinition => !!item && typeof item === 'object' && 'name' in item);
}

export function getSectionDefs(): SectionDefinition[] {
  const defs = getDocumentMetaOrNull()?.section_defs;
  if (!Array.isArray(defs)) {
    return [];
  }
  return defs.filter((item): item is SectionDefinition => !!item && typeof item === 'object' && 'name' in item && 'template' in item);
}

export function getReusableNameFromSectionKey(sectionKey: string): string | null {
  const REUSABLE_SECTION_PREFIX = '__reusable__:';
  return sectionKey.startsWith(REUSABLE_SECTION_PREFIX) ? sectionKey.slice(REUSABLE_SECTION_PREFIX.length) : null;
}

export function getComponentOptions(): string[] {
  const builtins = ['text', 'image', 'expandable', 'container', 'component-list', 'grid', 'plugin', 'xref-card'];
  if (areTablesEnabled()) {
    builtins.splice(5, 0, 'table');
  }
  const custom = getComponentDefs()
    .map((def) => def.name.trim())
    .filter((name) => name.length > 0);
  return [...new Set([...builtins, ...custom])];
}

export function isBuiltinComponent(componentName: string): boolean {
  return isBuiltinComponentName(componentName);
}

export function isBuiltinComponentName(componentName: string): boolean {
  return ['text', 'quote', 'code', 'image', 'expandable', 'table', 'container', 'component-list', 'grid', 'plugin', 'xref-card'].includes(componentName);
}

export function renderComponentOptions(selected: string): string {
  const options = getComponentOptions();
  if (selected.trim().length > 0 && !options.includes(selected)) {
    options.push(selected);
  }
  return options.map((option) => renderOption(option, selected)).join('');
}

export function renderReusableSectionOptions(selected: string): string {
  const options = [
    `<option value="blank"${selected === 'blank' ? ' selected' : ''}>Blank</option>`,
    ...getSectionDefs().map((def) => {
      const value = `${REUSABLE_SECTION_DEF_PREFIX}${def.name}`;
      return `<option value="${escapeAttr(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(def.name)}</option>`;
    }),
  ];
  return options.join('');
}

export function resolveBaseComponent(componentName: string): string {
  return resolveBaseComponentFromMeta(componentName, getDocumentMetaOrNull());
}

export function resolveBaseComponentFromMeta(componentName: string, meta: Record<string, unknown> | null | undefined): string {
  if (isBuiltinComponentName(componentName)) {
    return componentName;
  }
  const def = getComponentDefsFromMeta(meta).find((item) => item.name === componentName);
  return def?.baseType || 'text';
}

function getDocumentMetaOrNull(): Record<string, unknown> | null {
  try {
    if (state && state.document && state.document.meta) {
      return state.document.meta as Record<string, unknown>;
    }
  } catch {
    // Fall through to a single console warning below.
  }

  if (!warnedAboutMissingState) {
    warnedAboutMissingState = true;
    console.error(
      '[hvy:component-defs] state.document was unavailable while resolving component or section definitions. Falling back to built-in defaults.'
    );
  }
  return null;
}
