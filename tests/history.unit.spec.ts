import { expect, test } from 'vitest';

import { getActiveStateRuntime, initCallbacks, initState, state } from '../src/state';
import { createDefaultChatState } from '../src/chat/chat';
import { createDefaultSearchState } from '../src/search/state';
import { createEmptyBlock } from '../src/document-factory';
import {
  captureHistoryStackState,
  clearDatabaseAttachmentChangedForQueuedHistory,
  markDatabaseAttachmentChanged,
  recordDatabaseAttachmentHistory,
  recordHistory,
  redoState,
  redoStateAsync,
  restoreHistoryStackState,
  undoState,
  undoStateAsync,
} from '../src/history';
import { DB_ATTACHMENT_ID, getAttachment, setAttachment } from '../src/attachments';
import { createScriptingDbRuntime } from '../src/plugins/db-table';
import type { AppState } from '../src/types';
import { attachStoreToDocument, createLazyAttachmentStore, ensureDocumentAttachmentStore } from '../src/attachment-store';
import { configureDatabaseHistoryStore, destroyDatabaseHistory, getDatabaseHistoryQueueStatus, runQueuedDatabaseHistoryCommand } from '../src/database-history-controller';
import { InMemoryHvyHistoryArtifactStore, type HvyHistoryArtifactPutRequest, type HvyHistoryArtifactStore } from '../src/history-artifact-store';

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
    rawEditorText: '#! First',
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

test('history stores later snapshots as deltas and restores them for undo and redo', () => {
  initCallbacks({
    renderApp: () => {},
    refreshReaderPanels: () => {},
    refreshModalPreview: () => {},
    componentRenderHelpers: null,
    readerRenderer: null,
  });
  initState(createHistoryTestState());

  recordHistory('initial-raw');
  state.rawEditorText = `${'A'.repeat(2000)} before`;
  recordHistory('edited-raw');
  state.rawEditorText = `${'A'.repeat(2000)} after`;

  expect(state.history[0]).not.toContain('__hvyHistoryDelta');
  expect(state.history[1]).toContain('__hvyHistoryDelta');

  undoState();
  expect(state.rawEditorText).toBe(`${'A'.repeat(2000)} before`);

  redoState();
  expect(state.rawEditorText).toBe(`${'A'.repeat(2000)} after`);
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

test('undo and redo keep image attachment bytes outside history snapshots', () => {
  initCallbacks({
    renderApp: () => {},
    refreshReaderPanels: () => {},
    refreshModalPreview: () => {},
    componentRenderHelpers: null,
    readerRenderer: null,
  });
  initState(createHistoryTestState());
  const imageBlock = createEmptyBlock('image');
  imageBlock.id = 'photo';
  imageBlock.schema.imageFile = 'photo.png';
  imageBlock.schema.imageAlt = 'Photo';
  state.document.sections = [{
    key: 'main',
    customId: '',
    contained: false,
    editorOnly: false,
    lock: false,
    idEditorOpen: false,
    isGhost: false,
    title: 'Main',
    level: 1,
    expanded: true,
    highlight: false,
    css: '',
    tags: '',
    description: '',
    location: 'main',
    blocks: [imageBlock],
    children: [],
  }];
  state.document.attachments = [
    { id: 'image:photo.png', meta: { mediaType: 'image/png' }, bytes: new Uint8Array([10, 20, 30]) },
  ];

  recordHistory('before-image-edit');
  expect(state.history[0]).toContain('"attachments": []');
  expect(state.history[0]).not.toContain('image:photo.png');
  expect(state.history[0]).not.toContain('10');
  state.rawEditorText = '#! Changed';
  state.document.sections[0]!.blocks[0]!.schema.imageAlt = 'Changed photo';
  state.document.attachments = [
    { id: 'image:photo.png', meta: { mediaType: 'image/png' }, bytes: new Uint8Array([40, 50]) },
  ];

  undoState();
  expect(state.document.sections[0]?.blocks[0]?.schema.imageAlt).toBe('Photo');
  expect(state.document.attachments[0]?.bytes).toBeInstanceOf(Uint8Array);
  expect(Array.from(state.document.attachments[0]?.bytes ?? [])).toEqual([40, 50]);

  redoState();
  expect(state.document.sections[0]?.blocks[0]?.schema.imageAlt).toBe('Changed photo');
  expect(state.document.attachments[0]?.bytes).toBeInstanceOf(Uint8Array);
  expect(Array.from(state.document.attachments[0]?.bytes ?? [])).toEqual([40, 50]);
});

test('history snapshots do not materialize lazy image attachment bytes', () => {
  const store = createLazyAttachmentStore([
    {
      id: 'image:large-photo.jpg',
      meta: { mediaType: 'image/jpeg' },
      length: 4,
      source: {
        bytes: new Uint8Array([10, 20, 30, 40]),
        offset: 0,
        length: 4,
      },
    },
  ]);
  initCallbacks({
    renderApp: () => {},
    refreshReaderPanels: () => {},
    refreshModalPreview: () => {},
    componentRenderHelpers: null,
    readerRenderer: null,
  });
  initState(createHistoryTestState());
  attachStoreToDocument(state.document, store);

  recordHistory('before-text-edit');
  state.rawEditorText = '#! Edited';
  recordHistory('after-text-edit');
  undoState();
  redoState();

  expect(ensureDocumentAttachmentStore(state.document).isMaterialized('image:large-photo.jpg')).toBe(false);
  expect(state.history.join('\n')).not.toContain('10');
  expect(state.history.join('\n')).not.toContain('large-photo.jpg');
});

test('undo and redo restore database attachment checkpoints without snapshotting other attachments', () => {
  initCallbacks({
    renderApp: () => {},
    refreshReaderPanels: () => {},
    refreshModalPreview: () => {},
    componentRenderHelpers: null,
    readerRenderer: null,
  });
  initState(createHistoryTestState());
  state.document.attachments = [
    { id: DB_ATTACHMENT_ID, meta: { mediaType: 'application/vnd.sqlite3' }, bytes: new Uint8Array([1, 2]) },
    { id: 'image:photo.png', meta: { mediaType: 'image/png' }, bytes: new Uint8Array([10, 20]) },
  ];

  recordDatabaseAttachmentHistory();
  expect(state.history.join('\n')).toContain('databaseAttachment');
  expect(state.history.join('\n')).toContain('\\"bytes\\": [\\n      1,\\n      2\\n    ]');
  expect(state.history.join('\n')).not.toContain('image:photo.png');
  setAttachment(
    state.document,
    DB_ATTACHMENT_ID,
    { mediaType: 'application/vnd.sqlite3' },
    new Uint8Array([3, 4])
  );
  markDatabaseAttachmentChanged();

  undoState();
  expect(Array.from(state.document.attachments.find((attachment) => attachment.id === DB_ATTACHMENT_ID)?.bytes ?? [])).toEqual([1, 2]);
  expect(Array.from(state.document.attachments.find((attachment) => attachment.id === 'image:photo.png')?.bytes ?? [])).toEqual([10, 20]);

  redoState();
  expect(Array.from(state.document.attachments.find((attachment) => attachment.id === DB_ATTACHMENT_ID)?.bytes ?? [])).toEqual([3, 4]);
  expect(Array.from(state.document.attachments.find((attachment) => attachment.id === 'image:photo.png')?.bytes ?? [])).toEqual([10, 20]);
});

test('script database writes share one undo checkpoint per runtime', async () => {
  initCallbacks({
    renderApp: () => {},
    refreshReaderPanels: () => {},
    refreshModalPreview: () => {},
    componentRenderHelpers: null,
    readerRenderer: null,
  });
  initState(createHistoryTestState());
  const runtime = await createScriptingDbRuntime(state.document);

  try {
    runtime.api.execute('CREATE TABLE chores (id INTEGER PRIMARY KEY, title TEXT NOT NULL)');
    runtime.api.execute('INSERT INTO chores (title) VALUES (?)', ['Sweep']);
  } finally {
    runtime.dispose();
  }

  expect(state.document.attachments.find((attachment) => attachment.id === DB_ATTACHMENT_ID)).not.toBeUndefined();

  undoState();
  expect(state.document.attachments.find((attachment) => attachment.id === DB_ATTACHMENT_ID)).toBeUndefined();

  redoState();
  expect(state.document.attachments.find((attachment) => attachment.id === DB_ATTACHMENT_ID)).not.toBeUndefined();
});

test('queued checkpoint edits undo document config and SQLite bytes as one step', async () => {
  initCallbacks({ renderApp: () => {}, refreshReaderPanels: () => {}, refreshModalPreview: () => {}, componentRenderHelpers: null, readerRenderer: null });
  initState(createHistoryTestState());
  setAttachment(state.document, DB_ATTACHMENT_ID, { mediaType: 'application/vnd.sqlite3' }, new Uint8Array([1]));
  const store = new CountingHistoryStore();
  configureDatabaseHistoryStore(getActiveStateRuntime(), store);
  const commandDocument = state.document;

  // BEFORE
  expect(state.rawEditorText).toBe('#! First');
  expect(readDatabaseTestBytes()).toEqual([1]);

  // TOOL CALL
  await runQueuedDatabaseHistoryCommand({
    label: 'Drop column',
    reason: 'Drop column',
    document: commandDocument,
    mode: 'checkpoint',
    recordBefore: () => recordHistory(),
    captureHistoryState: captureHistoryStackState,
    rollbackHistory: restoreHistoryStackState,
    clearDatabaseChangedFlag: clearDatabaseAttachmentChangedForQueuedHistory,
    execute: () => {
      state.rawEditorText = '#! Config after';
      setAttachment(state.document, DB_ATTACHMENT_ID, { mediaType: 'application/vnd.sqlite3' }, new Uint8Array([2]));
      markDatabaseAttachmentChanged();
    },
  });

  // AFTER
  expect(store.putCount).toBe(1);
  expect(state.history.join('\n')).not.toContain('"bytes"');
  await undoStateAsync();
  expect(state.rawEditorText).toBe('#! First');
  expect(readDatabaseTestBytes()).toEqual([1]);
  expect(store.putCount).toBe(2);
  await redoStateAsync();
  expect(state.rawEditorText).toBe('#! Config after');
  expect(readDatabaseTestBytes()).toEqual([2]);
  expect(store.putCount).toBe(2);
});

test('queued logical edits use inverse operations without storing database checkpoints', async () => {
  initCallbacks({ renderApp: () => {}, refreshReaderPanels: () => {}, refreshModalPreview: () => {}, componentRenderHelpers: null, readerRenderer: null });
  initState(createHistoryTestState());
  setAttachment(state.document, DB_ATTACHMENT_ID, { mediaType: 'application/vnd.sqlite3' }, new Uint8Array([4]));
  const store = new CountingHistoryStore();
  configureDatabaseHistoryStore(getActiveStateRuntime(), store);
  const commandDocument = state.document;

  // BEFORE / TOOL CALL / AFTER
  await runQueuedDatabaseHistoryCommand({
    label: 'Edit cell',
    reason: 'Edit cell',
    document: commandDocument,
    mode: 'logical',
    recordBefore: () => recordHistory(),
    captureHistoryState: captureHistoryStackState,
    rollbackHistory: restoreHistoryStackState,
    clearDatabaseChangedFlag: clearDatabaseAttachmentChangedForQueuedHistory,
    execute: () => {
      setAttachment(commandDocument, DB_ATTACHMENT_ID, { mediaType: 'application/vnd.sqlite3' }, new Uint8Array([5]));
      markDatabaseAttachmentChanged();
      return { before: 4, after: 5 };
    },
    createLogicalTransition: ({ before, after }) => ({
      undo: () => setAttachment(commandDocument, DB_ATTACHMENT_ID, { mediaType: 'application/vnd.sqlite3' }, new Uint8Array([before])),
      redo: () => setAttachment(commandDocument, DB_ATTACHMENT_ID, { mediaType: 'application/vnd.sqlite3' }, new Uint8Array([after])),
    }),
  });
  expect(store.putCount).toBe(0);
  await undoStateAsync();
  expect(readDatabaseTestBytes()).toEqual([4]);
  await redoStateAsync();
  expect(readDatabaseTestBytes()).toEqual([5]);
  expect(store.putCount).toBe(0);
});

test('legacy full database history composes with queued logical history', async () => {
  initCallbacks({ renderApp: () => {}, refreshReaderPanels: () => {}, refreshModalPreview: () => {}, componentRenderHelpers: null, readerRenderer: null });
  initState(createHistoryTestState());
  const commandDocument = state.document;
  setAttachment(commandDocument, DB_ATTACHMENT_ID, { mediaType: 'application/vnd.sqlite3' }, new Uint8Array([20]));

  await runQueuedDatabaseHistoryCommand({
    label: 'Queued edit',
    reason: 'Queued edit',
    document: commandDocument,
    mode: 'logical',
    recordBefore: () => recordHistory(),
    captureHistoryState: captureHistoryStackState,
    rollbackHistory: restoreHistoryStackState,
    clearDatabaseChangedFlag: clearDatabaseAttachmentChangedForQueuedHistory,
    execute: () => setAttachment(commandDocument, DB_ATTACHMENT_ID, { mediaType: 'application/vnd.sqlite3' }, new Uint8Array([21])),
    createLogicalTransition: () => ({
      undo: () => setAttachment(commandDocument, DB_ATTACHMENT_ID, { mediaType: 'application/vnd.sqlite3' }, new Uint8Array([20])),
      redo: () => setAttachment(commandDocument, DB_ATTACHMENT_ID, { mediaType: 'application/vnd.sqlite3' }, new Uint8Array([21])),
    }),
  });
  recordDatabaseAttachmentHistory();
  setAttachment(state.document, DB_ATTACHMENT_ID, { mediaType: 'application/vnd.sqlite3' }, new Uint8Array([22]));
  markDatabaseAttachmentChanged();

  // The legacy checkpoint is one step, followed by the earlier logical inverse.
  await undoStateAsync();
  expect(readDatabaseTestBytes()).toEqual([21]);
  await undoStateAsync();
  expect(readDatabaseTestBytes()).toEqual([20]);
});

test('a failed checkpoint command restores bytes, document state, and redo history', async () => {
  initCallbacks({ renderApp: () => {}, refreshReaderPanels: () => {}, refreshModalPreview: () => {}, componentRenderHelpers: null, readerRenderer: null });
  initState(createHistoryTestState());
  setAttachment(state.document, DB_ATTACHMENT_ID, { mediaType: 'application/vnd.sqlite3' }, new Uint8Array([8]));
  state.future = ['preserved-redo'];

  await expect(runQueuedDatabaseHistoryCommand({
    label: 'Failed destructive edit',
    reason: 'Failed destructive edit',
    document: state.document,
    mode: 'checkpoint',
    recordBefore: () => recordHistory(),
    captureHistoryState: captureHistoryStackState,
    rollbackHistory: restoreHistoryStackState,
    clearDatabaseChangedFlag: clearDatabaseAttachmentChangedForQueuedHistory,
    execute: () => {
      state.rawEditorText = '#! Broken';
      setAttachment(state.document, DB_ATTACHMENT_ID, { mediaType: 'application/vnd.sqlite3' }, new Uint8Array([9]));
      throw new Error('forced failure');
    },
  })).rejects.toThrow('forced failure');

  expect(state.rawEditorText).toBe('#! First');
  expect(readDatabaseTestBytes()).toEqual([8]);
  expect(state.future).toEqual(['preserved-redo']);
});

test('a failed checkpoint-store write prevents the destructive command from starting', async () => {
  initCallbacks({ renderApp: () => {}, refreshReaderPanels: () => {}, refreshModalPreview: () => {}, componentRenderHelpers: null, readerRenderer: null });
  initState(createHistoryTestState());
  let executed = false;
  const failedStore: HvyHistoryArtifactStore = {
    put: async () => { throw new Error('history storage unavailable'); },
    get: async () => null,
    remove: async () => {},
  };
  configureDatabaseHistoryStore(getActiveStateRuntime(), failedStore);

  await expect(runQueuedDatabaseHistoryCommand({
    label: 'Protected destructive edit',
    reason: 'Protected destructive edit',
    document: state.document,
    mode: 'checkpoint',
    recordBefore: () => recordHistory(),
    captureHistoryState: captureHistoryStackState,
    rollbackHistory: restoreHistoryStackState,
    clearDatabaseChangedFlag: clearDatabaseAttachmentChangedForQueuedHistory,
    execute: () => { executed = true; },
  })).rejects.toThrow('history storage unavailable');

  expect(executed).toBe(false);
  expect(state.history).toEqual([]);
});

test('destroying database history removes retained external checkpoints', async () => {
  initCallbacks({ renderApp: () => {}, refreshReaderPanels: () => {}, refreshModalPreview: () => {}, componentRenderHelpers: null, readerRenderer: null });
  initState(createHistoryTestState());
  const runtime = getActiveStateRuntime();
  const store = new CountingHistoryStore();
  configureDatabaseHistoryStore(runtime, store);

  await runQueuedDatabaseHistoryCommand({
    label: 'Retained checkpoint',
    reason: 'Retained checkpoint',
    document: state.document,
    mode: 'checkpoint',
    recordBefore: () => recordHistory(),
    captureHistoryState: captureHistoryStackState,
    rollbackHistory: restoreHistoryStackState,
    clearDatabaseChangedFlag: clearDatabaseAttachmentChangedForQueuedHistory,
    execute: () => setAttachment(state.document, DB_ATTACHMENT_ID, { mediaType: 'application/vnd.sqlite3' }, new Uint8Array([31])),
  });
  expect(store.size).toBe(1);

  await destroyDatabaseHistory(runtime);
  expect(store.size).toBe(0);
});

test('database commands execute FIFO and expose pending queue state', async () => {
  initCallbacks({ renderApp: () => {}, refreshReaderPanels: () => {}, refreshModalPreview: () => {}, componentRenderHelpers: null, readerRenderer: null });
  initState(createHistoryTestState());
  const order: string[] = [];
  let releaseFirst = () => {};
  let markFirstStarted = () => {};
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
  const command = (label: string, execute: () => Promise<void> | void) => runQueuedDatabaseHistoryCommand({
    label,
    reason: label,
    document: state.document,
    mode: 'logical' as const,
    recordBefore: () => recordHistory(),
    captureHistoryState: captureHistoryStackState,
    rollbackHistory: restoreHistoryStackState,
    clearDatabaseChangedFlag: clearDatabaseAttachmentChangedForQueuedHistory,
    execute,
    createLogicalTransition: () => ({ undo: () => {}, redo: () => {} }),
  });

  // BEFORE
  expect(getDatabaseHistoryQueueStatus().pending).toBe(0);

  // TOOL CALL
  const first = command('First', async () => {
    order.push('first:start');
    markFirstStarted();
    await firstGate;
    order.push('first:end');
  });
  const second = command('Second', () => { order.push('second'); });
  await firstStarted;

  // AFTER
  expect(getDatabaseHistoryQueueStatus().pending).toBe(2);
  expect(order).toEqual(['first:start']);
  releaseFirst();
  await Promise.all([first, second]);
  expect(order).toEqual(['first:start', 'first:end', 'second']);
  expect(getDatabaseHistoryQueueStatus()).toMatchObject({ pending: 0, runningLabel: '' });
});

class CountingHistoryStore extends InMemoryHvyHistoryArtifactStore {
  putCount = 0;

  override async put(request: HvyHistoryArtifactPutRequest): Promise<{ id: string }> {
    this.putCount += 1;
    return super.put(request);
  }
}

function readDatabaseTestBytes(): number[] {
  return Array.from(getAttachment(state.document, DB_ATTACHMENT_ID)?.bytes ?? []);
}
