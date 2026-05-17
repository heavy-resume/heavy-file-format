const runningButtons = new Set<string>();

export function buttonKey(sectionKey: string, blockId: string): string {
  return `${sectionKey}:${blockId}`;
}

export function isButtonAiGenerateRunning(sectionKey: string, blockId: string): boolean {
  return runningButtons.has(buttonKey(sectionKey, blockId));
}

export function markButtonAiGenerateRunning(sectionKey: string, blockId: string): void {
  runningButtons.add(buttonKey(sectionKey, blockId));
}

export function clearButtonAiGenerateRunning(sectionKey: string, blockId: string): void {
  runningButtons.delete(buttonKey(sectionKey, blockId));
}
