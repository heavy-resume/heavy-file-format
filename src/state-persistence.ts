import { deserializeDocumentBytes, serializeDocumentBytes } from './serialization';
import type { AppState, ChatMessage, ChatSettings, VisualDocument } from './types';

const RESUME_STORAGE_KEY = 'hvy-editor-resume-state-v1';

interface ResumeStatePayload {
  version: 1;
  savedAt: string;
  filename: string;
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
  documentBase64: string;
}

export interface LoadedResumeState {
  document: VisualDocument;
  filename: string;
  currentView: AppState['currentView'];
  editorMode: AppState['editorMode'];
  showAdvancedEditor: boolean;
  rawEditorText: string;
  templateValues: Record<string, string>;
  chat: ResumeStatePayload['chat'];
}

export function loadResumeState(): LoadedResumeState | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(RESUME_STORAGE_KEY);
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
      currentView: isCurrentView(parsed.currentView) ? parsed.currentView : 'editor',
      editorMode: isEditorMode(parsed.editorMode) ? parsed.editorMode : 'basic',
      showAdvancedEditor: Boolean(parsed.showAdvancedEditor),
      rawEditorText: typeof parsed.rawEditorText === 'string' ? parsed.rawEditorText : '',
      templateValues: isStringRecord(parsed.templateValues) ? parsed.templateValues : {},
      chat: {
        settings: isChatSettings(parsed.chat?.settings)
          ? parsed.chat.settings
          : { provider: 'openai', model: 'gpt-5-mini' },
        draft: typeof parsed.chat?.draft === 'string' ? parsed.chat.draft : '',
        messages: Array.isArray(parsed.chat?.messages)
          ? parsed.chat.messages.filter(isChatMessage)
          : [],
        panelOpen: Boolean(parsed.chat?.panelOpen),
      },
    };
  } catch (error) {
    console.warn('[hvy:resume] failed to load saved state', error);
    return null;
  }
}

export function saveResumeState(state: AppState): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  try {
    const payload: ResumeStatePayload = {
      version: 1,
      savedAt: new Date().toISOString(),
      filename: state.filename,
      currentView: state.currentView,
      editorMode: state.editorMode,
      showAdvancedEditor: state.showAdvancedEditor,
      rawEditorText: state.rawEditorText,
      templateValues: state.templateValues,
      chat: {
        settings: state.chat.settings,
        draft: state.chat.draft,
        messages: state.chat.messages.filter((message) => !message.progress),
        panelOpen: state.chat.panelOpen,
      },
      documentBase64: bytesToBase64(serializeDocumentBytes(state.document)),
    };
    window.localStorage.setItem(RESUME_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn('[hvy:resume] failed to save state', error);
  }
}

export function clearResumeState(): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.removeItem(RESUME_STORAGE_KEY);
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

function isEditorMode(value: unknown): value is AppState['editorMode'] {
  return value === 'basic' || value === 'advanced' || value === 'raw' || value === 'cli';
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
    ((value as ChatSettings).provider === 'openai' || (value as ChatSettings).provider === 'anthropic') &&
    typeof (value as ChatSettings).model === 'string'
  );
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
