import { beforeEach, expect, test, vi } from 'vitest';

import { deserializeDocument } from '../src/serialization';
import { prepareEmbeddingChatContext } from '../src/chat/embedding-context';
import type { ChatMessage, ChatSettings, HvyEmbeddingProvider } from '../src/types';

const { requestProxyToolTurnMock } = vi.hoisted(() => ({
  requestProxyToolTurnMock: vi.fn(),
}));

vi.mock('../src/chat/chat', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/chat/chat')>(),
  requestProxyToolTurn: requestProxyToolTurnMock,
}));

beforeEach(() => {
  requestProxyToolTurnMock.mockReset();
});

const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
const openAiToolState = { provider: 'openai' as const, input: [] };

test('Viewer agent answers directly with full document context and preserved conversation history', async () => {
  const { runViewerAgent } = await import('../src/chat/viewer-agent');
  const messages: ChatMessage[] = [
    { id: 'u1', role: 'user', content: 'Do the choices introduce bias?' },
    { id: 'a1', role: 'assistant', content: 'Which choices do you mean?' },
    { id: 'u2', role: 'user', content: 'The ones in the document.' },
  ];
  requestProxyToolTurnMock.mockResolvedValue({
    output: 'The Agree and Disagree choices may encourage a binary response.',
    reasoningSummary: '',
    toolCalls: [],
    nativeMessages: [],
    toolState: openAiToolState,
  });

  const result = await runViewerAgent({
    settings,
    document: deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"questions"}-->
#! Questions

<!--hvy:text {"id":"choices"}-->
Agree or Disagree
`, '.hvy'),
    messages,
    question: 'The ones in the document.',
    chatContext: { mode: 'full-document' },
  });

  expect(result.answer).toContain('Agree and Disagree');
  expect(requestProxyToolTurnMock).toHaveBeenCalledWith(expect.objectContaining({
    mode: 'qa',
    messages,
    context: expect.stringContaining('Agree or Disagree'),
    tools: expect.arrayContaining([
      expect.objectContaining({ name: 'search_hvy_document' }),
      expect.objectContaining({ name: 'walk_hvy_document' }),
      expect.objectContaining({ name: 'inspect_hvy_path' }),
    ]),
  }));
});

test('Viewer agent uses embedding search and keeps the same cache prefix for the tool continuation', async () => {
  const { runViewerAgent } = await import('../src/chat/viewer-agent');
  const embeddingProvider: HvyEmbeddingProvider = vi.fn(async (request) =>
    request.inputs.map((input) => ({
      id: input.id,
      vector: input.id === 'query' || input.text.includes('FAKE_ORBITAL_LANGUAGE') ? [1, 0] : [0, 1],
    }))
  );
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"skills"}-->
#! Skills

<!--hvy:text {"id":"orbital"}-->
FAKE_ORBITAL_LANGUAGE
`, '.hvy');
  await prepareEmbeddingChatContext(document, { mode: 'embedding-retrieval' }, embeddingProvider);
  embeddingProvider.mockClear();
  requestProxyToolTurnMock
    .mockResolvedValueOnce({
      output: '',
      reasoningSummary: '',
      toolCalls: [{
        id: 'search-1',
        name: 'search_hvy_document',
        arguments: { query: 'FAKE_ORBITAL_LANGUAGE', limit: 5, cursor: null },
      }],
      nativeMessages: [{ type: 'function_call', call_id: 'search-1' }],
      toolState: openAiToolState,
    })
    .mockResolvedValueOnce({
      output: '',
      reasoningSummary: '',
      toolCalls: [{ id: 'answer-1', name: 'answer_user', arguments: { answer: 'The document mentions FAKE_ORBITAL_LANGUAGE.' } }],
      nativeMessages: [],
      toolState: openAiToolState,
    });

  const result = await runViewerAgent({
    settings,
    document,
    messages: [{ id: 'u1', role: 'user', content: 'Where is the orbital language mentioned?' }],
    question: 'Where is the orbital language mentioned?',
    chatContext: { mode: 'embedding-retrieval' },
    embeddingProvider,
  });

  expect(result.answer).toContain('FAKE_ORBITAL_LANGUAGE');
  expect(requestProxyToolTurnMock).toHaveBeenCalledTimes(2);
  const first = requestProxyToolTurnMock.mock.calls[0]?.[0];
  const second = requestProxyToolTurnMock.mock.calls[1]?.[0];
  expect(second.context).toBe(first.context);
  expect(second.systemInstructions).toBe(first.systemInstructions);
  expect(second.tools).toEqual(first.tools);
  const searchOutput = JSON.parse(second.toolState.input.at(-1).output);
  expect(searchOutput.mode).toBe('embeddings');
  expect(JSON.stringify(second.toolState)).toContain('/body/skills/orbital');
});

test('Viewer agent can exhaustively walk every page before answering', async () => {
  const { runViewerAgent } = await import('../src/chat/viewer-agent');
  requestProxyToolTurnMock
    .mockResolvedValueOnce({
      output: '',
      reasoningSummary: '',
      toolCalls: [{ id: 'walk-1', name: 'walk_hvy_document', arguments: { limit: 1, cursor: null } }],
      nativeMessages: [{ type: 'function_call', call_id: 'walk-1' }],
      toolState: openAiToolState,
    })
    .mockResolvedValueOnce({
      output: '',
      reasoningSummary: '',
      toolCalls: [{ id: 'walk-2', name: 'walk_hvy_document', arguments: { limit: 1, cursor: 'hvy-walk:1' } }],
      nativeMessages: [{ type: 'function_call', call_id: 'walk-2' }],
      toolState: { provider: 'openai', input: [{ prior: 'first page' }] },
    })
    .mockResolvedValueOnce({
      output: '',
      reasoningSummary: '',
      toolCalls: [{ id: 'answer-1', name: 'answer_user', arguments: { answer: 'I reviewed both visible items.' } }],
      nativeMessages: [],
      toolState: openAiToolState,
    });

  const result = await runViewerAgent({
    settings,
    document: deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"alpha"}-->
#! Alpha

<!--hvy:text {"id":"one"}-->
First item.

<!--hvy: {"id":"beta"}-->
#! Beta

<!--hvy:text {"id":"two"}-->
Second item.
`, '.hvy'),
    messages: [{ id: 'u1', role: 'user', content: 'Review every item for errors.' }],
    question: 'Review every item for errors.',
    chatContext: { mode: 'embedding-retrieval' },
  });

  expect(result.answer).toBe('I reviewed both visible items.');
  expect(JSON.stringify(requestProxyToolTurnMock.mock.calls[1]?.[0]?.toolState)).toContain('hvy-walk:1');
  expect(JSON.stringify(requestProxyToolTurnMock.mock.calls[2]?.[0]?.toolState)).toContain('Second item.');
});

test('Viewer tool surface has no document mutation capability', async () => {
  const { buildViewerAgentToolDefinitions } = await import('../src/chat/viewer-agent');
  const names = buildViewerAgentToolDefinitions().map((tool) => tool.name);

  expect(names).toEqual([
    'search_hvy_document',
    'walk_hvy_document',
    'inspect_hvy_path',
    'query_db_table',
    'answer_user',
  ]);
  expect(names).not.toContain('run_hvy_cli');
  expect(names).not.toContain('apply_hvy_patch');
});
