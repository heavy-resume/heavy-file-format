import { state, getRenderApp } from '../../state';
import { undoState, redoState } from '../../history';
import { setSidebarOpen, setEditorSidebarOpen } from '../../navigation';
import { serializeDocument } from '../../serialization';
import { clearChatConversation } from '../../chat/chat';
import { closeAiEditPopover } from '../../ai-edit-popover';
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
  const crossingAiBoundary = (state.currentView === 'ai') !== (view === 'ai');
  if (crossingAiBoundary) {
    clearChatConversation(state.chat);
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
  const editorMode = actionButton.dataset.editorMode === 'raw'
    ? 'raw'
    : actionButton.dataset.editorMode === 'advanced'
    ? 'advanced'
    : 'basic';
  state.editorMode = editorMode;
  state.showAdvancedEditor = editorMode === 'advanced';
  if (editorMode === 'raw') {
    state.rawEditorText = serializeDocument(state.document);
    state.rawEditorError = null;
    state.rawEditorDiagnostics = [];
  }
  if (!state.showAdvancedEditor) {
    state.metaPanelOpen = false;
  }
  state.activeEditorSectionTitleKey = null;
  getRenderApp()();
};

const toggleDocumentMeta: AppActionHandler = () => {
  state.metaPanelOpen = !state.metaPanelOpen;
  getRenderApp()();
};

const toggleViewerSidebar: AppActionHandler = ({ app }) => {
  setSidebarOpen(app, !state.viewerSidebarOpen);
};

const toggleEditorSidebar: AppActionHandler = ({ app }) => {
  setEditorSidebarOpen(app, !state.editorSidebarOpen);
};

const toggleChatPanel: AppActionHandler = () => {
  state.chat.panelOpen = !state.chat.panelOpen;
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
};
