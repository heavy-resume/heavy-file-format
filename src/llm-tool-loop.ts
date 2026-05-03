export type ToolLoopRole = 'user' | 'assistant';

export interface ToolLoopMessage {
  id?: string;
  role: ToolLoopRole;
  content: string;
}

export type JsonObject = Record<string, unknown>;

export type JsonToolCall<TName extends string = string, TArgs extends JsonObject = JsonObject> = {
  tool: TName;
} & TArgs;

export type ToolParseResult<TToolCall extends JsonToolCall> =
  | { ok: true; value: TToolCall }
  | { ok: false; message: string };

export interface JsonToolDefinition<TToolCall extends JsonToolCall> {
  name: TToolCall['tool'];
  parse: (json: JsonObject) => TToolCall | string | null | undefined;
}

export interface ToolLoopModelRequest<TContext> {
  messages: ToolLoopMessage[];
  context: TContext;
  iteration: number;
}

export interface ToolLoopExecutorRequest<TToolCall extends JsonToolCall, TContext> {
  toolCall: TToolCall;
  context: TContext;
  iteration: number;
  modelResponse: string;
}

export interface ToolLoopDoneRequest<TToolCall extends JsonToolCall, TContext, TDone> {
  toolCall: TToolCall;
  context: TContext;
  iteration: number;
  modelResponse: string;
  messages: ToolLoopMessage[];
  done: (value: TDone) => ToolLoopDone<TDone>;
}

export interface ToolLoopDone<TDone> {
  done: true;
  value: TDone;
}

export interface ToolLoopToolResult<TContext> {
  content: string;
  context?: TContext;
}

export interface ToolLoopStep<TToolCall extends JsonToolCall> {
  iteration: number;
  modelResponse: string;
  toolCall: TToolCall;
  toolResult?: string;
}

export type ToolLoopStatus = 'done' | 'stopped';

export interface ToolLoopResult<TDone, TToolCall extends JsonToolCall, TContext> {
  status: ToolLoopStatus;
  value?: TDone;
  messages: ToolLoopMessage[];
  context: TContext;
  steps: Array<ToolLoopStep<TToolCall>>;
}

export interface RunJsonToolLoopOptions<TToolCall extends JsonToolCall, TDone, TContext> {
  initialMessages: ToolLoopMessage[];
  context: TContext;
  maxSteps: number;
  requestModel: (request: ToolLoopModelRequest<TContext>) => Promise<string>;
  parseToolCall: (response: string) => ToolParseResult<TToolCall>;
  handleDone: (
    request: ToolLoopDoneRequest<TToolCall, TContext, TDone>
  ) => ToolLoopDone<TDone> | null | undefined;
  executeTool: (
    request: ToolLoopExecutorRequest<TToolCall, TContext>
  ) => Promise<string | ToolLoopToolResult<TContext>> | string | ToolLoopToolResult<TContext>;
  buildToolResultMessage?: (toolCall: TToolCall, toolResult: string) => string;
  buildInvalidResponseMessage?: (message: string) => string;
}

export function defineJsonTool<TToolCall extends JsonToolCall>(
  definition: JsonToolDefinition<TToolCall>
): JsonToolDefinition<TToolCall> {
  return definition;
}

export function parseJsonToolCall<TToolCall extends JsonToolCall>(
  source: string,
  definitions: Array<JsonToolDefinition<TToolCall>>
): ToolParseResult<TToolCall> {
  const json = parseJsonObjectResponse(source);
  if (json.ok === false) {
    return json;
  }

  const tool = json.value.tool;
  if (typeof tool !== 'string' || tool.trim().length === 0) {
    return { ok: false, message: 'Tool response must include a string `tool` field.' };
  }

  const definition = definitions.find((candidate) => candidate.name === tool);
  if (!definition) {
    return {
      ok: false,
      message: `Unknown tool "${tool}". Valid tools are: ${definitions.map((candidate) => `\`${candidate.name}\``).join(', ')}.`,
    };
  }

  const parsed = definition.parse(json.value);
  if (!parsed) {
    return { ok: false, message: `Tool "${tool}" did not match the expected shape.` };
  }
  if (typeof parsed === 'string') {
    return { ok: false, message: parsed };
  }
  return { ok: true, value: parsed };
}

export async function runJsonToolLoop<TToolCall extends JsonToolCall, TDone, TContext>(
  options: RunJsonToolLoopOptions<TToolCall, TDone, TContext>
): Promise<ToolLoopResult<TDone, TToolCall, TContext>> {
  let messages = [...options.initialMessages];
  let context = options.context;
  const steps: Array<ToolLoopStep<TToolCall>> = [];

  for (let iteration = 0; iteration < options.maxSteps; iteration += 1) {
    const modelResponse = await options.requestModel({ messages, context, iteration });
    const parsed = options.parseToolCall(modelResponse);

    if (parsed.ok === false) {
      messages = [
        ...messages,
        {
          role: 'user',
          content: options.buildInvalidResponseMessage?.(parsed.message) ?? defaultInvalidResponseMessage(parsed.message),
        },
      ];
      continue;
    }

    const done = options.handleDone({
      toolCall: parsed.value,
      context,
      iteration,
      modelResponse,
      messages,
      done: (value) => ({ done: true, value }),
    });
    if (done?.done) {
      steps.push({ iteration, modelResponse, toolCall: parsed.value });
      return { status: 'done', value: done.value, messages, context, steps };
    }

    const executed = await options.executeTool({
      toolCall: parsed.value,
      context,
      iteration,
      modelResponse,
    });
    const toolResult = typeof executed === 'string' ? executed : executed.content;
    if (typeof executed !== 'string' && executed.context !== undefined) {
      context = executed.context;
    }

    steps.push({ iteration, modelResponse, toolCall: parsed.value, toolResult });
    messages = [
      ...messages,
      { role: 'assistant', content: modelResponse },
      {
        role: 'user',
        content: options.buildToolResultMessage?.(parsed.value, toolResult) ?? defaultToolResultMessage(parsed.value.tool, toolResult),
      },
    ];
  }

  return { status: 'stopped', messages, context, steps };
}

export function parseJsonObjectResponse(source: string): { ok: true; value: JsonObject } | { ok: false; message: string } {
  const cleaned = stripJsonMarkdownFence(source);
  try {
    const parsed = JSON.parse(cleaned) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, message: 'Return exactly one JSON object.' };
    }
    return { ok: true, value: parsed as JsonObject };
  } catch {
    return { ok: false, message: 'Response was not valid JSON.' };
  }
}

export function stripJsonMarkdownFence(source: string): string {
  return source.trim().replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
}

function defaultToolResultMessage(tool: string, result: string): string {
  return [`Tool result for ${tool}:`, result].join('\n\n');
}

function defaultInvalidResponseMessage(message: string): string {
  return `Return a single valid JSON tool object. ${message}`;
}
