/** Preserve transport metadata without copying arbitrary response fields onto Error. */
export function createChatRequestError(response: Response, payload: unknown, fallback: string): Error {
  const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const details = body.error && typeof body.error === 'object'
    ? body.error as Record<string, unknown>
    : body;
  const message = typeof body.error === 'string' && body.error.trim()
    ? body.error
    : typeof details.message === 'string' && details.message.trim() ? details.message : fallback;
  const error = Object.assign(new Error(message), { status: response.status });
  for (const key of ['code', 'quota'] as const) {
    if (typeof details[key] === 'string' && details[key].trim()) {
      Object.assign(error, { [key]: details[key] });
    }
  }
  const retryAfter = response.headers.get('Retry-After');
  if (retryAfter) Object.assign(error, { retryAfter });
  return error;
}
