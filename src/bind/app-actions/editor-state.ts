import { state, getRenderApp, getRefreshReaderPanels } from '../../state';
import { findSectionByKey, isDefaultUntitledSectionTitle } from '../../section-ops';
import { findBlockByIds, setActiveEditorBlock, deactivateEditorBlock, cancelEditorBlockEdit } from '../../block-ops';
import { recordHistory } from '../../history';
import type { AppActionHandler } from './types';
import { buildDescriptionRequest, generateDescription } from '../../descriptions/provider';

const activateBlock: AppActionHandler = ({ event, sectionKey, blockId }) => {
  if (!blockId) {
    return;
  }
  event.stopPropagation();
  setActiveEditorBlock(sectionKey, blockId);
  getRenderApp()();
};

const activateSectionTitle: AppActionHandler = ({ event, sectionKey }) => {
  if (!sectionKey) {
    return;
  }
  event.stopPropagation();
  state.activeEditorSectionTitleKey = sectionKey;
  const section = findSectionByKey(state.document.sections, sectionKey);
  state.clearSectionTitleOnFocusKey = section && isDefaultUntitledSectionTitle(section.title) ? sectionKey : null;
  getRenderApp()();
};

const deactivateBlock: AppActionHandler = ({ event, sectionKey, blockId }) => {
  if (!blockId) {
    return;
  }
  event.stopPropagation();
  deactivateEditorBlock(sectionKey, blockId);
  getRenderApp()();
};

const cancelBlockEdit: AppActionHandler = ({ event, sectionKey, blockId }) => {
  if (!blockId) {
    return;
  }
  event.stopPropagation();
  cancelEditorBlockEdit(sectionKey, blockId);
  getRefreshReaderPanels()();
  getRenderApp()();
};

const toggleEditorExpandable: AppActionHandler = ({ event, sectionKey, blockId }) => {
  if (!sectionKey || !blockId) {
    return;
  }
  event.stopPropagation();
  const block = findBlockByIds(sectionKey, blockId);
  if (!block) {
    return;
  }
  block.schema.expandableExpanded = !block.schema.expandableExpanded;
  getRefreshReaderPanels()();
  getRenderApp()();
};

const toggleExpandableEditorPanel: AppActionHandler = ({ event, actionButton, sectionKey, blockId }) => {
  if (!sectionKey || !blockId) {
    return;
  }
  event.stopPropagation();
  const panel = actionButton.dataset.expandablePanel === 'stub' ? 'stub' : 'expanded';
  const key = `${sectionKey}:${blockId}`;
  const current = state.expandableEditorPanels[key] ?? { stubOpen: false, expandedOpen: false };
  state.expandableEditorPanels[key] = {
    ...current,
    [panel === 'stub' ? 'stubOpen' : 'expandedOpen']: !current[panel === 'stub' ? 'stubOpen' : 'expandedOpen'],
  };
  getRenderApp()();
};

const focusSchemaComponent: AppActionHandler = ({ actionButton, target }) => {
  if (target.closest('select, input, button, textarea, label')) {
    return;
  }
  const select = actionButton.querySelector<HTMLSelectElement>('[data-field="block-component"]');
  select?.focus();
  select?.click();
};

const generateSectionDescription: AppActionHandler = ({ actionButton, sectionKey }) => {
  void generateSectionDescriptionAsync(actionButton, sectionKey);
};

async function generateSectionDescriptionAsync(actionButton: HTMLElement, sectionKey: string): Promise<void> {
  const section = findSectionByKey(state.document.sections, sectionKey);
  if (!section || section.description.trim()) {
    return;
  }
  setGenerateButtonBusy(actionButton, true);
  recordHistory(`section:${sectionKey}:description:generate`);
  section.description = await generateDescription(buildDescriptionRequest({
    document: state.document,
    section,
    kind: 'section',
  }));
  getRefreshReaderPanels()();
  updateDescriptionFieldDom(actionButton, section.description);
}

const generateBlockDescription: AppActionHandler = ({ actionButton, sectionKey, blockId }) => {
  void generateBlockDescriptionAsync(actionButton, sectionKey, blockId);
};

async function generateBlockDescriptionAsync(actionButton: HTMLElement, sectionKey: string, blockId: string): Promise<void> {
  const section = findSectionByKey(state.document.sections, sectionKey);
  const block = findBlockByIds(sectionKey, blockId);
  if (!section || !block || block.schema.description.trim()) {
    return;
  }
  setGenerateButtonBusy(actionButton, true);
  recordHistory(`block:${blockId}:description:generate`);
  block.schema.description = await generateDescription(buildDescriptionRequest({
    document: state.document,
    section,
    block,
    kind: 'block',
    parentTrail: [section.title],
  }));
  getRefreshReaderPanels()();
  updateDescriptionFieldDom(actionButton, block.schema.description);
}

const generateExpandablePaneDescription: AppActionHandler = ({ actionButton, sectionKey, blockId }) => {
  void generateExpandablePaneDescriptionAsync(actionButton, sectionKey, blockId);
};

async function generateExpandablePaneDescriptionAsync(actionButton: HTMLElement, sectionKey: string, blockId: string): Promise<void> {
  const section = findSectionByKey(state.document.sections, sectionKey);
  const block = findBlockByIds(sectionKey, blockId);
  const pane = actionButton.dataset.expandablePane === 'expanded' ? 'expanded' : 'stub';
  if (!section || !block) {
    return;
  }
  if (pane === 'stub' && block.schema.expandableStubDescription.trim()) {
    return;
  }
  if (pane === 'expanded' && block.schema.expandableContentDescription.trim()) {
    return;
  }
  setGenerateButtonBusy(actionButton, true);
  recordHistory(`block:${blockId}:expandable-${pane}:description:generate`);
  const description = await generateDescription(buildDescriptionRequest({
    document: state.document,
    section,
    block,
    kind: pane === 'stub' ? 'expandable-stub' : 'expandable-content',
    parentTrail: [section.title],
  }));
  if (pane === 'stub') {
    block.schema.expandableStubDescription = description;
  } else {
    block.schema.expandableContentDescription = description;
  }
  getRefreshReaderPanels()();
  updateDescriptionFieldDom(actionButton, description);
}

function updateDescriptionFieldDom(actionButton: HTMLElement, description: string): void {
  const label = actionButton.closest('label');
  const textarea = label?.querySelector<HTMLTextAreaElement>('textarea');
  if (textarea) {
    textarea.value = description;
  }
  actionButton.remove();
}

function setGenerateButtonBusy(actionButton: HTMLElement, busy: boolean): void {
  actionButton.toggleAttribute('disabled', busy);
  actionButton.textContent = busy ? 'Generating...' : 'Generate';
}

export const editorStateActions: Record<string, AppActionHandler> = {
  'activate-block': activateBlock,
  'activate-section-title': activateSectionTitle,
  'deactivate-block': deactivateBlock,
  'cancel-block-edit': cancelBlockEdit,
  'toggle-editor-expandable': toggleEditorExpandable,
  'toggle-expandable-editor-panel': toggleExpandableEditorPanel,
  'focus-schema-component': focusSchemaComponent,
  'generate-section-description': generateSectionDescription,
  'generate-block-description': generateBlockDescription,
  'generate-expandable-pane-description': generateExpandablePaneDescription,
};
