import type { ReaderViewFilter, VisualDocument } from '../types';

export type HvyPdfExportExpansionPolicy = 'view-aware' | 'all-expanded' | 'authored';
export type HvyPdfExportSidebarPolicy = 'include' | 'exclude' | 'inline-after-main';
export type HvyPdfUnsupportedPluginPolicy = 'placeholder' | 'hide';
export type HvyPdfExportVisibility = 'include' | 'hide' | 'dim' | 'highlight';
export type HvyPdfExportPane = 'expand' | 'collapse' | 'stubOnly' | 'contentOnly' | 'stubThenContent';
export type HvyPdfExportRole = 'heading' | 'body' | 'metadata' | 'sidebar';

export interface HvyPdfExportStrategyTarget {
  id?: string;
  path?: string;
  component?: string;
  baseComponent?: string;
  tag?: string;
  sectionTag?: string;
  componentTag?: string;
  predicate?: HvyPdfExportStrategyPredicate;
}

export type HvyPdfExportStrategyPredicate = (target: HvyPdfExportStrategyPredicateTarget) => boolean;

export type HvyPdfExportStrategyPredicateTarget =
  | {
      kind: 'section';
      key: string;
      id: string;
      tags: string;
      title: string;
      location: 'main' | 'sidebar';
    }
  | {
      kind: 'component';
      blockId: string;
      id: string;
      component: string;
      baseComponent: string;
      tags: string;
    };

export interface HvyPdfExportStrategyRule extends HvyPdfExportStrategyTarget {
  include?: boolean;
  hide?: boolean;
  dim?: boolean;
  highlight?: boolean;
  expand?: boolean;
  collapse?: boolean;
  stubOnly?: boolean;
  contentOnly?: boolean;
  stubThenContent?: boolean;
  keepTogether?: boolean;
  keepWithNext?: boolean;
  allowSplit?: boolean;
  asHeading?: boolean;
  asBody?: boolean;
  asMetadata?: boolean;
  asSidebar?: boolean;
  pageBreakBefore?: boolean;
  pageBreakAfter?: boolean;
  pdfStyle?: Record<string, unknown>;
  adapter?: string;
}

export interface HvyPdfExportStrategyDefaults {
  pageSize?: string | { width: number; height: number };
  pageMargins?: number | [number, number] | [number, number, number, number];
  font?: string;
  expansionPolicy?: HvyPdfExportExpansionPolicy;
  includeSidebar?: HvyPdfExportSidebarPolicy | boolean;
  unsupportedPluginPolicy?: HvyPdfUnsupportedPluginPolicy;
}

export interface HvyPdfExportStrategy {
  rules?: HvyPdfExportStrategyRule[];
  defaults?: HvyPdfExportStrategyDefaults;
  prepScript?: string | { componentId: string };
}

export interface HvyPdfExportOptions {
  filename?: string;
  contentView?: ReaderViewFilter;
  strategy?: HvyPdfExportStrategy;
  runPrepScript?: boolean;
}

export interface HvyPdfExportResult {
  sourceDocument: VisualDocument;
  exportDocument: VisualDocument;
  strategy: HvyPdfExportStrategy;
  docDefinition: HvyPdfMakeDocumentDefinition;
}

export interface HvyPdfMakeDocumentDefinition {
  pageSize?: string | { width: number; height: number };
  pageMargins?: number | [number, number] | [number, number, number, number];
  content: HvyPdfMakeNode[];
  styles?: Record<string, Record<string, unknown>>;
  defaultStyle?: Record<string, unknown>;
  images?: Record<string, string>;
  info?: Record<string, string>;
  pageBreakBefore?: (currentNode: HvyPdfMakeNode, nodeContainer: HvyPdfMakeNodeContainer) => boolean;
}

export interface HvyPdfMakeNodeContainer {
  getFollowingNodesOnPage(): HvyPdfMakeNode[];
  getNodesOnNextPage(): HvyPdfMakeNode[];
  getPreviousNodesOnPage(): HvyPdfMakeNode[];
}

export type HvyPdfMakeNode = string | HvyPdfMakeNodeObject;

export interface HvyPdfMakeNodeObject {
  id?: string;
  text?: string | Array<string | HvyPdfMakeNodeObject>;
  stack?: HvyPdfMakeNode[];
  columns?: Array<HvyPdfMakeNode | { width?: string | number; stack?: HvyPdfMakeNode[]; text?: string }>;
  ul?: HvyPdfMakeNode[];
  ol?: HvyPdfMakeNode[];
  table?: {
    headerRows?: number;
    widths?: Array<string | number>;
    dontBreakRows?: boolean;
    keepWithHeaderRows?: number;
    body: HvyPdfMakeNode[][];
  };
  image?: string;
  svg?: string;
  canvas?: unknown[];
  layout?: string;
  style?: string | string[];
  margin?: number | [number, number] | [number, number, number, number];
  fontSize?: number;
  bold?: boolean;
  italics?: boolean;
  color?: string;
  fillColor?: string;
  alignment?: 'left' | 'center' | 'right' | 'justify';
  width?: number | string;
  height?: number;
  fit?: [number, number];
  pageBreak?: 'before' | 'after' | 'beforeOdd' | 'beforeEven';
  headlineLevel?: number;
  hvyKeepWithNext?: boolean;
  hvyKeepTogether?: boolean;
  hvyRole?: HvyPdfExportRole;
  [key: string]: unknown;
}

export interface HvyPdfExportDecision {
  visibility: HvyPdfExportVisibility;
  pane?: HvyPdfExportPane;
  keepTogether: boolean;
  keepWithNext: boolean;
  allowSplit: boolean;
  role?: HvyPdfExportRole;
  pageBreakBefore: boolean;
  pageBreakAfter: boolean;
  pdfStyle: Record<string, unknown>;
  adapter?: string;
}

export interface HvyPdfExportResolvedStrategy {
  defaults: Required<Pick<HvyPdfExportStrategyDefaults, 'expansionPolicy' | 'unsupportedPluginPolicy'>> & {
    pageSize: string | { width: number; height: number };
    pageMargins: number | [number, number] | [number, number, number, number];
    font: string;
    includeSidebar: HvyPdfExportSidebarPolicy;
  };
  getSectionDecision(sectionKey: string): HvyPdfExportDecision;
  getBlockDecision(blockId: string): HvyPdfExportDecision;
}

export interface HvyPdfExportRuleRecorder {
  hide(idOrTag: string): void;
  include(idOrTag: string): void;
  expand(idOrTag: string): void;
  keep_together(idOrTag: string): void;
  style(idOrTag: string, style: Record<string, unknown>): void;
  strategy(rule: HvyPdfExportStrategyRule | HvyPdfExportStrategyRule[]): void;
  getStrategy(): HvyPdfExportStrategy;
}
