import type { HvyAttachmentHostAdapter } from './attachment-store';
import { ensureDocumentAttachmentStore, normalizeAttachmentBytes } from './attachment-store';
import { enqueueDatabaseHistoryNavigation } from './database-history-controller';
import {
  InMemoryHvyHistoryArtifactStore,
  recallHvyHistoryArtifact,
  storeHvyHistoryArtifact,
  type HvyHistoryArtifactReference,
  type HvyHistoryArtifactStore,
} from './history-artifact-store';
import { getActiveStateRuntime, type StateRuntime } from './state';
import type { JsonObject } from './hvy/types';
import type { VisualDocument } from './types';
import { inferDocumentChangeSource, notifyDocumentMayHaveChanged } from './document-change';

export interface UserFileAttachmentHistoryCommand<T> {
  label: string;
  reason: string;
  document: VisualDocument;
  host?: HvyAttachmentHostAdapter | null;
  affectedIds: string[];
  recordBefore(): void;
  captureHistoryState(): unknown;
  rollbackHistory(historyState: unknown): void;
  execute(): T | Promise<T>;
}

interface StoredAttachmentState {
  id: string;
  exists: boolean;
  meta: JsonObject;
  artifact: HvyHistoryArtifactReference | null;
}

interface AttachmentHistoryTransition {
  beforeVersion: string;
  afterVersion: string;
  undo(): Promise<void>;
  redo(): Promise<void>;
  release(): Promise<void>;
}

interface AttachmentHistoryRuntimeState {
  store: HvyHistoryArtifactStore;
  namespace: string;
  currentVersion: string | null;
  transitions: AttachmentHistoryTransition[];
}

const states = new WeakMap<StateRuntime, AttachmentHistoryRuntimeState>();

export function configureAttachmentHistoryStore(runtime: StateRuntime, store?: HvyHistoryArtifactStore | null): void {
  getState(runtime).store = store ?? new InMemoryHvyHistoryArtifactStore();
}

export function getAttachmentHistoryVersion(): string | null {
  return getState().currentVersion;
}

export function hasAttachmentHistoryVersionTransition(targetVersion: string | null): boolean {
  const history = getState();
  return history.currentVersion !== targetVersion
    && findTransition(history, history.currentVersion, targetVersion) !== null;
}

export async function runUserFileAttachmentHistoryCommand<T>(
  command: UserFileAttachmentHistoryCommand<T>,
): Promise<T> {
  const runtime = getActiveStateRuntime();
  return enqueueDatabaseHistoryNavigation(command.label, async () => {
    const history = getState(runtime);
    history.currentVersion ??= `attachment-base:${crypto.randomUUID()}`;
    const beforeVersion = history.currentVersion;
    const affectedIds = [...new Set(command.affectedIds)];
    const capturedHistory = command.captureHistoryState();
    await releaseForwardBranches(history, beforeVersion);
    const before = await storeAttachmentStates(history, command.document, affectedIds, command.host, command.reason);
    command.recordBefore();
    try {
      const result = await command.execute();
      const afterVersion = `attachment-state:${crypto.randomUUID()}`;
      history.transitions.push(createTransition(
        history,
        command.host,
        affectedIds,
        beforeVersion,
        afterVersion,
        before,
        command.reason,
      ));
      await compactTransitions(history);
      history.currentVersion = afterVersion;
      notifyDocumentMayHaveChanged(command.reason, inferDocumentChangeSource(command.reason));
      return result;
    } catch (error) {
      let rollbackError: unknown = null;
      try {
        await restoreAttachmentStates(command.document, command.host, affectedIds, history, before);
      } catch (caught) {
        rollbackError = caught;
      }
      await releaseStoredStates(history, before);
      command.rollbackHistory(capturedHistory);
      notifyDocumentMayHaveChanged(
        `${command.reason}:rollback`,
        inferDocumentChangeSource(command.reason),
        { authoritative: true },
      );
      throw rollbackError ?? error;
    }
  });
}

export async function restoreAttachmentHistoryVersion(targetVersion: string | null): Promise<void> {
  const history = getState();
  if (history.currentVersion === targetVersion) return;
  const transition = findTransition(history, history.currentVersion, targetVersion);
  if (!transition) {
    throw new Error('The attachment history transition needed for this Undo or Redo is unavailable.');
  }
  if (transition.beforeVersion === targetVersion) await transition.undo();
  else await transition.redo();
  history.currentVersion = targetVersion;
}

export async function destroyAttachmentHistory(runtime: StateRuntime): Promise<void> {
  const history = states.get(runtime);
  if (!history) return;
  await Promise.all(history.transitions.map((transition) => transition.release().catch(() => {})));
  states.delete(runtime);
}

function createTransition(
  history: AttachmentHistoryRuntimeState,
  host: HvyAttachmentHostAdapter | null | undefined,
  affectedIds: string[],
  beforeVersion: string,
  afterVersion: string,
  before: StoredAttachmentState[],
  reason: string,
): AttachmentHistoryTransition {
  let after: StoredAttachmentState[] | null = null;
  return {
    beforeVersion,
    afterVersion,
    undo: async () => {
      const document = getActiveStateRuntime().state.document;
      after ??= await storeAttachmentStates(history, document, affectedIds, host, `Redo ${reason}`);
      await restoreAttachmentStates(document, host, affectedIds, history, before);
    },
    redo: async () => {
      if (!after) throw new Error('The redo attachment checkpoint is unavailable.');
      await restoreAttachmentStates(getActiveStateRuntime().state.document, host, affectedIds, history, after);
    },
    release: async () => {
      await releaseStoredStates(history, before);
      if (after) await releaseStoredStates(history, after);
    },
  };
}

async function storeAttachmentStates(
  history: AttachmentHistoryRuntimeState,
  document: VisualDocument,
  ids: string[],
  host: HvyAttachmentHostAdapter | null | undefined,
  reason: string,
): Promise<StoredAttachmentState[]> {
  const store = ensureDocumentAttachmentStore(document);
  const stored: StoredAttachmentState[] = [];
  try {
    for (const id of ids) {
      const descriptor = store.getDescriptor(id);
      if (!descriptor) {
        stored.push({ id, exists: false, meta: {}, artifact: null });
        continue;
      }
      const recalled = store.isMaterialized(id)
        ? store.get(id)?.bytes ?? new Uint8Array()
        : host
          ? await host.recall(id)
          : store.get(id)?.bytes ?? new Uint8Array();
      if (recalled === null) {
        throw new Error(`Document attachment "${id}" could not be recalled for history.`);
      }
      const bytes = await normalizeAttachmentBytes(recalled);
      stored.push({
        id,
        exists: true,
        meta: { ...descriptor.meta },
        artifact: await storeHvyHistoryArtifact(history.store, {
          kind: 'attachment-checkpoint',
          bytes,
          reason,
          namespace: history.namespace,
        }),
      });
    }
    return stored;
  } catch (error) {
    await releaseStoredStates(history, stored);
    throw error;
  }
}

async function restoreAttachmentStates(
  document: VisualDocument,
  host: HvyAttachmentHostAdapter | null | undefined,
  affectedIds: string[],
  history: AttachmentHistoryRuntimeState,
  statesToRestore: StoredAttachmentState[],
): Promise<void> {
  const documentStore = ensureDocumentAttachmentStore(document);
  for (const id of affectedIds) {
    await host?.remove(id);
    documentStore.remove(id);
  }
  for (const stored of statesToRestore) {
    if (!stored.exists || !stored.artifact) continue;
    const bytes = await recallHvyHistoryArtifact(history.store, stored.artifact);
    const hosted = await host?.store(stored.id, bytes, stored.meta);
    const meta = hosted && typeof hosted === 'object' ? { ...hosted.meta, ...stored.meta } : stored.meta;
    documentStore.set(stored.id, meta, bytes);
  }
}

async function releaseStoredStates(
  history: AttachmentHistoryRuntimeState,
  stored: StoredAttachmentState[],
): Promise<void> {
  await Promise.all(stored.flatMap((entry) => entry.artifact
    ? [history.store.remove(entry.artifact.id).catch(() => {})]
    : []));
}

async function releaseForwardBranches(history: AttachmentHistoryRuntimeState, version: string): Promise<void> {
  const branches = history.transitions.filter((transition) => transition.beforeVersion === version);
  for (const branch of branches) {
    history.transitions.splice(history.transitions.indexOf(branch), 1);
    await releaseForwardBranches(history, branch.afterVersion);
    await branch.release().catch(() => {});
  }
}

async function compactTransitions(history: AttachmentHistoryRuntimeState): Promise<void> {
  while (history.transitions.length > 200) {
    const expired = history.transitions.shift();
    if (expired) await expired.release().catch(() => {});
  }
}

function findTransition(
  history: AttachmentHistoryRuntimeState,
  currentVersion: string | null,
  targetVersion: string | null,
): AttachmentHistoryTransition | null {
  return history.transitions.find((transition) => (
    transition.afterVersion === currentVersion && transition.beforeVersion === targetVersion
  ) || (
    transition.beforeVersion === currentVersion && transition.afterVersion === targetVersion
  )) ?? null;
}

function getState(runtime = getActiveStateRuntime()): AttachmentHistoryRuntimeState {
  let history = states.get(runtime);
  if (!history) {
    history = {
      store: new InMemoryHvyHistoryArtifactStore(),
      namespace: `hvy-attachment-history:${crypto.randomUUID()}`,
      currentVersion: null,
      transitions: [],
    };
    states.set(runtime, history);
  }
  return history;
}
