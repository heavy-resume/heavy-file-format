import { expect, test } from 'vitest';

import {
  buildAnthropicProxyRequest,
  buildOpenAiProxyRequest,
  buildRepairPrompt,
  extractAnthropicText,
  extractOpenAiText,
} from '../proxy/chat-proxy';

const request = {
  provider: 'openai' as const,
  model: 'gpt-5-mini',
  mode: 'qa' as const,
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
            type: 'output_text',
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
    max_tokens: 4096,
    system: expect.stringMatching(/Response formatting instructions:\nFormat as HVY\./),
    messages: [
      { role: 'user', content: 'What is this?' },
      { role: 'assistant', content: 'A summary.' },
    ],
  });
});

test('component edit requests use edit-specific system instructions', () => {
  const openAiRequest = buildOpenAiProxyRequest({
    ...request,
    mode: 'component-edit',
  });

  expect(openAiRequest).toEqual(
    expect.objectContaining({
      instructions: expect.stringMatching(/This is a component editing task, not a question answering task\./),
    })
  );
  expect(openAiRequest).toEqual(
    expect.not.objectContaining({
      instructions: expect.stringMatching(/Answer questions about the provided HVY document context\./),
    })
  );
});

test('document edit requests use document-edit-specific system instructions', () => {
  const openAiRequest = buildOpenAiProxyRequest({
    ...request,
    mode: 'document-edit',
  });

  expect(openAiRequest).toEqual(
    expect.objectContaining({
      instructions: expect.stringMatching(/This is a document editing task, not a question answering task\./),
    })
  );
  expect(openAiRequest).toEqual(
    expect.not.objectContaining({
      instructions: expect.stringMatching(/Modify only the selected component\./),
    })
  );
});

test('assistant turns use output_text in OpenAI response inputs', () => {
  const openAiRequest = buildOpenAiProxyRequest(request) as {
    input: Array<{ role: string; content: Array<{ type: string; text: string }> }>;
  };
  const assistantTurn = openAiRequest.input.find((item) => item.role === 'assistant');
  expect(assistantTurn?.content[0]?.type).toBe('output_text');
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

test('buildRepairPrompt turns diagnostics into concise repair guidance', () => {
  expect(
    buildRepairPrompt([
      {
        severity: 'error',
        code: 'invalid_block_directive_json',
        message: 'Section "Response", line 3: Directive "expandable" has invalid JSON.',
      },
      {
        severity: 'warning',
        code: 'expandable_slot_without_parent',
        message: 'Section "Response", line 6: Expandable stub/content was provided without an enclosing expandable block.',
      },
    ])
  ).toContain('Hint: Component directives must use JSON objects like `<!--hvy:text {}-->`.');
  expect(
    buildRepairPrompt([
      {
        severity: 'warning',
        code: 'expandable_slot_without_parent',
        message: 'Section "Response", line 6: Expandable stub/content was provided without an enclosing expandable block.',
      },
    ])
  ).toContain('Return the full corrected HVY response body only.');
});
