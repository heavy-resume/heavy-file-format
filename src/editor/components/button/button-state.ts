import { getActiveStateRuntime, type StateRuntime } from '../../../state';

const runningButtons = new Set<string>();
const runningButtonsByRuntime = new WeakMap<StateRuntime, Set<string>>();

export function buttonKey(sectionKey: string, blockId: string): string {
  return `${sectionKey}:${blockId}`;
}

function getRunningButtons(): Set<string> {
  try {
    const runtime = getActiveStateRuntime();
    let buttons = runningButtonsByRuntime.get(runtime);
    if (!buttons) {
      buttons = new Set<string>();
      runningButtonsByRuntime.set(runtime, buttons);
    }
    return buttons;
  } catch {
    return runningButtons;
  }
}

export function isButtonAiGenerateRunning(sectionKey: string, blockId: string): boolean {
  return getRunningButtons().has(buttonKey(sectionKey, blockId));
}

export function markButtonAiGenerateRunning(sectionKey: string, blockId: string): void {
  getRunningButtons().add(buttonKey(sectionKey, blockId));
}

export function clearButtonAiGenerateRunning(sectionKey: string, blockId: string): void {
  getRunningButtons().delete(buttonKey(sectionKey, blockId));
}
