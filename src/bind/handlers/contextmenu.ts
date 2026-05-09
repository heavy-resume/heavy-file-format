import { state, getRenderApp, openLinkInlineModal } from './_imports';

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

    const filtering = state.search.filterEnabled && state.search.submittedQuery.trim().length > 0;
    if (state.currentView !== 'viewer' && state.currentView !== 'ai') {
      return;
    }

    const blockElement = target.closest<HTMLElement>('.reader-block[data-section-key][data-block-id]');
    const sectionElement = target.closest<HTMLElement>('.reader-section[data-section-key]');
    if (!blockElement && !sectionElement) {
      return;
    }

    const sectionKey = blockElement?.dataset.sectionKey ?? sectionElement?.dataset.sectionKey ?? '';
    const blockId = blockElement?.dataset.blockId ?? '';
    if (!sectionKey) {
      return;
    }

    if (state.currentView === 'viewer' && !filtering) {
      return;
    }
    if (state.currentView === 'ai' && !blockId) {
      return;
    }
    event.preventDefault();
    state.contextMenu = {
      kind: state.currentView === 'ai' ? 'ai' : 'filter',
      sectionKey,
      ...(blockId ? { blockId } : {}),
      x: event.clientX,
      y: event.clientY,
    };
    getRenderApp()();
  });
}
