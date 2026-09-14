import { changeDocumentView } from '../../document-view';
import { state, getRenderApp } from '../../state';
import { undoStateAsync, redoStateAsync } from '../../history';
import { setSidebarOpen, setEditorSidebarOpen } from '../../navigation';
import { changeEditorMode } from '../../editor-mode';
import { focusChatPanel, toggleChatPanelOpen } from '../../chat/chat';
import { closeAiEditPopover } from '../../ai-edit-popover';
import { openAiEditPopover } from '../../ai-edit-popover';
import { clearFilteringForTarget } from '../../search/actions';
import { findBlockByIds, setActiveEditorBlock, setAiEditorHostBlock } from '../../block-ops';
import type { AppActionHandler } from './types';
import { capturePaneScroll } from '../../scroll';

const undo: AppActionHandler = ({ app }) => {
  void undoStateAsync(app);
};

const redo: AppActionHandler = ({ app }) => {
  void redoStateAsync(app);
};

const switchView: AppActionHandler = ({ app, actionButton }) => {
  const requestedView = actionButton.dataset.view;
  changeDocumentView(requestedView === 'viewer' || requestedView === 'ai' || requestedView === 'cli'
    ? requestedView : 'editor', app);
};

const closeAiEdit: AppActionHandler = () => {
  closeAiEditPopover();
  getRenderApp()();
};

const setEditorMode: AppActionHandler = ({ actionButton }) => {
  const editorMode = actionButton.dataset.editorMode === 'cli'
    ? 'cli'
    : actionButton.dataset.editorMode === 'raw'
    ? 'raw'
    : actionButton.dataset.editorMode === 'advanced'
    ? 'advanced'
    : actionButton.dataset.editorMode === 'mobile-adjustment'
    ? 'mobile-adjustment'
    : 'basic';
  changeEditorMode(state.editorMode === 'mobile-adjustment' && editorMode === 'mobile-adjustment' ? 'basic' : editorMode);
};

const toggleDocumentMeta: AppActionHandler = () => {
  state.metaPanelOpen = !state.metaPanelOpen;
  getRenderApp()();
};

const toggleViewerSidebar: AppActionHandler = ({ app }) => {
  state.viewerSidebarHelpDismissed = true;
  setSidebarOpen(app, !state.viewerSidebarOpen);
};

const toggleEditorSidebar: AppActionHandler = ({ app }) => {
  state.editorSidebarHelpDismissed = true;
  setEditorSidebarOpen(app, !state.editorSidebarOpen);
};

const toggleChatPanel: AppActionHandler = ({ app }) => {
  toggleChatPanelOpen(state.chat);
  getRenderApp()();
  if (state.chat.panelOpen) {
    focusChatPanel(app);
  }
};

const setResponsivePreview: AppActionHandler = ({ actionButton }) => {
  const preview = actionButton.dataset.responsivePreview;
  state.responsivePreview =
    preview === 'phone' || preview === 'tablet' || preview === 'desktop'
      ? preview
      : 'full';
  getRenderApp()();
};

const dismissAiModeTip: AppActionHandler = () => {
  state.aiModeTipDismissed = true;
  getRenderApp()();
};

const clearTargetFiltering: AppActionHandler = ({ app, event }) => {
  event.preventDefault();
  event.stopImmediatePropagation();
  const menu = state.contextMenu;
  if (!menu) {
    return;
  }
  clearFilteringForTarget(menu.sectionKey, menu.blockId);
  state.contextMenu = null;
  app.querySelector('.hvy-context-popover')?.remove();
  app.querySelector('.hvy-context-popover-backdrop')?.remove();
  getRenderApp()();
};

const requestContextComponentChanges: AppActionHandler = ({ app, event }) => {
  event.preventDefault();
  event.stopImmediatePropagation();
  const menu = state.contextMenu;
  if (!menu?.blockId) {
    return;
  }
  state.contextMenu = null;
  app.querySelector('.hvy-context-popover')?.remove();
  app.querySelector('.hvy-context-popover-backdrop')?.remove();
  state.aiModeTipDismissed = true;
  openAiEditPopover(menu.sectionKey, menu.blockId, menu.x, menu.y);
  getRenderApp()();
};

const editContextComponent: AppActionHandler = ({ app, event }) => {
  event.preventDefault();
  event.stopImmediatePropagation();
  const menu = state.contextMenu;
  if (!menu?.blockId) {
    return;
  }
  state.contextMenu = null;
  app.querySelector('.hvy-context-popover')?.remove();
  app.querySelector('.hvy-context-popover-backdrop')?.remove();
  state.aiModeTipDismissed = true;
  state.activeEditorBlockReturnScroll = capturePaneScroll(state.paneScroll, app);
  const passiveBlock = app.querySelector<HTMLElement>(
    `.reader-block[data-section-key="${CSS.escape(menu.sectionKey)}"][data-block-id="${CSS.escape(menu.blockId)}"]`
  );
  setActiveEditorBlock(menu.sectionKey, menu.blockId, { targetOnly: true });
  setAiEditorHostBlock(menu.sectionKey, menu.blockId);
  if (state.pendingEditorActivation) {
    const block = findBlockByIds(menu.sectionKey, menu.blockId);
    state.pendingEditorActivation.suppressFocus = block?.schema.kind === 'table' || block?.schema.component === 'table';
    state.pendingEditorActivation.immediateFocus = !state.pendingEditorActivation.suppressFocus;
    state.pendingEditorActivation.passiveHeight = passiveBlock?.getBoundingClientRect().height;
  }
  getRenderApp()();
};

export const shellActions: Record<string, AppActionHandler> = {
  undo,
  redo,
  'switch-view': switchView,
  'close-ai-edit': closeAiEdit,
  'set-editor-mode': setEditorMode,
  'toggle-document-meta': toggleDocumentMeta,
  'toggle-viewer-sidebar': toggleViewerSidebar,
  'toggle-editor-sidebar': toggleEditorSidebar,
  'toggle-chat-panel': toggleChatPanel,
  'set-responsive-preview': setResponsivePreview,
  'dismiss-ai-mode-tip': dismissAiModeTip,
  'clear-target-filtering': clearTargetFiltering,
  'request-context-component-changes': requestContextComponentChanges,
  'edit-context-component': editContextComponent,
};
