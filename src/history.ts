import { state, HISTORY_GROUP_WINDOW_MS, incrementHistorySnapshotCount, incrementRecordHistoryCount, getRenderApp } from './state';
import { debugMeasure } from './utils';
import type { VisualDocument } from './types';

export function snapshotState(): string {
  return JSON.stringify(
    {
      document: state.document,
      templateValues: state.templateValues,
      filename: state.filename,
      editorMode: state.editorMode,
      showAdvancedEditor: state.showAdvancedEditor,
      rawEditorText: state.rawEditorText,
      rawEditorError: state.rawEditorError,
      rawEditorDiagnostics: state.rawEditorDiagnostics,
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
  const snap = debugMeasure('snapshotState:commit', { snapshotId, historyLength: state.history.length }, snapshotState);
  const last = state.history[state.history.length - 1];
  if (last !== snap) {
    state.history.push(snap);
    if (state.history.length > 200) {
      state.history.shift();
    }
    state.future = [];
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
}

export function undoState(): void {
  ensureHistoryInitialized();
  const current = snapshotState();
  const last = state.history[state.history.length - 1];
  if (last !== current) {
    state.history.push(current);
  }
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
}

export function redoState(): void {
  ensureHistoryInitialized();
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
}

function restoreFromSnapshot(snapshot: string): void {
  try {
    const parsed = JSON.parse(snapshot) as {
      document: VisualDocument;
      templateValues: Record<string, string>;
      filename: string;
      editorMode?: 'basic' | 'advanced' | 'raw';
      showAdvancedEditor?: boolean;
      rawEditorText?: string;
      rawEditorError?: string | null;
      rawEditorDiagnostics?: typeof state.rawEditorDiagnostics;
    };
    state.document = parsed.document;
    state.templateValues = parsed.templateValues ?? {};
    state.filename = parsed.filename ?? 'document.hvy';
    state.editorMode = parsed.editorMode ?? 'basic';
    state.showAdvancedEditor = parsed.showAdvancedEditor ?? state.editorMode === 'advanced';
    state.rawEditorText = parsed.rawEditorText ?? '';
    state.rawEditorError = parsed.rawEditorError ?? null;
    state.rawEditorDiagnostics = parsed.rawEditorDiagnostics ?? [];
    state.componentPlacement = null;
  } catch {
    // no-op
  }
}
