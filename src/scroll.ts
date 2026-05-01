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
  const pathLength = app.querySelectorAll<HTMLElement>('.editor-block.is-activating-path').length;
  const delayMs = Math.max(0, (pathLength - 1) * 150 + 190);
  window.setTimeout(() => {
    const current = state.pendingEditorActivation;
    if (!current || current.sectionKey !== pending.sectionKey || current.blockId !== pending.blockId) {
      return;
    }
    const block = app.querySelector<HTMLElement>(
      `.editor-block[data-active-editor-block="true"][data-active-block-id="${CSS.escape(pending.blockId)}"]`
    );
    const target = block?.querySelector<HTMLElement>(
      '[contenteditable="true"], textarea, input:not([type="hidden"]), select, button'
    ) ?? block;
    if (!target) {
      state.pendingEditorActivation = null;
      return;
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    state.pendingEditorActivation = null;
  }, delayMs);
}
