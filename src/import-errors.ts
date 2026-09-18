/** Serializable error details exposed to hosts by import operations. */
export interface HvyImportError {
  message: string;
  /** HTTP status, when supplied by the transport or host client. */
  status?: number;
  code?: string;
  /** Host-defined quota identifier. */
  quota?: string;
  /** Retry-After header value, when supplied by the transport. */
  retryAfter?: string;
}

export function normalizeImportError(error: unknown, fallback: string): HvyImportError {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const result: HvyImportError = {
    message: typeof record.message === 'string' && record.message.trim()
      ? record.message
      : typeof error === 'string' && error.trim() ? error : fallback,
  };
  if (typeof record.status === 'number' && Number.isInteger(record.status) && record.status >= 100 && record.status <= 599) {
    result.status = record.status;
  }
  for (const key of ['code', 'quota', 'retryAfter'] as const) {
    if (typeof record[key] === 'string' && record[key].trim()) result[key] = record[key];
  }
  return result;
}

/** Notify once, after the operation has settled, without awaiting host UI work. */
export async function runImportOperation<Result extends { status: string; message?: string; error?: HvyImportError }>(
  operation: () => Promise<Result>,
  onError?: (error: HvyImportError) => void,
): Promise<Result | { status: 'error' | 'aborted'; message: string; error?: HvyImportError }> {
  let result: Result | { status: 'error' | 'aborted'; message: string; error?: HvyImportError };
  try {
    result = await operation();
  } catch (error) {
    if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
      return { status: 'aborted', message: 'Import was aborted.' };
    }
    const details = normalizeImportError(error, 'Import failed.');
    result = { status: 'error', message: details.message, error: details };
  }
  if (result.status === 'error') {
    const error = result.error ?? normalizeImportError(result.message, 'Import failed.');
    result = { ...result, message: error.message, error };
    onError?.(error);
  }
  return result;
}
