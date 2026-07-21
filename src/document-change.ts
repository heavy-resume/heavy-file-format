import { serializeDocumentBytes } from './serialization';
import { getActiveStateRuntime, runWithStateRuntime, state, type StateRuntime } from './state';
import type { VisualSection } from './editor/types';

export type HvyDocumentChangeSource = 'editor' | 'ai' | 'script' | 'import';

export interface HvyDocumentChangeEvent {
  dirty: boolean;
  reason?: string;
  source?: HvyDocumentChangeSource;
  changedSectionTitles: string[];
}

export type HvyDocumentChangeCallback = (event: HvyDocumentChangeEvent) => void;

export interface HvyDocumentChangeApi {
  markSaved(): void;
  isDirty(): boolean;
}

interface DocumentChangeTracker {
  baseline: Uint8Array;
  baselineSections: Map<string, SectionChangeSnapshot>;
  baselineRevision: number;
  currentRevision: number;
  lastNotifiedRevision: number;
  lastDirty: boolean;
  pending: boolean;
  pendingAuthoritative: boolean;
  pendingReason?: string;
  pendingSource?: HvyDocumentChangeSource;
  callback?: HvyDocumentChangeCallback;
}

interface SectionChangeSnapshot {
  title: string;
  fingerprint: string;
}

const trackersByRuntime = new WeakMap<StateRuntime, DocumentChangeTracker>();

export function createDocumentChangeApi(
  runtime: StateRuntime,
  callback?: HvyDocumentChangeCallback
): HvyDocumentChangeApi {
  initDocumentChangeTracking(runtime, callback);
  return {
    markSaved: () => markDocumentSaved(runtime),
    isDirty: () => isDocumentDirty(runtime),
  };
}

export function initDocumentChangeTracking(runtime: StateRuntime, callback?: HvyDocumentChangeCallback): void {
  runWithStateRuntime(runtime, () => {
    const signature = getCurrentDocumentSignature();
    trackersByRuntime.set(runtime, {
      baseline: signature,
      baselineSections: snapshotSections(state.document.sections),
      baselineRevision: 0,
      currentRevision: 0,
      lastNotifiedRevision: 0,
      lastDirty: false,
      pending: false,
      pendingAuthoritative: false,
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
    tracker.baselineSections = snapshotSections(state.document.sections);
    tracker.baselineRevision = tracker.currentRevision;
    tracker.lastNotifiedRevision = tracker.currentRevision;
    tracker.pendingAuthoritative = false;
    tracker.pending = false;
    const wasDirty = tracker.lastDirty;
    tracker.lastDirty = false;
    if (wasDirty) {
      tracker.callback?.({ dirty: false, reason: 'mark-saved', changedSectionTitles: [] });
    }
  });
}

export function isDocumentDirty(runtime: StateRuntime): boolean {
  const tracker = trackersByRuntime.get(runtime);
  if (!tracker) {
    return false;
  }
  return runWithStateRuntime(runtime, () => {
    const dirty = !bytesEqual(getCurrentDocumentSignature(), tracker.baseline);
    if (!dirty) {
      tracker.baselineRevision = tracker.currentRevision;
      tracker.lastNotifiedRevision = tracker.currentRevision;
    }
    tracker.lastDirty = dirty;
    return dirty;
  });
}

export function notifyDocumentMayHaveChanged(
  reason?: string,
  source?: HvyDocumentChangeSource,
  options: { authoritative?: boolean } = {}
): void {
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
  tracker.currentRevision += 1;
  tracker.pendingReason = reason ?? tracker.pendingReason;
  tracker.pendingSource = source ?? tracker.pendingSource;
  tracker.pendingAuthoritative = tracker.pendingAuthoritative || options.authoritative === true;
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
  const authoritative = tracker.pendingAuthoritative;
  const reason = tracker.pendingReason;
  const source = tracker.pendingSource;
  tracker.pendingAuthoritative = false;
  tracker.pendingReason = undefined;
  tracker.pendingSource = undefined;

  let dirty = tracker.currentRevision !== tracker.baselineRevision;
  let changed = tracker.currentRevision !== tracker.lastNotifiedRevision;
  if (authoritative) {
    const signature = getCurrentDocumentSignature();
    dirty = !bytesEqual(signature, tracker.baseline);
    changed = changed || dirty !== tracker.lastDirty;
    if (!dirty) {
      tracker.baselineRevision = tracker.currentRevision;
    }
  }
  if (!changed && dirty === tracker.lastDirty) {
    return;
  }
  tracker.lastNotifiedRevision = tracker.currentRevision;
  tracker.lastDirty = dirty;
  tracker.callback?.({
    dirty,
    reason,
    source,
    changedSectionTitles: dirty ? getChangedSectionTitles(tracker.baselineSections, state.document.sections) : [],
  });
}

function snapshotSections(sections: VisualSection[]): Map<string, SectionChangeSnapshot> {
  const snapshots = new Map<string, SectionChangeSnapshot>();
  const visit = (nodes: VisualSection[], parentKey: string | null): void => {
    nodes.forEach((section, index) => {
      const { children: _children, ...sectionContent } = section;
      snapshots.set(section.key, {
        title: formatChangedSectionTitle(section.title),
        fingerprint: JSON.stringify({ parentKey, index, ...sectionContent }),
      });
      visit(section.children, section.key);
    });
  };
  visit(sections, null);
  return snapshots;
}

function getChangedSectionTitles(
  baseline: Map<string, SectionChangeSnapshot>,
  sections: VisualSection[]
): string[] {
  const current = snapshotSections(sections);
  const changedTitles: string[] = [];
  current.forEach((section, key) => {
    if (baseline.get(key)?.fingerprint !== section.fingerprint) {
      changedTitles.push(section.title);
    }
  });
  baseline.forEach((section, key) => {
    if (!current.has(key)) {
      changedTitles.push(section.title);
    }
  });
  return [...new Set(changedTitles)];
}

function formatChangedSectionTitle(title: string): string {
  const trimmed = title.trim();
  return trimmed === 'Unnamed Section' ? '' : trimmed;
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
