import { DB_ATTACHMENT_ID, getAttachment, removeAttachment, setAttachment } from './attachments';
import {
  InMemoryHvyHistoryArtifactStore,
  recallHvyHistoryArtifact,
  storeHvyHistoryArtifact,
  type HvyHistoryArtifactReference,
  type HvyHistoryArtifactStore,
} from './history-artifact-store';
import { getActiveStateRuntime, runWithStateRuntimeAsync, type StateRuntime } from './state';
import type { JsonObject } from './hvy/types';
import type { VisualDocument } from './types';
import { recordDatabaseTablesChanged } from './database-change-tracker';

export interface DatabaseHistoryQueueStatus {
  pending: number;
  runningLabel: string;
  error: string;
}

export interface DatabaseHistoryLogicalTransition {
  undo(): void | Promise<void>;
  redo(): void | Promise<void>;
}

export interface QueuedDatabaseHistoryCommand<T> {
  label: string;
  reason: string;
  document: VisualDocument;
  mode: 'logical' | 'checkpoint';
  recordBefore(): void;
  captureHistoryState(): unknown;
  rollbackHistory(historyState: unknown): void;
  execute(): T | Promise<T>;
  createLogicalTransition?(result: T): DatabaseHistoryLogicalTransition;
}

interface StoredDatabaseState {
  exists: boolean;
  meta: JsonObject;
  artifact: HvyHistoryArtifactReference;
}

interface DatabaseHistoryTransition {
  beforeVersion: string;
  afterVersion: string;
  undo(): Promise<void>;
  redo(): Promise<void>;
  release(): Promise<void>;
}

interface DatabaseHistoryRuntimeState {
  store: HvyHistoryArtifactStore;
  namespace: string;
  currentVersion: string | null;
  transitions: DatabaseHistoryTransition[];
  tail: Promise<void>;
  pending: number;
  runningLabel: string;
  error: string;
  commandActive: boolean;
  /** True from a script undo step's first database write until that step closes. */
  spanOpen: boolean;
  listeners: Set<(status: DatabaseHistoryQueueStatus) => void>;
}

const states = new WeakMap<StateRuntime, DatabaseHistoryRuntimeState>();

export function configureDatabaseHistoryStore(runtime: StateRuntime, store?: HvyHistoryArtifactStore | null): void {
  const history = getState(runtime);
  history.store = store ?? new InMemoryHvyHistoryArtifactStore();
}

export function getDatabaseHistoryVersion(): string | null {
  return getState().currentVersion;
}

export function hasDatabaseHistoryVersionTransition(targetVersion: string | null): boolean {
  const history = getState();
  return history.currentVersion !== targetVersion && findTransition(history, history.currentVersion, targetVersion) !== null;
}

export function isQueuedDatabaseHistoryCommandActive(): boolean {
  return getState().commandActive;
}

// A database change that no command or span tracks has no transition, so it gets a version
// of its own: history entries from before it can no longer restore the database.
export function invalidateDatabaseHistoryVersion(): void {
  const history = getState();
  if (!history.commandActive && !history.spanOpen) history.currentVersion = `database-untracked:${crypto.randomUUID()}`;
}

/**
 * Starts tracking the database writes of one script undo step. Call it before the step's
 * first write: the database as it is now becomes the step's undo checkpoint, and every
 * write until closeDatabaseHistorySpan belongs to one transition. Later calls while the
 * span is open do nothing.
 */
export function openDatabaseHistorySpan(document: VisualDocument): void {
  const history = getState();
  if (history.spanOpen || history.commandActive) return;
  const beforeVersion = history.currentVersion ?? `database-base:${crypto.randomUUID()}`;
  const afterVersion = `database-state:${crypto.randomUUID()}`;
  // Read synchronously: the write this span guards replaces the attachment bytes next.
  const before = storeCapturedDatabaseState(history, captureDatabaseState(document), 'Script database checkpoint');
  const released = detachForwardBranches(history, beforeVersion);
  history.transitions.push(createCheckpointTransition(history, document, beforeVersion, afterVersion, before));
  released.push(...detachExpiredTransitions(history));
  released.forEach((transition) => void transition.release().catch(() => {}));
  history.currentVersion = afterVersion;
  history.spanOpen = true;
}

export function closeDatabaseHistorySpan(): void {
  getState().spanOpen = false;
}

export function adoptDatabaseHistoryVersion(version: string | null): void {
  getState().currentVersion = version;
}

export function getDatabaseHistoryQueueStatus(): DatabaseHistoryQueueStatus {
  return statusFromState(getState());
}

export function subscribeDatabaseHistoryQueue(
  listener: (status: DatabaseHistoryQueueStatus) => void
): () => void {
  const history = getState();
  history.listeners.add(listener);
  listener(statusFromState(history));
  return () => history.listeners.delete(listener);
}

export function enqueueDatabaseHistoryNavigation<T>(label: string, action: () => T | Promise<T>): Promise<T> {
  return enqueueWork(getActiveStateRuntime(), label, action);
}

export function runQueuedDatabaseHistoryCommand<T>(command: QueuedDatabaseHistoryCommand<T>): Promise<T> {
  const runtime = getActiveStateRuntime();
  return enqueueWork(runtime, command.label, async () => {
    const history = getState(runtime);
    history.currentVersion ??= `database-base:${crypto.randomUUID()}`;
    const beforeVersion = history.currentVersion;
    if (command.mode === 'logical' && !command.createLogicalTransition) {
      throw new Error('Logical database history commands must provide undo and redo operations.');
    }
    const beforeHistoryState = command.captureHistoryState();
    await Promise.all(detachForwardBranches(history, beforeVersion).map((branch) => branch.release().catch(() => {})));
    const beforeState = command.mode === 'checkpoint'
      ? await storeCapturedDatabaseState(history, captureDatabaseState(command.document), command.reason)
      : null;
    command.recordBefore();
    history.commandActive = true;
    try {
      const result = await command.execute();
      const afterVersion = `database-state:${crypto.randomUUID()}`;
      const transition = command.mode === 'checkpoint'
        ? createCheckpointTransition(history, command.document, beforeVersion, afterVersion, beforeState!)
        : createLogicalHistoryTransition(beforeVersion, afterVersion, command.createLogicalTransition?.(result));
      history.transitions.push(transition);
      await Promise.all(detachExpiredTransitions(history).map((expired) => expired.release().catch(() => {})));
      history.currentVersion = afterVersion;
      return result;
    } catch (error) {
      let rollbackError: unknown = null;
      if (beforeState) {
        try {
          await restoreStoredDatabaseState(history, command.document, beforeState);
        } catch (caught) {
          rollbackError = caught;
        }
        await history.store.remove(beforeState.artifact.id).catch(() => {});
      }
      command.rollbackHistory(beforeHistoryState);
      throw rollbackError ?? error;
    } finally {
      history.commandActive = false;
    }
  });
}

// Removes the redo branches leaving a version, returning them for their stored states to be released.
function detachForwardBranches(history: DatabaseHistoryRuntimeState, version: string): DatabaseHistoryTransition[] {
  const branches = history.transitions.filter((transition) => transition.beforeVersion === version);
  return branches.flatMap((branch) => {
    history.transitions.splice(history.transitions.indexOf(branch), 1);
    return [...detachForwardBranches(history, branch.afterVersion), branch];
  });
}

function detachExpiredTransitions(history: DatabaseHistoryRuntimeState): DatabaseHistoryTransition[] {
  return history.transitions.length > 200 ? history.transitions.splice(0, history.transitions.length - 200) : [];
}

export async function restoreDatabaseHistoryVersion(targetVersion: string | null): Promise<void> {
  const history = getState();
  if (history.currentVersion === targetVersion) return;
  const transition = findTransition(history, history.currentVersion, targetVersion);
  if (!transition) {
    throw new Error('The database history transition needed for this Undo or Redo is unavailable.');
  }
  history.commandActive = true;
  try {
    if (transition.beforeVersion === targetVersion) await transition.undo();
    else await transition.redo();
    history.currentVersion = targetVersion;
    recordDatabaseTablesChanged(getActiveStateRuntime().state.document, [], false);
  } finally {
    history.commandActive = false;
  }
}

export async function destroyDatabaseHistory(runtime: StateRuntime): Promise<void> {
  const history = states.get(runtime);
  if (!history) return;
  await history.tail.catch(() => {});
  await Promise.all(history.transitions.map((transition) => transition.release().catch(() => {})));
  history.listeners.clear();
  states.delete(runtime);
}

function createLogicalHistoryTransition(
  beforeVersion: string,
  afterVersion: string,
  transition: DatabaseHistoryLogicalTransition | undefined
): DatabaseHistoryTransition {
  if (!transition) throw new Error('Logical database history commands must provide undo and redo operations.');
  return {
    beforeVersion,
    afterVersion,
    undo: async () => { await transition.undo(); },
    redo: async () => { await transition.redo(); },
    release: async () => {},
  };
}

// The redo state is stored on the first undo, from the database as the transition left it.
function createCheckpointTransition(
  history: DatabaseHistoryRuntimeState,
  document: VisualDocument,
  beforeVersion: string,
  afterVersion: string,
  before: StoredDatabaseState | Promise<StoredDatabaseState>
): DatabaseHistoryTransition {
  const beforeStored = Promise.resolve(before);
  // A failed store surfaces when Undo needs it, not as an unhandled rejection.
  beforeStored.catch(() => {});
  let after: Promise<StoredDatabaseState> | null = null;
  return {
    beforeVersion,
    afterVersion,
    undo: async () => {
      after ??= storeCapturedDatabaseState(history, captureDatabaseState(document), 'Redo database checkpoint');
      await after;
      await restoreStoredDatabaseState(history, document, await beforeStored);
    },
    redo: async () => {
      if (!after) throw new Error('The redo database checkpoint is unavailable.');
      await restoreStoredDatabaseState(history, document, await after);
    },
    release: async () => {
      await history.store.remove((await beforeStored).artifact.id);
      if (after) await history.store.remove((await after).artifact.id);
    },
  };
}

interface CapturedDatabaseState {
  exists: boolean;
  meta: JsonObject;
  bytes: Uint8Array;
}

// Attachment bytes are replaced, never changed in place, so a captured state stays valid.
function captureDatabaseState(document: VisualDocument): CapturedDatabaseState {
  const attachment = getAttachment(document, DB_ATTACHMENT_ID);
  return { exists: attachment !== null, meta: attachment?.meta ?? {}, bytes: attachment?.bytes ?? new Uint8Array() };
}

async function storeCapturedDatabaseState(
  history: DatabaseHistoryRuntimeState,
  captured: CapturedDatabaseState,
  reason: string
): Promise<StoredDatabaseState> {
  return {
    exists: captured.exists,
    meta: captured.meta,
    artifact: await storeHvyHistoryArtifact(history.store, {
      kind: 'sqlite-checkpoint',
      bytes: captured.bytes,
      reason,
      namespace: history.namespace,
    }),
  };
}

async function restoreStoredDatabaseState(
  history: DatabaseHistoryRuntimeState,
  document: VisualDocument,
  stored: StoredDatabaseState
): Promise<void> {
  const bytes = await recallHvyHistoryArtifact(history.store, stored.artifact);
  if (stored.exists) setAttachment(document, DB_ATTACHMENT_ID, stored.meta, bytes);
  else removeAttachment(document, DB_ATTACHMENT_ID);
}

function findTransition(
  history: DatabaseHistoryRuntimeState,
  currentVersion: string | null,
  targetVersion: string | null
): DatabaseHistoryTransition | null {
  return history.transitions.find((transition) => (
    transition.afterVersion === currentVersion && transition.beforeVersion === targetVersion
  ) || (
    transition.beforeVersion === currentVersion && transition.afterVersion === targetVersion
  )) ?? null;
}

function enqueueWork<T>(runtime: StateRuntime, label: string, action: () => T | Promise<T>): Promise<T> {
  const history = getState(runtime);
  history.pending += 1;
  notify(history);
  const result = history.tail.catch(() => {}).then(() => runWithStateRuntimeAsync(runtime, async () => {
    history.runningLabel = label;
    history.error = '';
    notify(history);
    try {
      return await action();
    } catch (error) {
      history.error = error instanceof Error ? error.message : 'Database history operation failed.';
      throw error;
    } finally {
      history.pending -= 1;
      history.runningLabel = '';
      notify(history);
    }
  }));
  history.tail = result.then(() => {}, () => {});
  return result;
}

function getState(runtime = getActiveStateRuntime()): DatabaseHistoryRuntimeState {
  let history = states.get(runtime);
  if (!history) {
    history = {
      store: new InMemoryHvyHistoryArtifactStore(),
      namespace: `hvy-history:${crypto.randomUUID()}`,
      // Every history entry records a version, so the entries before any database write
      // name the state a later transition restores.
      currentVersion: `database-base:${crypto.randomUUID()}`,
      transitions: [],
      tail: Promise.resolve(),
      pending: 0,
      runningLabel: '',
      error: '',
      commandActive: false,
      spanOpen: false,
      listeners: new Set(),
    };
    states.set(runtime, history);
  }
  return history;
}

function statusFromState(history: DatabaseHistoryRuntimeState): DatabaseHistoryQueueStatus {
  return { pending: history.pending, runningLabel: history.runningLabel, error: history.error };
}

function notify(history: DatabaseHistoryRuntimeState): void {
  const status = statusFromState(history);
  history.listeners.forEach((listener) => listener(status));
}
