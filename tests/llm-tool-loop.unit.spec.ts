import { describe, expect, test, vi } from 'vitest';
import { defineJsonTool, parseJsonArrayResponse, parseJsonToolCall, parseJsonValueResponse, runJsonToolLoop, type JsonToolCall, type JsonToolDefinition } from '../src/llm-tool-loop';

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

  test('parseJsonToolCall extracts JSON object from wrapper prose', () => {
    const parsed = parseJsonToolCall<ExampleToolCall>(
      'Here is the tool call:\n```json\n{"tool":"search_notes","query":"release notes"}\n```\nDone.',
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

  test('parseJsonToolCall extracts balanced JSON object from prose inside a fence', () => {
    const parsed = parseJsonToolCall<ExampleToolCall>(
      '```text\nHere is the tool call:\n{"tool":"search_notes","query":"release {notes}"}\n```',
      exampleToolDefinitions
    );

    expect(parsed).toEqual({
      ok: true,
      value: {
        tool: 'search_notes',
        query: 'release {notes}',
      },
    });
  });

  test('parseJsonToolCall ignores wrapper prose around a bare JSON object', () => {
    const parsed = parseJsonToolCall<ExampleToolCall>(
      'Tool call:\n{"tool":"search_notes","query":"release notes"}\nEnd.',
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

  test('parseJsonValueResponse extracts a balanced JSON array', () => {
    const parsed = parseJsonValueResponse('Selected IDs:\n```json\n["component:C6","component:C7"]\n```');

    expect(parsed).toEqual({
      ok: true,
      value: ['component:C6', 'component:C7'],
    });
  });

  test('parseJsonArrayResponse extracts the first parseable JSON array', () => {
    const parsed = parseJsonArrayResponse('Ignore [not json], use {"matches":["component:C6","component:C7"]}');

    expect(parsed).toEqual({
      ok: true,
      value: ['component:C6', 'component:C7'],
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
