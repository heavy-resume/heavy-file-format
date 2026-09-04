import {
  pendingLinkRange, pendingLinkEditable, pendingLinkAnchor,
  setPendingLinkRange, setPendingLinkEditable, setPendingLinkAnchor, state,
} from './state';
import { applyRichAction } from './block-ops';
import { refreshLinkAttachmentPicker } from './editor/components/link-attachment-picker/link-attachment-picker';
import { refreshLinkDocumentPicker } from './editor/components/link-document-picker/link-document-picker';
import { isWorkspacePathTarget } from './workspace-links';
import {
  decodeUserFileAttachmentTarget,
  encodeUserFileAttachmentTarget,
  resolveUserFileAttachment,
} from './document-attachments';

type LinkTargetMode = 'web' | 'document' | 'workspace' | 'attachment';

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
      return;
    }
    if (action === 'select-document-target') {
      const option = target.closest<HTMLButtonElement>('[data-link-document-target]');
      if (option?.dataset.linkDocumentTarget) {
        selectLinkTarget(modal, input, option.dataset.linkDocumentTarget, '[data-link-document-target]');
      }
      return;
    }
    if (action === 'select-attachment-target') {
      const option = target.closest<HTMLButtonElement>('[data-link-attachment-target]');
      if (option?.dataset.linkAttachmentTarget) {
        selectLinkTarget(modal, input, option.dataset.linkAttachmentTarget, '[data-link-attachment-target]');
      }
      return;
    }
    const modeButton = target.closest<HTMLButtonElement>('[data-link-target-mode]');
    if (modeButton) {
      const mode = modeButton.dataset.linkTargetMode as LinkTargetMode;
      setLinkTargetMode(modal, mode);
      refreshLinkTargetPicker(modal, input, mode);
      focusLinkTargetMode(modal, input, mode);
      return;
    }
  });

  input.addEventListener('input', () => {
    const mode = modal.dataset.linkTargetMode as LinkTargetMode;
    if (mode === 'attachment') {
      refreshLinkTargetPicker(modal, input, mode);
      updateLinkApplyAvailability(modal, mode, input.value);
    } else if (input.value.trim().startsWith('#')) {
      setLinkTargetMode(modal, 'document');
      refreshLinkTargetPicker(modal, input, 'document');
      focusLinkTargetMode(modal, input, 'document');
    } else if (state?.crossDocumentLinksEnabled && isWorkspacePathTarget(input.value)) {
      setLinkTargetMode(modal, 'workspace');
    }
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && modal.dataset.linkTargetMode === 'attachment') {
      const first = modal.querySelector<HTMLButtonElement>('[data-link-attachment-target]');
      if (first) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
      return;
    }
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

  const documentPicker = modal.querySelector<HTMLElement>('[data-link-document-options="true"]');
  documentPicker?.addEventListener('input', (event) => {
    if (!(event.target as HTMLElement).matches('[data-link-document-search="true"]')) return;
    input.value = '';
    refreshLinkDocumentPicker(documentPicker, state.document);
    updateLinkApplyAvailability(modal, 'document', '');
  });
  documentPicker?.addEventListener('keydown', (event) => {
    if (!(event.target instanceof HTMLInputElement) || event.target.dataset.linkDocumentSearch !== 'true') return;
    const first = documentPicker.querySelector<HTMLButtonElement>('[data-link-document-target]');
    if (event.key === 'ArrowDown' && first) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    } else if (event.key === 'Enter' && first?.dataset.linkDocumentTarget) {
      event.preventDefault();
      selectLinkTarget(modal, input, first.dataset.linkDocumentTarget, '[data-link-document-target]');
    }
  });

  const attachmentPicker = modal.querySelector<HTMLElement>('[data-link-attachment-picker="true"]');
  attachmentPicker?.addEventListener('change', (event) => {
    if ((event.target as HTMLElement).matches('[data-link-attachment-sort="true"]')) {
      refreshLinkAttachmentPicker(attachmentPicker, state.document, input.value);
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
  if ((!selectedRange || selectedRange.collapsed) && !selectedAnchor) {
    return;
  }
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

  const mode = inferLinkTargetMode(linkValue);
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
  input.value = mode === 'attachment' ? decodeUserFileAttachmentTarget(linkValue) ?? '' : linkValue;
  modal.querySelectorAll<HTMLInputElement>('[data-link-document-search]').forEach((search) => { search.value = ''; });
  modal.dataset.linkTargetMode = mode;
  setLinkTargetMode(modal, mode);
  refreshLinkTargetPicker(modal, input, mode);
  window.setTimeout(() => {
    focusLinkTargetMode(modal, input, mode);
  }, 0);
}

function setLinkTargetMode(modal: HTMLElement, mode: LinkTargetMode): void {
  const previousMode = modal.dataset.linkTargetMode as LinkTargetMode | undefined;
  modal.dataset.linkTargetMode = mode;
  modal.querySelectorAll<HTMLButtonElement>('[data-link-target-mode]').forEach((button) => {
    const active = button.dataset.linkTargetMode === mode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  const documentOptions = modal.querySelector<HTMLElement>('[data-link-document-options="true"]');
  const attachmentPicker = modal.querySelector<HTMLElement>('[data-link-attachment-picker="true"]');
  const inputWrap = modal.querySelector<HTMLElement>('.link-target-input-wrap');
  if (documentOptions) documentOptions.hidden = mode !== 'document';
  if (attachmentPicker) attachmentPicker.hidden = mode !== 'attachment';
  if (inputWrap) inputWrap.hidden = mode === 'document';
  const label = modal.querySelector<HTMLElement>('[data-link-target-input-label="true"]');
  const input = modal.querySelector<HTMLInputElement>('#linkInlineInput');
  if (input && (
    (previousMode !== mode && (previousMode === 'attachment' || mode === 'attachment'))
    || !isLinkValueCompatibleWithMode(input.value, mode)
  )) input.value = '';
  if (label) label.textContent = mode === 'workspace'
    ? 'Workspace file path'
    : mode === 'attachment'
      ? 'Attachment name'
      : 'Web address';
  if (input) input.placeholder = mode === 'workspace'
    ? './notes.hvy, ../folder/document.hvy, or /workspace/document.hvy'
    : mode === 'attachment'
      ? 'Search by name or filename'
      : 'https://... or mailto:...';
  updateLinkApplyAvailability(modal, mode, input?.value ?? '');
}

function inferLinkTargetMode(value: string): LinkTargetMode {
  if (value.startsWith('@attachment:')) return 'attachment';
  if (value.startsWith('#')) return 'document';
  if (state?.crossDocumentLinksEnabled && isWorkspacePathTarget(value)) return 'workspace';
  return 'web';
}

function selectLinkTarget(modal: HTMLElement, input: HTMLInputElement, target: string, optionSelector: string): void {
  const mode = modal.dataset.linkTargetMode as LinkTargetMode;
  input.value = mode === 'attachment' ? decodeUserFileAttachmentTarget(target) ?? '' : target;
  if (mode === 'attachment') {
    refreshLinkTargetPicker(modal, input, mode);
  }
  modal.querySelectorAll<HTMLElement>(optionSelector).forEach((option) => {
    const optionTarget = option.dataset.linkAttachmentTarget ?? option.dataset.linkDocumentTarget;
    option.classList.toggle('is-selected', optionTarget === target);
  });
  updateLinkApplyAvailability(modal, mode, input.value);
  const selected = Array.from(modal.querySelectorAll<HTMLElement>(optionSelector)).find((option) => option.classList.contains('is-selected'));
  selected?.focus({ preventScroll: true });
}

function refreshLinkTargetPicker(modal: HTMLElement, input: HTMLInputElement, mode: LinkTargetMode): void {
  if (!state?.document) return;
  if (mode === 'document') {
    const picker = modal.querySelector<HTMLElement>('[data-link-document-options="true"]');
    if (picker) refreshLinkDocumentPicker(picker, state.document, input.value);
  } else if (mode === 'attachment') {
    const picker = modal.querySelector<HTMLElement>('[data-link-attachment-picker="true"]');
    if (picker) refreshLinkAttachmentPicker(picker, state.document, input.value);
  }
}

function focusLinkTargetMode(modal: HTMLElement, input: HTMLInputElement, mode: LinkTargetMode): void {
  const target = mode === 'document'
    ? modal.querySelector<HTMLInputElement>('[data-link-document-search="true"]')
    : input;
  target?.focus({ preventScroll: true });
  target?.select();
}

function isLinkValueCompatibleWithMode(value: string, mode: LinkTargetMode): boolean {
  if (!value) return true;
  if (mode === 'document') return value.startsWith('#');
  if (mode === 'attachment') return !value.startsWith('#') && !isWorkspacePathTarget(value) && !/^https?:\/\//i.test(value);
  if (mode === 'workspace') return isWorkspacePathTarget(value);
  return !value.startsWith('#') && !value.startsWith('@attachment:') && !isWorkspacePathTarget(value);
}

function updateLinkApplyAvailability(modal: HTMLElement, mode: LinkTargetMode, value: string): void {
  const apply = modal.querySelector<HTMLButtonElement>('[data-link-modal-action="apply"]');
  if (!apply) return;
  apply.disabled = (mode === 'document' && !value.startsWith('#'))
    || (mode === 'attachment' && resolveUserFileAttachment(state.document, value).status !== 'resolved');
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
  const mode = input.closest<HTMLElement>('#linkInlineModal')?.dataset.linkTargetMode as LinkTargetMode | undefined;
  const attachment = mode === 'attachment' ? resolveUserFileAttachment(state.document, input.value) : null;
  if (mode === 'attachment' && attachment?.status !== 'resolved') {
    return;
  }
  const value = attachment?.status === 'resolved'
    ? encodeUserFileAttachmentTarget(attachment.attachment.name)
    : normalizeLinkInputValue(input.value);
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
  if (isWebAddressWithoutProtocol(trimmed)) {
    return `https://${trimmed}`;
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

function isWebAddressWithoutProtocol(value: string): boolean {
  if (!value || /\s/.test(value) || /^[a-z][a-z\d+.-]*:/i.test(value)) {
    return false;
  }
  try {
    const url = new URL(`https://${value}`);
    return url.hostname.includes('.')
      && url.hostname.split('.').every((label) => /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label));
  } catch {
    return false;
  }
}
