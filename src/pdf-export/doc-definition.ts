import type { Align, CarouselImage, VisualBlock, VisualSection } from '../editor/types';
import type { VisualDocument } from '../types';
import { getImageAttachment } from '../attachments';
import { resolveBaseComponentFromMeta } from '../component-defs';
import { getPdfDocumentViewerThemeVariables } from '../pdf-document-theme';
import { cssFragmentTriggersNetwork } from '../css-sanitizer';
import { isExternalCssAllowed } from '../reference-config';
import { isBlockHiddenByTemplateMarker, isSectionHiddenByTemplateMarker } from '../template-hide';
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
import { hasRenderablePdfTextBlock, normalizePdfTextInline, renderPdfTextBlock, type PdfTextBlockStyle } from './text';

const PDF_DEFAULT_IMAGE_FIT: [number, number] = [360, 240];
const PDF_DEFAULT_GRID_COLUMN_GAP = 12;
const PDF_SIDEBAR_WIDTH = 180;
const PDF_SIDEBAR_COLUMN_GAP = 24;

interface PdfLayoutContext {
  availableWidth: number;
}

export function buildPdfExportDocDefinition(
  document: VisualDocument,
  options: Pick<HvyPdfExportOptions, 'contentView' | 'strategy'> = {}
): HvyPdfMakeDocumentDefinition {
  const resolved = resolvePdfExportStrategy(document, options.strategy, options.contentView);
  const pageContentWidth = getPdfPageContentWidth(resolved.defaults.pageSize, resolved.defaults.pageMargins);
  const sidebarSections = document.sections.filter((section) => section.location === 'sidebar');
  const mainContentWidth =
    resolved.defaults.includeSidebar === 'include' && sidebarSections.length
      ? Math.max(1, pageContentWidth - PDF_SIDEBAR_WIDTH - PDF_SIDEBAR_COLUMN_GAP)
      : pageContentWidth;
  const mainContent = renderSections(
    document,
    resolved,
    document.sections.filter((section) => section.location !== 'sidebar'),
    false,
    { availableWidth: mainContentWidth }
  );
  const sidebarContent =
    resolved.defaults.includeSidebar === 'exclude'
      ? []
      : renderSections(document, resolved, sidebarSections, true, {
          availableWidth: resolved.defaults.includeSidebar === 'include' ? PDF_SIDEBAR_WIDTH : pageContentWidth,
        });
  const content =
    resolved.defaults.includeSidebar === 'include' && sidebarContent.length
      ? [{ columns: [{ width: '*', stack: mainContent }, { width: PDF_SIDEBAR_WIDTH, stack: sidebarContent }], columnGap: PDF_SIDEBAR_COLUMN_GAP }]
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
  sidebar: boolean,
  layout: PdfLayoutContext
): HvyPdfMakeNode[] {
  const nodes: HvyPdfMakeNode[] = [];
  for (const section of sections) {
    const rendered = renderSection(document, resolved, section, sidebar, layout);
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
  sidebar: boolean,
  layout: PdfLayoutContext
): HvyPdfMakeNodeObject | null {
  const decision = resolved.getSectionDecision(section.key);
  if (section.editorOnly || isSectionHiddenByTemplateMarker(section) || decision.visibility === 'hide') {
    return null;
  }
  const childSidebar = sidebar || decision.role === 'sidebar' || section.location === 'sidebar';
  const stack: HvyPdfMakeNode[] = [];
  stack.push(...renderBlocks(document, resolved, section.blocks, layout));
  stack.push(...renderSections(document, resolved, section.children, childSidebar, layout));
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
  blocks: VisualBlock[],
  layout: PdfLayoutContext
): HvyPdfMakeNode[] {
  return blocks.flatMap((block) => {
    const rendered = renderBlock(document, resolved, block, layout);
    return rendered ? [rendered] : [];
  });
}

function renderBlock(
  document: VisualDocument,
  resolved: HvyPdfExportResolvedStrategy,
  block: VisualBlock,
  layout: PdfLayoutContext
): HvyPdfMakeNodeObject | null {
  const decision = resolved.getBlockDecision(block.id);
  if (block.schema.editorOnly || isBlockHiddenByTemplateMarker(block) || decision.visibility === 'hide') {
    return null;
  }
  const baseComponent = resolveBaseComponentFromMeta(block.schema.component, document.meta);
  let node: HvyPdfMakeNodeObject | null;
  switch (baseComponent) {
    case 'text':
      node = hasRenderablePdfTextBlock(block.text)
        ? renderPdfTextBlock(block.text, block.schema.placeholder, decision, getPdfTextAlignment(block), getPdfTextBlockStyle(document, block))
        : null;
      break;
    case 'code':
      node = { text: block.text || block.schema.placeholder || '', style: 'codeBlock' };
      break;
    case 'container':
      node = renderContainerBlock(document, resolved, block, layout);
      break;
    case 'component-list':
      node = { stack: renderBlocks(document, resolved, block.schema.componentListBlocks, layout), style: 'container' };
      break;
    case 'grid':
      node = renderGridBlock(document, resolved, block, layout);
      break;
    case 'expandable':
      node = renderExpandableBlock(document, resolved, block, decision, layout);
      break;
    case 'table':
      node = renderTableBlock(block);
      break;
    case 'image':
      node = renderImageBlock(document, resolved, block, layout);
      break;
    case 'carousel':
      node = renderCarouselBlock(document, resolved, block.schema.carouselImages, layout);
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
  block: VisualBlock,
  layout: PdfLayoutContext
): HvyPdfMakeNodeObject {
  const stack: HvyPdfMakeNode[] = [];
  if (block.schema.containerTitle.trim()) {
    stack.push({ text: block.schema.containerTitle, bold: true, margin: [0, 0, 0, 3], hvyKeepWithNext: true });
  }
  stack.push(...renderBlocks(document, resolved, block.schema.containerBlocks, layout));
  return { stack, style: 'container' };
}

function renderGridBlock(
  document: VisualDocument,
  resolved: HvyPdfExportResolvedStrategy,
  block: VisualBlock,
  layout: PdfLayoutContext
): HvyPdfMakeNodeObject {
  const columnCount = Math.max(1, Math.min(6, block.schema.gridColumns));
  const columnWidth = Math.max(1, (layout.availableWidth - PDF_DEFAULT_GRID_COLUMN_GAP * (columnCount - 1)) / columnCount);
  const rows: HvyPdfMakeNodeObject[] = [];
  for (let index = 0; index < block.schema.gridItems.length; index += columnCount) {
    const rowItems = block.schema.gridItems.slice(index, index + columnCount);
    const columns = rowItems.map((item) => ({
      width: '*',
      stack: renderBlocks(document, resolved, [item.block], { availableWidth: columnWidth }),
    }));
    rows.push({ columns, columnGap: PDF_DEFAULT_GRID_COLUMN_GAP, margin: [0, 0, 0, 6] });
  }
  if (rows.length === 0) {
    return placeholderNode('Empty grid.');
  }
  return rows.length === 1 ? rows[0] : { stack: rows };
}

function getPdfTextAlignment(block: VisualBlock): Align | undefined {
  return getTextAlignFromCss(block.schema.css) ?? block.schema.align;
}

function getPdfTextBlockStyle(document: VisualDocument, block: VisualBlock): PdfTextBlockStyle {
  const style: PdfTextBlockStyle = {};
  const fontWeight = getCssDeclarationValue(block.schema.css, 'font-weight')?.toLowerCase();
  const numericWeight = fontWeight ? Number.parseInt(fontWeight, 10) : NaN;
  if (fontWeight === 'bold' || numericWeight >= 600) {
    style.bold = true;
  } else if (fontWeight === 'normal' || numericWeight <= 500) {
    style.bold = false;
  }
  const textColor = getCssColorDeclarationValue(document, block.schema.css, 'color');
  if (textColor) {
    style.color = textColor;
  }
  const fillColor =
    getCssColorDeclarationValue(document, block.schema.css, 'background-color') ??
    getCssColorDeclarationValue(document, block.schema.css, 'background');
  if (fillColor) {
    style.fillColor = fillColor;
  }
  return style;
}

function getTextAlignFromCss(css: string): Align | undefined {
  const align = getCssDeclarationValue(css, 'text-align')?.toLowerCase();
  return align === 'left' || align === 'center' || align === 'right' ? align : undefined;
}

function getCssDeclarationValue(css: string, propertyName: string): string | null {
  const property = propertyName.toLowerCase();
  const declaration = css
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const separator = part.indexOf(':');
      if (separator === -1) {
        return null;
      }
      return {
        property: part.slice(0, separator).trim().toLowerCase(),
        value: part.slice(separator + 1).trim(),
      };
    })
    .filter((entry): entry is { property: string; value: string } => Boolean(entry))
    .find((entry) => entry.property === property);
  return declaration?.value ?? null;
}

function getCssColorDeclarationValue(document: VisualDocument, css: string, propertyName: string): string | null {
  const value = getCssDeclarationValue(css, propertyName);
  if (!value || (!isExternalCssAllowed() && cssFragmentTriggersNetwork(value))) {
    return null;
  }
  const resolvedValue = resolveCssColorValue(document, value);
  return resolvedValue && isPdfColorValue(resolvedValue) ? resolvedValue : null;
}

function resolveCssColorValue(document: VisualDocument, value: string): string {
  const trimmed = value.trim();
  const variable = /^var\(\s*(--[a-z0-9_-]+)\s*\)$/i.exec(trimmed);
  if (!variable) {
    return trimmed;
  }
  return getPdfDocumentViewerThemeVariables(document)[variable[1]] ?? '';
}

function isPdfColorValue(value: string): boolean {
  if (/^#[0-9a-f]{3,8}$/i.test(value)) return true;
  if (/^(?:rgb|rgba|hsl|hsla)\([^)]*\)$/i.test(value)) return true;
  if (/^[a-z]+$/i.test(value)) return true;
  return false;
}

function renderExpandableBlock(
  document: VisualDocument,
  resolved: HvyPdfExportResolvedStrategy,
  block: VisualBlock,
  decision: HvyPdfExportDecision,
  layout: PdfLayoutContext
): HvyPdfMakeNodeObject {
  const pane = resolveExpandablePane(resolved, block, decision);
  const stack: HvyPdfMakeNode[] = [];
  if ((pane === 'stubOnly' || pane === 'stubThenContent') && block.schema.expandableStub.trim()) {
    stack.push({ text: block.schema.expandableStub, style: 'paragraph' });
  }
  if (pane === 'stubOnly' || pane === 'stubThenContent') {
    stack.push(...renderBlocks(document, resolved, block.schema.expandableStubBlocks.children, layout));
  }
  if (pane === 'contentOnly' || pane === 'stubThenContent') {
    stack.push(...renderBlocks(document, resolved, block.schema.expandableContentBlocks.children, layout));
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
  images: CarouselImage[],
  layout: PdfLayoutContext
): HvyPdfMakeNodeObject {
  const stack = images.flatMap((entry) => {
    const node = renderImageNode(document, entry.imageFile, entry.imageAlt, resolved, layout);
    const caption = entry.caption.trim() ? [{ text: entry.caption, style: 'metadata', alignment: 'center' as const }] : [];
    return [node, ...caption];
  });
  return stack.length ? { stack } : placeholderNode('Empty carousel.');
}

function renderImageBlock(
  document: VisualDocument,
  resolved: HvyPdfExportResolvedStrategy,
  block: VisualBlock,
  layout: PdfLayoutContext
): HvyPdfMakeNodeObject {
  const image = renderImageNode(document, block.schema.imageFile, block.schema.imageAlt, resolved, layout);
  const caption = block.schema.caption.trim()
    ? [{ text: block.schema.caption, style: 'metadata', alignment: 'center' as const }]
    : [];
  return { stack: [image, ...caption] };
}

function renderImageNode(
  document: VisualDocument,
  filename: string,
  alt: string,
  resolved: HvyPdfExportResolvedStrategy,
  layout: PdfLayoutContext
): HvyPdfMakeNodeObject {
  const attachment = filename ? getImageAttachment(document, filename) : null;
  if (!attachment) {
    return resolved.defaults.unsupportedPluginPolicy === 'hide'
      ? { text: '' }
      : placeholderNode(alt.trim() ? `Missing image: ${alt}` : 'Missing image.');
  }
  const mediaType = typeof attachment.meta.mediaType === 'string' ? attachment.meta.mediaType : '';
  const fit = getImageFitForLayout(layout);
  if (mediaType === 'image/svg+xml') {
    return { svg: decodeText(attachment.bytes), fit, alignment: 'center', margin: [0, 0, 0, 8] };
  }
  if (mediaType === 'image/png' || mediaType === 'image/jpeg') {
    return {
      image: `data:${mediaType};base64,${toBase64(attachment.bytes)}`,
      fit,
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

function getImageFitForLayout(layout: PdfLayoutContext): [number, number] {
  const width = Number.isFinite(layout.availableWidth)
    ? Math.max(1, Math.min(PDF_DEFAULT_IMAGE_FIT[0], layout.availableWidth))
    : PDF_DEFAULT_IMAGE_FIT[0];
  return [width, PDF_DEFAULT_IMAGE_FIT[1]];
}

function getPdfPageContentWidth(
  pageSize: HvyPdfExportResolvedStrategy['defaults']['pageSize'],
  pageMargins: HvyPdfExportResolvedStrategy['defaults']['pageMargins']
): number {
  const size = getPdfPageSize(pageSize);
  const margins = normalizePdfPageMargins(pageMargins);
  return Math.max(1, size.width - margins[0] - margins[2]);
}

function getPdfPageSize(pageSize: HvyPdfExportResolvedStrategy['defaults']['pageSize']): { width: number; height: number } {
  if (typeof pageSize !== 'string') {
    return pageSize;
  }
  const normalized = pageSize.trim().toUpperCase();
  if (normalized === 'A4') return { width: 595.28, height: 841.89 };
  if (normalized === 'LEGAL') return { width: 612, height: 1008 };
  if (normalized === 'TABLOID' || normalized === 'LEDGER') return { width: 792, height: 1224 };
  return { width: 612, height: 792 };
}

function normalizePdfPageMargins(
  pageMargins: HvyPdfExportResolvedStrategy['defaults']['pageMargins']
): [number, number, number, number] {
  if (typeof pageMargins === 'number') {
    return [pageMargins, pageMargins, pageMargins, pageMargins];
  }
  if (pageMargins.length === 2) {
    return [pageMargins[0], pageMargins[1], pageMargins[0], pageMargins[1]];
  }
  return pageMargins;
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
