import { expect, test, vi } from 'vitest';

import { searchHvyDocumentForAgent } from '../src/search/hvy-document-search';
import { deserializeDocument } from '../src/serialization';
import type { HvyEmbeddingProvider } from '../src/types';

const SEARCH_DOCUMENT = `---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"delivery"}-->
Known for moving software from idea to production quickly.

<!--hvy:text {"id":"mentoring"}-->
Mentors engineers and supports their long-term growth.
`;

test('expected result: agent search uses embeddings exclusively when embedding retrieval is enabled', async () => {
  const embeddingProvider: HvyEmbeddingProvider = vi.fn(async (request) =>
    request.inputs.map((input) => ({
      id: input.id,
      vector: input.id === 'query' || /quickly|fast development/i.test(input.text)
        ? [1, 0]
        : [0, 1],
    }))
  );

  const expectedResult = await searchHvyDocumentForAgent({
    document: deserializeDocument(SEARCH_DOCUMENT, '.hvy'),
    query: 'references to fast development',
    limit: 2,
    chatContext: { mode: 'embedding-retrieval' },
    embeddingProvider,
  });

  expect(expectedResult.mode).toBe('embeddings');
  expect(expectedResult.results[0]).toEqual(expect.objectContaining({
    path: '/body/summary/delivery',
    kind: 'component',
    type: 'text',
  }));
  expect(expectedResult.results[0]?.excerpt).toContain('moving software from idea to production quickly');
  expect(JSON.stringify(expectedResult)).not.toContain('score');
  expect(embeddingProvider).toHaveBeenCalled();
});

test('expected result: agent search uses lexical fallback when embedding retrieval is off', async () => {
  const embeddingProvider: HvyEmbeddingProvider = vi.fn();

  const expectedResult = await searchHvyDocumentForAgent({
    document: deserializeDocument(SEARCH_DOCUMENT, '.hvy'),
    query: 'mentoring',
    limit: 2,
    chatContext: { mode: 'full-document' },
    embeddingProvider,
  });

  expect(expectedResult.mode).toBe('lexical_fallback');
  expect(expectedResult.results).toEqual([
    expect.objectContaining({ path: '/body/summary/mentoring' }),
  ]);
  expect(embeddingProvider).not.toHaveBeenCalled();
});

test('expected result: agent search reports lexical fallback after an embedding failure', async () => {
  const expectedResult = await searchHvyDocumentForAgent({
    document: deserializeDocument(SEARCH_DOCUMENT, '.hvy'),
    query: 'mentoring',
    chatContext: { mode: 'embedding-retrieval' },
    embeddingProvider: async () => {
      throw new Error('Embedding service unavailable.');
    },
  });

  expect(expectedResult.mode).toBe('lexical_fallback');
  expect(expectedResult.fallbackReason).toBe('Embedding service unavailable.');
  expect(expectedResult.results).toEqual([
    expect.objectContaining({ path: '/body/summary/mentoring' }),
  ]);
});

test('expected result: agent search continues ranked embedding results with a cursor', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"first"}-->
Delivery evidence one.

<!--hvy:text {"id":"second"}-->
Delivery evidence two.

<!--hvy:text {"id":"third"}-->
Delivery evidence three.
`, '.hvy');
  const embeddingProvider: HvyEmbeddingProvider = async (request) =>
    request.inputs.map((input) => ({ id: input.id, vector: [1, 0] }));

  const firstPage = await searchHvyDocumentForAgent({
    document,
    query: 'delivery evidence',
    limit: 1,
    chatContext: { mode: 'embedding-retrieval' },
    embeddingProvider,
  });
  const expectedResult = await searchHvyDocumentForAgent({
    document,
    query: 'delivery evidence',
    limit: 1,
    cursor: firstPage.nextCursor!,
    chatContext: { mode: 'embedding-retrieval' },
    embeddingProvider,
  });

  expect(firstPage.results[0]?.path).toBe('/body/summary/first');
  expect(firstPage.nextCursor).toBe('hvy-search:1');
  expect(expectedResult.results[0]?.path).toBe('/body/summary/second');
  expect(expectedResult.nextCursor).toBe('hvy-search:2');
});
