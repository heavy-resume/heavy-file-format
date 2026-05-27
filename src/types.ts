import type { BlockSchema, VisualBlock, VisualSection } from './editor/types';
import type { JsonObject } from './hvy/types';
import type { HvyPdfExportPlan } from './pdf-export/types';
import type { SearchState } from './search/types';
import type { ProxyChatMode } from './chat/chat';

export interface DocumentAttachment {
  id: string;
  meta: JsonObject;
  bytes: Uint8Array;
}

export interface VisualDocument {
  meta: JsonObject;
  extension: '.hvy' | '.thvy' | '.phvy' | '.md';
  sections: VisualSection[];
  attachments: DocumentAttachment[];
}

export interface ImageAttachmentMaxDimensions {
  width?: number;
  height?: number;
}

export type ChatProvider = 'openai' | 'anthropic' | 'qwen';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  tokenUsage?: ChatTokenUsage;
  error?: boolean;
  progress?: boolean;
  work?: ChatWorkState;
}

export interface ChatTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
}

export interface ChatWorkState {
  status: 'running' | 'done' | 'error';
  lastCommand?: string;
  details: string[];
  reasoning: string[];
  tokenUsage?: ChatTokenUsage;
}

export interface ToolLoopCompactionOptions {
  compactAfterMessages?: number;
  keepRecentMessages?: number;
  latestToolResultContextChars?: number;
  toolResultChatChars?: number;
}

export interface ChatCliSimState {
  requestPayload: unknown | null;
  requestJson: string;
  responseJson: string;
  responseOutput: string;
  toolTurn?: unknown;
  reasoningSummary: string;
  commandResultMessage: string;
  turnState: unknown | null;
  isPreparing: boolean;
  isSending: boolean;
  error: string | null;
}

export interface ChatSettings {
  provider: ChatProvider;
  model: string;
  compactionProvider?: ChatProvider;
  compactionModel?: string;
  toolLoopCompaction?: ToolLoopCompactionOptions;
}

export interface ChatState {
  settings: ChatSettings;
  draft: string;
  messages: ChatMessage[];
  isSending: boolean;
  error: string | null;
  panelOpen: boolean;
  requestNonce: number;
  abortController: AbortController | null;
  cliSimEnabled: boolean;
  cliSim: ChatCliSimState | null;
}

export interface PdfExportPlanModalState {
  templateId: string;
  values: Record<string, string>;
  isRunning: boolean;
  status: string | null;
  error: string | null;
  plan: HvyPdfExportPlan | null;
}

export interface PdfTemplateImportModalState {
  isRunning: boolean;
  status: string | null;
  error: string | null;
  steps: PdfTemplateImportStepState[];
  totalTokenUsage: ChatTokenUsage;
  awaitingLlmStep: boolean;
  awaitingLlmStepId: string | null;
  requestLog: PdfTemplateImportRequestLogEntry[];
}

export interface PdfTemplateImportStepState {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'complete' | 'error';
  tokenUsage: ChatTokenUsage;
}

export interface PdfTemplateImportRequestLogEntry {
  callIndex: number;
  stage: string;
  debugLabel: string;
  phase: string;
  request: {
    settings: ChatSettings;
    messages: ChatMessage[];
    context: string;
    responseInstructions: string;
    systemInstructions?: string;
    mode: ProxyChatMode;
    maxContextChars?: number;
  };
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
  viewerSidebarTop: number;
  readerTop: number;
  windowLeft: number;
  windowTop: number;
}

export interface ReusableSaveModalState {
  kind: 'component' | 'section';
  sectionKey: string;
  blockId?: string;
  draftName: string;
  existingName?: string;
}

export interface ReusableTemplateModalState {
  component: string;
  target:
    | { kind: 'section'; sectionKey: string }
    | { kind: 'component-list'; sectionKey: string; blockId: string }
    | { kind: 'container'; sectionKey: string; blockId: string }
    | { kind: 'grid'; sectionKey: string; blockId: string }
    | { kind: 'expandable'; sectionKey: string; blockId: string; part: 'stub' | 'content' };
}

export interface SectionTemplateFlavorModalState {
  templateName: string;
  location?: 'main' | 'sidebar';
}

export interface SqliteRowComponentModalState {
  sectionKey: string;
  blockId: string;
  tableName: string;
  rowId: number;
  blocks: VisualBlock[];
  error: string | null;
  readOnly: boolean;
  previousActiveEditorBlock: { sectionKey: string; blockId: string } | null;
  mode: 'basic' | 'advanced' | 'raw';
  rawDraft: string;
}

export interface DbTableQueryModalState {
  sectionKey: string;
  blockId: string;
  tableName: string;
  draftQuery: string;
  dynamicWindow: boolean;
  queryLimit: number;
  error: string | null;
}

export interface ComponentPlacementState {
  mode: 'move' | 'copy';
  sectionKey: string;
  blockId: string;
}

export type HvyEditorClipboardPayload =
  | { kind: 'component'; block: VisualBlock; attachments?: DocumentAttachment[] }
  | { kind: 'section'; section: VisualSection; attachments?: DocumentAttachment[] };

export interface HvyEditorClipboardHost {
  read(): HvyEditorClipboardPayload | null;
  write(payload: HvyEditorClipboardPayload): void;
}

export interface RawEditorDiagnostic {
  severity: 'warning' | 'error';
  message: string;
  hint: string;
}

export interface HvyCliHistoryEntry {
  cwd: string;
  command: string;
  output: string;
  error: boolean;
}

export interface HvyCliSessionState {
  cwd: string;
  scratchpadContent?: string;
  scratchpadEdited?: boolean;
  scratchpadCommandsSinceEdit?: string[];
  rawWipContent?: string;
  rawWipContentByPath?: Record<string, string>;
  rawSectionWipContentByPath?: Record<string, string>;
  virtualPathNaming?: {
    anonymousBlockNamesById?: Record<string, string>;
  };
}

export interface ThemeConfig {
  colors: Record<string, string>;
}

export type ReaderViewModifier = 'highlight' | 'priority' | 'collapse' | 'dimmed' | 'hidden';
export type ReaderViewFilter = Record<string, ReaderViewModifier[]>;
export type SelectedExample =
  | 'default'
  | 'blank'
  | 'guide'
  | 'crm'
  | 'study-tools'
  | 'resume-template'
  | 'resume-example'
  | 'import-reference'
  | 'scripting-help'
  | 'custom';

export interface ComponentDefinition {
  name: string;
  baseType: string;
  tags?: string;
  description?: string;
  templateVariables?: Record<string, { label?: string; generator?: string; generatorLabel?: string }>;
  schema?: BlockSchema;
  template?: VisualBlock;
  flavors?: ComponentTemplateFlavor[];
}

export interface ComponentTemplateFlavor {
  name: string;
  description?: string;
  templateVariables?: Record<string, { label?: string; generator?: string; generatorLabel?: string }>;
  schema?: BlockSchema;
  template?: VisualBlock;
}

export interface SectionDefinition {
  name: string;
  key?: string;
  repeatable?: boolean;
  templateVariables?: Record<string, { label?: string; generator?: string; generatorLabel?: string }>;
  template: VisualSection;
  flavors?: SectionTemplateFlavor[];
}

export interface SectionTemplateFlavor {
  name: string;
  description?: string;
  templateVariables?: Record<string, { label?: string; generator?: string; generatorLabel?: string }>;
  template: VisualSection;
}

export interface AppState {
  document: VisualDocument;
  filename: string;
  selectedExample?: SelectedExample;
  currentView: 'editor' | 'viewer' | 'ai';
  editorMode: 'basic' | 'mobile-adjustment' | 'advanced' | 'raw' | 'cli';
  responsivePreview: 'full' | 'phone' | 'tablet' | 'desktop';
  sessionStorageKey?: string | null;
  persistDocumentState?: boolean;
  imageAttachmentMaxDimensions?: ImageAttachmentMaxDimensions | null;
  chat: ChatState;
  aiEdit: AiEditState;
  aiModeTipDismissed: boolean;
  contextMenu?: ContextMenuState | null;
  search: SearchState;
  metaFilter: {
    query: string;
    mode: 'keyword' | 'semantic';
    isRunning: boolean;
    status: string | null;
    error: string | null;
    resultCount: number | null;
  };
  paneScroll: PaneScrollState;
  showAdvancedEditor: boolean;
  rawEditorText: string;
  rawEditorError: string | null;
  rawEditorDiagnostics: RawEditorDiagnostic[];
  cliDraft: string;
  cliSession: HvyCliSessionState;
  cliHistory: HvyCliHistoryEntry[];
  activeEditorBlock: { sectionKey: string; blockId: string } | null;
  activeTextEditorMode?: { sectionKey: string; blockId: string; mode: 'rich' | 'fill-in' } | null;
  aiEditorHostBlock: { sectionKey: string; blockId: string } | null;
  aiEditorHostSectionKey: string | null;
  activeEditorBlockPath: { sectionKey: string; blockId: string }[];
  activeEditorBlockSnapshot: { sectionKey: string; blockId: string; block: VisualBlock } | null;
  activeEditorBlockSnapshots: { sectionKey: string; blockId: string; block: VisualBlock }[];
  activeEditorNewBlockIds: Set<string>;
  activeEditorBlockReturnScroll: PaneScrollState | null;
  pendingPaneScrollRestore: PaneScrollState | null;
  componentPlacement: ComponentPlacementState | null;
  pendingEditorDeactivation: {
    sectionKey: string;
    blockId: string;
    anchorTop: number;
    editableTag: string;
    editableClass: string;
  } | null;
  pendingEditorActivation: {
    sectionKey: string;
    blockId: string;
    revealPath?: boolean;
    anchorTop?: number;
    clientX?: number;
    clientY?: number;
    preferTextFocus?: boolean;
    immediateFocus?: boolean;
  } | null;
  activeEditorSectionTitleKey: string | null;
  clearSectionTitleOnFocusKey: string | null;
  modalSectionKey: string | null;
  newDocumentModalOpen: boolean;
  reusableSaveModal: ReusableSaveModalState | null;
  reusableTemplateModal: ReusableTemplateModalState | null;
  sectionTemplateFlavorModal: SectionTemplateFlavorModalState | null;
  tempHighlights: Set<string>;
  addComponentBySection: Record<string, string>;
  metaPanelOpen: boolean;
  openTextLineStyleName: string | null;
  paragraphStyleRecentNames: string[];
  descriptionPopulate?: {
    isRunning: boolean;
    status: string | null;
    completed: number;
    total: number;
    current: string;
    skippedLeaves: number;
    lastGenerated: string;
  };
  selectedReusableComponentName: string | null;
  templateValues: Record<string, string>;
  history: string[];
  future: string[];
  isRestoring: boolean;
  componentMetaModal: { sectionKey: string; blockId: string } | null;
  sqliteRowComponentModal: SqliteRowComponentModalState | null;
  dbTableQueryModal: DbTableQueryModalState | null;
  pdfExportPlanModal: PdfExportPlanModalState | null;
  pdfTemplateImportModal: PdfTemplateImportModalState | null;
  themeModalOpen: boolean;
  themeModalMode: 'full' | 'advanced';
  paletteOverrideId: string | null;
  gridAddComponentByBlock: Record<string, string>;
  expandableEditorPanels: Record<string, { stubOpen: boolean; expandedOpen: boolean }>;
  readerExpandableState: Record<string, boolean>;
  readerContainerState: Record<string, boolean>;
  readerView: ReaderViewFilter;
  readerViewActivatedTargets: Set<string>;
  componentListReaderViews: Record<string, string>;
  viewerSidebarOpen: boolean;
  editorSidebarOpen: boolean;
  viewerSidebarHelpDismissed: boolean;
  editorSidebarHelpDismissed: boolean;
  lastHistoryGroup: string | null;
  lastHistoryAt: number;
  pendingEditorCenterSectionKey: string | null;
}

export interface ContextMenuState {
  kind: 'filter' | 'ai' | 'editor';
  sectionKey: string;
  blockId?: string;
  x: number;
  y: number;
  targetRect?: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}
