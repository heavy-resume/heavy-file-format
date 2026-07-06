import type { Align, CarouselImage, VisualBlock, VisualSection } from '../editor/types';
import type { VisualDocument } from '../types';
import { getImageAttachment } from '../attachments';
import { resolveBaseComponentFromMeta } from '../component-defs';
import { getPdfDocumentViewerThemeVariables } from '../pdf-document-theme';
import { cssFragmentTriggersNetwork } from '../css-sanitizer';
import { getDocumentSectionDefaultCss, mergeDocumentCss } from '../document-section-defaults';
import { isExternalCssAllowed } from '../reference-config';
import { normalizePdfPageMargins, normalizePdfPageSize } from '../pdf-page-settings';
import { isBlockHiddenByTemplateMarker, isSectionHiddenByTemplateMarker } from '../template-hide';
import { getHeadingStylesFromMeta } from '../heading-styles';
import { getTextCaptionMarkdown, normalizeTextCaption } from '../caption';
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
import {
  hasRenderablePdfTextBlock,
  normalizePdfTextInline,
  renderPdfTextBlock,
  type PdfHeadingTextStyles,
  type PdfTextBlockStyle,
} from './text';

const PDF_DEFAULT_IMAGE_FIT: [number, number] = [360, 240];
const PDF_DEFAULT_GRID_COLUMN_GAP = 12;
const PDF_SIDEBAR_WIDTH = 180;
const PDF_SIDEBAR_COLUMN_GAP = 24;
const PDF_CSS_REM_IN_POINTS = 12;
const PDF_IMAGE_CSS_REM_IN_POINTS = 8;
interface PdfLayoutContext {
  availableWidth: number;
}

interface PdfBoxStyle {
  padding?: [number, number, number, number];
  fillColor?: string;
  color?: string;
  borderColor?: string;
  borderWidth?: number;
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
  const background = resolved.defaults.debugPageBounds ? renderPdfDebugPageBounds(resolved.defaults.pageMargins) : undefined;

  return {
    pageSize: resolved.defaults.pageSize,
    pageMargins: resolved.defaults.pageMargins,
    background,
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
  const css = mergeDocumentCss(getDocumentSectionDefaultCss(document.meta), section.css);
  const boxStyle = getPdfCssBoxStyle(document, css);
  const childLayout = boxStyle?.padding
    ? { availableWidth: Math.max(1, layout.availableWidth - boxStyle.padding[0] - boxStyle.padding[2]) }
    : layout;
  const stack: HvyPdfMakeNode[] = [];
  stack.push(...renderBlocks(document, resolved, section.blocks, childLayout));
  stack.push(...renderSections(document, resolved, section.children, childSidebar, childLayout));
  if (stack.length === 0) {
    return null;
  }
  return applyPdfBoxStyle(document, css, applyDecisionToNode(decision, {
    id: section.customId || section.key,
    stack,
    hvyRole: decision.role ?? (childSidebar ? 'sidebar' : 'body'),
    margin: getPdfCssMargin(css, childSidebar ? [0, 0, 0, 8] : [0, 0, 0, 6]),
  }), layout);
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
        ? renderPdfTextBlock(
            block.text,
            block.schema.placeholder,
            decision,
            getPdfTextAlignment(block),
            getPdfTextBlockStyle(document, block),
            getPdfHeadingTextStyles(document)
          )
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
  if (!node) {
    return null;
  }
  const rendered = applyPdfBoxStyle(
    document,
    block.schema.css,
    applyDecisionToNode(decision, applyBlockCssMargin({ id: block.schema.id || block.id, ...node }, block.schema.css)),
    layout,
    { requireBoxSignal: baseComponent === 'text' }
  );
  return applyPdfDebugBlockBounds(rendered, resolved, layout);
}

function applyBlockCssMargin(node: HvyPdfMakeNodeObject, css: string): HvyPdfMakeNodeObject {
  const margin = getPdfCssMargin(css, normalizePdfNodeMargin(node.margin));
  return margin ? { ...node, margin } : node;
}

function applyPdfBoxStyle(
  document: VisualDocument,
  css: string,
  node: HvyPdfMakeNodeObject,
  layout: PdfLayoutContext,
  options: { requireBoxSignal?: boolean } = {}
): HvyPdfMakeNodeObject {
  const boxStyle = getPdfCssBoxStyle(document, css, options);
  if (!boxStyle) {
    return node;
  }
  const {
    id,
    margin,
    pageBreak,
    headlineLevel,
    hvyKeepWithNext,
    hvyKeepTogether,
    hvyRole,
    ...inner
  } = node;
  const cell: HvyPdfMakeNodeObject = {
    stack: [inner],
    ...(boxStyle.fillColor ? { fillColor: boxStyle.fillColor } : {}),
    ...(boxStyle.color ? { color: boxStyle.color } : {}),
  };
  const marginBox = normalizePdfNodeMargin(margin);
  const tableWidth = Math.max(1, layout.availableWidth - (marginBox?.[0] ?? 0) - (marginBox?.[2] ?? 0));
  return {
    ...(typeof id === 'string' ? { id } : {}),
    ...(margin !== undefined ? { margin } : {}),
    ...(pageBreak ? { pageBreak } : {}),
    ...(typeof headlineLevel === 'number' ? { headlineLevel } : {}),
    ...(hvyKeepWithNext ? { hvyKeepWithNext } : {}),
    ...(hvyKeepTogether ? { hvyKeepTogether } : {}),
    ...(typeof hvyRole === 'string' ? { hvyRole } : {}),
    table: {
      widths: [tableWidth],
      body: [[cell]],
    },
    layout: createPdfBoxTableLayout(boxStyle),
  };
}

function createPdfBoxTableLayout(boxStyle: PdfBoxStyle): Record<string, unknown> {
  const padding = boxStyle.padding ?? [0, 0, 0, 0];
  const borderWidth = boxStyle.borderWidth ?? 0;
  const borderColor = boxStyle.borderColor ?? '#000000';
  return {
    hLineWidth: () => borderWidth,
    vLineWidth: () => borderWidth,
    hLineColor: () => borderColor,
    vLineColor: () => borderColor,
    paddingLeft: () => padding[0],
    paddingTop: () => padding[1],
    paddingRight: () => padding[2],
    paddingBottom: () => padding[3],
  };
}

function renderContainerBlock(
  document: VisualDocument,
  resolved: HvyPdfExportResolvedStrategy,
  block: VisualBlock,
  layout: PdfLayoutContext
): HvyPdfMakeNodeObject {
  const boxStyle = getPdfCssBoxStyle(document, block.schema.css);
  const childLayout = boxStyle?.padding
    ? { availableWidth: Math.max(1, layout.availableWidth - boxStyle.padding[0] - boxStyle.padding[2]) }
    : layout;
  const stack: HvyPdfMakeNode[] = [];
  if (block.schema.containerTitle.trim()) {
    stack.push({ text: block.schema.containerTitle, bold: true, margin: [0, 0, 0, 3], hvyKeepWithNext: true });
  }
  stack.push(...renderBlocks(document, resolved, block.schema.containerBlocks, childLayout));
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
  return getPdfCssTextStyle(document, block.schema.css);
}

function getPdfHeadingTextStyles(document: VisualDocument): PdfHeadingTextStyles {
  const raw = document.meta.heading_styles;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const styles = getHeadingStylesFromMeta(document.meta);
  return {
    1: getPdfCssTextStyle(document, styles.h1.css),
    2: getPdfCssTextStyle(document, styles.h2.css),
    3: getPdfCssTextStyle(document, styles.h3.css),
    4: getPdfCssTextStyle(document, styles.h4.css),
  };
}

function getPdfCssTextStyle(document: VisualDocument, css: string): PdfTextBlockStyle {
  const style: PdfTextBlockStyle = {};
  const fontWeight = getCssDeclarationValue(css, 'font-weight')?.toLowerCase();
  const numericWeight = fontWeight ? Number.parseInt(fontWeight, 10) : NaN;
  if (fontWeight === 'bold' || numericWeight >= 600) {
    style.bold = true;
  } else if (fontWeight === 'normal' || numericWeight <= 500) {
    style.bold = false;
  }
  const fontSize = getCssPdfFontSize(css);
  if (fontSize !== null) {
    style.fontSize = fontSize;
  }
  const lineHeight = getCssPdfLineHeight(css);
  if (lineHeight !== null) {
    style.lineHeight = lineHeight;
  }
  const textColor = getCssColorDeclarationValue(document, css, 'color');
  if (textColor) {
    style.color = textColor;
  }
  const fillColor =
    getCssColorDeclarationValue(document, css, 'background-color') ??
    getCssColorDeclarationValue(document, css, 'background');
  if (fillColor) {
    style.fillColor = fillColor;
  }
  return style;
}

function getPdfCssBoxStyle(
  document: VisualDocument,
  css: string,
  options: { requireBoxSignal?: boolean } = {}
): PdfBoxStyle | null {
  const padding = getPdfCssPadding(css);
  const fillColor =
    getCssColorDeclarationValue(document, css, 'background-color') ??
    getCssColorDeclarationValue(document, css, 'background');
  const textColor = getCssColorDeclarationValue(document, css, 'color');
  const border = getPdfCssBorderStyle(document, css);
  if (options.requireBoxSignal && !padding && !border) {
    return null;
  }
  if (!padding && !fillColor && !textColor && !border) {
    return null;
  }
  return {
    ...(padding ? { padding } : {}),
    ...(fillColor ? { fillColor } : {}),
    ...(textColor ? { color: textColor } : {}),
    ...(border?.borderColor ? { borderColor: border.borderColor } : {}),
    ...(typeof border?.borderWidth === 'number' ? { borderWidth: border.borderWidth } : {}),
  };
}

function getPdfCssPadding(css: string): [number, number, number, number] | undefined {
  const padding = [0, 0, 0, 0] as [number, number, number, number];
  let changed = false;
  const shorthand = getCssDeclarationValue(css, 'padding');
  if (shorthand) {
    const values = parseCssBoxLengthValues(shorthand, { allowNegative: false });
    if (values) {
      padding[0] = values[0];
      padding[1] = values[1];
      padding[2] = values[2];
      padding[3] = values[3];
      changed = true;
    }
  }
  const longhands: Array<[property: string, index: number]> = [
    ['padding-top', 1],
    ['padding-right', 2],
    ['padding-bottom', 3],
    ['padding-left', 0],
  ];
  for (const [property, index] of longhands) {
    const value = cssLengthOrAutoToPdfPoints(getCssDeclarationValue(css, property), { allowNegative: false });
    if (value !== null) {
      padding[index] = value;
      changed = true;
    }
  }
  return changed ? padding : undefined;
}

function getPdfCssBorderStyle(
  document: VisualDocument,
  css: string
): { borderColor?: string; borderWidth?: number } | null {
  let borderWidth = cssLengthOrAutoToPdfPoints(getCssDeclarationValue(css, 'border-width'), { allowNegative: false });
  let borderColor = getCssColorDeclarationValue(document, css, 'border-color');
  const shorthand = getCssDeclarationValue(css, 'border');
  if (shorthand && !cssFragmentTriggersNetwork(shorthand)) {
    for (const part of shorthand.trim().split(/\s+/).filter(Boolean)) {
      borderWidth ??= cssLengthOrAutoToPdfPoints(part, { allowNegative: false });
      if (!borderColor && !isCssBorderStyleKeyword(part)) {
        const resolved = resolveCssColorValue(document, part);
        if (resolved && isPdfColorValue(resolved)) {
          borderColor = resolved;
        }
      }
    }
  }
  if ((borderWidth === null || borderWidth === 0) && !borderColor) {
    return null;
  }
  return {
    ...(borderColor ? { borderColor } : {}),
    ...(borderWidth !== null ? { borderWidth } : { borderWidth: 1 }),
  };
}

function isCssBorderStyleKeyword(value: string): boolean {
  return /^(none|hidden|dotted|dashed|solid|double|groove|ridge|inset|outset)$/i.test(value);
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

function getCssPdfFontSize(css: string): number | null {
  const value = getCssDeclarationValue(css, 'font-size');
  return value ? cssLengthToPdfPoints(value) : null;
}

function getCssPdfLineHeight(css: string): number | null {
  const value = getCssDeclarationValue(css, 'line-height')?.trim().toLowerCase();
  if (!value || value === 'normal' || (!isExternalCssAllowed() && cssFragmentTriggersNetwork(value))) {
    return null;
  }
  if (/^\d*\.?\d+$/.test(value)) {
    const lineHeight = Number.parseFloat(value);
    return lineHeight > 0 ? lineHeight : null;
  }
  return null;
}

function cssLengthToPdfPoints(value: string): number | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || (!isExternalCssAllowed() && cssFragmentTriggersNetwork(trimmed))) {
    return null;
  }
  const match = /^(\d*\.?\d+)(px|pt|rem|em|in|cm|mm)?$/.exec(trimmed);
  if (!match) {
    return null;
  }
  const amount = Number.parseFloat(match[1] ?? '');
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  const unit = match[2] ?? 'pt';
  if (unit === 'pt') return amount;
  if (unit === 'px') return amount * 0.75;
  if (unit === 'rem' || unit === 'em') return amount * PDF_CSS_REM_IN_POINTS;
  if (unit === 'in') return amount * 72;
  if (unit === 'cm') return amount * 72 / 2.54;
  if (unit === 'mm') return amount * 72 / 25.4;
  return null;
}

function getPdfCssMargin(css: string, fallback?: [number, number, number, number]): [number, number, number, number] | undefined {
  const margin = [...(fallback ?? [0, 0, 0, 0])] as [number, number, number, number];
  let changed = false;
  const shorthand = getCssDeclarationValue(css, 'margin');
  if (shorthand) {
    const values = parseCssBoxLengthValues(shorthand, { allowNegative: true });
    if (values) {
      margin[0] = values[0];
      margin[1] = values[1];
      margin[2] = values[2];
      margin[3] = values[3];
      changed = true;
    }
  }
  const longhands: Array<[property: string, index: number]> = [
    ['margin-top', 1],
    ['margin-right', 2],
    ['margin-bottom', 3],
    ['margin-left', 0],
  ];
  for (const [property, index] of longhands) {
    const value = cssLengthOrAutoToPdfPoints(getCssDeclarationValue(css, property), { allowNegative: true });
    if (value !== null) {
      margin[index] = value;
      changed = true;
    }
  }
  return changed ? margin : fallback;
}

function parseCssBoxLengthValues(value: string, options: { allowNegative: boolean }): [number, number, number, number] | null {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 1 || parts.length > 4) {
    return null;
  }
  const parsed = parts.map((part) => cssLengthOrAutoToPdfPoints(part, options));
  if (parsed.some((part) => part === null)) {
    return null;
  }
  const [top, right = top, bottom = top, left = right] = parsed as number[];
  return [left ?? 0, top ?? 0, right ?? 0, bottom ?? 0];
}

function cssLengthOrAutoToPdfPoints(value: string | null, options: { allowNegative: boolean } = { allowNegative: false }): number | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'auto') {
    return 0;
  }
  if (normalized === '0') {
    return 0;
  }
  const match = /^(-?\d*\.?\d+)(px|pt|rem|em|in|cm|mm)?$/.exec(normalized);
  if (!match) {
    return null;
  }
  const amount = Number.parseFloat(match[1] ?? '');
  if (!Number.isFinite(amount) || (!options.allowNegative && amount < 0)) {
    return null;
  }
  const unit = match[2] ?? 'pt';
  if (unit === 'pt') return amount;
  if (unit === 'px') return amount * 0.75;
  if (unit === 'rem' || unit === 'em') return amount * PDF_CSS_REM_IN_POINTS;
  if (unit === 'in') return amount * 72;
  if (unit === 'cm') return amount * 72 / 2.54;
  if (unit === 'mm') return amount * 72 / 25.4;
  return null;
}

function normalizePdfNodeMargin(margin: HvyPdfMakeNodeObject['margin']): [number, number, number, number] | undefined {
  if (typeof margin === 'number') {
    return [margin, margin, margin, margin];
  }
  if (Array.isArray(margin)) {
    if (margin.length === 2) {
      return [margin[0] ?? 0, margin[1] ?? 0, margin[0] ?? 0, margin[1] ?? 0];
    }
    if (margin.length === 4) {
      return [margin[0] ?? 0, margin[1] ?? 0, margin[2] ?? 0, margin[3] ?? 0];
    }
  }
  return undefined;
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
  const stack = images.map((entry) => {
    const hasCaption = Boolean(entry.caption.trim());
    const node = renderImageNode(document, entry.imageFile, entry.imageAlt, resolved, layout, '', hasCaption);
    const caption = entry.caption.trim() ? [{ text: entry.caption, style: 'metadata', alignment: 'center' as const }] : [];
    return { stack: [node, ...caption], unbreakable: true };
  });
  return stack.length ? { stack } : placeholderNode('Empty carousel.');
}

function renderImageBlock(
  document: VisualDocument,
  resolved: HvyPdfExportResolvedStrategy,
  block: VisualBlock,
  layout: PdfLayoutContext
): HvyPdfMakeNodeObject {
  const captionText = getTextCaptionMarkdown(block.schema.caption).trim();
  const hasCaption = Boolean(captionText);
  const image = renderImageNode(document, block.schema.imageFile, block.schema.imageAlt, resolved, layout, block.schema.css, hasCaption);
  const captionPayload = normalizeTextCaption(block.schema.caption);
  const caption = hasCaption && captionPayload
    ? [renderPdfTextBlock(captionPayload.text, '', createCaptionPdfDecision(), captionPayload.schema.align)]
    : [];
  const bounds = resolved.defaults.debugPageBounds ? [renderPdfDebugImageBounds(image, layout, hasCaption)] : [];
  return { stack: [...bounds, image, ...caption], unbreakable: true };
}

function createCaptionPdfDecision(): HvyPdfExportDecision {
  return {
    visibility: 'include',
    keepTogether: false,
    keepWithNext: false,
    allowSplit: true,
    role: 'body',
    pageBreakBefore: false,
    pageBreakAfter: false,
    pdfStyle: {},
  };
}

function renderImageNode(
  document: VisualDocument,
  filename: string,
  alt: string,
  resolved: HvyPdfExportResolvedStrategy,
  layout: PdfLayoutContext,
  css = '',
  hasCaption = false
): HvyPdfMakeNodeObject {
  const attachment = filename ? getImageAttachment(document, filename) : null;
  if (!attachment) {
    return resolved.defaults.unsupportedPluginPolicy === 'hide'
      ? { text: '' }
      : placeholderNode(alt.trim() ? `Missing image: ${alt}` : 'Missing image.');
  }
  const mediaType = typeof attachment.meta.mediaType === 'string' ? attachment.meta.mediaType : '';
  const fit = getImageFitForCss(css, layout);
  const margin: [number, number, number, number] = hasCaption ? [0, 0, 0, 3] : [0, 0, 0, 8];
  if (mediaType === 'image/svg+xml') {
    return { svg: decodeText(attachment.bytes), fit, alignment: 'center', margin };
  }
  if (mediaType === 'image/png' || mediaType === 'image/jpeg') {
    return {
      image: `data:${mediaType};base64,${toBase64(attachment.bytes)}`,
      fit,
      alignment: 'center',
      margin,
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

function getImageFitForCss(css: string, layout: PdfLayoutContext): [number, number] {
  const fallback = getImageFitForLayout(layout);
  const maxWidth = Number.isFinite(layout.availableWidth) ? Math.max(1, layout.availableWidth) : PDF_DEFAULT_IMAGE_FIT[0];
  const width = cssImageLengthToPdfPoints(getCssDeclarationValue(css, 'width'), maxWidth);
  const height = cssImageLengthToPdfPoints(getCssDeclarationValue(css, 'height'), fallback[1]);

  if (!width && !height) {
    return fallback;
  }
  if (width && height) {
    return [Math.min(width, maxWidth), Math.max(1, height)];
  }
  if (width) {
    const clampedWidth = Math.min(width, maxWidth);
    return [clampedWidth, clampedWidth];
  }
  const clampedHeight = Math.max(1, height ?? fallback[1]);
  return [Math.min(maxWidth, Math.max(fallback[0], clampedHeight)), clampedHeight];
}

function cssImageLengthToPdfPoints(value: string | null, percentageBase: number): number | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === 'auto') {
    return null;
  }
  const percentage = /^(\d*\.?\d+)%$/.exec(normalized);
  if (percentage) {
    const amount = Number.parseFloat(percentage[1] ?? '');
    return Number.isFinite(amount) && amount > 0 ? (percentageBase * amount) / 100 : null;
  }
  const rem = /^(\d*\.?\d+)(rem|em)$/.exec(normalized);
  if (rem) {
    const amount = Number.parseFloat(rem[1] ?? '');
    return Number.isFinite(amount) && amount > 0 ? amount * PDF_IMAGE_CSS_REM_IN_POINTS : null;
  }
  return cssLengthToPdfPoints(normalized);
}

function getPdfPageContentWidth(
  pageSize: HvyPdfExportResolvedStrategy['defaults']['pageSize'],
  pageMargins: HvyPdfExportResolvedStrategy['defaults']['pageMargins']
): number {
  const size = normalizePdfPageSize(pageSize);
  const margins = normalizePdfPageMargins(pageMargins);
  return Math.max(1, size.width - margins[0] - margins[2]);
}

function renderPdfDebugPageBounds(pageMargins: HvyPdfExportResolvedStrategy['defaults']['pageMargins']): HvyPdfMakeDocumentDefinition['background'] {
  const margins = normalizePdfPageMargins(pageMargins);
  return (_currentPage, pageSize) => {
    const pageWidth = Math.max(1, pageSize.width);
    const pageHeight = Math.max(1, pageSize.height);
    const [left, top, right, bottom] = margins;
    return {
      absolutePosition: { x: 0, y: 0 },
      canvas: [
        {
          type: 'rect',
          x: 0,
          y: 0,
          w: pageWidth,
          h: pageHeight,
          lineColor: '#dc2626',
          lineWidth: 0.75,
        },
        {
          type: 'rect',
          x: left,
          y: top,
          w: Math.max(1, pageWidth - left - right),
          h: Math.max(1, pageHeight - top - bottom),
          lineColor: '#2563eb',
          lineWidth: 0.75,
        },
      ],
    };
  };
}

function applyPdfDebugBlockBounds(
  node: HvyPdfMakeNodeObject,
  resolved: HvyPdfExportResolvedStrategy,
  layout: PdfLayoutContext
): HvyPdfMakeNodeObject {
  if (!resolved.defaults.debugPageBounds) {
    return node;
  }
  const { margin, pageBreak, headlineLevel, hvyKeepWithNext, hvyKeepTogether, hvyRole, id, ...inner } = node;
  return {
    ...(typeof id === 'string' ? { id } : {}),
    ...(pageBreak ? { pageBreak } : {}),
    ...(typeof headlineLevel === 'number' ? { headlineLevel } : {}),
    ...(hvyKeepWithNext ? { hvyKeepWithNext } : {}),
    ...(hvyKeepTogether ? { hvyKeepTogether } : {}),
    ...(typeof hvyRole === 'string' ? { hvyRole } : {}),
    ...(margin !== undefined ? { margin } : {}),
    stack: [renderPdfDebugBlockMarker(layout.availableWidth), inner],
  };
}

function renderPdfDebugBlockMarker(availableWidth: number): HvyPdfMakeNodeObject {
  const width = Number.isFinite(availableWidth) ? Math.max(1, availableWidth) : PDF_DEFAULT_IMAGE_FIT[0];
  return {
    relativePosition: { x: 0, y: 0 },
    canvas: [
      {
        type: 'rect',
        x: 0,
        y: 0,
        w: width,
        h: 1,
        lineColor: '#f59e0b',
        lineWidth: 0.5,
      },
    ],
  };
}

function renderPdfDebugImageBounds(image: HvyPdfMakeNodeObject, layout: PdfLayoutContext, hasCaption: boolean): HvyPdfMakeNodeObject {
  const [fitWidth, fitHeight] = image.fit ?? getImageFitForLayout(layout);
  const boxWidth = Math.max(1, fitWidth);
  const boxHeight = Math.max(1, fitHeight + (hasCaption ? 20 : 0));
  const availableWidth = Number.isFinite(layout.availableWidth) ? Math.max(1, layout.availableWidth) : boxWidth;
  const x = image.alignment === 'center' ? Math.max(0, (availableWidth - boxWidth) / 2) : 0;
  return {
    relativePosition: { x, y: 0 },
    canvas: [
      {
        type: 'rect',
        x: 0,
        y: 0,
        w: boxWidth,
        h: boxHeight,
        lineColor: '#f59e0b',
        lineWidth: 0.5,
      },
    ],
  };
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
