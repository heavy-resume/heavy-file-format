import type { StateRuntime } from '../../state';

export type HvyDisposedCallbackReason = 'disposed' | 'replaced' | 'document-changed';

export class HvyDisposedCallbackError extends Error {
  readonly code = 'HVY_CALLBACK_DISPOSED' as const;
  readonly reason: HvyDisposedCallbackReason;

  constructor(reason: HvyDisposedCallbackReason) {
    const message =
      reason === 'replaced'
        ? 'Scripting callback was replaced by a newer run of the component.'
        : reason === 'document-changed'
          ? 'Scripting callback no longer matches the active document.'
          : 'Scripting callback runtime has been disposed.';
    super(message);
    this.name = 'HvyDisposedCallbackError';
    this.reason = reason;
  }
}

interface RegisteredCallbackCleanup {
  cleanup: (reason: HvyDisposedCallbackReason) => void;
  ownerKey?: string;
  source?: string;
}

const disposedScriptingRuntimes = new WeakSet<StateRuntime>();
const scriptingCallbackCleanups = new WeakMap<StateRuntime, Set<RegisteredCallbackCleanup>>();

export function isScriptingCallbackRuntimeDisposed(runtime: StateRuntime): boolean {
  return disposedScriptingRuntimes.has(runtime);
}

export function registerScriptingCallbackCleanup(
  runtime: StateRuntime,
  cleanup: (reason: HvyDisposedCallbackReason) => void,
  options: { ownerKey?: string; source?: string } = {}
): void {
  let cleanups = scriptingCallbackCleanups.get(runtime);
  if (!cleanups) {
    cleanups = new Set();
    scriptingCallbackCleanups.set(runtime, cleanups);
  }
  cleanups.add({ cleanup, ownerKey: options.ownerKey, source: options.source });
}

export function replaceScriptingCallbackCleanups(
  runtime: StateRuntime,
  ownerKey: string,
  options: { onlyIfSourceChangedFrom?: string } = {}
): void {
  const cleanups = scriptingCallbackCleanups.get(runtime);
  if (!cleanups) return;
  for (const entry of [...cleanups]) {
    if (entry.ownerKey !== ownerKey) continue;
    if (options.onlyIfSourceChangedFrom !== undefined && entry.source === options.onlyIfSourceChangedFrom) {
      continue;
    }
    cleanups.delete(entry);
    entry.cleanup('replaced');
  }
}

export function disposeScriptingCallbacks(runtime: StateRuntime): void {
  disposedScriptingRuntimes.add(runtime);
  const cleanups = scriptingCallbackCleanups.get(runtime);
  if (!cleanups) return;
  for (const entry of cleanups) entry.cleanup('disposed');
  cleanups.clear();
  scriptingCallbackCleanups.delete(runtime);
}
