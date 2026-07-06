import { state, REUSABLE_SECTION_DEF_PREFIX } from './state';
import { escapeAttr, escapeHtml, renderOption } from './utils';
import type { ComponentDefinition, SectionDefinition } from './types';
import { areTablesEnabled } from './reference-config';

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
  return getSectionDefsFromMeta(getDocumentMetaOrNull());
}

export function getSectionDefsFromMeta(meta: Record<string, unknown> | null | undefined): SectionDefinition[] {
  const defs = meta?.section_defs;
  if (!Array.isArray(defs)) {
    return [];
  }
  return defs.filter((item): item is SectionDefinition => !!item && typeof item === 'object' && 'name' in item && 'template' in item);
}

export function getSectionTemplateKey(def: SectionDefinition): string {
  return (def.key?.trim() || def.name.trim());
}

export function getReusableNameFromSectionKey(sectionKey: string): string | null {
  const REUSABLE_SECTION_PREFIX = '__reusable__:';
  return sectionKey.startsWith(REUSABLE_SECTION_PREFIX) ? sectionKey.slice(REUSABLE_SECTION_PREFIX.length) : null;
}

export function getComponentOptions(): string[] {
  const builtins = ['text', 'code', 'image', 'carousel', 'button', 'expandable', 'container', 'component-list', 'grid', 'plugin', 'xref-card'];
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
  return ['text', 'code', 'image', 'carousel', 'button', 'expandable', 'table', 'container', 'component-list', 'grid', 'plugin', 'xref-card', 'encrypted'].includes(componentName);
}

export function renderComponentOptions(selected: string): string {
  const options = getComponentOptions();
  if (selected.trim().length > 0 && !options.includes(selected)) {
    options.push(selected);
  }
  return options.map((option) => renderOption(option, selected)).join('');
}

export function renderReusableSectionOptions(selected: string): string {
  const usedTemplateKeys = getUsedSectionTemplateKeys();
  const options = [
    `<option value="blank"${selected === 'blank' ? ' selected' : ''}>Blank</option>`,
    ...getSectionDefs().filter((def) => {
      if (def.repeatable === true) {
        return true;
      }
      return !usedTemplateKeys.has(getSectionTemplateKey(def));
    }).map((def) => {
      const value = `${REUSABLE_SECTION_DEF_PREFIX}${def.name}`;
      return `<option value="${escapeAttr(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(def.name)}</option>`;
    }),
  ];
  return options.join('');
}

function getUsedSectionTemplateKeys(): Set<string> {
  const used = new Set<string>();
  try {
    const sections = state?.document?.sections ?? [];
    const visit = (items: typeof sections): void => {
      for (const section of items) {
        if (!section.isGhost && section.templateKey?.trim()) {
          used.add(section.templateKey.trim());
        }
        visit(section.children);
      }
    };
    visit(sections);
  } catch {
    // No active document during isolated render tests.
  }
  return used;
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

  return null;
}
