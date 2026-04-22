import type { ChatMessage, ChatSettings, ChatState, VisualDocument } from './types';
import { serializeDocument } from './serialization';

const CHAT_STORAGE_KEY = 'hvy-chat-settings';
const DEFAULT_OPENAI_MODEL = 'gpt-5-mini';
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6';

interface RenderChatPanelDeps {
  escapeAttr: (value: string) => string;
  escapeHtml: (value: string) => string;
}

interface ProxyChatRequest {
  provider: ChatSettings['provider'];
  model: string;
  messages: ChatMessage[];
  context: string;
}

interface ProxyChatResponse {
  output: string;
}

export function createDefaultChatState(): ChatState {
  return {
    settings: loadChatSettings(),
    draft: '',
    messages: [],
    isSending: false,
    error: null,
  };
}

export function clearChatConversation(chat: ChatState): void {
  chat.draft = '';
  chat.messages = [];
  chat.isSending = false;
  chat.error = null;
}

export function persistChatSettings(settings: ChatSettings): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  window.localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(settings));
}

export function loadChatSettings(): ChatSettings {
  const defaults = getDefaultChatSettings();
  if (typeof window === 'undefined' || !window.localStorage) {
    return defaults;
  }

  try {
    const raw = window.localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) {
      return defaults;
    }
    const parsed = JSON.parse(raw) as Partial<ChatSettings> | null;
    return mergeChatSettings(parsed, defaults);
  } catch {
    return defaults;
  }
}

export function stripDocumentHeaderAndComments(source: string): string {
  const withoutFrontMatter = source.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n)?/, '');
  const withoutComments = withoutFrontMatter.replace(/<!--[\s\S]*?-->/g, '');
  return withoutComments
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function buildChatDocumentContext(document: VisualDocument): string {
  return stripDocumentHeaderAndComments(serializeDocument(document));
}

export function renderChatPanel(chat: ChatState, document: VisualDocument, deps: RenderChatPanelDeps): string {
  const context = buildChatDocumentContext(document);
  const currentProviderLabel = chat.settings.provider === 'openai' ? 'OpenAI' : 'Anthropic';
  const hasDraft = chat.draft.trim().length > 0;
  const missingModel = chat.settings.model.trim().length === 0;
  const canSend = !chat.isSending && context.length > 0;

  return `
    <aside class="chat-panel" aria-label="Document chat">
      <div class="chat-panel-head">
        <div>
          <h2>Ask This Document</h2>
          <p>Separate from the reader. Requests go through a local proxy so provider API keys stay out of the browser.</p>
        </div>
        <button type="button" class="ghost" data-action="clear-chat-history"${chat.messages.length === 0 ? ' disabled' : ''}>Clear Chat</button>
      </div>

      <div class="chat-settings">
        <label class="chat-setting">
          <span>Provider</span>
          <select data-field="chat-provider" aria-label="Chat provider">
            <option value="openai"${chat.settings.provider === 'openai' ? ' selected' : ''}>OpenAI</option>
            <option value="anthropic"${chat.settings.provider === 'anthropic' ? ' selected' : ''}>Anthropic</option>
          </select>
        </label>

        <label class="chat-setting">
          <span>Model</span>
          <input
            type="text"
            data-field="chat-model"
            value="${deps.escapeAttr(chat.settings.model)}"
            placeholder="${deps.escapeAttr(currentProviderLabel === 'OpenAI' ? DEFAULT_OPENAI_MODEL : DEFAULT_ANTHROPIC_MODEL)}"
            autocapitalize="off"
            autocomplete="off"
            spellcheck="false"
            aria-label="Chat model"
          />
        </label>
      </div>

      <div class="chat-context-card">
        <strong>Context source</strong>
        <p>Current HVY body with YAML front matter and every HTML comment removed for this first pass.</p>
        <div class="chat-context-meta">
          <span>${context.length.toLocaleString()} chars</span>
          <span>${chat.messages.length} messages</span>
          <span>${deps.escapeHtml(currentProviderLabel)}</span>
        </div>
      </div>

      ${chat.error ? `<div class="chat-error" role="alert">${deps.escapeHtml(chat.error)}</div>` : ''}

      <div class="chat-thread" aria-live="polite">
        ${
          chat.messages.length === 0
            ? `<div class="chat-empty">
                 <strong>Start by asking a question about the visible HVY document.</strong>
                 <p>The browser sends your prompt to a same-origin proxy, and that proxy talks to the model provider.</p>
               </div>`
            : chat.messages
                .map(
                  (message) => `
                    <article class="chat-bubble chat-bubble-${message.role}${message.error ? ' chat-bubble-error' : ''}">
                      <div class="chat-bubble-role">${deps.escapeHtml(message.role === 'user' ? 'You' : 'Assistant')}</div>
                      <div class="chat-bubble-body">${deps.escapeHtml(message.content).replace(/\n/g, '<br />')}</div>
                    </article>
                  `
                )
                .join('')
        }
      </div>

      <form id="chatComposer" class="chat-composer">
        <label class="chat-composer-field">
          <span>Question</span>
          <textarea data-field="chat-input" rows="5" placeholder="Ask about the current HVY document..." ${chat.isSending ? 'disabled' : ''}>${deps.escapeHtml(chat.draft)}</textarea>
        </label>
        <div class="chat-composer-actions">
          <span class="chat-composer-status">
            ${
              chat.isSending
                ? 'Waiting for model response...'
                : missingModel
                ? 'Choose a model before sending.'
                : !hasDraft
                ? 'Type a question to send.'
                : 'Ready'
            }
          </span>
          <button type="submit" class="secondary"${canSend ? '' : ' disabled'}>${chat.isSending ? 'Sending...' : 'Send'}</button>
        </div>
      </form>
    </aside>
  `;
}

export async function requestChatCompletion(params: {
  settings: ChatSettings;
  document: VisualDocument;
  messages: ChatMessage[];
}): Promise<string> {
  const context = buildChatDocumentContext(params.document);
  if (context.trim().length === 0) {
    throw new Error('The document body is empty after removing front matter and comments.');
  }

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildProxyChatRequest({
      provider: params.settings.provider,
      model: params.settings.model,
      messages: params.messages,
      context,
    })),
  });

  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(extractProxyError(payload, 'Chat request failed.'));
  }

  if (typeof (payload as ProxyChatResponse | null)?.output !== 'string' || (payload as ProxyChatResponse).output.trim().length === 0) {
    throw new Error('Proxy returned no assistant text.');
  }

  return (payload as ProxyChatResponse).output.trim();
}

export function buildProxyChatRequest(request: ProxyChatRequest): ProxyChatRequest {
  return {
    provider: request.provider,
    model: request.model.trim(),
    messages: request.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      error: message.error,
    })),
    context: request.context,
  };
}

export function getEnvChatSettings(env: ImportMetaEnv = import.meta.env): ChatSettings {
  const provider = env.VITE_HVY_CHAT_PROVIDER === 'anthropic' ? 'anthropic' : 'openai';
  const providerDefaultModel = provider === 'anthropic' ? DEFAULT_ANTHROPIC_MODEL : DEFAULT_OPENAI_MODEL;
  const providerSpecificModel = provider === 'anthropic' ? env.VITE_ANTHROPIC_MODEL : env.VITE_OPENAI_MODEL;
  const model = firstNonEmptyString(env.VITE_HVY_CHAT_MODEL, providerSpecificModel, providerDefaultModel);

  return {
    provider,
    model,
  };
}

function getDefaultChatSettings(): ChatSettings {
  return getEnvChatSettings();
}

function sanitizeChatSettings(settings: Partial<ChatSettings> | null | undefined, defaults: ChatSettings): ChatSettings {
  return {
    provider: settings?.provider === 'anthropic' ? 'anthropic' : defaults.provider,
    model: typeof settings?.model === 'string' && settings.model.trim().length > 0 ? settings.model : defaults.model,
  };
}

export function mergeChatSettings(settings: Partial<ChatSettings> | null | undefined, defaults: ChatSettings): ChatSettings {
  const sanitized = sanitizeChatSettings(settings, defaults);
  return {
    provider: sanitized.provider,
    model: sanitized.model.trim().length > 0 ? sanitized.model : defaults.model,
  };
}

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function extractProxyError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') {
    return fallback;
  }
  const record = payload as { error?: unknown };
  if (typeof record.error === 'string' && record.error.trim().length > 0) {
    return record.error;
  }
  return fallback;
}

function firstNonEmptyString(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return '';
}
