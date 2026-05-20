import { describe, expect, test, vi } from 'vitest';
import { defineJsonTool, parseJsonToolCall, runJsonToolLoop, type JsonToolCall, type JsonToolDefinition } from '../src/llm-tool-loop';

type ExampleToolCall =
  | JsonToolCall<'search_notes', { query: string }>
  | JsonToolCall<'answer', { answer: string }>;

const exampleToolDefinitions = [
  defineJsonTool<Extract<ExampleToolCall, { tool: 'search_notes' }>>({
    name: 'search_notes',
    parse: (json) =>
      typeof json.query === 'string' && json.query.trim().length > 0
        ? { tool: 'search_notes', query: json.query }
        : '`search_notes.query` must be a non-empty string.',
  }),
  defineJsonTool<Extract<ExampleToolCall, { tool: 'answer' }>>({
    name: 'answer',
    parse: (json) => (typeof json.answer === 'string' ? { tool: 'answer', answer: json.answer } : null),
  }),
] as Array<JsonToolDefinition<ExampleToolCall>>;

describe('llm-tool-loop', () => {
  test('parseJsonToolCall parses fenced JSON and validates known tool shapes', () => {
    const parsed = parseJsonToolCall<ExampleToolCall>(
      '```json\n{"tool":"search_notes","query":"release notes"}\n```',
      exampleToolDefinitions
    );

    expect(parsed).toEqual({
      ok: true,
      value: {
        tool: 'search_notes',
        query: 'release notes',
      },
    });
  });

  test('runJsonToolLoop follows before, tool call, after flow', async () => {
    const requestModel = vi
      .fn()
      .mockResolvedValueOnce('not json')
      .mockResolvedValueOnce('{"tool":"search_notes","query":"status"}')
      .mockResolvedValueOnce('{"tool":"answer","answer":"Expected result: shipped."}');
    const executeTool = vi.fn().mockResolvedValueOnce('Search result: shipped');

    const before = [{ role: 'user' as const, content: 'What is the status?' }];

    const result = await runJsonToolLoop<ExampleToolCall, string, { projectId: string }>({
      initialMessages: before,
      context: { projectId: 'demo' },
      maxSteps: 4,
      requestModel,
      parseToolCall: (response) => parseJsonToolCall(response, exampleToolDefinitions),
      handleDone: ({ toolCall, done }) => (toolCall.tool === 'answer' ? done(toolCall.answer) : null),
      executeTool: ({ toolCall, context }) => {
        expect(context).toEqual({ projectId: 'demo' });
        return executeTool(toolCall);
      },
    });

    expect(executeTool).toHaveBeenCalledWith({ tool: 'search_notes', query: 'status' });
    expect(result.status).toBe('done');
    expect(result.value).toBe('Expected result: shipped.');
    expect(result.messages).toEqual([
      ...before,
      {
        role: 'user',
        content: 'Return a single valid JSON tool object. Response was not valid JSON.',
      },
      {
        role: 'assistant',
        content: '{"tool":"search_notes","query":"status"}',
      },
      {
        role: 'user',
        content: 'Tool result for search_notes:\n\nSearch result: shipped',
      },
    ]);
    expect(result.steps).toEqual([
      {
        iteration: 1,
        modelResponse: '{"tool":"search_notes","query":"status"}',
        toolCall: { tool: 'search_notes', query: 'status' },
        toolResult: 'Search result: shipped',
      },
      {
        iteration: 2,
        modelResponse: '{"tool":"answer","answer":"Expected result: shipped."}',
        toolCall: { tool: 'answer', answer: 'Expected result: shipped.' },
      },
    ]);
  });
});
