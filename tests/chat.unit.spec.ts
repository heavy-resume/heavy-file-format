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
import { applyScoreGapCutoff, buildKeywordChatContext } from '../src/chat/chat-context';
import { wrapChatResponseAsDocument } from '../src/chat/chat-response-document';
import { getDocumentComponentDefaultCss } from '../src/document-component-defaults';
import { deserializeDocument } from '../src/serialization';
import type { HvyChatSearchIndexSnapshot } from '../src/types';

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

test('buildKeywordChatContext lazily builds, reuses, and rebuilds when the document changes', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

#! Alpha

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
  await buildKeywordChatContext({ ...request, question: 'beta' }, { mode: 'keyword-retrieval' }, cache);

  expect(cache.getIndex).toHaveBeenCalledTimes(2);
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
