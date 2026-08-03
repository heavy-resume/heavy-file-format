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
  clearDatabaseChangedFlag(): void;
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

export function invalidateDatabaseHistoryVersion(): void {
  const history = getState();
  if (!history.commandActive) history.currentVersion = null;
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
    await releaseForwardBranches(history, beforeVersion);
    const beforeState = command.mode === 'checkpoint'
      ? await storeDatabaseState(history, command.document, command.reason)
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
      await compactTransitions(history);
      history.currentVersion = afterVersion;
      command.clearDatabaseChangedFlag();
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
      command.clearDatabaseChangedFlag();
      throw rollbackError ?? error;
    } finally {
      history.commandActive = false;
    }
  });
}

async function releaseForwardBranches(history: DatabaseHistoryRuntimeState, version: string): Promise<void> {
  const branches = history.transitions.filter((transition) => transition.beforeVersion === version);
  for (const branch of branches) {
    history.transitions.splice(history.transitions.indexOf(branch), 1);
    await releaseForwardBranches(history, branch.afterVersion);
    await branch.release().catch(() => {});
  }
}

async function compactTransitions(history: DatabaseHistoryRuntimeState): Promise<void> {
  while (history.transitions.length > 200) {
    const expired = history.transitions.shift();
    if (expired) await expired.release().catch(() => {});
  }
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

function createCheckpointTransition(
  history: DatabaseHistoryRuntimeState,
  document: VisualDocument,
  beforeVersion: string,
  afterVersion: string,
  before: StoredDatabaseState
): DatabaseHistoryTransition {
  let after: StoredDatabaseState | null = null;
  return {
    beforeVersion,
    afterVersion,
    undo: async () => {
      after ??= await storeDatabaseState(history, document, 'Redo database checkpoint');
      await restoreStoredDatabaseState(history, document, before);
    },
    redo: async () => {
      if (!after) throw new Error('The redo database checkpoint is unavailable.');
      await restoreStoredDatabaseState(history, document, after);
    },
    release: async () => {
      await history.store.remove(before.artifact.id);
      if (after) await history.store.remove(after.artifact.id);
    },
  };
}

async function storeDatabaseState(
  history: DatabaseHistoryRuntimeState,
  document: VisualDocument,
  reason: string
): Promise<StoredDatabaseState> {
  const attachment = getAttachment(document, DB_ATTACHMENT_ID);
  return {
    exists: attachment !== null,
    meta: attachment?.meta ?? {},
    artifact: await storeHvyHistoryArtifact(history.store, {
      kind: 'sqlite-checkpoint',
      bytes: attachment?.bytes ?? new Uint8Array(),
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
      currentVersion: null,
      transitions: [],
      tail: Promise.resolve(),
      pending: 0,
      runningLabel: '',
      error: '',
      commandActive: false,
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
