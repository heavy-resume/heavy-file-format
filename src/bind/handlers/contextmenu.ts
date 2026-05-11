import { state, openLinkInlineModal } from './_imports';

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

    openReaderContextPopover(app, event, filtering);
  });

  app.addEventListener('dblclick', (event) => {
    if (state.currentView !== 'ai') {
      return;
    }
    const target = event.target as HTMLElement;
    const anchor = target.closest<HTMLAnchorElement>('a');
    const readerAction = target.closest<HTMLElement>('[data-reader-action]');
    if (
      (target.closest('button, input, textarea, select, [contenteditable="true"], .hvy-context-popover, .ai-edit-popover') && !readerAction) ||
      (anchor && !anchor.classList.contains('reader-xref-card'))
    ) {
      return;
    }
    window.getSelection()?.removeAllRanges();
    openReaderContextPopover(app, event, false);
  });
}

function openReaderContextPopover(app: HTMLElement, event: MouseEvent, filtering: boolean): void {
  const target = event.target as HTMLElement;
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
  const fallbackRect = (blockElement ?? sectionElement)?.getBoundingClientRect();
  const x = Number.isFinite(event.clientX) ? event.clientX : fallbackRect ? fallbackRect.left + 16 : 16;
  const y = Number.isFinite(event.clientY) ? event.clientY : fallbackRect ? fallbackRect.top + 16 : 16;
  state.contextMenu = {
    kind: state.currentView === 'ai' ? 'ai' : 'filter',
    sectionKey,
    ...(blockId ? { blockId } : {}),
    x,
    y,
  };
  renderContextMenuElement(app);
}

function renderContextMenuElement(app: HTMLElement): void {
  app.querySelector('.hvy-context-popover')?.remove();
  const menu = state.contextMenu;
  if (!menu) {
    return;
  }
  const filtering = state.search.filterEnabled && state.search.submittedQuery.trim().length > 0;
  const popover = document.createElement('section');
  popover.className = 'hvy-context-popover';
  popover.setAttribute('aria-label', menu.kind === 'ai' ? 'Component options' : 'Filter options');
  popover.style.left = `${menu.x}px`;
  popover.style.top = `${menu.y}px`;

  const addButton = (label: string, action: string): void => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.action = action;
    button.textContent = label;
    popover.append(button);
  };

  if (menu.kind === 'ai') {
    addButton('Edit component', 'edit-context-component');
    addButton('Request changes', 'request-context-component-changes');
    if (filtering) {
      addButton('Clear filtering', 'clear-target-filtering');
    }
  } else {
    addButton('Clear filtering', 'clear-target-filtering');
  }
  app.append(popover);
}
