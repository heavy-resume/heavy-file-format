import { expect, test, vi } from 'vitest';

import { searchHvyDocumentForAgent } from '../src/search/hvy-document-search';
import {
  materializePreparedEmbeddingAttachments,
  prepareEmbeddingChatContext,
  searchHvyDocumentByEmbedding,
} from '../src/chat/embedding-context';
import { deserializeDocument, deserializeDocumentBytes, serializeDocumentBytes } from '../src/serialization';
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

  const document = deserializeDocument(SEARCH_DOCUMENT, '.hvy');
  await prepareEmbeddingChatContext(document, { mode: 'embedding-retrieval' }, embeddingProvider);
  embeddingProvider.mockClear();
  const expectedResult = await searchHvyDocumentForAgent({
    document,
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
    label: 'Known for moving software from idea to production quickly.',
    context: 'Summary',
  }));
  expect(expectedResult.results[0]?.excerpt).toContain('moving software from idea to production quickly');
  expect(JSON.stringify(expectedResult)).not.toContain('score');
  expect(embeddingProvider).toHaveBeenCalledOnce();
  expect(embeddingProvider.mock.calls[0]![0].inputs).toEqual([
    expect.objectContaining({ id: 'query' }),
  ]);
});

test('expected result: explicit semantic search uses available embeddings outside embedding retrieval mode', async () => {
  const embeddingProvider: HvyEmbeddingProvider = vi.fn(async (request) =>
    request.inputs.map((input) => ({ id: input.id, vector: [1, 0] }))
  );

  // BEFORE
  const document = deserializeDocument(SEARCH_DOCUMENT, '.hvy');
  await prepareEmbeddingChatContext(document, { mode: 'keyword-retrieval' }, embeddingProvider);
  embeddingProvider.mockClear();

  // TOOL CALL
  const expectedResult = await searchHvyDocumentForAgent({
    document,
    query: 'delivery experience',
    semantic: true,
    chatContext: { mode: 'keyword-retrieval' },
    embeddingProvider,
  });

  // AFTER
  expect(expectedResult.mode).toBe('embeddings');
  expect(embeddingProvider).toHaveBeenCalled();
});

test('expected result: explicit lexical search does not use available embeddings', async () => {
  const embeddingProvider: HvyEmbeddingProvider = vi.fn();

  // BEFORE
  const document = deserializeDocument(SEARCH_DOCUMENT, '.hvy');

  // TOOL CALL
  const expectedResult = await searchHvyDocumentForAgent({
    document,
    query: 'mentoring',
    semantic: false,
    chatContext: { mode: 'embedding-retrieval' },
    embeddingProvider,
  });

  // AFTER
  expect(expectedResult.mode).toBe('lexical_fallback');
  expect(embeddingProvider).not.toHaveBeenCalled();
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
    expect.objectContaining({
      path: '/body/summary/mentoring',
      label: 'Mentors engineers and supports their long-term growth.',
      context: 'Summary',
      excerpt: expect.stringContaining('Mentors engineers and supports their long-term growth.'),
    }),
  ]);
  expect(embeddingProvider).not.toHaveBeenCalled();
});

test('expected result: agent search reports that document embeddings must be built without calling the provider', async () => {
  const embeddingProvider: HvyEmbeddingProvider = vi.fn();

  const expectedResult = await searchHvyDocumentForAgent({
    document: deserializeDocument(SEARCH_DOCUMENT, '.hvy'),
    query: 'mentoring',
    chatContext: { mode: 'embedding-retrieval' },
    embeddingProvider,
  });

  expect(expectedResult.mode).toBe('lexical_fallback');
  expect(expectedResult.fallbackReason).toContain('Document embeddings are not prepared');
  expect(expectedResult.results).toEqual([
    expect.objectContaining({ path: '/body/summary/mentoring' }),
  ]);
  expect(embeddingProvider).not.toHaveBeenCalled();
});

test('expected result: user-led semantic search builds missing document embeddings', async () => {
  const embeddingProvider: HvyEmbeddingProvider = vi.fn(async (request) =>
    request.inputs.map((input) => ({ id: input.id, vector: [1, 0] }))
  );

  // BEFORE
  const document = deserializeDocument(SEARCH_DOCUMENT, '.hvy');

  // TOOL CALL
  const expectedResult = await searchHvyDocumentByEmbedding({
    document,
    query: 'delivery experience',
    embeddingProvider,
  });

  // AFTER
  expect(expectedResult).not.toHaveLength(0);
  expect(embeddingProvider).toHaveBeenCalledTimes(2);
  expect(embeddingProvider.mock.calls[0]![0].inputs).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'component:delivery' }),
    expect.objectContaining({ id: 'component:mentoring' }),
  ]));
  expect(embeddingProvider.mock.calls[1]![0].inputs).toEqual([
    expect.objectContaining({ id: 'query' }),
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

  await prepareEmbeddingChatContext(document, { mode: 'embedding-retrieval' }, embeddingProvider);

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

test('expected result: semantic search hydrates a prepared attachment without rebuilding document embeddings', async () => {
  const source = deserializeDocument(SEARCH_DOCUMENT, '.hvy');
  const embeddingProvider: HvyEmbeddingProvider = vi.fn(async (request) =>
    request.inputs.map((input) => ({ id: input.id, vector: [1, 0] }))
  );
  await prepareEmbeddingChatContext(source, {
    mode: 'embedding-retrieval',
    persistEmbeddingsToAttachments: true,
  }, embeddingProvider);
  materializePreparedEmbeddingAttachments(source);
  const document = deserializeDocumentBytes(serializeDocumentBytes(source), '.hvy');
  embeddingProvider.mockClear();

  // TOOL CALL
  const expectedResult = await searchHvyDocumentForAgent({
    document,
    query: 'delivery experience',
    semantic: true,
    embeddingProvider,
  });

  // AFTER
  expect(expectedResult.mode).toBe('embeddings');
  expect(embeddingProvider).toHaveBeenCalledOnce();
  expect(embeddingProvider.mock.calls[0]![0].inputs).toEqual([
    expect.objectContaining({ id: 'query' }),
  ]);
});
