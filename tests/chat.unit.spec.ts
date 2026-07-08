import { afterEach, expect, test, vi } from 'vitest';

import {
  buildChatDocumentContext,
  buildProxyChatRequest,
  closeChatPanel,
  createDefaultChatState,
  getEnvChatSettings,
  MAX_PROXY_COMPLETION_CONTEXT_CHARS,
  mergeChatSettings,
  requestChatCompletion,
  requestProxyCompletion,
  setHostChatClient,
  stopChatRequest,
  stripDocumentHeaderAndComments,
  toggleChatPanelOpen,
} from '../src/chat/chat';
import { applyScoreGapCutoff, buildKeywordChatContext, markKeywordChatContextDocumentChanged, prepareKeywordChatContext } from '../src/chat/chat-context';
import { buildEmbeddingChatContext as buildVectorChatContext, materializePreparedEmbeddingAttachments, markEmbeddingChatContextDocumentChanged, persistPreparedEmbeddingAttachments, planEmbeddingIndexUpdate, prepareEmbeddingChatContext, readEmbeddingIndexFromDocumentBytes } from '../src/chat/embedding-context';
import { wrapChatResponseAsDocument } from '../src/chat/chat-response-document';
import { getDocumentComponentDefaultCss } from '../src/document-component-defaults';
import { deserializeDocument, deserializeDocumentBytes, serializeDocumentBytes } from '../src/serialization';
import { searchDocuments } from '../src/search/documents';
import { getAttachmentDescriptors } from '../src/attachment-store';
import type { HvyChatSearchIndexSnapshot, HvyEmbeddingProvider } from '../src/types';

afterEach(() => {
  setHostChatClient(null);
  vi.restoreAllMocks();
});

test('stripDocumentHeaderAndComments removes front matter and preserves structural hvy comments', () => {
  const input = `---
hvy_version: 0.1
title: Example
---

<!--hvy: {"id":"summary"}-->
#! Summary

Visible paragraph.

<!-- ordinary comment -->

<!--hvy:text {"class":"decorative"}-->

<!--hvy:xref-card {"xrefTitle":"Skill","xrefDetail":"Detail","xrefTarget":"skill"}-->

More content.
`;

  expect(stripDocumentHeaderAndComments(input)).toBe(
    '<!--hvy: {"id":"summary"}-->\n#! Summary\n\nVisible paragraph.\n\n<!--hvy:xref-card {"xrefTitle":"Skill","xrefDetail":"Detail","xrefTarget":"skill"}-->\n\nMore content.'
  );
});

test('buildChatDocumentContext preserves selected structural directives in serialized content', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {}-->
 Hello there

<!--hvy:xref-card {"xrefTitle":"TypeScript","xrefDetail":"Primary language","xrefTarget":"tool-typescript"}-->
`, '.hvy');

  expect(buildChatDocumentContext(document)).toContain('#! Summary');
  expect(buildChatDocumentContext(document)).toContain('Hello there');
  expect(buildChatDocumentContext(document)).toContain('<!--hvy: {"id":"summary"');
  expect(buildChatDocumentContext(document)).toContain('<!--hvy:xref-card {"xrefTitle":"TypeScript","xrefDetail":"Primary language","xrefTarget":"tool-typescript"}-->');
  expect(buildChatDocumentContext(document)).not.toContain('hvy_version');
  expect(buildChatDocumentContext(document)).not.toContain('<!--hvy:text');
});

test('buildChatDocumentContext prepends document ai context from metadata', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
ai-context: This resume uses top-skills-tools-technologies as featured skills.
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {}-->
 Hello there
`, '.hvy');

  const context = buildChatDocumentContext(document);

  expect(context).toContain('Document context:\nThis resume uses top-skills-tools-technologies as featured skills.');
  expect(context).toContain('Document body:\n<!--hvy: {"id":"summary"');
  expect(context).not.toContain('ai-context:');
});

test('buildChatDocumentContext keeps xref-card content under skills headings', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"skills"}-->
#! Skills

<!--hvy:component-list {"componentListComponent":"xref-card"}-->

 <!--hvy:component-list:0 {}-->

  <!--hvy:text {}-->
   #### Relevant Skills

 <!--hvy:component-list:1 {}-->

  <!--hvy:xref-card {"xrefTitle":"Software Engineering","xrefDetail":"Core strength","xrefTarget":"skill-software-engineering"}-->

 <!--hvy:component-list:2 {}-->

  <!--hvy:text {}-->
   #### Tools and Technologies

 <!--hvy:component-list:3 {}-->

  <!--hvy:xref-card {"xrefTitle":"TypeScript","xrefDetail":"Primary application language","xrefTarget":"tool-typescript"}-->
`, '.hvy');

  const context = buildChatDocumentContext(document);
  expect(context).toContain('#### Relevant Skills');
  expect(context).toContain('<!--hvy:xref-card {"xrefTitle":"Software Engineering","xrefDetail":"Core strength","xrefTarget":"skill-software-engineering"}-->');
  expect(context).toContain('#### Tools and Technologies');
  expect(context).toContain('<!--hvy:xref-card {"xrefTitle":"TypeScript","xrefDetail":"Primary application language","xrefTarget":"tool-typescript"}-->');
});

test('buildProxyChatRequest preserves provider, model, messages, and context', () => {
  expect(
    buildProxyChatRequest({
      provider: 'openai',
      model: 'gpt-5-mini',
      context: 'Context body',
      mode: 'qa',
      messages: [
        { id: '1', role: 'user', content: 'What is this?' },
        { id: '2', role: 'assistant', content: 'A summary.' },
      ],
    })
  ).toEqual({
    provider: 'openai',
    model: 'gpt-5-mini',
    context: 'Context body',
    mode: 'qa',
    messages: [
      { id: '1', role: 'user', content: 'What is this?', error: undefined },
      { id: '2', role: 'assistant', content: 'A summary.', error: undefined },
    ],
  });
});

test('requestProxyCompletion hard fails when context exceeds the per-call cap', async () => {
  const client = {
    complete: vi.fn(async () => ({ output: 'ok' })),
  };

  await expect(
    requestProxyCompletion({
      settings: { provider: 'openai', model: 'gpt-5-mini' },
      messages: [{ id: '1', role: 'user', content: 'Go.' }],
      context: '123456',
      responseInstructions: 'Return ok.',
      mode: 'qa',
      debugLabel: 'oversized-test',
      client,
      maxContextChars: 5,
    })
  ).rejects.toThrow(/maximum is 5/);
  expect(client.complete).not.toHaveBeenCalled();
});

test('requestProxyCompletion uses the default context cap when no override is supplied', async () => {
  const client = {
    complete: vi.fn(async () => ({ output: 'ok' })),
  };

  await requestProxyCompletion({
    settings: { provider: 'openai', model: 'gpt-5-mini' },
    messages: [{ id: '1', role: 'user', content: 'Go.' }],
    context: 'x'.repeat(Math.min(16, MAX_PROXY_COMPLETION_CONTEXT_CHARS)),
    responseInstructions: 'Return ok.',
    mode: 'qa',
    debugLabel: 'default-cap-test',
    client,
  });

  expect(client.complete).toHaveBeenCalledTimes(1);
});

test('requestChatCompletion uses keyword retrieval without serializing the full document', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"alpha"}-->
#! Alpha

<!--hvy:text {"id":"alpha-note","description":"Alpha answer"}-->
 alpha facts live here

<!--hvy: {"id":"secret"}-->
#! Secret

<!--hvy:text {"id":"secret-note"}-->
 SECRET_FULL_DOCUMENT_ONLY
`, '.hvy');
  const client = {
    complete: vi.fn(async () => ({ output: 'Alpha answer.' })),
  };
  setHostChatClient(client);

  await requestChatCompletion({
    settings: { provider: 'openai', model: 'gpt-5-mini' },
    document,
    messages: [{ id: '1', role: 'user', content: 'What alpha facts exist?' }],
    chatContext: { mode: 'keyword-retrieval', maxResults: 1, maxContextChars: 1_200 },
  });

  const context = client.complete.mock.calls[0]?.[0].context ?? '';
  expect(context).toContain('Retrieved document evidence:');
  expect(context).toContain('alpha facts live here');
  expect(context).not.toContain('SECRET_FULL_DOCUMENT_ONLY');
  expect(context).not.toContain('hvy_version');
});

test('requestChatCompletion uses embedding retrieval from a host provider', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"alpha"}-->
#! Alpha

<!--hvy:text {"id":"alpha-note"}-->
 alpha implementation facts live here

<!--hvy: {"id":"beta"}-->
#! Beta

<!--hvy:text {"id":"beta-note"}-->
 beta accounting facts live here
`, '.hvy');
  const client = {
    complete: vi.fn(async () => ({ output: 'Alpha answer.' })),
  };
  setHostChatClient(client);

  await requestChatCompletion({
    settings: { provider: 'openai', model: 'gpt-5-mini' },
    document,
    messages: [{ id: '1', role: 'user', content: 'implementation alpha' }],
    chatContext: { mode: 'embedding-retrieval', embeddingModel: 'text-embedding-ada-002', maxResults: 1, maxContextChars: 1_200 },
    embeddingProvider: makeDeterministicEmbeddingProvider(),
  });

  const context = client.complete.mock.calls[0]?.[0].context ?? '';
  expect(context).toContain('Retrieved document evidence:');
  expect(context).toContain('alpha implementation facts live here');
  expect(context).not.toContain('beta accounting facts live here');
});

test('buildEmbeddingChatContext persists and reuses a tail attachment cache', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"alpha"}-->
#! Alpha

<!--hvy:text {"id":"alpha-note"}-->
 alpha facts
`, '.hvy');
  const provider = vi.fn(makeDeterministicEmbeddingProvider());

  const firstResult = await buildVectorChatContext({
    document,
    question: 'alpha',
    messages: [],
    maxContextChars: 1_000,
    mode: 'qa',
  }, {
    mode: 'embedding-retrieval',
    embeddingModel: 'text-embedding-ada-002',
    persistEmbeddingsToAttachments: true,
  }, provider);
  expect(document.attachments.some((attachment) => attachment.id.startsWith('embedding-index:'))).toBe(false);
  materializePreparedEmbeddingAttachments(document);
  const bytes = serializeDocumentBytes(document);
  const roundTripped = deserializeDocumentBytes(bytes, '.hvy');
  const embeddingAttachment = roundTripped.attachments.find((attachment) => attachment.id.startsWith('embedding-index:'));
  const secondResult = await buildVectorChatContext({
    document: roundTripped,
    question: 'alpha',
    messages: [],
    maxContextChars: 1_000,
    mode: 'qa',
  }, {
    mode: 'embedding-retrieval',
    embeddingModel: 'text-embedding-ada-002',
  }, provider);

  expect(firstResult.context).toContain('alpha facts');
  expect(secondResult.context).toContain('alpha facts');
  expect(embeddingAttachment?.meta.mediaType).toBe('application/vnd.hvy.embedding-index');
  expect(new TextDecoder().decode(embeddingAttachment?.bytes ?? new Uint8Array())).not.toContain('"vectors"');
  expect(provider).toHaveBeenCalledTimes(3);
});

test('buildEmbeddingChatContext reuses unchanged section vectors after edits', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"alpha"}-->
#! Alpha

<!--hvy:text {"id":"alpha-note"}-->
 alpha facts

<!--hvy: {"id":"beta"}-->
#! Beta

<!--hvy:text {"id":"beta-note"}-->
 beta facts
`, '.hvy');
  const embeddedInputs: string[][] = [];
  const provider: HvyEmbeddingProvider = vi.fn(async (request) => {
    embeddedInputs.push(request.inputs.map((input) => input.text));
    return makeDeterministicEmbeddingProvider()(request);
  });

  await buildVectorChatContext({
    document,
    question: 'alpha',
    messages: [],
    maxContextChars: 1_000,
    mode: 'qa',
  }, {
    mode: 'embedding-retrieval',
    embeddingModel: 'text-embedding-ada-002',
    persistEmbeddingsToAttachments: true,
  }, provider);
  materializePreparedEmbeddingAttachments(document);
  document.sections[1]!.blocks[0]!.text = ' beta facts changed';
  markEmbeddingChatContextDocumentChanged(document);

  await buildVectorChatContext({
    document,
    question: 'beta',
    messages: [],
    maxContextChars: 1_000,
    mode: 'qa',
  }, {
    mode: 'embedding-retrieval',
    embeddingModel: 'text-embedding-ada-002',
    persistEmbeddingsToAttachments: true,
  }, provider);

  const recordEmbeddingCalls = embeddedInputs.filter((inputs) => inputs.some((input) => input.includes('facts')));
  expect(recordEmbeddingCalls[0]!.join('\n')).toContain('alpha facts');
  expect(recordEmbeddingCalls[0]!.join('\n')).toContain('beta facts');
  expect(recordEmbeddingCalls[1]).toHaveLength(1);
  expect(recordEmbeddingCalls[1]![0]).toContain('beta facts changed');
  expect(recordEmbeddingCalls[1]![0]).not.toContain('alpha facts');
});

test('prepareEmbeddingChatContext reports no-op stats when cache is unchanged', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"alpha"}-->
#! Alpha

<!--hvy:text {"id":"alpha-note"}-->
 alpha facts

<!--hvy:text {"id":"beta-note"}-->
 beta facts
`, '.hvy');
  const provider = vi.fn(makeDeterministicEmbeddingProvider());

  const firstStats = await prepareEmbeddingChatContext(document, {
    mode: 'embedding-retrieval',
    embeddingModel: 'text-embedding-ada-002',
    persistEmbeddingsToAttachments: true,
  }, provider);
  provider.mockClear();
  const expectedResult = await prepareEmbeddingChatContext(document, {
    mode: 'embedding-retrieval',
    embeddingModel: 'text-embedding-ada-002',
    persistEmbeddingsToAttachments: true,
  }, provider);

  expect(firstStats.rebuiltChunks).toBeGreaterThan(0);
  expect(expectedResult).toEqual({
    totalChunks: firstStats.totalChunks,
    reusedChunks: firstStats.totalChunks,
    rebuiltChunks: 0,
    missingVectors: 0,
    alreadyPrepared: true,
  });
  expect(provider).not.toHaveBeenCalled();
});

test('prepareEmbeddingChatContext does not rebuild nested detail chunks after summary text edits', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:expandable {"id":"summary-card"}-->
 <!--hvy:expandable:stub {}-->
  <!--hvy:text {"id":"summary-short"}-->
   Short summary sentence.
 <!--hvy:expandable:content {}-->
  <!--hvy:text {"id":"summary-detail"}-->
   ${'Long detail sentence. '.repeat(320)}
`, '.hvy');
  const provider = vi.fn(makeDeterministicEmbeddingProvider());

  const firstStats = await prepareEmbeddingChatContext(document, {
    mode: 'embedding-retrieval',
    embeddingModel: 'text-embedding-ada-002',
    persistEmbeddingsToAttachments: true,
  }, provider);
  document.sections[0]!.blocks[0]!.schema.expandableStubBlocks!.children[0]!.text = ' Changed short summary sentence.';
  markEmbeddingChatContextDocumentChanged(document);

  const expectedResult = await prepareEmbeddingChatContext(document, {
    mode: 'embedding-retrieval',
    embeddingModel: 'text-embedding-ada-002',
    persistEmbeddingsToAttachments: true,
  }, provider);

  expect(firstStats.totalChunks).toBeGreaterThan(2);
  expect(expectedResult.rebuiltChunks).toBe(1);
  expect(expectedResult.reusedChunks).toBe(firstStats.totalChunks - 1);
});

test('planEmbeddingIndexUpdate returns headless chunk inputs for external embedding storage', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"summary-note"}-->
 alpha implementation evidence
`, '.hvy');

  const expectedResult = planEmbeddingIndexUpdate({
    document,
    embeddingModel: 'text-embedding-ada-002',
  });

  expect(expectedResult.model).toBe('text-embedding-ada-002');
  expect(expectedResult.chunks).toHaveLength(1);
  expect(expectedResult.chunks[0]!.id).toBe('section:/body/summary');
  expect(expectedResult.chunks[0]!.text).toContain('alpha implementation evidence');
  expect(expectedResult.inputsToEmbed).toEqual([{
    id: expectedResult.chunks[0]!.id,
    text: expectedResult.chunks[0]!.text,
    textHash: expectedResult.chunks[0]!.textHash,
  }]);
  expect(expectedResult.reused).toEqual([]);
  expect(expectedResult.stale).toEqual([]);
  expect(expectedResult.removed).toEqual([]);
});

test('planEmbeddingIndexUpdate reuses valid vectors and separates stale and removed vectors', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"summary-note"}-->
 alpha implementation evidence

<!--hvy: {"id":"details"}-->
#! Details

<!--hvy:text {"id":"details-note"}-->
 beta accounting evidence
`, '.hvy');
  const initialPlan = planEmbeddingIndexUpdate({
    document,
    embeddingModel: 'text-embedding-ada-002',
  });
  const summaryChunk = initialPlan.chunks.find((chunk) => chunk.id === 'section:/body/summary')!;
  const detailsChunk = initialPlan.chunks.find((chunk) => chunk.id === 'section:/body/details')!;

  const expectedResult = planEmbeddingIndexUpdate({
    document,
    embeddingModel: 'text-embedding-ada-002',
    existingVectors: [
      {
        id: summaryChunk.id,
        textHash: summaryChunk.textHash,
        vector: [1, 0, 0],
        model: 'text-embedding-ada-002',
      },
      {
        id: detailsChunk.id,
        textHash: 'old-hash',
        vector: [0, 1, 0],
        model: 'text-embedding-ada-002',
      },
      {
        id: 'section:/body/removed',
        textHash: 'removed-hash',
        vector: [0, 0, 1],
        model: 'text-embedding-ada-002',
      },
    ],
  });

  expect(expectedResult.reused.map((entry) => entry.id)).toEqual([summaryChunk.id]);
  expect(expectedResult.stale.map((entry) => entry.id)).toEqual([detailsChunk.id]);
  expect(expectedResult.removed.map((entry) => entry.id)).toEqual(['section:/body/removed']);
  expect(expectedResult.inputsToEmbed.map((entry) => entry.id)).toEqual([detailsChunk.id]);
});

test('persistPreparedEmbeddingAttachments routes embedding bytes through the attachment host', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"alpha"}-->
#! Alpha

<!--hvy:text {"id":"alpha-note"}-->
 alpha facts
`, '.hvy');
  await buildVectorChatContext({
    document,
    question: 'alpha',
    messages: [],
    maxContextChars: 1_000,
    mode: 'qa',
  }, {
    mode: 'embedding-retrieval',
    embeddingModel: 'text-embedding-ada-002',
    persistEmbeddingsToAttachments: true,
  }, makeDeterministicEmbeddingProvider());
  const stored = new Map<string, { bytes: Uint8Array; meta: Record<string, unknown> }>();

  await persistPreparedEmbeddingAttachments(document, {
    list: () => [],
    recall: (id) => stored.get(id)?.bytes ?? null,
    store: (id, bytes, meta) => {
      stored.set(id, { bytes, meta });
      return { id, meta: { ...meta, storage: 'external' }, length: bytes.length };
    },
    remove: () => {},
  });

  const descriptor = getAttachmentDescriptors(document).find((attachment) => attachment.id.startsWith('embedding-index:'));
  expect(stored.size).toBe(1);
  expect(descriptor?.meta.storage).toBe('external');
  expect(descriptor?.length).toBe([...stored.values()][0]!.bytes.length);
  expect(document.attachments.find((attachment) => attachment.id === descriptor?.id)?.bytes).toHaveLength(0);
});

test('readEmbeddingIndexFromDocumentBytes returns stored vectors and chunk metadata from the hvy tail', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"alpha"}-->
#! Alpha

<!--hvy:text {"id":"alpha-note"}-->
 alpha facts for file cache lookup
`, '.hvy');

  await buildVectorChatContext({
    document,
    question: 'alpha',
    messages: [],
    maxContextChars: 1_000,
    mode: 'qa',
  }, {
    mode: 'embedding-retrieval',
    embeddingModel: 'text-embedding-ada-002',
    persistEmbeddingsToAttachments: true,
  }, makeDeterministicEmbeddingProvider());
  materializePreparedEmbeddingAttachments(document);

  const expectedResult = readEmbeddingIndexFromDocumentBytes(serializeDocumentBytes(document), '.hvy', {
    embeddingModel: 'text-embedding-ada-002',
  });

  expect(expectedResult).toHaveLength(1);
  expect(expectedResult[0]!.attachmentId).toMatch(/^embedding-index:/);
  expect(expectedResult[0]!.model).toBe('text-embedding-ada-002');
  expect(expectedResult[0]!.vectors).toHaveLength(1);
  expect(expectedResult[0]!.chunks).toHaveLength(1);
  expect(expectedResult[0]!.chunks[0]!.id).toBe(expectedResult[0]!.vectors[0]!.id);
  expect(expectedResult[0]!.chunks[0]!.textHash).toBe(expectedResult[0]!.vectors[0]!.textHash);
  expect(expectedResult[0]!.chunks[0]!.text).toContain('alpha facts for file cache lookup');
  expect(expectedResult[0]!.vectors[0]!.vector.length).toBeGreaterThan(0);
  expect(readEmbeddingIndexFromDocumentBytes(serializeDocumentBytes(document), '.hvy', {
    embeddingModel: 'different-model',
  })).toEqual([]);
});

test('buildEmbeddingChatContext does not persist embedding attachments for templates', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"alpha"}-->
#! Alpha

<!--hvy:text {"id":"alpha-note"}-->
 alpha facts
`, '.thvy');

  await buildVectorChatContext({
    document,
    question: 'alpha',
    messages: [],
    maxContextChars: 1_000,
    mode: 'qa',
  }, {
    mode: 'embedding-retrieval',
    embeddingModel: 'text-embedding-ada-002',
    persistEmbeddingsToAttachments: true,
  }, makeDeterministicEmbeddingProvider());

  expect(document.attachments.some((attachment) => attachment.id.startsWith('embedding-index:'))).toBe(false);
});

test('searchDocuments supports embedding mode across documents', async () => {
  const alphaDocument = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"alpha"}-->
#! Alpha

<!--hvy:text {"id":"alpha-note"}-->
 alpha implementation evidence
`, '.hvy');
  const betaDocument = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"beta"}-->
#! Beta

<!--hvy:text {"id":"beta-note"}-->
 beta accounting evidence
`, '.hvy');

  const expectedResult = await searchDocuments({
    query: 'implementation alpha',
    mode: 'embedding',
    embeddingProvider: makeDeterministicEmbeddingProvider(),
    documents: [
      { documentId: 'alpha-doc', documentTitle: 'Alpha Doc', document: alphaDocument },
      { documentId: 'beta-doc', documentTitle: 'Beta Doc', document: betaDocument },
    ],
    maxResults: 1,
  });

  expect(expectedResult.mode).toBe('embedding');
  expect(expectedResult.results).toHaveLength(1);
  expect(expectedResult.results[0]?.documentId).toBe('alpha-doc');
  expect(expectedResult.results[0]?.preview).toContain('alpha implementation evidence');
});

test('requestChatCompletion reports context preparation phases', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

#! Alpha

<!--hvy:text {"id":"alpha-note"}-->
 alpha facts live here
`, '.hvy');
  const client = {
    complete: vi.fn(async () => ({ output: 'Alpha answer.' })),
  };
  const expectedEvents: string[] = [];
  setHostChatClient(client);

  await requestChatCompletion({
    settings: { provider: 'openai', model: 'gpt-5-mini' },
    document,
    messages: [{ id: '1', role: 'user', content: 'What alpha facts exist?' }],
    chatContext: { mode: 'keyword-retrieval', maxResults: 1, maxContextChars: 1_200 },
    onContextPreparation: (event) => {
      expectedEvents.push(event.phase);
    },
  });

  expect(expectedEvents).toEqual(['preparing-context', 'context-ready']);
});

test('buildKeywordChatContext reuses the runtime index until document changes are marked', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

#! Generic

<!--hvy:text {"id":"alpha-note"}-->
 alpha facts
`, '.hvy');
  const cache = {
    getIndex: vi.fn(() => null),
    putIndex: vi.fn(),
  };
  const request = {
    document,
    question: 'alpha',
    messages: [],
    maxContextChars: 1_000,
    mode: 'qa' as const,
  };

  await buildKeywordChatContext(request, { mode: 'keyword-retrieval' }, cache);
  await buildKeywordChatContext(request, { mode: 'keyword-retrieval' }, cache);
  document.sections[0]!.blocks[0]!.text = 'beta facts';
  const staleResult = await buildKeywordChatContext({ ...request, question: 'beta' }, { mode: 'keyword-retrieval' }, cache);
  markKeywordChatContextDocumentChanged(document);
  const expectedResult = await buildKeywordChatContext({ ...request, question: 'beta' }, { mode: 'keyword-retrieval' }, cache);

  expect(staleResult.context).not.toContain('beta facts');
  expect(expectedResult.context).toContain('beta facts');
  expect(expectedResult.context).not.toContain('alpha facts');
  expect(cache.getIndex).toHaveBeenCalledTimes(1);
  expect(cache.putIndex).toHaveBeenCalledTimes(2);
});

test('prepareKeywordChatContext warms the first retrieval context build', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

#! Generic

<!--hvy:text {"id":"alpha-note"}-->
 alpha facts
`, '.hvy');
  const cache = {
    getIndex: vi.fn(() => null),
    putIndex: vi.fn(),
  };

  await prepareKeywordChatContext(document, cache);
  const expectedResult = await buildKeywordChatContext({
    document,
    question: 'alpha',
    messages: [],
    maxContextChars: 1_000,
    mode: 'qa',
  }, { mode: 'keyword-retrieval' }, cache);

  expect(expectedResult.context).toContain('alpha facts');
  expect(cache.getIndex).toHaveBeenCalledTimes(1);
  expect(cache.putIndex).toHaveBeenCalledTimes(1);
});

test('requestChatCompletion lets a custom chatContextProvider override default retrieval', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

#! Source

<!--hvy:text {}-->
 built-in source text
`, '.hvy');
  const client = {
    complete: vi.fn(async () => ({ output: 'Custom answer.' })),
  };
  setHostChatClient(client);

  await requestChatCompletion({
    settings: { provider: 'openai', model: 'gpt-5-mini' },
    document,
    messages: [{ id: '1', role: 'user', content: 'Question?' }],
    chatContext: { mode: 'keyword-retrieval', maxContextChars: 100 },
    chatContextProvider: {
      buildContext: (request) => ({
        context: 'custom-only context',
        budget: {
          maxContextChars: request.maxContextChars,
          usedContextChars: 'custom-only context'.length,
          truncated: false,
        },
      }),
    },
  });

  expect(client.complete.mock.calls[0]?.[0].context).toBe('custom-only context');
});

test('requestChatCompletion trims custom provider context before proxying', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

#! Source

<!--hvy:text {}-->
 source text
`, '.hvy');
  const client = {
    complete: vi.fn(async () => ({ output: 'Should not send.' })),
  };
  setHostChatClient(client);

  await requestChatCompletion({
    settings: { provider: 'openai', model: 'gpt-5-mini' },
    document,
    messages: [{ id: '1', role: 'user', content: 'Question?' }],
    chatContext: { maxContextChars: 5 },
    chatContextProvider: {
      buildContext: () => ({
        context: 'too long',
        budget: {
          maxContextChars: 5,
          usedContextChars: 'too long'.length,
          truncated: false,
        },
      }),
    },
  });
  expect(client.complete).toHaveBeenCalledTimes(1);
  expect(client.complete.mock.calls[0]?.[0].context).toHaveLength(5);
});

test('requestChatCompletion keeps full-document mode behavior', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

#! Summary

<!--hvy:text {}-->
 full document context text
`, '.hvy');
  const client = {
    complete: vi.fn(async () => ({ output: 'Full document answer.' })),
  };
  setHostChatClient(client);

  await requestChatCompletion({
    settings: { provider: 'openai', model: 'gpt-5-mini' },
    document,
    messages: [{ id: '1', role: 'user', content: 'Question?' }],
    chatContext: { mode: 'full-document' },
  });

  expect(client.complete.mock.calls[0]?.[0].context).toContain('full document context text');
});

test('requestChatCompletion errors when full-document context exceeds the configured cap', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

#! Summary

<!--hvy:text {}-->
 ${'full document context text '.repeat(20)}
`, '.hvy');
  const client = {
    complete: vi.fn(async () => ({ output: 'Trimmed answer.' })),
  };
  setHostChatClient(client);

  await expect(requestChatCompletion({
    settings: { provider: 'openai', model: 'gpt-5-mini' },
    document,
    messages: [{ id: '1', role: 'user', content: 'Question?' }],
    chatContext: { mode: 'full-document', maxContextChars: 120 },
  })).rejects.toThrow(/maximum is 120/);

  expect(client.complete).not.toHaveBeenCalled();
});

test('buildKeywordChatContext lazily builds, reuses, and incrementally updates when the document changes', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

#! Generic

<!--hvy:text {"id":"alpha-note"}-->
 alpha facts
`, '.hvy');
  const cache = {
    getIndex: vi.fn(() => null),
    putIndex: vi.fn(),
  };
  const request = {
    document,
    question: 'alpha',
    messages: [],
    maxContextChars: 1_000,
    mode: 'qa' as const,
  };

  await buildKeywordChatContext(request, { mode: 'keyword-retrieval' }, cache);
  await buildKeywordChatContext(request, { mode: 'keyword-retrieval' }, cache);
  document.sections[0]!.blocks[0]!.text = 'beta facts';
  markKeywordChatContextDocumentChanged(document);
  const expectedResult = await buildKeywordChatContext({ ...request, question: 'beta' }, { mode: 'keyword-retrieval' }, cache);

  expect(expectedResult.context).toContain('beta facts');
  expect(expectedResult.context).not.toContain('alpha facts');
  expect(cache.getIndex).toHaveBeenCalledTimes(1);
  expect(cache.putIndex).toHaveBeenCalledTimes(2);
});

test('buildKeywordChatContext can hydrate from host-supplied cached records', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
title: Cache Test
---

#! Source

<!--hvy:text {}-->
 source text
`, '.hvy');
  const snapshot: HvyChatSearchIndexSnapshot = {
    version: 1,
    records: [{
      key: 'cached:alpha',
      targetKind: 'block',
      sectionKey: document.sections[0]!.key,
      targetId: 'cached-alpha',
      label: 'Cached Alpha',
      tags: ['alpha'],
      description: 'Cached description',
      componentType: 'text',
      text: 'cached alpha evidence',
      documentOrder: 1,
    }],
  };
  const cache = {
    getIndex: vi.fn(() => snapshot),
    putIndex: vi.fn(),
  };

  const result = await buildKeywordChatContext({
    document,
    question: 'alpha',
    messages: [],
    maxContextChars: 1_000,
    mode: 'qa',
  }, { mode: 'keyword-retrieval' }, cache);

  expect(result.context).toContain('Cached Alpha');
  expect(result.context).toContain('cached alpha evidence');
  expect(cache.putIndex).not.toHaveBeenCalled();
});

test('buildKeywordChatContext strictly fits the context budget', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

#! Alpha

<!--hvy:text {"id":"alpha-note"}-->
 alpha ${'large '.repeat(200)}
`, '.hvy');

  const result = await buildKeywordChatContext({
    document,
    question: 'alpha',
    messages: [],
    maxContextChars: 160,
    mode: 'qa',
  }, { mode: 'keyword-retrieval', maxContextChars: 160 });

  expect(result.context.length).toBeLessThanOrEqual(160);
  expect(result.budget.usedContextChars).toBe(result.context.length);
  expect(result.budget.truncated).toBe(true);
});

test('buildKeywordChatContext matches derivational token forms such as educational to education', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"education","description":"Education","tags":"education"}-->
#! Education

<!--hvy:text {"id":"degree"}-->
 B.S. Computer Science

<!--hvy:text {"id":"institution"}-->
 University of Washington
`, '.hvy');

  const result = await buildKeywordChatContext({
    document,
    question: "What's their educational background?",
    messages: [],
    maxContextChars: 1_000,
    mode: 'qa',
  }, { mode: 'keyword-retrieval' });

  expect(result.context).toContain('Education');
  expect(result.context).toContain('University of Washington');
});

test('applyScoreGapCutoff cuts only at a clear adaptive score gap', () => {
  expect(applyScoreGapCutoff([
    { id: 'one', score: 100 },
    { id: 'two', score: 95 },
    { id: 'three', score: 90 },
    { id: 'four', score: 20 },
    { id: 'five', score: 18 },
  ])).toEqual([
    { id: 'one', score: 100 },
    { id: 'two', score: 95 },
    { id: 'three', score: 90 },
  ]);

  const expectedResultNoGap = [
    { id: 'one', score: 100 },
    { id: 'two', score: 82 },
    { id: 'three', score: 68 },
    { id: 'four', score: 55 },
  ];
  expect(applyScoreGapCutoff(expectedResultNoGap)).toEqual(expectedResultNoGap);
});

test('getEnvChatSettings prepopulates provider and model from vite env vars', () => {
  expect(
    getEnvChatSettings({
      VITE_HVY_CHAT_PROVIDER: 'anthropic',
      VITE_HVY_CHAT_MODEL: 'claude-custom',
      VITE_HVY_CHAT_COMPACTION_PROVIDER: 'openai',
      VITE_HVY_CHAT_COMPACTION_MODEL: 'gpt-5.4-nano',
    } as unknown as ImportMetaEnv)
  ).toEqual({
    provider: 'anthropic',
    model: 'claude-custom',
    compactionProvider: 'openai',
    compactionModel: 'gpt-5.4-nano',
  });
});

test('getEnvChatSettings exposes tool-loop compaction settings from vite env vars', () => {
  expect(
    getEnvChatSettings({
      VITE_HVY_CHAT_PROVIDER: 'openai',
      VITE_HVY_CHAT_MODEL: 'gpt-dev',
      VITE_HVY_CHAT_TOOL_LOOP_COMPACT_AFTER_MESSAGES: '12',
      VITE_HVY_CHAT_TOOL_LOOP_KEEP_RECENT_MESSAGES: '6',
      VITE_HVY_CHAT_TOOL_LOOP_LATEST_TOOL_RESULT_CONTEXT_CHARS: '9000',
      VITE_HVY_CHAT_TOOL_LOOP_TOOL_RESULT_CHAT_CHARS: '1200',
    } as unknown as ImportMetaEnv)
  ).toEqual({
    provider: 'openai',
    model: 'gpt-dev',
    compactionProvider: 'openai',
    compactionModel: 'gpt-5.4-nano',
    toolLoopCompaction: {
      compactAfterMessages: 12,
      keepRecentMessages: 6,
      latestToolResultContextChars: 9000,
      toolResultChatChars: 1200,
    },
  });
});

test('getEnvChatSettings falls back to provider-specific model and then built-in default', () => {
  expect(
    getEnvChatSettings({
      VITE_HVY_CHAT_PROVIDER: 'openai',
      VITE_OPENAI_MODEL: 'gpt-dev',
    } as ImportMetaEnv)
  ).toEqual({
    provider: 'openai',
    model: 'gpt-dev',
    compactionProvider: 'openai',
    compactionModel: 'gpt-5.4-nano',
  });

  expect(
    getEnvChatSettings({
      VITE_HVY_CHAT_PROVIDER: 'anthropic',
    } as ImportMetaEnv)
  ).toEqual({
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    compactionProvider: 'openai',
    compactionModel: 'gpt-5.4-nano',
  });
});

test('mergeChatSettings keeps env defaults when localStorage values are empty strings', () => {
  expect(
    mergeChatSettings(
      {
        provider: 'openai',
        model: '',
      },
      {
        provider: 'openai',
        model: 'gpt-5.4-mini',
        compactionProvider: 'openai',
        compactionModel: 'gpt-5.4-nano',
      }
    )
  ).toEqual({
    provider: 'openai',
    model: 'gpt-5.4-mini',
    compactionProvider: 'openai',
    compactionModel: 'gpt-5.4-nano',
  });
});

test('stopChatRequest aborts the current question and records the stop', () => {
  const chat = createDefaultChatState();
  const abortController = new AbortController();
  chat.isSending = true;
  chat.abortController = abortController;
  chat.error = 'Still working';

  expect(stopChatRequest(chat)).toBe(true);

  expect(abortController.signal.aborted).toBe(true);
  expect(chat.isSending).toBe(false);
  expect(chat.abortController).toBe(null);
  expect(chat.error).toBe(null);
  expect(chat.requestNonce).toBe(1);
  expect(chat.messages.at(-1)).toMatchObject({
    role: 'assistant',
    content: 'Stopped.',
    progress: true,
  });
});

test('closing the chat panel stops an in-flight question', () => {
  const chat = createDefaultChatState();
  const abortController = new AbortController();
  chat.panelOpen = true;
  chat.isSending = true;
  chat.abortController = abortController;

  closeChatPanel(chat);

  expect(chat.panelOpen).toBe(false);
  expect(abortController.signal.aborted).toBe(true);
  expect(chat.isSending).toBe(false);
});

test('toggling an open chat panel closes and stops the request', () => {
  const chat = createDefaultChatState();
  const abortController = new AbortController();
  chat.panelOpen = true;
  chat.isSending = true;
  chat.abortController = abortController;

  toggleChatPanelOpen(chat);

  expect(chat.panelOpen).toBe(false);
  expect(abortController.signal.aborted).toBe(true);
});

test('wrapChatResponseAsDocument injects chat response component defaults into front matter', () => {
  const wrapped = wrapChatResponseAsDocument(
    '<!--hvy:xref-card {"xrefTitle":"Heavy Stack","xrefDetail":"Project","xrefTarget":"heavy-stack"}-->'
  );
  const document = deserializeDocument(wrapped, '.hvy');

  expect(getDocumentComponentDefaultCss(document.meta, 'xref-card')).toBe('margin-top: 0.25rem; margin-bottom: 0.25rem;');
});

function makeDeterministicEmbeddingProvider(): HvyEmbeddingProvider {
  return (request) => request.inputs.map((input) => ({
    id: input.id,
    vector: getExpectedEmbeddingVector(input.text),
  }));
}

function getExpectedEmbeddingVector(text: string): number[] {
  const normalized = text.toLowerCase();
  if (normalized.includes('alpha') || normalized.includes('implementation')) {
    return [1, 0, 0];
  }
  if (normalized.includes('beta') || normalized.includes('accounting')) {
    return [0, 1, 0];
  }
  return [0, 0, 1];
}
