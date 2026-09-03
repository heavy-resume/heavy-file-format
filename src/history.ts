import { state, HISTORY_GROUP_WINDOW_MS, incrementHistorySnapshotCount, incrementRecordHistoryCount, getRenderApp } from './state';
import { debugMeasure } from './utils';
import type { DocumentAttachment, VisualDocument } from './types';
import { saveSessionState } from './state-persistence';
import { applyTheme } from './theme';
import { savePaletteOverrideId } from './palettes/palette-preferences';
import { inferDocumentChangeSource, notifyDocumentMayHaveChanged } from './document-change';
import { markKeywordChatContextDocumentChanged } from './chat/chat-context';
import { invalidateHvyCliSessionVirtualFileSystem } from './cli-core/commands';
import { DB_ATTACHMENT_ID, getAttachment, removeAttachment, setAttachment } from './attachments';
import type { AppState } from './types';
import type { VisualBlock } from './editor/types';
import { attachStoreToDocument, ensureDocumentAttachmentStore } from './attachment-store';
import { hasTextFillInMarker } from './text-fill-in';
import {
  adoptDatabaseHistoryVersion,
  enqueueDatabaseHistoryNavigation,
  getDatabaseHistoryVersion,
  hasDatabaseHistoryVersionTransition,
  invalidateDatabaseHistoryVersion,
  isQueuedDatabaseHistoryCommandActive,
  restoreDatabaseHistoryVersion,
} from './database-history-controller';
import {
  getAttachmentHistoryVersion,
  hasAttachmentHistoryVersionTransition,
  restoreAttachmentHistoryVersion,
} from './attachment-history-controller';
import { recordDatabaseTablesChanged } from './database-change-tracker';
import { findSectionByKey } from './section-ops';
import {
  prepareHistoryViewportTransition,
} from './history-viewport-transition';

interface HistorySnapshotOptions {
  includeDatabaseAttachment?: boolean;
}

interface SerializedHistoryAttachment {
  id: string;
  meta: DocumentAttachment['meta'];
  bytes: number[];
}

interface ParsedHistorySnapshot {
  document: VisualDocument;
  databaseAttachment?: SerializedHistoryAttachment | null;
  databaseHistoryVersion?: string | null;
  attachmentHistoryVersion?: string | null;
  templateValues: Record<string, string>;
  filename: string;
  editorMode?: 'basic' | 'advanced' | 'raw' | 'cli';
  showAdvancedEditor?: boolean;
  rawEditorText?: string;
  rawEditorError?: string | null;
  rawEditorDiagnostics?: typeof state.rawEditorDiagnostics;
  paletteOverrideId?: string | null;
}

export interface HistoryStackState {
  history: string[];
  future: string[];
  currentSnapshot: string;
}

interface HistoryDeltaEntry {
  __hvyHistoryDelta: 1;
  prefixLength: number;
  deleteLength: number;
  insert: string;
}

export interface HistoryEditorContext {
  sectionKey?: string;
  blockId?: string;
  preferredEditorTarget?: NonNullable<NonNullable<AppState['pendingEditorActivation']>['preferredEditorTarget']>;
}

interface StoredHistoryEntry {
  __hvyHistoryEntry: 1;
  content: string;
  editorContext?: HistoryEditorContext | null;
}

let databaseAttachmentChangedSinceHistory = false;
const editorContextBeforeInput = new WeakMap<HTMLElement, HistoryEditorContext>();
const editorContextAfterInput = new WeakMap<VisualBlock, HistoryEditorContext>();
const standaloneEditorContextAfterInput = new WeakMap<VisualDocument, HistoryEditorContext>();

type ActiveEditorRestoreState = Pick<AppState,
  | 'activeEditorBlock'
  | 'activeTextEditorMode'
  | 'activeEditorBlockPath'
  | 'activeEditorBlockSnapshot'
  | 'activeEditorBlockSnapshots'
  | 'activeEditorBlockReturnScroll'
  | 'aiEditorHostBlock'
  | 'aiEditorHostSectionKey'
> & {
  activeEditorNewBlockIds: Set<string>;
  preferredEditorTarget: NonNullable<AppState['pendingEditorActivation']>['preferredEditorTarget'] | null;
};

export function snapshotState(options: HistorySnapshotOptions = {}): string {
  return JSON.stringify(
    {
      document: documentToHistorySnapshot(state.document),
      ...(options.includeDatabaseAttachment
        ? { databaseAttachment: serializeHistoryAttachment(getAttachment(state.document, DB_ATTACHMENT_ID)) }
        : {}),
      ...(getDatabaseHistoryVersion() !== null
        ? { databaseHistoryVersion: getDatabaseHistoryVersion() }
        : {}),
      ...(getAttachmentHistoryVersion() !== null
        ? { attachmentHistoryVersion: getAttachmentHistoryVersion() }
        : {}),
      templateValues: state.templateValues,
      filename: state.filename,
      editorMode: state.editorMode,
      showAdvancedEditor: state.showAdvancedEditor,
      rawEditorText: state.rawEditorText,
      rawEditorError: state.rawEditorError,
      rawEditorDiagnostics: state.rawEditorDiagnostics,
      paletteOverrideId: state.paletteOverrideId,
    },
    null,
    2
  );
}

export function commitHistorySnapshot(): void {
  if (state.isRestoring) {
    return;
  }
  const snapshotId = incrementHistorySnapshotCount();
  const snap = debugMeasure('snapshotState:commit', { snapshotId, historyLength: state.history.length }, () => snapshotState());
  const last = getLastHistorySnapshot();
  if (last !== snap) {
    pushHistorySnapshot(snap);
    state.future = [];
    saveSessionState(state);
  }
}

export function ensureHistoryInitialized(): void {
  if (!Array.isArray(state.history)) {
    state.history = [];
  }
  if (!Array.isArray(state.future)) {
    state.future = [];
  }
  if (state.history.length === 0) {
    commitHistorySnapshot();
  }
}

export function recordHistory(group?: string, options: { notify?: boolean } = {}): void {
  if (state.isRestoring) {
    return;
  }
  if (isQueuedDatabaseHistoryCommandActive()) {
    return;
  }
  markKeywordChatContextDocumentChanged(state.document);
  invalidateHvyCliSessionVirtualFileSystem(state.cliSession);
  const changeSource = inferDocumentChangeSource(group);
  const contextBeforeInput = consumeHistoryEditorContextBeforeInput();
  const contextAfterInput = captureHistoryEditorContext();
  rememberHistoryEditorContextAfterInput(contextAfterInput ?? contextBeforeInput);
  const editorContext = contextBeforeInput ?? contextAfterInput;
  const recordId = incrementRecordHistoryCount();
  const startedAt = performance.now();
  let ensureMs = 0;
  let snapshotMs = 0;
  let skipped: string | null = null;
  let pushed = false;
  let stepStartedAt = performance.now();
  ensureHistoryInitialized();
  ensureMs = performance.now() - stepStartedAt;
  if (group) {
    const now = Date.now();
    if (state.lastHistoryGroup === group && now - state.lastHistoryAt < HISTORY_GROUP_WINDOW_MS) {
      skipped = 'group-window';
      console.debug('[hvy:perf] recordHistory', {
        recordId,
        group,
        elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
        ensureMs: Number(ensureMs.toFixed(2)),
        snapshotMs: Number(snapshotMs.toFixed(2)),
        historyLength: state.history.length,
        pushed,
        skipped,
      });
      if (options.notify !== false) notifyDocumentMayHaveChanged(group, changeSource);
      return;
    }
    state.lastHistoryGroup = group;
    state.lastHistoryAt = now;
  } else {
    state.lastHistoryGroup = null;
    state.lastHistoryAt = 0;
  }
  stepStartedAt = performance.now();
  const snap = snapshotState();
  snapshotMs = performance.now() - stepStartedAt;
  if (getLastHistorySnapshot() !== snap) {
    pushHistorySnapshot(snap, { editorContext });
    state.future = [];
    pushed = true;
    saveSessionState(state);
  } else {
    updateLastHistoryEditorContext(editorContext);
  }
  console.debug('[hvy:perf] recordHistory', {
    recordId,
    group,
    elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
    ensureMs: Number(ensureMs.toFixed(2)),
    snapshotMs: Number(snapshotMs.toFixed(2)),
    historyLength: state.history.length,
    pushed,
    skipped,
  });
  if (options.notify !== false) notifyDocumentMayHaveChanged(group, changeSource);
}

export function recordDatabaseAttachmentHistory(): void {
  if (state.isRestoring) {
    return;
  }
  if (isQueuedDatabaseHistoryCommandActive()) {
    return;
  }
  ensureHistoryInitialized();
  const snap = snapshotState({ includeDatabaseAttachment: true });
  if (getLastHistorySnapshot() !== snap) {
    pushHistorySnapshot(snap);
    state.future = [];
    saveSessionState(state);
  }
  databaseAttachmentChangedSinceHistory = false;
}

export function markDatabaseAttachmentChanged(): void {
  if (!state.isRestoring) {
    databaseAttachmentChangedSinceHistory = true;
    invalidateDatabaseHistoryVersion();
  }
}

export function clearDatabaseAttachmentChangedForQueuedHistory(): void {
  databaseAttachmentChangedSinceHistory = false;
}

export function captureHistoryStackState(): HistoryStackState {
  return { history: [...state.history], future: [...state.future], currentSnapshot: snapshotState() };
}

export function restoreHistoryStackState(value: unknown): void {
  const captured = value as HistoryStackState;
  state.history = [...captured.history];
  state.future = [...captured.future];
  restoreFromSnapshot(captured.currentSnapshot);
}

export function undoState(): void {
  ensureHistoryInitialized();
  const modalScroll = captureModalScroll();
  const activeEditor = captureActiveEditorRestoreState();
  const current = snapshotState({ includeDatabaseAttachment: databaseAttachmentChangedSinceHistory });
  const currentEditorContext = getHistoryEditorContextAfterInput() ?? captureHistoryEditorContext();
  const last = getLastHistorySnapshot();
  if (last !== current) {
    pushHistorySnapshot(current, { clearFuture: false, editorContext: currentEditorContext });
  }
  databaseAttachmentChangedSinceHistory = false;
  if (state.history.length <= 1) {
    return;
  }
  const targetSnapshot = getHistorySnapshotAt(state.history.length - 2);
  const activeHistoryContext = getHistoryEditorContextAt(state.history.length - 1);
  if (activeHistoryContext && !historySnapshotContainsActiveEditor(targetSnapshot, activeEditor)) {
    return;
  }
  state.isRestoring = true;
  const currentSnapshot = getLastHistorySnapshot();
  const storedCurrentEditorContext = getHistoryEditorContextAt(state.history.length - 1);
  state.history.pop();
  if (currentSnapshot) {
    state.future.push(encodeStoredHistoryEntry(currentSnapshot, storedCurrentEditorContext));
  }
  const prev = getLastHistorySnapshot();
  if (prev) {
    restoreFromSnapshot(prev);
    restoreActiveEditorState(activeEditor, getHistoryEditorContextAt(state.history.length - 1));
  }
  state.lastHistoryGroup = null;
  state.lastHistoryAt = 0;
  state.isRestoring = false;
  getRenderApp()();
  restoreModalScroll(modalScroll);
  notifyDocumentMayHaveChanged('undo', inferDocumentChangeSource('undo'), { authoritative: true });
}

export function redoState(): void {
  ensureHistoryInitialized();
  const modalScroll = captureModalScroll();
  const activeEditor = captureActiveEditorRestoreState();
  const nextEntry = state.future.pop();
  if (!nextEntry) {
    return;
  }
  const storedNext = parseStoredHistoryEntry(nextEntry);
  const next = storedNext?.content ?? nextEntry;
  const nextEditorContext = storedNext?.editorContext ?? null;
  state.isRestoring = true;
  pushHistorySnapshot(next, { clearFuture: false, editorContext: nextEditorContext });
  restoreFromSnapshot(next);
  restoreActiveEditorState(activeEditor, nextEditorContext);
  state.lastHistoryGroup = null;
  state.lastHistoryAt = 0;
  state.isRestoring = false;
  getRenderApp()();
  restoreModalScroll(modalScroll);
  notifyDocumentMayHaveChanged('redo', inferDocumentChangeSource('redo'), { authoritative: true });
}

export function undoStateAsync(root?: HTMLElement | null): Promise<void> {
  return enqueueDatabaseHistoryNavigation('Undo database edit', async () => {
    ensureHistoryInitialized();
    const current = snapshotState({ includeDatabaseAttachment: databaseAttachmentChangedSinceHistory });
    const last = getLastHistorySnapshot();
    const targetIndex = last !== current ? state.history.length - 1 : state.history.length - 2;
    if (targetIndex < 0) return;
    const target = getHistorySnapshotAt(targetIndex);
    const targetEditorContext = getHistoryEditorContextAt(targetIndex);
    const activeEditor = captureActiveEditorRestoreState();
    const activeHistoryContext = getHistoryEditorContextAfterInput()
      ?? getHistoryEditorContextAt(state.history.length - 1);
    if (activeHistoryContext && !historySnapshotContainsActiveEditor(target, activeEditor)) return;
    await prepareHistoryViewportTransition(activeHistoryContext, root);
    const targetDatabaseVersion = getHistoryDatabaseVersion(target);
    const targetAttachmentVersion = getHistoryAttachmentVersion(target);
    if (!hasDatabaseHistoryVersionTransition(targetDatabaseVersion)
      && !hasAttachmentHistoryVersionTransition(targetAttachmentVersion)) {
      undoState();
      return;
    }
    const modalScroll = captureModalScroll();
    const currentEditorContext = getHistoryEditorContextAfterInput() ?? captureHistoryEditorContext();
    state.isRestoring = true;
    try {
      restoreFromSnapshot(target);
      await restoreDatabaseHistoryVersion(targetDatabaseVersion);
      await restoreAttachmentHistoryVersion(targetAttachmentVersion);
    } catch (error) {
      restoreFromSnapshot(current);
      await restoreDatabaseHistoryVersion(getHistoryDatabaseVersion(current)).catch(() => {});
      await restoreAttachmentHistoryVersion(getHistoryAttachmentVersion(current)).catch(() => {});
      state.isRestoring = false;
      throw error;
    }
    if (last !== current) pushHistorySnapshot(current, { clearFuture: false, editorContext: currentEditorContext });
    databaseAttachmentChangedSinceHistory = false;
    const currentSnapshot = getLastHistorySnapshot();
    const storedCurrentEditorContext = getHistoryEditorContextAt(state.history.length - 1);
    state.history.pop();
    if (currentSnapshot) state.future.push(encodeStoredHistoryEntry(currentSnapshot, storedCurrentEditorContext));
    restoreActiveEditorState(activeEditor, targetEditorContext);
    finishHistoryNavigation('undo', modalScroll);
  });
}

export function redoStateAsync(root?: HTMLElement | null): Promise<void> {
  return enqueueDatabaseHistoryNavigation('Redo database edit', async () => {
    ensureHistoryInitialized();
    const nextEntry = state.future[state.future.length - 1];
    if (!nextEntry) return;
    const storedNext = parseStoredHistoryEntry(nextEntry);
    const next = storedNext?.content ?? nextEntry;
    const nextEditorContext = storedNext?.editorContext ?? null;
    await prepareHistoryViewportTransition(nextEditorContext, root);
    const nextDatabaseVersion = getHistoryDatabaseVersion(next);
    const nextAttachmentVersion = getHistoryAttachmentVersion(next);
    if (!hasDatabaseHistoryVersionTransition(nextDatabaseVersion)
      && !hasAttachmentHistoryVersionTransition(nextAttachmentVersion)) {
      redoState();
      return;
    }
    const modalScroll = captureModalScroll();
    const activeEditor = captureActiveEditorRestoreState();
    const current = snapshotState();
    state.isRestoring = true;
    try {
      restoreFromSnapshot(next);
      await restoreDatabaseHistoryVersion(nextDatabaseVersion);
      await restoreAttachmentHistoryVersion(nextAttachmentVersion);
    } catch (error) {
      restoreFromSnapshot(current);
      await restoreDatabaseHistoryVersion(getHistoryDatabaseVersion(current)).catch(() => {});
      await restoreAttachmentHistoryVersion(getHistoryAttachmentVersion(current)).catch(() => {});
      state.isRestoring = false;
      throw error;
    }
    state.future.pop();
    pushHistorySnapshot(next, { clearFuture: false, editorContext: nextEditorContext });
    restoreActiveEditorState(activeEditor, nextEditorContext);
    finishHistoryNavigation('redo', modalScroll);
  });
}

function finishHistoryNavigation(
  action: 'undo' | 'redo',
  modalScroll: { selector: string; scrollTop: number } | null,
): void {
  state.lastHistoryGroup = null;
  state.lastHistoryAt = 0;
  state.isRestoring = false;
  getRenderApp()();
  restoreModalScroll(modalScroll);
  notifyDocumentMayHaveChanged(action, inferDocumentChangeSource(action), { authoritative: true });
}

function pushHistorySnapshot(
  snapshot: string,
  options: { clearFuture?: boolean; editorContext?: HistoryEditorContext | null } = {}
): void {
  const previous = getLastHistorySnapshot();
  state.history.push(encodeStoredHistoryEntry(
    encodeHistoryEntry(previous, snapshot),
    options.editorContext === undefined ? captureHistoryEditorContext() : options.editorContext
  ));
  compactHistoryLimit();
  if (options.clearFuture ?? true) {
    state.future = [];
  }
}

function compactHistoryLimit(): void {
  if (state.history.length <= 200) {
    return;
  }
  const firstKeptIndex = state.history.length - 200;
  const firstKeptSnapshot = getHistorySnapshotAt(firstKeptIndex);
  const firstKeptEditorContext = getHistoryEditorContextAt(firstKeptIndex);
  state.history = [encodeStoredHistoryEntry(firstKeptSnapshot, firstKeptEditorContext), ...state.history.slice(firstKeptIndex + 1)];
}

function getLastHistorySnapshot(): string | null {
  return state.history.length > 0 ? getHistorySnapshotAt(state.history.length - 1) : null;
}

function getHistorySnapshotAt(index: number): string {
  let snapshot = '';
  for (let entryIndex = 0; entryIndex <= index; entryIndex += 1) {
    snapshot = applyHistoryEntry(snapshot, state.history[entryIndex] ?? '');
  }
  return snapshot;
}

function getHistoryEditorContextAt(index: number): HistoryEditorContext | null {
  return parseStoredHistoryEntry(state.history[index] ?? '')?.editorContext ?? null;
}

function encodeStoredHistoryEntry(content: string, editorContext: HistoryEditorContext | null): string {
  if (!editorContext) {
    return content;
  }
  return JSON.stringify({
    __hvyHistoryEntry: 1,
    content,
    ...(editorContext ? { editorContext } : {}),
  } satisfies StoredHistoryEntry);
}

function parseStoredHistoryEntry(entry: string): StoredHistoryEntry | null {
  try {
    const parsed = JSON.parse(entry) as Partial<StoredHistoryEntry> | null;
    return parsed?.__hvyHistoryEntry === 1 && typeof parsed.content === 'string'
      ? parsed as StoredHistoryEntry
      : null;
  } catch {
    return null;
  }
}

function updateLastHistoryEditorContext(editorContext: HistoryEditorContext | null): void {
  if (state.history.length === 0) {
    return;
  }
  const index = state.history.length - 1;
  const entry = state.history[index] ?? '';
  const stored = parseStoredHistoryEntry(entry);
  state.history[index] = encodeStoredHistoryEntry(stored?.content ?? entry, editorContext);
}

function encodeHistoryEntry(previous: string | null, snapshot: string): string {
  if (previous === null) {
    return snapshot;
  }
  const entry = createHistoryDeltaEntry(previous, snapshot);
  const encoded = JSON.stringify(entry);
  return encoded.length < snapshot.length ? encoded : snapshot;
}

function createHistoryDeltaEntry(previous: string, snapshot: string): HistoryDeltaEntry {
  let prefixLength = 0;
  const maxPrefixLength = Math.min(previous.length, snapshot.length);
  while (prefixLength < maxPrefixLength && previous[prefixLength] === snapshot[prefixLength]) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  const maxSuffixLength = maxPrefixLength - prefixLength;
  while (
    suffixLength < maxSuffixLength
    && previous[previous.length - 1 - suffixLength] === snapshot[snapshot.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  return {
    __hvyHistoryDelta: 1,
    prefixLength,
    deleteLength: previous.length - prefixLength - suffixLength,
    insert: snapshot.slice(prefixLength, snapshot.length - suffixLength),
  };
}

function applyHistoryEntry(previous: string, entry: string): string {
  const content = parseStoredHistoryEntry(entry)?.content ?? entry;
  const delta = parseHistoryDeltaEntry(content);
  if (!delta) {
    return content;
  }
  return previous.slice(0, delta.prefixLength)
    + delta.insert
    + previous.slice(delta.prefixLength + delta.deleteLength);
}

function parseHistoryDeltaEntry(entry: string): HistoryDeltaEntry | null {
  try {
    const parsed = JSON.parse(entry) as Partial<HistoryDeltaEntry> | null;
    if (
      !parsed
      || parsed.__hvyHistoryDelta !== 1
      || typeof parsed.prefixLength !== 'number'
      || typeof parsed.deleteLength !== 'number'
      || typeof parsed.insert !== 'string'
    ) {
      return null;
    }
    return parsed as HistoryDeltaEntry;
  } catch {
    return null;
  }
}

function captureActiveEditorRestoreState(): ActiveEditorRestoreState | null {
  if (!state.activeEditorBlock) {
    return null;
  }
  return {
    activeEditorBlock: { ...state.activeEditorBlock },
    activeTextEditorMode: state.activeTextEditorMode ? { ...state.activeTextEditorMode } : null,
    activeEditorBlockPath: state.activeEditorBlockPath.map((active) => ({ ...active })),
    activeEditorBlockSnapshot: state.activeEditorBlockSnapshot
      ? JSON.parse(JSON.stringify(state.activeEditorBlockSnapshot)) as AppState['activeEditorBlockSnapshot']
      : null,
    activeEditorBlockSnapshots: state.activeEditorBlockSnapshots.map((snapshot) =>
      JSON.parse(JSON.stringify(snapshot)) as AppState['activeEditorBlockSnapshots'][number]
    ),
    activeEditorNewBlockIds: new Set(state.activeEditorNewBlockIds),
    activeEditorBlockReturnScroll: state.activeEditorBlockReturnScroll ? { ...state.activeEditorBlockReturnScroll } : null,
    aiEditorHostBlock: state.aiEditorHostBlock ? { ...state.aiEditorHostBlock } : null,
    aiEditorHostSectionKey: state.aiEditorHostSectionKey,
    preferredEditorTarget: captureActiveEditorPreferredTarget(state.activeEditorBlock),
  };
}

function restoreActiveEditorState(
  activeEditor: ActiveEditorRestoreState | null,
  targetEditorContext: HistoryEditorContext | null = null
): void {
  state.pendingHistoryFocus = targetEditorContext?.preferredEditorTarget
    && !targetEditorContext.sectionKey && !targetEditorContext.blockId
    ? targetEditorContext.preferredEditorTarget
    : null;
  if (!activeEditor?.activeEditorBlock) {
    return;
  }
  const { sectionKey, blockId } = activeEditor.activeEditorBlock;
  if (!findSnapshotBlockByIds(sectionKey, blockId)) {
    return;
  }
  const existingPath = activeEditor.activeEditorBlockPath.filter((active) =>
    findSnapshotBlockByIds(active.sectionKey, active.blockId)
  );
  state.activeEditorBlockPath = existingPath.length > 0 ? existingPath : [{ sectionKey, blockId }];
  state.activeEditorBlock = { sectionKey, blockId };
  state.activeTextEditorMode = activeEditor.activeTextEditorMode ? { ...activeEditor.activeTextEditorMode } : null;
  const restoredBlock = findSnapshotBlockByIds(sectionKey, blockId);
  if (
    state.activeTextEditorMode?.mode === 'fill-in'
    && restoredBlock
    && (!restoredBlock.schema.fillIn || !hasTextFillInMarker(restoredBlock.text))
  ) {
    state.activeTextEditorMode = { sectionKey, blockId, mode: 'rich' };
  }
  state.activeEditorBlockSnapshots = activeEditor.activeEditorBlockSnapshots.filter((snapshot) =>
    state.activeEditorBlockPath.some((active) => active.sectionKey === snapshot.sectionKey && active.blockId === snapshot.blockId)
  );
  state.activeEditorBlockSnapshot =
    state.activeEditorBlockSnapshots.find((snapshot) => snapshot.sectionKey === sectionKey && snapshot.blockId === blockId)
    ?? null;
  state.activeEditorNewBlockIds = new Set([...activeEditor.activeEditorNewBlockIds].filter((id) =>
    state.activeEditorBlockPath.some((active) => active.blockId === id)
  ));
  state.activeEditorBlockReturnScroll = activeEditor.activeEditorBlockReturnScroll;
  state.aiEditorHostBlock = activeEditor.aiEditorHostBlock;
  state.aiEditorHostSectionKey = activeEditor.aiEditorHostSectionKey;
  state.pendingEditorActivation = {
    sectionKey,
    blockId,
    revealPath: false,
    immediateFocus: true,
    ...(targetEditorContext?.sectionKey === sectionKey
      && targetEditorContext.blockId === blockId
      && targetEditorContext.preferredEditorTarget
      ? { preferredEditorTarget: targetEditorContext.preferredEditorTarget }
      : activeEditor.preferredEditorTarget
        ? { preferredEditorTarget: activeEditor.preferredEditorTarget }
        : {}),
  };
}

function captureActiveEditorPreferredTarget(
  activeEditorBlock: NonNullable<AppState['activeEditorBlock']>,
  target?: HTMLElement | null
): NonNullable<AppState['pendingEditorActivation']>['preferredEditorTarget'] | null {
  const active = target ?? (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null);
  if (
    !active
    || active.dataset.sectionKey !== activeEditorBlock.sectionKey
    || active.dataset.blockId !== activeEditorBlock.blockId
  ) {
    return null;
  }
  const activeBlock = active.closest<HTMLElement>('.editor-block[data-active-editor-block="true"]');
  if (!activeBlock) {
    return null;
  }
  return capturePreferredEditorTarget(active, activeBlock);
}

function capturePreferredEditorTarget(
  active: HTMLElement,
  scope: HTMLElement
): NonNullable<AppState['pendingEditorActivation']>['preferredEditorTarget'] | null {
  const field = active.dataset.field;
  if (!field) {
    return null;
  }
  const matchingFields = Array.from(scope.querySelectorAll<HTMLElement>(`[data-field="${CSS.escape(field)}"]`));
  const preferred: NonNullable<AppState['pendingEditorActivation']>['preferredEditorTarget'] = {
    field,
    fieldIndex: Math.max(0, matchingFields.indexOf(active)),
  };
  const rowIndex = parseOptionalDatasetIndex(active.dataset.rowIndex);
  const cellIndex = parseOptionalDatasetIndex(active.dataset.cellIndex);
  const columnIndex = parseOptionalDatasetIndex(active.dataset.columnIndex);
  if (rowIndex !== null) preferred.rowIndex = rowIndex;
  if (cellIndex !== null) preferred.cellIndex = cellIndex;
  if (columnIndex !== null) preferred.columnIndex = columnIndex;
  if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) {
    try {
      if (active.selectionStart !== null && active.selectionEnd !== null) {
        preferred.controlSelection = {
          start: active.selectionStart,
          end: active.selectionEnd,
          direction: active.selectionDirection ?? 'none',
        };
      }
    } catch {
      // Inputs without text selection support retain focus without a selection.
    }
  } else if (active.isContentEditable) {
    const selection = window.getSelection();
    if (selection && active.contains(selection.anchorNode) && active.contains(selection.focusNode)) {
      const anchorPath = getNodePath(active, selection.anchorNode);
      const focusPath = getNodePath(active, selection.focusNode);
      if (anchorPath && focusPath) {
        preferred.editableSelection = {
          anchorPath,
          anchorOffset: selection.anchorOffset,
          focusPath,
          focusOffset: selection.focusOffset,
        };
      }
    }
  }
  return preferred;
}

function captureHistoryEditorContext(target?: HTMLElement | null): HistoryEditorContext | null {
  if (state.activeEditorBlock) {
    const preferredEditorTarget = captureActiveEditorPreferredTarget(state.activeEditorBlock, target);
    return {
      ...state.activeEditorBlock,
      ...(preferredEditorTarget ? { preferredEditorTarget } : {}),
    };
  }
  const active = target ?? (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null);
  const app = active?.closest<HTMLElement>('.hvy-document');
  const preferredEditorTarget = active && app ? capturePreferredEditorTarget(active, app) : null;
  if (preferredEditorTarget) {
    return { preferredEditorTarget };
  }
  const block = active?.closest<HTMLElement>('.editor-block[data-section-key][data-block-id], .editor-block-passive[data-section-key][data-block-id]');
  if (block?.dataset.sectionKey && block.dataset.blockId) {
    return { sectionKey: block.dataset.sectionKey, blockId: block.dataset.blockId };
  }
  const section = active?.closest<HTMLElement>('[data-editor-section]');
  return section?.dataset.editorSection ? { sectionKey: section.dataset.editorSection } : null;
}

export function rememberHistoryEditorContextBeforeInput(target: EventTarget | null): void {
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const context = captureHistoryEditorContext(target);
  if (context) {
    editorContextBeforeInput.set(target, context);
  }
}

function consumeHistoryEditorContextBeforeInput(): HistoryEditorContext | null {
  const active = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  if (!active) {
    return null;
  }
  const context = editorContextBeforeInput.get(active) ?? null;
  editorContextBeforeInput.delete(active);
  return context;
}

function rememberHistoryEditorContextAfterInput(context: HistoryEditorContext | null): void {
  if (!context) {
    standaloneEditorContextAfterInput.delete(state.document);
    if (state.activeEditorBlock) {
      const block = findSnapshotBlockByIds(state.activeEditorBlock.sectionKey, state.activeEditorBlock.blockId);
      if (block) {
        editorContextAfterInput.delete(block);
      }
    }
    return;
  }
  if (!context.sectionKey || !context.blockId) {
    standaloneEditorContextAfterInput.set(state.document, context);
    return;
  }
  const block = findSnapshotBlockByIds(context.sectionKey, context.blockId);
  if (block) {
    editorContextAfterInput.set(block, context);
  }
}

function getHistoryEditorContextAfterInput(): HistoryEditorContext | null {
  if (!state.activeEditorBlock) {
    return standaloneEditorContextAfterInput.get(state.document) ?? null;
  }
  const block = findSnapshotBlockByIds(state.activeEditorBlock.sectionKey, state.activeEditorBlock.blockId);
  return block ? editorContextAfterInput.get(block) ?? null : null;
}

function parseOptionalDatasetIndex(value: string | undefined): number | null {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function getNodePath(root: Node, node: Node | null): number[] | null {
  if (!node) {
    return null;
  }
  const path: number[] = [];
  let current: Node | null = node;
  while (current && current !== root) {
    const parent: Node | null = current.parentNode;
    if (!parent) {
      return null;
    }
    path.unshift(Array.prototype.indexOf.call(parent.childNodes, current) as number);
    current = parent;
  }
  return current === root ? path : null;
}

function findSnapshotBlockByIds(sectionKey: string, blockId: string): VisualBlock | null {
  const section = findSectionByKey(state.document.sections, sectionKey);
  return section ? findSnapshotBlockInList(section.blocks, blockId) : null;
}

function historySnapshotContainsActiveEditor(
  snapshot: string,
  activeEditor: ActiveEditorRestoreState | null
): boolean {
  if (!activeEditor?.activeEditorBlock) {
    return true;
  }
  try {
    const parsed = JSON.parse(snapshot) as ParsedHistorySnapshot;
    if (parsed.editorMode === 'raw' || parsed.editorMode === 'cli') {
      return false;
    }
    const { sectionKey, blockId } = activeEditor.activeEditorBlock;
    const section = findSectionByKey(parsed.document.sections, sectionKey);
    return Boolean(section && findSnapshotBlockInList(section.blocks, blockId));
  } catch {
    return false;
  }
}

function findSnapshotBlockInList(blocks: VisualBlock[], blockId: string, seen = new Set<VisualBlock>()): VisualBlock | null {
  for (const block of blocks) {
    if (seen.has(block)) {
      continue;
    }
    seen.add(block);
    if (block.id === blockId) {
      return block;
    }
    const child = findSnapshotBlockInList(block.schema.containerBlocks ?? [], blockId, seen)
      ?? findSnapshotBlockInList(block.schema.componentListBlocks ?? [], blockId, seen)
      ?? findSnapshotBlockInList(block.schema.expandableStubBlocks?.children ?? [], blockId, seen)
      ?? findSnapshotBlockInList(block.schema.expandableContentBlocks?.children ?? [], blockId, seen)
      ?? findSnapshotBlockInList((block.schema.gridItems ?? []).map((item) => item.block), blockId, seen);
    if (child) {
      return child;
    }
  }
  return null;
}

function captureModalScroll(): { selector: string; scrollTop: number } | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const panel = document.querySelector<HTMLElement>('.modal-panel');
  if (!panel) {
    return null;
  }
  const selector = panel.classList.contains('theme-modal')
    ? '.modal-panel.theme-modal'
    : '.modal-panel';
  return { selector, scrollTop: panel.scrollTop };
}

function restoreModalScroll(scroll: { selector: string; scrollTop: number } | null): void {
  if (!scroll || typeof document === 'undefined') {
    return;
  }
  const restore = () => {
    const panel = document.querySelector<HTMLElement>(scroll.selector);
    if (panel) {
      panel.scrollTop = scroll.scrollTop;
    }
  };
  restore();
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(restore);
  }
}

function restoreFromSnapshot(snapshot: string): void {
  try {
    const liveAttachmentStore = ensureDocumentAttachmentStore(state.document);
    const parsed = JSON.parse(snapshot) as ParsedHistorySnapshot;
    state.document = parsed.document;
    attachStoreToDocument(state.document, liveAttachmentStore);
    if (Object.prototype.hasOwnProperty.call(parsed, 'databaseAttachment')) {
      restoreDatabaseAttachment(parsed.databaseAttachment ?? null);
      adoptDatabaseHistoryVersion(parsed.databaseHistoryVersion ?? null);
      databaseAttachmentChangedSinceHistory = true;
    }
    state.templateValues = parsed.templateValues ?? {};
    state.filename = parsed.filename ?? 'document.hvy';
    state.editorMode = parsed.editorMode ?? 'basic';
    state.showAdvancedEditor = parsed.showAdvancedEditor ?? state.editorMode === 'advanced';
    state.rawEditorText = parsed.rawEditorText ?? '';
    state.rawEditorError = parsed.rawEditorError ?? null;
    state.rawEditorDiagnostics = parsed.rawEditorDiagnostics ?? [];
    state.paletteOverrideId = parsed.paletteOverrideId ?? null;
    savePaletteOverrideId(state.paletteOverrideId);
    state.componentPlacement = null;
    state.pendingEditorActivation = null;
    state.pendingHistoryFocus = null;
    state.pendingEditorDeactivation = null;
    state.activeEditorBlock = null;
    state.activeTextEditorMode = null;
    state.aiEditorHostBlock = null;
    state.aiEditorHostSectionKey = null;
    state.activeEditorBlockPath = [];
    state.activeEditorBlockSnapshot = null;
    state.activeEditorBlockSnapshots = [];
    state.activeEditorNewBlockIds.clear();
    state.activeEditorBlockReturnScroll = null;
    state.activeEditorSectionTitleKey = null;
    state.clearSectionTitleOnFocusKey = null;
    if (typeof document !== 'undefined') {
      applyTheme();
    }
  } catch {
    // no-op
  }
}

function getHistoryDatabaseVersion(snapshot: string): string | null {
  try {
    return (JSON.parse(snapshot) as ParsedHistorySnapshot).databaseHistoryVersion ?? null;
  } catch {
    return null;
  }
}

function getHistoryAttachmentVersion(snapshot: string): string | null {
  try {
    return (JSON.parse(snapshot) as ParsedHistorySnapshot).attachmentHistoryVersion ?? null;
  } catch {
    return null;
  }
}

function documentToHistorySnapshot(document: VisualDocument): VisualDocument {
  return {
    meta: document.meta,
    extension: document.extension,
    sections: document.sections,
    attachments: [],
  };
}

function serializeHistoryAttachment(attachment: DocumentAttachment | null): SerializedHistoryAttachment | null {
  if (!attachment) {
    return null;
  }
  return {
    id: attachment.id,
    meta: attachment.meta,
    bytes: Array.from(attachment.bytes),
  };
}

function restoreDatabaseAttachment(attachment: SerializedHistoryAttachment | null): void {
  if (!attachment) {
    removeAttachment(state.document, DB_ATTACHMENT_ID);
    recordDatabaseTablesChanged(state.document, [], false);
    return;
  }
  setAttachment(
    state.document,
    DB_ATTACHMENT_ID,
    attachment.meta,
    new Uint8Array(attachment.bytes)
  );
  recordDatabaseTablesChanged(state.document, [], false);
}
