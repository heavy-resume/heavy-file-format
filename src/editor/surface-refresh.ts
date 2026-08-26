import { findSectionByKey } from '../section-ops';
import type { VisualBlock, VisualSection } from './types';
import type { EditorRenderer } from './render';
import type { EditorRenderTreeWindowOptions } from './editor-render-tree-window';

export interface EditorSectionRefreshOptions {
  root: ParentNode;
  editorRenderer: EditorRenderer;
  sections: VisualSection[];
  sectionKey: string;
  afterReplace?: (element: HTMLElement) => void;
}

export function refreshEditorSectionDom(options: EditorSectionRefreshOptions): boolean {
  const section = findSectionByKey(options.sections, options.sectionKey);
  if (!section) {
    return false;
  }
  const targets = Array.from(options.root.querySelectorAll<HTMLElement>(
    `:is(.editor-section-card[data-editor-section="${CSS.escape(options.sectionKey)}"], .hvy-section-virtual-placeholder[data-hvy-virtual-kind="editor"][data-section-key="${CSS.escape(options.sectionKey)}"])`
  )).filter((target) => target.closest('.editor-tree, .editor-sidebar-panel'));
  if (targets.length === 0) {
    return false;
  }
  const isSubsection = !options.sections.some((candidate) => candidate === section);
  let replaced = 0;
  targets.forEach((target) => {
    const scrollContainer = target.closest<HTMLElement>('.editor-tree, .editor-sidebar-panel');
    if (!scrollContainer) {
      return;
    }
    const scrollTop = scrollContainer.scrollTop;
    const replacement = createEditorSectionElement(
      target.ownerDocument,
      options.editorRenderer,
      section,
      options.sections,
      isSubsection
    );
    if (!replacement) {
      return;
    }
    target.replaceWith(replacement);
    preserveEditorViewportPosition(scrollContainer, scrollTop);
    options.afterReplace?.(replacement);
    replaced += 1;
  });
  return replaced > 0;
}

export function createEditorSectionElement(
  ownerDocument: Document,
  editorRenderer: EditorRenderer,
  section: VisualSection,
  rootSections: VisualSection[],
  isSubsection = false,
  blockWindowOptions?: EditorRenderTreeWindowOptions
): HTMLElement | null {
  const html = editorRenderer.renderEditorSection(section, rootSections, isSubsection, blockWindowOptions).trim();
  if (!html) {
    return null;
  }
  const template = ownerDocument.createElement('template');
  template.innerHTML = html;
  const element = template.content.firstElementChild;
  return element instanceof HTMLElement ? element : null;
}

export function createEditorBlockElement(
  ownerDocument: Document,
  editorRenderer: EditorRenderer,
  sectionKey: string,
  block: VisualBlock,
  rootSections: VisualSection[],
  parentLocked = false
): HTMLElement | null {
  const html = editorRenderer.renderEditorBlock(sectionKey, block, rootSections, parentLocked).trim();
  if (!html) {
    return null;
  }
  const template = ownerDocument.createElement('template');
  template.innerHTML = html;
  const element = template.content.firstElementChild;
  return element instanceof HTMLElement ? element : null;
}

function preserveEditorViewportPosition(scrollContainer: HTMLElement, scrollTop: number): void {
  const maximumScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
  if (maximumScrollTop < scrollTop) {
    let tail = scrollContainer.querySelector<HTMLElement>(':scope > .editor-document-tail');
    if (!tail) {
      tail = scrollContainer.ownerDocument.createElement('div');
      tail.className = 'editor-document-tail';
      tail.setAttribute('aria-hidden', 'true');
      scrollContainer.appendChild(tail);
    }
    const currentHeight = tail.getBoundingClientRect().height;
    tail.style.height = `${Math.ceil(currentHeight + scrollTop - maximumScrollTop + 1)}px`;
  }
  scrollContainer.scrollTop = scrollTop;
}
