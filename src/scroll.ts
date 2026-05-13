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

export function captureEditorDeactivationAnchor(
  app: HTMLElement,
  sectionKey: string,
  blockId: string
): NonNullable<typeof state.pendingEditorDeactivation> | null {
  const block = app.querySelector<HTMLElement>(
    `.editor-block[data-active-editor-block="true"][data-active-block-id="${CSS.escape(blockId)}"]`
  );
  const target = block ? getPrimaryEditorActivationTarget(block) : null;
  if (!target) {
    return null;
  }
  return {
    sectionKey,
    blockId,
    anchorTop: target.getBoundingClientRect().top,
    editableTag: target.tagName.toLowerCase(),
    editableClass: target.className,
  };
}

export function scrollPendingEditorDeactivation(app: HTMLElement): void {
  const pending = state.pendingEditorDeactivation;
  if (!pending) {
    return;
  }
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      const current = state.pendingEditorDeactivation;
      if (!current || current.sectionKey !== pending.sectionKey || current.blockId !== pending.blockId) {
        return;
      }
      applyPendingEditorDeactivationScroll(app, pending);
    });
  });
}

function applyPendingEditorDeactivationScroll(
  app: HTMLElement,
  pending: NonNullable<typeof state.pendingEditorDeactivation>
): void {
  state.pendingEditorDeactivation = null;
  const editorTree = app.querySelector<HTMLDivElement>('.editor-shell .editor-tree');
  const passiveBlock = app.querySelector<HTMLElement>(
    `.editor-block-passive[data-section-key="${CSS.escape(pending.sectionKey)}"][data-block-id="${CSS.escape(pending.blockId)}"]`
  );
  const passiveContent = passiveBlock?.querySelector<HTMLElement>('.reader-block') ?? null;
  const passiveAnchor = passiveContent ? getFirstTextAnchor(passiveContent) : null;
  if (!editorTree || !passiveBlock || !passiveAnchor) {
    return;
  }
  const pulledUpBy = pending.anchorTop - passiveAnchor.top;
  if (pulledUpBy > 0) {
    editorTree.scrollTop = Math.max(0, editorTree.scrollTop - pulledUpBy);
  }
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
  if (typeof pending.anchorTop === 'number') {
    const editorTree = app.querySelector<HTMLDivElement>('.editor-shell .editor-tree');
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
    const target = Array.from(block.querySelectorAll<HTMLElement>(selector)).find(isUsableEditorActivationTarget);
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

type TextAnchor = {
  top: number;
  parentTag: string | null;
  parentClass: string | null;
  textPreview: string;
};

function getFirstTextAnchor(root: HTMLElement): TextAnchor | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const text = node.textContent ?? '';
    const firstTextIndex = text.search(/\S/);
    if (firstTextIndex >= 0) {
      const range = document.createRange();
      range.setStart(node, firstTextIndex);
      range.setEnd(node, text.length);
      const rect = range.getClientRects()[0];
      range.detach();
      if (rect) {
        const parent = node.parentElement;
        return {
          top: rect.top,
          parentTag: parent?.tagName.toLowerCase() ?? null,
          parentClass: parent?.className ?? null,
          textPreview: text.slice(firstTextIndex).replace(/\s+/g, ' ').trim().slice(0, 80),
        };
      }
    }
    node = walker.nextNode();
  }
  return null;
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
