import type { VisualBlock, VisualSection } from '../editor/types';
import type { ReaderRenderer } from './render';
import type { ReaderBlockRenderOptions } from '../editor/component-helpers';
import type { ReaderRenderTreeWindowOptions } from './reader-render-tree-window';
import { findSectionByKey } from '../section-ops';
import { findBlockByIds } from '../block-ops';
import { captureVisibilityStates, restoreVisibilityStates } from './refresh-surfaces';

export interface ReaderBlockRefreshOptions {
  root: ParentNode;
  readerRenderer: ReaderRenderer;
  sections: VisualSection[];
  sectionKey: string;
  blockId: string;
  afterReplace?: (element: HTMLElement) => void;
}

export interface ReaderSectionRefreshOptions {
  root: ParentNode;
  readerRenderer: ReaderRenderer;
  sections: VisualSection[];
  sectionKey: string;
  afterReplace?: (element: HTMLElement) => void;
}

function normalizeReaderTableStripes(scope: ParentNode): void {
  let stripeIndex = 0;
  scope.querySelectorAll<HTMLTableElement>('.reader-table').forEach((table) => {
    if (table.querySelector('thead')) {
      stripeIndex = 0;
    }
    table.querySelectorAll<HTMLTableRowElement>('.table-main-row').forEach((row) => {
      const isEven = stripeIndex % 2 === 0;
      row.classList.toggle('table-main-row-even', isEven);
      row.classList.toggle('table-main-row-odd', !isEven);
      stripeIndex += 1;
    });
  });
}

function normalizeReaderTableStripesNear(element: HTMLElement): void {
  normalizeReaderTableStripes(element.closest('.reader-section') ?? element);
}

export function createReaderSectionElement(
  ownerDocument: Document,
  readerRenderer: ReaderRenderer,
  section: VisualSection,
  blockWindowOptions?: ReaderRenderTreeWindowOptions
): HTMLElement | null {
  const html = readerRenderer.renderReaderSection(section, blockWindowOptions);
  if (!html.trim()) {
    return null;
  }
  const template = ownerDocument.createElement('template');
  template.innerHTML = html.trim();
  const element = template.content.firstElementChild;
  return element instanceof HTMLElement ? element : null;
}

export function createReaderBlockElement(
  ownerDocument: Document,
  readerRenderer: ReaderRenderer,
  section: VisualSection,
  block: VisualBlock,
  renderOptions?: ReaderBlockRenderOptions
): HTMLElement | null {
  const html = readerRenderer.renderReaderBlock(section, block, renderOptions);
  if (!html.trim()) {
    return null;
  }
  const template = ownerDocument.createElement('template');
  template.innerHTML = html.trim();
  const element = template.content.firstElementChild;
  return element instanceof HTMLElement ? element : null;
}

export function refreshReaderSectionDom(options: ReaderSectionRefreshOptions): boolean {
  const section = findSectionByKey(options.sections, options.sectionKey);
  if (!section) {
    return false;
  }
  const escapedSectionKey = CSS.escape(options.sectionKey);
  const selector = [
    `.reader-section[data-section-key="${escapedSectionKey}"]`,
    `.hvy-section-virtual-placeholder[data-hvy-virtual-kind="reader"][data-section-key="${escapedSectionKey}"]`,
  ].join(', ');
  const targets = Array.from(options.root.querySelectorAll<HTMLElement>(selector));
  if (targets.length === 0) {
    return false;
  }
  let replaced = 0;
  targets.forEach((target) => {
    const replacement = createReaderSectionElement(target.ownerDocument, options.readerRenderer, section);
    if (!replacement) {
      return;
    }
    restoreVisibilityStates(replacement, captureVisibilityStates(target));
    target.replaceWith(replacement);
    options.afterReplace?.(replacement);
    normalizeReaderTableStripesNear(replacement);
    replaced += 1;
  });
  return replaced > 0;
}

export function refreshReaderBlockDom(options: ReaderBlockRefreshOptions): boolean {
  const section = findSectionByKey(options.sections, options.sectionKey);
  const block = findBlockByIds(options.sectionKey, options.blockId);
  if (!section || !block) {
    return false;
  }
  const escapedSectionKey = CSS.escape(options.sectionKey);
  const escapedBlockId = CSS.escape(options.blockId);
  const selector = [
    `.reader-block[data-section-key="${escapedSectionKey}"][data-block-id="${escapedBlockId}"]`,
    `.hvy-section-virtual-placeholder[data-hvy-virtual-kind="reader-block"][data-section-key="${escapedSectionKey}"][data-block-id="${escapedBlockId}"]`,
  ].join(', ');
  const targets = Array.from(options.root.querySelectorAll<HTMLElement>(selector));
  if (targets.length === 0) {
    return false;
  }
  let replaced = 0;
  targets.forEach((target) => {
    const renderOptions = target.dataset.readerTrimVerticalEdgeMargin === 'true'
      ? { trimVerticalEdgeMargin: true }
      : undefined;
    const replacement = createReaderBlockElement(target.ownerDocument, options.readerRenderer, section, block, renderOptions);
    if (!replacement) {
      return;
    }
    restoreVisibilityStates(replacement, captureVisibilityStates(target));
    target.replaceWith(replacement);
    options.afterReplace?.(replacement);
    normalizeReaderTableStripesNear(replacement);
    replaced += 1;
  });
  return replaced > 0;
}
