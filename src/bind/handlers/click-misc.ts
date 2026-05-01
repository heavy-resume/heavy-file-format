import { state, getRenderApp, closeAiEditPopover } from './_imports';

export function bindClickMisc(app: HTMLElement): void {
  app.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
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
