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

  setPendingLinkEditable(editable);
  setPendingLinkAnchor(anchor ?? null);
  if (range) {
    setPendingLinkRange(range.cloneRange());
  } else {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      setPendingLinkRange(selection.getRangeAt(0).cloneRange());
    } else {
      setPendingLinkRange(null);
    }
  }

  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
  input.value = initialValue;
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
  const value = input.value.trim();
  if (!value) {
    closeLinkInlineModal(app);
    return;
  }
  const link = value.startsWith('#') ? value : value;
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
