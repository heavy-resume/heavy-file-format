import type { ChatMessage, ChatSettings, ChatState, VisualDocument } from './types';
import { deserializeDocument, serializeDocument, wrapHvyFragmentAsDocument } from './serialization';
import { markdownToEditorHtml, normalizeMarkdownLists } from './markdown';
import aiResponseFormatInstructions from '../AI-RESPONSE-FORMAT.md?raw';
import type { VisualBlock, VisualSection } from './editor/types';
import type { ComponentRenderHelpers } from './editor/component-helpers';
import { renderXrefCardReader } from './editor/components/xref-card';
import { renderComponentListReader } from './editor/components/component-list';
import { renderContainerReader } from './editor/components/container';
import { renderGridReader } from './editor/components/grid';
import { ensureComponentListBlocks, ensureExpandableBlocks, ensureGridItems } from './document-factory';
import { isXrefTargetValid } from './xref-ops';

const CHAT_STORAGE_KEY = 'hvy-chat-settings';
const DEFAULT_OPENAI_MODEL = 'gpt-5-mini';
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6';
export const HVY_AI_RESPONSE_FORMAT_INSTRUCTIONS = aiResponseFormatInstructions;

interface RenderChatPanelDeps {
  escapeAttr: (value: string) => string;
  escapeHtml: (value: string) => string;
}

interface ProxyChatRequest {
  provider: ChatSettings['provider'];
  model: string;
  messages: ChatMessage[];
  context: string;
  formatInstructions: string;
  mode: 'qa' | 'component-edit';
}

interface ProxyChatResponse {
  output: string;
}

export interface ProxyCompletionParams {
  settings: ChatSettings;
  messages: ChatMessage[];
  context: string;
  formatInstructions: string;
  mode: 'qa' | 'component-edit';
  debugLabel?: string;
}

export function createDefaultChatState(): ChatState {
  return {
    settings: loadChatSettings(),
    draft: '',
    messages: [],
    isSending: false,
    error: null,
    panelOpen: false,
    requestNonce: 0,
  };
}

export function clearChatConversation(chat: ChatState): void {
  chat.draft = '';
  chat.messages = [];
  chat.isSending = false;
  chat.error = null;
  chat.requestNonce += 1;
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
  return stripDocumentHeaderAndComments(serializeDocument(document));
}

export function renderChatPanel(chat: ChatState, document: VisualDocument, deps: RenderChatPanelDeps): string {
  const context = buildChatDocumentContext(document);
  const currentProviderLabel = chat.settings.provider === 'openai' ? 'OpenAI' : 'Anthropic';
  const hasDraft = chat.draft.trim().length > 0;
  const missingModel = chat.settings.model.trim().length === 0;
  const canSend = !chat.isSending && context.length > 0;

  return `
    <div class="chat-dock ${chat.panelOpen ? 'is-open' : 'is-closed'}" aria-label="Document chat">
      ${
        chat.panelOpen
          ? `<aside class="chat-panel">
               <div class="chat-panel-head">
                 <div>
                   <h2>Ask This Document</h2>
                   <p>Separate from the reader. Requests go through a local proxy so provider API keys stay out of the browser.</p>
                 </div>
                 <div class="chat-panel-head-actions">
                   <button type="button" class="ghost" data-action="clear-chat-history"${chat.messages.length === 0 ? ' disabled' : ''}>Clear</button>
                   <button type="button" class="ghost" data-action="toggle-chat-panel" aria-label="Close chat">Close</button>
                 </div>
               </div>
               <div class="chat-panel-body" data-chat-scroll-container>
                 <div class="chat-settings">
                   <label class="chat-setting">
                     <span>Provider</span>
                     <select data-field="chat-provider" aria-label="Chat provider" ${chat.isSending ? 'disabled' : ''}>
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
                       ${chat.isSending ? 'disabled' : ''}
                     />
                   </label>
                 </div>

                 <div class="chat-context-card">
                   <strong>Context source</strong>
                   <p>Current HVY body with YAML front matter removed and only structural HVY comments preserved for chat context.</p>
                   <div class="chat-context-meta">
                     <span>${context.length.toLocaleString()} chars</span>
                     <span>${chat.messages.length} messages</span>
                     <span>${deps.escapeHtml(currentProviderLabel)}</span>
                   </div>
                 </div>

                 ${chat.error ? `<div class="chat-error" role="alert">${deps.escapeHtml(chat.error)}</div>` : ''}

                 <div class="chat-thread" aria-live="polite" role="log">
                   ${
                     chat.messages.length === 0
                       ? `<div class="chat-empty">
                            <strong>Start by asking a question about the visible HVY document.</strong>
                            <p>The browser sends your prompt to a same-origin proxy, and that proxy talks to the model provider.</p>
                          </div>`
                       : chat.messages
                           .map(
                             (message) => `
                               <article class="chat-bubble chat-bubble-${message.role}${message.error ? ' chat-bubble-error' : ''}" data-chat-role="${deps.escapeAttr(message.role)}">
                                 <div class="chat-bubble-role">${deps.escapeHtml(message.role === 'user' ? 'You' : 'Assistant')}</div>
                                 <div class="chat-bubble-body">${
                                   message.role === 'assistant'
                                     ? renderAssistantMessageHtml(message.content)
                                     : deps.escapeHtml(message.content).replace(/\n/g, '<br />')
                                 }</div>
                               </article>
                             `
                           )
                           .join('')
                   }
                 </div>

                 <div class="chat-footer">
                   <button type="button" class="chat-scroll-bottom" data-action="chat-scroll-bottom" hidden>Latest ↓</button>
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
                 </div>
               </div>
             </aside>`
          : ''
      }
      <button type="button" class="chat-launcher" data-action="toggle-chat-panel" aria-expanded="${chat.panelOpen ? 'true' : 'false'}" aria-label="${chat.panelOpen ? 'Close chat' : 'Open chat'}">?</button>
    </div>
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

  return requestProxyCompletion({
    settings: params.settings,
    messages: params.messages,
    context,
    formatInstructions: HVY_AI_RESPONSE_FORMAT_INSTRUCTIONS,
    mode: 'qa',
    debugLabel: 'chat',
  });
}

export async function requestProxyCompletion(params: ProxyCompletionParams): Promise<string> {
  const requestPayload = buildProxyChatRequest({
    provider: params.settings.provider,
    model: params.settings.model,
    messages: params.messages,
    context: params.context,
    formatInstructions: params.formatInstructions,
    mode: params.mode,
  });
  const debugLabel = params.debugLabel?.trim() || 'chat';

  console.debug(`[hvy:${debugLabel}] client request`, {
    provider: requestPayload.provider,
    model: requestPayload.model,
    messages: requestPayload.messages,
    contextLength: requestPayload.context.length,
    formatInstructionsLength: requestPayload.formatInstructions.length,
  });

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestPayload),
  });

  const payload = await readJsonResponse(response);
  console.debug(`[hvy:${debugLabel}] client response`, {
    ok: response.ok,
    status: response.status,
    payload,
  });
  if (!response.ok) {
    throw new Error(extractProxyError(payload, 'Chat request failed.'));
  }

  if (typeof (payload as ProxyChatResponse | null)?.output !== 'string' || (payload as ProxyChatResponse).output.trim().length === 0) {
    throw new Error('Proxy returned no assistant text.');
  }

  const output = (payload as ProxyChatResponse).output.trim();
  console.debug(`[hvy:${debugLabel}] client extracted output`, output);
  return output;
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
    formatInstructions: request.formatInstructions,
    mode: request.mode,
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

export function getDefaultModelForProvider(provider: ChatSettings['provider']): string {
  return provider === 'anthropic' ? DEFAULT_ANTHROPIC_MODEL : DEFAULT_OPENAI_MODEL;
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
    const syntheticDocument = wrapHvyFragmentAsDocument(source, { sectionId: 'rsp', title: 'Response' });
    const document = deserializeDocument(syntheticDocument, '.hvy');
    const [wrapperSection] = document.sections;
    if (!wrapperSection) {
      return null;
    }

    const content = [
      ...wrapperSection.blocks.map((block) => renderChatHvyBlock(block)),
      ...wrapperSection.children.map((section) => renderChatHvySection(section)),
      ...document.sections.slice(1).map((section) => renderChatHvySection(section)),
    ].join('');

    return `<div class="chat-hvy-response">${content}</div>`;
  } catch {
    return null;
  }
}

function renderChatHvySection(section: VisualSection): string {
  return `
    <section class="chat-hvy-section">
      <div class="chat-hvy-section-title">${escapeChatHtml(section.title)}</div>
      <div class="chat-hvy-section-body">
        ${section.blocks.map((block) => renderChatHvyBlock(block)).join('')}
        ${section.children.map((child) => renderChatHvySection(child)).join('')}
      </div>
    </section>
  `;
}

function renderChatHvyBlock(block: VisualBlock): string {
  const component = block.schema.component.trim();
  const helpers = getChatReaderHelpers();

  if (component === 'expandable') {
    ensureExpandableBlocks(block);
    const stubHtml = block.schema.expandableStubBlocks.children.map((child) => renderChatHvyBlock(child)).join('');
    const contentHtml = block.schema.expandableContentBlocks.children.map((child) => renderChatHvyBlock(child)).join('');
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
    customCss: '',
    tags: '',
    description: '',
    location: 'main',
    blocks: [],
    children: [],
  };
}

function getChatReaderHelpers(): ComponentRenderHelpers {
  return {
    escapeAttr: escapeChatAttr,
    escapeHtml: escapeChatHtml,
    markdownToEditorHtml,
    renderRichToolbar: () => '',
    renderEditorBlock: () => '',
    renderPassiveEditorBlock: () => '',
    renderReaderBlock: (_section: VisualSection, block: VisualBlock) => renderChatHvyBlock(block),
    renderComponentFragment: (_componentName: string, content: string) => markdownToEditorHtml(normalizeMarkdownLists(content)),
    renderComponentOptions: () => '',
    renderOption: () => '',
    getXrefTargetOptions: () => [],
    isXrefTargetValid,
    getTableColumns: (schema) =>
      schema.tableColumns
        .split(',')
        .map((column) => column.trim())
        .filter((column) => column.length > 0),
    ensureComponentListBlocks,
    ensureContainerBlocks: (_block: VisualBlock) => {},
    getSelectedAddComponent: () => 'text',
    isExpandableEditorPanelOpen: () => false,
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
