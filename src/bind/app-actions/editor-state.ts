import { state, getRenderApp, getRefreshReaderPanels } from '../../state';
import { findSectionByKey, isDefaultUntitledSectionTitle } from '../../section-ops';
import { findBlockByIds, setActiveEditorBlock, deactivateEditorBlock } from '../../block-ops';
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

export const editorStateActions: Record<string, AppActionHandler> = {
  'activate-block': activateBlock,
  'activate-section-title': activateSectionTitle,
  'deactivate-block': deactivateBlock,
  'toggle-editor-expandable': toggleEditorExpandable,
  'toggle-expandable-editor-panel': toggleExpandableEditorPanel,
  'focus-schema-component': focusSchemaComponent,
};
