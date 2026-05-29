import type { Align, BlockSchema, TableRow, VisualBlock, VisualSection } from './types';
import type { TextLineStyles } from '../text-line-styles';

export interface RichToolbarOptions {
  field?: string;
  gridItemId?: string;
  rowIndex?: number;
  includeAlign?: boolean;
  includeFillIn?: boolean;
  align?: Align;
  currentMarkdown?: string;
  textLineStyles?: TextLineStyles;
}

export interface XrefTargetOption {
  value: string;
  label: string;
  title: string;
  detail: string;
}

export interface ComponentRenderHelpers {
  escapeAttr: (value: string) => string;
  escapeHtml: (value: string) => string;
  markdownToEditorHtml: (markdown: string) => string;
  renderRichToolbar: (sectionKey: string, blockId: string, options?: RichToolbarOptions) => string;
  renderEditorBlock: (sectionKey: string, block: VisualBlock, parentLocked?: boolean) => string;
  renderPassiveEditorBlock: (sectionKey: string, block: VisualBlock) => string;
  renderReaderBlock: (section: VisualSection, block: VisualBlock) => string;
  renderReaderBlocks: (section: VisualSection, blocks: VisualBlock[]) => string;
  renderReaderListBlocks: (section: VisualSection, blocks: VisualBlock[]) => string;
  orderReaderBlocks: (blocks: VisualBlock[]) => VisualBlock[];
  orderReaderListBlocks: (blocks: VisualBlock[]) => VisualBlock[];
  isReaderViewPrioritizedBlock: (block: VisualBlock) => boolean;
  renderComponentFragment: (componentName: string, content: string, block: VisualBlock, sectionKey?: string) => string;
  renderComponentOptions: (selected: string) => string;
  renderAddComponentPicker: (options: AddComponentPickerOptions) => string;
  renderComponentPlacementTarget: (options: ComponentPlacementTargetOptions) => string;
  renderOption: (value: string, selected: string) => string;
  getDocumentComponentCss: (componentName: string) => string;
  getXrefTargetOptions: (tagFilter?: string) => XrefTargetOption[];
  isXrefTargetValid: (target: string, tagFilter?: string) => boolean;
  getEffectiveXrefTargetTagFilter?: (block: VisualBlock) => string;
  getTableColumns: (schema: BlockSchema) => string[];
  ensureContainerBlocks: (block: VisualBlock) => void;
  ensureComponentListBlocks: (block: VisualBlock) => void;
  getSelectedAddComponent: (key: string, fallback: string) => string;
  getComponentListReaderViewId: (sectionKey: string, blockId: string) => string;
  getReaderContainerExpanded: (key: string, fallback: boolean) => boolean;
  isExpandableEditorPanelOpen: (sectionKey: string, blockId: string, panel: 'stub' | 'expanded', fallback: boolean) => boolean;
  isAdvancedEditorMode: () => boolean;
  isMobileAdjustmentMode: () => boolean;
  isReusableDefinitionEditor?: () => boolean;
  isPdfDocument?: () => boolean;
  getTextLineStyles?: () => TextLineStyles;
}

export interface AddComponentPickerOptions {
  id: string;
  action: string;
  sectionKey: string;
  blockId?: string;
  label?: string;
  extraAttrs?: Record<string, string>;
  componentFilter?: (componentName: string, pluginId?: string) => boolean;
  componentDisabledReason?: (componentName: string, pluginId?: string) => string | null | undefined;
}

export interface ComponentPlacementTargetOptions {
  container: 'section' | 'grid' | 'container' | 'component-list' | 'expandable-stub' | 'expandable-content';
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
