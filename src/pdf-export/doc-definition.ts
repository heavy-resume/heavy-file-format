import type { CarouselImage, VisualBlock, VisualSection } from '../editor/types';
import type { VisualDocument } from '../types';
import { getImageAttachment } from '../attachments';
import { resolveBaseComponentFromMeta } from '../component-defs';
import { isSectionHiddenByTemplateMarker } from '../template-hide';
import type {
  HvyPdfExportDecision,
  HvyPdfExportOptions,
  HvyPdfExportPane,
  HvyPdfExportResolvedStrategy,
  HvyPdfMakeDocumentDefinition,
  HvyPdfMakeNode,
  HvyPdfMakeNodeObject,
} from './types';
import { resolvePdfExportStrategy } from './strategy';
import { normalizePdfTextInline, renderPdfTextBlock } from './text';

export function buildPdfExportDocDefinition(
  document: VisualDocument,
  options: Pick<HvyPdfExportOptions, 'contentView' | 'strategy'> = {}
): HvyPdfMakeDocumentDefinition {
  const resolved = resolvePdfExportStrategy(document, options.strategy, options.contentView);
  const mainContent = renderSections(document, resolved, document.sections.filter((section) => section.location !== 'sidebar'));
  const sidebarSections = document.sections.filter((section) => section.location === 'sidebar');
  const sidebarContent =
    resolved.defaults.includeSidebar === 'exclude' ? [] : renderSections(document, resolved, sidebarSections, true);
  const content =
    resolved.defaults.includeSidebar === 'include' && sidebarContent.length
      ? [{ columns: [{ width: '*', stack: mainContent }, { width: 180, stack: sidebarContent }], columnGap: 24 }]
      : mainContent.concat(sidebarContent);

  return {
    pageSize: resolved.defaults.pageSize,
    pageMargins: resolved.defaults.pageMargins,
    content: content.length ? content : [placeholderNode('No exportable content.')],
    defaultStyle: {
      font: resolved.defaults.font,
      fontSize: 10,
      lineHeight: 1.25,
    },
    styles: {
      documentTitle: { fontSize: 18, bold: true, margin: [0, 0, 0, 12] },
      sectionTitle: { fontSize: 14, bold: true, margin: [0, 10, 0, 4] },
      sectionTitle2: { fontSize: 12, bold: true, margin: [0, 8, 0, 3] },
      sectionTitle3: { fontSize: 11, bold: true, margin: [0, 6, 0, 3] },
      paragraph: { margin: [0, 0, 0, 5] },
      detailHeading: { bold: true, margin: [0, 4, 0, 1] },
      detailBody: { margin: [6, 0, 0, 4] },
      list: { margin: [10, 0, 0, 5] },
      codeBlock: { font: 'Roboto', fontSize: 8, margin: [0, 0, 0, 6], fillColor: '#f3f4f6' },
      metadata: { fontSize: 8, color: '#4b5563' },
      dimmed: { color: '#6b7280' },
      highlighted: { fillColor: '#fff7cc' },
      container: { margin: [0, 2, 0, 6] },
      tableHeader: { bold: true, fillColor: '#eef2f7' },
      placeholder: { italics: true, color: '#6b7280', margin: [0, 0, 0, 5] },
      xrefTitle: { bold: true, margin: [0, 0, 0, 2] },
      xrefDetail: { color: '#4b5563', margin: [0, 0, 0, 5] },
    },
    info: typeof document.meta.title === 'string' ? { title: document.meta.title } : undefined,
    pageBreakBefore(currentNode, nodeContainer) {
      if (typeof currentNode === 'string') {
        return false;
      }
      if (currentNode.pageBreak === 'before') {
        return true;
      }
      return Boolean(
        (currentNode.headlineLevel || currentNode.hvyKeepWithNext) &&
          nodeContainer.getFollowingNodesOnPage().length === 0 &&
          nodeContainer.getNodesOnNextPage().length > 0
      );
    },
  };
}

function renderSections(
  document: VisualDocument,
  resolved: HvyPdfExportResolvedStrategy,
  sections: VisualSection[],
  sidebar = false
): HvyPdfMakeNode[] {
  const nodes: HvyPdfMakeNode[] = [];
  for (const section of sections) {
    const rendered = renderSection(document, resolved, section, sidebar);
    if (rendered) {
      nodes.push(rendered);
    }
  }
  return nodes;
}

function renderSection(
  document: VisualDocument,
  resolved: HvyPdfExportResolvedStrategy,
  section: VisualSection,
  sidebar: boolean
): HvyPdfMakeNodeObject | null {
  const decision = resolved.getSectionDecision(section.key);
  if (section.editorOnly || isSectionHiddenByTemplateMarker(section) || decision.visibility === 'hide') {
    return null;
  }
  const childSidebar = sidebar || decision.role === 'sidebar' || section.location === 'sidebar';
  const stack: HvyPdfMakeNode[] = [];
  if (section.title.trim() && decision.role !== 'body') {
    stack.push(applyDecisionToNode(decision, {
      id: section.customId || section.key,
      text: section.title,
      style: section.level <= 1 ? 'sectionTitle' : section.level === 2 ? 'sectionTitle2' : 'sectionTitle3',
      headlineLevel: Math.max(1, section.level || 1),
      hvyKeepWithNext: true,
      hvyRole: decision.role ?? (childSidebar ? 'sidebar' : 'heading'),
    }));
  }
  stack.push(...renderBlocks(document, resolved, section.blocks));
  stack.push(...renderSections(document, resolved, section.children, childSidebar));
  if (stack.length === 0) {
    return null;
  }
  return applyDecisionToNode(decision, {
    id: section.customId || section.key,
    stack,
    hvyRole: decision.role ?? (childSidebar ? 'sidebar' : 'body'),
    margin: childSidebar ? [0, 0, 0, 8] : [0, 0, 0, 6],
  });
}

function renderBlocks(
  document: VisualDocument,
  resolved: HvyPdfExportResolvedStrategy,
  blocks: VisualBlock[]
): HvyPdfMakeNode[] {
  return blocks.flatMap((block) => {
    const rendered = renderBlock(document, resolved, block);
    return rendered ? [rendered] : [];
  });
}

function renderBlock(
  document: VisualDocument,
  resolved: HvyPdfExportResolvedStrategy,
  block: VisualBlock
): HvyPdfMakeNodeObject | null {
  const decision = resolved.getBlockDecision(block.id);
  if (block.schema.editorOnly || decision.visibility === 'hide') {
    return null;
  }
  const baseComponent = resolveBaseComponentFromMeta(block.schema.component, document.meta);
  let node: HvyPdfMakeNodeObject | null;
  switch (baseComponent) {
    case 'text':
      node = renderPdfTextBlock(block.text, block.schema.placeholder, decision);
      break;
    case 'code':
      node = { text: block.text || block.schema.placeholder || '', style: 'codeBlock' };
      break;
    case 'container':
      node = renderContainerBlock(document, resolved, block);
      break;
    case 'component-list':
      node = { stack: renderBlocks(document, resolved, block.schema.componentListBlocks), style: 'container' };
      break;
    case 'grid':
      node = renderGridBlock(document, resolved, block);
      break;
    case 'expandable':
      node = renderExpandableBlock(document, resolved, block, decision);
      break;
    case 'table':
      node = renderTableBlock(block);
      break;
    case 'image':
      node = renderImageNode(document, block.schema.imageFile, block.schema.imageAlt, resolved);
      break;
    case 'carousel':
      node = renderCarouselBlock(document, resolved, block.schema.carouselImages);
      break;
    case 'xref-card':
      node = renderXrefCardBlock(block);
      break;
    default:
      node = renderUnsupportedBlock(block, resolved);
      break;
  }
  return node ? applyDecisionToNode(decision, { id: block.schema.id || block.id, ...node }) : null;
}

function renderContainerBlock(
  document: VisualDocument,
  resolved: HvyPdfExportResolvedStrategy,
  block: VisualBlock
): HvyPdfMakeNodeObject {
  const stack: HvyPdfMakeNode[] = [];
  if (block.schema.containerTitle.trim()) {
    stack.push({ text: block.schema.containerTitle, bold: true, margin: [0, 0, 0, 3], hvyKeepWithNext: true });
  }
  stack.push(...renderBlocks(document, resolved, block.schema.containerBlocks));
  return { stack, style: 'container' };
}

function renderGridBlock(
  document: VisualDocument,
  resolved: HvyPdfExportResolvedStrategy,
  block: VisualBlock
): HvyPdfMakeNodeObject {
  const columns = block.schema.gridItems.map((item) => ({
    width: '*',
    stack: renderBlocks(document, resolved, [item.block]),
  }));
  return columns.length ? { columns, columnGap: 12 } : placeholderNode('Empty grid.');
}

function renderExpandableBlock(
  document: VisualDocument,
  resolved: HvyPdfExportResolvedStrategy,
  block: VisualBlock,
  decision: HvyPdfExportDecision
): HvyPdfMakeNodeObject {
  const pane = resolveExpandablePane(resolved, block, decision);
  const stack: HvyPdfMakeNode[] = [];
  if ((pane === 'stubOnly' || pane === 'stubThenContent') && block.schema.expandableStub.trim()) {
    stack.push({ text: block.schema.expandableStub, style: 'paragraph' });
  }
  if (pane === 'stubOnly' || pane === 'stubThenContent') {
    stack.push(...renderBlocks(document, resolved, block.schema.expandableStubBlocks.children));
  }
  if (pane === 'contentOnly' || pane === 'stubThenContent') {
    stack.push(...renderBlocks(document, resolved, block.schema.expandableContentBlocks.children));
  }
  return stack.length ? { stack } : placeholderNode('Empty expandable component.');
}

function resolveExpandablePane(
  resolved: HvyPdfExportResolvedStrategy,
  block: VisualBlock,
  decision: HvyPdfExportDecision
): HvyPdfExportPane {
  if (decision.pane === 'stubOnly' || decision.pane === 'contentOnly' || decision.pane === 'stubThenContent') {
    return decision.pane;
  }
  if (decision.pane === 'collapse') {
    return 'stubOnly';
  }
  if (decision.pane === 'expand' || resolved.defaults.expansionPolicy === 'all-expanded') {
    return block.schema.expandableAlwaysShowStub ? 'stubThenContent' : 'contentOnly';
  }
  if (resolved.defaults.expansionPolicy === 'authored' && !block.schema.expandableExpanded) {
    return 'stubOnly';
  }
  return block.schema.expandableExpanded || resolved.defaults.expansionPolicy === 'view-aware'
    ? block.schema.expandableAlwaysShowStub
      ? 'stubThenContent'
      : 'contentOnly'
    : 'stubOnly';
}

function renderTableBlock(block: VisualBlock): HvyPdfMakeNodeObject {
  const header = block.schema.tableShowHeader
    ? [block.schema.tableColumns.map((column) => ({ text: normalizePdfTextInline(column), style: 'tableHeader' }))]
    : [];
  const rows = block.schema.tableRows.map((row) => row.cells.map((cell) => ({ text: normalizePdfTextInline(cell), style: 'paragraph' })));
  return {
    table: {
      headerRows: header.length,
      widths: block.schema.tableColumns.map(() => '*'),
      dontBreakRows: true,
      keepWithHeaderRows: header.length ? 1 : 0,
      body: header.concat(rows),
    },
    layout: 'lightHorizontalLines',
    margin: [0, 0, 0, 8],
  };
}

function renderCarouselBlock(
  document: VisualDocument,
  resolved: HvyPdfExportResolvedStrategy,
  images: CarouselImage[]
): HvyPdfMakeNodeObject {
  const stack = images.flatMap((entry) => {
    const node = renderImageNode(document, entry.imageFile, entry.imageAlt, resolved);
    const caption = entry.caption.trim() ? [{ text: entry.caption, style: 'metadata', alignment: 'center' as const }] : [];
    return [node, ...caption];
  });
  return stack.length ? { stack } : placeholderNode('Empty carousel.');
}

function renderImageNode(
  document: VisualDocument,
  filename: string,
  alt: string,
  resolved: HvyPdfExportResolvedStrategy
): HvyPdfMakeNodeObject {
  const attachment = filename ? getImageAttachment(document, filename) : null;
  if (!attachment) {
    return resolved.defaults.unsupportedPluginPolicy === 'hide'
      ? { text: '' }
      : placeholderNode(alt.trim() ? `Missing image: ${alt}` : 'Missing image.');
  }
  const mediaType = typeof attachment.meta.mediaType === 'string' ? attachment.meta.mediaType : '';
  if (mediaType === 'image/svg+xml') {
    return { svg: decodeText(attachment.bytes), fit: [360, 240], alignment: 'center', margin: [0, 0, 0, 8] };
  }
  if (mediaType === 'image/png' || mediaType === 'image/jpeg') {
    return {
      image: `data:${mediaType};base64,${toBase64(attachment.bytes)}`,
      fit: [360, 240],
      alignment: 'center',
      margin: [0, 0, 0, 8],
    };
  }
  return resolved.defaults.unsupportedPluginPolicy === 'hide'
    ? { text: '' }
    : placeholderNode(`Unsupported image format: ${mediaType || filename}`);
}

function renderXrefCardBlock(block: VisualBlock): HvyPdfMakeNodeObject {
  const stack: HvyPdfMakeNode[] = [];
  if (block.schema.xrefTitle.trim()) {
    stack.push({ text: normalizePdfTextInline(block.schema.xrefTitle), style: 'xrefTitle' });
  }
  if (block.schema.xrefDetail.trim()) {
    stack.push({ text: normalizePdfTextInline(block.schema.xrefDetail), style: 'xrefDetail' });
  }
  return stack.length ? { stack } : placeholderNode('Reference card.');
}

function renderUnsupportedBlock(block: VisualBlock, resolved: HvyPdfExportResolvedStrategy): HvyPdfMakeNodeObject | null {
  if (resolved.defaults.unsupportedPluginPolicy === 'hide') {
    return null;
  }
  const label = block.schema.kind === 'plugin' ? block.schema.plugin || block.schema.component : block.schema.component;
  if (resolved.defaults.unsupportedPluginPolicy === 'error') {
    throw new Error(`PDF export cannot render component "${label}". Hide it with an export strategy or provide an export adapter.`);
  }
  return placeholderNode(`Unsupported PDF export component: ${label}`);
}

function applyDecisionToNode(decision: HvyPdfExportDecision, node: HvyPdfMakeNodeObject): HvyPdfMakeNodeObject {
  const style = normalizeStyleList(node.style);
  if (decision.visibility === 'dim') style.push('dimmed');
  if (decision.visibility === 'highlight') style.push('highlighted');
  if (decision.role === 'metadata') style.push('metadata');
  return {
    ...node,
    ...decision.pdfStyle,
    style: style.length ? style : undefined,
    pageBreak: decision.pageBreakBefore ? 'before' : decision.pageBreakAfter ? 'after' : node.pageBreak,
    hvyKeepTogether: decision.keepTogether || (!decision.allowSplit && node.hvyKeepTogether !== false) || node.hvyKeepTogether,
    hvyKeepWithNext: decision.keepWithNext || node.hvyKeepWithNext,
    hvyRole: decision.role ?? node.hvyRole,
  };
}

function normalizeStyleList(style: HvyPdfMakeNodeObject['style']): string[] {
  if (!style) return [];
  return Array.isArray(style) ? style.slice() : [style];
}

function placeholderNode(text: string): HvyPdfMakeNodeObject {
  return { text, style: 'placeholder' };
}

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
