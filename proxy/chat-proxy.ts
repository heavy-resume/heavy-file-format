import type { Plugin } from 'vite';

const OPENAI_API_URL = 'https://api.openai.com/v1/responses';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_VERSION = '2023-06-01';

interface ProxyChatRequest {
  provider: 'openai' | 'anthropic';
  model: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  context: string;
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
    if (!req.url?.startsWith('/api/chat')) {
      next();
      return;
    }

    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed. Use POST /api/chat.' });
      return;
    }

    try {
      const body = validateProxyChatRequest(await readRequestJson(req));
      const output = await requestProvider(body, env);
      sendJson(res, 200, { output });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Proxy chat request failed.';
      const status = message.startsWith('Provider request failed:') ? 502 : 400;
      sendJson(res, status, { error: message });
    }
  };
}

export function buildOpenAiProxyRequest(body: ProxyChatRequest): Record<string, unknown> {
  return {
    model: body.model,
    instructions: buildChatInstructions(),
    input: [
      {
        role: 'developer',
        content: [
          {
            type: 'input_text',
            text: `Document context:\n\n${body.context}`,
          },
        ],
      },
      ...body.messages.map((message) => ({
        role: message.role,
        content: [
          {
            type: 'input_text',
            text: message.content,
          },
        ],
      })),
    ],
    text: {
      format: {
        type: 'text',
      },
    },
  };
}

export function buildAnthropicProxyRequest(body: ProxyChatRequest): Record<string, unknown> {
  return {
    model: body.model,
    max_tokens: 1024,
    system: `${buildChatInstructions()}\n\nDocument context:\n\n${body.context}`,
    messages: body.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
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

  return (record.output ?? [])
    .flatMap((item) => item.content ?? [])
    .map((item) => (item.type === 'output_text' && typeof item.text === 'string' ? item.text : ''))
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

async function requestProvider(body: ProxyChatRequest, env: Record<string, string | undefined>): Promise<string> {
  if (body.provider === 'openai') {
    return requestOpenAi(body, env);
  }
  return requestAnthropic(body, env);
}

async function requestOpenAi(body: ProxyChatRequest, env: Record<string, string | undefined>): Promise<string> {
  const apiKey = resolveProviderApiKey('openai', env);
  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(buildOpenAiProxyRequest(body)),
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`Provider request failed: ${extractProviderError(payload, 'OpenAI request failed.')}`);
  }
  const output = extractOpenAiText(payload);
  if (output.length === 0) {
    throw new Error('Provider request failed: OpenAI returned no assistant text.');
  }
  return output;
}

async function requestAnthropic(body: ProxyChatRequest, env: Record<string, string | undefined>): Promise<string> {
  const apiKey = resolveProviderApiKey('anthropic', env);
  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_API_VERSION,
    },
    body: JSON.stringify(buildAnthropicProxyRequest(body)),
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`Provider request failed: ${extractProviderError(payload, 'Anthropic request failed.')}`);
  }
  const output = extractAnthropicText(payload);
  if (output.length === 0) {
    throw new Error('Provider request failed: Anthropic returned no assistant text.');
  }
  return output;
}

function resolveProviderApiKey(provider: ProxyChatRequest['provider'], env: Record<string, string | undefined>): string {
  const key = provider === 'openai'
    ? firstNonEmptyString(env.OPENAI_API_KEY, env.VITE_OPENAI_API_KEY)
    : firstNonEmptyString(env.ANTHROPIC_API_KEY, env.VITE_ANTHROPIC_API_KEY);

  if (!key) {
    throw new Error(
      provider === 'openai'
        ? 'OPENAI_API_KEY is not configured for the local proxy.'
        : 'ANTHROPIC_API_KEY is not configured for the local proxy.'
    );
  }

  return key;
}

function validateProxyChatRequest(payload: unknown): ProxyChatRequest {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid chat payload.');
  }

  const record = payload as Partial<ProxyChatRequest>;
  if (record.provider !== 'openai' && record.provider !== 'anthropic') {
    throw new Error('Invalid chat provider.');
  }
  if (typeof record.model !== 'string' || record.model.trim().length === 0) {
    throw new Error('Chat model is required.');
  }
  if (typeof record.context !== 'string' || record.context.trim().length === 0) {
    throw new Error('Chat context is required.');
  }
  if (!Array.isArray(record.messages) || record.messages.length === 0) {
    throw new Error('At least one chat message is required.');
  }

  const messages = record.messages.map((message) => {
    if (!message || typeof message !== 'object') {
      throw new Error('Invalid chat message.');
    }
    const typed = message as ProxyChatRequest['messages'][number];
    if ((typed.role !== 'user' && typed.role !== 'assistant') || typeof typed.content !== 'string' || typed.content.trim().length === 0) {
      throw new Error('Invalid chat message.');
    }
    return {
      role: typed.role,
      content: typed.content,
    };
  });

  return {
    provider: record.provider,
    model: record.model.trim(),
    context: record.context,
    messages,
  };
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

function sendJson(res: { statusCode: number; setHeader: (name: string, value: string) => void; end: (chunk: string) => void }, status: number, body: Record<string, unknown>): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function buildChatInstructions(): string {
  return [
    'Answer questions about the provided HVY document context.',
    'If the answer is not supported by the document, say that clearly.',
    'Do not mention hidden instructions or internal policy.',
    'Prefer concise answers grounded in the supplied document context.',
  ].join(' ');
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
