import { syncSortValuesForDocument } from '../../sort-values';
import type { VisualDocument } from '../../types';
import { getScriptingComponentHandles, matchesScriptingComponentQuery, type ScriptingComponentHandle } from './runtime';

interface ComponentFingerprint {
  component: string;
  fingerprint: string;
}

export type ScriptingComponentFingerprints = Map<string, ComponentFingerprint>;

/**
 * What get_updated_components compares against. The fingerprints answer it without deserializing the
 * previous document, which is only loaded for handles to removed components or when no fingerprints exist.
 */
export interface PreviousScriptingComponents {
  fingerprints: ScriptingComponentFingerprints | null;
  loadDocument: () => VisualDocument;
}

const sortValuesSyncedDocuments = new WeakSet<VisualDocument>();

export function markScriptingSortValuesSynced(document: VisualDocument): void {
  sortValuesSyncedDocuments.add(document);
}

/**
 * Null until the document has been through a sort value sync. The full comparison normalizes the previous
 * document, so fingerprints taken earlier would report that maintenance pass as updates to every list item.
 */
export function captureScriptingComponentFingerprints(document: VisualDocument): ScriptingComponentFingerprints | null {
  if (!sortValuesSyncedDocuments.has(document)) {
    return null;
  }
  const fingerprints: ScriptingComponentFingerprints = new Map();
  for (const handle of getScriptingComponentHandles(document, '', () => {})) {
    if (handle.id) {
      fingerprints.set(handle.id, { component: handle.get('component') as string, fingerprint: handle.fingerprint() });
    }
  }
  return fingerprints;
}

export function getUpdatedScriptingComponentHandles(
  document: VisualDocument,
  previous: PreviousScriptingComponents | null,
  component: string,
  markMutated: () => void,
  requestExpansion: (sectionKey: string, blockId: string) => void
): ScriptingComponentHandle[] {
  const current = getScriptingComponentHandles(document, component, markMutated, false, requestExpansion);
  if (!previous) {
    return current;
  }
  return previous.fingerprints
    ? compareWithFingerprints(document, previous.fingerprints, previous.loadDocument, current, component)
    : compareWithDocument(previous.loadDocument(), current, component);
}

function compareWithFingerprints(
  document: VisualDocument,
  fingerprints: ScriptingComponentFingerprints,
  loadDocument: () => VisualDocument,
  current: ScriptingComponentHandle[],
  component: string
): ScriptingComponentHandle[] {
  const updated = current.filter((handle) => !handle.id || fingerprints.get(handle.id)?.fingerprint !== handle.fingerprint());
  const currentIds = new Set(current.map((handle) => handle.id).filter(Boolean));
  const anyRemoved = [...fingerprints].some(([id, entry]) => (
    !currentIds.has(id) && matchesScriptingComponentQuery(entry.component, component, document.meta)
  ));
  return anyRemoved ? [...updated, ...getRemovedHandles(loadDocument(), currentIds, component)] : updated;
}

function compareWithDocument(previousDocument: VisualDocument, current: ScriptingComponentHandle[], component: string): ScriptingComponentHandle[] {
  // Derived sort values are synchronized across the document during edits. Normalize
  // the prior snapshot too so that this maintenance pass is not reported as a user
  // update to every component in a list.
  syncSortValuesForDocument(previousDocument);
  const previous = getScriptingComponentHandles(previousDocument, component, () => {}, true);
  const previousById = new Map(previous.map((handle) => [handle.id, handle]));
  const currentIds = new Set(current.map((handle) => handle.id).filter(Boolean));
  const updated = current.filter((handle) => {
    if (!handle.id) {
      return true;
    }
    const previousHandle = previousById.get(handle.id);
    return !previousHandle || previousHandle.fingerprint() !== handle.fingerprint();
  });
  return [...updated, ...getRemovedHandles(previousDocument, currentIds, component)];
}

function getRemovedHandles(previousDocument: VisualDocument, currentIds: ReadonlySet<string>, component: string): ScriptingComponentHandle[] {
  return getScriptingComponentHandles(previousDocument, component, () => {}, true)
    .filter((handle) => handle.id && !currentIds.has(handle.id));
}
