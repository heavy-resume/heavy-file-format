import { state, getRenderApp } from '../../state';
import { findSectionByKey, isDefaultUntitledSectionTitle } from '../../section-ops';
import { getComponentDefs, getSectionDefs, isBuiltinComponent } from '../../component-defs';
import { findBlockByIds, setActiveEditorBlock, getTagState, setTagState, getTagRenderOptions } from '../../block-ops';
import { handleRemoveTag } from '../../editor/tag-editor';
import { parseTags } from '../../editor/tag-editor';
import { refreshSearchFilterButton, setSearchExcludeTags } from '../../search/actions';
import { createEmptySectionWithMeta } from '../../document-factory';
import { recordHistory } from '../../history';
import { revertReusableComponent } from '../../reusable';
import { templateDefinitionDetailsKey } from '../../editor/render';
import { stringify as stringifyYaml } from 'yaml';
import type { AppActionHandler } from './types';

const tagStateHelpers = {
  getTagState: (target: HTMLElement) => target.dataset.field === 'search-exclude-tags-input' || target.dataset.tagField === 'search-exclude-tags'
    ? parseTags(state.search.excludeTags ?? '')
    : getTagState(target),
  setTagState: (target: HTMLElement, tags: string[]) => {
    if (target.dataset.field === 'search-exclude-tags-input' || target.dataset.tagField === 'search-exclude-tags') {
      setSearchExcludeTags(tags);
      return;
    }
    setTagState(target, tags);
  },
  getRenderOptions: (target: HTMLElement) => target.dataset.field === 'search-exclude-tags-input' || target.dataset.tagField === 'search-exclude-tags'
    ? {}
    : getTagRenderOptions(target),
};

const addComponentDef: AppActionHandler = () => {
  recordHistory();
  const defs = getComponentDefs();
  defs.push({
    name: `component-${defs.length + 1}`,
    baseType: 'text',
    tags: '',
    description: '',
  });
  state.document.meta.component_defs = defs;
  getRenderApp()();
};

const removeComponentDef: AppActionHandler = ({ actionButton }) => {
  recordHistory();
  const defIndex = Number.parseInt(actionButton.dataset.defIndex ?? '', 10);
  if (Number.isNaN(defIndex)) {
    return;
  }
  const defs = getComponentDefs();
  const [removed] = defs.splice(defIndex, 1);
  if (removed) {
    revertReusableComponent(removed);
  }
  state.document.meta.component_defs = defs;
  if (state.selectedReusableComponentName === removed?.name) {
    state.selectedReusableComponentName = defs[0]?.name ?? null;
  }
  getRenderApp()();
};

const removeComponentDefFlavor: AppActionHandler = ({ actionButton }) => {
  const defIndex = Number.parseInt(actionButton.dataset.defIndex ?? '', 10);
  const flavorIndex = Number.parseInt(actionButton.dataset.flavorIndex ?? '', 10);
  const defs = getComponentDefs();
  const def = Number.isNaN(defIndex) ? null : defs[defIndex];
  if (!def || Number.isNaN(flavorIndex) || !Array.isArray(def.flavors)) {
    return;
  }
  recordHistory(`def:${defIndex}:flavor:${flavorIndex}:remove`);
  def.flavors.splice(flavorIndex, 1);
  keepTemplateDefinitionOpen('component', defIndex);
  state.document.meta.component_defs = defs;
  getRenderApp()();
};

const removeSectionDef: AppActionHandler = ({ actionButton }) => {
  recordHistory();
  const defIndex = Number.parseInt(actionButton.dataset.sectionDefIndex ?? '', 10);
  if (Number.isNaN(defIndex)) {
    return;
  }
  const defs = getSectionDefs();
  if (!defs[defIndex]) {
    return;
  }
  defs.splice(defIndex, 1);
  state.document.meta.section_defs = defs;
  getRenderApp()();
};

const removeSectionDefFlavor: AppActionHandler = ({ actionButton }) => {
  recordHistory();
  const idx = Number.parseInt(actionButton.dataset.sectionDefIndex ?? '', 10);
  const flavorIndex = Number.parseInt(actionButton.dataset.flavorIndex ?? '', 10);
  const defs = getSectionDefs();
  const def = Number.isNaN(idx) ? null : defs[idx];
  if (!def || Number.isNaN(flavorIndex) || !Array.isArray(def.flavors)) {
    return;
  }
  def.flavors.splice(flavorIndex, 1);
  keepTemplateDefinitionOpen('section', idx);
  state.document.meta.section_defs = defs;
  getRenderApp()();
};

function keepTemplateDefinitionOpen(kind: 'component' | 'section', index: number): void {
  const key = templateDefinitionDetailsKey(kind, index);
  if (!state.openTemplateDefinitionKeys.includes(key)) {
    state.openTemplateDefinitionKeys = [...state.openTemplateDefinitionKeys, key];
  }
}

const openReusableDefinitionEditor: AppActionHandler = ({ actionButton }) => {
  const kind = actionButton.dataset.templateKind;
  const index = Number.parseInt(actionButton.dataset.defIndex ?? actionButton.dataset.sectionDefIndex ?? '', 10);
  if ((kind !== 'component' && kind !== 'section') || Number.isNaN(index)) {
    return;
  }
  const definition = kind === 'component' ? getComponentDefs()[index] : getSectionDefs()[index];
  if (!definition) {
    return;
  }
  state.reusableDefinitionEditModal = {
    kind,
    index,
    mode: 'edit',
    rawDraft: stringifyYaml(definition).trimEnd(),
    error: null,
  };
  getRenderApp()();
};

const openSaveComponentDef: AppActionHandler = ({ actionButton }) => {
  const sectionKey = actionButton.dataset.sectionKey;
  const blockId = actionButton.dataset.blockId;
  if (!sectionKey || !blockId) {
    return;
  }
  const block = findBlockByIds(sectionKey, blockId);
  if (!block) {
    return;
  }
  const existingName =
    !isBuiltinComponent(block.schema.component) && getComponentDefs().some((def) => def.name === block.schema.component)
      ? block.schema.component
      : '';
  state.reusableSaveModal = {
    kind: 'component',
    sectionKey,
    blockId,
    draftName: existingName
      ? getReusableCopyName(existingName)
      : isBuiltinComponent(block.schema.component)
        ? ''
        : block.schema.component,
    existingName: existingName || undefined,
  };
  getRenderApp()();
};

function getReusableCopyName(name: string): string {
  const names = new Set(getComponentDefs().map((def) => def.name));
  let candidate = `${name}-copy`;
  let index = 2;
  while (names.has(candidate)) {
    candidate = `${name}-copy-${index}`;
    index += 1;
  }
  return candidate;
}

const openSaveSectionDef: AppActionHandler = ({ actionButton }) => {
  const sectionKey = actionButton.dataset.sectionKey;
  if (!sectionKey) {
    return;
  }
  const section = findSectionByKey(state.document.sections, sectionKey);
  if (!section) {
    return;
  }
  const existing = typeof section.templateKey === 'string'
    ? getSectionDefs().find((def) => (def.key || def.name) === section.templateKey)
    : undefined;
  state.reusableSaveModal = {
    kind: 'section',
    sectionKey,
    draftName: existing ? `${existing.name}-copy` : isDefaultUntitledSectionTitle(section.title) ? '' : section.title.trim(),
    existingName: existing?.name,
  };
  getRenderApp()();
};

const removeTag: AppActionHandler = ({ app, actionButton }) => {
  handleRemoveTag(actionButton, tagStateHelpers);
  if (actionButton.dataset.tagField === 'search-exclude-tags') {
    refreshSearchFilterButton(app);
  }
};

const addTemplateField: AppActionHandler = ({ actionButton }) => {
  recordHistory();
  const field = actionButton.dataset.templateField;
  if (!field) {
    return;
  }
  const newSection = createEmptySectionWithMeta(1, 'text', false, state.document.meta);
  newSection.title = field;
  if (newSection.blocks[0]) {
    newSection.blocks[0].text = `{{${field}}}`;
    setActiveEditorBlock(newSection.key, newSection.blocks[0].id);
  }
  state.document.sections.push(newSection);
  getRenderApp()();
};

export const reusableActions: Record<string, AppActionHandler> = {
  'add-component-def': addComponentDef,
  'remove-component-def': removeComponentDef,
  'remove-component-def-flavor': removeComponentDefFlavor,
  'remove-section-def': removeSectionDef,
  'remove-section-def-flavor': removeSectionDefFlavor,
  'open-reusable-definition-editor': openReusableDefinitionEditor,
  'open-save-component-def': openSaveComponentDef,
  'open-save-section-def': openSaveSectionDef,
  'remove-tag': removeTag,
  'add-template-field': addTemplateField,
};
