import { beforeEach, expect, test, vi } from 'vitest';

import { advanceDocumentEditCliSimStep, appendUserChatMessage, buildDocumentEditCliSimRequest, copyChatMessageToHvySection, requestChatTurn, requestDocumentEditChatTurn } from '../src/chat/chat-session';
import { deserializeDocument, serializeDocument } from '../src/serialization';
import type { ChatMessage, ChatSettings } from '../src/types';

const { requestChatCompletionMock, requestProxyCompletionMock, runQaToolLoopMock, writeChatCliCommandTraceMock, writeChatCliUserQueryTraceMock } = vi.hoisted(() => ({
  requestChatCompletionMock: vi.fn(),
  requestProxyCompletionMock: vi.fn(),
  runQaToolLoopMock: vi.fn(),
  writeChatCliCommandTraceMock: vi.fn(),
  writeChatCliUserQueryTraceMock: vi.fn(),
}));

vi.mock('../src/chat/chat', () => ({
  DEFAULT_OPENAI_COMPACTION_MODEL: 'gpt-5.4-nano',
  buildProxyChatRequest: (request: {
    messages: ChatMessage[];
    systemInstructions?: string;
  } & Record<string, unknown>) => {
    const { systemInstructions, ...rest } = request;
    return {
      ...rest,
      messages: [
        ...(systemInstructions?.trim()
          ? [{ id: 'system', role: 'system', content: systemInstructions.trim() }]
          : []),
        ...request.messages,
      ],
    };
  },
  requestChatCompletion: requestChatCompletionMock,
  requestProxyCompletion: requestProxyCompletionMock,
}));

vi.mock('../src/ai-qa', () => ({
  runQaToolLoop: runQaToolLoopMock,
}));

vi.mock('../src/chat-cli/chat-cli-dev-trace', () => ({
  createChatCliTraceRunId: () => 'chat-cli-test',
  writeChatCliUserQueryTrace: writeChatCliUserQueryTraceMock,
  writeChatCliCommandTrace: writeChatCliCommandTraceMock,
}));

beforeEach(() => {
  requestChatCompletionMock.mockReset();
  requestProxyCompletionMock.mockReset();
  runQaToolLoopMock.mockReset();
  writeChatCliCommandTraceMock.mockReset();
  writeChatCliUserQueryTraceMock.mockReset();
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

test('requestChatTurn refuses document changes in viewer mode without calling the provider', async () => {
  requestChatCompletionMock.mockResolvedValue('Should not be called.');

  const result = await requestChatTurn({
    settings: { provider: 'openai', model: 'gpt-5-mini' },
    document: deserializeDocument('---\nhvy_version: 0.1\n---\n\n#! Summary\n', '.hvy'),
    messages: [],
    question: 'Add a new skills section to this resume',
  });

  expect(result.error).toBeNull();
  expect(result.messages.at(-1)?.content).toBe('I can’t change the document from Viewer mode. Switch to AI mode or Editor mode to make changes.');
  expect(requestChatCompletionMock).not.toHaveBeenCalled();
  expect(runQaToolLoopMock).not.toHaveBeenCalled();
});

test('requestChatTurn refuses DB-backed viewer change requests before QA routing', async () => {
  runQaToolLoopMock.mockResolvedValue('Should not be called.');

  const result = await requestChatTurn({
    settings: { provider: 'openai', model: 'gpt-5-mini' },
    document: deserializeDocument(DOC_WITH_DB_TABLE, '.hvy'),
    messages: [],
    question: 'Can you finish rigging up the Assign Chore and Complete Chore forms?',
  });

  expect(result.error).toBeNull();
  expect(result.messages.at(-1)?.content).toBe('I can’t change the document from Viewer mode. Switch to AI mode or Editor mode to make changes.');
  expect(requestChatCompletionMock).not.toHaveBeenCalled();
  expect(runQaToolLoopMock).not.toHaveBeenCalled();
});

test('requestChatTurn still answers informational viewer questions about changes', async () => {
  requestChatCompletionMock.mockResolvedValue('Use AI mode to edit.');

  const result = await requestChatTurn({
    settings: { provider: 'openai', model: 'gpt-5-mini' },
    document: deserializeDocument('---\nhvy_version: 0.1\n---\n\n#! Summary\n', '.hvy'),
    messages: [],
    question: 'How do I change the title?',
  });

  expect(result.error).toBeNull();
  expect(result.messages.at(-1)?.content).toBe('Use AI mode to edit.');
  expect(requestChatCompletionMock).toHaveBeenCalledOnce();
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
      return 'hvy append-child section /body chores "Chores"';
    })
    .mockResolvedValueOnce('```shell\nhvy append-child text /body/chores note "Weekly chore plan"\n```')
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
    '$ hvy append-child section /body chores "Chores"',
    '$ hvy append-child text /body/chores note "Weekly chore plan"',
  ]);
  expect(onProgress.mock.calls[0]?.[0].work?.tokenUsage).toEqual({ inputTokens: 100, outputTokens: 10 });
  expect(result.messages.at(-1)?.work?.status).toBe('done');
  expect(result.messages.at(-1)?.work?.details).toEqual([
    '$ hvy append-child section /body chores "Chores"',
    '$ hvy append-child text /body/chores note "Weekly chore plan"',
  ]);
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]).toEqual(
    expect.objectContaining({
      settings,
      mode: 'document-edit',
      debugLabel: 'chat-cli-edit:1',
      context: expect.stringContaining('Current request:\nAdd a chore section.'),
      systemInstructions: expect.stringContaining('Valid commands (in order of preference):\nCommands: hvy, nl, rg, find, sed, echo, cat, ls, pwd, cd, cp, rm, grep, sort, uniq, wc, tr, xargs, head, tail, true. Ask: ask QUESTION. Finish: done MESSAGE_TO_USER.'),
    })
  );
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.systemInstructions).toContain('Response instructions:\nWhen continuing, return concise notes plus terminal command(s).');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.systemInstructions).toContain('validation, then done');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.systemInstructions).toContain('run `ask QUESTION` as the only command');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).toContain('Current request:\nAdd a chore section.');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).not.toContain('Use the chronological chat messages and terminal results to infer the active task.');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).not.toContain('Valid commands (in order of preference):');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).not.toContain('Persistent instructions:');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).not.toContain('scratchpad.txt:');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).not.toContain('urgency:\nscore=0\nprioritize planning and understanding');
  const firstMessages = requestProxyCompletionMock.mock.calls[0]?.[0]?.messages;
  expect(firstMessages).toEqual([
    expect.objectContaining({ role: 'user', content: 'Add a chore section.' }),
    expect.objectContaining({ role: 'assistant', content: expect.stringContaining('```shell\nls /\n```') }),
    expect.objectContaining({ role: 'user', content: expect.stringContaining('dir  attachments') }),
    expect.objectContaining({ role: 'assistant', content: expect.stringContaining('```shell\nhvy --help\n```') }),
    expect.objectContaining({ role: 'user', content: expect.stringContaining('Recipes:\n- db-and-form\n- form-backed-table\n- populate-form-options-from-db\n- scripting') }),
    expect.objectContaining({ role: 'assistant', content: expect.stringContaining('```shell\nhvy request_structure --collapse\n```') }),
    expect.objectContaining({ role: 'user', content: expect.stringContaining('Components:') }),
    expect.objectContaining({ role: 'assistant', content: expect.stringContaining('```shell\nhvy lint\n```') }),
    expect.objectContaining({ role: 'user', content: '### CMD RESULT ###\nNo lint issues.\n### END CMD RESULT ###' }),
    expect.objectContaining({ role: 'assistant', content: expect.stringContaining('```shell\nhvy find-intent "Add a chore section." --max 5\n```') }),
    expect.objectContaining({ role: 'user', content: expect.stringContaining('Next response: Write concise What / Why / Unsure of') }),
  ]);
  expect(firstMessages?.at(-1)?.role).toBe('user');
  expect(firstMessages?.at(-1)?.content).toContain('Current directory: /');
  expect(firstMessages?.at(-1)?.content).toContain('### BEGIN /scratchpad.txt  ###\nlast edited never\n\nYou havent written your plan yet.');
  expect(firstMessages?.at(-1)?.content.trim().endsWith('or run ask QUESTION, or run done MESSAGE_TO_USER.')).toBe(true);
  expect(writeChatCliUserQueryTraceMock.mock.calls[0]).toEqual(['chat-cli-test', 'Add a chore section.', undefined]);
  expect(writeChatCliCommandTraceMock.mock.calls[0]).toEqual([
    'chat-cli-test',
    'ls /',
    expect.stringContaining('dir  body'),
    undefined,
  ]);
  expect(writeChatCliCommandTraceMock.mock.calls[1]).toEqual([
    'chat-cli-test',
    'hvy --help',
    expect.stringContaining('Cheatsheets:\n- components\n- db-table\n- forms\n- scripting'),
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

test('requestDocumentEditChatTurn includes document ai context in the CLI prompt', async () => {
  requestProxyCompletionMock.mockResolvedValueOnce('done Read the context.');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument(`---
hvy_version: 0.1
ai-context: The top skills grid is the featured skills surface; the skills section is the library.
---

<!--hvy: {"id":"skills"}-->
#! Skills

<!--hvy:text {"id":"intro"}-->
Hello
`, '.hvy');

  await requestDocumentEditChatTurn({
    settings,
    document,
    messages: [],
    request: 'Add baking as a top skill.',
  });

  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).toContain(
    'Document context:\nThe top skills grid is the featured skills surface; the skills section is the library.'
  );
});

test('buildDocumentEditCliSimRequest exposes the exact provider-facing CLI request payload', async () => {
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');

  const result = await buildDocumentEditCliSimRequest({
    settings,
    document,
    messages: [],
    request: 'Add a chore section.',
  });
  const payload = JSON.parse(result.requestJson) as {
    model: string;
    input: Array<{ role: string; content: Array<{ text: string; type: string }> }>;
  };

  expect(payload).toEqual(expect.objectContaining({
    model: 'gpt-5-mini',
  }));
  expect(payload).not.toHaveProperty('provider');
  expect(payload).not.toHaveProperty('mode');
  expect(payload).not.toHaveProperty('context');
  expect(payload).not.toHaveProperty('messages');
  expect(payload).not.toHaveProperty('responseInstructions');
  expect(payload).not.toHaveProperty('systemInstructions');
  expect(payload.input).toEqual([
    expect.objectContaining({ role: 'system', content: [expect.objectContaining({ text: expect.stringContaining('Response instructions:\nWhen continuing, return concise notes plus terminal command(s).') })] }),
    expect.objectContaining({ role: 'user', content: [expect.objectContaining({ text: expect.stringContaining('Request context:\n\nCurrent request:\nAdd a chore section.') })] }),
    expect.objectContaining({ role: 'user', content: [expect.objectContaining({ text: 'Add a chore section.' })] }),
    expect.objectContaining({ role: 'assistant', content: [expect.objectContaining({ text: expect.stringContaining('```shell\nls /\n```') })] }),
    expect.objectContaining({ role: 'user', content: [expect.objectContaining({ text: expect.stringContaining('dir  body') })] }),
    expect.objectContaining({ role: 'assistant', content: [expect.objectContaining({ text: expect.stringContaining('```shell\nhvy --help\n```') })] }),
    expect.objectContaining({ role: 'user', content: [expect.objectContaining({ text: expect.stringContaining('hvy append-child section PARENT_PATH ID TITLE') })] }),
    expect.objectContaining({ role: 'assistant', content: [expect.objectContaining({ text: expect.stringContaining('```shell\nhvy request_structure --collapse\n```') })] }),
    expect.objectContaining({ role: 'user', content: [expect.objectContaining({ text: expect.stringContaining('Components:') })] }),
    expect.objectContaining({ role: 'assistant', content: [expect.objectContaining({ text: expect.stringContaining('```shell\nhvy lint\n```') })] }),
    expect.objectContaining({ role: 'user', content: [expect.objectContaining({ text: '### CMD RESULT ###\nNo lint issues.\n### END CMD RESULT ###' })] }),
    expect.objectContaining({ role: 'assistant', content: [expect.objectContaining({ text: expect.stringContaining('```shell\nhvy find-intent "Add a chore section." --max 5\n```') })] }),
    expect.objectContaining({ role: 'user', content: [expect.objectContaining({ text: expect.stringContaining('Next response: Write concise What / Why / Unsure of') })] }),
  ]);
  expect(payload.input.at(-1)?.content[0]?.text).toContain('### BEGIN /scratchpad.txt  ###\nlast edited never\n\nYou havent written your plan yet.');
  expect(payload.input.at(-1)?.content[0]?.text.trim().endsWith('or run ask QUESTION, or run done MESSAGE_TO_USER.')).toBe(true);
  expect(result.requestJson).toContain('```shell\\nls /\\n```');
  expect(writeChatCliCommandTraceMock).not.toHaveBeenCalled();
  expect(writeChatCliUserQueryTraceMock).not.toHaveBeenCalled();
});

test('advanceDocumentEditCliSimStep executes the response and prepares the next chronological request payload', async () => {
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
  const initial = await buildDocumentEditCliSimRequest({
    settings,
    document,
    messages: [],
    request: 'Inspect the document.',
  });

  const result = await advanceDocumentEditCliSimStep({
    settings,
    document,
    turnState: initial.turnState,
    assistantOutput: 'What you are doing: checking location\nWhy you are doing it: verify context\nWhat you are unsure of: nothing\n```shell\npwd\n```',
  });
  const payload = JSON.parse(result.requestJson) as { input: Array<{ role: string; content: Array<{ text: string }> }> };

  expect(result.commandResultMessage).toContain('CMD: pwd\n### CMD RESULT ###\n/');
  expect(result.commandResultMessage).toContain('### DIAGNOSTICS CHANGES FROM THIS COMMAND ###\n(no changes)\n### END DIAGNOSTICS CHANGES FROM THIS COMMAND ###');
  expect(result.commandResultMessage).not.toContain('sim mode');
  expect(payload.input).not.toContainEqual(expect.objectContaining({
    role: 'assistant',
    content: [expect.objectContaining({ text: expect.stringContaining('```shell\npwd\n```') })],
  }));
  expect(payload.input.at(-1)).toEqual(expect.objectContaining({
    role: 'user',
    content: [expect.objectContaining({ text: expect.stringContaining('Next response: Write concise What / Why / Unsure of') })],
  }));
});

test('requestDocumentEditChatTurn can focus the CLI loop on a selected component', async () => {
  requestProxyCompletionMock.mockResolvedValueOnce('done Updated the selected component.');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary","description":"Summary section guidance."}-->
#! Summary

<!--hvy:text {"id":"intro","description":"Opening paragraph."}-->
Hello world
`, '.hvy');

  const result = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: [],
    request: 'Make this warmer.',
    selectedComponent: {
      path: '/body/summary/intro',
      sectionTitle: 'Summary',
      component: 'text',
      baseComponent: 'text',
      schemaId: 'intro',
    },
  });

  expect(result.error).toBeNull();
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).toContain('Selected component focus:');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).toContain('Path: /body/summary/intro');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).toContain('Parent path: /body/summary');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).toContain('Component context:');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).toContain('description: Summary section guidance.');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).toContain('description: Opening paragraph.');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).toContain('currently in the directory representing the component to change');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.messages).toEqual(expect.arrayContaining([
    expect.objectContaining({ role: 'assistant', content: expect.stringContaining('```shell\nhvy preview "/body/summary/intro"\n```') }),
    expect.objectContaining({ role: 'user', content: expect.stringContaining('Component preview (raw HVY, first 100 lines):') }),
    expect.objectContaining({ role: 'user', content: expect.stringContaining('Current directory: /body/summary/intro') }),
  ]));
  expect(writeChatCliCommandTraceMock.mock.calls.map((call) => call[1])).not.toContain('cd "/body/summary/intro"');
  expect(writeChatCliCommandTraceMock.mock.calls.map((call) => call[1])).toContain('hvy preview "/body/summary/intro"');
});

test('requestDocumentEditChatTurn treats selected components as examples for add requests', async () => {
  requestProxyCompletionMock.mockResolvedValueOnce('done Added a sibling list item.');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:component-list {"id":"items"}-->
  <!--hvy:text {"id":"existing"}-->
  Existing item
`, '.hvy');

  const result = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: [],
    request: 'Add another list item about shipping.',
    selectedComponent: {
      path: '/body/summary/items/existing',
      sectionTitle: 'Summary',
      component: 'text',
      baseComponent: 'text',
      schemaId: 'existing',
    },
  });

  expect(result.error).toBeNull();
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).toContain('Parent path: /body/summary/items');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).toContain('This request appears to add a new item.');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).toContain('Do not overwrite the selected component.');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.messages.at(-1)?.content).toContain('Current directory: /body/summary/items');
});

test('requestDocumentEditChatTurn compacts old cli conversation after high provider input tokens', async () => {
  requestProxyCompletionMock
    .mockImplementationOnce(async (params: { onTokenUsage?: (usage: { inputTokens?: number; outputTokens?: number }) => void }) => {
      params.onTokenUsage?.({ inputTokens: 9_000, outputTokens: 10 });
      return `echo "${'x'.repeat(12000)}"`;
    })
    .mockImplementationOnce(async (params: { onTokenUsage?: (usage: { inputTokens?: number; outputTokens?: number }) => void }) => {
      params.onTokenUsage?.({ inputTokens: 10_500, outputTokens: 10 });
      return `echo "${'y'.repeat(12000)}"`;
    })
    .mockResolvedValueOnce('Goal: check the document. Progress: ran x and y echo commands.')
    .mockImplementationOnce(async (params: { onTokenUsage?: (usage: { inputTokens?: number; outputTokens?: number }) => void }) => {
      params.onTokenUsage?.({ inputTokens: 7_000, outputTokens: 10 });
      return `echo "${'z'.repeat(12000)}"`;
    })
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
  expect(JSON.stringify(requestProxyCompletionMock.mock.calls[1]?.[0]?.messages)).toContain('x'.repeat(12000));
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.debugLabel).toBe('chat-cli-compaction');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.settings).toEqual({
    provider: 'openai',
    model: 'gpt-5.4-nano',
    compactionProvider: 'openai',
    compactionModel: 'gpt-5.4-nano',
  });
  const compactedMessages = requestProxyCompletionMock.mock.calls[3]?.[0]?.messages ?? [];
  expect(compactedMessages[0]?.content).toContain('### COMPACTED PRIOR CLI HISTORY ###');
  expect(compactedMessages[0]?.content).toContain('Goal: check the document. Progress: ran x and y echo commands.');
  expect(JSON.stringify(compactedMessages)).not.toContain('x'.repeat(12000));
  expect(requestProxyCompletionMock.mock.calls[5]?.[0]?.messages.length).toBeGreaterThan(0);
  expect(JSON.stringify(requestProxyCompletionMock.mock.calls[5]?.[0]?.messages)).not.toContain('x'.repeat(12000));
  expect(JSON.stringify(requestProxyCompletionMock.mock.calls[5]?.[0]?.messages)).not.toContain('... truncated ...');
  expect(requestProxyCompletionMock.mock.calls[5]?.[0]?.systemInstructions).toContain(
    'Valid commands (in order of preference):\nCommands: hvy, nl, rg, find, sed, echo, cat, ls, pwd, cd, cp, rm, grep, sort, uniq, wc, tr, xargs, head, tail, true. Ask: ask QUESTION. Finish: done MESSAGE_TO_USER.'
  );
  expect(requestProxyCompletionMock.mock.calls[5]?.[0]?.context).toContain('Current request:\nCheck the document with several commands.');
  expect(requestProxyCompletionMock.mock.calls[5]?.[0]?.context).not.toContain('scratchpad.txt:');
  expect(requestProxyCompletionMock.mock.calls[5]?.[0]?.messages.at(-1)?.content).toContain('### BEGIN /scratchpad.txt  ###');
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
  expect(result.awaitingUser).toBe(true);
  expect(onMutation).not.toHaveBeenCalled();
});

test('requestDocumentEditChatTurn accepts fenced done commands with notes', async () => {
  requestProxyCompletionMock.mockResolvedValueOnce(`What you are doing: Finalizing the change.
Why you are doing it: The edit was already validated.
What you are unsure of: Nothing.

\`\`\`shell
done Updated the history record.
\`\`\``);
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');

  const result = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: [],
    request: 'Finish.',
  });

  expect(result.error).toBeNull();
  expect(result.messages.at(-1)).toEqual(expect.objectContaining({
    role: 'assistant',
    content: 'Updated the history record.',
  }));
  expect(requestProxyCompletionMock).toHaveBeenCalledTimes(1);
});

test('requestDocumentEditChatTurn retries when ask placeholder is returned literally', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce('ask Question for the user')
    .mockResolvedValueOnce('ask Which section should I update?');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');

  const result = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: [],
    request: 'Update the section.',
  });

  expect(result.error).toBeNull();
  expect(result.messages.at(-1)?.content).toBe('Which section should I update?');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.at(-1)?.content).toContain('Do not return `ask Question for the user` literally.');
});

test('requestDocumentEditChatTurn rejects done batched with other commands', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce(`\`\`\`shell
hvy lint
done Updated the document.
\`\`\``)
    .mockResolvedValueOnce('done Updated the document.');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');

  const result = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: [],
    request: 'Finish.',
  });

  expect(result.error).toBeNull();
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.at(-1)?.content).toContain(
    'Run `done MESSAGE_TO_USER` or `ask QUESTION` as the only command in the response.'
  );
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
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).toContain("Current request:\nNo make up some stuff about LLM tooling and I'll fill it in later");
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).not.toContain('Task goal:');
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
  ]);
});

test('requestDocumentEditChatTurn accepts concise notes around fenced shell commands', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce(`What you are doing: Inspecting the current directory.
Why you are doing it: I need to choose the right edit target.
What you are unsure of: Whether the section already exists.
\`\`\`shell
pwd
\`\`\``)
    .mockResolvedValueOnce('done Inspected with notes.');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
  const onProgress = vi.fn();

  const result = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: [],
    request: 'Inspect with notes.',
    onProgress,
  });

  expect(result.error).toBeNull();
  expect(onProgress.mock.calls.map((call) => call[0].content)).toEqual([
    'Notes\nWhat you are doing: Inspecting the current directory.\nWhy you are doing it: I need to choose the right edit target.\nWhat you are unsure of: Whether the section already exists.',
    '$ pwd',
  ]);
  const nextPrompt = requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.at(-1)?.content ?? '';
  expect(nextPrompt).toContain('CMD: pwd\n### CMD RESULT ###\n/\n### END CMD RESULT ###');
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
  ]);
  const nextPrompt = requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.at(-1)?.content ?? '';
  expect(nextPrompt).toContain('CMD: cat /body/summary/long/text.txt');
  expect(nextPrompt).not.toContain('Warning: output truncated');
  expect(nextPrompt).toContain('### BEGIN your urgency ###\nscore=1\nprioritize planning and understanding');
});

test('requestDocumentEditChatTurn increments urgency once per successful AI command response', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce('```shell\npwd\n```')
    .mockResolvedValueOnce('```shell\nls /\n```')
    .mockResolvedValueOnce('```shell\nhvy lint\n```')
    .mockResolvedValueOnce('done Inspected three times.');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');

  const result = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: [],
    request: 'Inspect three times.',
  });

  expect(result.error).toBeNull();
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.messages.at(-1)?.content).toContain('### BEGIN your urgency ###\nscore=0\nprioritize planning and understanding');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.at(-1)?.content).toContain('### BEGIN your urgency ###\nscore=1\nprioritize planning and understanding');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.messages.at(-1)?.content).toContain('### BEGIN your urgency ###\nscore=2\nprioritize planning and understanding');
  expect(requestProxyCompletionMock.mock.calls[3]?.[0]?.messages.at(-1)?.content).toContain('### BEGIN your urgency ###\nscore=3\nconsider making your next change soon');
});

test('requestDocumentEditChatTurn ignores trailing done until a later standalone finish', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce(`\`\`\`shell
hvy append-child section /body chores "Chores"
\`\`\`

\`\`\`shell
hvy append-child text /body/chores note "Weekly chore plan"
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
    '$ [1/2] hvy append-child section /body chores "Chores"',
    '$ [2/2] hvy append-child text /body/chores note "Weekly chore plan"',
  ]);
  const nextPrompt = requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.at(-1)?.content ?? '';
  expect(nextPrompt).toContain('Next response: Write concise What / Why / Unsure of');
  expect(nextPrompt.trimEnd()).toMatch(/or run ask QUESTION, or run done MESSAGE_TO_USER\.$/);
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
  ]);
  const nextPrompt = requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.at(-1)?.content ?? '';
  expect(nextPrompt).toContain('CMD: pwd\n### CMD RESULT ###\n/');
  expect(nextPrompt).toContain('CMD: ls /body');
  expect(nextPrompt).toContain('CMD: cat /header.yaml');
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
  ]);
  const nextPrompt = requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.at(-1)?.content ?? '';
  expect(nextPrompt).toContain("CMD: cat > /scratchpad.txt <<'TXT'\nPlan:\n1. Inspect\n2. Edit\nTXT\n### CMD RESULT ###\n/scratchpad.txt: written");
  expect(nextPrompt).toContain('CMD: cat /scratchpad.txt\n### CMD RESULT ###\nPlan:\n1. Inspect\n2. Edit');
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
 ${Array.from({ length: 120 }, (_value, index) => `line ${index + 1}`).join('\n')}
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
  ]);
  const nextPrompt = requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.at(-1)?.content ?? '';
  expect(nextPrompt).toContain('Warning: output truncated to 66 of 120 wrapped lines (54 lines hidden).');
  expect(nextPrompt).toContain('### BEGIN your urgency ###\nscore=1\nprioritize planning and understanding');
});

test('requestDocumentEditChatTurn rejects oversized command batches before running them', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce(`\`\`\`shell
pwd
ls /
cat /header.yaml
hvy lint
hvy --help
hvy request_structure --collapse
hvy find-intent "summary" --max 5
find /body -maxdepth 2
rg "Summary" /body
cat /scratchpad.txt
pwd
\`\`\``)
    .mockResolvedValueOnce('done Kept the batch small.');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
  const onProgress = vi.fn();

  const result = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: [],
    request: 'Try too many commands.',
    onProgress,
  });

  expect(result.error).toBeNull();
  expect(onProgress).not.toHaveBeenCalled();
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.at(-1)?.content).toBe(
    '### COMMAND ERROR ###\nBatch has 11 commands. Use one command per ```shell block and at most 4 ```shell blocks per response.\n### END COMMAND ERROR ###\nNext response: Write concise What / Why / Unsure of and shell command(s), or run ask QUESTION, or run done MESSAGE_TO_USER.'
  );
  expect(writeChatCliCommandTraceMock.mock.calls.map((call) => call[1])).toEqual([
    'ls /',
    'hvy --help',
    'hvy request_structure --collapse',
    'hvy lint',
    'hvy find-intent "Try too many commands." --max 5',
  ]);
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

test('requestDocumentEditChatTurn preserves long command output lines that contain spaces', async () => {
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
 ${Array.from({ length: 90 }, () => 'represent').join(' ')}
`, '.hvy');

  const result = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: [],
    request: 'Inspect long line.',
  });

  expect(result.error).toBeNull();
  const nextPrompt = requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.at(-1)?.content ?? '';
  expect(nextPrompt).not.toContain('repres\nent');
  expect(nextPrompt).not.toContain('represent\nrepresent');
  expect(nextPrompt).toContain(Array.from({ length: 90 }, () => 'represent').join(' '));
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
  expect(nextPrompt).toContain('CMD: cat /body/summary/intro/text.txt\n### CMD RESULT ###\nHello\n### END CMD RESULT ###');
  expect(nextPrompt).toContain('Next response: Write concise What / Why / Unsure of');
  expect(nextPrompt.trimEnd()).toMatch(/or run ask QUESTION, or run done MESSAGE_TO_USER\.$/);
  expect(nextPrompt).toContain('### OPTIONAL CONTEXT (NOT REQUIRED ACTIONS) ###\ncomponent text: /body/summary/intro');
  expect(nextPrompt).toContain('# Text Components #');
  expect(nextPrompt).toContain('files: text.txt for body, text.json for config.');
  expect(nextPrompt).not.toContain('optional commands: inspect with hvy request_structure');
  expect(nextPrompt).not.toContain('optional sibling creation');
  expect(nextPrompt).toContain('### BEGIN /scratchpad.txt  ###\nlast edited never\n\nYou havent written your plan yet.');
  expect(nextPrompt).toContain('### BEGIN your urgency ###\nscore=1\nprioritize planning and understanding');
  expect(nextPrompt).not.toContain('commands since last edit:');
  expect(writeChatCliCommandTraceMock).toHaveBeenCalledWith(
    'chat-cli-test',
    'cat /body/summary/intro/text.txt',
    'Hello',
    undefined,
    expect.stringContaining('### OPTIONAL CONTEXT (NOT REQUIRED ACTIONS) ###\ncomponent text: /body/summary/intro')
  );
});

test('requestDocumentEditChatTurn omits optional component hints after creation commands', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce('hvy append-child text /summary --id note "Hello"')
    .mockResolvedValueOnce('done Added note.');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary
`, '.hvy');

  const result = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: [],
    request: 'Add note.',
  });

  expect(result.error).toBeNull();
  const nextPrompt = requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.at(-1)?.content ?? '';
  expect(nextPrompt).toContain('CMD: hvy append-child text /summary --id note "Hello"');
  expect(nextPrompt).toContain('Current directory: /body/summary/note');
  expect(nextPrompt).toContain('### OPTIONAL CONTEXT (NOT REQUIRED ACTIONS) ###\n(none)');
  expect(nextPrompt).not.toContain('component section');
  expect(nextPrompt).not.toContain('component text: /body/summary/note');
});

test('requestDocumentEditChatTurn includes diagnostics diffs after commands change issues', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce('echo \'{"id":"empty-ref","xrefTitle":"Summary","xrefTarget":"summary"}\' > /body/summary/empty-ref/xref-card.json')
    .mockResolvedValueOnce('done Fixed the empty xref.');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:xref-card {"id":"empty-ref"}-->
`, '.hvy');

  const result = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: [],
    request: 'Fix empty xref.',
  });

  expect(result.error).toBeNull();
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.messages).toEqual(expect.arrayContaining([
    expect.objectContaining({ role: 'assistant', content: expect.stringContaining('```shell\nhvy lint\n```') }),
    expect.objectContaining({ role: 'user', content: expect.stringContaining('[xref-card] /body/summary/empty-ref - xref-card is missing xrefTitle.') }),
  ]));
  const nextPrompt = requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.at(-1)?.content ?? '';
  expect(nextPrompt).toContain('### DIAGNOSTICS CHANGES FROM THIS COMMAND ###\n');
  expect(nextPrompt).toContain('diagnostics diff\n- [xref-card] /body/summary/empty-ref - xref-card is missing xrefTitle.');
  expect(nextPrompt).toContain('- [xref-card] /body/summary/empty-ref - xref-card is missing xrefTarget.');
});

test('requestDocumentEditChatTurn keeps diagnostics introduced by your changes active until fixed', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce('hvy append-child component /body/summary empty-ref xref-card Placeholder')
    .mockResolvedValueOnce('ask Should I keep going?')
    .mockResolvedValueOnce('done Created the xref.')
    .mockResolvedValueOnce('echo \'{"id":"empty-ref","xrefTitle":"Summary","xrefTarget":"summary"}\' > /body/summary/empty-ref/xref-card.json')
    .mockResolvedValueOnce('done Fixed the xref.');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary
`, '.hvy');

  const firstResult = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: [],
    request: 'Create a placeholder xref.',
  });

  expect(firstResult.error).toBeNull();
  expect(firstResult.messages.at(-1)).toEqual(expect.objectContaining({
    role: 'assistant',
    content: 'Should I keep going?',
  }));
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.at(-1)?.content).toContain('### UNRESOLVED DIAGNOSTICS INTRODUCED BY YOUR CHANGES ###');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.at(-1)?.content).toContain('[xref-card] /body/summary/empty-ref - xref-card is missing xrefTarget.');

  const secondResult = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: firstResult.messages,
    request: 'yes, finish',
  });

  expect(secondResult.error).toBeNull();
  expect(secondResult.messages.at(-1)).toEqual(expect.objectContaining({
    role: 'assistant',
    content: 'Fixed the xref.',
  }));
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.messages.at(-1)?.content).toContain('[xref-card] /body/summary/empty-ref - xref-card is missing xrefTarget.');
  expect(requestProxyCompletionMock.mock.calls[3]?.[0]?.messages.at(-1)?.content).toContain('You cannot finish yet.');
  expect(requestProxyCompletionMock.mock.calls[3]?.[0]?.messages.at(-1)?.content).toContain('Fix them before finishing');
  expect(requestProxyCompletionMock.mock.calls[4]?.[0]?.messages.at(-1)?.content).toContain('### UNRESOLVED DIAGNOSTICS INTRODUCED BY YOUR CHANGES ###\n(none)');
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
  expect(nextPrompt).toContain('# Grid Components #');
  expect(nextPrompt).toContain('files: grid.txt for body, grid.json for config.');
  expect(nextPrompt).not.toContain('optional commands: inspect with hvy request_structure');
  expect(nextPrompt).not.toContain('optional sibling creation');
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
  expect(nextPrompt).not.toContain('Key: [x] text, [c] container');
  expect(nextPrompt).toContain('xref-card.txt id=typescript-card');
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

<!--hvy:plugin {"id":"contact-form","plugin":"dev.heavy.form","pluginConfig":{"version":"0.1","submitLabel":"Send"}}-->
fields:
  - label: Message
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
  expect(nextPrompt).toContain('Fields and named script bodies live in plugin.txt');
  expect(nextPrompt).toContain('Form scripts are Python/Brython snippets under scripts.NAME, wrapped in a generated function');
});

test('requestDocumentEditChatTurn includes scripting plugin code hints', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce('cat /body/automation/startup-script/script.py')
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
  expect(nextPrompt).toContain('The component body is exposed as script.py. It is Python/Brython source wrapped in a generated function with one injected global: doc.');
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

test('requestDocumentEditChatTurn keeps chronological clarification history without forcing a task goal', async () => {
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
  expect(context).toContain('Current request:\nyes different summary / properties');
  expect(context).not.toContain('Use the chronological chat messages and terminal results to infer the active task.');
  expect(context).not.toContain('Task goal:');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.messages.slice(0, 5)).toEqual([
    expect.objectContaining({ role: 'user', content: 'Add a new skill, "LLM Tooling", and add it to top skills' }),
    expect.objectContaining({ role: 'assistant', content: 'Should the new "LLM Tooling" skill mirror the existing skill?' }),
    expect.objectContaining({ role: 'user', content: "Completely new, make some stuff up and I'll fill it in" }),
    expect.objectContaining({ role: 'assistant', content: 'Do you want a different summary/properties?' }),
    expect.objectContaining({ role: 'user', content: 'yes different summary / properties' }),
  ]);
});

test('requestDocumentEditChatTurn treats continue as chronological context instead of a forced goal', async () => {
  requestProxyCompletionMock.mockResolvedValueOnce('done Continued the chore chart.');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');

  const result = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: [
      { id: 'u1', role: 'user', content: 'Create a chore chart with forms and a leaderboard' },
      { id: 'a1', role: 'assistant', content: 'Unclosed quote in command.', error: true },
    ],
    request: 'continue',
  });

  expect(result.error).toBeNull();
  const context = requestProxyCompletionMock.mock.calls[0]?.[0]?.context ?? '';
  expect(context).toContain('Current request:\ncontinue');
  expect(context).not.toContain('Use the chronological chat messages and terminal results to infer the active task.');
  expect(context).not.toContain('Task goal:');
  expect(writeChatCliCommandTraceMock.mock.calls.map((call) => call[1])).toContain('hvy find-intent "continue" --max 5');
  expect(writeChatCliCommandTraceMock.mock.calls.map((call) => call[1])).not.toContain('hvy find-intent "Create a chore chart with forms and a leaderboard\ncontinue" --max 5');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.messages.slice(0, 3)).toEqual([
    expect.objectContaining({ role: 'user', content: 'Create a chore chart with forms and a leaderboard' }),
    expect.objectContaining({ role: 'assistant', content: 'Unclosed quote in command.', error: true }),
    expect.objectContaining({ role: 'user', content: 'continue' }),
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
  expect(onProgress).not.toHaveBeenCalled();
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.at(-1)?.content).toContain('Expected concise notes plus fenced ```shell commands');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.messages.at(-1)?.content).toContain('Expected concise notes plus fenced ```shell commands');
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
    'CMD: hvy\n### CMD RESULT ###\nhvy: expected request_structure, find-intent, cheatsheet, recipe, lint, append-child, prepend-child, plugin, remove, prune-xref, preview, or help\n### END CMD RESULT ###'
  );
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.at(-1)?.content).toContain(
    '### BEGIN your urgency ###\nscore=0\nprioritize planning and understanding'
  );
  expect(writeChatCliCommandTraceMock).toHaveBeenCalledWith(
    'chat-cli-test',
    'hvy',
    'hvy: expected request_structure, find-intent, cheatsheet, recipe, lint, append-child, prepend-child, plugin, remove, prune-xref, preview, or help',
    undefined,
    expect.stringContaining('CMD: hvy\n### CMD RESULT ###\nhvy: expected request_structure, find-intent, cheatsheet, recipe, lint, append-child, prepend-child, plugin, remove, prune-xref, preview, or help\n### END CMD RESULT ###')
  );
});

test('requestDocumentEditChatTurn counts a failed command batch as one retry attempt', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce(`\`\`\`shell
not-a-command
hvy
cat missing.txt
\`\`\``)
    .mockResolvedValueOnce('pwd')
    .mockResolvedValueOnce('done Recovered after one failed batch.');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');

  const result = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: [],
    request: 'Recover from one bad batch.',
  });

  expect(result.error).toBeNull();
  expect(requestProxyCompletionMock).toHaveBeenCalledTimes(3);
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.at(-1)?.content).toContain(
    'Unknown command "not-a-command". Try "help".'
  );
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.at(-1)?.content).toContain(
    'No such file: /missing.txt'
  );
  expect(writeChatCliCommandTraceMock.mock.calls[5]?.[1]).toBe('not-a-command\nhvy\ncat missing.txt');
});

test('requestDocumentEditChatTurn treats unclosed shell quotes as retryable command errors', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce('echo "unterminated')
    .mockResolvedValueOnce('pwd')
    .mockResolvedValueOnce('done Recovered from the quote error.');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');

  const result = await requestDocumentEditChatTurn({
    settings,
    document,
    messages: [],
    request: 'Recover from quote syntax.',
  });

  expect(result.error).toBeNull();
  expect(requestProxyCompletionMock).toHaveBeenCalledTimes(3);
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.at(-1)?.content).toContain('Unclosed quote in command.');
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

  expect(result.error).toContain('Stopped after 3 failed CLI commands.');
  expect(result.error).toContain('Current request:\nKeep making bad commands.');
  expect(result.error).toContain('Last failed command:\ncat missing.txt');
  expect(result.error).toContain('Last error:\nNo such file: /missing.txt');
  expect(result.error).toContain('Did you mean?');
  expect(result.error).toContain('Scratchpad at failure:');
  expect(result.error).toContain('Continue from the chat history and current document state. If the next step is unclear, ask a clarifying question.');
  expect(requestProxyCompletionMock).toHaveBeenCalledTimes(3);
  expect(writeChatCliCommandTraceMock.mock.calls.map((call) => call[2])).toEqual([
    expect.stringContaining('dir  body'),
    expect.stringContaining('hvy append-child section PARENT_PATH ID TITLE'),
    expect.stringContaining('Components:'),
    'No lint issues.',
    expect.any(String),
    'Unknown command "not-a-command". Try "help".',
    'hvy: expected request_structure, find-intent, cheatsheet, recipe, lint, append-child, prepend-child, plugin, remove, prune-xref, preview, or help',
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
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.at(-1)?.content).toContain('x'.repeat(800));
  expect(requestProxyCompletionMock.mock.calls[4]?.[0]?.messages.at(-1)?.content).toContain('short notes');
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
