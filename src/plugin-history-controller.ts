import { getAttachment, removeAttachment, setAttachment } from './attachments';
import { getHostPlugin } from './plugins/registry';
import type { HvyPluginHistoryRestoreContext, HvyPluginHistoryStep } from './plugins/types';
import { getActiveStateRuntime, type StateRuntime } from './state';

// Plugin-owned undo steps. Like the database and attachment controllers, app
// history snapshots name a plugin history version, and undo/redo run the
// transition between two versions. Plugin data never enters the text snapshot.
// TODO: The database and attachment controllers share this transition model and
// could be reconciled onto one core later.

interface PluginHistoryTransition {
  beforeVersion: string;
  afterVersion: string;
  pluginId: string;
  sectionKey: string;
  blockId: string;
  data: unknown;
}

interface PluginHistoryRuntimeState {
  // Null until a plugin records a step, so documents that never use plugin
  // history keep snapshots without a plugin version.
  currentVersion: string | null;
  transitions: PluginHistoryTransition[];
}

export interface PluginHistoryStepOwner {
  pluginId: string;
  sectionKey: string;
  blockId: string;
}

const MAX_PLUGIN_HISTORY_TRANSITIONS = 200;
const states = new WeakMap<StateRuntime, PluginHistoryRuntimeState>();

export function getPluginHistoryVersion(): string | null {
  return getState().currentVersion;
}

export function hasPluginHistoryVersionTransition(targetVersion: string | null): boolean {
  const history = getState();
  return history.currentVersion !== targetVersion
    && findTransition(history, history.currentVersion, targetVersion) !== null;
}

export function adoptPluginHistoryVersion(version: string | null): void {
  getState().currentVersion = version;
}

// Records the app history entry for the state before the step, applies the
// plugin's change, then moves to a new version that undo can return from.
export function recordPluginHistoryStep(
  owner: PluginHistoryStepOwner,
  step: HvyPluginHistoryStep,
  recordBefore: () => void,
): void {
  const history = getState();
  history.currentVersion ??= `plugin-base:${crypto.randomUUID()}`;
  const beforeVersion = history.currentVersion;
  recordBefore();
  dropForwardBranches(history, beforeVersion);
  step.apply();
  const afterVersion = `plugin-state:${crypto.randomUUID()}`;
  history.transitions.push({ beforeVersion, afterVersion, ...owner, data: step.data });
  if (history.transitions.length > MAX_PLUGIN_HISTORY_TRANSITIONS) {
    history.transitions.splice(0, history.transitions.length - MAX_PLUGIN_HISTORY_TRANSITIONS);
  }
  history.currentVersion = afterVersion;
}

export async function restorePluginHistoryVersion(targetVersion: string | null): Promise<void> {
  const history = getState();
  if (history.currentVersion === targetVersion) return;
  const transition = findTransition(history, history.currentVersion, targetVersion);
  if (!transition) {
    throw new Error('The plugin history transition needed for this Undo or Redo is unavailable.');
  }
  const capability = getHostPlugin(transition.pluginId)?.history;
  if (!capability) {
    throw new Error(`Plugin "${transition.pluginId}" is not installed, so its Undo or Redo step cannot run.`);
  }
  const ctx = createRestoreContext(transition);
  if (transition.beforeVersion === targetVersion) await capability.undo(ctx);
  else await capability.redo(ctx);
  history.currentVersion = targetVersion;
}

export function destroyPluginHistory(runtime: StateRuntime): void {
  states.delete(runtime);
}

// Restore writes go straight to the attachment store: app history is already
// navigating, so they must not record entries of their own.
function createRestoreContext(transition: PluginHistoryTransition): HvyPluginHistoryRestoreContext {
  const document = getActiveStateRuntime().state.document;
  return {
    sectionKey: transition.sectionKey,
    blockId: transition.blockId,
    data: transition.data,
    attachments: {
      list: () => document.attachments.slice(),
      get: (id) => getAttachment(document, id),
      set: (id, meta, bytes) => setAttachment(document, id, meta, bytes),
      remove: (id) => removeAttachment(document, id),
    },
  };
}

function dropForwardBranches(history: PluginHistoryRuntimeState, version: string): void {
  const branches = history.transitions.filter((transition) => transition.beforeVersion === version);
  for (const branch of branches) {
    history.transitions.splice(history.transitions.indexOf(branch), 1);
    dropForwardBranches(history, branch.afterVersion);
  }
}

function findTransition(
  history: PluginHistoryRuntimeState,
  currentVersion: string | null,
  targetVersion: string | null,
): PluginHistoryTransition | null {
  return history.transitions.find((transition) => (
    transition.afterVersion === currentVersion && transition.beforeVersion === targetVersion
  ) || (
    transition.beforeVersion === currentVersion && transition.afterVersion === targetVersion
  )) ?? null;
}

function getState(runtime = getActiveStateRuntime()): PluginHistoryRuntimeState {
  let history = states.get(runtime);
  if (!history) {
    history = { currentVersion: null, transitions: [] };
    states.set(runtime, history);
  }
  return history;
}
