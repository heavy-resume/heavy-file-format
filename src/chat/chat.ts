import './chat.css';
import { getActiveStateRuntime, type StateRuntime } from '../state';
import type { ChatMessage, ChatSettings, ChatState, ChatTokenUsage, ChatWorkState, HvyChatContextOptions, HvyChatContextPreparationCallback, HvyChatContextProvider, HvyChatContextResult, HvyChatSearchCache, HvyEmbeddingProvider, VisualDocument } from '../types';
import { deserializeDocument, serializeDocument } from '../serialization';
import { markdownToEditorHtml, normalizeMarkdownLists } from '../markdown';
import aiResponseFormatInstructions from '../../AI-RESPONSE-FORMAT.md?raw';
import type { VisualBlock, VisualSection } from '../editor/types';
import type { ComponentRenderHelpers } from '../editor/component-helpers';
import { renderXrefCardReader } from '../editor/components/xref-card/xref-card';
import { renderComponentListReader } from '../editor/components/component-list/component-list';
import { renderContainerReader } from '../editor/components/container/container';
import { renderGridReader } from '../editor/components/grid/grid';
import { ensureComponentListBlocks, ensureExpandableBlocks, ensureGridItems } from '../document-factory';
import { isXrefTargetValid } from '../xref-ops';
import { getDocumentComponentDefaultCss } from '../document-component-defaults';
import { getTextLineStylesFromMeta } from '../text-line-styles';
import { wrapChatResponseAsDocument } from './chat-response-document';
import { getDocumentAiContext } from '../document-ai-context';
import { buildKeywordChatContext, isKeywordChatContextPrepared } from './chat-context';
import { buildEmbeddingChatContext, isEmbeddingChatContextPrepared } from './embedding-context';
import type { ProviderToolCall, ProviderToolDefinition, ProviderToolState } from './provider-tools';
import { closeIcon } from '../icons';
import { measureAsyncPhase, measurePhase } from '../perf-trace';

const CHAT_STORAGE_KEY = 'hvy-chat-settings';
const DEFAULT_OPENAI_MODEL = 'gpt-5.4-mini';
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const DEFAULT_QWEN_MODEL = 'qwen-plus';
export const DEFAULT_OPENAI_COMPACTION_MODEL = 'gpt-5.4-nano';
export const HVY_AI_RESPONSE_FORMAT_INSTRUCTIONS = aiResponseFormatInstructions;
export const MAX_PROXY_COMPLETION_CONTEXT_CHARS = 20_000;
export const ENABLE_CHAT_MODEL_DEBUG_CONTROLS = import.meta.env?.DEV === true || import.meta.env?.VITE_HVY_ENABLE_CHAT_MODEL_PICKER === 'true';
export const ENABLE_CHAT_CLI_SIM = import.meta.env?.DEV === true;
const ENABLE_CHAT_PROXY_DEBUG_LOGS = import.meta.env?.VITE_HVY_ENABLE_CHAT_PROXY_DEBUG_LOGS === 'true';
export type ChatControlSurface = 'reference' | 'embedded';

interface RenderChatPanelDeps {
  escapeAttr: (value: string) => string;
  escapeHtml: (value: string) => string;
}

export interface RenderChatContextControlsOptions {
  chatContext?: HvyChatContextOptions | null;
  embeddingAvailable?: boolean;
  canPersistEmbeddingCache?: boolean;
}

interface ProxyChatMessage {
  id?: string;
  role: 'system' | ChatMessage['role'];
  content: string;
  error?: boolean;
}

export type ProxyChatMode = 'qa' | 'component-edit' | 'document-edit' | 'pdf-template-import';

interface ProxyChatRequest {
  provider: ChatSettings['provider'];
  model: string;
  messages: ProxyChatMessage[];
  context: string;
  mode: ProxyChatMode;
  traceRunId?: string;
  tools?: ProviderToolDefinition[];
  toolState?: ProviderToolState;
}

interface ProxyChatRequestInput extends Omit<ProxyChatRequest, 'messages'> {
  messages: ChatMessage[];
  systemInstructions?: string;
}

interface ProxyChatResponse {
  output: string;
  reasoningSummary?: string;
  usage?: ChatTokenUsage;
  toolCalls?: ProviderToolCall[];
  nativeMessages?: unknown[];
  toolState?: ProviderToolState;
}

export interface HostChatClient {
  complete(request: ProxyChatRequest, options?: { signal?: AbortSignal; debugLabel?: string }): Promise<ProxyChatResponse>;
  toolTurn?(request: ProxyChatRequest, options?: { signal?: AbortSignal; debugLabel?: string }): Promise<ProxyChatResponse>;
}

let fallbackHostChatClient: HostChatClient | null = null;
const hostChatClientByRuntime = new WeakMap<StateRuntime, HostChatClient | null>();

function getActiveRuntimeOrNull(): StateRuntime | null {
  try {
    return getActiveStateRuntime();
  } catch {
    return null;
  }
}

export function setHostChatClient(client: HostChatClient | null): void {
  const runtime = getActiveRuntimeOrNull();
  if (!runtime) {
    fallbackHostChatClient = client;
    return;
  }
  hostChatClientByRuntime.set(runtime, client);
}

export function getHostChatClient(): HostChatClient | null {
  const runtime = getActiveRuntimeOrNull();
  return runtime ? hostChatClientByRuntime.get(runtime) ?? null : fallbackHostChatClient;
}

export function hasHostChatClient(): boolean {
  return getHostChatClient() !== null;
}

export function shouldRenderChatProviderControls(surface: ChatControlSurface = 'reference'): boolean {
  return surface === 'reference' && ENABLE_CHAT_MODEL_DEBUG_CONTROLS;
}

export interface ProxyCompletionParams {
  settings: ChatSettings;
  messages: ChatMessage[];
  context: string;
  // Natural-language response instructions, not a provider JSON schema.
  responseInstructions: string;
  systemInstructions?: string;
  mode: ProxyChatMode;
  debugLabel?: string;
  traceRunId?: string;
  maxContextChars?: number;
  onReasoningSummary?: (summary: string) => void;
  onTokenUsage?: (usage: ChatTokenUsage) => void;
  signal?: AbortSignal;
  client?: HostChatClient | null;
  beforeRequest?: (debugLabel: string) => Promise<void> | void;
}

export interface ProxyToolTurnParams extends Omit<ProxyCompletionParams, 'responseInstructions'> {
  tools: ProviderToolDefinition[];
  toolState?: ProviderToolState;
}

export interface ProxyToolTurn {
  output: string;
  reasoningSummary: string;
  usage?: ChatTokenUsage;
  toolCalls: ProviderToolCall[];
  nativeMessages: unknown[];
  toolState: ProviderToolState;
}

export interface AgentLoopTraceEventParams {
  runId: string;
  phase: ProxyChatRequest['mode'] | 'proxy';
  type: 'progress' | 'client_event' | 'work_ledger';
  payload: Record<string, unknown>;
  signal?: AbortSignal;
}

export function createDefaultChatState(): ChatState {
  return {
    settings: loadChatSettings(),
    draft: '',
    messages: [],
    isSending: false,
    status: null,
    error: null,
    panelOpen: false,
    requestNonce: 0,
    abortController: null,
    cliSimEnabled: false,
    cliSim: null,
  };
}

export function clearChatConversation(chat: ChatState): void {
  chat.draft = '';
  chat.messages = [];
  chat.isSending = false;
  chat.status = null;
  chat.error = null;
  chat.abortController?.abort();
  chat.abortController = null;
  chat.cliSimEnabled = false;
  chat.cliSim = null;
  chat.requestNonce += 1;
}

export function stopChatRequest(chat: ChatState): boolean {
  if (!chat.isSending) {
    return false;
  }
  chat.abortController?.abort();
  chat.abortController = null;
  chat.isSending = false;
  chat.status = null;
  chat.requestNonce += 1;
  chat.error = null;
  chat.messages = [
    ...chat.messages,
    {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: 'Stopped.',
      progress: true,
    },
  ];
  return true;
}

export function closeChatPanel(chat: ChatState): void {
  stopChatRequest(chat);
  chat.panelOpen = false;
}

export function toggleChatPanelOpen(chat: ChatState): void {
  if (chat.panelOpen) {
    closeChatPanel(chat);
    return;
  }
  chat.panelOpen = true;
}

export function focusChatPanel(app: ParentNode): void {
  window.setTimeout(() => {
    const prompt = app.querySelector<HTMLTextAreaElement>('[data-field="chat-input"]');
    if (prompt) {
      prompt.focus();
      return;
    }
    app.querySelector<HTMLElement>('.chat-panel')?.focus();
  }, 0);
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
  const filteredComments = withoutFrontMatter.replace(/<!--[\s\S]*?-->/g, (comment) =>
    shouldPreserveChatComment(comment) ? comment : ''
  );
  return filteredComments
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function buildChatDocumentContext(document: VisualDocument): string {
  const bodyContext = stripDocumentHeaderAndComments(serializeDocument(document));
  const aiContext = getDocumentAiContext(document);
  if (!aiContext) {
    return bodyContext;
  }
  return [
    'Document context:',
    aiContext,
    '',
    'Document body:',
    bodyContext,
  ].join('\n');
}

export function renderChatPanel(
  chat: ChatState,
  document: VisualDocument,
  deps: RenderChatPanelDeps,
  mode: 'qa' | 'document-edit' = 'qa',
  canCopyToHvy = false,
  surface: ChatControlSurface = 'reference',
  contextControls: RenderChatContextControlsOptions = {}
): string {
  const hasDraft = chat.draft.trim().length > 0;
  const missingModel = chat.settings.model.trim().length === 0;
  const hostManagedChat = hasHostChatClient();
  const showProviderControls = !hostManagedChat && shouldRenderChatProviderControls(surface);
  const isDocumentEdit = mode === 'document-edit';
  const hasQaDocumentContent = document.sections.length > 0;
  const canSend = !chat.isSending && (hostManagedChat || !missingModel) && (isDocumentEdit || hasQaDocumentContent);
  const showCliSimControls = isDocumentEdit && ENABLE_CHAT_CLI_SIM;
  const cliSimHtml = showCliSimControls && chat.cliSim ? renderChatCliSimHtml(chat.cliSim, deps) : '';
  const latestTokenUsage = getLatestChatTokenUsage(chat.messages);
  console.debug('[hvy:chat-render] composer state', {
    panelOpen: chat.panelOpen,
    mode,
    canSend,
    isSending: chat.isSending,
    hasDraft,
    missingModel,
    contextLength: hasQaDocumentContent ? 'available' : 0,
    messageCount: chat.messages.length,
  });
  const title = isDocumentEdit ? 'Edit This Document' : 'Ask This Document';
  const subtitle = isDocumentEdit
    ? 'Editing chat can inspect structure, request targeted tools, and apply document changes.'
    : '';
  const emptyTitle = isDocumentEdit
    ? 'Editing'
    : 'Ask a question';
  const emptyBody = 'No chat history';
  const promptLabel = isDocumentEdit ? 'Change request' : 'Question';
  const promptPlaceholder = isDocumentEdit
    ? 'Describe how the document should change...'
    : 'Ask about the current HVY document...';
  const providerControlsHtml = showProviderControls
    ? `<div class="chat-settings">
         <label class="chat-setting">
           <span>Provider</span>
           <select data-field="chat-provider" aria-label="Chat provider" ${chat.isSending ? 'disabled' : ''}>
             <option value="openai"${chat.settings.provider === 'openai' ? ' selected' : ''}>OpenAI</option>
             <option value="anthropic"${chat.settings.provider === 'anthropic' ? ' selected' : ''}>Anthropic</option>
             <option value="qwen"${chat.settings.provider === 'qwen' ? ' selected' : ''}>Qwen</option>
           </select>
         </label>

         <label class="chat-setting">
           <span>Model</span>
           <input
             type="text"
             data-field="chat-model"
             value="${deps.escapeAttr(chat.settings.model)}"
             placeholder="${deps.escapeAttr(getDefaultModelForProvider(chat.settings.provider))}"
             autocapitalize="off"
             autocomplete="off"
             spellcheck="false"
             aria-label="Chat model"
             ${chat.isSending ? 'disabled' : ''}
           />
         </label>

         <label class="chat-setting">
           <span>Compaction provider</span>
           <select data-field="chat-compaction-provider" aria-label="Chat compaction provider" ${chat.isSending ? 'disabled' : ''}>
             <option value="openai"${(chat.settings.compactionProvider ?? 'openai') === 'openai' ? ' selected' : ''}>OpenAI</option>
             <option value="anthropic"${chat.settings.compactionProvider === 'anthropic' ? ' selected' : ''}>Anthropic</option>
           </select>
         </label>

         <label class="chat-setting">
           <span>Compaction model</span>
           <input
             type="text"
             data-field="chat-compaction-model"
             value="${deps.escapeAttr(chat.settings.compactionModel ?? DEFAULT_OPENAI_COMPACTION_MODEL)}"
             placeholder="${deps.escapeAttr(DEFAULT_OPENAI_COMPACTION_MODEL)}"
             autocapitalize="off"
             autocomplete="off"
             spellcheck="false"
             aria-label="Chat compaction model"
             ${chat.isSending ? 'disabled' : ''}
           />
         </label>
       </div>`
    : '';
  const contextControlsHtml = renderChatContextControls(chat, deps, {
    chatContext: contextControls.chatContext,
    embeddingAvailable: contextControls.embeddingAvailable === true,
    canPersistEmbeddingCache: contextControls.canPersistEmbeddingCache === true && document.extension === '.hvy',
  });
  const composerHtml = chat.isSending
    ? `<div class="chat-busy-footer">
         <span class="chat-composer-status">${deps.escapeHtml(chat.status ?? 'Working through the request...')}</span>
         <button type="button" class="danger" data-action="cancel-chat-request">Stop</button>
       </div>`
    : `<form id="chatComposer" class="chat-composer">
         <label class="chat-composer-field">
           <span>${promptLabel}</span>
           <textarea data-field="chat-input" rows="5" placeholder="${deps.escapeAttr(promptPlaceholder)}">${deps.escapeHtml(chat.draft)}</textarea>
         </label>
         <div class="chat-composer-actions">
           <span class="chat-composer-status">
             ${
              hostManagedChat
                 ? !hasDraft
                   ? latestTokenUsage ? `Last ${formatChatTokenUsage(latestTokenUsage).toLowerCase()}` : 'Type your prompt'
                   : latestTokenUsage ? `Ready · last ${formatChatTokenUsage(latestTokenUsage).toLowerCase()}` : 'Ready'
                 : missingModel
                 ? 'Choose a model before sending.'
                 : !hasDraft
                 ? latestTokenUsage ? `Last ${formatChatTokenUsage(latestTokenUsage).toLowerCase()}` : 'Type your prompt'
                 : latestTokenUsage ? `Ready · last ${formatChatTokenUsage(latestTokenUsage).toLowerCase()}` : 'Ready'
             }
           </span>
           <button type="submit" class="secondary"${canSend ? '' : ' disabled'}>Send</button>
         </div>
       </form>`;
  return `
    ${chat.panelOpen ? '<div class="chat-backdrop" data-action="toggle-chat-panel" aria-hidden="true"></div>' : ''}
    <div class="chat-dock ${chat.panelOpen ? 'is-open' : 'is-closed'}" aria-label="Document chat">
      ${
        chat.panelOpen
          ? `<aside class="chat-panel ${isDocumentEdit ? 'is-document-edit' : 'is-question-answer'}" tabindex="-1"${chat.isSending ? ' aria-busy="true"' : ''}>
               <div class="chat-panel-head">
                 <div>
                   <h2>${title}</h2>
                   <p>${subtitle}</p>
                 </div>
                 <div class="chat-panel-head-actions">
                   ${
                    showCliSimControls
                      ? `<button type="button" class="${chat.cliSimEnabled ? 'secondary' : 'ghost'}" data-action="toggle-chat-cli-sim"${chat.isSending || missingModel ? ' disabled' : ''}>CLI Sim ${chat.cliSimEnabled ? 'On' : 'Off'}</button>`
                      : ''
                   }
                   <button type="button" class="ghost" data-action="clear-chat-history"${chat.messages.length === 0 ? ' disabled' : ''}>Clear</button>
                 </div>
                 <button type="button" class="ghost chat-panel-close" data-action="toggle-chat-panel" aria-label="Close chat">${closeIcon()}</button>
               </div>
               <div class="chat-panel-body" data-chat-scroll-container>
                 ${providerControlsHtml}
                 ${contextControlsHtml}

                 ${chat.error ? `<div class="chat-error" role="alert">${deps.escapeHtml(chat.error)}</div>` : ''}
                 ${cliSimHtml}

                 <div class="chat-thread" aria-live="polite" role="log">
                   ${
                     chat.messages.length === 0
                      ? `<div class="chat-empty">
                           <strong>${emptyTitle}</strong>
                           <p>${emptyBody}</p>
                          </div>`
                       : chat.messages
                           .map((message) => renderChatMessageHtml(message, deps, canCopyToHvy))
                           .join('')
                   }
                 </div>

                 <div class="chat-footer">
                   ${composerHtml}
                 </div>
               </div>
               <button type="button" class="chat-scroll-bottom" data-action="chat-scroll-bottom" hidden>Latest ↓</button>
             </aside>`
          : ''
      }
      <button type="button" class="hvy-floating-launcher chat-launcher" data-action="toggle-chat-panel" aria-expanded="${chat.panelOpen ? 'true' : 'false'}" aria-label="${chat.panelOpen ? 'Close chat' : 'Open chat'}">?</button>
    </div>
  `;
}

function renderChatContextControls(
  chat: ChatState,
  deps: RenderChatPanelDeps,
  options: RenderChatContextControlsOptions
): string {
  const mode = options.chatContext?.mode ?? 'full-document';
  const embeddingModel = options.chatContext?.embeddingModel?.trim() || 'text-embedding-ada-002';
  const embeddingSelected = mode === 'embedding-retrieval';
  const embeddingAvailable = options.embeddingAvailable === true;
  const canPersistEmbeddingCache = options.canPersistEmbeddingCache === true;
  const buildDisabled = chat.isSending || !embeddingSelected || !embeddingAvailable || !canPersistEmbeddingCache;
  const buildTitle = !embeddingSelected
    ? 'Select embedding retrieval before building embeddings.'
    : !embeddingAvailable
    ? 'Embedding provider is not configured.'
    : !canPersistEmbeddingCache
    ? 'Embedding caches can only be attached to .hvy documents.'
    : 'Build embedding cache for the next save';
  return `
    <section class="chat-context-controls" aria-label="Chat context">
      <label class="chat-setting chat-setting-wide">
        <span>Context method</span>
        <select data-field="chat-context-mode" aria-label="Chat context method" ${chat.isSending ? 'disabled' : ''}>
          <option value="keyword-retrieval"${mode === 'keyword-retrieval' ? ' selected' : ''}>Keyword retrieval</option>
          <option value="embedding-retrieval"${embeddingSelected ? ' selected' : ''}>Embedding retrieval</option>
          <option value="full-document"${mode === 'full-document' ? ' selected' : ''}>Full document</option>
        </select>
      </label>
      <div class="chat-embedding-controls${embeddingSelected ? '' : ' is-hidden'}">
        <label class="chat-setting">
          <span>Embedding model</span>
          <input
            type="text"
            data-field="chat-embedding-model"
            value="${deps.escapeAttr(embeddingModel)}"
            placeholder="text-embedding-ada-002"
            autocapitalize="off"
            autocomplete="off"
            spellcheck="false"
            aria-label="Embedding model"
            ${chat.isSending ? 'disabled' : ''}
          />
        </label>
        <button type="button" class="secondary" data-action="build-chat-embeddings" title="${deps.escapeAttr(buildTitle)}"${buildDisabled ? ' disabled' : ''}>Build Embeddings</button>
      </div>
      ${
        chat.status && !chat.isSending
          ? `<p class="chat-context-status">${deps.escapeHtml(chat.status)}</p>`
          : ''
      }
    </section>
  `;
}

function renderChatCliSimHtml(sim: NonNullable<ChatState['cliSim']>, deps: RenderChatPanelDeps): string {
  const isBusy = sim.isPreparing || sim.isSending;
  const canRun = (!!sim.requestPayload || !!sim.responseOutput) && !isBusy;
  const buttonLabel = sim.isSending
    ? 'Getting Response...'
    : sim.isPreparing
    ? 'Preparing Next Step...'
    : sim.responseOutput
    ? 'Run Commands And Prepare Next'
    : 'Get Response';
  return `
    <section class="chat-cli-sim" aria-label="CLI simulation">
      <div class="chat-cli-sim-head">
        <strong>CLI Sim</strong>
        <button type="button" class="secondary" data-action="run-chat-cli-sim-step"${canRun ? '' : ' disabled'}>
          ${buttonLabel}
        </button>
      </div>
      ${sim.error ? `<div class="chat-error" role="alert">${deps.escapeHtml(sim.error)}</div>` : ''}
      ${isBusy ? `<div class="chat-composer-status">${deps.escapeHtml(buttonLabel)}</div>` : ''}
      ${
        sim.commandResultMessage
          ? `<details open>
               <summary>Last command result</summary>
               <pre>${deps.escapeHtml(sim.commandResultMessage)}</pre>
             </details>`
          : ''
      }
      <details open>
        <summary>Request JSON</summary>
        <pre>${deps.escapeHtml(sim.requestJson || (sim.isPreparing ? 'Preparing...' : ''))}</pre>
      </details>
      ${
        sim.responseJson
          ? `<details open>
               <summary>Response JSON</summary>
               <pre>${deps.escapeHtml(sim.responseJson)}</pre>
             </details>`
          : ''
      }
      ${
        sim.reasoningSummary
          ? `<details>
               <summary>Thinking summary</summary>
               <pre>${deps.escapeHtml(sim.reasoningSummary)}</pre>
             </details>`
          : ''
      }
    </section>
  `;
}

export async function requestChatCompletion(params: {
  settings: ChatSettings;
  document: VisualDocument;
  messages: ChatMessage[];
  question?: string;
  chatContext?: HvyChatContextOptions | null;
  chatContextProvider?: HvyChatContextProvider | null;
  chatSearchCache?: HvyChatSearchCache | null;
  embeddingProvider?: HvyEmbeddingProvider | null;
  onContextPreparation?: HvyChatContextPreparationCallback;
  onReasoningSummary?: (summary: string) => void;
  onTokenUsage?: (usage: ChatTokenUsage) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const context = await buildQaChatContext({
    document: params.document,
    messages: params.messages,
    question: params.question ?? params.messages.filter((message) => message.role === 'user').at(-1)?.content ?? '',
    settings: params.settings,
    chatContext: params.chatContext,
    chatContextProvider: params.chatContextProvider,
    chatSearchCache: params.chatSearchCache,
    embeddingProvider: params.embeddingProvider,
    onContextPreparation: params.onContextPreparation,
    signal: params.signal,
  });
  if (context.trim().length === 0) {
    throw new Error('The document body is empty after removing front matter and comments.');
  }

  return requestProxyCompletion({
    settings: params.settings,
    messages: params.messages,
    context,
    responseInstructions: HVY_AI_RESPONSE_FORMAT_INSTRUCTIONS,
    mode: 'qa',
    debugLabel: 'chat',
    onReasoningSummary: params.onReasoningSummary,
    onTokenUsage: params.onTokenUsage,
    maxContextChars: params.chatContext?.maxContextChars,
    signal: params.signal,
  });
}

async function buildQaChatContext(params: {
  document: VisualDocument;
  messages: ChatMessage[];
  question: string;
  settings: ChatSettings;
  chatContext?: HvyChatContextOptions | null;
  chatContextProvider?: HvyChatContextProvider | null;
  chatSearchCache?: HvyChatSearchCache | null;
  embeddingProvider?: HvyEmbeddingProvider | null;
  onContextPreparation?: HvyChatContextPreparationCallback;
  signal?: AbortSignal;
}): Promise<string> {
  const maxContextChars = params.chatContext?.maxContextChars ?? params.settings.maxContextChars ?? MAX_PROXY_COMPLETION_CONTEXT_CHARS;
  let result: HvyChatContextResult | null = null;
  let contextStartedCached = false;
  if (params.chatContextProvider) {
    await params.onContextPreparation?.({ phase: 'preparing-context', cached: false });
    result = await params.chatContextProvider.buildContext({
      document: params.document,
      question: params.question,
      messages: params.messages,
      maxContextChars,
      mode: 'qa',
      ...(params.signal ? { signal: params.signal } : {}),
    });
  } else if (params.chatContext?.mode === 'keyword-retrieval') {
    contextStartedCached = isKeywordChatContextPrepared(params.document);
    await params.onContextPreparation?.({ phase: 'preparing-context', cached: contextStartedCached });
    result = await buildKeywordChatContext({
      document: params.document,
      question: params.question,
      messages: params.messages,
      maxContextChars,
      mode: 'qa',
      ...(params.signal ? { signal: params.signal } : {}),
    }, params.chatContext, params.chatSearchCache ?? null);
  } else if (params.chatContext?.mode === 'embedding-retrieval') {
    contextStartedCached = isEmbeddingChatContextPrepared(params.document, params.chatContext);
    await params.onContextPreparation?.({ phase: 'preparing-context', cached: contextStartedCached });
    result = await buildEmbeddingChatContext({
      document: params.document,
      question: params.question,
      messages: params.messages,
      maxContextChars,
      mode: 'qa',
      ...(params.signal ? { signal: params.signal } : {}),
    }, params.chatContext, params.embeddingProvider ?? null);
  }
  if (result) {
    await params.onContextPreparation?.({ phase: 'context-ready', cached: contextStartedCached });
  }
  if (!result) {
    return buildChatDocumentContext(params.document);
  }
  return trimChatContextToCap(result.context, maxContextChars);
}

function trimChatContextToCap(context: string, maxContextChars: number): string {
  const trimmed = context.trim();
  if (trimmed.length <= maxContextChars) {
    return trimmed;
  }
  if (maxContextChars <= 3) {
    return trimmed.slice(0, Math.max(0, maxContextChars));
  }
  return `${trimmed.slice(0, maxContextChars - 3).trimEnd()}...`;
}

export async function requestProxyCompletion(params: ProxyCompletionParams): Promise<string> {
  const debugLabel = params.debugLabel?.trim() || 'chat';
  assertProxyContextWithinLimit(params.context, debugLabel, params.maxContextChars ?? params.settings.maxContextChars);
  const requestPayload = buildProxyChatRequest({
    provider: params.settings.provider,
    model: params.settings.model,
    messages: params.messages,
    context: params.context,
    systemInstructions: params.systemInstructions ?? params.responseInstructions,
    mode: params.mode,
    traceRunId: params.traceRunId,
  });
  const hostClient = params.client === undefined ? getHostChatClient() : params.client;

  logChatProxyDebug(debugLabel, 'client request', () => ({
    provider: requestPayload.provider,
    model: requestPayload.model,
    messages: requestPayload.messages,
    contextLength: requestPayload.context.length,
    hostManaged: !!hostClient,
  }));
  await params.beforeRequest?.(debugLabel);

  if (hostClient) {
    const payload = await hostClient.complete(requestPayload, {
      signal: params.signal,
      debugLabel,
    });
    if (typeof payload.output !== 'string' || payload.output.trim().length === 0) {
      throw new Error('Host chat client returned no assistant text.');
    }
    const output = payload.output.trim();
    const reasoningSummary = typeof payload.reasoningSummary === 'string' ? payload.reasoningSummary.trim() : '';
    if (reasoningSummary) {
      params.onReasoningSummary?.(reasoningSummary);
    }
    const usage = normalizeProxyTokenUsage(payload.usage);
    if (usage) {
      params.onTokenUsage?.(usage);
    }
    return output;
  }

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestPayload),
    signal: params.signal,
  });

  const payload = await readJsonResponse(response);
  logChatProxyDebug(debugLabel, 'client response', () => ({
    ok: response.ok,
    status: response.status,
    payload,
  }));
  if (!response.ok) {
    throw new Error(extractProxyError(payload, 'Chat request failed.'));
  }

  if (typeof (payload as ProxyChatResponse | null)?.output !== 'string' || (payload as ProxyChatResponse).output.trim().length === 0) {
    throw new Error('Proxy returned no assistant text.');
  }

  const output = (payload as ProxyChatResponse).output.trim();
  const reasoningSummary = typeof (payload as ProxyChatResponse).reasoningSummary === 'string'
    ? (payload as ProxyChatResponse).reasoningSummary?.trim() ?? ''
    : '';
  if (reasoningSummary) {
    params.onReasoningSummary?.(reasoningSummary);
  }
  const usage = normalizeProxyTokenUsage((payload as ProxyChatResponse).usage);
  if (usage) {
    params.onTokenUsage?.(usage);
  }
  logChatProxyDebug(debugLabel, 'client extracted output', () => output);
  return output;
}

export async function requestProxyToolTurn(params: ProxyToolTurnParams): Promise<ProxyToolTurn> {
  const debugLabel = params.debugLabel?.trim() || 'chat-tools';
  measurePhase('chat.proxyTool.contextLimit', { debugLabel }, () => {
    assertProxyContextWithinLimit(params.context, debugLabel, params.maxContextChars ?? params.settings.maxContextChars);
  });
  const requestPayload = measurePhase('chat.proxyTool.buildPayload', { debugLabel }, () => buildProxyChatRequest({
    provider: params.settings.provider,
    model: params.settings.model,
    messages: params.messages,
    context: params.context,
    systemInstructions: params.systemInstructions,
    mode: params.mode,
    traceRunId: params.traceRunId,
    tools: params.tools,
    toolState: params.toolState,
  }));
  const hostClient = params.client === undefined ? getHostChatClient() : params.client;

  logChatProxyDebug(debugLabel, 'client native tool request', () => ({
    provider: requestPayload.provider,
    model: requestPayload.model,
    toolCount: params.tools.length,
    hasToolState: !!params.toolState,
    hostManaged: !!hostClient,
  }));
  await params.beforeRequest?.(debugLabel);

  if (hostClient) {
    const payload = hostClient.toolTurn
      ? await hostClient.toolTurn(requestPayload, { signal: params.signal, debugLabel })
      : await hostClient.complete(requestPayload, { signal: params.signal, debugLabel });
    const typed = payload as ProxyChatResponse | null;
    const output = typeof typed?.output === 'string' ? typed.output.trim() : '';
    const reasoningSummary = typeof typed?.reasoningSummary === 'string' ? typed.reasoningSummary.trim() : '';
    if (reasoningSummary) {
      params.onReasoningSummary?.(reasoningSummary);
    }
    const usage = normalizeProxyTokenUsage(typed?.usage);
    if (usage) {
      params.onTokenUsage?.(usage);
    }
    return {
      output,
      reasoningSummary,
      ...(usage ? { usage } : {}),
      toolCalls: Array.isArray(typed?.toolCalls) ? typed.toolCalls : [],
      nativeMessages: Array.isArray(typed?.nativeMessages) ? typed.nativeMessages : [],
      toolState: typed?.toolState ?? createEmptyHostToolState(requestPayload.provider),
    };
  }

  const requestBody = measurePhase('chat.proxyTool.stringify', { debugLabel }, () => JSON.stringify(requestPayload));
  const response = await measureAsyncPhase('chat.proxyTool.fetch', { debugLabel, requestChars: requestBody.length }, () => fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: requestBody,
    signal: params.signal,
  }));

  const payload = await measureAsyncPhase('chat.proxyTool.readJson', { debugLabel }, () => readJsonResponse(response));
  logChatProxyDebug(debugLabel, 'client native tool response', () => ({
    ok: response.ok,
    status: response.status,
    payload,
  }));
  if (!response.ok) {
    throw new Error(extractProxyError(payload, 'Chat tool request failed.'));
  }

  const typed = payload as ProxyChatResponse | null;
  if (!typed?.toolState || !Array.isArray(typed.toolCalls) || !Array.isArray(typed.nativeMessages)) {
    throw new Error('Proxy returned an invalid native tool turn.');
  }
  const responsePayload = measurePhase('chat.proxyTool.normalize', { debugLabel }, () => {
    const output = typeof typed.output === 'string' ? typed.output.trim() : '';
    const reasoningSummary = typeof typed.reasoningSummary === 'string' ? typed.reasoningSummary.trim() : '';
    const usage = normalizeProxyTokenUsage(typed.usage);
    return { output, reasoningSummary, usage };
  });
  if (responsePayload.reasoningSummary) {
    params.onReasoningSummary?.(responsePayload.reasoningSummary);
  }
  if (responsePayload.usage) {
    params.onTokenUsage?.(responsePayload.usage);
  }
  return {
    output: responsePayload.output,
    reasoningSummary: responsePayload.reasoningSummary,
    ...(responsePayload.usage ? { usage: responsePayload.usage } : {}),
    toolCalls: typed.toolCalls,
    nativeMessages: typed.nativeMessages,
    toolState: typed.toolState,
  };
}

function logChatProxyDebug(debugLabel: string, event: string, details: () => unknown): void {
  if (!ENABLE_CHAT_PROXY_DEBUG_LOGS) {
    return;
  }
  console.debug(`[hvy:${debugLabel}] ${event}`, details());
}

function assertProxyContextWithinLimit(context: string, debugLabel: string, maxContextChars = MAX_PROXY_COMPLETION_CONTEXT_CHARS): void {
  if (!Number.isFinite(maxContextChars) || maxContextChars <= 0) {
    throw new Error(`Invalid LLM context cap for ${debugLabel}: ${maxContextChars}.`);
  }
  if (context.length <= maxContextChars) {
    return;
  }
  throw new Error(
    `LLM context for ${debugLabel} is ${context.length} characters; maximum is ${maxContextChars}. Reduce or chunk the context before making this request.`
  );
}

function createEmptyHostToolState(provider: ChatSettings['provider']): ProviderToolState {
  if (provider === 'anthropic') {
    return { provider, system: '', messages: [] };
  }
  if (provider === 'qwen') {
    return { provider, messages: [] };
  }
  return { provider: 'openai', input: [] };
}

function normalizeProxyTokenUsage(value: unknown): ChatTokenUsage | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const usage: ChatTokenUsage = {
    ...(typeof record.inputTokens === 'number' ? { inputTokens: record.inputTokens } : {}),
    ...(typeof record.outputTokens === 'number' ? { outputTokens: record.outputTokens } : {}),
    ...(typeof record.totalTokens === 'number' ? { totalTokens: record.totalTokens } : {}),
    ...(typeof record.cachedTokens === 'number' ? { cachedTokens: record.cachedTokens } : {}),
    ...(typeof record.reasoningTokens === 'number' ? { reasoningTokens: record.reasoningTokens } : {}),
  };
  return Object.keys(usage).length > 0 ? usage : null;
}

export function buildProxyChatRequest(request: ProxyChatRequestInput): ProxyChatRequest {
  const payload: ProxyChatRequest = {
    provider: request.provider,
    model: request.model.trim(),
    messages: [
      ...(request.systemInstructions?.trim()
        ? [{
            id: 'system',
            role: 'system' as const,
            content: request.systemInstructions.trim(),
          }]
        : []),
      ...request.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        error: message.error,
      })),
    ],
    context: request.context,
    mode: request.mode,
  };
  if (request.traceRunId) {
    payload.traceRunId = request.traceRunId;
  }
  if (request.tools) {
    payload.tools = request.tools;
  }
  if (request.toolState) {
    payload.toolState = request.toolState;
  }
  return payload;
}

export function traceAgentLoopEvent(params: AgentLoopTraceEventParams): void {
  if (typeof window === 'undefined' || typeof fetch === 'undefined') {
    return;
  }
  void fetch('/api/agent-trace', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      runId: params.runId,
      phase: params.phase,
      type: params.type,
      payload: params.payload,
    }),
    signal: params.signal,
  }).catch(() => {
    // Tracing is best-effort and must never interrupt chat flow.
  });
}

export function getEnvChatSettings(env: ImportMetaEnv = import.meta.env): ChatSettings {
  const provider = env.VITE_HVY_CHAT_PROVIDER === 'anthropic' || env.VITE_HVY_CHAT_PROVIDER === 'qwen' ? env.VITE_HVY_CHAT_PROVIDER : 'openai';
  const providerDefaultModel = getDefaultModelForProvider(provider);
  const providerSpecificModel = provider === 'anthropic' ? env.VITE_ANTHROPIC_MODEL : provider === 'qwen' ? env.VITE_QWEN_MODEL : env.VITE_OPENAI_MODEL;
  const model = firstNonEmptyString(env.VITE_HVY_CHAT_MODEL, providerSpecificModel, providerDefaultModel);
  const compactionProvider = env.VITE_HVY_CHAT_COMPACTION_PROVIDER === 'anthropic' ? 'anthropic' : 'openai';
  const compactionModel = firstNonEmptyString(env.VITE_HVY_CHAT_COMPACTION_MODEL, DEFAULT_OPENAI_COMPACTION_MODEL);
  const toolLoopCompaction = readEnvToolLoopCompaction(env);

  return {
    provider,
    model,
    compactionProvider,
    compactionModel,
    ...(toolLoopCompaction ? { toolLoopCompaction } : {}),
  };
}

export function getDefaultModelForProvider(provider: ChatSettings['provider']): string {
  return provider === 'anthropic' ? DEFAULT_ANTHROPIC_MODEL : provider === 'qwen' ? DEFAULT_QWEN_MODEL : DEFAULT_OPENAI_MODEL;
}

function getDefaultChatSettings(): ChatSettings {
  return getEnvChatSettings();
}

function sanitizeChatSettings(settings: Partial<ChatSettings> | null | undefined, defaults: ChatSettings): ChatSettings {
  return {
    provider: settings?.provider === 'anthropic' || settings?.provider === 'qwen' ? settings.provider : defaults.provider,
    model: typeof settings?.model === 'string' && settings.model.trim().length > 0 ? settings.model : defaults.model,
    compactionProvider: settings?.compactionProvider === 'anthropic' ? 'anthropic' : defaults.compactionProvider ?? 'openai',
    compactionModel: typeof settings?.compactionModel === 'string' && settings.compactionModel.trim().length > 0
      ? settings.compactionModel
      : defaults.compactionModel ?? DEFAULT_OPENAI_COMPACTION_MODEL,
    maxContextChars: normalizeOptionalPositiveInteger(settings?.maxContextChars ?? defaults.maxContextChars),
    toolLoopCompaction: settings?.toolLoopCompaction ?? defaults.toolLoopCompaction,
  };
}

export function mergeChatSettings(settings: Partial<ChatSettings> | null | undefined, defaults: ChatSettings): ChatSettings {
  const sanitized = sanitizeChatSettings(settings, defaults);
  return {
    provider: sanitized.provider,
    model: sanitized.model.trim().length > 0 ? sanitized.model : defaults.model,
    compactionProvider: sanitized.compactionProvider ?? defaults.compactionProvider ?? 'openai',
    compactionModel: sanitized.compactionModel?.trim()
      ? sanitized.compactionModel
      : defaults.compactionModel ?? DEFAULT_OPENAI_COMPACTION_MODEL,
    ...(sanitized.maxContextChars ? { maxContextChars: sanitized.maxContextChars } : {}),
    ...(sanitized.toolLoopCompaction ? { toolLoopCompaction: sanitized.toolLoopCompaction } : {}),
  };
}

function normalizeOptionalPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

function readEnvToolLoopCompaction(env: ImportMetaEnv): ChatSettings['toolLoopCompaction'] | undefined {
  const toolLoopCompaction = {
    compactAfterMessages: readOptionalEnvInteger(env.VITE_HVY_CHAT_TOOL_LOOP_COMPACT_AFTER_MESSAGES),
    keepRecentMessages: readOptionalEnvInteger(env.VITE_HVY_CHAT_TOOL_LOOP_KEEP_RECENT_MESSAGES),
    latestToolResultContextChars: readOptionalEnvInteger(env.VITE_HVY_CHAT_TOOL_LOOP_LATEST_TOOL_RESULT_CONTEXT_CHARS),
    toolResultChatChars: readOptionalEnvInteger(env.VITE_HVY_CHAT_TOOL_LOOP_TOOL_RESULT_CHAT_CHARS),
  };
  const filtered = Object.fromEntries(
    Object.entries(toolLoopCompaction).filter(([, value]) => typeof value === 'number')
  ) as NonNullable<ChatSettings['toolLoopCompaction']>;
  return Object.keys(filtered).length > 0 ? filtered : undefined;
}

function readOptionalEnvInteger(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
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

function shouldPreserveChatComment(comment: string): boolean {
  const trimmed = comment.trim();
  if (/^<!--\s*hvy:xref-card\b/i.test(trimmed)) {
    return true;
  }
  if (/^<!--\s*hvy:\s*\{/i.test(trimmed)) {
    return true;
  }
  const payload = parseHvyCommentPayload(trimmed);
  return payload !== null && typeof payload.id === 'string' && payload.id.trim().length > 0;
}

function parseHvyCommentPayload(comment: string): Record<string, unknown> | null {
  const match = comment.match(/^<!--\s*hvy(?::[a-z][a-z0-9-]*)*\s+(\{[\s\S]*\})\s*-->$/i);
  if (!match) {
    return null;
  }
  try {
    const parsed = JSON.parse(match[1]) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function getLatestChatTokenUsage(messages: ChatMessage[]): ChatTokenUsage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const usage = messages[index]?.tokenUsage;
    if (usage) {
      return usage;
    }
  }
  return null;
}

function formatChatTokenUsage(usage: ChatTokenUsage): string {
  const parts = [
    typeof usage.inputTokens === 'number' ? `input ${usage.inputTokens}` : '',
    typeof usage.outputTokens === 'number' ? `output ${usage.outputTokens}` : '',
  ].filter(Boolean);
  return parts.length > 0 ? `Tokens: ${parts.join(' / ')}` : '';
}

function renderChatMessageHtml(message: ChatMessage, deps: RenderChatPanelDeps, canCopyToHvy: boolean): string {
  const classes = [
    'chat-bubble',
    `chat-bubble-${message.role}`,
    message.error ? 'chat-bubble-error' : '',
    message.progress ? 'chat-bubble-progress' : '',
    message.work ? 'chat-bubble-work' : '',
  ].filter(Boolean).join(' ');
  return `
    <article class="${classes}" data-chat-role="${deps.escapeAttr(message.role)}" data-chat-message-id="${deps.escapeAttr(message.id)}">
      <div class="chat-bubble-role">${deps.escapeHtml(formatChatBubbleRole(message))}</div>
      ${message.work ? renderChatWorkMessageHtml(message, deps) : renderStandardChatMessageHtml(message, deps)}
      ${
        canCopyToHvy && message.role === 'assistant' && !message.error && !message.progress
          ? `<div class="chat-bubble-actions"><button type="button" class="ghost" data-action="copy-chat-response-to-hvy" data-message-id="${deps.escapeAttr(message.id)}">Copy to HVY</button></div>`
          : ''
      }
    </article>
  `;
}

function formatChatBubbleRole(message: ChatMessage): string {
  if (message.role === 'user') {
    return 'You';
  }
  if (message.work?.status === 'running') {
    return 'Working';
  }
  return 'Assistant';
}

function renderStandardChatMessageHtml(message: ChatMessage, deps: RenderChatPanelDeps): string {
  return `
    <div class="chat-bubble-body">${
      message.role === 'assistant'
        ? renderAssistantMessageHtml(message.content)
        : deps.escapeHtml(message.content).replace(/\n/g, '<br />')
    }</div>
    ${
      message.reasoning
        ? `<details class="chat-reasoning"><summary>Reasoning Summary</summary><div>${deps.escapeHtml(message.reasoning).replace(/\n/g, '<br />')}</div></details>`
        : ''
    }
    ${message.tokenUsage ? `<div class="chat-token-usage">${deps.escapeHtml(formatChatTokenUsage(message.tokenUsage))}</div>` : ''}
  `;
}

function renderChatWorkMessageHtml(message: ChatMessage, deps: RenderChatPanelDeps): string {
  const work = message.work;
  if (!work) {
    return renderStandardChatMessageHtml(message, deps);
  }
  const isRunning = work.status === 'running';
  const summary = isRunning
    ? deps.escapeHtml(work.lastCommand ? `Last command: ${work.lastCommand}` : message.content || 'Working through the request...')
    : renderAssistantMessageHtml(message.content);
  return `
    <div class="chat-bubble-body chat-work-body">
      ${isRunning ? `<span class="chat-work-pulse" aria-hidden="true"></span><span>${summary}</span>` : summary}
    </div>
    ${renderChatWorkDetails(work, deps, message.id)}
    ${message.tokenUsage || work.tokenUsage ? `<div class="chat-token-usage">${deps.escapeHtml(formatChatTokenUsage(message.tokenUsage ?? work.tokenUsage!))}</div>` : ''}
  `;
}

function renderChatWorkDetails(work: ChatWorkState, deps: RenderChatPanelDeps, messageId: string): string {
  const detailLines = work.details.length > 0 ? work.details : ['No command history yet.'];
  const reasoningLines = work.reasoning.length > 0 ? work.reasoning : [];
  return `
    <details class="chat-work-details" data-chat-work-details="${deps.escapeAttr(`${messageId}:commands`)}">
      <summary>Show command history</summary>
      <div class="chat-work-detail-section">
        <pre class="chat-work-detail-scroll">${deps.escapeHtml(detailLines.join('\n'))}</pre>
      </div>
    </details>
    ${
      reasoningLines.length > 0
        ? `<details class="chat-work-details" data-chat-work-details="${deps.escapeAttr(`${messageId}:reasoning`)}">
             <summary>Show reasoning history</summary>
             <div class="chat-work-detail-section">
               <pre class="chat-work-detail-scroll">${deps.escapeHtml(reasoningLines.join('\n\n'))}</pre>
             </div>
           </details>`
        : ''
    }
  `;
}

function renderAssistantMessageHtml(markdown: string): string {
  const hvyHtml = renderAssistantHvyHtml(markdown);
  if (hvyHtml !== null) {
    return hvyHtml;
  }
  return markdownToEditorHtml(normalizeMarkdownLists(markdown));
}

function renderAssistantHvyHtml(source: string): string | null {
  if (!looksLikeHvyResponse(source)) {
    return null;
  }

  try {
    const syntheticDocument = wrapChatResponseAsDocument(source);
    const document = deserializeDocument(syntheticDocument, '.hvy');
    const [wrapperSection] = document.sections;
    if (!wrapperSection) {
      return null;
    }

    const content = [
      ...wrapperSection.blocks.map((block) => renderChatHvyBlock(block, document.meta)),
      ...wrapperSection.children.map((section) => renderChatHvySection(section, document.meta)),
      ...document.sections.slice(1).map((section) => renderChatHvySection(section, document.meta)),
    ].join('');

    return `<div class="chat-hvy-response">${content}</div>`;
  } catch {
    return null;
  }
}

function renderChatHvySection(section: VisualSection, documentMeta: VisualDocument['meta']): string {
  return `
    <section class="chat-hvy-section">
      <div class="chat-hvy-section-title">${escapeChatHtml(section.title)}</div>
      <div class="chat-hvy-section-body">
        ${section.blocks.map((block) => renderChatHvyBlock(block, documentMeta)).join('')}
        ${section.children.map((child) => renderChatHvySection(child, documentMeta)).join('')}
      </div>
    </section>
  `;
}

function renderChatHvyBlock(block: VisualBlock, documentMeta: VisualDocument['meta']): string {
  const component = block.schema.component.trim();
  const helpers = getChatReaderHelpers(documentMeta);

  if (component === 'expandable') {
    ensureExpandableBlocks(block);
    const stubHtml = block.schema.expandableStubBlocks.children.map((child) => renderChatHvyBlock(child, documentMeta)).join('');
    const contentHtml = block.schema.expandableContentBlocks.children.map((child) => renderChatHvyBlock(child, documentMeta)).join('');
    const expanded = block.schema.expandableExpanded;
    const stubPaneStyle = block.schema.expandableStubCss ? ` style="${escapeChatAttr(block.schema.expandableStubCss)}"` : '';
    const contentPaneStyle = block.schema.expandableContentCss ? ` style="${escapeChatAttr(block.schema.expandableContentCss)}"` : '';
    const toggleAttrs = `data-chat-action="toggle-expandable" aria-expanded="${expanded ? 'true' : 'false'}"`;
    return `<div class="expandable-reader is-interactive chat-expandable-reader${expanded ? ' is-expanded' : ' is-collapsed'}" data-expandable-id="${escapeChatAttr(block.id)}">
      <div class="expandable-reader-body">
        <div class="expandable-reader-pane expandable-reader-pane-stub">
          <div class="expand-stub-toggle"${stubPaneStyle} ${toggleAttrs}>
            <div class="expand-stub">${stubHtml}</div>
          </div>
        </div>
        <div class="expandable-reader-pane expandable-reader-pane-expanded"${expanded ? '' : ' style="display: none;"'}>
          <div class="expand-content"${contentPaneStyle} ${toggleAttrs}>${contentHtml}</div>
        </div>
      </div>
    </div>`;
  }

  if (component === 'xref-card') {
    return renderXrefCardReader(getChatReaderSection(), block, helpers);
  }

  if (component === 'component-list') {
    ensureComponentListBlocks(block);
    return renderComponentListReader(getChatReaderSection(), block, helpers);
  }

  if (component === 'container') {
    return renderContainerReader(getChatReaderSection(), block, helpers);
  }

  if (component === 'grid') {
    ensureGridItems(block.schema);
    return renderGridReader(getChatReaderSection(), block, helpers);
  }

  return `<div class="chat-hvy-text">${markdownToEditorHtml(normalizeMarkdownLists(block.text))}</div>`;
}

function looksLikeHvyResponse(source: string): boolean {
  return /<!--hvy:(?:[a-z]|subsection|doc|css)/i.test(source);
}

function getChatReaderSection(): VisualSection {
  return {
    key: 'chat-response',
    customId: 'chat-response',
    contained: true,
    lock: true,
    idEditorOpen: false,
    isGhost: false,
    title: 'Response',
    level: 1,
    expanded: true,
    highlight: false,
    editorOnly: false,
    css: '',
    tags: '',
    description: '',
    location: 'main',
    blocks: [],
    children: [],
  };
}

function getChatReaderHelpers(documentMeta: VisualDocument['meta']): ComponentRenderHelpers {
  return {
    escapeAttr: escapeChatAttr,
    escapeHtml: escapeChatHtml,
    markdownToEditorHtml,
    renderRichToolbar: () => '',
    renderEditorBlock: () => '',
    renderPassiveEditorBlock: () => '',
    renderReaderBlock: (_section: VisualSection, block: VisualBlock) => renderChatHvyBlock(block, documentMeta),
    renderReaderBlocks: (_section: VisualSection, blocks: VisualBlock[]) => blocks.map((block) => renderChatHvyBlock(block, documentMeta)).join(''),
    renderReaderListBlocks: (_section: VisualSection, blocks: VisualBlock[]) => blocks.map((block) => renderChatHvyBlock(block, documentMeta)).join(''),
    orderReaderBlocks: (blocks: VisualBlock[]) => blocks,
    orderReaderListBlocks: (blocks: VisualBlock[]) => blocks,
    isReaderViewPrioritizedBlock: () => false,
    renderTextFragment: (content: string) => markdownToEditorHtml(normalizeMarkdownLists(content)),
    renderComponentFragment: (_componentName: string, content: string) => markdownToEditorHtml(normalizeMarkdownLists(content)),
    renderComponentOptions: () => '',
    renderAddComponentPicker: () => '',
    renderComponentPlacementTarget: () => '',
    renderOption: () => '',
    getDocumentComponentCss: (componentName: string) => getDocumentComponentDefaultCss(documentMeta, componentName),
    getXrefTargetOptions: () => [],
    isXrefTargetValid,
    getTableColumns: (schema) => schema.tableColumns.map((column) => column.trim()).filter((column) => column.length > 0),
    ensureComponentListBlocks,
    ensureContainerBlocks: (_block: VisualBlock) => {},
    getSelectedAddComponent: () => 'text',
    getComponentListReaderViewId: () => '',
    getReaderContainerExpanded: (_key, fallback) => fallback,
    isExpandableEditorPanelOpen: () => false,
    isAdvancedEditorMode: () => false,
    isMobileAdjustmentMode: () => false,
    getTextLineStyles: () => getTextLineStylesFromMeta(documentMeta),
  };
}

function escapeChatHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeChatAttr(value: string): string {
  return escapeChatHtml(value);
}
