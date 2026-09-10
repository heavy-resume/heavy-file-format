import { closeIcon } from '../../../icons';
import { state } from '../../../state';

const TABLE_CELL_MODAL_SELECTOR = '[data-static-table-cell-modal]';
const TABLE_CELL_CLICK_INSET = 4;

export function isStaticTableCellTruncated(cell: HTMLTableCellElement): boolean {
  return cell.scrollWidth - cell.clientWidth > 1 || cell.scrollHeight - cell.clientHeight > 1;
}

function closeStaticTableCellModal(modal: HTMLElement, returnFocus: HTMLElement): void {
  modal.remove();
  if (returnFocus.isConnected) {
    returnFocus.focus({ preventScroll: true });
  }
}

function openStaticTableCellModal(app: HTMLElement, cell: HTMLTableCellElement): void {
  app.querySelector(TABLE_CELL_MODAL_SELECTOR)?.remove();

  const modal = document.createElement('div');
  modal.className = 'modal-root static-table-cell-modal-root';
  modal.dataset.staticTableCellModal = 'true';

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.dataset.staticTableCellModalAction = 'close';

  const panel = document.createElement('section');
  panel.className = 'modal-panel static-table-cell-modal';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Cell contents');

  const head = document.createElement('div');
  head.className = 'modal-head static-table-cell-modal-head';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'ghost remove-x';
  closeButton.dataset.staticTableCellModalAction = 'close';
  closeButton.setAttribute('aria-label', 'Close cell contents');
  closeButton.innerHTML = closeIcon();
  head.append(closeButton);

  const content = document.createElement('div');
  content.className = 'static-table-cell-modal-content';
  Array.from(cell.childNodes).forEach((child) => content.append(child.cloneNode(true)));
  panel.append(head, content);
  modal.append(overlay, panel);

  modal.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('[data-static-table-cell-modal-action="close"]')) {
      closeStaticTableCellModal(modal, cell);
    }
  });
  modal.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    closeStaticTableCellModal(modal, cell);
  });

  (cell.closest<HTMLElement>('.editor-shell, .viewer-shell') ?? app).append(modal);
  closeButton.focus({ preventScroll: true });
}

export function handleStaticTableCellClick(
  app: HTMLElement,
  event: Event,
  runAction: (action: () => void) => void = (action) => action(),
): boolean {
  if (state.currentView !== 'viewer' && state.currentView !== 'ai') {
    return false;
  }
  const target = event.target;
  if (!(target instanceof HTMLElement) || target.closest('a, button, input, select, textarea, [contenteditable="true"]')) {
    return false;
  }
  const cell = target.closest<HTMLTableCellElement>('.reader-table .table-main-row > td');
  if (!cell) {
    return false;
  }
  if (event instanceof MouseEvent && event.detail > 0) {
    const rect = cell.getBoundingClientRect();
    if (
      event.clientX < rect.left + TABLE_CELL_CLICK_INSET
      || event.clientX > rect.right - TABLE_CELL_CLICK_INSET
      || event.clientY < rect.top + TABLE_CELL_CLICK_INSET
      || event.clientY > rect.bottom - TABLE_CELL_CLICK_INSET
    ) {
      return false;
    }
  }
  if (!isStaticTableCellTruncated(cell)) {
    return false;
  }
  event.stopPropagation();
  runAction(() => openStaticTableCellModal(app, cell));
  return true;
}
