import { state } from './state';
import type { PaneScrollState } from './types';

export function capturePaneScroll(previous: PaneScrollState, app: HTMLElement): PaneScrollState {
  const editorTree = app.querySelector<HTMLDivElement>('.editor-shell .editor-tree');
  const editorSidebarPanel = app.querySelector<HTMLDivElement>('.editor-sidebar-panel');
  const viewerSidebarPanel = app.querySelector<HTMLDivElement>('.viewer-sidebar-panel');
  const readerPane =
    app.querySelector<HTMLDivElement>('.viewer-shell .reader-document') ??
    app.querySelector<HTMLDivElement>('.reader-pane');
  return {
    editorTop: editorTree?.scrollTop ?? previous.editorTop,
    editorSidebarTop: editorSidebarPanel?.scrollTop ?? previous.editorSidebarTop,
    viewerSidebarTop: viewerSidebarPanel?.scrollTop ?? previous.viewerSidebarTop,
    readerTop: readerPane?.scrollTop ?? previous.readerTop,
    windowTop: window.scrollY,
  };
}

export function restorePaneScroll(scroll: PaneScrollState | null, app: HTMLElement): void {
  if (!scroll || state.pendingEditorCenterSectionKey) {
    return;
  }
  const restore = (): void => {
    const editorTree = app.querySelector<HTMLDivElement>('.editor-shell .editor-tree');
    const editorSidebarPanel = app.querySelector<HTMLDivElement>('.editor-sidebar-panel');
    const viewerSidebarPanel = app.querySelector<HTMLDivElement>('.viewer-sidebar-panel');
    const readerPane =
      app.querySelector<HTMLDivElement>('.viewer-shell .reader-document') ??
      app.querySelector<HTMLDivElement>('.reader-pane');
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
    window.scrollTo({ top: scroll.windowTop, left: 0, behavior: 'auto' });
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
  const fallbackTarget = block.querySelector<HTMLElement>(
    '[contenteditable="true"], textarea, input:not([type="hidden"]), select'
  ) ?? block;
  if (typeof pending.anchorTop === 'number') {
    const editorTree = app.querySelector<HTMLDivElement>('.editor-shell .editor-tree');
    if (editorTree) {
      state.activeEditorBlockReturnScroll = {
        ...state.paneScroll,
        editorTop: editorTree.scrollTop,
        windowTop: window.scrollY,
      };
      const nextTop = fallbackTarget.getBoundingClientRect().top;
      editorTree.scrollTop += nextTop - pending.anchorTop;
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
  return pointedEditable && block.contains(pointedEditable) ? pointedEditable : fallbackTarget;
}

function focusEditorActivationTarget(target: HTMLElement, clientX?: number, clientY?: number): void {
  target.focus({ preventScroll: true });
  if (!target.isContentEditable) {
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
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
