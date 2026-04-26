import { beforeEach, expect, test, vi } from 'vitest';

import { appendUserChatMessage, copyChatMessageToHvySection, requestChatTurn } from '../src/chat/chat-session';
import { deserializeDocument } from '../src/serialization';
import type { ChatMessage, ChatSettings } from '../src/types';

const { requestChatCompletionMock, runQaToolLoopMock } = vi.hoisted(() => ({
  requestChatCompletionMock: vi.fn(),
  runQaToolLoopMock: vi.fn(),
}));

vi.mock('../src/chat/chat', () => ({
  requestChatCompletion: requestChatCompletionMock,
}));

vi.mock('../src/ai-qa', () => ({
  runQaToolLoop: runQaToolLoopMock,
}));

beforeEach(() => {
  requestChatCompletionMock.mockReset();
  runQaToolLoopMock.mockReset();
});

const DOC_WITH_DB_TABLE = `---
hvy_version: 0.1
---

<!--hvy: {"id":"data"}-->
#! Data

 <!--hvy:plugin {"plugin":"dev.heavy.db-table","pluginConfig":{"source":"with-file","table":"work_items"}}-->
`;

test('appendUserChatMessage appends a new user message', () => {
  const messages: ChatMessage[] = [{ id: '1', role: 'assistant', content: 'Hello' }];

  const result = appendUserChatMessage(messages, 'What is HVY?');

  expect(result).toHaveLength(2);
  expect(result[0]).toEqual(messages[0]);
  expect(result[1]?.role).toBe('user');
  expect(result[1]?.content).toBe('What is HVY?');
  expect(result[1]?.id).toEqual(expect.any(String));
});

test('requestChatTurn returns assistant answer on success', async () => {
  requestChatCompletionMock.mockResolvedValue('HVY is a document format.');

  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n\n#! Summary\n', '.hvy');
  const messages: ChatMessage[] = [{ id: '1', role: 'assistant', content: 'Earlier answer' }];

  const result = await requestChatTurn({
    settings,
    document,
    messages,
    question: 'What is HVY?',
  });

  expect(requestChatCompletionMock).toHaveBeenCalledWith({
    settings,
    document,
    messages: [
      messages[0],
      expect.objectContaining({
        role: 'user',
        content: 'What is HVY?',
      }),
    ],
  });
  expect(result.error).toBeNull();
  expect(result.messages).toHaveLength(3);
  expect(result.messages[2]).toEqual(
    expect.objectContaining({
      role: 'assistant',
      content: 'HVY is a document format.',
    })
  );
});

test('requestChatTurn routes through runQaToolLoop when the document has DB tables', async () => {
  runQaToolLoopMock.mockResolvedValue('Tool-loop answer.');

  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument(DOC_WITH_DB_TABLE, '.hvy');

  const result = await requestChatTurn({
    settings,
    document,
    messages: [],
    question: 'How many rows?',
  });

  expect(runQaToolLoopMock).toHaveBeenCalledTimes(1);
  expect(requestChatCompletionMock).not.toHaveBeenCalled();
  expect(result.error).toBeNull();
  expect(result.messages[1]).toEqual(
    expect.objectContaining({ role: 'assistant', content: 'Tool-loop answer.' })
  );
});

test('requestChatTurn returns assistant error message on failure', async () => {
  requestChatCompletionMock.mockRejectedValue(new Error('Proxy unavailable.'));

  const settings: ChatSettings = { provider: 'anthropic', model: 'claude-sonnet-4-6' };
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n\n#! Summary\n', '.hvy');

  const result = await requestChatTurn({
    settings,
    document,
    messages: [],
    question: 'Summarize this.',
  });

  expect(result.error).toBe('Proxy unavailable.');
  expect(result.messages).toHaveLength(2);
  expect(result.messages[0]).toEqual(
    expect.objectContaining({
      role: 'user',
      content: 'Summarize this.',
    })
  );
  expect(result.messages[1]).toEqual(
    expect.objectContaining({
      role: 'assistant',
      content: 'Proxy unavailable.',
      error: true,
    })
  );
});

test('copyChatMessageToHvySection wraps a plain markdown answer into a section', () => {
  const messages: ChatMessage[] = [
    { id: 'm1', role: 'user', content: 'What jobs?' },
    { id: 'm2', role: 'assistant', content: 'Northwind Labs is in Phone screen.' },
  ];

  const result = copyChatMessageToHvySection({ messages, messageId: 'm2' });

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.section.title).toBe('AI response');
  expect(result.section.blocks.length).toBeGreaterThan(0);
  expect(result.section.blocks[0]?.text).toContain('Northwind Labs is in Phone screen.');
});

test('copyChatMessageToHvySection preserves markdown tables with pipe characters', () => {
  const tableContent = 'Here are the rows:\n\n| Company | Status |\n| --- | --- |\n| Acme | Open |\n| Globex | Done |';
  const messages: ChatMessage[] = [
    { id: 'm1', role: 'assistant', content: tableContent },
  ];

  const result = copyChatMessageToHvySection({ messages, messageId: 'm1' });

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const sectionText = result.section.blocks.map((block) => block.text).join('\n');
  expect(sectionText).toContain('Acme');
  expect(sectionText).toContain('Globex');
});

test('copyChatMessageToHvySection rejects non-existent message ids', () => {
  const messages: ChatMessage[] = [
    { id: 'm1', role: 'assistant', content: 'Hello' },
  ];

  const result = copyChatMessageToHvySection({ messages, messageId: 'missing' });

  expect(result).toEqual({ ok: false, error: 'Message not found.' });
});

test('copyChatMessageToHvySection rejects user messages', () => {
  const messages: ChatMessage[] = [
    { id: 'm1', role: 'user', content: 'Hello' },
  ];

  const result = copyChatMessageToHvySection({ messages, messageId: 'm1' });

  expect(result.ok).toBe(false);
  if (result.ok !== false) return;
  expect(result.error).toMatch(/assistant/i);
});

test('copyChatMessageToHvySection rejects errored assistant messages', () => {
  const messages: ChatMessage[] = [
    { id: 'm1', role: 'assistant', content: 'Proxy unavailable.', error: true },
  ];

  const result = copyChatMessageToHvySection({ messages, messageId: 'm1' });

  expect(result.ok).toBe(false);
});

test('copyChatMessageToHvySection rejects empty content', () => {
  const messages: ChatMessage[] = [
    { id: 'm1', role: 'assistant', content: '   \n  ' },
  ];

  const result = copyChatMessageToHvySection({ messages, messageId: 'm1' });

  expect(result.ok).toBe(false);
  if (result.ok !== false) return;
  expect(result.error).toMatch(/no content/i);
});

test('copyChatMessageToHvySection rejects content containing a top-level section directive', () => {
  const hvyContent = '<!--hvy: {"id":"inner"}-->\n#! Inner\n\n <!--hvy:text {}-->\n  Body';
  const messages: ChatMessage[] = [
    { id: 'm1', role: 'assistant', content: hvyContent },
  ];

  const result = copyChatMessageToHvySection({ messages, messageId: 'm1' });

  expect(result.ok).toBe(false);
  if (result.ok !== false) return;
  expect(result.error).toMatch(/single HVY section/i);
});

test('copyChatMessageToHvySection uses the supplied title and section id', () => {
  const messages: ChatMessage[] = [
    { id: 'm1', role: 'assistant', content: 'Body text.' },
  ];

  const result = copyChatMessageToHvySection({
    messages,
    messageId: 'm1',
    sectionIdSeed: 'custom-id',
    title: 'Custom title',
  });

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.section.customId).toBe('custom-id');
  expect(result.section.title).toBe('Custom title');
});
