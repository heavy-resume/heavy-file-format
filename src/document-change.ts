import { serializeDocumentBytes } from './serialization';
import { getActiveStateRuntime, runWithStateRuntime, state, type StateRuntime } from './state';

export type HvyDocumentChangeSource = 'editor' | 'ai' | 'script' | 'import';

export interface HvyDocumentChangeEvent {
  dirty: boolean;
  reason?: string;
  source?: HvyDocumentChangeSource;
}

export type HvyDocumentChangeCallback = (event: HvyDocumentChangeEvent) => void;

interface DocumentChangeTracker {
  baseline: Uint8Array;
  lastSignature: Uint8Array;
  lastDirty: boolean;
  pending: boolean;
  pendingReason?: string;
  pendingSource?: HvyDocumentChangeSource;
  callback?: HvyDocumentChangeCallback;
}

const trackersByRuntime = new WeakMap<StateRuntime, DocumentChangeTracker>();

export function initDocumentChangeTracking(runtime: StateRuntime, callback?: HvyDocumentChangeCallback): void {
  runWithStateRuntime(runtime, () => {
    const signature = getCurrentDocumentSignature();
    trackersByRuntime.set(runtime, {
      baseline: signature,
      lastSignature: signature,
      lastDirty: false,
      pending: false,
      callback,
    });
  });
}

export function markDocumentSaved(runtime: StateRuntime): void {
  const tracker = trackersByRuntime.get(runtime);
  if (!tracker) {
    return;
  }
  runWithStateRuntime(runtime, () => {
    const signature = getCurrentDocumentSignature();
    tracker.baseline = signature;
    tracker.lastSignature = signature;
    tracker.pending = false;
    const wasDirty = tracker.lastDirty;
    tracker.lastDirty = false;
    if (wasDirty) {
      tracker.callback?.({ dirty: false, reason: 'mark-saved' });
    }
  });
}

export function isDocumentDirty(runtime: StateRuntime): boolean {
  const tracker = trackersByRuntime.get(runtime);
  if (!tracker) {
    return false;
  }
  return runWithStateRuntime(runtime, () => !bytesEqual(getCurrentDocumentSignature(), tracker.baseline));
}

export function notifyDocumentMayHaveChanged(reason?: string, source?: HvyDocumentChangeSource): void {
  let runtime: StateRuntime;
  try {
    runtime = getActiveStateRuntime();
  } catch {
    return;
  }
  const tracker = trackersByRuntime.get(runtime);
  if (!tracker) {
    return;
  }
  tracker.pendingReason = reason ?? tracker.pendingReason;
  tracker.pendingSource = source ?? tracker.pendingSource;
  if (tracker.pending) {
    return;
  }
  tracker.pending = true;
  queueMicrotask(() => {
    runWithStateRuntime(runtime, () => flushDocumentChangeTracker(runtime));
  });
}

export function inferDocumentChangeSource(reason?: string): HvyDocumentChangeSource {
  if (reason?.startsWith('import:')) {
    return 'import';
  }
  if (
    reason?.startsWith('plugin-') ||
    reason?.startsWith('document-hook:') ||
    reason?.startsWith('button:')
  ) {
    return 'script';
  }
  return state.currentView === 'ai' ? 'ai' : 'editor';
}

function flushDocumentChangeTracker(runtime: StateRuntime): void {
  const tracker = trackersByRuntime.get(runtime);
  if (!tracker) {
    return;
  }
  tracker.pending = false;
  const reason = tracker.pendingReason;
  const source = tracker.pendingSource;
  tracker.pendingReason = undefined;
  tracker.pendingSource = undefined;

  const signature = getCurrentDocumentSignature();
  const dirty = !bytesEqual(signature, tracker.baseline);
  const changed = !bytesEqual(signature, tracker.lastSignature);
  if (!changed && dirty === tracker.lastDirty) {
    return;
  }
  tracker.lastSignature = signature;
  tracker.lastDirty = dirty;
  tracker.callback?.({ dirty, reason, source });
}

function getCurrentDocumentSignature(): Uint8Array {
  return serializeDocumentBytes(state.document);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}
