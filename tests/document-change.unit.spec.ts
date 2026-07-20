import { expect, test, vi } from 'vitest';

import { createDefaultChatState } from '../src/chat/chat';
import { createDefaultSearchState } from '../src/search/state';
import { initCallbacks, initState, getActiveStateRuntime, state } from '../src/state';
import type { VisualSection } from '../src/editor/types';
import type { AppState, VisualDocument } from '../src/types';

vi.mock('../src/serialization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/serialization')>();
  return {
    ...actual,
    serializeDocumentBytes: vi.fn((document: VisualDocument) =>
      new TextEncoder().encode(JSON.stringify({
        title: document.meta.title ?? '',
        sectionCount: document.sections.length,
      }))
    ),
  };
});

function createDocumentChangeTestState(): AppState {
  return {
    document: {
      meta: { hvy_version: 0.1, title: 'Initial' },
      extension: '.hvy',
      sections: [],
      attachments: [],
    },
    filename: 'test.hvy',
    currentView: 'editor',
    editorMode: 'basic',
    responsivePreview: 'full',
    chat: createDefaultChatState(),
    search: createDefaultSearchState(),
    metaFilter: {
      query: '',
      mode: 'semantic',
      isRunning: false,
      status: null,
      error: null,
      resultCount: null,
    },
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
      fullPaneTop: 0,
      editorTop: 0,
      editorSidebarTop: 0,
      viewerSidebarTop: 0,
      readerTop: 0,
      windowLeft: 0,
      windowTop: 0,
    },
    showAdvancedEditor: false,
    rawEditorText: '',
    rawEditorError: null,
    rawEditorDiagnostics: [],
    cliDraft: '',
    cliSession: { cwd: '/' },
    cliHistory: [],
    activeEditorBlock: null,
    aiEditorHostBlock: null,
    aiEditorHostSectionKey: null,
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
    newDocumentModalOpen: false,
    reusableSaveModal: null,
    reusableTemplateModal: null,
    sectionTemplateFlavorModal: null,
    tempHighlights: new Set<string>(),
    addComponentBySection: {},
    metaPanelOpen: false,
    openTemplateDefinitionKeys: [],
    openTextLineStyleName: null,
    paragraphStyleRecentNames: [],
    selectedReusableComponentName: null,
    templateValues: {},
    history: [],
    future: [],
    isRestoring: false,
    componentMetaModal: null,
    sqliteRowComponentModal: null,
    dbTableQueryModal: null,
    pdfExportPlanModal: null,
    pdfTemplateImportModal: null,
    pdfStylePresets: [],
    pdfStylePresetId: null,
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
    transientNotice: null,
  };
}

function createSection(key: string, title: string): VisualSection {
  return {
    key,
    customId: key,
    contained: false,
    editorOnly: false,
    lock: false,
    idEditorOpen: false,
    isGhost: false,
    title,
    level: 1,
    expanded: true,
    highlight: false,
    css: '',
    tags: '',
    description: '',
    location: 'main',
    blocks: [],
    children: [],
  };
}

test('document change notifications use revisions without serializing document bytes', async () => {
  const { initDocumentChangeTracking, isDocumentDirty, markDocumentSaved, notifyDocumentMayHaveChanged } = await import('../src/document-change');
  const { serializeDocumentBytes } = await import('../src/serialization');
  const serializeDocumentBytesMock = vi.mocked(serializeDocumentBytes);
  initCallbacks({
    renderApp: () => {},
    refreshReaderPanels: () => {},
    refreshModalPreview: () => {},
    componentRenderHelpers: null,
    readerRenderer: null,
  });
  initState(createDocumentChangeTestState());
  const expectedEvents: Array<{ dirty: boolean; reason?: string }> = [];

  initDocumentChangeTracking(getActiveStateRuntime(), (event) => expectedEvents.push(event));
  serializeDocumentBytesMock.mockClear();

  notifyDocumentMayHaveChanged('before-title-input', 'editor');
  state.document.meta.title = 'Edited';
  await Promise.resolve();

  expect(serializeDocumentBytesMock).not.toHaveBeenCalled();
  expect(expectedEvents.at(-1)).toEqual({
    dirty: true,
    reason: 'before-title-input',
    source: 'editor',
    changedSectionTitles: [],
  });

  expect(isDocumentDirty(getActiveStateRuntime())).toBe(true);
  expect(serializeDocumentBytesMock).toHaveBeenCalledTimes(1);

  serializeDocumentBytesMock.mockClear();
  markDocumentSaved(getActiveStateRuntime());
  expect(serializeDocumentBytesMock).toHaveBeenCalledTimes(1);
  expect(expectedEvents.at(-1)).toEqual({ dirty: false, reason: 'mark-saved', changedSectionTitles: [] });
});

test('document change notifications accumulate changed section titles since save', async () => {
  const { initDocumentChangeTracking, markDocumentSaved, notifyDocumentMayHaveChanged } = await import('../src/document-change');
  initState(createDocumentChangeTestState());
  state.document.sections = [createSection('summary-id', 'Summary'), createSection('skills-id', 'Skills')];
  const expectedEvents: Array<{ dirty: boolean; changedSectionTitles: string[] }> = [];
  initDocumentChangeTracking(getActiveStateRuntime(), (event) => expectedEvents.push(event));

  state.document.sections[0].description = 'Changed summary';
  notifyDocumentMayHaveChanged('summary-edit', 'editor');
  await Promise.resolve();
  expect(expectedEvents.at(-1)?.changedSectionTitles).toEqual(['Summary']);

  state.document.sections[1].description = 'Changed skills';
  notifyDocumentMayHaveChanged('skills-edit', 'editor');
  await Promise.resolve();
  expect(expectedEvents.at(-1)?.changedSectionTitles).toEqual(['Summary', 'Skills']);
  expect(expectedEvents.at(-1)?.changedSectionTitles).not.toContain('summary-id');

  markDocumentSaved(getActiveStateRuntime());
  expect(expectedEvents.at(-1)?.changedSectionTitles).toEqual([]);

  state.document.sections[1].title = 'Core Skills';
  notifyDocumentMayHaveChanged('skills-title-edit', 'editor');
  await Promise.resolve();
  expect(expectedEvents.at(-1)?.changedSectionTitles).toEqual(['Core Skills']);

  state.document.sections.push(createSection('untitled-id', 'Unnamed Section'));
  notifyDocumentMayHaveChanged('untitled-section-add', 'editor');
  await Promise.resolve();
  expect(expectedEvents.at(-1)?.changedSectionTitles).toEqual(['Core Skills', '']);
});
