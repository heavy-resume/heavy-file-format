import { state, HISTORY_GROUP_WINDOW_MS, incrementHistorySnapshotCount, incrementRecordHistoryCount, getRenderApp } from './state';
import { debugMeasure } from './utils';
import type { DocumentAttachment, VisualDocument } from './types';
import { saveSessionState } from './state-persistence';
import { applyTheme } from './theme';
import { savePaletteOverrideId } from './palettes/palette-preferences';
import { inferDocumentChangeSource, notifyDocumentMayHaveChanged } from './document-change';
import { DB_ATTACHMENT_ID, getAttachment, removeAttachment, setAttachment } from './attachments';

interface HistorySnapshotOptions {
  includeDatabaseAttachment?: boolean;
}

interface SerializedHistoryAttachment {
  id: string;
  meta: DocumentAttachment['meta'];
  bytes: number[];
}

let databaseAttachmentChangedSinceHistory = false;

export function snapshotState(options: HistorySnapshotOptions = {}): string {
  return JSON.stringify(
    {
      document: documentToHistorySnapshot(state.document),
      ...(options.includeDatabaseAttachment
        ? { databaseAttachment: serializeHistoryAttachment(getAttachment(state.document, DB_ATTACHMENT_ID)) }
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
  const last = state.history[state.history.length - 1];
  if (last !== snap) {
    state.history.push(snap);
    if (state.history.length > 200) {
      state.history.shift();
    }
    state.future = [];
    saveSessionState(state);
  }
}

export function ensureHistoryInitialized(): void {
  if (state.history.length === 0) {
    commitHistorySnapshot();
  }
}

export function recordHistory(group?: string): void {
  if (state.isRestoring) {
    return;
  }
  const changeSource = inferDocumentChangeSource(group);
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
      notifyDocumentMayHaveChanged(group, changeSource);
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
  if (state.history[state.history.length - 1] !== snap) {
    state.history.push(snap);
    if (state.history.length > 200) {
      state.history.shift();
    }
    state.future = [];
    pushed = true;
    saveSessionState(state);
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
  notifyDocumentMayHaveChanged(group, changeSource);
}

export function recordDatabaseAttachmentHistory(): void {
  if (state.isRestoring) {
    return;
  }
  ensureHistoryInitialized();
  const snap = snapshotState({ includeDatabaseAttachment: true });
  if (state.history[state.history.length - 1] !== snap) {
    state.history.push(snap);
    if (state.history.length > 200) {
      state.history.shift();
    }
    state.future = [];
    saveSessionState(state);
  }
  databaseAttachmentChangedSinceHistory = false;
}

export function markDatabaseAttachmentChanged(): void {
  if (!state.isRestoring) {
    databaseAttachmentChangedSinceHistory = true;
  }
}

export function undoState(): void {
  ensureHistoryInitialized();
  const modalScroll = captureModalScroll();
  const current = snapshotState({ includeDatabaseAttachment: databaseAttachmentChangedSinceHistory });
  const last = state.history[state.history.length - 1];
  if (last !== current) {
    state.history.push(current);
  }
  databaseAttachmentChangedSinceHistory = false;
  if (state.history.length <= 1) {
    return;
  }
  state.isRestoring = true;
  const currentSnapshot = state.history.pop();
  if (currentSnapshot) {
    state.future.push(currentSnapshot);
  }
  const prev = state.history[state.history.length - 1];
  if (prev) {
    restoreFromSnapshot(prev);
  }
  state.lastHistoryGroup = null;
  state.lastHistoryAt = 0;
  state.isRestoring = false;
  getRenderApp()();
  restoreModalScroll(modalScroll);
  notifyDocumentMayHaveChanged('undo', inferDocumentChangeSource('undo'));
}

export function redoState(): void {
  ensureHistoryInitialized();
  const modalScroll = captureModalScroll();
  const next = state.future.pop();
  if (!next) {
    return;
  }
  state.isRestoring = true;
  state.history.push(next);
  restoreFromSnapshot(next);
  state.lastHistoryGroup = null;
  state.lastHistoryAt = 0;
  state.isRestoring = false;
  getRenderApp()();
  restoreModalScroll(modalScroll);
  notifyDocumentMayHaveChanged('redo', inferDocumentChangeSource('redo'));
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
    const liveAttachments = state.document.attachments;
    const parsed = JSON.parse(snapshot) as {
      document: VisualDocument;
      databaseAttachment?: SerializedHistoryAttachment | null;
      templateValues: Record<string, string>;
      filename: string;
      editorMode?: 'basic' | 'advanced' | 'raw' | 'cli';
      showAdvancedEditor?: boolean;
      rawEditorText?: string;
      rawEditorError?: string | null;
      rawEditorDiagnostics?: typeof state.rawEditorDiagnostics;
      paletteOverrideId?: string | null;
    };
    state.document = {
      ...parsed.document,
      attachments: liveAttachments,
    };
    if (Object.prototype.hasOwnProperty.call(parsed, 'databaseAttachment')) {
      restoreDatabaseAttachment(parsed.databaseAttachment ?? null);
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
    if (typeof document !== 'undefined') {
      applyTheme();
    }
  } catch {
    // no-op
  }
}

function documentToHistorySnapshot(document: VisualDocument): VisualDocument {
  return {
    ...document,
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
    return;
  }
  setAttachment(
    state.document,
    DB_ATTACHMENT_ID,
    attachment.meta,
    new Uint8Array(attachment.bytes)
  );
}
