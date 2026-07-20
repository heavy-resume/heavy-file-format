import { state } from './state';
import type { PaneScrollState } from './types';

export function capturePaneScroll(previous: PaneScrollState, app: HTMLElement): PaneScrollState {
  const fullPane = app.querySelector<HTMLDivElement>('.full-pane');
  const editorTree = app.querySelector<HTMLDivElement>('.editor-shell .editor-tree');
  const editorSidebarPanel = app.querySelector<HTMLDivElement>('.editor-sidebar-panel');
  const viewerSidebarPanel = app.querySelector<HTMLDivElement>('.viewer-sidebar-panel');
  const readerPane =
    app.querySelector<HTMLDivElement>('.viewer-shell .reader-document') ??
    app.querySelector<HTMLDivElement>('.reader-pane');
  return {
    fullPaneTop: fullPane?.scrollTop ?? previous.fullPaneTop,
    editorTop: editorTree?.scrollTop ?? previous.editorTop,
    editorSidebarTop: editorSidebarPanel?.scrollTop ?? previous.editorSidebarTop,
    viewerSidebarTop: viewerSidebarPanel?.scrollTop ?? previous.viewerSidebarTop,
    readerTop: readerPane?.scrollTop ?? previous.readerTop,
    windowLeft: window.scrollX,
    windowTop: window.scrollY,
  };
}

export function restorePaneScroll(scroll: PaneScrollState | null, app: HTMLElement): void {
  if (!scroll) {
    return;
  }
  const restore = (): void => {
    const editorTree = app.querySelector<HTMLDivElement>('.editor-shell .editor-tree');
    const editorSidebarPanel = app.querySelector<HTMLDivElement>('.editor-sidebar-panel');
    const viewerSidebarPanel = app.querySelector<HTMLDivElement>('.viewer-sidebar-panel');
    const fullPane = app.querySelector<HTMLDivElement>('.full-pane');
    const readerPane =
      app.querySelector<HTMLDivElement>('.viewer-shell .reader-document') ??
      app.querySelector<HTMLDivElement>('.reader-pane');
    if (fullPane) {
      fullPane.scrollTop = scroll.fullPaneTop;
    }
    if (editorTree) {
      editorTree.scrollTop = scroll.editorTop;
    }
    if (editorSidebarPanel) {
      editorSidebarPanel.scrollTop = scroll.editorSidebarTop;
    }
    if (viewerSidebarPanel) {
      viewerSidebarPanel.scrollTop = scroll.viewerSidebarTop;
    }
    if (readerPane) {
      readerPane.scrollTop = scroll.readerTop;
    }
    window.scrollTo({ top: scroll.windowTop, left: scroll.windowLeft, behavior: 'auto' });
  };
  restore();
  window.requestAnimationFrame(() => {
    restore();
    window.requestAnimationFrame(restore);
  });
}

export function centerPendingEditorSection(app: HTMLElement): void {
  const sectionKey = state.pendingEditorCenterSectionKey;
  if (!sectionKey) {
    return;
  }
  state.pendingEditorCenterSectionKey = null;
  window.setTimeout(() => {
    const sectionEl = app.querySelector<HTMLElement>(`[data-editor-section="${sectionKey}"]`);
    if (!sectionEl) {
      return;
    }
    sectionEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 5);
}

export function focusPendingSectionTitleEditor(app: HTMLElement): void {
  const sectionKey = state.activeEditorSectionTitleKey;
  if (!sectionKey) {
    return;
  }
  window.requestAnimationFrame(() => {
    const input = app.querySelector<HTMLInputElement>(
      `.section-title-input[data-section-key="${CSS.escape(sectionKey)}"]`
    );
    if (!input) {
      return;
    }
    input.focus();
    if (state.clearSectionTitleOnFocusKey === sectionKey) {
      input.select();
      state.clearSectionTitleOnFocusKey = null;
      return;
    }
    const valueLength = input.value.length;
    input.setSelectionRange(valueLength, valueLength);
  });
}

export function scrollPendingEditorActivation(app: HTMLElement): void {
  const pending = state.pendingEditorActivation;
  if (!pending) {
    return;
  }
  if (pending.suppressFocus) {
    state.pendingEditorActivation = null;
    return;
  }
  if (pending.immediateFocus) {
    focusPendingEditorActivation(app, pending);
    return;
  }
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      const current = state.pendingEditorActivation;
      if (!current || current.sectionKey !== pending.sectionKey || current.blockId !== pending.blockId) {
        return;
      }
      focusPendingEditorActivation(app, pending);
    });
  });
}

export function captureEditorDeactivationAnchor(
  app: HTMLElement,
  sectionKey: string,
  blockId: string
): NonNullable<typeof state.pendingEditorDeactivation> | null {
  const block = app.querySelector<HTMLElement>(
    `.editor-block[data-active-editor-block="true"][data-active-block-id="${CSS.escape(blockId)}"]`
  );
  const scrollContainer = block?.closest<HTMLElement>(
    '.editor-shell .editor-tree, .editor-sidebar-panel, .reader-document, .viewer-sidebar-panel'
  );
  const scrollSurface = getEditorScrollSurface(scrollContainer);
  if (!block || !scrollContainer || !scrollSurface) {
    return null;
  }
  const userScrollDirection = scrollContainer.dataset.activeEditorUserScrollDirection;
  const userScrollStartTop = Number(scrollContainer.dataset.activeEditorUserScrollStartTop);
  const passiveHeight = Number(block.dataset.passiveBlockHeight);
  const blockRect = block.getBoundingClientRect();
  const scrollRect = scrollContainer.getBoundingClientRect();
  const visibleTop = scrollRect.top + scrollContainer.clientTop;
  const visibleBottom = visibleTop + scrollContainer.clientHeight;
  const editorIsClipped = blockRect.top < visibleTop || blockRect.bottom > visibleBottom;
  const expandedHeight = Number.isFinite(passiveHeight)
    ? Math.max(0, blockRect.height - passiveHeight)
    : 0;
  return {
    sectionKey,
    blockId,
    scrollSurface,
    scrollTopBeforeClose: scrollContainer.scrollTop,
    scrollAdjustment: editorIsClipped
      && userScrollDirection === 'down'
      && Number.isFinite(userScrollStartTop)
      && Number.isFinite(passiveHeight)
      ? Math.min(
          Math.max(0, scrollContainer.scrollTop - userScrollStartTop),
          expandedHeight
        )
      : 0,
  };
}

export function scrollPendingEditorDeactivation(app: HTMLElement): void {
  const pending = state.pendingEditorDeactivation;
  if (!pending) {
    return;
  }
  applyPendingEditorDeactivationScroll(app, pending);
  window.requestAnimationFrame(() => {
    if (state.pendingEditorDeactivation !== pending) {
      return;
    }
    applyPendingEditorDeactivationScroll(app, pending);
    window.requestAnimationFrame(() => {
      if (state.pendingEditorDeactivation !== pending) {
        return;
      }
      applyPendingEditorDeactivationScroll(app, pending);
      state.pendingEditorDeactivation = null;
    });
  });
}

function applyPendingEditorDeactivationScroll(
  app: HTMLElement,
  pending: NonNullable<typeof state.pendingEditorDeactivation>
): void {
  const scrollContainer = app.querySelector<HTMLElement>(getEditorScrollSurfaceSelector(pending.scrollSurface));
  if (!scrollContainer) {
    return;
  }
  scrollContainer.scrollTop = Math.max(0, pending.scrollTopBeforeClose - pending.scrollAdjustment);
}

function getEditorScrollSurface(element: HTMLElement | null | undefined): NonNullable<typeof state.pendingEditorDeactivation>['scrollSurface'] | null {
  if (element?.matches('.editor-shell .editor-tree')) return 'editor';
  if (element?.matches('.editor-sidebar-panel')) return 'editor-sidebar';
  if (element?.matches('.reader-document')) return 'reader';
  if (element?.matches('.viewer-sidebar-panel')) return 'viewer-sidebar';
  return null;
}

function getEditorScrollSurfaceSelector(surface: NonNullable<typeof state.pendingEditorDeactivation>['scrollSurface']): string {
  if (surface === 'editor') return '.editor-shell .editor-tree';
  if (surface === 'editor-sidebar') return '.editor-sidebar-panel';
  if (surface === 'reader') return '.reader-document';
  return '.viewer-sidebar-panel';
}

function focusPendingEditorActivation(
  app: HTMLElement,
  pending: NonNullable<typeof state.pendingEditorActivation>
): void {
  const block = app.querySelector<HTMLElement>(
    `.editor-block[data-active-editor-block="true"][data-active-block-id="${CSS.escape(pending.blockId)}"]`
  );
  if (!block) {
    state.pendingEditorActivation = null;
    return;
  }
  const fallbackTarget = getPrimaryEditorActivationTarget(block) ?? block;
  const editorTree = app.querySelector<HTMLDivElement>('.editor-shell .editor-tree');
  if (typeof pending.anchorTop === 'number') {
    const editableTop = fallbackTarget.getBoundingClientRect().top;
    const pushedDownBy = editableTop - pending.anchorTop;
    if (editorTree && pushedDownBy > 0) {
      editorTree.scrollTop += pushedDownBy;
    }
  }
  const target = getEditorActivationTarget(block, fallbackTarget, pending.clientX, pending.clientY);
  focusEditorActivationTarget(target, pending.clientX, pending.clientY);
  state.pendingEditorActivation = null;
}

function getEditorActivationTarget(
  block: HTMLElement,
  fallbackTarget: HTMLElement,
  clientX?: number,
  clientY?: number
): HTMLElement {
  if (typeof clientX !== 'number' || typeof clientY !== 'number') {
    return fallbackTarget;
  }
  const pointed = document.elementFromPoint(clientX, clientY);
  const pointedEditable = pointed instanceof HTMLElement
    ? pointed.closest<HTMLElement>('[contenteditable="true"], textarea, input:not([type="hidden"]), select')
    : null;
  return pointedEditable && block.contains(pointedEditable) && isUsableEditorActivationTarget(pointedEditable)
    ? pointedEditable
    : fallbackTarget;
}

function getPrimaryEditorActivationTarget(block: HTMLElement): HTMLElement | null {
  const selectors = [
    '.text-fill-in-editor [data-field="text-fill-in-value"]',
    '.rich-editor[data-field="block-rich"]',
    '.rich-editor.text-fill-in-editor',
    '[data-field="block-grid-rich"]',
    '[data-field="table-details-rich"]',
    '.rich-editor[contenteditable="true"]',
    '[contenteditable="true"]',
    'textarea',
    'input:not([type="hidden"])',
    'select',
  ];
  for (const selector of selectors) {
    const target = Array.from(block.querySelectorAll<HTMLElement>(selector)).find((candidate) =>
      !candidate.closest('[data-editor-activation-autofocus="false"]')
      && isUsableEditorActivationTarget(candidate)
    );
    if (target) {
      return target;
    }
  }
  return null;
}

function isUsableEditorActivationTarget(target: HTMLElement): boolean {
  if (target instanceof HTMLInputElement && (target.type === 'hidden' || target.disabled)) {
    return false;
  }
  if ((target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) && target.disabled) {
    return false;
  }
  const rect = target.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function focusEditorActivationTarget(target: HTMLElement, clientX?: number, clientY?: number): void {
  target.focus({ preventScroll: true });
  if (!target.isContentEditable) {
    if (target instanceof HTMLTextAreaElement || isTextSelectionInput(target)) {
      const length = target.value.length;
      target.setSelectionRange(length, length);
    }
    return;
  }
  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  if (typeof clientX === 'number' && typeof clientY === 'number') {
    const range = getCaretRangeFromPoint(clientX, clientY);
    if (range && target.contains(range.startContainer)) {
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
  }
  const range = document.createRange();
  range.selectNodeContents(target);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function isTextSelectionInput(target: HTMLElement): target is HTMLInputElement {
  if (!(target instanceof HTMLInputElement)) {
    return false;
  }
  return ['email', 'number', 'password', 'search', 'tel', 'text', 'url'].includes(target.type);
}

function getCaretRangeFromPoint(clientX: number, clientY: number): Range | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (doc.caretPositionFromPoint) {
    const position = doc.caretPositionFromPoint(clientX, clientY);
    if (!position) {
      return null;
    }
    const range = document.createRange();
    range.setStart(position.offsetNode, position.offset);
    range.collapse(true);
    return range;
  }
  return doc.caretRangeFromPoint?.(clientX, clientY) ?? null;
}
