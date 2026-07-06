export function nowMs(): number {
  return performance.now();
}

export function elapsedMs(startedAt: number): number {
  return Number((performance.now() - startedAt).toFixed(2));
}

export function logPerfTrace(event: string, details: Record<string, unknown> = {}): void {
  console.debug('[hvy:perf]', {
    event,
    atMs: Number(performance.now().toFixed(2)),
    ...details,
  });
}
