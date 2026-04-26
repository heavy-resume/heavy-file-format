import { beforeAll } from 'vitest';

import { serializeDocument } from '../src/serialization';
import { initCallbacks, initState, state } from '../src/state';
import type { AppState, VisualDocument } from '../src/types';
import { createDefaultChatState } from '../src/chat/chat';

export function createTestState(document: VisualDocument): AppState {
  return {
    document,
    filename: 'test.hvy',
    currentView: 'editor',
    editorMode: 'basic',
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
    rawEditorText: serializeDocument(document),
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
    dbTableQueryModal: null,
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

export function serializeWithState(document: VisualDocument): string {
  state.document = document;
  return serializeDocument(document);
}

export function normalizeSerialized(text: string): string {
  return text
    .trim()
    .replace(/\r\n/g, '\n')
    .replace(/\n[ \t]*\n+/g, '\n\n')
    .replace(/\n\n(<!--hvy: \{)/g, '\n$1');
}

export function registerSerializationTestState(): void {
  beforeAll(() => {
    initCallbacks({
      renderApp: () => {},
      refreshReaderPanels: () => {},
      refreshModalPreview: () => {},
    });
    initState(
      createTestState({
        meta: { hvy_version: 0.1 },
        extension: '.hvy',
        sections: [],
        attachments: [],
      })
    );
  });
}
