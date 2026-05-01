import { state, getRenderApp, closeAiEditPopover } from './_imports';

export function bindClickMisc(app: HTMLElement): void {
  app.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const pickerTrigger = target.closest<HTMLElement>('.component-picker-trigger');
    if (pickerTrigger) {
      const picker = pickerTrigger.closest<HTMLElement>('.component-picker');
      if (picker) {
        closeOtherComponentPickers(app, picker);
        picker.dataset.open = 'true';
        picker.dataset.activePane = 'root';
        placeComponentPicker(picker);
      }
      return;
    }
    const pickerPaneButton = target.closest<HTMLElement>('[data-component-picker-pane]');
    if (pickerPaneButton) {
      const picker = pickerPaneButton.closest<HTMLElement>('.component-picker');
      if (picker) {
        picker.dataset.activePane = pickerPaneButton.dataset.componentPickerPane ?? 'root';
      }
      return;
    }
    if (!target.closest('.component-picker')) {
      closeOtherComponentPickers(app);
    }
    if (target.closest('.editor-sidebar-help-balloon')) {
      state.editorSidebarHelpDismissed = true;
      getRenderApp()();
      return;
    }
    if (!state.aiEdit.sectionKey || !state.aiEdit.blockId) {
      return;
    }
    if (target.closest('.ai-edit-popover')) {
      return;
    }
    closeAiEditPopover();
    getRenderApp()();
  });
}

function closeOtherComponentPickers(app: HTMLElement, except?: HTMLElement): void {
  app.querySelectorAll<HTMLElement>('.component-picker[data-open="true"]').forEach((picker) => {
    if (picker !== except) {
      delete picker.dataset.open;
      picker.style.removeProperty('--component-picker-shift');
    }
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
