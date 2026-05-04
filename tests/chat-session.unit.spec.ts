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

  expect(requestChatCompletionMock).toHaveBeenCalledWith(expect.objectContaining({
    settings,
    document,
    messages: [
      messages[0],
      expect.objectContaining({
        role: 'user',
        content: 'What is HVY?',
      }),
    ],
  }));
  expect(result.error).toBeNull();
  expect(result.messages).toHaveLength(3);
  expect(result.messages[2]).toEqual(
    expect.objectContaining({
      role: 'assistant',
      content: 'HVY is a document format.',
    })
  );
});

test('requestChatTurn attaches token usage to assistant answers', async () => {
  requestChatCompletionMock.mockImplementation(async (params: { onTokenUsage?: (usage: { inputTokens?: number; outputTokens?: number }) => void }) => {
    params.onTokenUsage?.({ inputTokens: 42, outputTokens: 7 });
    return 'HVY is a document format.';
  });

  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n\n#! Summary\n', '.hvy');

  const result = await requestChatTurn({
    settings,
    document,
    messages: [],
    question: 'What is HVY?',
  });

  expect(result.error).toBeNull();
  expect(result.messages.at(-1)).toEqual(
    expect.objectContaining({
      role: 'assistant',
      content: 'HVY is a document format.',
      tokenUsage: { inputTokens: 42, outputTokens: 7 },
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
    .mockImplementationOnce(async (params: { onTokenUsage?: (usage: { inputTokens?: number; outputTokens?: number }) => void }) => {
      params.onTokenUsage?.({ inputTokens: 100, outputTokens: 10 });
      return 'hvy add section /body chores "Chores"';
    })
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
    'Token usage',
    '$ hvy add section /body chores "Chores"',
    '$ hvy add text /body/chores note "Weekly chore plan"',
    'Finished CLI edit loop.',
  ]);
  expect(onProgress.mock.calls[0]?.[0].tokenUsage).toEqual({ inputTokens: 100, outputTokens: 10 });
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]).toEqual(
    expect.objectContaining({
      settings,
      mode: 'document-edit',
      debugLabel: 'chat-cli-edit:1',
      context: expect.stringContaining('Valid commands:\nCommands: cd, pwd, ls, cat, head, tail, nl, find, rg, grep, sort, uniq, wc, tr, xargs, cp, rm, echo, sed, true, hvy. Ask: ask QUESTION. Finish: done SUMMARY.'),
      formatInstructions: expect.stringContaining('Return terminal command(s)'),
    })
  );
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).toContain('scratchpad.txt:');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).toContain('Task goal:\nAdd a chore section.');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).toContain('validate edits before recording completion');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).toContain('urgency:\nscore=0\nprioritize planning and understanding');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.messages).toEqual(expect.arrayContaining([
    expect.objectContaining({ role: 'assistant', content: '```shell\nls /\n```' }),
    expect.objectContaining({ role: 'user', content: expect.stringContaining('dir  attachments') }),
    expect.objectContaining({ role: 'assistant', content: '```shell\nhvy --help\n```' }),
    expect.objectContaining({ role: 'user', content: expect.stringContaining('hvy add section PARENT_PATH ID TITLE') }),
    expect.objectContaining({ role: 'assistant', content: '```shell\nhvy request_structure --collapse\n```' }),
    expect.objectContaining({ role: 'user', content: expect.stringContaining('Components:') }),
    expect.objectContaining({ role: 'assistant', content: '```shell\nhvy lint\n```' }),
    expect.objectContaining({ role: 'user', content: 'No lint issues.' }),
    expect.objectContaining({ role: 'assistant', content: '```shell\nhvy find-intent "Add a chore section." --max 5\n```' }),
    expect.objectContaining({ role: 'user', content: expect.stringContaining('What is your next command?') }),
  ]));
  expect(writeChatCliCommandTraceMock.mock.calls[0]).toEqual([
    'chat-cli-test',
    'ls /',
    expect.stringContaining('dir  body'),
    undefined,
  ]);
  expect(writeChatCliCommandTraceMock.mock.calls[1]).toEqual([
    'chat-cli-test',
    'hvy --help',
    expect.stringContaining('hvy add section PARENT_PATH ID TITLE'),
    undefined,
  ]);
  expect(writeChatCliCommandTraceMock.mock.calls[2]).toEqual([
    'chat-cli-test',
    'hvy request_structure --collapse',
    expect.stringContaining('Components:'),
    undefined,
  ]);
  expect(writeChatCliCommandTraceMock.mock.calls[3]).toEqual([
    'chat-cli-test',
    'hvy lint',
    'No lint issues.',
    undefined,
  ]);
  expect(writeChatCliCommandTraceMock.mock.calls[4]).toEqual([
    'chat-cli-test',
    'hvy find-intent "Add a chore section." --max 5',
    expect.stringContaining('No intent matches found'),
    undefined,
  ]);
  expect(result.messages.at(-1)).toEqual(expect.objectContaining({
    role: 'assistant',
    content: 'Created the chore section.',
  }));
});

test('requestDocumentEditChatTurn trims old cli conversation messages while keeping stable context', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce(`echo "${'x'.repeat(2500)}"`)
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
  expect(requestProxyCompletionMock.mock.calls[4]?.[0]?.messages.length).toBeGreaterThanOrEqual(10);
  expect(
    requestProxyCompletionMock.mock.calls[4]?.[0]?.messages.reduce((total: number, message: ChatMessage) => total + message.content.length, 0)
  ).toBeLessThanOrEqual(6000);
  expect(JSON.stringify(requestProxyCompletionMock.mock.calls[4]?.[0]?.messages)).not.toContain('x'.repeat(2500));
  expect(requestProxyCompletionMock.mock.calls[4]?.[0]?.context).toContain(
    'Valid commands:\nCommands: cd, pwd, ls, cat, head, tail, nl, find, rg, grep, sort, uniq, wc, tr, xargs, cp, rm, echo, sed, true, hvy. Ask: ask QUESTION. Finish: done SUMMARY.'
  );
  expect(requestProxyCompletionMock.mock.calls[4]?.[0]?.context).toContain('Task goal:\nCheck the document with several commands.');
  expect(requestProxyCompletionMock.mock.calls[4]?.[0]?.context).toContain('scratchpad.txt:');
  expect(requestProxyCompletionMock.mock.calls[4]?.[0]?.context).toContain('scratchpad.txt:\n');
});

test('requestDocumentEditChatTurn returns ask commands as clarification questions', async () => {
  requestProxyCompletionMock.mockResolvedValueOnce('ask Which section should I update?');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
  const onMutation = vi.fn();

  const result = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: [],
    request: 'Update the section.',
    onMutation,
  });

  expect(result.error).toBeNull();
  expect(result.messages.at(-1)).toEqual(expect.objectContaining({
    role: 'assistant',
    content: 'Which section should I update?',
  }));
  expect(onMutation).not.toHaveBeenCalled();
});

test('requestDocumentEditChatTurn keeps ask and answer history across clarification turns', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce('ask Should I duplicate skill-llm-prompt-engineering?')
    .mockResolvedValueOnce('done Added original LLM Tooling content.');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');

  const firstResult = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: [],
    request: 'Add a new skill, "LLM Tooling", and add it to top skills',
  });
  const secondResult = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: firstResult.messages,
    request: "No make up some stuff about LLM tooling and I'll fill it in later",
  });

  expect(secondResult.error).toBeNull();
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).toContain('Task goal:\nAdd a new skill, "LLM Tooling", and add it to top skills');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).not.toContain('Latest user reply:');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.slice(0, 3)).toEqual([
    expect.objectContaining({ role: 'user', content: 'Add a new skill, "LLM Tooling", and add it to top skills' }),
    expect.objectContaining({ role: 'assistant', content: 'Should I duplicate skill-llm-prompt-engineering?' }),
    expect.objectContaining({ role: 'user', content: "No make up some stuff about LLM tooling and I'll fill it in later" }),
  ]);
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

test('requestDocumentEditChatTurn runs multiple fenced shell blocks as a batch', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce('```shell\ncat /body/summary/long/text.txt\n```\n```shell\ncat /body/summary/long/text.txt\n```')
    .mockResolvedValueOnce('done Inspected the long text twice.');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"long"}-->
 ${Array.from({ length: 60 }, (_value, index) => `line ${index + 1}`).join('\n')}
`, '.hvy');
  const onProgress = vi.fn();

  const result = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: [],
    request: 'Inspect the long text twice.',
    onProgress,
  });

  expect(result.error).toBeNull();
  expect(onProgress.mock.calls.map((call) => call[0].content)).toEqual([
    '$ [1/2] cat /body/summary/long/text.txt',
    '$ [2/2] cat /body/summary/long/text.txt',
    'Finished CLI edit loop.',
  ]);
  const nextPrompt = requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.at(-1)?.content ?? '';
  expect(nextPrompt).toContain('> cat /body/summary/long/text.txt');
  expect(nextPrompt).toContain('Warning: output truncated to 50 of 60 wrapped lines (10 lines hidden).');
});

test('requestDocumentEditChatTurn ignores trailing done until a later standalone finish', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce(`\`\`\`shell
hvy add section /body chores "Chores"
\`\`\`

\`\`\`shell
hvy add text /body/chores note "Weekly chore plan"
\`\`\`

done Created the chore section.`)
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
    '$ [1/2] hvy add section /body chores "Chores"',
    '$ [2/2] hvy add text /body/chores note "Weekly chore plan"',
    'Finished CLI edit loop.',
  ]);
  const nextPrompt = requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.at(-1)?.content ?? '';
  expect(nextPrompt).toContain('What is your next command?');
  expect(nextPrompt.trimEnd()).toMatch(/What is your next command\?$/);
  expect(nextPrompt).toContain('/body/chores/note');
  expect(nextPrompt).toContain('### BEGIN your urgency ###\nscore=0\nprioritize planning and understanding');
  expect(result.messages.at(-1)).toEqual(expect.objectContaining({
    role: 'assistant',
    content: 'Created the chore section.',
  }));
});

test('requestDocumentEditChatTurn splits multiline shell blocks into separate commands', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce(`\`\`\`shell
# inspect obvious locations first
pwd
ls /body
cat /header.yaml
\`\`\``)
    .mockResolvedValueOnce('done Inspected initial locations.');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument('---\nhvy_version: 0.1\ntitle: Split Test\n---\n\n#! Summary\n', '.hvy');
  const onProgress = vi.fn();

  const result = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: [],
    request: 'Inspect with one multiline shell block.',
    onProgress,
  });

  expect(result.error).toBeNull();
  expect(onProgress.mock.calls.map((call) => call[0].content)).toEqual([
    '$ [1/3] pwd',
    '$ [2/3] ls /body',
    '$ [3/3] cat /header.yaml',
    'Finished CLI edit loop.',
  ]);
  const nextPrompt = requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.at(-1)?.content ?? '';
  expect(nextPrompt).toContain('> pwd\n/');
  expect(nextPrompt).toContain('> ls /body');
  expect(nextPrompt).toContain('> cat /header.yaml');
  expect(nextPrompt).not.toContain('# inspect obvious locations first');
});

test('requestDocumentEditChatTurn preserves heredoc shell commands while splitting surrounding lines', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce(`\`\`\`shell
pwd
cat > /scratchpad.txt <<'TXT'
Plan:
1. Inspect
2. Edit
TXT
cat /scratchpad.txt
\`\`\``)
    .mockResolvedValueOnce('done Wrote and read scratchpad.');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
  const onProgress = vi.fn();

  const result = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: [],
    request: 'Write a heredoc note.',
    onProgress,
  });

  expect(result.error).toBeNull();
  expect(onProgress.mock.calls.map((call) => call[0].content)).toEqual([
    '$ [1/3] pwd',
    "$ [2/3] cat > /scratchpad.txt <<'TXT'\nPlan:\n1. Inspect\n2. Edit\nTXT",
    '$ [3/3] cat /scratchpad.txt',
    'Finished CLI edit loop.',
  ]);
  const nextPrompt = requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.at(-1)?.content ?? '';
  expect(nextPrompt).toContain("> cat > /scratchpad.txt <<'TXT'\nPlan:\n1. Inspect\n2. Edit\nTXT\n/scratchpad.txt: written");
  expect(nextPrompt).toContain('> cat /scratchpad.txt\nPlan:\n1. Inspect\n2. Edit');
});

test('requestDocumentEditChatTurn divides batch output budget across three fenced shell blocks', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce('```shell\ncat /body/summary/long/text.txt\n```\n```shell\ncat /body/summary/long/text.txt\n```\n```shell\ncat /body/summary/long/text.txt\n```')
    .mockResolvedValueOnce('done Inspected the long text three times.');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"long"}-->
 ${Array.from({ length: 60 }, (_value, index) => `line ${index + 1}`).join('\n')}
`, '.hvy');
  const onProgress = vi.fn();

  const result = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: [],
    request: 'Inspect the long text three times.',
    onProgress,
  });

  expect(result.error).toBeNull();
  expect(onProgress.mock.calls.map((call) => call[0].content)).toEqual([
    '$ [1/3] cat /body/summary/long/text.txt',
    '$ [2/3] cat /body/summary/long/text.txt',
    '$ [3/3] cat /body/summary/long/text.txt',
    'Finished CLI edit loop.',
  ]);
  const nextPrompt = requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.at(-1)?.content ?? '';
  expect(nextPrompt.match(/Warning: output truncated to 33 of 60 wrapped lines \(27 lines hidden\)\./g)).toHaveLength(3);
});

test('requestDocumentEditChatTurn wraps long command output lines before returning them to the model', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce('cat /body/summary/long-line/text.txt')
    .mockResolvedValueOnce('done Inspected the long line.');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"long-line"}-->
 ${'a'.repeat(410)}wrapped-tail
`, '.hvy');

  const result = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: [],
    request: 'Inspect long line.',
  });

  expect(result.error).toBeNull();
  const nextPrompt = requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.at(-1)?.content ?? '';
  expect(nextPrompt).toContain('a'.repeat(400));
  expect(nextPrompt).toContain(`${'a'.repeat(10)}wrapped-tail`);
});

test('requestDocumentEditChatTurn includes component hints and scratchpad after component-path commands', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce('cat /body/summary/intro/text.txt')
    .mockResolvedValueOnce('done Inspected the text component.');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"intro"}-->
 Hello
`, '.hvy');

  const result = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: [],
    request: 'Inspect intro.',
  });

  expect(result.error).toBeNull();
  const nextPrompt = requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.at(-1)?.content ?? '';
  expect(nextPrompt).toContain('result\nHello');
  expect(nextPrompt).toContain('What is your next command?');
  expect(nextPrompt.trimEnd()).toMatch(/What is your next command\?$/);
  expect(nextPrompt).toContain('hints\ncomponent text: /body/summary/intro');
  expect(nextPrompt).toContain('You can act on it directly; you do not need to keep searching once this is the target.');
  expect(nextPrompt).toContain('text.txt is the component\'s visible/body text.');
  expect(nextPrompt).toContain('text.json is the component config.');
  expect(nextPrompt).toContain('If the task is to remove this component, run: hvy remove /body/summary/intro');
  expect(nextPrompt).toContain('Source files: /body/summary/intro/text.txt and /body/summary/intro/text.json');
  expect(nextPrompt).toContain('### BEGIN /scratchpad.txt  ###\nlast edited never\n\nYou havent written your plan yet.');
  expect(nextPrompt).toContain('### BEGIN your urgency ###\nscore=1\nprioritize planning and understanding');
  expect(nextPrompt).not.toContain('commands since last edit:');
  expect(writeChatCliCommandTraceMock).toHaveBeenCalledWith(
    'chat-cli-test',
    'cat /body/summary/intro/text.txt',
    'Hello',
    undefined,
    expect.stringContaining('hints\ncomponent text: /body/summary/intro')
  );
});

test('requestDocumentEditChatTurn includes lint diffs after commands change issues', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce('echo "Filled note" > /body/summary/empty-note/text.txt')
    .mockResolvedValueOnce('done Fixed the empty note.');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"empty-note"}-->
`, '.hvy');

  const result = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: [],
    request: 'Fix empty text.',
  });

  expect(result.error).toBeNull();
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.messages).toEqual(expect.arrayContaining([
    expect.objectContaining({ role: 'assistant', content: '```shell\nhvy lint\n```' }),
    expect.objectContaining({ role: 'user', content: expect.stringContaining('[text] /body/summary/empty-note - text body is empty.') }),
  ]));
  const nextPrompt = requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.at(-1)?.content ?? '';
  expect(nextPrompt).toContain('lint diff\n- [text] /body/summary/empty-note - text body is empty.');
});

test('requestDocumentEditChatTurn includes component-specific hints', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce('cat /body/dashboard/layout/grid.json')
    .mockResolvedValueOnce('done Inspected the grid component.');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"dashboard"}-->
#! Dashboard

<!--hvy:grid {"id":"layout","gridColumns":"1fr 1fr"}-->
<!--hvy:text {"id":"left"}-->
 Left
<!--hvy:text {"id":"right"}-->
 Right
`, '.hvy');

  const result = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: [],
    request: 'Inspect layout.',
  });

  expect(result.error).toBeNull();
  const nextPrompt = requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.at(-1)?.content ?? '';
  expect(nextPrompt).toContain('component grid: /body/dashboard/layout');
  expect(nextPrompt).toContain('Grid component: lays out child components visually like a CSS grid.');
  expect(nextPrompt).toContain('gridColumns is a number controlling the column layout.');
  expect(nextPrompt).toContain('Each numbered grid slot carries only slot metadata; the child block is nested one level deeper.');
});

test('requestDocumentEditChatTurn includes structure hints after search commands', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce('rg -n "TypeScript" /body')
    .mockResolvedValueOnce('done Found TypeScript references.');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:xref-card {"id":"typescript-card","xrefTitle":"TypeScript","xrefTarget":"tool-typescript"}-->
`, '.hvy');

  const result = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: [],
    request: 'Find TypeScript references.',
  });

  expect(result.error).toBeNull();
  const nextPrompt = requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.at(-1)?.content ?? '';
  expect(nextPrompt).toContain('Search result component structure:');
  expect(nextPrompt).toContain('Key: [x] text, [c] container');
  expect(nextPrompt).toContain('[r] xref-card.txt id=typescript-card');
  expect(nextPrompt).toContain('xrefTarget=tool-typescript');
  expect(nextPrompt).toContain('prefer `hvy remove /body/summary/typescript-card` over editing JSON text');
});

test('requestDocumentEditChatTurn includes registered plugin component hints', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce('cat /body/contact/contact-form/plugin.json')
    .mockResolvedValueOnce('done Inspected the form plugin.');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"contact"}-->
#! Contact

<!--hvy:plugin {"id":"contact-form","plugin":"dev.heavy.form","pluginConfig":{"version":"0.1"}}-->
submitLabel: Send
fields:
  - name: message
    label: Message
    type: textarea
`, '.hvy');

  const result = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: [],
    request: 'Inspect form plugin.',
  });

  expect(result.error).toBeNull();
  const nextPrompt = requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.at(-1)?.content ?? '';
  expect(nextPrompt).toContain('component plugin: /body/contact/contact-form');
  expect(nextPrompt).toContain('Plugin id: dev.heavy.form (form).');
  expect(nextPrompt).toContain('This plugin is a form.');
  expect(nextPrompt).toContain('The form fields, submit label, scripts, and on-submit behavior live in plugin.txt');
  expect(nextPrompt).toContain('Form scripts are top-level Python/Brython snippets');
});

test('requestDocumentEditChatTurn includes scripting plugin code hints', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce('cat /body/automation/startup-script/plugin.txt')
    .mockResolvedValueOnce('done Inspected the script plugin.');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"automation"}-->
#! Automation

<!--hvy:plugin {"id":"startup-script","plugin":"dev.heavy.scripting","pluginConfig":{"version":"0.1"}}-->
doc.header.set("ran_script", True)
`, '.hvy');

  const result = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: [],
    request: 'Inspect script plugin.',
  });

  expect(result.error).toBeNull();
  const nextPrompt = requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.at(-1)?.content ?? '';
  expect(nextPrompt).toContain('Plugin id: dev.heavy.scripting (scripting).');
  expect(nextPrompt).toContain('The component body is top-level Python/Brython source with one injected global: doc.');
  expect(nextPrompt).toContain('Document tools: request_structure, grep, view_component');
  expect(nextPrompt).toContain('doc.form exists only while running form plugin scripts.');
});

test('requestDocumentEditChatTurn sends recent chat as real messages for follow-up edit requests', async () => {
  requestProxyCompletionMock.mockResolvedValueOnce('done Checked follow-up context.');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');

  const result = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: [
      { id: 'u1', role: 'user', content: 'Remove Typescript from this resume' },
      { id: 'a1', role: 'assistant', content: 'Removed the TypeScript tool entry from the resume.' },
    ],
    request: 'remove it from the top skills, tools, and technologies too',
  });

  expect(result.error).toBeNull();
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).not.toContain('Recent chat context:');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.messages.slice(0, 3)).toEqual([
    expect.objectContaining({ role: 'user', content: 'Remove Typescript from this resume' }),
    expect.objectContaining({ role: 'assistant', content: 'Removed the TypeScript tool entry from the resume.' }),
    expect.objectContaining({ role: 'user', content: 'remove it from the top skills, tools, and technologies too' }),
  ]);
});

test('requestDocumentEditChatTurn keeps the original task goal through clarification replies', async () => {
  requestProxyCompletionMock.mockResolvedValueOnce('done Added the skill.');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');

  const result = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: [
      { id: 'u1', role: 'user', content: 'Add a new skill, "LLM Tooling", and add it to top skills' },
      { id: 'a1', role: 'assistant', content: 'Should the new "LLM Tooling" skill mirror the existing skill?' },
      { id: 'u2', role: 'user', content: "Completely new, make some stuff up and I'll fill it in" },
      { id: 'a2', role: 'assistant', content: 'Do you want a different summary/properties?' },
    ],
    request: 'yes different summary / properties',
  });

  expect(result.error).toBeNull();
  const context = requestProxyCompletionMock.mock.calls[0]?.[0]?.context ?? '';
  expect(context).toContain('Task goal:\nAdd a new skill, "LLM Tooling", and add it to top skills');
  expect(context).not.toContain('Latest user reply:');
  expect(context).not.toContain('Task goal:\nyes different summary / properties');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.messages.slice(0, 5)).toEqual([
    expect.objectContaining({ role: 'user', content: 'Add a new skill, "LLM Tooling", and add it to top skills' }),
    expect.objectContaining({ role: 'assistant', content: 'Should the new "LLM Tooling" skill mirror the existing skill?' }),
    expect.objectContaining({ role: 'user', content: "Completely new, make some stuff up and I'll fill it in" }),
    expect.objectContaining({ role: 'assistant', content: 'Do you want a different summary/properties?' }),
    expect.objectContaining({ role: 'user', content: 'yes different summary / properties' }),
  ]);
});

test('requestDocumentEditChatTurn treats prose and dangling fences as retryable format errors', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce('I need to see the body files to find the section.')
    .mockResolvedValueOnce('```shell')
    .mockResolvedValueOnce('done Recovered from bad formats.');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
  const onProgress = vi.fn();

  const result = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: [],
    request: 'Use command format.',
    onProgress,
  });

  expect(result.error).toBeNull();
  expect(onProgress.mock.calls.map((call) => call[0].content)).toEqual(['Finished CLI edit loop.']);
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.at(-1)?.content).toContain('Expected terminal command(s)');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.messages.at(-1)?.content).toContain('Expected terminal command(s)');
  expect(writeChatCliCommandTraceMock.mock.calls.map((call) => call[1])).toEqual(['ls /', 'hvy --help', 'hvy request_structure --collapse', 'hvy lint', 'hvy find-intent "Use command format." --max 5']);
});

test('requestDocumentEditChatTurn preserves multiline quoted shell commands', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce(`\`\`\`shell
echo "Plan:
1. Remove xref cards
2. Verify results
Progress: started" > /scratchpad.txt
\`\`\``)
    .mockResolvedValueOnce('done Wrote the plan.');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');

  const result = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: [],
    request: 'Write a multiline plan.',
  });

  expect(result.error).toBeNull();
  expect(writeChatCliCommandTraceMock.mock.calls[5]?.[1]).toContain('echo "Plan:\n1. Remove xref cards');
  expect(writeChatCliCommandTraceMock.mock.calls[5]?.[2]).toBe('/scratchpad.txt: written');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.at(-1)?.content).toContain('Plan:\n1. Remove xref cards');
});

test('requestDocumentEditChatTurn lets the cli edit loop retry after command errors', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce('hvy')
    .mockResolvedValueOnce('pwd')
    .mockResolvedValueOnce('done Recovered after checking the working directory.');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');

  const result = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: [],
    request: 'Run a command and recover if needed.',
  });

  expect(result.error).toBeNull();
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.at(-1)?.content).toContain(
    'result\nhvy: expected request_structure, find-intent, lint, add, plugin, section add, text add, table add, form add, or db-table show'
  );
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.at(-1)?.content).toContain(
    '### BEGIN your urgency ###\nscore=0\nprioritize planning and understanding'
  );
  expect(writeChatCliCommandTraceMock).toHaveBeenCalledWith(
    'chat-cli-test',
    'hvy',
    'hvy: expected request_structure, find-intent, lint, add, plugin, section add, text add, table add, form add, or db-table show',
    undefined,
    expect.stringContaining('result\nhvy: expected request_structure, find-intent, lint, add, plugin, section add, text add, table add, form add, or db-table show')
  );
});

test('requestDocumentEditChatTurn stops after repeated cli command errors', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce('not-a-command')
    .mockResolvedValueOnce('hvy')
    .mockResolvedValueOnce('cat missing.txt');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');

  const result = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: [],
    request: 'Keep making bad commands.',
  });

  expect(result.error).toContain('Stopped after 3 failed CLI commands. Last error: No such file: /missing.txt');
  expect(result.error).toContain('Did you mean?');
  expect(requestProxyCompletionMock).toHaveBeenCalledTimes(3);
  expect(writeChatCliCommandTraceMock.mock.calls.map((call) => call[2])).toEqual([
    expect.stringContaining('dir  body'),
    expect.stringContaining('hvy add section PARENT_PATH ID TITLE'),
    expect.stringContaining('Components:'),
    'No lint issues.',
    expect.any(String),
    'Unknown command "not-a-command". Try "help".',
    'hvy: expected request_structure, find-intent, lint, add, plugin, section add, text add, table add, form add, or db-table show',
    expect.stringContaining('No such file: /missing.txt'),
  ]);
});

test('requestDocumentEditChatTurn warns when scratchpad writes exceed the note limit', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce(`echo "${'x'.repeat(900)}" > scratchpad.txt`)
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
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.at(-1)?.content).toContain('scratchpad.txt is 800 characters');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.at(-1)?.content).toContain(
    'Rewrite scratchpad.txt shorter before adding more notes.'
  );
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).toContain('x'.repeat(800));
  expect(requestProxyCompletionMock.mock.calls[4]?.[0]?.context).toContain('short notes');
  expect(writeChatCliCommandTraceMock.mock.calls.map((call) => call[1])).toEqual([
    'ls /',
    'hvy --help',
    'hvy request_structure --collapse',
    'hvy lint',
    `hvy find-intent "Use a very long scratchpad." --max 5`,
    `echo "${'x'.repeat(900)}" > scratchpad.txt`,
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
