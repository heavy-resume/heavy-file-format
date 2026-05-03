import { expect, test } from 'vitest';

import {
  buildAnthropicProxyRequest,
  buildOpenAiProxyRequest,
  buildRepairPrompt,
  extractAnthropicText,
  extractOpenAiText,
  formatTraceEvent,
  formatTraceTextEvent,
  pruneTraceLines,
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
    reasoning: {
      effort: 'high',
    },
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

test('formatTraceEvent writes one ndjson event with timestamp and payload', () => {
  const line = formatTraceEvent(
    {
      runId: 'run-1',
      phase: 'document-edit',
      type: 'request_context',
      payload: {
        context: 'Context body',
        formatInstructions: 'Format as HVY.',
      },
    },
    new Date('2026-05-02T12:00:00.000Z')
  );

  expect(line.endsWith('\n')).toBe(true);
  expect(JSON.parse(line)).toEqual({
    timestamp: '2026-05-02T12:00:00.000Z',
    runId: 'run-1',
    phase: 'document-edit',
    type: 'request_context',
    payload: {
      context: 'Context body',
      formatInstructions: 'Format as HVY.',
    },
  });
});

test('formatTraceTextEvent writes readable progress lines', () => {
  const line = formatTraceTextEvent(
    {
      runId: 'run-1',
      phase: 'document-edit',
      type: 'progress',
      payload: {
        content: 'Viewing component C6.',
      },
    },
    new Date('2026-05-02T12:00:00.000Z')
  );

  expect(line).toBe('[2026-05-02T12:00:00.000Z] run-1 document-edit progress :: Viewing component C6.\n');
});

test('formatTraceTextEvent writes readable work ledger lines', () => {
  const line = formatTraceTextEvent(
    {
      runId: 'run-1',
      phase: 'document-edit',
      type: 'work_ledger',
      payload: {
        summary: 'Read database table assignments.',
        action: 'query_db_table(assignments)',
        intent: 'Inspect assignments table.',
      },
    },
    new Date('2026-05-02T12:00:00.000Z')
  );

  expect(line).toBe('[2026-05-02T12:00:00.000Z] run-1 document-edit work_ledger :: did=Read database table assignments. action=query_db_table(assignments) intent=Inspect assignments table.\n');
});

test('buildOpenAiProxyRequest does not send trace run ids upstream', () => {
  const openAiRequest = buildOpenAiProxyRequest({
    ...request,
    traceRunId: 'trace-1',
  });

  expect(JSON.stringify(openAiRequest)).not.toContain('trace-1');
});

test('pruneTraceLines removes the oldest 100 lines each time the trace exceeds 500 lines', () => {
  const contents = Array.from({ length: 501 }, (_value, index) => `{"line":${index + 1}}`).join('\n') + '\n';

  const pruned = pruneTraceLines(contents);

  const lines = pruned.trimEnd().split('\n');
  expect(lines).toHaveLength(401);
  expect(lines[0]).toBe('{"line":101}');
  expect(lines.at(-1)).toBe('{"line":501}');
});

test('pruneTraceLines prunes in 100-line chunks until an oversized trace is under the cap', () => {
  const contents = Array.from({ length: 650 }, (_value, index) => `{"line":${index + 1}}`).join('\n') + '\n';

  const pruned = pruneTraceLines(contents);

  const lines = pruned.trimEnd().split('\n');
  expect(lines).toHaveLength(450);
  expect(lines[0]).toBe('{"line":201}');
  expect(lines.at(-1)).toBe('{"line":650}');
});
