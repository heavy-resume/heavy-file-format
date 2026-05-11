import { state, getRenderApp, closeAiEditPopover, completePendingRichAnnotation, handleRichEditorClick, refreshRichToolbarState } from './_imports';

const sidebarHelpDismissTimers: Record<'editor' | 'viewer', number | null> = {
  editor: null,
  viewer: null,
};

export function bindClickMisc(app: HTMLElement): void {
  app.addEventListener('mouseup', (event) => {
    const richTarget = getRichTarget(event.target as HTMLElement);
    if (richTarget) {
      completePendingRichAnnotation(richTarget);
      refreshRichToolbarState(richTarget);
    }
  });

  app.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const richTarget = getRichTarget(target);
    if (richTarget) {
      handleRichEditorClick(event, richTarget);
    }
    const pickerTrigger = target.closest<HTMLElement>('.component-picker-trigger');
    if (pickerTrigger) {
      const picker = pickerTrigger.closest<HTMLElement>('.component-picker');
      if (picker) {
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
      return;
    }
    const pickerPaneButton = target.closest<HTMLElement>('[data-component-picker-pane]');
    if (pickerPaneButton) {
      event.preventDefault();
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
      const picker = pickerRootPane.closest<HTMLElement>('.component-picker');
      if (picker) {
        delete picker.dataset.open;
        picker.dataset.activePane = 'root';
        picker.style.removeProperty('--component-picker-shift');
      }
      return;
    }
    if (!target.closest('.component-picker')) {
      closeOtherComponentPickers(app);
    }
    if (target.closest('.hvy-context-popover')) {
      return;
    }
    if (state.contextMenu && !target.closest('.hvy-context-popover')) {
      state.contextMenu = null;
      app.querySelector('.hvy-context-popover')?.remove();
      app.querySelector('.hvy-context-popover-backdrop')?.remove();
      getRenderApp()();
      return;
    }
    if (target.closest('.editor-sidebar-help-balloon')) {
      dismissSidebarHelpBalloon(app, 'editor');
      return;
    }
    if (target.closest('.viewer-sidebar-help-balloon')) {
      dismissSidebarHelpBalloon(app, 'viewer');
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

export function scheduleSidebarHelpAutoClose(app: HTMLElement): void {
  scheduleSidebarHelpAutoCloseFor(app, 'editor');
  scheduleSidebarHelpAutoCloseFor(app, 'viewer');
}

function scheduleSidebarHelpAutoCloseFor(app: HTMLElement, kind: 'editor' | 'viewer'): void {
  if (sidebarHelpDismissTimers[kind] !== null) {
    window.clearTimeout(sidebarHelpDismissTimers[kind]!);
    sidebarHelpDismissTimers[kind] = null;
  }
  if (getSidebarHelpDismissed(kind) || !app.querySelector(getSidebarHelpSelector(kind))) {
    return;
  }
  sidebarHelpDismissTimers[kind] = window.setTimeout(() => {
    sidebarHelpDismissTimers[kind] = null;
    dismissSidebarHelpBalloon(app, kind);
  }, 5000);
}

function dismissSidebarHelpBalloon(app: HTMLElement, kind: 'editor' | 'viewer'): void {
  if (sidebarHelpDismissTimers[kind] !== null) {
    window.clearTimeout(sidebarHelpDismissTimers[kind]!);
    sidebarHelpDismissTimers[kind] = null;
  }
  const balloon = app.querySelector<HTMLElement>(getSidebarHelpSelector(kind));
  if (!balloon || balloon.classList.contains('is-closing')) {
    setSidebarHelpDismissed(kind);
    getRenderApp()();
    return;
  }
  balloon.classList.add('is-closing');
  window.setTimeout(() => {
    setSidebarHelpDismissed(kind);
    getRenderApp()();
  }, 180);
}

function getSidebarHelpSelector(kind: 'editor' | 'viewer'): string {
  return kind === 'editor' ? '.editor-sidebar-help-balloon' : '.viewer-sidebar-help-balloon';
}

function getSidebarHelpDismissed(kind: 'editor' | 'viewer'): boolean {
  return kind === 'editor' ? state.editorSidebarHelpDismissed : state.viewerSidebarHelpDismissed;
}

function setSidebarHelpDismissed(kind: 'editor' | 'viewer'): void {
  if (kind === 'editor') {
    state.editorSidebarHelpDismissed = true;
  } else {
    state.viewerSidebarHelpDismissed = true;
  }
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
