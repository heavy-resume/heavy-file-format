import { expect, test } from 'vitest';

import { initCallbacks, initState, state } from '../src/state';
import { createDefaultChatState } from '../src/chat/chat';
import { createDefaultSearchState } from '../src/search/state';
import { undoState, redoState } from '../src/history';
import type { AppState } from '../src/types';

function createHistoryTestState(): AppState {
  return {
    document: {
      meta: { hvy_version: 0.1 },
      extension: '.hvy',
      sections: [],
      attachments: [],
    },
    filename: 'test.hvy',
    currentView: 'editor',
    editorMode: 'raw',
    responsivePreview: 'full',
    chat: createDefaultChatState(),
    search: createDefaultSearchState(),
    aiModeTipDismissed: false,
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
      windowLeft: 0,
      windowTop: 0,
    },
    showAdvancedEditor: false,
    rawEditorText: '#! First',
    rawEditorError: null,
    rawEditorDiagnostics: [],
    cliDraft: '',
    cliSession: { cwd: '/' },
    cliHistory: [],
    activeEditorBlock: null,
    aiEditorHostBlock: null,
    activeEditorBlockPath: [],
    activeEditorBlockSnapshot: null,
    activeEditorBlockSnapshots: [],
    activeEditorNewBlockIds: new Set<string>(),
    activeEditorBlockReturnScroll: null,
    pendingPaneScrollRestore: null,
    componentPlacement: null,
    pendingEditorDeactivation: null,
    pendingEditorActivation: null,
    activeEditorSectionTitleKey: null,
    clearSectionTitleOnFocusKey: null,
    modalSectionKey: null,
    reusableSaveModal: null,
    reusableTemplateModal: null,
    sectionTemplateFlavorModal: null,
    tempHighlights: new Set<string>(),
    addComponentBySection: {},
    metaPanelOpen: false,
    openTextLineStyleName: null,
    selectedReusableComponentName: null,
    templateValues: {},
    history: [],
    future: [],
    isRestoring: false,
    componentMetaModal: null,
    sqliteRowComponentModal: null,
    dbTableQueryModal: null,
    themeModalOpen: false,
    themeModalMode: 'full',
    paletteOverrideId: null,
    gridAddComponentByBlock: {},
    expandableEditorPanels: {},
    readerExpandableState: {},
    readerContainerState: {},
    readerView: {},
    readerViewActivatedTargets: new Set<string>(),
    componentListReaderViews: {},
    viewerSidebarOpen: false,
    editorSidebarOpen: false,
    viewerSidebarHelpDismissed: false,
    editorSidebarHelpDismissed: false,
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
    componentRenderHelpers: null,
    readerRenderer: null,
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

test('undo and redo restore document theme snapshots', () => {
  initCallbacks({
    renderApp: () => {},
    refreshReaderPanels: () => {},
    refreshModalPreview: () => {},
    componentRenderHelpers: null,
    readerRenderer: null,
  });
  initState(createHistoryTestState());
  state.document.meta.theme = { colors: { '--hvy-button-bg': '#111111' } };
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
      paletteOverrideId: 'paper',
    })
  );

  state.document.meta.theme = { colors: { '--hvy-button-bg': '#222222' } };
  state.paletteOverrideId = 'ufo';

  undoState();
  expect(state.document.meta.theme).toEqual({ colors: { '--hvy-button-bg': '#111111' } });
  expect(state.paletteOverrideId).toBe('paper');

  redoState();
  expect(state.document.meta.theme).toEqual({ colors: { '--hvy-button-bg': '#222222' } });
  expect(state.paletteOverrideId).toBe('ufo');
});
