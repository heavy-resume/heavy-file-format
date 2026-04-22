import { beforeEach, expect, test, vi } from 'vitest';

import { appendUserChatMessage, requestChatTurn } from '../src/chat-session';
import { deserializeDocument } from '../src/serialization';
import type { ChatMessage, ChatSettings } from '../src/types';

const { requestChatCompletionMock } = vi.hoisted(() => ({
  requestChatCompletionMock: vi.fn(),
}));

vi.mock('../src/chat', () => ({
  requestChatCompletion: requestChatCompletionMock,
}));

beforeEach(() => {
  requestChatCompletionMock.mockReset();
});

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
