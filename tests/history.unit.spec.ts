import { expect, test } from 'vitest';

import { initCallbacks, initState, state } from '../src/state';
import { createDefaultChatState } from '../src/chat';
import { undoState, redoState } from '../src/history';
import type { AppState } from '../src/types';

function createHistoryTestState(): AppState {
  return {
    document: {
      meta: { hvy_version: 0.1 },
      extension: '.hvy',
      sections: [],
    },
    filename: 'test.hvy',
    currentView: 'editor',
    editorMode: 'raw',
    chat: createDefaultChatState(),
    aiEdit: {
      sectionKey: null,
      blockId: null,
      draft: '',
      isSending: false,
      error: null,
      popupX: 0,
      popupY: 0,
      requestNonce: 0,
    },
    paneScroll: {
      editorTop: 0,
      editorSidebarTop: 0,
      viewerSidebarTop: 0,
      readerTop: 0,
      windowTop: 0,
    },
    showAdvancedEditor: false,
    rawEditorText: '#! First',
    rawEditorError: null,
    rawEditorDiagnostics: [],
    activeEditorBlock: null,
    activeEditorSectionTitleKey: null,
    clearSectionTitleOnFocusKey: null,
    modalSectionKey: null,
    reusableSaveModal: null,
    tempHighlights: new Set<string>(),
    addComponentBySection: {},
    metaPanelOpen: false,
    selectedReusableComponentName: null,
    templateValues: {},
    history: [],
    future: [],
    isRestoring: false,
    componentMetaModal: null,
    sqliteRowComponentModal: null,
    themeModalOpen: false,
    gridAddComponentByBlock: {},
    expandableEditorPanels: {},
    viewerSidebarOpen: false,
    editorSidebarOpen: false,
    lastHistoryGroup: null,
    lastHistoryAt: 0,
    pendingEditorCenterSectionKey: null,
  };
}

test('undo and redo restore grouped raw editor text snapshots', () => {
  initCallbacks({
    renderApp: () => {},
    refreshReaderPanels: () => {},
    refreshModalPreview: () => {},
  });
  initState(createHistoryTestState());

  state.history.push(
    JSON.stringify({
      document: state.document,
      templateValues: state.templateValues,
      filename: state.filename,
      editorMode: 'raw',
      showAdvancedEditor: false,
      rawEditorText: '#! First',
      rawEditorError: null,
      rawEditorDiagnostics: [],
    })
  );

  state.rawEditorText = '#! Third';

  undoState();
  expect(state.rawEditorText).toBe('#! First');

  redoState();
  expect(state.rawEditorText).toBe('#! Third');
});
