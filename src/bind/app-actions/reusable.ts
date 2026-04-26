import { state, getRenderApp } from '../../state';
import { findSectionByKey, isDefaultUntitledSectionTitle } from '../../section-ops';
import { getComponentDefs, getSectionDefs, isBuiltinComponent } from '../../component-defs';
import { findBlockByIds, setActiveEditorBlock, getTagState, setTagState, getTagRenderOptions } from '../../block-ops';
import { handleRemoveTag } from '../../editor/tag-editor';
import { createEmptySection } from '../../document-factory';
import { recordHistory } from '../../history';
import { revertReusableComponent } from '../../reusable';
import type { AppActionHandler } from './types';

const tagStateHelpers = {
  getTagState,
  setTagState,
  getRenderOptions: getTagRenderOptions,
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
  state.reusableSaveModal = {
    kind: 'component',
    sectionKey,
    blockId,
    draftName: isBuiltinComponent(block.schema.component) ? '' : block.schema.component,
  };
  getRenderApp()();
};

const openSaveSectionDef: AppActionHandler = ({ actionButton }) => {
  const sectionKey = actionButton.dataset.sectionKey;
  if (!sectionKey) {
    return;
  }
  const section = findSectionByKey(state.document.sections, sectionKey);
  if (!section) {
    return;
  }
  state.reusableSaveModal = {
    kind: 'section',
    sectionKey,
    draftName: isDefaultUntitledSectionTitle(section.title) ? '' : section.title.trim(),
  };
  getRenderApp()();
};

const removeTag: AppActionHandler = ({ actionButton }) => {
  handleRemoveTag(actionButton, tagStateHelpers);
};

const addTemplateField: AppActionHandler = ({ actionButton }) => {
  recordHistory();
  const field = actionButton.dataset.templateField;
  if (!field) {
    return;
  }
  const newSection = createEmptySection(1, 'text');
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
  'remove-section-def': removeSectionDef,
  'open-save-component-def': openSaveComponentDef,
  'open-save-section-def': openSaveSectionDef,
  'remove-tag': removeTag,
  'add-template-field': addTemplateField,
};
