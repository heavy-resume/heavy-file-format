import { state, getRenderApp, closeAiEditPopover, completePendingRichAnnotation, handleRichEditorClick, refreshRichToolbarState } from './_imports';
import { dismissSidebarHelpBalloon } from '../../sidebar-help';
import { closeReaderContextPopover } from './contextmenu';
import { logClickTrace } from '../click-trace';

const pointerHandledPickerTriggers = new WeakSet<HTMLElement>();

export function bindClickMisc(app: HTMLElement): void {
  app.addEventListener('mousedown', (event) => {
    const target = event.target as HTMLElement;
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

function getRichTarget(target: HTMLElement): HTMLElement | null {
  return target.dataset.field === 'block-rich' ||
    target.dataset.field === 'block-grid-rich' ||
    target.dataset.field === 'table-details-rich' ||
    target.dataset.field === 'table-column' ||
    target.dataset.field === 'table-cell'
    ? target
    : target.closest<HTMLElement>(
        '[data-field="block-rich"], [data-field="block-grid-rich"], [data-field="table-details-rich"], [data-field="table-column"], [data-field="table-cell"]'
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
    const popover = picker.querySelector<HTMLElement>('.component-picker-popover');
    if (!popover) {
      return;
    }
    popover.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    requestAnimationFrame(() => placeComponentPicker(picker));
  });
}

function placeComponentPicker(picker: HTMLElement): void {
  const popover = picker.querySelector<HTMLElement>('.component-picker-popover');
  if (!popover) {
    return;
  }
  picker.style.removeProperty('--component-picker-shift');
  const padding = 8;
  const rect = popover.getBoundingClientRect();
  const overflowLeft = padding - rect.left;
  const overflowRight = rect.right - (window.innerWidth - padding);
  if (overflowLeft > 0) {
    picker.style.setProperty('--component-picker-shift', `${overflowLeft}px`);
  } else if (overflowRight > 0) {
    picker.style.setProperty('--component-picker-shift', `${-overflowRight}px`);
  }
}
