import { serializeDocument } from './serialization';
import { ensureDocumentAttachmentStore } from './attachment-store';
import { getActiveStateRuntime, runWithStateRuntime, state, type StateRuntime } from './state';
import type { VisualSection } from './editor/types';
import { hasReusableDefinitionChanges } from './reusable-definition-changes';

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

interface DocumentSignature {
  text: string;
  attachments: Uint8Array[];
}

interface DocumentChangeTracker {
  holds: number;
  flushHeld: boolean;
  baseline: DocumentSignature;
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
      holds: 0,
      flushHeld: false,
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
    const dirty = hasActiveReusableDefinitionChanges() || !signaturesEqual(getCurrentDocumentSignature(), tracker.baseline);
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

/**
 * Holds change notifications while document hooks run, since their scripts usually edit the document again:
 * listeners get one notification for the settled result, not a whole-document comparison per edit.
 * The release can pass the document's text when the caller has just serialized it. A later edit sends
 * its own notification, so the comparison stays correct.
 */
export function holdDocumentChangeFlush(runtime: StateRuntime): (settledText?: string) => void {
  const tracker = trackersByRuntime.get(runtime);
  if (!tracker) {
    return () => {};
  }
  tracker.holds += 1;
  return (settledText) => {
    tracker.holds -= 1;
    if (tracker.holds === 0 && tracker.flushHeld) {
      tracker.flushHeld = false;
      runWithStateRuntime(runtime, () => flushDocumentChangeTracker(runtime, settledText));
    }
  };
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

function flushDocumentChangeTracker(runtime: StateRuntime, serializedDocument?: string): void {
  const tracker = trackersByRuntime.get(runtime);
  if (!tracker) {
    return;
  }
  if (tracker.holds > 0) {
    tracker.flushHeld = true;
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
    const signature = getCurrentDocumentSignature(serializedDocument);
    dirty = hasActiveReusableDefinitionChanges() || !signaturesEqual(signature, tracker.baseline);
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
  const { baselineSections } = tracker;
  const { sections } = state.document;
  let changedSectionTitles: string[] | null = dirty ? null : [];
  tracker.callback?.({
    dirty,
    reason,
    source,
    // Comparing every section is costly and most listeners never read this.
    get changedSectionTitles() {
      changedSectionTitles ??= getChangedSectionTitles(baselineSections, sections);
      return changedSectionTitles;
    },
  });
}

function hasActiveReusableDefinitionChanges(): boolean {
  return state.reusableDefinitionEditModal
    ? hasReusableDefinitionChanges(state.document, state.reusableDefinitionEditModal)
    : false;
}

function snapshotSections(sections: VisualSection[]): Map<string, SectionChangeSnapshot> {
  const snapshots = new Map<string, SectionChangeSnapshot>();
  const visit = (nodes: VisualSection[], parentKey: string | null): void => {
    nodes.forEach((section, index) => {
      const sectionContent = section;
      snapshots.set(section.key, {
        title: formatChangedSectionTitle(section.title),
        fingerprint: JSON.stringify({ parentKey, index, ...sectionContent }, omitNoSaveContainerBlocks),
      });
    });
  };
  visit(sections, null);
  return snapshots;
}

// noSave container children are runtime content and never count as a section change.
function omitNoSaveContainerBlocks(this: unknown, key: string, value: unknown): unknown {
  return key === 'containerBlocks' && (this as { noSave?: unknown } | undefined)?.noSave === true ? [] : value;
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

function getCurrentDocumentSignature(serializedDocument = serializeDocument(state.document)): DocumentSignature {
  return {
    text: serializedDocument,
    attachments: ensureDocumentAttachmentStore(state.document).list().map((entry) => entry.bytes),
  };
}

function signaturesEqual(left: DocumentSignature, right: DocumentSignature): boolean {
  return left.text === right.text
    && left.attachments.length === right.attachments.length
    && left.attachments.every((bytes, index) => bytesEqual(bytes, right.attachments[index]!));
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left === right) {
    return true;
  }
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
