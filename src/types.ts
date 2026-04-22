import type { BlockSchema, VisualBlock, VisualSection } from './editor/types';
import type { JsonObject } from './hvy/types';

export interface VisualDocument {
  meta: JsonObject;
  extension: '.hvy' | '.thvy' | '.md';
  sections: VisualSection[];
}

export type ChatProvider = 'openai' | 'anthropic';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  error?: boolean;
}

export interface ChatSettings {
  provider: ChatProvider;
  model: string;
}

export interface ChatState {
  settings: ChatSettings;
  draft: string;
  messages: ChatMessage[];
  isSending: boolean;
  error: string | null;
  panelOpen: boolean;
  requestNonce: number;
}

export interface AiEditState {
  sectionKey: string | null;
  blockId: string | null;
  draft: string;
  isSending: boolean;
  error: string | null;
  popupX: number;
  popupY: number;
  requestNonce: number;
}

export interface PaneScrollState {
  editorTop: number;
  editorSidebarTop: number;
  readerTop: number;
  windowTop: number;
}

export interface ReusableSaveModalState {
  kind: 'component' | 'section';
  sectionKey: string;
  blockId?: string;
  draftName: string;
}

export interface RawEditorDiagnostic {
  severity: 'warning' | 'error';
  message: string;
  hint: string;
}

export interface ThemeConfig {
  colors: Record<string, string>;
}

export interface ComponentDefinition {
  name: string;
  baseType: string;
  tags?: string;
  description?: string;
  schema?: BlockSchema;
  template?: VisualBlock;
}

export interface SectionDefinition {
  name: string;
  template: VisualSection;
}

export interface AppState {
  document: VisualDocument;
  filename: string;
  currentView: 'editor' | 'viewer' | 'ai';
  editorMode: 'basic' | 'advanced' | 'raw';
  chat: ChatState;
  aiEdit: AiEditState;
  paneScroll: PaneScrollState;
  showAdvancedEditor: boolean;
  rawEditorText: string;
  rawEditorError: string | null;
  rawEditorDiagnostics: RawEditorDiagnostic[];
  activeEditorBlock: { sectionKey: string; blockId: string } | null;
  activeEditorSectionTitleKey: string | null;
  clearSectionTitleOnFocusKey: string | null;
  modalSectionKey: string | null;
  reusableSaveModal: ReusableSaveModalState | null;
  tempHighlights: Set<string>;
  addComponentBySection: Record<string, string>;
  metaPanelOpen: boolean;
  selectedReusableComponentName: string | null;
  templateValues: Record<string, string>;
  history: string[];
  future: string[];
  isRestoring: boolean;
  componentMetaModal: { sectionKey: string; blockId: string } | null;
  themeModalOpen: boolean;
  gridAddComponentByBlock: Record<string, string>;
  expandableEditorPanels: Record<string, { stubOpen: boolean; expandedOpen: boolean }>;
  viewerSidebarOpen: boolean;
  editorSidebarOpen: boolean;
  lastHistoryGroup: string | null;
  lastHistoryAt: number;
  pendingEditorCenterSectionKey: string | null;
}
