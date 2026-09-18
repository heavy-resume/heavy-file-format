import { expect, test } from 'vitest';
import { buildImportPlanForDocument, importTextIntoDocument } from '../src/ai-document-import';
import { deserializeDocument, serializeDocument } from '../src/serialization';

for (const operation of ['plan', 'import'] as const) {
  test(`${operation} returns quota details and notifies the host exactly once`, async () => {
    const document = deserializeDocument('---\nhvy_version: 0.1\n---\n\n<!--hvy: {"id":"sample"}-->\n#! Sample\n', '.hvy');
    const before = serializeDocument(document);
    const errors: unknown[] = [];
    let calls = 0;
    const options = {
      sourceText: 'Fictional sample content',
      steps: [{ section: 'Sample', sectionId: 'sample' }],
      llm: {
        settings: { provider: 'openai' as const, model: 'fake-model' },
        client: {
          async complete(): Promise<never> {
            calls += 1;
            throw Object.assign(new Error('Quota exhausted'), {
              status: 429, code: 'quota_exhausted', quota: 'sample-quota',
            });
          },
        },
      },
      onError: (error: unknown) => { errors.push(error); },
    };

    const result = await (operation === 'plan'
      ? buildImportPlanForDocument(document, options)
      : importTextIntoDocument(document, options));

    expect(result).toMatchObject({
      status: 'error',
      message: 'Quota exhausted',
      error: { message: 'Quota exhausted', status: 429, code: 'quota_exhausted', quota: 'sample-quota' },
    });
    expect(errors).toEqual([result.error]);
    expect(calls).toBe(1);
    expect(serializeDocument(document)).toBe(before);
  });
}

test('validation failures notify without calling a client', async () => {
  const errors: unknown[] = [];
  const result = await importTextIntoDocument(deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy'), {
    sourceText: 'Fictional content', steps: [],
    onError: (error) => { errors.push(error); },
  });
  expect(result.status).toBe('error');
  expect(errors).toEqual([{ message: 'Import requires at least one approved plan step.' }]);
});

test('cancellation does not notify an error', async () => {
  const errors: unknown[] = [];
  const result = await buildImportPlanForDocument(deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy'), {
    sourceText: 'Fictional content',
    llm: { settings: { provider: 'openai', model: 'fake-model' }, client: {
      async complete(): Promise<never> { throw new DOMException('Cancelled', 'AbortError'); },
    } },
    onError: (error) => { errors.push(error); },
  });
  expect(result.status).toBe('aborted');
  expect(errors).toEqual([]);
});
