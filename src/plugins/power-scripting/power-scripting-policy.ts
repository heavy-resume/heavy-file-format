import { getActiveStateRuntime, type StateRuntime } from '../../state';

export type HvyPowerScriptingMode = 'prompt' | 'enabled' | 'hidden';

const modes = new WeakMap<StateRuntime, HvyPowerScriptingMode>();

export function setPowerScriptingMode(mode: HvyPowerScriptingMode, runtime: StateRuntime = getActiveStateRuntime()): void {
  modes.set(runtime, mode);
}

export function getPowerScriptingMode(runtime: StateRuntime = getActiveStateRuntime()): HvyPowerScriptingMode {
  return modes.get(runtime) ?? 'prompt';
}

export function clearPowerScriptingMode(runtime: StateRuntime): void {
  modes.delete(runtime);
}
