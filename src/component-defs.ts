import { state, REUSABLE_SECTION_DEF_PREFIX } from './state';
import { escapeAttr, escapeHtml, renderOption } from './utils';
import type { ComponentDefinition, SectionDefinition } from './types';

export function getComponentDefs(): ComponentDefinition[] {
  const defs = state.document.meta.component_defs;
  if (!Array.isArray(defs)) {
    return [];
  }
  return defs.filter((item): item is ComponentDefinition => !!item && typeof item === 'object' && 'name' in item);
}

export function getSectionDefs(): SectionDefinition[] {
  const defs = state.document.meta.section_defs;
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
  const builtins = ['text', 'quote', 'code', 'expandable', 'table', 'container', 'component-list', 'grid', 'plugin', 'xref-card'];
  const custom = getComponentDefs()
    .map((def) => def.name.trim())
    .filter((name) => name.length > 0);
  return [...new Set([...builtins, ...custom])];
}

export function isBuiltinComponent(componentName: string): boolean {
  return isBuiltinComponentName(componentName);
}

export function isBuiltinComponentName(componentName: string): boolean {
  return ['text', 'quote', 'code', 'expandable', 'table', 'container', 'component-list', 'grid', 'plugin', 'xref-card'].includes(componentName);
}

export function renderComponentOptions(selected: string): string {
  return getComponentOptions().map((option) => renderOption(option, selected)).join('');
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
  if (isBuiltinComponentName(componentName)) {
    return componentName;
  }
  const def = getComponentDefs().find((item) => item.name === componentName);
  return def?.baseType || 'text';
}
