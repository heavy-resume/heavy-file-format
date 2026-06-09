import {
  pendingLinkRange, pendingLinkEditable, pendingLinkAnchor,
  setPendingLinkRange, setPendingLinkEditable, setPendingLinkAnchor,
} from './state';
import { applyRichAction } from './block-ops';

export function bindLinkInlineModal(app: HTMLElement): void {
  const modal = app.querySelector<HTMLDivElement>('#linkInlineModal');
  const input = app.querySelector<HTMLInputElement>('#linkInlineInput');
  if (!modal || !input) {
    return;
  }

  modal.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const action = target.dataset.linkModalAction ?? target.closest<HTMLElement>('[data-link-modal-action]')?.dataset.linkModalAction;
    if (action === 'cancel') {
      closeLinkInlineModal(app);
      return;
    }
    if (action === 'apply') {
      applyInlineLinkFromModal(app);
    }
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      applyInlineLinkFromModal(app);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeLinkInlineModal(app);
    }
  });
}

export function openLinkInlineModal(
  app: HTMLElement,
  editable: HTMLElement,
  initialValue = '',
  range?: Range | null,
  anchor?: HTMLAnchorElement | null
): void {
  const modal = app.querySelector<HTMLDivElement>('#linkInlineModal');
  const input = app.querySelector<HTMLInputElement>('#linkInlineInput');
  if (!modal || !input) {
    return;
  }

  const selection = window.getSelection();
  const selectedRange = range ?? (selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null);
  const selectedAnchor = anchor ?? findLinkAnchorForRange(editable, selectedRange);
  const linkValue = normalizeLinkInputValue(
    initialValue || selectedAnchor?.getAttribute('href') || inferLinkValueFromRange(selectedRange) || ''
  );

  setPendingLinkEditable(editable);
  setPendingLinkAnchor(selectedAnchor ?? null);
  if (range) {
    setPendingLinkRange(range.cloneRange());
  } else if (selectedAnchor && selectedRange?.collapsed) {
    const anchorRange = document.createRange();
    anchorRange.selectNodeContents(selectedAnchor);
    setPendingLinkRange(anchorRange);
  } else {
    if (selectedRange) {
      setPendingLinkRange(selectedRange.cloneRange());
    } else {
      setPendingLinkRange(null);
    }
  }

  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
  input.value = linkValue;
  window.setTimeout(() => {
    input.focus();
    input.select();
  }, 0);
}

export function closeLinkInlineModal(app: HTMLElement): void {
  const modal = app.querySelector<HTMLDivElement>('#linkInlineModal');
  if (modal) {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
  }
  setPendingLinkRange(null);
  setPendingLinkEditable(null);
  setPendingLinkAnchor(null);
}

function applyInlineLinkFromModal(app: HTMLElement): void {
  const input = app.querySelector<HTMLInputElement>('#linkInlineInput');
  if (!input || !pendingLinkEditable) {
    closeLinkInlineModal(app);
    return;
  }
  const value = normalizeLinkInputValue(input.value);
  if (!value) {
    pendingLinkEditable.focus();
    if (pendingLinkAnchor && pendingLinkEditable.contains(pendingLinkAnchor)) {
      unwrapLinkAnchor(pendingLinkAnchor);
      const inputEvent = new InputEvent('input', { bubbles: true });
      pendingLinkEditable.dispatchEvent(inputEvent);
    }
    closeLinkInlineModal(app);
    return;
  }
  const link = value;
  pendingLinkEditable.focus();
  if (pendingLinkAnchor && pendingLinkEditable.contains(pendingLinkAnchor)) {
    pendingLinkAnchor.setAttribute('href', link);
    const inputEvent = new InputEvent('input', { bubbles: true });
    pendingLinkEditable.dispatchEvent(inputEvent);
    closeLinkInlineModal(app);
    return;
  }
  if (pendingLinkRange) {
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(pendingLinkRange);
    }
  }
  applyRichAction('link', pendingLinkEditable, link);
  closeLinkInlineModal(app);
}

function unwrapLinkAnchor(anchor: HTMLAnchorElement): void {
  const firstChild = anchor.firstChild;
  const lastChild = anchor.lastChild;
  const fragment = document.createDocumentFragment();
  while (anchor.firstChild) {
    fragment.appendChild(anchor.firstChild);
  }
  anchor.replaceWith(fragment);
  if (!firstChild || !lastChild) {
    return;
  }
  const range = document.createRange();
  range.setStartBefore(firstChild);
  range.setEndAfter(lastChild);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function findLinkAnchorForRange(editable: HTMLElement, range: Range | null): HTMLAnchorElement | null {
  if (!range) {
    return null;
  }
  const startAnchor = findClosestEditableAnchor(editable, range.startContainer);
  if (startAnchor) {
    return startAnchor;
  }
  const endAnchor = findClosestEditableAnchor(editable, range.endContainer);
  if (endAnchor) {
    return endAnchor;
  }
  const ancestor = range.commonAncestorContainer;
  if (ancestor instanceof HTMLAnchorElement && editable.contains(ancestor)) {
    return ancestor;
  }
  if (ancestor instanceof Element) {
    const anchor = ancestor.querySelector<HTMLAnchorElement>('a');
    return anchor && editable.contains(anchor) && range.intersectsNode(anchor) ? anchor : null;
  }
  return null;
}

function findClosestEditableAnchor(editable: HTMLElement, node: Node): HTMLAnchorElement | null {
  const element = node instanceof Element ? node : node.parentNode instanceof Element ? node.parentNode : null;
  const anchor = element?.closest<HTMLAnchorElement>('a') ?? null;
  return anchor && editable.contains(anchor) ? anchor : null;
}

function inferLinkValueFromRange(range: Range | null): string {
  if (!range || range.collapsed) {
    return '';
  }
  const linkValue = normalizeLinkInputValue(range.toString());
  return isLinkInputValue(linkValue) ? linkValue : '';
}

function normalizeLinkInputValue(value: string): string {
  const trimmed = value.trim();
  if (/^mailto:/i.test(trimmed)) {
    return trimmed;
  }
  if (isEmailAddress(trimmed)) {
    return `mailto:${trimmed}`;
  }
  return trimmed;
}

function isLinkInputValue(value: string): boolean {
  if (/^mailto:/i.test(value) || /^#/i.test(value)) {
    return true;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isEmailAddress(value: string): boolean {
  return /^[^\s:@<>()[\]]+@[^\s:@<>()[\]]+\.[^\s:@<>()[\]]+$/.test(value);
}
