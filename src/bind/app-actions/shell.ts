import { state, getRenderApp } from '../../state';
import { undoState, redoState } from '../../history';
import { setSidebarOpen, setEditorSidebarOpen } from '../../navigation';
import { serializeDocument } from '../../serialization';
import { clearChatConversation, focusChatPanel, toggleChatPanelOpen } from '../../chat/chat';
import { closeAiEditPopover } from '../../ai-edit-popover';
import { openAiEditPopover } from '../../ai-edit-popover';
import { restoreCliViewAfterRender } from '../../cli-ui/focus';
import { clearFilteringForTarget } from '../../search/actions';
import { clearActiveEditorBlock, setActiveEditorBlock, setAiEditorHostBlock } from '../../block-ops';
import type { AppActionHandler } from './types';

const undo: AppActionHandler = () => {
  undoState();
};

const redo: AppActionHandler = () => {
  redoState();
};

const switchView: AppActionHandler = ({ actionButton }) => {
  const requestedView = actionButton.dataset.view;
  const view = requestedView === 'viewer' ? 'viewer' : requestedView === 'ai' ? 'ai' : 'editor';
  const nextEditorMode = requestedView === 'cli'
    ? 'cli'
    : requestedView === 'editor' && state.editorMode === 'cli'
    ? 'basic'
    : state.editorMode;
  const crossingChatModeBoundary = (state.currentView === 'viewer') !== (view === 'viewer');
  const crossingEditorBoundary = (state.currentView === 'editor') !== (view === 'editor');
  if (crossingChatModeBoundary) {
    clearChatConversation(state.chat);
  }
  if (crossingEditorBoundary) {
    commitActiveEditorSession();
    state.pendingEditorActivation = null;
    state.componentPlacement = null;
  }
  state.currentView = view;
  state.editorMode = view === 'ai' && nextEditorMode === 'advanced' ? 'basic' : nextEditorMode;
  state.showAdvancedEditor = state.editorMode === 'advanced';
  if (view !== 'ai') {
    closeAiEditPopover();
    state.aiEditorHostBlock = null;
    state.aiEditorHostSectionKey = null;
  }
  getRenderApp()();
  if (state.editorMode === 'cli') {
    restoreCliViewAfterRender();
  }
};

function commitActiveEditorSession(): void {
  clearActiveEditorBlock();
  state.activeEditorSectionTitleKey = null;
  state.clearSectionTitleOnFocusKey = null;
  state.activeEditorBlockReturnScroll = null;
}

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
  state.editorMode = state.editorMode === 'mobile-adjustment' && editorMode === 'mobile-adjustment' ? 'basic' : editorMode;
  state.showAdvancedEditor = state.editorMode === 'advanced';
  if (state.editorMode === 'mobile-adjustment') {
    state.componentPlacement = null;
  }
  if (state.editorMode === 'raw') {
    state.rawEditorText = serializeDocument(state.document);
    state.rawEditorError = null;
    state.rawEditorDiagnostics = [];
  }
  if (!state.showAdvancedEditor) {
    state.metaPanelOpen = false;
  }
  state.activeEditorSectionTitleKey = null;
  getRenderApp()();
  if (state.editorMode === 'cli') {
    restoreCliViewAfterRender();
  }
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
  setActiveEditorBlock(menu.sectionKey, menu.blockId, { targetOnly: true });
  setAiEditorHostBlock(menu.sectionKey, menu.blockId);
  if (state.pendingEditorActivation) {
    state.pendingEditorActivation.immediateFocus = true;
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
