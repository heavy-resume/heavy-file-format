import type { Align, BlockSchema, TableRow, VisualBlock, VisualSection } from './types';

export interface RichToolbarOptions {
  field?: string;
  gridItemId?: string;
  rowIndex?: number;
  includeAlign?: boolean;
  align?: Align;
  currentMarkdown?: string;
}

export interface XrefTargetOption {
  value: string;
  label: string;
}

export interface ComponentRenderHelpers {
  escapeAttr: (value: string) => string;
  escapeHtml: (value: string) => string;
  markdownToEditorHtml: (markdown: string) => string;
  renderRichToolbar: (sectionKey: string, blockId: string, options?: RichToolbarOptions) => string;
  renderEditorBlock: (sectionKey: string, block: VisualBlock, parentLocked?: boolean) => string;
  renderPassiveEditorBlock: (sectionKey: string, block: VisualBlock) => string;
  renderReaderBlock: (section: VisualSection, block: VisualBlock) => string;
  renderComponentFragment: (componentName: string, content: string, block: VisualBlock) => string;
  renderComponentOptions: (selected: string) => string;
  renderAddComponentPicker: (options: AddComponentPickerOptions) => string;
  renderComponentPlacementTarget: (options: ComponentPlacementTargetOptions) => string;
  renderOption: (value: string, selected: string) => string;
  getDocumentComponentCss: (componentName: string) => string;
  getXrefTargetOptions: () => XrefTargetOption[];
  isXrefTargetValid: (target: string) => boolean;
  getTableColumns: (schema: BlockSchema) => string[];
  ensureContainerBlocks: (block: VisualBlock) => void;
  ensureComponentListBlocks: (block: VisualBlock) => void;
  getSelectedAddComponent: (key: string, fallback: string) => string;
  isExpandableEditorPanelOpen: (sectionKey: string, blockId: string, panel: 'stub' | 'expanded', fallback: boolean) => boolean;
}

export interface AddComponentPickerOptions {
  id: string;
  action: string;
  sectionKey: string;
  blockId?: string;
  label?: string;
  extraAttrs?: Record<string, string>;
}

export interface ComponentPlacementTargetOptions {
  container: 'section' | 'grid';
  sectionKey: string;
  placement: 'before' | 'after' | 'end';
  targetBlockId?: string;
  parentBlockId?: string;
  targetGridItemId?: string;
}

export interface ComponentEditorRenderer {
  (sectionKey: string, block: VisualBlock, helpers: ComponentRenderHelpers): string;
}

export interface ComponentReaderRenderer {
  (section: VisualSection, block: VisualBlock, helpers: ComponentRenderHelpers): string;
}

export interface TableDetailsRenderer {
  (sectionKey: string, row: TableRow, helpers: ComponentRenderHelpers): string;
}
