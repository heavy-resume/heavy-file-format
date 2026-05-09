import { state, getRenderApp } from '../../state';
import { undoState, redoState } from '../../history';
import { setSidebarOpen, setEditorSidebarOpen } from '../../navigation';
import { serializeDocument } from '../../serialization';
import { clearChatConversation, focusChatPanel, toggleChatPanelOpen } from '../../chat/chat';
import { closeAiEditPopover } from '../../ai-edit-popover';
import { openAiEditPopover } from '../../ai-edit-popover';
import { restoreCliViewAfterRender } from '../../cli-ui/focus';
import { clearFilteringForTarget } from '../../search/actions';
import { setActiveEditorBlock } from '../../block-ops';
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
  const crossingChatModeBoundary = (state.currentView === 'viewer') !== (view === 'viewer');
  const crossingEditorBoundary = (state.currentView === 'editor') !== (view === 'editor');
  if (crossingChatModeBoundary) {
    clearChatConversation(state.chat);
  }
  if (crossingEditorBoundary) {
    state.activeEditorBlock = null;
    state.pendingEditorActivation = null;
    state.activeEditorSectionTitleKey = null;
    state.clearSectionTitleOnFocusKey = null;
    state.componentPlacement = null;
  }
  state.currentView = view;
  if (view !== 'ai') {
    closeAiEditPopover();
  }
  getRenderApp()();
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

const clearTargetFiltering: AppActionHandler = () => {
  const menu = state.contextMenu;
  if (!menu) {
    return;
  }
  clearFilteringForTarget(menu.sectionKey, menu.blockId);
  state.contextMenu = null;
  getRenderApp()();
};

const requestContextComponentChanges: AppActionHandler = () => {
  const menu = state.contextMenu;
  if (!menu?.blockId) {
    return;
  }
  state.contextMenu = null;
  openAiEditPopover(menu.sectionKey, menu.blockId, menu.x, menu.y);
  getRenderApp()();
};

const editContextComponent: AppActionHandler = () => {
  const menu = state.contextMenu;
  if (!menu?.blockId) {
    return;
  }
  state.contextMenu = null;
  setActiveEditorBlock(menu.sectionKey, menu.blockId);
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
  'clear-target-filtering': clearTargetFiltering,
  'request-context-component-changes': requestContextComponentChanges,
  'edit-context-component': editContextComponent,
};
