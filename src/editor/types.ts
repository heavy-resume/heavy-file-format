import type { JsonObject } from '../hvy/types';

export type Align = 'left' | 'center' | 'right';
export type Slot = 'left' | 'center' | 'right';

export interface TableRow {
  cells: string[];
}

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
  lock: boolean;
  align: Align;
  slot: Slot;
  customCss: string;
  codeLanguage: string;
  containerBlocks: VisualBlock[];
  componentListComponent: string;
  componentListItemLabel: string;
  componentListBlocks: VisualBlock[];
  gridColumns: number;
  gridItems: GridItem[];
  tags: string;
  description: string;
  placeholder: string;
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
  expandableStubBlocks: ExpandablePart;
  expandableAlwaysShowStub: boolean;
  expandableExpanded: boolean;
  expandableContentCss: string;
  expandableContentBlocks: ExpandablePart;
  tableColumns: string;
  tableShowHeader: boolean;
  tableRows: TableRow[];
  imageFile: string;
  imageAlt: string;
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
  lock: boolean;
  idEditorOpen: boolean;
  isGhost: boolean;
  title: string;
  level: number;
  expanded: boolean;
  highlight: boolean;
  customCss: string;
  tags: string;
  description: string;
  location: SectionLocation;
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
