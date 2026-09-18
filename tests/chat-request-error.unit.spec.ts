import { expect, test } from 'vitest';
import { createChatRequestError } from '../src/chat/request-error';
import { normalizeImportError, runImportOperation } from '../src/import-errors';

for (const status of [400, 402, 403, 429]) {
  test(`HTTP ${status} preserves structured failure details`, () => {
    expect(normalizeImportError(createChatRequestError(
      new Response(null, { status, headers: { 'Retry-After': '60' } }),
      { error: { message: 'Sample limit reached', code: 'sample_limit', quota: 'sample-quota' } },
      'Request failed.',
    ), 'Import failed.')).toEqual({
      message: 'Sample limit reached', status, code: 'sample_limit', quota: 'sample-quota', retryAfter: '60',
    });
  });
}

test('plain and non-JSON HTTP failures retain their status', () => {
  expect(normalizeImportError(createChatRequestError(new Response(null, { status: 403 }), {
    error: 'Sample refusal', code: 'sample_code',
  }, 'Request failed.'), '')).toEqual({ message: 'Sample refusal', status: 403, code: 'sample_code' });
  expect(normalizeImportError(createChatRequestError(new Response(null, { status: 502 }), null,
    'Request failed.'), '')).toEqual({ message: 'Request failed.', status: 502 });
});

test('finalization exceptions settle and notify once', async () => {
  const errors: unknown[] = [];
  const result = await runImportOperation(async () => { throw new Error('Sample finalization failure'); },
    (error) => { errors.push(error); });
  expect(result).toEqual({ status: 'error', message: 'Sample finalization failure', error: { message: 'Sample finalization failure' } });
  expect(errors).toEqual([result.error]);
});

test('success does not notify an error', async () => {
  const errors: unknown[] = [];
  expect(await runImportOperation(async () => ({ status: 'complete' }),
    (error) => { errors.push(error); })).toEqual({ status: 'complete' });
  expect(errors).toEqual([]);
});
