import type { JsonObject } from '../hvy/types';

export type Align = 'left' | 'center' | 'right';
export type Slot = 'left' | 'center' | 'right';

export interface TableRow {
  cells: string[];
}

export type SortKeyValue = number | string;

export interface GridItem {
  id: string;
  block: VisualBlock;
}

export interface ExpandablePart {
  lock: boolean;
  children: VisualBlock[];
}

export interface BlockSchema {
  id: string;
  component: string;
  editorOnly: boolean;
  lock: boolean;
  align: Align;
  slot: Slot;
  css: string;
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
  sortKeys: Record<string, SortKeyValue>;
  groupKeys: Record<string, string>;
  tags: string;
  description: string;
  placeholder: string;
  fillIn: boolean;
  metaOpen: boolean;
  xrefTitle: string;
  xrefDetail: string;
  xrefTarget: string;
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

export interface VisualBlock {
  id: string;
  text: string;
  schema: BlockSchema;
  schemaMode: boolean;
}

export type SectionLocation = 'main' | 'sidebar';

export interface VisualSection {
  key: string;
  customId: string;
  contained: boolean;
  editorOnly: boolean;
  lock: boolean;
  idEditorOpen: boolean;
  isGhost: boolean;
  title: string;
  level: number;
  expanded: boolean;
  highlight: boolean;
  css: string;
  tags: string;
  description: string;
  location: SectionLocation;
  hideIfUnmodified?: boolean;
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
