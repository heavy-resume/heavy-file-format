import { deserializeDocumentBytes, serializeDocumentBytes } from './serialization';
import type { AppState, ChatMessage, ChatSettings, HvyCliHistoryEntry, HvyCliSessionState, SelectedExample, VisualDocument } from './types';

const RESUME_STORAGE_KEY = 'hvy-editor-resume-state-v2';
const LEGACY_RESUME_STORAGE_KEY = 'hvy-editor-resume-state-v1';
const DEFAULT_SAVED_CHAT_SETTINGS: ChatSettings = {
  provider: 'openai',
  model: 'gpt-5-mini',
  compactionProvider: 'openai',
  compactionModel: 'gpt-5.4-nano',
};

interface ResumeStatePayload {
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
  cli: {
    draft: string;
    session: HvyCliSessionState;
    history: HvyCliHistoryEntry[];
  };
  documentBase64: string;
}

export interface LoadedResumeState {
  document: VisualDocument;
  filename: string;
  selectedExample?: SelectedExample;
  currentView: AppState['currentView'];
  editorMode: AppState['editorMode'];
  showAdvancedEditor: boolean;
  rawEditorText: string;
  templateValues: Record<string, string>;
  chat: ResumeStatePayload['chat'];
  cli: ResumeStatePayload['cli'];
}

export function loadResumeState(): LoadedResumeState | null {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(RESUME_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<ResumeStatePayload> | null;
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
      cli: {
        draft: typeof parsed.cli?.draft === 'string' ? parsed.cli.draft : '',
        session: normalizeCliSession(parsed.cli?.session),
        history: Array.isArray(parsed.cli?.history)
          ? parsed.cli.history.map(normalizeCliHistoryEntry).filter((entry): entry is HvyCliHistoryEntry => Boolean(entry))
          : [],
      },
    };
  } catch (error) {
    console.warn('[hvy:resume] failed to load saved state', error);
    return null;
  }
}

export function saveResumeState(state: AppState): void {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return;
  }
  try {
    const payload: ResumeStatePayload = {
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
      cli: {
        draft: state.cliDraft,
        session: state.cliSession,
        history: state.cliHistory,
      },
      documentBase64: bytesToBase64(serializeDocumentBytes(state.document)),
    };
    window.sessionStorage.setItem(RESUME_STORAGE_KEY, JSON.stringify(payload));
    window.localStorage?.removeItem(LEGACY_RESUME_STORAGE_KEY);
  } catch (error) {
    console.warn('[hvy:resume] failed to save state', error);
  }
}

export function clearResumeState(): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.sessionStorage?.removeItem(RESUME_STORAGE_KEY);
    window.localStorage?.removeItem(LEGACY_RESUME_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
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
    || value === 'crm'
    || value === 'resume-template'
    || value === 'resume-example'
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
  };
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
