import { state, getRenderApp, closeAiEditPopover } from './_imports';

export function bindClickMisc(app: HTMLElement): void {
  app.addEventListener('click', (event) => {
    if (!state.aiEdit.sectionKey || !state.aiEdit.blockId) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest('.ai-edit-popover')) {
      return;
    }
    closeAiEditPopover();
    getRenderApp()();
  });
}
