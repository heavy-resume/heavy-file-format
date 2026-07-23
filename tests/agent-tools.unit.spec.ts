import { expect, test, vi } from 'vitest';

import { createHvyAgentTools } from '../src/agent-tools';
import { deserializeDocument, serializeDocument } from '../src/serialization';
import type { HvyEmbeddingProvider } from '../src/types';

test('expected result: public agent tools share embedding search and patch state', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"delivery"}-->
Moves software from idea to production quickly.
`, '.hvy');
  const embeddingProvider: HvyEmbeddingProvider = vi.fn(async (request) =>
    request.inputs.map((input) => ({
      id: input.id,
      vector: input.id === 'query' || input.text.includes('quickly') ? [1, 0] : [0, 1],
    }))
  );
  const tools = createHvyAgentTools({
    document,
    embeddingProvider,
    chatContext: { mode: 'embedding-retrieval' },
  });

  const searchResult = await tools.search({
    query: 'claims about unusually fast development',
    limit: 5,
  });
  const patchResult = tools.applyPatch(`*** Begin Patch
*** Update File: /body/summary/delivery/text.txt
@@
-Moves software from idea to production quickly.
+Moves software from idea to production with reliable feedback.
*** End Patch`);

  expect(searchResult.mode).toBe('embeddings');
  expect(searchResult.results[0]?.path).toBe('/body/summary/delivery');
  expect(patchResult).toMatchObject({
    appliedFileCount: 1,
    failedFileCount: 0,
  });
  expect(serializeDocument(document)).toContain('with reliable feedback.');
  expect(tools.getCliSession()).toBe(tools.getCliSession());
});
