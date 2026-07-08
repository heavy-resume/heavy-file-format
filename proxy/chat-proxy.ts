import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import {
  buildAnthropicProxyRequest,
  buildOpenAiProxyRequest,
  buildQwenProxyRequest,
  type OpenAiReasoningEffort,
  type ProviderProxyChatRequest,
} from '../src/chat/chat-provider-payload';
import {
  buildInitialProviderToolState,
  buildProviderToolProxyRequest,
  extractProviderToolTurn,
  type ProviderToolDefinition,
  type ProviderToolProxyChatRequest,
  type ProviderToolState,
  type ToolProvider,
} from '../src/chat/provider-tools';
import { getHvyDiagnosticUsageHint, getHvyResponseDiagnostics, type HvyDiagnostic } from '../src/serialization';

const OPENAI_API_URL = 'https://api.openai.com/v1/responses';
const OPENAI_EMBEDDINGS_API_URL = 'https://api.openai.com/v1/embeddings';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const QWEN_API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const ANTHROPIC_API_VERSION = '2023-06-01';
const DEV_TRACE_DIR = path.resolve(process.cwd(), 'dev-traces');
const AGENT_LOOP_TRACE_FILE = path.join(DEV_TRACE_DIR, 'agent-loop.ndjson');
const AGENT_LOOP_TEXT_TRACE_FILE = path.join(DEV_TRACE_DIR, 'agent-loop.txt');
const AI_CLI_LOG_FILE = path.join(DEV_TRACE_DIR, 'ai_cli_log.txt');
const AI_CLI_MESSAGES_LOG_FILE = path.join(DEV_TRACE_DIR, 'ai_cli_messages.txt');
const FAILED_CLI_COMMANDS_LOG_FILE = path.join(DEV_TRACE_DIR, 'failed-cli-commands');
const AGENT_LOOP_TRACE_MAX_LINES = 500;
const AGENT_LOOP_TRACE_PRUNE_LINES = 100;
const AI_CLI_LOG_MAX_LINES = 2000;
const AI_CLI_LOG_PRUNE_LINES = 100;
export { buildAnthropicProxyRequest, buildOpenAiProxyRequest, buildQwenProxyRequest };

let traceWriteQueue = Promise.resolve();

interface TraceEvent {
  runId: string;
  phase: ProxyChatRequest['mode'] | 'proxy';
  type:
    | 'request_context'
    | 'provider_request'
    | 'provider_response'
    | 'model_response'
    | 'progress'
    | 'work_ledger'
    | 'client_event'
    | 'invalid_response'
    | 'error'
    | 'stop';
  payload: Record<string, unknown>;
}

interface ProxyChatRequest {
  provider: ToolProvider;
  model: string;
  mode: ProviderProxyChatRequest['mode'];
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  traceRunId?: string;
  context: string;
  openAiReasoningEffort?: OpenAiReasoningEffort;
  tools?: ProviderToolDefinition[];
  toolState?: ProviderToolState;
}

interface ProxyEmbeddingRequest {
  model: string;
  input: string[];
  dimensions?: number;
}

interface ProviderCompletion {
  output: string;
  reasoningSummary: string;
  usage?: ProviderTokenUsage;
  toolCalls?: unknown[];
  nativeMessages?: unknown[];
  toolState?: ProviderToolState;
}

interface ProviderTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
}

export function createChatProxyPlugin(env: Record<string, string | undefined>): Plugin {
  const middleware = buildChatProxyMiddleware(env);

  return {
    name: 'hvy-chat-proxy',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

export function buildChatProxyMiddleware(env: Record<string, string | undefined>) {
  return async (req, res, next) => {
    if (req.url?.startsWith('/api/agent-trace')) {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'Method not allowed. Use POST /api/agent-trace.' });
        return;
      }
      try {
        const event = validateClientTraceEvent(await readRequestJson(req));
        writeTrace(event);
        sendJson(res, 200, { ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid trace payload.';
        sendJson(res, 400, { error: message });
      }
      return;
    }

    if (req.url?.startsWith('/api/embeddings')) {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'Method not allowed. Use POST /api/embeddings.' });
        return;
      }
      const upstreamAbort = new AbortController();
      let completed = false;
      const abortUpstream = () => {
        if (!completed) {
          upstreamAbort.abort();
        }
      };
      req.on('aborted', abortUpstream);
      res.on('close', abortUpstream);
      try {
        const body = validateProxyEmbeddingRequest(await readRequestJson(req));
        const payload = await requestOpenAiEmbeddings(body, env, upstreamAbort.signal);
        completed = true;
        sendJson(res, 200, payload);
      } catch (error) {
        if (isAbortError(error) || upstreamAbort.signal.aborted) {
          return;
        }
        completed = true;
        const message = error instanceof Error ? error.message : 'Proxy embedding request failed.';
        const status = message.startsWith('Provider request failed:') ? 502 : 400;
        sendJson(res, status, { error: message });
      }
      return;
    }

    if (!req.url?.startsWith('/api/chat')) {
      next();
      return;
    }

    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed. Use POST /api/chat.' });
      return;
    }

    const upstreamAbort = new AbortController();
    let completed = false;
    let runId: string = randomUUID();
    const abortUpstream = (reason: string) => {
      if (!completed) {
        console.debug('[hvy:chat-proxy] client connection closed before completion', { reason });
        upstreamAbort.abort();
      }
    };
    req.on('aborted', () => abortUpstream('request aborted'));
    res.on('close', () => abortUpstream('response closed'));

    try {
      const body = validateProxyChatRequest(await readRequestJson(req));
      runId = body.traceRunId ?? runId;
      if (upstreamAbort.signal.aborted) {
        console.debug('[hvy:chat-proxy] request body read after abort; skipping upstream request');
        writeTrace({
          runId,
          phase: 'proxy',
          type: 'stop',
          payload: { reason: 'client aborted after request body read' },
        });
        return;
      }
      writeTrace({
        runId,
        phase: body.mode,
        type: 'request_context',
        payload: {
          provider: body.provider,
          model: body.model,
          mode: body.mode,
          messages: body.messages,
          context: body.context,
        },
      });
      console.debug('[hvy:chat-proxy] incoming request', {
        provider: body.provider,
        model: body.model,
        messages: body.messages,
        contextLength: body.context.length,
      });
      const completion = await requestProviderWithRepair(body, env, upstreamAbort.signal, runId);
      completed = true;
      console.debug('[hvy:chat-proxy] sending response', {
        outputLength: completion.output.length,
      });
      writeTrace({
        runId,
        phase: body.mode,
        type: 'stop',
        payload: { reason: 'completed', outputLength: completion.output.length },
      });
      sendJson(res, 200, {
        output: completion.output,
        ...(completion.reasoningSummary ? { reasoningSummary: completion.reasoningSummary } : {}),
        ...(completion.usage ? { usage: completion.usage } : {}),
        ...(completion.toolCalls ? { toolCalls: completion.toolCalls } : {}),
        ...(completion.nativeMessages ? { nativeMessages: completion.nativeMessages } : {}),
        ...(completion.toolState ? { toolState: completion.toolState } : {}),
      });
    } catch (error) {
      if (isAbortError(error) || upstreamAbort.signal.aborted) {
        console.debug('[hvy:chat-proxy] upstream request aborted');
        writeTrace({
          runId,
          phase: 'proxy',
          type: 'stop',
          payload: { reason: 'aborted' },
        });
        return;
      }
      completed = true;
      const message = error instanceof Error ? error.message : 'Proxy chat request failed.';
      const status = message.startsWith('Provider request failed:') ? 502 : 400;
      console.debug('[hvy:chat-proxy] sending error response', {
        status,
        message,
      });
      writeTrace({
        runId,
        phase: 'proxy',
        type: 'error',
        payload: { status, message },
      });
      sendJson(res, status, { error: message });
    }
  };
}

export function extractOpenAiText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  const record = payload as {
    output_text?: unknown;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };

  if (typeof record.output_text === 'string' && record.output_text.trim().length > 0) {
    return record.output_text.trim();
  }

  const messageTexts = (record.output ?? [])
    .filter((item) => (item as { type?: string }).type === 'message')
    .flatMap((item) => item.content ?? [])
    .map((item) => (item.type === 'output_text' && typeof item.text === 'string' ? item.text : ''))
    .filter((value) => value.trim().length > 0);
  if (messageTexts.length > 0) {
    return messageTexts.map((message) => message.trim()).join('\n\n');
  }

  return (record.output ?? [])
    .flatMap((item) => item.content ?? [])
    .map((item) => (item.type === 'output_text' && typeof item.text === 'string' ? item.text : ''))
    .find((value) => value.trim().length > 0)
    ?.trim() ?? '';
}

export function extractOpenAiReasoningSummary(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  const record = payload as {
    output?: Array<{
      type?: string;
      summary?: Array<{ type?: string; text?: string }>;
      content?: Array<{ type?: string; text?: string }>;
    }>;
  };
  return (record.output ?? [])
    .filter((item) => item.type === 'reasoning')
    .flatMap((item) => [
      ...(item.summary ?? []).map((summary) => (typeof summary.text === 'string' ? summary.text : '')),
      ...(item.content ?? []).map((content) => (typeof content.text === 'string' ? content.text : '')),
    ])
    .filter((value) => value.trim().length > 0)
    .join('\n')
    .trim();
}

export function extractAnthropicText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  const record = payload as { content?: Array<{ type?: string; text?: string }> };
  return (record.content ?? [])
    .map((item) => (item.type === 'text' && typeof item.text === 'string' ? item.text : ''))
    .filter((value) => value.trim().length > 0)
    .join('\n')
    .trim();
}

export function extractAnthropicReasoningSummary(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  const record = payload as { content?: Array<{ type?: string; text?: string; thinking?: string }> };
  return (record.content ?? [])
    .map((item) => (item.type === 'thinking' && typeof item.thinking === 'string' ? item.thinking : ''))
    .filter((value) => value.trim().length > 0)
    .join('\n')
    .trim();
}

async function requestProviderWithRepair(
  body: ProxyChatRequest,
  env: Record<string, string | undefined>,
  signal: AbortSignal | undefined,
  runId: string
): Promise<ProviderCompletion> {
  const initialCompletion = await requestProviderOnce(body, env, signal, runId);
  if (body.mode === 'document-edit' || body.mode === 'pdf-template-import') {
    return initialCompletion;
  }
  const diagnostics = getHvyResponseDiagnostics(initialCompletion.output);
  if (diagnostics.length === 0) {
    return initialCompletion;
  }

  console.debug('[hvy:chat-proxy] response diagnostics', diagnostics);
  writeTrace({
    runId,
    phase: body.mode,
    type: 'invalid_response',
    payload: { diagnostics },
  });

  const repairRequest: ProxyChatRequest = {
    ...body,
    messages: [
      ...body.messages,
      {
        role: 'assistant',
        content: initialCompletion.output,
      },
      {
        role: 'user',
        content: buildRepairPrompt(diagnostics),
      },
    ],
  };

  const repairedCompletion = await requestProviderOnce(repairRequest, env, signal, runId);
  const repairedDiagnostics = getHvyResponseDiagnostics(repairedCompletion.output);
  console.debug('[hvy:chat-proxy] repaired response diagnostics', repairedDiagnostics);
  return repairedCompletion;
}

async function requestProviderOnce(
  body: ProxyChatRequest,
  env: Record<string, string | undefined>,
  signal: AbortSignal | undefined,
  runId: string
): Promise<ProviderCompletion> {
  if (body.tools && body.tools.length > 0) {
    return requestProviderToolTurn(body, env, signal, runId);
  }
  if (body.provider === 'openai') {
    return requestOpenAi(body, env, signal, runId);
  }
  if (body.provider === 'qwen') {
    return requestQwen(body, env, signal, runId);
  }
  return requestAnthropic(body, env, signal, runId);
}

export function buildRepairPrompt(diagnostics: HvyDiagnostic[]): string {
  const uniqueDiagnostics = diagnostics
    .map((diagnostic) => ({
      message: diagnostic.message,
      hint: getHvyDiagnosticUsageHint(diagnostic),
    }))
    .filter(
      (entry, index, all) =>
        all.findIndex((candidate) => candidate.message === entry.message && candidate.hint === entry.hint) === index
    )
    .slice(0, 6);

  const issues = uniqueDiagnostics
    .map(
      (entry) => `- ${entry.message}
  Hint: ${entry.hint}`
    )
    .join('\n');

  return `Revise your previous HVY response so it is valid HVY.

Issues:
${issues}

Return the full corrected HVY response body only. Do not add commentary outside the HVY response.`;
}

async function requestOpenAi(
  body: ProxyChatRequest,
  env: Record<string, string | undefined>,
  signal: AbortSignal | undefined,
  runId: string
): Promise<ProviderCompletion> {
  const apiKey = resolveProviderApiKey('openai', env);
  const upstreamRequest = buildOpenAiProxyRequest(body);
  console.debug('[hvy:chat-proxy] upstream openai request', upstreamRequest);
  writeTrace({
    runId,
    phase: body.mode,
    type: 'provider_request',
    payload: { provider: 'openai', request: upstreamRequest },
  });
  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(upstreamRequest),
    signal,
  });
  const payload = await readJsonResponse(response);
  console.debug('[hvy:chat-proxy] upstream openai response', {
    ok: response.ok,
    status: response.status,
    payload,
  });
  writeTrace({
    runId,
    phase: body.mode,
    type: 'provider_response',
    payload: { provider: 'openai', ok: response.ok, status: response.status, payload },
  });
  if (!response.ok) {
    throw new Error(`Provider request failed: ${extractProviderError(payload, 'OpenAI request failed.')}`);
  }
  const output = extractOpenAiText(payload);
  const reasoningSummary = extractOpenAiReasoningSummary(payload);
  const usage = extractProviderTokenUsage(payload);
  console.debug('[hvy:chat-proxy] upstream openai extracted output', output);
  writeTrace({
    runId,
    phase: body.mode,
    type: 'model_response',
    payload: { response: output, reasoningSummary },
  });
  if (output.length === 0) {
    throw new Error('Provider request failed: OpenAI returned no assistant text.');
  }
  return { output, reasoningSummary, ...(usage ? { usage } : {}) };
}

async function requestProviderToolTurn(
  body: ProxyChatRequest,
  env: Record<string, string | undefined>,
  signal: AbortSignal | undefined,
  runId: string
): Promise<ProviderCompletion> {
  const apiKey = resolveProviderApiKey(body.provider, env);
  const toolRequest = body as ProviderToolProxyChatRequest;
  const toolState = buildInitialProviderToolState(toolRequest);
  const upstreamRequest = buildProviderToolProxyRequest({
    ...toolRequest,
    toolState,
  });
  console.debug(`[hvy:chat-proxy] upstream ${body.provider} native tool request`, upstreamRequest);
  writeTrace({
    runId,
    phase: body.mode,
    type: 'provider_request',
    payload: { provider: body.provider, request: upstreamRequest },
  });
  const response = await fetch(resolveProviderApiUrl(body.provider), {
    method: 'POST',
    headers: buildProviderHeaders(body.provider, apiKey),
    body: JSON.stringify(upstreamRequest),
    signal,
  });
  const payload = await readJsonResponse(response);
  console.debug(`[hvy:chat-proxy] upstream ${body.provider} native tool response`, {
    ok: response.ok,
    status: response.status,
    payload,
  });
  writeTrace({
    runId,
    phase: body.mode,
    type: 'provider_response',
    payload: { provider: body.provider, ok: response.ok, status: response.status, payload },
  });
  if (!response.ok) {
    throw new Error(`Provider request failed: ${extractProviderError(payload, `${body.provider} request failed.`)}`);
  }
  const turn = extractProviderToolTurn(body.provider, payload);
  const usage = extractProviderTokenUsage(payload);
  writeTrace({
    runId,
    phase: body.mode,
    type: 'model_response',
    payload: {
      response: turn.output,
      reasoningSummary: turn.reasoningSummary,
      toolCalls: turn.toolCalls,
    },
  });
  if (turn.output.length === 0 && turn.toolCalls.length === 0) {
    throw new Error(`Provider request failed: ${body.provider} returned no assistant text or tool calls.`);
  }
  return {
    output: turn.output,
    reasoningSummary: turn.reasoningSummary,
    ...(usage ? { usage } : {}),
    toolCalls: turn.toolCalls,
    nativeMessages: turn.nativeMessages,
    toolState,
  };
}

async function requestAnthropic(
  body: ProxyChatRequest,
  env: Record<string, string | undefined>,
  signal: AbortSignal | undefined,
  runId: string
): Promise<ProviderCompletion> {
  const apiKey = resolveProviderApiKey('anthropic', env);
  const upstreamRequest = buildAnthropicProxyRequest(body);
  console.debug('[hvy:chat-proxy] upstream anthropic request', upstreamRequest);
  writeTrace({
    runId,
    phase: body.mode,
    type: 'provider_request',
    payload: { provider: 'anthropic', request: upstreamRequest },
  });
  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_API_VERSION,
    },
    body: JSON.stringify(upstreamRequest),
    signal,
  });
  const payload = await readJsonResponse(response);
  console.debug('[hvy:chat-proxy] upstream anthropic response', {
    ok: response.ok,
    status: response.status,
    payload,
  });
  writeTrace({
    runId,
    phase: body.mode,
    type: 'provider_response',
    payload: { provider: 'anthropic', ok: response.ok, status: response.status, payload },
  });
  if (!response.ok) {
    throw new Error(`Provider request failed: ${extractProviderError(payload, 'Anthropic request failed.')}`);
  }
  const output = extractAnthropicText(payload);
  const reasoningSummary = extractAnthropicReasoningSummary(payload);
  const usage = extractProviderTokenUsage(payload);
  console.debug('[hvy:chat-proxy] upstream anthropic extracted output', output);
  writeTrace({
    runId,
    phase: body.mode,
    type: 'model_response',
    payload: { response: output, reasoningSummary },
  });
  if (output.length === 0) {
    throw new Error('Provider request failed: Anthropic returned no assistant text.');
  }
  return { output, reasoningSummary, ...(usage ? { usage } : {}) };
}

async function requestQwen(
  body: ProxyChatRequest,
  env: Record<string, string | undefined>,
  signal: AbortSignal | undefined,
  runId: string
): Promise<ProviderCompletion> {
  const apiKey = resolveProviderApiKey('qwen', env);
  const upstreamRequest = buildProviderToolProxyRequest({
    ...(body as ProviderToolProxyChatRequest),
    tools: [],
  });
  console.debug('[hvy:chat-proxy] upstream qwen request', upstreamRequest);
  writeTrace({
    runId,
    phase: body.mode,
    type: 'provider_request',
    payload: { provider: 'qwen', request: upstreamRequest },
  });
  const response = await fetch(QWEN_API_URL, {
    method: 'POST',
    headers: buildProviderHeaders('qwen', apiKey),
    body: JSON.stringify(upstreamRequest),
    signal,
  });
  const payload = await readJsonResponse(response);
  writeTrace({
    runId,
    phase: body.mode,
    type: 'provider_response',
    payload: { provider: 'qwen', ok: response.ok, status: response.status, payload },
  });
  if (!response.ok) {
    throw new Error(`Provider request failed: ${extractProviderError(payload, 'Qwen request failed.')}`);
  }
  const turn = extractProviderToolTurn('qwen', payload);
  const usage = extractProviderTokenUsage(payload);
  if (turn.output.length === 0) {
    throw new Error('Provider request failed: Qwen returned no assistant text.');
  }
  return { output: turn.output, reasoningSummary: '', ...(usage ? { usage } : {}) };
}

function resolveProviderApiKey(provider: ProxyChatRequest['provider'], env: Record<string, string | undefined>): string {
  const key = provider === 'openai'
    ? firstNonEmptyString(env.OPENAI_API_KEY, env.VITE_OPENAI_API_KEY)
    : provider === 'anthropic'
    ? firstNonEmptyString(env.ANTHROPIC_API_KEY, env.VITE_ANTHROPIC_API_KEY)
    : firstNonEmptyString(env.QWEN_API_KEY, env.DASHSCOPE_API_KEY, env.VITE_QWEN_API_KEY, env.VITE_DASHSCOPE_API_KEY);

  if (!key) {
    throw new Error(
      provider === 'openai'
        ? 'OPENAI_API_KEY is not configured for the local proxy.'
        : provider === 'anthropic'
        ? 'ANTHROPIC_API_KEY is not configured for the local proxy.'
        : 'QWEN_API_KEY or DASHSCOPE_API_KEY is not configured for the local proxy.'
    );
  }

  return key;
}

function resolveProviderApiUrl(provider: ProxyChatRequest['provider']): string {
  if (provider === 'anthropic') {
    return ANTHROPIC_API_URL;
  }
  if (provider === 'qwen') {
    return QWEN_API_URL;
  }
  return OPENAI_API_URL;
}

async function requestOpenAiEmbeddings(
  body: ProxyEmbeddingRequest,
  env: Record<string, string | undefined>,
  signal: AbortSignal
): Promise<unknown> {
  const apiKey = resolveProviderApiKey('openai', env);
  const upstreamRequest = {
    model: body.model,
    input: body.input,
    ...(body.dimensions !== undefined ? { dimensions: body.dimensions } : {}),
  };
  const response = await fetch(OPENAI_EMBEDDINGS_API_URL, {
    method: 'POST',
    headers: buildProviderHeaders('openai', apiKey),
    body: JSON.stringify(upstreamRequest),
    signal,
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`Provider request failed: ${extractProviderError(payload, 'OpenAI embeddings request failed.')}`);
  }
  return payload;
}

function buildProviderHeaders(provider: ProxyChatRequest['provider'], apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
  if (provider === 'anthropic') {
    delete headers.Authorization;
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = ANTHROPIC_API_VERSION;
  }
  return headers;
}

function validateProxyChatRequest(payload: unknown): ProxyChatRequest {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid chat payload.');
  }

  const record = payload as Partial<ProxyChatRequest>;
  if (record.provider !== 'openai' && record.provider !== 'anthropic' && record.provider !== 'qwen') {
    throw new Error('Invalid chat provider.');
  }
  if (!isProxyChatMode(record.mode)) {
    throw new Error('Invalid chat mode.');
  }
  if (typeof record.model !== 'string' || record.model.trim().length === 0) {
    throw new Error('Chat model is required.');
  }
  if (typeof record.context !== 'string') {
    throw new Error('Chat context must be a string.');
  }
  if (!Array.isArray(record.messages) || record.messages.length === 0) {
    throw new Error('At least one chat message is required.');
  }

  const messages = record.messages.map((message) => {
    if (!message || typeof message !== 'object') {
      throw new Error('Invalid chat message.');
    }
    const typed = message as ProxyChatRequest['messages'][number];
    if ((typed.role !== 'system' && typed.role !== 'user' && typed.role !== 'assistant') || typeof typed.content !== 'string' || typed.content.trim().length === 0) {
      throw new Error('Invalid chat message.');
    }
    return {
      role: typed.role,
      content: typed.content,
    };
  });

  const request: ProxyChatRequest = {
    provider: record.provider,
    model: record.model.trim(),
    mode: record.mode,
    traceRunId: typeof record.traceRunId === 'string' && /^[\w:-]{1,120}$/.test(record.traceRunId) ? record.traceRunId : undefined,
    context: record.context,
    messages,
  };
  if (
    record.openAiReasoningEffort === 'none'
    || record.openAiReasoningEffort === 'low'
    || record.openAiReasoningEffort === 'medium'
    || record.openAiReasoningEffort === 'high'
  ) {
    request.openAiReasoningEffort = record.openAiReasoningEffort;
  }
  if (Array.isArray(record.tools)) {
    request.tools = validateProviderToolDefinitions(record.tools);
  }
  if (record.toolState && typeof record.toolState === 'object') {
    request.toolState = record.toolState as ProviderToolState;
  }
  return request;
}

function validateProxyEmbeddingRequest(payload: unknown): ProxyEmbeddingRequest {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid embedding payload.');
  }
  const record = payload as Partial<ProxyEmbeddingRequest>;
  if (typeof record.model !== 'string' || record.model.trim().length === 0) {
    throw new Error('Embedding model is required.');
  }
  if (!Array.isArray(record.input) || record.input.length === 0) {
    throw new Error('Embedding input is required.');
  }
  const input = record.input.map((value) => {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error('Embedding input entries must be non-empty strings.');
    }
    return value;
  });
  const request: ProxyEmbeddingRequest = {
    model: record.model.trim(),
    input,
  };
  if (typeof record.dimensions === 'number' && Number.isFinite(record.dimensions)) {
    request.dimensions = Math.max(1, Math.floor(record.dimensions));
  }
  return request;
}

function validateProviderToolDefinitions(value: unknown[]): ProviderToolDefinition[] {
  return value.map((tool) => {
    if (!tool || typeof tool !== 'object' || Array.isArray(tool)) {
      throw new Error('Invalid native tool definition.');
    }
    const record = tool as Partial<ProviderToolDefinition>;
    if (typeof record.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(record.name)) {
      throw new Error('Invalid native tool name.');
    }
    if (typeof record.description !== 'string' || record.description.trim().length === 0) {
      throw new Error('Invalid native tool description.');
    }
    if (!record.inputSchema || typeof record.inputSchema !== 'object' || Array.isArray(record.inputSchema)) {
      throw new Error('Invalid native tool input schema.');
    }
    return {
      name: record.name,
      description: record.description,
      inputSchema: record.inputSchema as Record<string, unknown>,
      ...(record.strict ? { strict: true } : {}),
    };
  });
}

function validateClientTraceEvent(payload: unknown): TraceEvent {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid trace payload.');
  }
  const record = payload as Partial<TraceEvent>;
  if (typeof record.runId !== 'string' || !/^[\w:-]{1,120}$/.test(record.runId)) {
    throw new Error('Trace runId is required.');
  }
  if (record.phase !== 'proxy' && !isProxyChatMode(record.phase)) {
    throw new Error('Invalid trace phase.');
  }
  if (record.type !== 'progress' && record.type !== 'client_event' && record.type !== 'work_ledger') {
    throw new Error('Client traces may only use progress, client_event, or work_ledger.');
  }
  if (!record.payload || typeof record.payload !== 'object' || Array.isArray(record.payload)) {
    throw new Error('Trace payload must be an object.');
  }
  return {
    runId: record.runId,
    phase: record.phase,
    type: record.type,
    payload: record.payload as Record<string, unknown>,
  };
}

function isProxyChatMode(value: unknown): value is ProviderProxyChatRequest['mode'] {
  return value === 'qa' || value === 'component-edit' || value === 'document-edit' || value === 'pdf-template-import';
}

async function readRequestJson(req: { on: (event: string, listener: (chunk?: unknown) => void) => void }): Promise<unknown> {
  const chunks: Uint8Array[] = await new Promise((resolve, reject) => {
    const collected: Uint8Array[] = [];
    req.on('data', (chunk?: unknown) => {
      if (chunk instanceof Uint8Array) {
        collected.push(chunk);
        return;
      }
      if (typeof chunk === 'string') {
        collected.push(new TextEncoder().encode(chunk));
      }
    });
    req.on('end', () => resolve(collected));
    req.on('error', (error?: unknown) => reject(error));
  });
  const raw = decodeUtf8(chunks);
  if (!raw) {
    return null;
  }
  return JSON.parse(raw);
}

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function extractProviderError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') {
    return fallback;
  }
  const record = payload as {
    error?: {
      message?: unknown;
      type?: unknown;
    };
  };

  if (typeof record.error?.message === 'string' && record.error.message.trim().length > 0) {
    return record.error.message;
  }
  if (typeof record.error?.type === 'string' && record.error.type.trim().length > 0) {
    return `${fallback} (${record.error.type})`;
  }
  return fallback;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function sendJson(res: { statusCode: number; setHeader: (name: string, value: string) => void; end: (chunk: string) => void }, status: number, body: Record<string, unknown>): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export function formatTraceEvent(event: TraceEvent, date = new Date()): string {
  return JSON.stringify({
    timestamp: date.toISOString(),
    ...event,
  }) + '\n';
}

export function formatTraceTextEvent(event: TraceEvent, date = new Date()): string {
  const timestamp = date.toISOString();
  const summary = summarizeTracePayload(event);
  return `[${timestamp}] ${event.runId} ${event.phase} ${event.type}${summary ? ` :: ${summary}` : ''}\n`;
}

export function pruneTraceLines(
  contents: string,
  maxLines = AGENT_LOOP_TRACE_MAX_LINES,
  pruneLines = AGENT_LOOP_TRACE_PRUNE_LINES
): string {
  const lines = contents.split('\n');
  if (lines.at(-1) === '') {
    lines.pop();
  }
  while (lines.length > maxLines) {
    lines.splice(0, Math.min(pruneLines, lines.length));
  }
  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
}

function writeTrace(event: TraceEvent): void {
  const line = formatTraceEvent(event);
  const textLine = formatTraceTextEvent(event);
  traceWriteQueue = traceWriteQueue
    .then(async () => {
      await fs.mkdir(DEV_TRACE_DIR, { recursive: true });
      await fs.appendFile(AGENT_LOOP_TRACE_FILE, line, 'utf8');
      await fs.appendFile(AGENT_LOOP_TEXT_TRACE_FILE, textLine, 'utf8');
      const contents = await fs.readFile(AGENT_LOOP_TRACE_FILE, 'utf8');
      const prunedContents = pruneTraceLines(contents);
      if (prunedContents.length !== contents.length) {
        await fs.writeFile(AGENT_LOOP_TRACE_FILE, prunedContents, 'utf8');
      }
      const textContents = await fs.readFile(AGENT_LOOP_TEXT_TRACE_FILE, 'utf8');
      const prunedTextContents = pruneTraceLines(textContents);
      if (prunedTextContents.length !== textContents.length) {
        await fs.writeFile(AGENT_LOOP_TEXT_TRACE_FILE, prunedTextContents, 'utf8');
      }
      const aiCliLogEntry = formatAiCliLogEvent(event);
      if (aiCliLogEntry) {
        await fs.appendFile(AI_CLI_LOG_FILE, aiCliLogEntry, 'utf8');
        const aiCliLogContents = await fs.readFile(AI_CLI_LOG_FILE, 'utf8');
        const prunedAiCliLogContents = pruneTraceLines(aiCliLogContents, AI_CLI_LOG_MAX_LINES, AI_CLI_LOG_PRUNE_LINES);
        if (prunedAiCliLogContents.length !== aiCliLogContents.length) {
          await fs.writeFile(AI_CLI_LOG_FILE, prunedAiCliLogContents, 'utf8');
        }
      }
      const aiCliMessagesLogEntry = formatAiCliMessagesLogEvent(event);
      if (aiCliMessagesLogEntry) {
        await fs.appendFile(AI_CLI_MESSAGES_LOG_FILE, aiCliMessagesLogEntry, 'utf8');
        const aiCliMessagesLogContents = await fs.readFile(AI_CLI_MESSAGES_LOG_FILE, 'utf8');
        const prunedAiCliMessagesLogContents = pruneTraceLines(aiCliMessagesLogContents, AI_CLI_LOG_MAX_LINES, AI_CLI_LOG_PRUNE_LINES);
        if (prunedAiCliMessagesLogContents.length !== aiCliMessagesLogContents.length) {
          await fs.writeFile(AI_CLI_MESSAGES_LOG_FILE, prunedAiCliMessagesLogContents, 'utf8');
        }
      }
      const failedCliCommandEntry = formatFailedCliCommandLogEvent(event);
      if (failedCliCommandEntry) {
        await fs.appendFile(FAILED_CLI_COMMANDS_LOG_FILE, failedCliCommandEntry, 'utf8');
        const failedCliCommandContents = await fs.readFile(FAILED_CLI_COMMANDS_LOG_FILE, 'utf8');
        const prunedFailedCliCommandContents = pruneTraceLines(failedCliCommandContents, AI_CLI_LOG_MAX_LINES, AI_CLI_LOG_PRUNE_LINES);
        if (prunedFailedCliCommandContents.length !== failedCliCommandContents.length) {
          await fs.writeFile(FAILED_CLI_COMMANDS_LOG_FILE, prunedFailedCliCommandContents, 'utf8');
        }
      }
    })
    .catch((error: unknown) => {
      console.warn('[hvy:chat-proxy] failed to write dev trace', error);
    });
}

export function formatFailedCliCommandLogEvent(event: TraceEvent): string {
  if (!event.runId.startsWith('chat-cli-')) {
    return '';
  }
  if (event.type !== 'client_event' || event.payload.event !== 'ai_cli_failed_command') {
    return '';
  }
  return formatAiCliLogBlock([
    `run: ${event.runId}`,
    `CMD: ${String(event.payload.command ?? '').trim()}`,
    String(event.payload.error ?? '').trimEnd(),
  ]);
}

export function formatAiCliLogEvent(event: TraceEvent): string {
  if (!event.runId.startsWith('chat-cli-')) {
    return '';
  }
  if (event.type === 'client_event' && event.payload.event === 'ai_cli_user_query') {
    return formatAiCliLogBlock(['user query', String(event.payload.query ?? '').trim()]);
  }
  if (event.type === 'client_event' && event.payload.event === 'ai_cli_command') {
    const modelMessage = typeof event.payload.modelMessage === 'string' ? event.payload.modelMessage.trimEnd() : '';
    return formatAiCliLogBlock([
      `CMD: ${String(event.payload.command ?? '').trim()}`,
      modelMessage || String(event.payload.output ?? '').trimEnd(),
    ]);
  }
  if (event.type === 'provider_response') {
    const usage = summarizeProviderTokenUsage(event.payload.payload).replace(/^usage=/, '').replaceAll(',', ', ');
    return usage ? formatAiCliLogBlock(['token usage', usage]) : '';
  }
  if (event.type === 'model_response' && typeof event.payload.response === 'string') {
    const reasoningSummary = typeof event.payload.reasoningSummary === 'string' ? event.payload.reasoningSummary.trimEnd() : '';
    return formatAiCliLogBlock([
      'model response',
      event.payload.response.trimEnd() || '(empty)',
      ...(reasoningSummary ? ['', 'reasoning summary', reasoningSummary] : []),
    ]);
  }
  return '';
}

export function formatAiCliMessagesLogEvent(event: TraceEvent): string {
  if (!event.runId.startsWith('chat-cli-')) {
    return '';
  }
  if (event.type === 'provider_request') {
    return formatAiCliLogBlock(['provider_request', formatJsonForAiCliMessagesLog(event.payload.request)]);
  }
  if (event.type === 'provider_response') {
    return formatAiCliLogBlock(['provider_response', formatJsonForAiCliMessagesLog(event.payload)]);
  }
  if (event.type === 'model_response') {
    return formatAiCliLogBlock([
      'model_response',
      formatJsonForAiCliMessagesLog({
        response: event.payload.response,
        reasoningSummary: event.payload.reasoningSummary,
      }),
    ]);
  }
  return '';
}

function formatAiCliLogBlock(lines: string[]): string {
  return ['--------', ...lines].join('\n').trimEnd() + '\n';
}

function formatJsonForAiCliMessagesLog(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? String(value);
}

function summarizeTracePayload(event: TraceEvent): string {
  const payload = event.payload;
  if (event.type === 'progress' && typeof payload.content === 'string') {
    return payload.content;
  }
  if (event.type === 'work_ledger') {
    const summary = typeof payload.summary === 'string' ? payload.summary : '';
    const action = typeof payload.action === 'string' ? payload.action : '';
    const intent = typeof payload.intent === 'string' ? payload.intent : '';
    return [
      summary ? `did=${truncateTraceText(summary, 220)}` : '',
      action ? `action=${truncateTraceText(action, 120)}` : '',
      intent ? `intent=${truncateTraceText(intent, 180)}` : '',
    ].filter(Boolean).join(' ');
  }
  if (event.type === 'model_response' && typeof payload.response === 'string') {
    return truncateTraceText(payload.response, 240);
  }
  if (event.type === 'request_context') {
    const messages = Array.isArray(payload.messages) ? payload.messages.length : 0;
    const context = typeof payload.context === 'string' ? payload.context : '';
    return `provider=${String(payload.provider ?? '')} model=${String(payload.model ?? '')} messages=${messages} context=${truncateTraceText(context, 240)}`;
  }
  if (event.type === 'provider_request') {
    const provider = typeof payload.provider === 'string' ? payload.provider : '';
    const request = payload.request && typeof payload.request === 'object'
      ? payload.request as Record<string, unknown>
      : {};
    return `provider=${provider} model=${String(request.model ?? '')}`;
  }
  if (event.type === 'provider_response') {
    const usage = summarizeProviderTokenUsage(payload.payload);
    return [
      `provider=${String(payload.provider ?? '')}`,
      `ok=${String(payload.ok ?? '')}`,
      `status=${String(payload.status ?? '')}`,
      usage,
    ].filter(Boolean).join(' ');
  }
  if (event.type === 'error') {
    return String(payload.message ?? payload.error ?? JSON.stringify(payload));
  }
  if (event.type === 'stop') {
    return `reason=${String(payload.reason ?? '')}`;
  }
  if (event.type === 'client_event') {
    if (payload.event === 'document_walk_notes' || payload.event === 'document_walk_chunks' || payload.event === 'ai_document_notes') {
      return `event=${String(payload.event)} chunks=${String(payload.chunks ?? '')}`;
    }
    return Object.entries(payload)
      .map(([key, value]) => `${key}=${truncateTraceText(String(value), 120)}`)
      .join(' ');
  }
  return truncateTraceText(JSON.stringify(payload), 240);
}

function summarizeProviderTokenUsage(payload: unknown): string {
  const usage = extractProviderTokenUsage(payload);
  if (!usage) {
    return '';
  }
  const parts = [
    typeof usage.inputTokens === 'number' ? `input_tokens=${usage.inputTokens}` : '',
    typeof usage.outputTokens === 'number' ? `output_tokens=${usage.outputTokens}` : '',
    typeof usage.totalTokens === 'number' ? `total_tokens=${usage.totalTokens}` : '',
    typeof usage.cachedTokens === 'number' ? `cached_tokens=${usage.cachedTokens}` : '',
    typeof usage.reasoningTokens === 'number' ? `reasoning_tokens=${usage.reasoningTokens}` : '',
  ].filter(Boolean);
  return parts.length > 0 ? `usage=${parts.join(',')}` : '';
}

function extractProviderTokenUsage(payload: unknown): ProviderTokenUsage | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const usage = (payload as { usage?: unknown }).usage;
  if (!usage || typeof usage !== 'object') {
    return null;
  }
  const record = usage as Record<string, unknown>;
  const inputTokens = readNumber(record.input_tokens) ?? readNumber(record.prompt_tokens);
  const outputTokens = readNumber(record.output_tokens) ?? readNumber(record.completion_tokens);
  const totalTokens = readNumber(record.total_tokens) ?? (typeof inputTokens === 'number' && typeof outputTokens === 'number' ? inputTokens + outputTokens : undefined);
  const cachedTokens = readNumber((record.input_tokens_details as Record<string, unknown> | undefined)?.cached_tokens)
    ?? readNumber((record.cache_read_input_tokens as Record<string, unknown> | undefined)?.cached_tokens)
    ?? readNumber(record.cache_read_input_tokens);
  const reasoningTokens = readNumber((record.output_tokens_details as Record<string, unknown> | undefined)?.reasoning_tokens);
  const result: ProviderTokenUsage = {
    ...(typeof inputTokens === 'number' ? { inputTokens } : {}),
    ...(typeof outputTokens === 'number' ? { outputTokens } : {}),
    ...(typeof totalTokens === 'number' ? { totalTokens } : {}),
    ...(typeof cachedTokens === 'number' ? { cachedTokens } : {}),
    ...(typeof reasoningTokens === 'number' ? { reasoningTokens } : {}),
  };
  return Object.keys(result).length > 0 ? result : null;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function truncateTraceText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function firstNonEmptyString(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return '';
}

function decodeUtf8(chunks: Uint8Array[]): string {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(combined);
}
