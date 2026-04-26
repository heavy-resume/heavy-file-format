import { state, getRenderApp, openLinkInlineModal, openAiEditPopover } from './_imports';

export function bindContextmenu(app: HTMLElement): void {
  app.addEventListener('contextmenu', (event) => {
    const target = event.target as HTMLElement;
    const anchor = target.closest<HTMLAnchorElement>('.rich-editor a[href]');
    if (anchor) {
      const editable = anchor.closest<HTMLElement>('.rich-editor');
      if (!editable) {
        return;
      }
      event.preventDefault();
      const range = document.createRange();
      range.selectNodeContents(anchor);
      openLinkInlineModal(app, editable, anchor.getAttribute('href') ?? '', range, anchor);
      return;
    }

    if (state.currentView !== 'ai') {
      return;
    }

    const blockElement = target.closest<HTMLElement>('.reader-block[data-section-key][data-block-id]');
    if (!blockElement) {
      return;
    }

    const sectionKey = blockElement.dataset.sectionKey ?? '';
    const blockId = blockElement.dataset.blockId ?? '';
    if (!sectionKey || !blockId) {
      return;
    }

    event.preventDefault();
    openAiEditPopover(sectionKey, blockId, event.clientX, event.clientY);
    getRenderApp()();
  });
}
