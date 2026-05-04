import { state, getRenderApp, getRefreshReaderPanels } from '../../state';
import { findSectionByKey, isDefaultUntitledSectionTitle } from '../../section-ops';
import { findBlockByIds, setActiveEditorBlock, deactivateEditorBlock } from '../../block-ops';
import { recordHistory } from '../../history';
import type { AppActionHandler } from './types';

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
  const section = findSectionByKey(state.document.sections, sectionKey);
  if (!section || section.description.trim()) {
    return;
  }
  recordHistory(`section:${sectionKey}:description:generate`);
  section.description = generateDescriptionText([
    section.title,
    section.customId,
    `${section.blocks.length} top-level components`,
    `${section.children.length} child sections`,
  ], 'Document section for related content.');
  getRefreshReaderPanels()();
  updateDescriptionFieldDom(actionButton, section.description);
};

const generateBlockDescription: AppActionHandler = ({ actionButton, sectionKey, blockId }) => {
  const block = findBlockByIds(sectionKey, blockId);
  if (!block || block.schema.description.trim()) {
    return;
  }
  recordHistory(`block:${blockId}:description:generate`);
  block.schema.description = generateDescriptionText([
    block.schema.id,
    block.schema.component,
    block.schema.componentListComponent ? `list of ${block.schema.componentListComponent}` : '',
    block.schema.xrefTarget ? `links to ${block.schema.xrefTarget}` : '',
    block.schema.xrefTitle,
    block.text,
  ], `${block.schema.component} component.`);
  getRefreshReaderPanels()();
  updateDescriptionFieldDom(actionButton, block.schema.description);
};

function updateDescriptionFieldDom(actionButton: HTMLElement, description: string): void {
  const label = actionButton.closest('label');
  const textarea = label?.querySelector<HTMLTextAreaElement>('textarea');
  if (textarea) {
    textarea.value = description;
  }
  actionButton.remove();
}

function generateDescriptionText(values: string[], fallback: string): string {
  const text = values.map((value) => value.trim()).filter(Boolean).join(' - ').replace(/\s+/g, ' ');
  if (!text) {
    return fallback;
  }
  return text.length <= 160 ? text : `${text.slice(0, 159).trimEnd()}...`;
}

export const editorStateActions: Record<string, AppActionHandler> = {
  'activate-block': activateBlock,
  'activate-section-title': activateSectionTitle,
  'deactivate-block': deactivateBlock,
  'toggle-editor-expandable': toggleEditorExpandable,
  'toggle-expandable-editor-panel': toggleExpandableEditorPanel,
  'focus-schema-component': focusSchemaComponent,
  'generate-section-description': generateSectionDescription,
  'generate-block-description': generateBlockDescription,
};
