import { state, findSectionByKey, getReusableNameFromSectionKey, applyRichAction, openLinkInlineModal } from './_imports';
import { actionRegistry } from '../actions/registry';
import { openRemoveConfirmationModal } from './remove-confirmation-modal';

const richToolbarSelections = new WeakMap<HTMLElement, Range>();

export function bindClickDispatch(app: HTMLElement): void {
  app.addEventListener('mousedown', (event) => {
    const target = event.target as HTMLElement;
    const actionButton = target.closest<HTMLElement>('[data-action]');
    const richButton = target.closest<HTMLElement>('[data-rich-action]');
    if (richButton) {
      const editable = getRichEditableForButton(app, richButton);
      const selection = window.getSelection();
      if (editable && selection?.rangeCount) {
        const range = selection.getRangeAt(0);
        if (isRangeInside(editable, range)) {
          richToolbarSelections.set(editable, range.cloneRange());
        }
      }
      event.preventDefault();
      return;
    }
    if (actionButton?.dataset.action === 'set-block-align') {
      event.preventDefault();
    }
  });

  app.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;

    if (target.closest('select') || target.closest('input')) {
      return;
    }

    const richButton = target.closest<HTMLElement>('[data-rich-action]');
    if (richButton) {
      event.preventDefault();
      const sectionKey = richButton.dataset.sectionKey;
      const blockId = richButton.dataset.blockId;
      const action = richButton.dataset.richAction;
      if (sectionKey && blockId && action) {
        const editable = getRichEditableForButton(app, richButton);
        if (editable) {
          restoreRichToolbarSelection(editable);
          if (action === 'link') {
            openLinkInlineModal(app, editable);
            return;
          }
          if (!editable.contains(document.activeElement) && !hasSelectionInside(editable)) {
            editable.focus();
          }
          applyRichAction(action, editable);
        }
      }
      return;
    }

    const actionButton = target.closest<HTMLElement>('[data-action]');
    if (!actionButton) {
      return;
    }

    executeActionButton(app, actionButton);
  });
}

function executeActionButton(app: HTMLElement, actionButton: HTMLElement, confirmedRemoveReady = false): void {
  const action = actionButton.dataset.action;
  if (!action) {
    return;
  }

  if (requiresRemoveConfirmation(action) && !confirmedRemoveReady) {
    openRemoveConfirmationModal(() => executeActionButton(app, actionButton, true));
    return;
  }

  const handler = actionRegistry[action];
  if (!handler) {
    return;
  }

  const sectionKey = actionButton.dataset.sectionKey ?? '';
  const blockId = actionButton.dataset.blockId ?? '';

  if (action === 'add-top-level-section') {
    handler({ app, actionButton, sectionKey, blockId, section: null, reusableName: null });
    return;
  }

  if (sectionKey.length === 0) {
    return;
  }

  const reusableName = getReusableNameFromSectionKey(sectionKey);
  const section = reusableName ? null : findSectionByKey(state.document.sections, sectionKey);
  if (!section && !reusableName) {
    return;
  }

  handler({ app, actionButton, sectionKey, blockId, section, reusableName });
}

function hasSelectionInside(editable: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection?.rangeCount) {
    return false;
  }
  const range = selection.getRangeAt(0);
  return isRangeInside(editable, range);
}

function isRangeInside(editable: HTMLElement, range: Range): boolean {
  return editable.contains(range.commonAncestorContainer) || range.commonAncestorContainer === editable;
}

function restoreRichToolbarSelection(editable: HTMLElement): void {
  const range = richToolbarSelections.get(editable);
  if (!range || !isRangeInside(editable, range)) {
    return;
  }
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function getRichEditableForButton(app: HTMLElement, richButton: HTMLElement): HTMLElement | null {
  const sectionKey = richButton.dataset.sectionKey;
  const blockId = richButton.dataset.blockId;
  if (!sectionKey || !blockId) {
    return null;
  }
  const richField = richButton.dataset.richField ?? 'block-rich';
  const gridItemId = richButton.dataset.gridItemId;
  const rowIndex = richButton.dataset.rowIndex;
  const selectorBase = `[data-section-key="${sectionKey}"][data-block-id="${blockId}"][data-field="${richField}"]`;
  return rowIndex
    ? app.querySelector<HTMLElement>(`${selectorBase}[data-row-index="${rowIndex}"]`)
    : gridItemId
    ? app.querySelector<HTMLElement>(`${selectorBase}[data-grid-item-id="${gridItemId}"]`)
    : app.querySelector<HTMLElement>(selectorBase);
}

function requiresRemoveConfirmation(action: string): boolean {
  return new Set([
    'remove-block',
    'remove-section',
    'remove-subsection',
    'remove-grid-item',
    'remove-table-row',
    'remove-table-column',
    'sqlite-drop-column',
    'remove-component-def',
    'remove-section-def',
  ]).has(action);
}
