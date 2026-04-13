export type Align = 'left' | 'center' | 'right';
export type Slot = 'left' | 'center' | 'right';
export type GridColumn = 'left' | 'right' | 'full';

export interface TableRow {
  cells: string[];
  expanded: boolean;
  clickable: boolean;
  detailsTitle: string;
  detailsContent: string;
  detailsComponent: string;
  detailsBlocks: VisualBlock[];
}

export interface GridItem {
  id: string;
  component: string;
  content: string;
  column: GridColumn;
}

export interface BlockSchema {
  component: string;
  align: Align;
  slot: Slot;
  codeLanguage: string;
  containerTitle: string;
  containerBlocks: VisualBlock[];
  gridColumns: number;
  gridItems: GridItem[];
  tags: string;
  description: string;
  metaOpen: boolean;
  pluginUrl: string;
  expandableStubComponent: string;
  expandableContentComponent: string;
  expandableStub: string;
  expandableAlwaysShowStub: boolean;
  expandableExpanded: boolean;
  tableColumns: string;
  tableRows: TableRow[];
}

export interface VisualBlock {
  id: string;
  text: string;
  schema: BlockSchema;
  schemaMode: boolean;
}

export interface VisualSection {
  key: string;
  customId: string;
  idEditorOpen: boolean;
  isGhost: boolean;
  title: string;
  level: number;
  expanded: boolean;
  highlight: boolean;
  customCss: string;
  blocks: VisualBlock[];
  children: VisualSection[];
}
