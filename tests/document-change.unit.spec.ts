import { afterEach, expect, test, vi } from 'vitest';

import { createDefaultChatState } from '../src/chat/chat';
import { createDefaultSearchState } from '../src/search/state';
import { initCallbacks, initState, getActiveStateRuntime, state } from '../src/state';
import type { VisualSection } from '../src/editor/types';
import type { AppState } from '../src/types';

afterEach(() => vi.restoreAllMocks());

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
      documentMetaTop: 0,
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
    dbTableRowComponentModal: null,
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
    expanded: true,
    highlight: false,
    css: '',
    tags: '',
    description: '',
    location: 'main',
    blocks: [],
  };
}

test('document change notifications use revisions without serializing the document', async () => {
  const { initDocumentChangeTracking, isDocumentDirty, markDocumentSaved, notifyDocumentMayHaveChanged } = await import('../src/document-change');
  const serialization = await import('../src/serialization');
  const serializeDocumentSpy = vi.spyOn(serialization, 'serializeDocument');
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
  serializeDocumentSpy.mockClear();

  notifyDocumentMayHaveChanged('before-title-input', 'editor');
  state.document.meta.title = 'Edited';
  await Promise.resolve();

  expect(serializeDocumentSpy).not.toHaveBeenCalled();
  expect(expectedEvents.at(-1)).toEqual({
    dirty: true,
    reason: 'before-title-input',
    source: 'editor',
    changedSectionTitles: [],
  });

  expect(isDocumentDirty(getActiveStateRuntime())).toBe(true);
  expect(serializeDocumentSpy).toHaveBeenCalledTimes(1);

  serializeDocumentSpy.mockClear();
  markDocumentSaved(getActiveStateRuntime());
  expect(serializeDocumentSpy).toHaveBeenCalledTimes(1);
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

test('edits while a hold is active produce one notification, after the hold ends', async () => {
  initState(createDocumentChangeTestState());
  const runtime = getActiveStateRuntime();
  const { holdDocumentChangeFlush, initDocumentChangeTracking, notifyDocumentMayHaveChanged } = await import('../src/document-change');
  const expectedEvents: boolean[] = [];
  initDocumentChangeTracking(runtime, (event) => expectedEvents.push(event.dirty));
  const release = holdDocumentChangeFlush(runtime);

  state.document.meta.title = 'First';
  notifyDocumentMayHaveChanged('fake-first', 'script', { authoritative: true });
  await Promise.resolve();
  state.document.meta.title = 'Second';
  notifyDocumentMayHaveChanged('fake-second', 'script', { authoritative: true });
  await Promise.resolve();
  expect(expectedEvents).toEqual([]);

  release();

  expect(expectedEvents).toEqual([true]);
});

test('a change undone during a hold is reported as not dirty', async () => {
  initState(createDocumentChangeTestState());
  const runtime = getActiveStateRuntime();
  const { holdDocumentChangeFlush, initDocumentChangeTracking, isDocumentDirty, notifyDocumentMayHaveChanged } = await import('../src/document-change');
  initDocumentChangeTracking(runtime);
  const release = holdDocumentChangeFlush(runtime);

  state.document.meta.title = 'Changed';
  notifyDocumentMayHaveChanged('fake-change', 'script', { authoritative: true });
  await Promise.resolve();
  state.document.meta.title = 'Initial';
  notifyDocumentMayHaveChanged('fake-undo', 'script', { authoritative: true });
  release();

  expect(isDocumentDirty(runtime)).toBe(false);
});

test('releasing a hold with the settled text compares it without serializing again', async () => {
  const serialization = await import('../src/serialization');
  const serializeDocumentSpy = vi.spyOn(serialization, 'serializeDocument');
  initState(createDocumentChangeTestState());
  const runtime = getActiveStateRuntime();
  const { holdDocumentChangeFlush, initDocumentChangeTracking, notifyDocumentMayHaveChanged } = await import('../src/document-change');
  const expectedEvents: boolean[] = [];
  initDocumentChangeTracking(runtime, (event) => expectedEvents.push(event.dirty));
  const release = holdDocumentChangeFlush(runtime);
  state.document.meta.title = 'Changed';
  notifyDocumentMayHaveChanged('fake-change', 'script', { authoritative: true });
  await Promise.resolve();
  const settledText = serialization.serializeDocument(state.document);
  serializeDocumentSpy.mockClear();

  release(settledText);

  expect(serializeDocumentSpy).not.toHaveBeenCalled();
  expect(expectedEvents).toEqual([true]);
});

test('changed section titles are worked out when first read, then stay the same', async () => {
  const { initDocumentChangeTracking, notifyDocumentMayHaveChanged } = await import('../src/document-change');
  initState(createDocumentChangeTestState());
  state.document.sections = [createSection('summary-id', 'Summary'), createSection('skills-id', 'Skills')];
  const expectedEvents: Array<{ changedSectionTitles: string[] }> = [];
  initDocumentChangeTracking(getActiveStateRuntime(), (event) => expectedEvents.push(event));
  state.document.sections[0].description = 'Changed summary';
  notifyDocumentMayHaveChanged('summary-edit', 'editor');
  await Promise.resolve();

  state.document.sections[1].description = 'Changed before the first read';
  const firstRead = expectedEvents.at(-1)?.changedSectionTitles;
  state.document.sections[0].title = 'Renamed after the first read';

  expect(firstRead).toEqual(['Summary', 'Skills']);
  expect(expectedEvents.at(-1)?.changedSectionTitles).toBe(firstRead);
});

test('changes inside a noSave container do not mark the document dirty', async () => {
  const { deserializeDocument } = await import('../src/serialization');
  const { createEmptyBlock } = await import('../src/document-factory');
  const { initDocumentChangeTracking, isDocumentDirty, notifyDocumentMayHaveChanged } = await import('../src/document-change');
  initState(createDocumentChangeTestState());
  state.document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"feed"}-->
#! Feed

 <!--hvy:container {"id":"fake-feed","noSave":true}-->

<!--hvy: {"id":"notes"}-->
#! Notes

 <!--hvy:text {"id":"fake-note"}-->
  Fake note
`, '.hvy');
  const expectedEvents: Array<{ dirty: boolean; changedSectionTitles: string[] }> = [];
  initDocumentChangeTracking(getActiveStateRuntime(), (event) => expectedEvents.push(event));
  const [feedContainer] = state.document.sections[0]!.blocks;
  const [note] = state.document.sections[1]!.blocks;

  const fakeRuntimeRow = createEmptyBlock('text');
  fakeRuntimeRow.text = 'Fake runtime row';
  feedContainer!.schema.containerBlocks.push(fakeRuntimeRow);
  notifyDocumentMayHaveChanged('fake-script-write', 'script', { authoritative: true });
  await Promise.resolve();

  expect(isDocumentDirty(getActiveStateRuntime())).toBe(false);

  note!.text = 'Fake note edited';
  notifyDocumentMayHaveChanged('fake-note-edit', 'editor');
  await Promise.resolve();

  expect(expectedEvents.at(-1)?.dirty).toBe(true);
  expect(expectedEvents.at(-1)?.changedSectionTitles).toEqual(['Notes']);
});
