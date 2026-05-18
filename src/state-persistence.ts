import { deserializeDocumentBytes, serializeDocumentBytes } from './serialization';
import type { AppState, ChatMessage, ChatSettings, HvyCliHistoryEntry, HvyCliSessionState, SelectedExample, VisualDocument } from './types';
import { createDefaultSearchState } from './search/state';
import type { HvySearchMatch, HvySearchResult, SearchCategory, SearchState } from './search/types';

const SESSION_STORAGE_KEY = 'hvy-editor-session-state-v1';
const LEGACY_SESSION_STORAGE_KEYS = [
  'hvy-editor-resume-state-v2',
  'hvy-editor-resume-state-v1',
];
const DEFAULT_SAVED_CHAT_SETTINGS: ChatSettings = {
  provider: 'openai',
  model: 'gpt-5.4-mini',
  compactionProvider: 'openai',
  compactionModel: 'gpt-5.4-nano',
};

interface SessionStatePayload {
  version: 1;
  savedAt: string;
  filename: string;
  selectedExample?: SelectedExample;
  currentView: AppState['currentView'];
  editorMode: AppState['editorMode'];
  showAdvancedEditor: boolean;
  rawEditorText: string;
  templateValues: Record<string, string>;
  chat: {
    settings: ChatSettings;
    draft: string;
    messages: ChatMessage[];
    panelOpen: boolean;
  };
  search?: SavedSearchState;
  cli: {
    draft: string;
    session: HvyCliSessionState;
    history: HvyCliHistoryEntry[];
  };
  documentBase64: string;
}

type SavedSearchState = Omit<SearchState, 'isLoading' | 'error' | 'requestNonce' | 'abortController'>;

export interface LoadedSessionState {
  document: VisualDocument;
  filename: string;
  selectedExample?: SelectedExample;
  currentView: AppState['currentView'];
  editorMode: AppState['editorMode'];
  showAdvancedEditor: boolean;
  rawEditorText: string;
  templateValues: Record<string, string>;
  chat: SessionStatePayload['chat'];
  search: SearchState;
  cli: SessionStatePayload['cli'];
}

export function loadSessionState(storageKey?: string | null): LoadedSessionState | null {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(getSessionStorageKey(storageKey));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<SessionStatePayload> | null;
    if (!parsed || parsed.version !== 1 || typeof parsed.documentBase64 !== 'string') {
      return null;
    }
    const document = deserializeDocumentBytes(base64ToBytes(parsed.documentBase64), '.hvy');
    return {
      document,
      filename: typeof parsed.filename === 'string' && parsed.filename.trim() ? parsed.filename : 'document.hvy',
      selectedExample: isSelectedExample(parsed.selectedExample) ? parsed.selectedExample : undefined,
      currentView: isCurrentView(parsed.currentView) ? parsed.currentView : 'editor',
      editorMode: isEditorMode(parsed.editorMode) ? parsed.editorMode : 'basic',
      showAdvancedEditor: Boolean(parsed.showAdvancedEditor),
      rawEditorText: typeof parsed.rawEditorText === 'string' ? parsed.rawEditorText : '',
      templateValues: isStringRecord(parsed.templateValues) ? parsed.templateValues : {},
      chat: {
        settings: normalizeChatSettings(parsed.chat?.settings),
        draft: typeof parsed.chat?.draft === 'string' ? parsed.chat.draft : '',
        messages: Array.isArray(parsed.chat?.messages)
          ? parsed.chat.messages.map(normalizeChatMessage).filter((message): message is ChatMessage => Boolean(message))
          : [],
        panelOpen: Boolean(parsed.chat?.panelOpen),
      },
      search: normalizeSearchState(parsed.search),
      cli: {
        draft: typeof parsed.cli?.draft === 'string' ? parsed.cli.draft : '',
        session: normalizeCliSession(parsed.cli?.session),
        history: Array.isArray(parsed.cli?.history)
          ? parsed.cli.history.map(normalizeCliHistoryEntry).filter((entry): entry is HvyCliHistoryEntry => Boolean(entry))
          : [],
      },
    };
  } catch (error) {
    console.warn('[hvy:session] failed to load saved state', error);
    return null;
  }
}

export function saveSessionState(state: AppState): void {
  if (state.sessionStorageKey === null) {
    return;
  }
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return;
  }
  try {
    const payload: SessionStatePayload = {
      version: 1,
      savedAt: new Date().toISOString(),
      filename: state.filename,
      selectedExample: state.selectedExample,
      currentView: state.currentView,
      editorMode: state.editorMode,
      showAdvancedEditor: state.showAdvancedEditor,
      rawEditorText: state.rawEditorText,
      templateValues: state.templateValues,
      chat: {
        settings: state.chat.settings,
        draft: state.chat.draft,
        messages: state.chat.messages,
        panelOpen: state.chat.panelOpen,
      },
      search: serializeSearchState(state.search),
      cli: {
        draft: state.cliDraft,
        session: state.cliSession,
        history: state.cliHistory,
      },
      documentBase64: bytesToBase64(serializeDocumentBytes(state.document)),
    };
    window.sessionStorage.setItem(getSessionStorageKey(state.sessionStorageKey), JSON.stringify(payload));
    removeLegacySessionState();
  } catch (error) {
    console.warn('[hvy:session] failed to save state', error);
  }
}

export function clearSessionState(storageKey?: string | null): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.sessionStorage?.removeItem(getSessionStorageKey(storageKey));
    removeLegacySessionState();
  } catch {
    // Ignore storage failures.
  }
}

function removeLegacySessionState(): void {
  for (const key of LEGACY_SESSION_STORAGE_KEYS) {
    window.sessionStorage?.removeItem(key);
    window.localStorage?.removeItem(key);
  }
}

function getSessionStorageKey(storageKey?: string | null): string {
  const suffix = typeof storageKey === 'string' ? storageKey.trim() : '';
  if (!suffix) {
    return SESSION_STORAGE_KEY;
  }
  return `${SESSION_STORAGE_KEY}:${suffix}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function isCurrentView(value: unknown): value is AppState['currentView'] {
  return value === 'editor' || value === 'viewer' || value === 'ai';
}

function isSelectedExample(value: unknown): value is SelectedExample {
  return (
    value === 'default'
    || value === 'blank'
    || value === 'guide'
    || value === 'crm'
    || value === 'resume-template'
    || value === 'resume-example'
    || value === 'import-reference'
    || value === 'custom'
  );
}

function isEditorMode(value: unknown): value is AppState['editorMode'] {
  return value === 'basic' || value === 'mobile-adjustment' || value === 'advanced' || value === 'raw' || value === 'cli';
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}

function isChatSettings(value: unknown): value is ChatSettings {
  return Boolean(
    value &&
    typeof value === 'object' &&
    ((value as ChatSettings).provider === 'openai' || (value as ChatSettings).provider === 'anthropic' || (value as ChatSettings).provider === 'qwen') &&
    typeof (value as ChatSettings).model === 'string'
  );
}

function normalizeChatSettings(value: unknown): ChatSettings {
  if (!isChatSettings(value)) {
    return DEFAULT_SAVED_CHAT_SETTINGS;
  }
  return {
    provider: value.provider,
    model: value.model,
    compactionProvider: value.compactionProvider === 'anthropic' ? 'anthropic' : DEFAULT_SAVED_CHAT_SETTINGS.compactionProvider,
    compactionModel: typeof value.compactionModel === 'string' && value.compactionModel.trim()
      ? value.compactionModel
      : DEFAULT_SAVED_CHAT_SETTINGS.compactionModel,
    ...(isToolLoopCompactionOptions(value.toolLoopCompaction) ? { toolLoopCompaction: value.toolLoopCompaction } : {}),
  };
}

function isToolLoopCompactionOptions(value: unknown): value is NonNullable<ChatSettings['toolLoopCompaction']> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return ['compactAfterMessages', 'keepRecentMessages', 'latestToolResultContextChars', 'toolResultChatChars'].every((key) => {
    const entry = (value as Record<string, unknown>)[key];
    return entry === undefined || (typeof entry === 'number' && Number.isFinite(entry) && entry >= 0);
  });
}

function isChatMessage(value: unknown): value is ChatMessage {
  return Boolean(
    value &&
    typeof value === 'object' &&
    ((value as ChatMessage).role === 'user' || (value as ChatMessage).role === 'assistant') &&
    typeof (value as ChatMessage).id === 'string' &&
    typeof (value as ChatMessage).content === 'string'
  );
}

function normalizeChatMessage(value: unknown): ChatMessage | null {
  if (!isChatMessage(value)) {
    return null;
  }
  const message = value as ChatMessage;
  const work = normalizeChatWorkState(message.work);
  const wasRunning = work?.status === 'running';
  return {
    id: message.id,
    role: message.role,
    content: wasRunning && !message.content.trim()
      ? 'Interrupted by page reload.'
      : message.content,
    ...(typeof message.reasoning === 'string' ? { reasoning: message.reasoning } : {}),
    ...(isChatTokenUsage(message.tokenUsage) ? { tokenUsage: message.tokenUsage } : {}),
    ...(message.error || wasRunning ? { error: true } : {}),
    ...(message.progress && !wasRunning ? { progress: message.progress } : {}),
    ...(work ? { work: wasRunning ? { ...work, status: 'error' } : work } : {}),
  };
}

function normalizeCliSession(value: unknown): HvyCliSessionState {
  if (!value || typeof value !== 'object') {
    return { cwd: '/' };
  }
  const raw = value as Partial<HvyCliSessionState>;
  return {
    cwd: typeof raw.cwd === 'string' && raw.cwd.startsWith('/') ? raw.cwd : '/',
    ...(typeof raw.scratchpadContent === 'string' ? { scratchpadContent: raw.scratchpadContent } : {}),
    ...(typeof raw.scratchpadEdited === 'boolean' ? { scratchpadEdited: raw.scratchpadEdited } : {}),
    ...(Array.isArray(raw.scratchpadCommandsSinceEdit)
      ? { scratchpadCommandsSinceEdit: raw.scratchpadCommandsSinceEdit.filter((entry) => typeof entry === 'string') }
      : {}),
    ...(typeof raw.rawWipContent === 'string' ? { rawWipContent: raw.rawWipContent } : {}),
    ...(isStringRecord(raw.rawWipContentByPath) ? { rawWipContentByPath: raw.rawWipContentByPath } : {}),
    ...(isStringRecord(raw.rawSectionWipContentByPath) ? { rawSectionWipContentByPath: raw.rawSectionWipContentByPath } : {}),
    ...(raw.virtualPathNaming && typeof raw.virtualPathNaming === 'object' && isStringRecord(raw.virtualPathNaming.anonymousBlockNamesById)
      ? { virtualPathNaming: { anonymousBlockNamesById: raw.virtualPathNaming.anonymousBlockNamesById } }
      : {}),
  };
}

function normalizeCliHistoryEntry(value: unknown): HvyCliHistoryEntry | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const raw = value as Partial<HvyCliHistoryEntry>;
  if (typeof raw.cwd !== 'string' || typeof raw.command !== 'string') {
    return null;
  }
  return {
    cwd: raw.cwd.startsWith('/') ? raw.cwd : '/',
    command: raw.command,
    output: typeof raw.output === 'string' ? raw.output : '',
    error: Boolean(raw.error),
  };
}

function serializeSearchState(search: SearchState): SavedSearchState {
  return {
    open: search.open,
    queryDraft: search.queryDraft,
    submittedQuery: search.submittedQuery,
    caseSensitive: search.caseSensitive,
    categories: search.categories,
    activeTab: search.activeTab,
    filterEnabled: search.filterEnabled,
    filterMode: search.filterMode,
    resultsCollapsed: search.resultsCollapsed,
    activeResultId: search.activeResultId,
    results: search.results,
    navigationResultIds: search.navigationResultIds,
    clearedSectionKeys: search.clearedSectionKeys ?? [],
    clearedBlockIds: search.clearedBlockIds ?? [],
  };
}

function normalizeSearchState(value: unknown): SearchState {
  const defaults = createDefaultSearchState();
  if (!value || typeof value !== 'object') {
    return defaults;
  }
  const raw = value as Partial<SavedSearchState>;
  const submittedQuery = typeof raw.submittedQuery === 'string' ? raw.submittedQuery : '';
  return {
    ...defaults,
    open: Boolean(raw.open),
    queryDraft: typeof raw.queryDraft === 'string' ? raw.queryDraft : submittedQuery,
    submittedQuery,
    caseSensitive: Boolean(raw.caseSensitive),
    categories: normalizeSearchCategories(raw.categories),
    activeTab: raw.activeTab === 'filter' ? 'filter' : 'search',
    filterEnabled: Boolean(raw.filterEnabled) && submittedQuery.trim().length > 0,
    filterMode: raw.filterMode === 'hide' ? 'hide' : 'deprioritize',
    resultsCollapsed: Boolean(raw.resultsCollapsed),
    activeResultId: typeof raw.activeResultId === 'string' ? raw.activeResultId : null,
    results: Array.isArray(raw.results)
      ? raw.results.map(normalizeSearchResult).filter((result): result is HvySearchResult => Boolean(result))
      : [],
    navigationResultIds: Array.isArray(raw.navigationResultIds)
      ? raw.navigationResultIds.filter((entry) => typeof entry === 'string')
      : [],
    clearedSectionKeys: Array.isArray(raw.clearedSectionKeys)
      ? raw.clearedSectionKeys.filter((entry) => typeof entry === 'string')
      : [],
    clearedBlockIds: Array.isArray(raw.clearedBlockIds)
      ? raw.clearedBlockIds.filter((entry) => typeof entry === 'string')
      : [],
    isLoading: false,
    error: null,
    requestNonce: 0,
    abortController: null,
  };
}

function normalizeSearchCategories(value: unknown): Record<SearchCategory, boolean> {
  const defaults = createDefaultSearchState().categories;
  if (!value || typeof value !== 'object') {
    return defaults;
  }
  const raw = value as Partial<Record<SearchCategory, unknown>>;
  return {
    tags: typeof raw.tags === 'boolean' ? raw.tags : defaults.tags,
    contents: typeof raw.contents === 'boolean' ? raw.contents : defaults.contents,
    description: typeof raw.description === 'boolean' ? raw.description : defaults.description,
  };
}

function normalizeSearchResult(value: unknown): HvySearchResult | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const raw = value as Partial<HvySearchResult>;
  if (
    typeof raw.id !== 'string' ||
    !isSearchCategory(raw.category) ||
    (raw.targetKind !== 'section' && raw.targetKind !== 'block') ||
    typeof raw.sectionKey !== 'string' ||
    typeof raw.targetId !== 'string' ||
    typeof raw.label !== 'string' ||
    typeof raw.preview !== 'string' ||
    typeof raw.matchedText !== 'string' ||
    typeof raw.sourceField !== 'string'
  ) {
    return null;
  }
  return {
    id: raw.id,
    category: raw.category,
    targetKind: raw.targetKind,
    sectionKey: raw.sectionKey,
    ...(typeof raw.blockId === 'string' ? { blockId: raw.blockId } : {}),
    targetId: raw.targetId,
    ...(typeof raw.targetPath === 'string' ? { targetPath: raw.targetPath } : {}),
    label: raw.label,
    ...(typeof raw.locationLabel === 'string' ? { locationLabel: raw.locationLabel } : {}),
    preview: raw.preview,
    matchedText: raw.matchedText,
    sourceField: raw.sourceField,
    ...(typeof raw.contextLabel === 'string' ? { contextLabel: raw.contextLabel } : {}),
    ...(Array.isArray(raw.matches) ? { matches: raw.matches.filter(isSearchMatch) } : {}),
    ...(typeof raw.documentOrder === 'number' ? { documentOrder: raw.documentOrder } : {}),
    ...(typeof raw.sourceFile === 'string' ? { sourceFile: raw.sourceFile } : {}),
    ...(typeof raw.workspaceId === 'string' ? { workspaceId: raw.workspaceId } : {}),
    ...(typeof raw.score === 'number' ? { score: raw.score } : {}),
  };
}

function isSearchCategory(value: unknown): value is SearchCategory {
  return value === 'tags' || value === 'contents' || value === 'description';
}

function isSearchMatch(value: unknown): value is HvySearchMatch {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as HvySearchMatch).field === 'string' &&
    typeof (value as HvySearchMatch).label === 'string' &&
    typeof (value as HvySearchMatch).preview === 'string' &&
    typeof (value as HvySearchMatch).matchedText === 'string'
  );
}

function normalizeChatWorkState(value: unknown): ChatMessage['work'] | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const raw = value as ChatMessage['work'];
  if (!raw || (raw.status !== 'running' && raw.status !== 'done' && raw.status !== 'error')) {
    return undefined;
  }
  return {
    status: raw.status,
    ...(typeof raw.lastCommand === 'string' ? { lastCommand: raw.lastCommand } : {}),
    details: Array.isArray(raw.details) ? raw.details.filter((entry) => typeof entry === 'string') : [],
    reasoning: Array.isArray(raw.reasoning) ? raw.reasoning.filter((entry) => typeof entry === 'string') : [],
    ...(isChatTokenUsage(raw.tokenUsage) ? { tokenUsage: raw.tokenUsage } : {}),
  };
}

function isChatTokenUsage(value: unknown): value is NonNullable<ChatMessage['tokenUsage']> {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const raw = value as NonNullable<ChatMessage['tokenUsage']>;
  return (
    (raw.inputTokens === undefined || typeof raw.inputTokens === 'number') &&
    (raw.outputTokens === undefined || typeof raw.outputTokens === 'number') &&
    (raw.totalTokens === undefined || typeof raw.totalTokens === 'number') &&
    (raw.cachedTokens === undefined || typeof raw.cachedTokens === 'number') &&
    (raw.reasoningTokens === undefined || typeof raw.reasoningTokens === 'number')
  );
}
