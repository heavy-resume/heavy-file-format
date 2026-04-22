import { expect, test } from 'vitest';

import {
  buildAnthropicProxyRequest,
  buildOpenAiProxyRequest,
  extractAnthropicText,
  extractOpenAiText,
} from '../proxy/chat-proxy';

const request = {
  provider: 'openai' as const,
  model: 'gpt-5-mini',
  context: 'Context body',
  formatInstructions: 'Format as HVY.',
  messages: [
    { role: 'user' as const, content: 'What is this?' },
    { role: 'assistant' as const, content: 'A summary.' },
  ],
};

test('buildOpenAiProxyRequest includes developer context and conversation turns', () => {
  expect(buildOpenAiProxyRequest(request)).toEqual({
    model: 'gpt-5-mini',
    instructions: expect.stringMatching(/Response formatting instructions:\nFormat as HVY\./),
    input: [
      {
        role: 'developer',
        content: [
          {
            type: 'input_text',
            text: 'Document context:\n\nContext body',
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: 'What is this?',
          },
        ],
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'input_text',
            text: 'A summary.',
          },
        ],
      },
    ],
    text: {
      format: {
        type: 'text',
      },
    },
  });
});

test('buildAnthropicProxyRequest places context in system prompt and messages in order', () => {
  expect(
    buildAnthropicProxyRequest({
      ...request,
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    })
  ).toEqual({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: expect.stringMatching(/Response formatting instructions:\nFormat as HVY\./),
    messages: [
      { role: 'user', content: 'What is this?' },
      { role: 'assistant', content: 'A summary.' },
    ],
  });
});

test('proxy response extractors collect text from provider payloads', () => {
  expect(
    extractOpenAiText({
      output: [
        {
          content: [
            { type: 'output_text', text: 'OpenAI answer' },
          ],
        },
      ],
    })
  ).toBe('OpenAI answer');

  expect(
    extractAnthropicText({
      content: [
        { type: 'text', text: 'Anthropic answer' },
      ],
    })
  ).toBe('Anthropic answer');
});
