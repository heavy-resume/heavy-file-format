import { beforeEach, expect, test, vi } from 'vitest';

import { appendUserChatMessage, copyChatMessageToHvySection, requestChatTurn, requestDocumentEditChatTurn } from '../src/chat/chat-session';
import { deserializeDocument, serializeDocument } from '../src/serialization';
import type { ChatMessage, ChatSettings } from '../src/types';

const { requestChatCompletionMock, requestProxyCompletionMock, runQaToolLoopMock, writeChatCliCommandTraceMock } = vi.hoisted(() => ({
  requestChatCompletionMock: vi.fn(),
  requestProxyCompletionMock: vi.fn(),
  runQaToolLoopMock: vi.fn(),
  writeChatCliCommandTraceMock: vi.fn(),
}));

vi.mock('../src/chat/chat', () => ({
  requestChatCompletion: requestChatCompletionMock,
  requestProxyCompletion: requestProxyCompletionMock,
}));

vi.mock('../src/ai-qa', () => ({
  runQaToolLoop: runQaToolLoopMock,
}));

vi.mock('../src/chat-cli/chat-cli-dev-trace', () => ({
  createChatCliTraceRunId: () => 'chat-cli-test',
  writeChatCliUserQueryTrace: vi.fn(),
  writeChatCliCommandTrace: writeChatCliCommandTraceMock,
}));

beforeEach(() => {
  requestChatCompletionMock.mockReset();
  requestProxyCompletionMock.mockReset();
  runQaToolLoopMock.mockReset();
  writeChatCliCommandTraceMock.mockReset();
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

test('requestDocumentEditChatTurn runs the CLI edit loop for document chat', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce('hvy add section /body chores "Chores"')
    .mockResolvedValueOnce('```shell\nhvy add text /body/chores note "Weekly chore plan"\n```')
    .mockResolvedValueOnce('done Created the chore section.');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
  const onMutation = vi.fn();
  const onProgress = vi.fn();

  const result = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: [],
    request: 'Add a chore section.',
    onMutation,
    onProgress,
  });

  expect(result.error).toBeNull();
  expect(serializeDocument(document)).toContain('Weekly chore plan');
  expect(onMutation).toHaveBeenCalledWith('chat-cli');
  expect(onProgress.mock.calls.map((call) => call[0].content)).toEqual([
    '$ hvy add section /body chores "Chores"',
    '$ hvy add text /body/chores note "Weekly chore plan"',
    'Finished CLI edit loop.',
  ]);
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]).toEqual(
    expect.objectContaining({
      settings,
      mode: 'document-edit',
      debugLabel: 'chat-cli-edit:1',
      context: expect.stringContaining('Valid commands:\nCommands: cd, pwd, ls, cat, head, tail, nl, find, rg, rm, echo, sed, hvy.'),
      formatInstructions: expect.stringContaining('Return exactly one terminal command'),
    })
  );
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).toContain('scratchpad.txt:');
  expect(result.messages.at(-1)).toEqual(expect.objectContaining({
    role: 'assistant',
    content: 'Created the chore section.',
  }));
});

test('requestDocumentEditChatTurn trims old cli conversation messages and keeps scratchpad progress', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce(`echo "${'x'.repeat(700)}"`)
    .mockResolvedValueOnce('pwd')
    .mockResolvedValueOnce('pwd')
    .mockResolvedValueOnce('pwd')
    .mockResolvedValueOnce('done Checked the document.');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');

  const result = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: [],
    request: 'Check the document with several commands.',
  });

  expect(result.error).toBeNull();
  expect(requestProxyCompletionMock.mock.calls[4]?.[0]?.messages.length).toBeGreaterThanOrEqual(5);
  expect(
    requestProxyCompletionMock.mock.calls[4]?.[0]?.messages.reduce((total: number, message: ChatMessage) => total + message.content.length, 0)
  ).toBeLessThanOrEqual(500);
  expect(JSON.stringify(requestProxyCompletionMock.mock.calls[4]?.[0]?.messages)).not.toContain('x'.repeat(700));
  expect(requestProxyCompletionMock.mock.calls[4]?.[0]?.context).toContain(
    'Valid commands:\nCommands: cd, pwd, ls, cat, head, tail, nl, find, rg, rm, echo, sed, hvy.'
  );
  expect(requestProxyCompletionMock.mock.calls[4]?.[0]?.context).toContain('scratchpad.txt:');
  expect(requestProxyCompletionMock.mock.calls[4]?.[0]?.context).toContain('ran: pwd -> /');
});

test('requestDocumentEditChatTurn accepts shell-looking command wrappers', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce('`ls /`')
    .mockResolvedValueOnce('```shell\nls /body```')
    .mockResolvedValueOnce('/ $ pwd')
    .mockResolvedValueOnce('done Checked shell wrappers.');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
  const onProgress = vi.fn();

  const result = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: [],
    request: 'Check shell command wrappers.',
    onProgress,
  });

  expect(result.error).toBeNull();
  expect(onProgress.mock.calls.map((call) => call[0].content)).toEqual([
    '$ ls /',
    '$ ls /body',
    '$ pwd',
    'Finished CLI edit loop.',
  ]);
});

test('requestDocumentEditChatTurn logs failed cli commands before returning the error', async () => {
  requestProxyCompletionMock.mockResolvedValueOnce('not-a-command');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');

  const result = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: [],
    request: 'Run a bad command.',
  });

  expect(result.error).toBe('Unknown command "not-a-command". Try "help".');
  expect(writeChatCliCommandTraceMock).toHaveBeenCalledWith(
    'chat-cli-test',
    'not-a-command',
    'Unknown command "not-a-command". Try "help".',
    undefined
  );
});

test('requestDocumentEditChatTurn blocks non-scratchpad commands until long scratchpad is reduced', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce(`echo "${'x'.repeat(700)}" > scratchpad.txt`)
    .mockResolvedValueOnce('pwd')
    .mockResolvedValueOnce('echo "short notes" > scratchpad.txt')
    .mockResolvedValueOnce('pwd')
    .mockResolvedValueOnce('done Reduced scratchpad and checked cwd.');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');

  const result = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: [],
    request: 'Use a very long scratchpad.',
  });

  expect(result.error).toBeNull();
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.messages.at(-1)?.content).toContain('scratchpad.txt is 600 characters');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.messages.at(-1)?.content).toContain('Reduce scratchpad.txt before running other commands.');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.context).toContain('x'.repeat(600));
  expect(requestProxyCompletionMock.mock.calls[4]?.[0]?.context).toContain('short notes');
  expect(writeChatCliCommandTraceMock.mock.calls.map((call) => call[1])).toEqual([
    `echo "${'x'.repeat(700)}" > scratchpad.txt`,
    'pwd',
    'echo "short notes" > scratchpad.txt',
    'pwd',
  ]);
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
