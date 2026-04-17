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
  column: GridColumn;
  block: VisualBlock;
}

export interface BlockSchema {
  id: string;
  component: string;
  lock: boolean;
  align: Align;
  slot: Slot;
  customCss: string;
  codeLanguage: string;
  containerTitle: string;
  containerBlocks: VisualBlock[];
  componentListComponent: string;
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
  pluginUrl: string;
  expandableStubComponent: string;
  expandableContentComponent: string;
  expandableStub: string;
  expandableStubBlocks: VisualBlock[];
  expandableAlwaysShowStub: boolean;
  expandableExpanded: boolean;
  expandableContentBlocks: VisualBlock[];
  tableColumns: string;
  tableShowHeader: boolean;
  tableRows: TableRow[];
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
  lock: boolean;
  idEditorOpen: boolean;
  isGhost: boolean;
  title: string;
  level: number;
  expanded: boolean;
  highlight: boolean;
  customCss: string;
  location: SectionLocation;
  blocks: VisualBlock[];
  children: VisualSection[];
}
