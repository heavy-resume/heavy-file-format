import type { Align, BlockSchema, TableRow, VisualBlock, VisualSection } from './types';

export interface RichToolbarOptions {
  field?: string;
  gridItemId?: string;
  rowIndex?: number;
  includeAlign?: boolean;
  align?: Align;
}

export interface ComponentRenderHelpers {
  escapeAttr: (value: string) => string;
  escapeHtml: (value: string) => string;
  markdownToEditorHtml: (markdown: string) => string;
  renderRichToolbar: (sectionKey: string, blockId: string, options?: RichToolbarOptions) => string;
  renderEditorBlock: (sectionKey: string, block: VisualBlock) => string;
  renderReaderBlock: (section: VisualSection, block: VisualBlock) => string;
  renderComponentFragment: (componentName: string, content: string, block: VisualBlock) => string;
  renderComponentOptions: (selected: string) => string;
  renderOption: (value: string, selected: string) => string;
  getTableColumns: (schema: BlockSchema) => string[];
  ensureContainerBlocks: (block: VisualBlock) => void;
  getSelectedAddComponent: (key: string, fallback: string) => string;
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
