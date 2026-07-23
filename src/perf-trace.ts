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

export interface HvyMeasurementEvent {
  label: string;
  elapsedMs: number;
  atMs: number;
  details?: Record<string, unknown>;
}

declare global {
  interface Window {
    __hvyMeasure?: {
      enabled: boolean;
      events: HvyMeasurementEvent[];
    };
  }
}

export function isMeasurementEnabled(): boolean {
  return typeof window !== 'undefined' && window.__hvyMeasure?.enabled === true;
}

export function recordMeasurement(label: string, elapsedMsValue: number, details: Record<string, unknown> = {}): void {
  if (!isMeasurementEnabled()) {
    return;
  }
  window.__hvyMeasure?.events.push({
    label,
    elapsedMs: Number(elapsedMsValue.toFixed(2)),
    atMs: Number(performance.now().toFixed(2)),
    ...(Object.keys(details).length > 0 ? { details } : {}),
  });
}

export function measurePhase<T>(label: string, details: Record<string, unknown>, action: () => T): T {
  if (!isMeasurementEnabled()) {
    return action();
  }
  const startedAt = performance.now();
  try {
    return action();
  } finally {
    recordMeasurement(label, performance.now() - startedAt, details);
  }
}

export async function measureAsyncPhase<T>(label: string, details: Record<string, unknown>, action: () => Promise<T>): Promise<T> {
  if (!isMeasurementEnabled()) {
    return action();
  }
  const startedAt = performance.now();
  try {
    return await action();
  } finally {
    recordMeasurement(label, performance.now() - startedAt, details);
  }
}
