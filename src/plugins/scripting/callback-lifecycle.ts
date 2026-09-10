import type { StateRuntime } from '../../state';

const disposedScriptingRuntimes = new WeakSet<StateRuntime>();
const scriptingCallbackCleanups = new WeakMap<StateRuntime, Set<() => void>>();

export function isScriptingCallbackRuntimeDisposed(runtime: StateRuntime): boolean {
  return disposedScriptingRuntimes.has(runtime);
}

export function registerScriptingCallbackCleanup(runtime: StateRuntime, cleanup: () => void): void {
  let cleanups = scriptingCallbackCleanups.get(runtime);
  if (!cleanups) {
    cleanups = new Set();
    scriptingCallbackCleanups.set(runtime, cleanups);
  }
  cleanups.add(cleanup);
}

export function disposeScriptingCallbacks(runtime: StateRuntime): void {
  disposedScriptingRuntimes.add(runtime);
  const cleanups = scriptingCallbackCleanups.get(runtime);
  if (!cleanups) return;
  for (const cleanup of cleanups) cleanup();
  cleanups.clear();
  scriptingCallbackCleanups.delete(runtime);
}
