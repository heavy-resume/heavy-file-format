import type { VisualSection } from '../editor/types';
import type { ReaderRenderer } from './render';
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

export function refreshReaderSectionDom(options: ReaderSectionRefreshOptions): boolean {
  const section = findSectionByKey(options.sections, options.sectionKey);
  if (!section) {
    return false;
  }
  const selector = `.reader-section[data-section-key="${CSS.escape(options.sectionKey)}"]`;
  const targets = Array.from(options.root.querySelectorAll<HTMLElement>(selector));
  if (targets.length === 0) {
    return false;
  }
  let replaced = 0;
  targets.forEach((target) => {
    const html = options.readerRenderer.renderReaderSection(section);
    if (!html.trim()) {
      return;
    }
    const template = target.ownerDocument.createElement('template');
    template.innerHTML = html.trim();
    const replacement = template.content.firstElementChild;
    if (!(replacement instanceof HTMLElement)) {
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
  const selector = `.reader-block[data-section-key="${CSS.escape(options.sectionKey)}"][data-block-id="${CSS.escape(options.blockId)}"]`;
  const targets = Array.from(options.root.querySelectorAll<HTMLElement>(selector));
  if (targets.length === 0) {
    return false;
  }
  let replaced = 0;
  targets.forEach((target) => {
    const html = options.readerRenderer.renderReaderBlock(section, block);
    if (!html.trim()) {
      return;
    }
    const template = target.ownerDocument.createElement('template');
    template.innerHTML = html.trim();
    const replacement = template.content.firstElementChild;
    if (!(replacement instanceof HTMLElement)) {
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
