import { state, REUSABLE_SECTION_DEF_PREFIX, REUSABLE_SECTION_PREFIX } from './state';
import { escapeAttr, escapeHtml, renderOption } from './utils';
import type { SectionDefinition } from './types';
import { areTablesEnabled } from './reference-config';
import { getComponentDefs, getSectionDefs } from './component-definition-state';
export { getComponentDefs, getSectionDefs, resolveBaseComponent } from './component-definition-state';
import {
  getSectionDefsFromMeta,
  getSectionTemplateKey,
  isBuiltinComponentName,
} from './component-definition-helpers';
export {
  getComponentDefsFromMeta,
  getSectionDefsFromMeta,
  getSectionTemplateKey,
  isBuiltinComponentName,
  resolveBaseComponentFromMeta,
} from './component-definition-helpers';

export function getReusableNameFromSectionKey(sectionKey: string): string | null {
  return sectionKey.startsWith(REUSABLE_SECTION_PREFIX) ? sectionKey.slice(REUSABLE_SECTION_PREFIX.length) : null;
}

/** True when the section key belongs to a component or section template being edited, not the main document. */
export function isReusableDefinitionSectionKey(sectionKey: string): boolean {
  if (sectionKey.startsWith(REUSABLE_SECTION_PREFIX) || sectionKey.startsWith(REUSABLE_SECTION_DEF_PREFIX)) {
    return true;
  }
  const modal = state.reusableDefinitionEditModal;
  if (modal?.kind !== 'section') {
    return false;
  }
  const definition = getSectionDefsFromMeta(state.document.meta)[modal.index];
  return Boolean(definition?.template?.key && definition.template.key === sectionKey);
}

export function getComponentOptions(): string[] {
  const builtins = ['text', 'code', 'image', 'carousel', 'button', 'expandable', 'container', 'component-list', 'grid', 'plugin', 'xref-card', 'location-marker'];
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

export function renderComponentOptions(selected: string): string {
  const options = getComponentOptions();
  if (selected.trim().length > 0 && !options.includes(selected)) {
    options.push(selected);
  }
  return options.map((option) => renderOption(option, selected)).join('');
}

export function getAvailableSectionDefs(): SectionDefinition[] {
  const usedTemplateKeys = getUsedSectionTemplateKeys();
  return getSectionDefs().filter((def) => def.repeatable === true || !usedTemplateKeys.has(getSectionTemplateKey(def)));
}

export function renderReusableSectionOptions(selected: string): string {
  const definitions = getAvailableSectionDefs();
  const selectedValue = definitions.some((def) => `${REUSABLE_SECTION_DEF_PREFIX}${def.name}` === selected)
    ? selected : 'blank';
  return [
    `<option value="blank"${selectedValue === 'blank' ? ' selected' : ''}>Blank</option>`,
    ...definitions.map((def) => {
      const value = `${REUSABLE_SECTION_DEF_PREFIX}${def.name}`;
      return `<option value="${escapeAttr(value)}"${value === selectedValue ? ' selected' : ''}>${escapeHtml(def.name)}</option>`;
    }),
  ].join('');
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
      }
    };
    visit(sections);
  } catch {
    // No active document during isolated render tests.
  }
  return used;
}
