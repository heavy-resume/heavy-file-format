import { activateTransientPopover, releaseTransientPopover } from '../../../transient-popovers';

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
    <span class="table-grabber-insert-popover" popover="manual" role="menu" aria-label="Insert ${kind}" hidden>
      <button type="button" role="menuitem" data-action="insert-table-${kind}-before" ${data}>Insert before</button>
      <button type="button" role="menuitem" data-action="insert-table-${kind}-after" ${data}>Insert after</button>
    </span>
  </span>`;
}

export function bindTableGrabberInsertMenus(app: HTMLElement): void {
  app.addEventListener('scroll', (event) => {
    if (!(event.target instanceof Element) || !event.target.closest('.table-grabber-insert-popover')) {
      app.querySelectorAll<HTMLElement>('.table-grabber-insert-menu.is-open').forEach((menu) => {
        positionTableGrabberInsertMenu(
          menu.querySelector<HTMLElement>('[data-drag-handle]')!,
          menu.querySelector<HTMLElement>('.table-grabber-insert-popover')!
        );
      });
    }
  }, { capture: true });

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
  activateTransientPopover(app, popover, () => closeTableGrabberInsertMenus(app));
  popover.hidden = false;
  popover.showPopover();
  positionTableGrabberInsertMenu(handle, popover);
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
      releaseTransientPopover(root, popover);
      popover.hidePopover();
      popover.hidden = true;
    }
    menu.querySelector<HTMLElement>('[data-drag-handle]')?.setAttribute('aria-expanded', 'false');
    closed = true;
  });
  return closed;
}

function positionTableGrabberInsertMenu(handle: HTMLElement, popover: HTMLElement): void {
  const surface = handle.closest<HTMLElement>('.modal-panel, .editor-shell, .viewer-shell') ?? handle.closest<HTMLElement>('.hvy-document')!;
  const bounds = surface.getBoundingClientRect();
  const anchor = handle.getBoundingClientRect();
  const margin = 8;
  const gap = 5;
  const left = Math.max(0, bounds.left) + margin;
  const top = Math.max(0, bounds.top) + margin;
  const right = Math.min(window.innerWidth, bounds.right) - margin;
  const bottom = Math.min(window.innerHeight, bounds.bottom) - margin;
  popover.style.maxWidth = `${Math.max(0, right - left)}px`;
  popover.style.maxHeight = `${Math.max(0, bottom - top)}px`;
  const size = popover.getBoundingClientRect();
  const x = Math.max(left, Math.min(anchor.left, right - size.width));
  const preferredY = anchor.bottom + gap + size.height <= bottom
    ? anchor.bottom + gap
    : anchor.top - gap - size.height;
  const y = Math.max(top, Math.min(preferredY, bottom - size.height));
  // Absolute top-layer coordinates escape table overflow; bounds still belong to the preview surface.
  popover.style.left = `${x + window.scrollX}px`;
  popover.style.top = `${y + window.scrollY}px`;
}
