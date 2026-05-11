import { state, openLinkInlineModal } from './_imports';

export function bindContextmenu(app: HTMLElement): void {
  app.addEventListener('contextmenu', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('.hvy-context-popover-backdrop')) {
      event.preventDefault();
      closeReaderContextPopover(app);
      return;
    }
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
  const shellRect = (app.querySelector<HTMLElement>('.viewer-shell') ?? app).getBoundingClientRect();
  const targetRect = fallbackRect
    ? {
        left: Math.max(0, fallbackRect.left - shellRect.left),
        top: Math.max(0, fallbackRect.top - shellRect.top),
        width: fallbackRect.width,
        height: fallbackRect.height,
      }
    : undefined;
  const x = Number.isFinite(event.clientX) ? event.clientX : fallbackRect ? fallbackRect.left + 16 : 16;
  const y = Number.isFinite(event.clientY) ? event.clientY : fallbackRect ? fallbackRect.top + 16 : 16;
  state.contextMenu = {
    kind: state.currentView === 'ai' ? 'ai' : 'filter',
    sectionKey,
    ...(blockId ? { blockId } : {}),
    x,
    y,
    ...(targetRect ? { targetRect } : {}),
  };
  renderContextMenuElement(app);
}

function renderContextMenuElement(app: HTMLElement): void {
  closeReaderContextPopover(app, false);
  const menu = state.contextMenu;
  if (!menu) {
    return;
  }
  const filtering = state.search.filterEnabled && state.search.submittedQuery.trim().length > 0;
  const root = app.querySelector<HTMLElement>('.viewer-shell') ?? app;
  root.classList.add('is-context-menu-open');
  if (menu.blockId) {
    const target = root
      .querySelector<HTMLElement>(`.reader-block[data-section-key="${cssEscape(menu.sectionKey)}"][data-block-id="${cssEscape(menu.blockId)}"]`)
    target?.classList.add('is-context-menu-target');
  }
  const backdrop = document.createElement('div');
  backdrop.className = 'hvy-context-popover-backdrop';
  backdrop.setAttribute('aria-hidden', 'true');
  if (menu.targetRect) {
    applyBackdropTargetRect(backdrop, menu.targetRect);
    ['top', 'left', 'right', 'bottom', 'target'].forEach((part) => {
      const panel = document.createElement('div');
      panel.className = `hvy-context-popover-backdrop-${part}`;
      backdrop.append(panel);
    });
  }
  const target = menu.blockId
    ? root.querySelector<HTMLElement>(`.reader-block[data-section-key="${cssEscape(menu.sectionKey)}"][data-block-id="${cssEscape(menu.blockId)}"]`)
    : null;
  const clone = target && menu.targetRect ? cloneContextMenuTarget(target, menu.targetRect) : null;
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
  root.append(backdrop, ...(clone ? [clone] : []), popover);
}

function closeReaderContextPopover(app: HTMLElement, clearState = true): void {
  if (clearState) {
    state.contextMenu = null;
  }
  app.querySelector('.viewer-shell')?.classList.remove('is-context-menu-open');
  app.querySelectorAll('.reader-block.is-context-menu-target').forEach((element) => {
    element.classList.remove('is-context-menu-target');
  });
  app.querySelector('.hvy-context-popover-clone')?.remove();
  app.querySelector('.hvy-context-popover')?.remove();
  app.querySelector('.hvy-context-popover-backdrop')?.remove();
}

function cssEscape(value: string): string {
  return window.CSS?.escape ? window.CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}

function applyBackdropTargetRect(backdrop: HTMLElement, rect: NonNullable<typeof state.contextMenu>['targetRect']): void {
  if (!rect) {
    return;
  }
  backdrop.style.setProperty('--hvy-context-target-left', `${rect.left}px`);
  backdrop.style.setProperty('--hvy-context-target-top', `${rect.top}px`);
  backdrop.style.setProperty('--hvy-context-target-width', `${rect.width}px`);
  backdrop.style.setProperty('--hvy-context-target-height', `${rect.height}px`);
}

function cloneContextMenuTarget(target: HTMLElement, rect: NonNullable<typeof state.contextMenu>['targetRect']): HTMLElement | null {
  if (!rect) {
    return null;
  }
  const clone = target.cloneNode(true) as HTMLElement;
  clone.classList.add('hvy-context-popover-clone');
  clone.classList.remove('is-context-menu-target');
  clone.setAttribute('aria-hidden', 'true');
  clone.removeAttribute('id');
  clone.querySelectorAll('[id]').forEach((element) => {
    element.removeAttribute('id');
  });
  clone.querySelectorAll('input, textarea, select, button, a, [tabindex]').forEach((element) => {
    element.setAttribute('tabindex', '-1');
  });
  clone.style.left = `${rect.left}px`;
  clone.style.top = `${rect.top}px`;
  clone.style.width = `${rect.width}px`;
  clone.style.margin = '0';
  return clone;
}
