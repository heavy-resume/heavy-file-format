type TableGrabberKind = 'row' | 'column';

interface TableGrabberInsertMenuOptions {
  kind: TableGrabberKind;
  sectionKey: string;
  blockId: string;
  index: number;
  disabled?: boolean;
  escapeAttr: (value: string) => string;
}

export function renderTableGrabberInsertMenu(options: TableGrabberInsertMenuOptions): string {
  const { kind, sectionKey, blockId, index, disabled, escapeAttr } = options;
  const indexAttribute = kind === 'row' ? 'row-index' : 'column-index';
  const data = `data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(blockId)}" data-${indexAttribute}="${index}"`;
  const label = `${kind[0].toUpperCase()}${kind.slice(1)} options`;
  return `<span class="table-grabber-insert-menu">
    <button
      type="button"
      class="table-drag-handle"
      draggable="true"
      ${disabled ? 'disabled' : ''}
      data-drag-handle="table-${kind}"
      ${data}
      title="Drag to reorder ${kind}; right-click or double-click for insertion options"
      aria-label="${label}"
      aria-haspopup="menu"
      aria-expanded="false"
    >::</button>
    <span class="table-grabber-insert-popover" role="menu" aria-label="Insert ${kind}" hidden>
      <button type="button" role="menuitem" data-action="insert-table-${kind}-before" ${data}>Insert before</button>
      <button type="button" role="menuitem" data-action="insert-table-${kind}-after" ${data}>Insert after</button>
    </span>
  </span>`;
}

export function bindTableGrabberInsertMenus(app: HTMLElement): void {
  app.addEventListener('dblclick', (event) => {
    openTableGrabberInsertMenu(app, event);
  });

  app.addEventListener('contextmenu', (event) => {
    openTableGrabberInsertMenu(app, event);
  });

  app.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    if (!target?.closest('.table-grabber-insert-menu')) {
      closeTableGrabberInsertMenus(app);
    }
  });

  app.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') {
      return;
    }
    const menu = (event.target as Element | null)?.closest<HTMLElement>('.table-grabber-insert-menu.is-open');
    if (!menu) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const handle = menu.querySelector<HTMLElement>('[data-drag-handle]');
    closeTableGrabberInsertMenus(app);
    handle?.focus({ preventScroll: true });
  }, { capture: true });
}

function openTableGrabberInsertMenu(app: HTMLElement, event: MouseEvent): boolean {
  const target = event.target;
  const handle = target instanceof Element
    ? target.closest<HTMLElement>('[data-drag-handle="table-row"], [data-drag-handle="table-column"]')
    : null;
  if (!handle || handle.hasAttribute('disabled')) {
    return false;
  }
  const menu = handle.closest<HTMLElement>('.table-grabber-insert-menu');
  const popover = menu?.querySelector<HTMLElement>('.table-grabber-insert-popover');
  if (!menu || !popover) {
    return false;
  }
  event.preventDefault();
  event.stopPropagation();
  closeTableGrabberInsertMenus(app, menu);
  popover.hidden = false;
  menu.classList.add('is-open');
  handle.setAttribute('aria-expanded', 'true');
  popover.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  return true;
}

export function closeTableGrabberInsertMenus(root: ParentNode, except: HTMLElement | null = null): boolean {
  let closed = false;
  root.querySelectorAll<HTMLElement>('.table-grabber-insert-menu.is-open').forEach((menu) => {
    if (menu === except) {
      return;
    }
    menu.classList.remove('is-open');
    const popover = menu.querySelector<HTMLElement>('.table-grabber-insert-popover');
    if (popover) {
      popover.hidden = true;
    }
    menu.querySelector<HTMLElement>('[data-drag-handle]')?.setAttribute('aria-expanded', 'false');
    closed = true;
  });
  return closed;
}
