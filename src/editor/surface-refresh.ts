import { findSectionByKey } from '../section-ops';
import type { SectionLocation, VisualBlock, VisualSection } from './types';
import type { EditorRenderer } from './render';
import type { EditorRenderTreeWindowOptions } from './editor-render-tree-window';

export interface EditorSectionRefreshOptions {
  root: ParentNode;
  editorRenderer: EditorRenderer;
  sections: VisualSection[];
  sectionKey: string;
  afterReplace?: (element: HTMLElement) => void;
}

export interface EditorBlockRefreshOptions {
  root: ParentNode;
  editorRenderer: EditorRenderer;
  sections: VisualSection[];
  sectionKey: string;
  block: VisualBlock;
  afterReplace?: (element: HTMLElement) => void;
}

export interface EditorTopLevelSectionInsertOptions {
  root: ParentNode;
  editorRenderer: EditorRenderer;
  sections: VisualSection[];
  sectionKey: string;
  location: SectionLocation;
  afterInsert?: (element: HTMLElement) => void;
}

export function insertEditorTopLevelSectionDom(options: EditorTopLevelSectionInsertOptions): boolean {
  const section = options.sections.find((candidate) => candidate.key === options.sectionKey);
  const surface = options.location === 'sidebar'
    ? options.root.querySelector<HTMLElement>('.editor-sidebar-panel')
    : options.root.querySelector<HTMLElement>('#editorTree');
  const anchor = surface?.querySelector<HTMLElement>(
    `[data-action="add-top-level-section"][data-section-location="${options.location}"]`
  );
  if (!section || !anchor) {
    return false;
  }
  const element = createEditorSectionElement(anchor.ownerDocument, options.editorRenderer, section, options.sections);
  if (!element) {
    return false;
  }
  anchor.before(element);
  options.afterInsert?.(element);
  return true;
}

export function refreshEditorBlockDom(options: EditorBlockRefreshOptions): boolean {
  const targets = Array.from(options.root.querySelectorAll<HTMLElement>(
    `:is(.editor-block, .editor-block-passive)[data-section-key="${CSS.escape(options.sectionKey)}"][data-block-id="${CSS.escape(options.block.id)}"]`
  )).filter((target) => target.closest('.editor-tree, .editor-sidebar-panel, .reader-document, .viewer-sidebar-panel'));
  let replaced = 0;
  targets.forEach((target) => {
    const scrollContainer = target.closest<HTMLElement>(
      '.editor-tree, .editor-sidebar-panel, .reader-document, .viewer-sidebar-panel'
    );
    const parent = target.parentElement;
    if (!scrollContainer || !parent) {
      return;
    }
    const scrollTop = scrollContainer.scrollTop;
    const oldRect = target.getBoundingClientRect();
    const oldWasActive = target.matches('.editor-block')
      && (target.matches('[data-active-editor-block="true"]')
        || Boolean(target.querySelector('.editor-block[data-active-editor-block="true"]')));
    const surroundingRects = captureVisibleSiblingRects(target, scrollContainer);
    const replacements = createEditorBlockElements(
      target.ownerDocument,
      options.editorRenderer,
      options.sectionKey,
      options.block,
      options.sections,
      target.dataset.parentLocked === 'true'
    );
    const replacementBlock = replacements.find((element) => element.dataset.blockId === options.block.id);
    if (!replacementBlock) {
      return;
    }
    preservePreparedBlockImages(target, replacementBlock);
    removeActiveInsertGhosts(target);
    target.replaceWith(...replacements);
    preserveEditorViewportPosition(scrollContainer, scrollTop);
    options.afterReplace?.(replacementBlock);
    if (oldWasActive && replacementBlock.matches('.editor-block-passive')) {
      scheduleEditorBlockCollapseTransition(replacementBlock, oldRect, surroundingRects, scrollContainer, scrollTop);
    }
    replaced += 1;
  });
  return replaced > 0;
}

function preservePreparedBlockImages(target: HTMLElement, replacement: HTMLElement): void {
  const preparedImagesByFilename = new Map<string, HTMLImageElement[]>();
  target.querySelectorAll<HTMLImageElement>('img[data-image-filename]').forEach((image) => {
    const filename = image.dataset.imageFilename ?? '';
    if (!filename || !image.getAttribute('src') || !image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
      return;
    }
    preparedImagesByFilename.set(filename, [...(preparedImagesByFilename.get(filename) ?? []), image]);
  });
  replacement.querySelectorAll<HTMLImageElement>('img[data-image-filename]').forEach((nextImage) => {
    if (nextImage.getAttribute('src')) {
      return;
    }
    const filename = nextImage.dataset.imageFilename ?? '';
    const preparedImage = preparedImagesByFilename.get(filename)?.shift();
    if (!preparedImage) {
      return;
    }
    Array.from(preparedImage.attributes).forEach((attribute) => {
      if (attribute.name !== 'src') {
        preparedImage.removeAttribute(attribute.name);
      }
    });
    Array.from(nextImage.attributes).forEach((attribute) => {
      if (attribute.name !== 'src') {
        preparedImage.setAttribute(attribute.name, attribute.value);
      }
    });
    if (!preparedImage.hasAttribute('width')) {
      preparedImage.setAttribute('width', String(preparedImage.naturalWidth));
    }
    if (!preparedImage.hasAttribute('height')) {
      preparedImage.setAttribute('height', String(preparedImage.naturalHeight));
    }
    preparedImage.dataset.hvyLazyImage = 'loaded';
    preparedImage.dataset.hvyAttachmentResolution = 'resolved';
    nextImage.replaceWith(preparedImage);
  });
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
  return createEditorBlockElements(ownerDocument, editorRenderer, sectionKey, block, rootSections, parentLocked)[0] ?? null;
}

function createEditorBlockElements(
  ownerDocument: Document,
  editorRenderer: EditorRenderer,
  sectionKey: string,
  block: VisualBlock,
  rootSections: VisualSection[],
  parentLocked = false
): HTMLElement[] {
  const html = editorRenderer.renderEditorBlock(sectionKey, block, rootSections, parentLocked).trim();
  if (!html) {
    return [];
  }
  const template = ownerDocument.createElement('template');
  template.innerHTML = html;
  return Array.from(template.content.children).filter((element): element is HTMLElement => element instanceof HTMLElement);
}

function removeActiveInsertGhosts(target: HTMLElement): void {
  if (target.previousElementSibling?.classList.contains('active-component-insert-ghost-before')) {
    target.previousElementSibling.remove();
  }
  if (target.nextElementSibling?.classList.contains('active-component-insert-ghost-after')) {
    target.nextElementSibling.remove();
  }
}

function captureVisibleSiblingRects(target: HTMLElement, scrollContainer: HTMLElement): Map<HTMLElement, DOMRect> {
  const result = new Map<HTMLElement, DOMRect>();
  const visibleRect = scrollContainer.getBoundingClientRect();
  Array.from(target.parentElement?.children ?? []).forEach((candidate) => {
    if (!(candidate instanceof HTMLElement) || candidate === target || candidate.classList.contains('active-component-insert-ghost')) {
      return;
    }
    const rect = candidate.getBoundingClientRect();
    if (rect.bottom >= visibleRect.top - 80 && rect.top <= visibleRect.bottom + 80) {
      result.set(candidate, rect);
    }
  });
  return result;
}

function scheduleEditorBlockCollapseTransition(
  replacement: HTMLElement,
  oldRect: DOMRect,
  surroundingRects: Map<HTMLElement, DOMRect>,
  scrollContainer: HTMLElement,
  scrollTop: number
): void {
  const view = replacement.ownerDocument.defaultView;
  if (!view || view.matchMedia('(prefers-reduced-motion: reduce)').matches || typeof replacement.animate !== 'function') {
    return;
  }
  const passiveRect = replacement.getBoundingClientRect();
  const passiveHeight = passiveRect.height;
  replacement.style.height = `${oldRect.height}px`;
  replacement.style.overflow = 'clip';
  preserveEditorViewportPosition(scrollContainer, scrollTop);
  queueMicrotask(() => {
    if (!replacement.isConnected) {
      return;
    }
    const nextRect = replacement.getBoundingClientRect();
    const animation = replacement.animate([
      {
        opacity: 0.72,
        height: `${oldRect.height}px`,
        transform: `translate(${oldRect.left - nextRect.left}px, ${oldRect.top - nextRect.top}px)`,
        transformOrigin: 'top left',
      },
      { opacity: 1, height: `${passiveHeight}px`, transform: 'translate(0, 0)', transformOrigin: 'top left' },
    ], {
      duration: 180,
      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    });
    animation.id = 'hvy-editor-block-collapse';
    const clearTransitionStyles = (): void => {
      if (replacement.isConnected) {
        replacement.style.removeProperty('height');
        replacement.style.removeProperty('overflow');
      }
    };
    void animation.finished.then(clearTransitionStyles, clearTransitionStyles);
    surroundingRects.forEach((rect, element) => {
      if (!element.isConnected || typeof element.animate !== 'function') {
        return;
      }
      const next = element.getBoundingClientRect();
      const deltaY = rect.top - next.top;
      if (Math.abs(deltaY) <= 0.5) {
        return;
      }
      const siblingAnimation = element.animate([
        { transform: `translateY(${deltaY}px)` },
        { transform: 'translateY(0)' },
      ], {
        duration: 180,
        easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      });
      siblingAnimation.id = 'hvy-editor-surrounding-shift';
    });
  });
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
