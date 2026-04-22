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
  expandableStubCss: string;
  expandableStubBlocks: ExpandablePart;
  expandableAlwaysShowStub: boolean;
  expandableExpanded: boolean;
  expandableContentCss: string;
  expandableContentBlocks: ExpandablePart;
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
}
