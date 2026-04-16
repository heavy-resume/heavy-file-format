import type { BlockSchema, VisualBlock, VisualSection } from './editor/types';
import type { JsonObject } from './hvy/types';

export interface VisualDocument {
  meta: JsonObject;
  extension: '.hvy' | '.thvy' | '.md';
  sections: VisualSection[];
}

export interface PaneScrollState {
  editorTop: number;
  readerTop: number;
  windowTop: number;
}

export interface ReusableSaveModalState {
  kind: 'component' | 'section';
  sectionKey: string;
  blockId?: string;
  draftName: string;
}

export interface ThemeConfig {
  mode: 'light' | 'dark';
  background: string;
  surface: string;
  text: string;
  accent: string;
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
  currentView: 'editor' | 'viewer';
  paneScroll: PaneScrollState;
  showAdvancedEditor: boolean;
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
  gridAddComponentByBlock: Record<string, string>;
  expandableEditorPanels: Record<string, { stubOpen: boolean; expandedOpen: boolean }>;
  lastHistoryGroup: string | null;
  lastHistoryAt: number;
  pendingEditorCenterSectionKey: string | null;
}
