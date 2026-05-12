import { state, findSectionByKey, getReusableNameFromSectionKey, applyRichAction, openLinkInlineModal, getRenderApp } from './_imports';
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
    if (actionButton && isParagraphStylePickerAction(actionButton.dataset.action ?? '')) {
      const toolbar = actionButton.closest<HTMLElement>('.paragraph-style-toolbar');
      const editable = toolbar ? getRichEditableForButton(app, toolbar) : null;
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
    const actionButton = target.closest<HTMLElement>('[data-action]');

    if (state.componentPlacement && !isPlacementModeAction(actionButton?.dataset.action ?? '')) {
      state.componentPlacement = null;
      event.preventDefault();
      event.stopPropagation();
      getRenderApp()();
      return;
    }

    if (target.closest('select') || target.closest('input')) {
      return;
    }

    const richButton = target.closest<HTMLElement>('[data-rich-action]');
    if (richButton) {
      event.preventDefault();
      richButton.closest<HTMLElement>('.paragraph-style-toolbar')?.classList.remove('is-picker-open');
      richButton.closest<HTMLElement>('.paragraph-style-toolbar')?.querySelector<HTMLButtonElement>('[data-action="open-paragraph-style-picker"]')?.setAttribute('aria-expanded', 'false');
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
          applyRichAction(action, editable, richButton.dataset.textLineStyleName);
        }
      }
      return;
    }

    if (!actionButton) {
      return;
    }

    if (actionButton.dataset.action === 'open-paragraph-style-picker') {
      event.preventDefault();
      const toolbar = actionButton.closest<HTMLElement>('.paragraph-style-toolbar');
      const isOpen = toolbar?.classList.toggle('is-picker-open') ?? false;
      actionButton.setAttribute('aria-expanded', String(isOpen));
      return;
    }

    if (actionButton.dataset.action === 'close-paragraph-style-picker') {
      event.preventDefault();
      const toolbar = actionButton.closest<HTMLElement>('.paragraph-style-toolbar');
      toolbar?.classList.remove('is-picker-open');
      toolbar?.querySelector<HTMLButtonElement>('[data-action="open-paragraph-style-picker"]')?.setAttribute('aria-expanded', 'false');
      return;
    }

    if (isComponentPickerAction(actionButton)) {
      console.log('[hvy:component-picker]', {
        stage: 'dispatch:click',
        action: actionButton.dataset.action ?? '',
        component: actionButton.dataset.component ?? '',
        pluginId: actionButton.dataset.pluginId ?? '',
        sectionKey: actionButton.dataset.sectionKey ?? '',
        blockId: actionButton.dataset.blockId ?? '',
        insertPlacement: actionButton.dataset.insertPlacement ?? '',
        targetBlockId: actionButton.dataset.targetBlockId ?? '',
        pickerOpen: actionButton.closest<HTMLElement>('.component-picker')?.dataset.open ?? '',
        pickerPane: actionButton.closest<HTMLElement>('.component-picker')?.dataset.activePane ?? '',
      });
    }
    executeActionButton(app, actionButton);
  });
}

function isParagraphStylePickerAction(action: string): boolean {
  return action === 'open-paragraph-style-picker' || action === 'close-paragraph-style-picker';
}

function isComponentPickerAction(actionButton: HTMLElement): boolean {
  return actionButton.classList.contains('component-picker-row') || actionButton.closest('.component-picker') !== null;
}

function isPlacementModeAction(action: string): boolean {
  return action === 'place-component' || action === 'cancel-component-placement';
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

  const sectionKey = getActionSectionKey(actionButton);
  const blockId = actionButton.dataset.blockId ?? '';

  if (action === 'add-top-level-section') {
    handler({ app, actionButton, sectionKey, blockId, section: null, reusableName: null });
    return;
  }

  if (sectionKey.length === 0) {
    if (isComponentPickerAction(actionButton)) {
      console.log('[hvy:component-picker]', {
        stage: 'dispatch:bail',
        reason: 'missing-section-key',
        action,
        component: actionButton.dataset.component ?? '',
      });
    }
    return;
  }

  const reusableName = getReusableNameFromSectionKey(sectionKey);
  const section = reusableName ? null : findSectionByKey(state.document.sections, sectionKey);
  if (!section && !reusableName) {
    if (isComponentPickerAction(actionButton)) {
      console.log('[hvy:component-picker]', {
        stage: 'dispatch:bail',
        reason: 'section-not-found',
        action,
        component: actionButton.dataset.component ?? '',
        sectionKey,
      });
    }
    return;
  }

  handler({ app, actionButton, sectionKey, blockId, section, reusableName });
}

function getActionSectionKey(actionButton: HTMLElement): string {
  const declaredSectionKey = actionButton.dataset.sectionKey ?? '';
  if (actionButton.dataset.action === 'add-block' && actionButton.dataset.insertPlacement) {
    const nearestEditorSection = actionButton.closest<HTMLElement>('[data-editor-section]')?.dataset.editorSection ?? '';
    if (nearestEditorSection && nearestEditorSection !== declaredSectionKey) {
      console.log('[hvy:component-picker]', {
        stage: 'dispatch:section-key-corrected',
        declaredSectionKey,
        nearestEditorSection,
        component: actionButton.dataset.component ?? '',
        insertPlacement: actionButton.dataset.insertPlacement ?? '',
        targetBlockId: actionButton.dataset.targetBlockId ?? '',
      });
      return nearestEditorSection;
    }
  }
  return declaredSectionKey;
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
  const columnIndex = richButton.dataset.columnIndex;
  const cellIndex = richButton.dataset.cellIndex;
  const selectorBase = `[data-section-key="${sectionKey}"][data-block-id="${blockId}"][data-field="${richField}"]`;
  return richField === 'table-column' && columnIndex !== undefined
    ? app.querySelector<HTMLElement>(`${selectorBase}[data-column-index="${columnIndex}"]`)
    : richField === 'table-cell' && rowIndex !== undefined && cellIndex !== undefined
    ? app.querySelector<HTMLElement>(`${selectorBase}[data-row-index="${rowIndex}"][data-cell-index="${cellIndex}"]`)
    : rowIndex
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
