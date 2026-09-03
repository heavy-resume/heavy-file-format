import { state, getRenderApp, closeAiEditPopover, completePendingRichAnnotation, handleRichEditorClick, handleRichEditorPointerDown, refreshRichToolbarState } from './_imports';
import { applyInlineAnswerTypeChoice } from '../../block-ops';
import { dismissSidebarHelpBalloon } from '../../sidebar-help';
import { closeReaderContextPopover } from './contextmenu';
import { logClickTrace } from '../click-trace';
import { componentSortValueDetailsKey, templateDefinitionDetailsKey } from '../../editor/render';

const pointerHandledPickerTriggers = new WeakSet<HTMLElement>();

export function bindClickMisc(app: HTMLElement): void {
  document.addEventListener('selectionchange', () => {
    refreshSelectionDrivenRichToolbarState(app);
  });

  app.addEventListener('toggle', (event) => {
    const sortValueDetails = event.target instanceof HTMLElement
      ? event.target.closest<HTMLDetailsElement>('details.component-sort-value-details[data-def-index][data-sort-value-name]')
      : null;
    if (sortValueDetails && app.contains(sortValueDetails)) {
      const defIndex = Number.parseInt(sortValueDetails.dataset.defIndex ?? '', 10);
      const name = sortValueDetails.dataset.sortValueName ?? '';
      if (!Number.isNaN(defIndex) && name) {
        updateOpenTemplateDefinitionKey(componentSortValueDetailsKey(defIndex, name), sortValueDetails.open);
      }
      return;
    }
    const details = event.target instanceof HTMLElement
      ? event.target.closest<HTMLDetailsElement>('details.template-def-details[data-template-kind]')
      : null;
    if (!details || !app.contains(details)) {
      return;
    }
    const kind = details.dataset.templateKind === 'section' ? 'section' : details.dataset.templateKind === 'component' ? 'component' : null;
    const index = Number.parseInt(details.dataset.defIndex ?? details.dataset.sectionDefIndex ?? '', 10);
    if (!kind || Number.isNaN(index)) {
      return;
    }
    const key = templateDefinitionDetailsKey(kind, index);
    updateOpenTemplateDefinitionKey(key, details.open);
  }, true);

  app.addEventListener('mousedown', (event) => {
    const target = event.target as HTMLElement;
    const richTarget = getRichTarget(target);
    if (richTarget && handleRichEditorPointerDown(event, richTarget)) return;
    const pickerTrigger = target.closest<HTMLElement>('.component-picker-trigger');
    if (!pickerTrigger) {
      const activeInsertGhost = target.closest<HTMLElement>('.active-component-insert-ghost');
      if (activeInsertGhost && !target.closest('.component-picker')) {
        const ghostPickerTrigger = activeInsertGhost.querySelector<HTMLElement>('.component-picker-trigger');
        if (ghostPickerTrigger) {
          event.preventDefault();
          pointerHandledPickerTriggers.add(ghostPickerTrigger);
          toggleComponentPicker(app, ghostPickerTrigger);
        }
      }
      return;
    }
    event.preventDefault();
    pointerHandledPickerTriggers.add(pickerTrigger);
    toggleComponentPicker(app, pickerTrigger);
  });

  app.addEventListener('mouseup', (event) => {
    const richTarget = getRichTarget(event.target as HTMLElement);
    if (richTarget) {
      completePendingRichAnnotation(richTarget);
      refreshRichToolbarState(richTarget);
    }
  });

  app.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    logClickTrace(event, 'click-misc:enter');
    if (handleInlineAnswerTypePopoverClick(event, target)) {
      return;
    }
    const richTarget = getRichTarget(target);
    if (richTarget) {
      logClickTrace(event, 'click-misc:handled:rich-editor-click');
      handleRichEditorClick(event, richTarget);
    }
    const pickerTrigger = target.closest<HTMLElement>('.component-picker-trigger');
    if (pickerTrigger) {
      if (pointerHandledPickerTriggers.has(pickerTrigger)) {
        pointerHandledPickerTriggers.delete(pickerTrigger);
        logClickTrace(event, 'click-misc:skip', {
          skipReason: 'picker-trigger-handled-by-mousedown',
        });
        return;
      }
      logClickTrace(event, 'click-misc:handled:component-picker-trigger');
      toggleComponentPicker(app, pickerTrigger);
      return;
    }
    const pickerPaneButton = target.closest<HTMLElement>('[data-component-picker-pane]');
    if (pickerPaneButton) {
      event.preventDefault();
      logClickTrace(event, 'click-misc:handled:component-picker-pane', {
        pane: pickerPaneButton.dataset.componentPickerPane ?? null,
      });
      const picker = pickerPaneButton.closest<HTMLElement>('.component-picker');
      if (picker) {
        picker.dataset.open = 'true';
        picker.dataset.activePane = pickerPaneButton.dataset.componentPickerPane ?? 'root';
        revealComponentPicker(picker);
      }
      return;
    }
    const pickerRootPane = target.closest<HTMLElement>('.component-picker-pane-root');
    if (pickerRootPane && target === pickerRootPane) {
      logClickTrace(event, 'click-misc:handled:component-picker-root-pane');
      const picker = pickerRootPane.closest<HTMLElement>('.component-picker');
      if (picker) {
        delete picker.dataset.open;
        picker.dataset.activePane = 'root';
        picker.style.removeProperty('--component-picker-shift');
      }
      return;
    }
    if (target.closest('.active-component-insert-ghost') && !target.closest('.component-picker')) {
      logClickTrace(event, 'click-misc:skip', {
        skipReason: 'active-component-insert-ghost',
      });
      return;
    }
    if (!target.closest('.component-picker')) {
      logClickTrace(event, 'click-misc:cleanup:close-other-component-pickers');
      closeOtherComponentPickers(app);
    }
    if (target.closest('.hvy-context-popover')) {
      logClickTrace(event, 'click-misc:skip', {
        skipReason: 'inside-context-popover',
      });
      return;
    }
    if (state.contextMenu && !target.closest('.hvy-context-popover')) {
      logClickTrace(event, 'click-misc:handled:close-context-popover');
      closeReaderContextPopover(app);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (target.closest('.editor-sidebar-help-balloon')) {
      logClickTrace(event, 'click-misc:handled:dismiss-editor-sidebar-help');
      dismissSidebarHelpBalloon(app, 'editor');
      return;
    }
    if (target.closest('.viewer-sidebar-help-balloon')) {
      logClickTrace(event, 'click-misc:handled:dismiss-viewer-sidebar-help');
      dismissSidebarHelpBalloon(app, 'viewer');
      return;
    }
    if (!state.aiEdit.sectionKey || !state.aiEdit.blockId) {
      logClickTrace(event, 'click-misc:skip', {
        skipReason: 'no-ai-edit-popover',
      });
      return;
    }
    if (target.closest('.ai-edit-popover')) {
      logClickTrace(event, 'click-misc:skip', {
        skipReason: 'inside-ai-edit-popover',
      });
      return;
    }
    logClickTrace(event, 'click-misc:handled:close-ai-edit-popover', {
      sectionKey: state.aiEdit.sectionKey,
      blockId: state.aiEdit.blockId,
    });
    closeAiEditPopover();
    getRenderApp()();
  });
}

function updateOpenTemplateDefinitionKey(key: string, open: boolean): void {
  const openKeys = new Set(state.openTemplateDefinitionKeys);
  if (open) {
    openKeys.add(key);
  } else {
    openKeys.delete(key);
  }
  state.openTemplateDefinitionKeys = [...openKeys];
}

function toggleComponentPicker(app: HTMLElement, pickerTrigger: HTMLElement): void {
  const picker = pickerTrigger.closest<HTMLElement>('.component-picker');
  if (!picker) {
    return;
  }
  if (picker.dataset.open === 'true' && picker.dataset.activePane === 'root') {
    delete picker.dataset.open;
    picker.dataset.activePane = 'root';
    picker.style.removeProperty('--component-picker-shift');
    pickerTrigger.blur();
    return;
  }
  closeOtherComponentPickers(app, picker);
  picker.dataset.open = 'true';
  picker.dataset.activePane = 'root';
  placeComponentPicker(picker);
  revealComponentPicker(picker);
}

function refreshSelectionDrivenRichToolbarState(app: HTMLElement): void {
  const richTarget = getRichTargetFromSelection(app);
  app.querySelectorAll<HTMLElement>('.text-editor-shell.has-fill-in-selection').forEach((shell) => {
    if (!richTarget || !shell.contains(richTarget)) {
      shell.classList.remove('has-fill-in-selection');
    }
  });
  if (richTarget && hasNonEmptySelection()) {
    refreshRichToolbarState(richTarget);
  }
}

function hasNonEmptySelection(): boolean {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) {
    return false;
  }
  return selection.getRangeAt(0).toString().trim().length > 0;
}

function getRichTargetFromSelection(app: HTMLElement): HTMLElement | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const element = node instanceof HTMLElement ? node : node.parentElement;
  const target = element ? getRichTarget(element) : null;
  return target && app.contains(target) ? target : null;
}

function getRichTarget(target: HTMLElement): HTMLElement | null {
  return target.dataset.field === 'block-rich' ||
    target.dataset.field === 'block-grid-rich' ||
    target.dataset.field === 'table-details-rich' ||
    target.dataset.field === 'caption-rich' ||
    target.dataset.field === 'table-column' ||
    target.dataset.field === 'table-cell'
    ? target
    : target.closest<HTMLElement>(
        '[data-field="block-rich"], [data-field="block-grid-rich"], [data-field="table-details-rich"], [data-field="caption-rich"], [data-field="table-column"], [data-field="table-cell"]'
      );
}

function closeOtherComponentPickers(app: HTMLElement, except?: HTMLElement): void {
  app.querySelectorAll<HTMLElement>('.component-picker[data-open="true"]').forEach((picker) => {
    if (picker !== except) {
      delete picker.dataset.open;
      picker.dataset.activePane = 'root';
      picker.style.removeProperty('--component-picker-shift');
    }
  });
}

function revealComponentPicker(picker: HTMLElement): void {
  requestAnimationFrame(() => {
    placeComponentPicker(picker);
  });
}

function placeComponentPicker(picker: HTMLElement): void {
  const popover = picker.querySelector<HTMLElement>('.component-picker-popover');
  if (!popover) {
    return;
  }
  picker.style.removeProperty('--component-picker-shift');
  picker.style.removeProperty('--component-picker-shift-y');
  const padding = 8;
  const rect = popover.getBoundingClientRect();
  const scrollSurface = picker.closest<HTMLElement>('.editor-tree, .editor-sidebar-panel');
  const surfaceRect = scrollSurface?.getBoundingClientRect();
  const leftEdge = Math.max(padding, surfaceRect?.left ?? padding);
  const rightEdge = Math.min(window.innerWidth - padding, surfaceRect?.right ?? window.innerWidth - padding);
  const topEdge = Math.max(padding, surfaceRect?.top ?? padding);
  const bottomEdge = Math.min(window.innerHeight - padding, surfaceRect?.bottom ?? window.innerHeight - padding);
  const overflowLeft = leftEdge - rect.left;
  const overflowRight = rect.right - rightEdge;
  const overflowTop = topEdge - rect.top;
  const overflowBottom = rect.bottom - bottomEdge;
  if (overflowLeft > 0) {
    picker.style.setProperty('--component-picker-shift', `${overflowLeft}px`);
  } else if (overflowRight > 0) {
    picker.style.setProperty('--component-picker-shift', `${-overflowRight}px`);
  }
  if (overflowTop > 0) {
    picker.style.setProperty('--component-picker-shift-y', `${overflowTop}px`);
  } else if (overflowBottom > 0) {
    picker.style.setProperty('--component-picker-shift-y', `${-overflowBottom}px`);
  }
}

/**
 * The answer-type popover picks the marker type and radio group for the selected run.
 * It lives inside the editor shell, so it has to claim its own clicks before the rich
 * editor treats them as caret movement.
 */
function handleInlineAnswerTypePopoverClick(event: MouseEvent, target: HTMLElement): boolean {
  const control = target.closest<HTMLElement>('.hvy-choice-mode-switch');
  if (!control) {
    return false;
  }
  const typeOption = target.closest<HTMLElement>('[data-field="inline-answer-type"]');
  if (typeOption) {
    event.preventDefault();
    logClickTrace(event, 'click-misc:handled:inline-answer-type');
    applyInlineAnswerTypeChoice(control, {
      radio: typeOption.dataset.answerType === 'radio',
      groupName: typeOption.dataset.answerGroupName ?? null,
    });
    return true;
  }
  if (target.closest<HTMLElement>('[data-field="inline-answer-new-group"]')) {
    event.preventDefault();
    logClickTrace(event, 'click-misc:handled:inline-answer-new-group');
    const form = control.querySelector<HTMLFormElement>('.choice-mode-name-form');
    if (form) {
      form.hidden = false;
      const input = form.querySelector<HTMLInputElement>('.choice-mode-name-input');
      if (input) {
        input.value = '';
        input.focus();
      }
    }
    return true;
  }
  if (target.closest<HTMLElement>('.choice-mode-name-cancel')) {
    event.preventDefault();
    logClickTrace(event, 'click-misc:handled:inline-answer-group-name-cancel');
    const form = control.querySelector<HTMLFormElement>('.choice-mode-name-form');
    if (form) form.hidden = true;
    return true;
  }
  if (target.closest<HTMLElement>('button[type="submit"], .choice-mode-name-input')) {
    // Let the name form submit and keep the caret in its own input.
    return true;
  }
  // Clicks on the popover chrome must not move the caret out of the answer run.
  event.preventDefault();
  return true;
}
