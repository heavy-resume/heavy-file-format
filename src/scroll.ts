import { state } from './state';
import type { PaneScrollState } from './types';

export function capturePaneScroll(previous: PaneScrollState, app: HTMLElement): PaneScrollState {
  const editorPane = app.querySelector<HTMLDivElement>('.editor-pane');
  const readerPane = app.querySelector<HTMLDivElement>('.reader-pane');
  return {
    editorTop: editorPane?.scrollTop ?? previous.editorTop,
    readerTop: readerPane?.scrollTop ?? previous.readerTop,
    windowTop: window.scrollY,
  };
}

export function restorePaneScroll(scroll: PaneScrollState | null, app: HTMLElement): void {
  if (!scroll || state.pendingEditorCenterSectionKey) {
    return;
  }
  const restore = (): void => {
    const editorPane = app.querySelector<HTMLDivElement>('.editor-pane');
    const readerPane = app.querySelector<HTMLDivElement>('.reader-pane');
    if (editorPane) {
      editorPane.scrollTop = scroll.editorTop;
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
  window.requestAnimationFrame(() => {
    const sectionEl = app.querySelector<HTMLElement>(`[data-editor-section="${sectionKey}"]`);
    if (!sectionEl) {
      return;
    }
    sectionEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
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
