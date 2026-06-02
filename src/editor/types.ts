import type { JsonObject } from '../hvy/types';

export type Align = 'left' | 'center' | 'right';
export type Slot = 'left' | 'center' | 'right';

export interface TableRow {
  cells: string[];
}

export interface CarouselImage {
  imageFile: string;
  imageAlt: string;
  caption: string;
}

export type SortKeyValue = number | string;

export interface GridItem {
  id: string;
  idGenerated?: boolean;
  block: VisualBlock;
}

export interface ExpandablePart {
  lock: boolean;
  children: VisualBlock[];
}

export type BuiltinComponentName =
  | 'text'
  | 'code'
  | 'container'
  | 'component-list'
  | 'grid'
  | 'expandable'
  | 'table'
  | 'image'
  | 'carousel'
  | 'button'
  | 'plugin'
  | 'xref-card';

export interface BaseBlockSchema {
  kind: BuiltinComponentName;
  id: string;
  component: string;
  editorOnly: boolean;
  lock: boolean;
  align: Align;
  slot: Slot;
  css: string;
  sortKeys: Record<string, SortKeyValue>;
  groupKeys: Record<string, string>;
  tags: string;
  description: string;
  hideIfYes: string;
  visibleScript: string;
  placeholder: string;
  fillIn: boolean;
  showCopy: boolean;
  metaOpen: boolean;
  xrefTitle: string;
  xrefDetail: string;
}

export interface TextBlockSchema extends BaseBlockSchema {
  kind: 'text';
}

export interface CodeBlockSchema extends BaseBlockSchema {
  kind: 'code';
  codeLanguage: string;
}

export interface ContainerBlockSchema extends BaseBlockSchema {
  kind: 'container';
  containerBlocks: VisualBlock[];
  containerTitle: string;
  containerExpanded: boolean;
  containerCollapsedPreviewRem: number;
}

export interface ComponentListBlockSchema extends BaseBlockSchema {
  kind: 'component-list';
  componentListComponent: string;
  componentListItemLabel: string;
  componentListBlocks: VisualBlock[];
  componentListDefaultSortKey: string;
  componentListDefaultSortDirection: 'asc' | 'desc';
  componentListDefaultGroupKey: string;
  componentListGroupCollapsedPreviewRem: number;
}

export interface GridBlockSchema extends BaseBlockSchema {
  kind: 'grid';
  gridColumns: number;
  gridItems: GridItem[];
}

export interface ExpandableBlockSchema extends BaseBlockSchema {
  kind: 'expandable';
  expandableStubComponent: string;
  expandableContentComponent: string;
  expandableStub: string;
  expandableStubCss: string;
  expandableStubDescription: string;
  expandableStubBlocks: ExpandablePart;
  expandableAlwaysShowStub: boolean;
  expandableExpanded: boolean;
  expandableContentCss: string;
  expandableContentDescription: string;
  expandableContentBlocks: ExpandablePart;
}

export interface TableBlockSchema extends BaseBlockSchema {
  kind: 'table';
  tableColumns: string[];
  tableShowHeader: boolean;
  tableRows: TableRow[];
}

export interface ImageBlockSchema extends BaseBlockSchema {
  kind: 'image';
  imageFile: string;
  imageAlt: string;
}

export interface CarouselBlockSchema extends BaseBlockSchema {
  kind: 'carousel';
  carouselImages: CarouselImage[];
  carouselDurationMs: number;
  carouselPauseOnHover: boolean;
  carouselShowControls: boolean;
  carouselShowIndicators: boolean;
}

export interface ButtonBlockSchema extends BaseBlockSchema {
  kind: 'button';
  buttonLabel: string;
  buttonAction: 'ai-generate';
  buttonVisibleScript: string;
  buttonSourceScript: string;
  buttonPrompt: string;
  buttonTargetScript: string;
  buttonInputCharLimit: number;
  buttonOutputCharLimit: number;
  buttonPositionTargetId: string;
  buttonCss: string;
}

export interface PluginBlockSchema extends BaseBlockSchema {
  kind: 'plugin';
  plugin: string;
  pluginConfig: JsonObject;
}

export interface XrefCardBlockSchema extends BaseBlockSchema {
  kind: 'xref-card';
  xrefTarget: string;
  xrefTargetTagFilter: string;
}

export type ComponentBlockSchema =
  | TextBlockSchema
  | CodeBlockSchema
  | ContainerBlockSchema
  | ComponentListBlockSchema
  | GridBlockSchema
  | ExpandableBlockSchema
  | TableBlockSchema
  | ImageBlockSchema
  | CarouselBlockSchema
  | ButtonBlockSchema
  | PluginBlockSchema
  | XrefCardBlockSchema;

interface RuntimeSchemaFieldAccess {
  codeLanguage: string;
  containerBlocks: VisualBlock[];
  containerTitle: string;
  containerExpanded: boolean;
  containerCollapsedPreviewRem: number;
  componentListComponent: string;
  componentListItemLabel: string;
  componentListBlocks: VisualBlock[];
  componentListDefaultSortKey: string;
  componentListDefaultSortDirection: 'asc' | 'desc';
  componentListDefaultGroupKey: string;
  componentListGroupCollapsedPreviewRem: number;
  gridColumns: number;
  gridItems: GridItem[];
  xrefTarget: string;
  xrefTargetTagFilter: string;
  plugin: string;
  pluginConfig: JsonObject;
  expandableStubComponent: string;
  expandableContentComponent: string;
  expandableStub: string;
  expandableStubCss: string;
  expandableStubDescription: string;
  expandableStubBlocks: ExpandablePart;
  expandableAlwaysShowStub: boolean;
  expandableExpanded: boolean;
  expandableContentCss: string;
  expandableContentDescription: string;
  expandableContentBlocks: ExpandablePart;
  tableColumns: string[];
  tableShowHeader: boolean;
  tableRows: TableRow[];
  imageFile: string;
  imageAlt: string;
  carouselImages: CarouselImage[];
  carouselDurationMs: number;
  carouselPauseOnHover: boolean;
  carouselShowControls: boolean;
  carouselShowIndicators: boolean;
  buttonLabel: string;
  buttonAction: 'ai-generate';
  buttonVisibleScript: string;
  buttonSourceScript: string;
  buttonPrompt: string;
  buttonTargetScript: string;
  buttonInputCharLimit: number;
  buttonOutputCharLimit: number;
  buttonPositionTargetId: string;
  buttonCss: string;
}

export type BlockSchema = ComponentBlockSchema & RuntimeSchemaFieldAccess;

export interface VisualBlock {
  id: string;
  idGenerated?: boolean;
  text: string;
  schema: BlockSchema;
  schemaMode: boolean;
}

export type SectionLocation = 'main' | 'sidebar';

export interface VisualSection {
  key: string;
  customId: string;
  customIdGenerated?: boolean;
  contained: boolean;
  editorOnly: boolean;
  lock: boolean;
  idEditorOpen: boolean;
  isGhost: boolean;
  title: string;
  level: number;
  expanded: boolean;
  highlight: boolean;
  priority?: boolean;
  css: string;
  tags: string;
  description: string;
  location: SectionLocation;
  hideIfUnmodified?: boolean;
  exclude_from_import?: boolean;
  protect_from_import?: boolean;
  templateKey?: string;
  blocks: VisualBlock[];
  children: VisualSection[];
  /** Editor-only: marks a subsection auto-generated to hold trailing blocks when a
   * sibling block was wrapped into a subsection. Allows symmetric unwrap to fold
   * the trailing remnant back into the parent. Not persisted to disk. */
  autoTail?: boolean;
  /** Editor-only render anchor placing this subsection inline among the parent's
   * blocks. `null`/`undefined` = render after all blocks (legacy default).
   * `''` = render before all blocks. Otherwise = render right after the block with
   * the given id in the parent's `blocks` array. Not persisted to disk. */
  renderAfterBlockId?: string | null;
}
