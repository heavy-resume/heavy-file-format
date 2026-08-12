interface TableCellSelection {
  app: HTMLElement;
  scope: HTMLElement;
  anchor: HTMLTableCellElement;
  focus: HTMLTableCellElement;
  dragged: boolean;
}

const SELECTED_CELL_CLASS = 'is-static-table-cell-selected';
const ACTIVE_TABLE_CLASS = 'has-static-table-cell-selection';
let selection: TableCellSelection | null = null;
let ignoreNextClick = false;
const selectionAppEventsBound = new WeakSet<HTMLElement>();

function getBodyCell(target: EventTarget | null): HTMLTableCellElement | null {
  return target instanceof Element
    ? target.closest<HTMLTableCellElement>('.reader-table .table-main-row > td')
    : null;
}

function isInteractiveCellTarget(target: EventTarget | null): boolean {
  return target instanceof Element
    && Boolean(target.closest('a, button, input, select, textarea, [contenteditable="true"]'));
}

function getCellPosition(cell: HTMLTableCellElement): { row: number; column: number } | null {
  if (!selection) {
    return null;
  }
  const row = cell.parentElement;
  if (!(row instanceof HTMLTableRowElement)) {
    return null;
  }
  const rowIndex = getSelectableRows(selection.scope).indexOf(row);
  return rowIndex < 0 ? null : { row: rowIndex, column: cell.cellIndex };
}

function getSelectableRows(scope: HTMLElement): HTMLTableRowElement[] {
  return Array.from(scope.querySelectorAll<HTMLTableRowElement>('.reader-table > tbody > .table-main-row'));
}

function getSelectionScope(cell: HTMLTableCellElement, root: HTMLElement): HTMLElement {
  return cell.closest<HTMLElement>('.reader-section') ?? root;
}

function clearSelection(): void {
  selection?.scope.querySelectorAll(`.${SELECTED_CELL_CLASS}`).forEach((cell) => cell.classList.remove(SELECTED_CELL_CLASS));
  selection?.scope.querySelectorAll(`.${ACTIVE_TABLE_CLASS}`).forEach((table) => table.classList.remove(ACTIVE_TABLE_CLASS));
  selection = null;
}

function refreshSelection(): void {
  if (!selection) {
    return;
  }
  const anchor = getCellPosition(selection.anchor);
  const focus = getCellPosition(selection.focus);
  if (!anchor || !focus) {
    clearSelection();
    return;
  }
  const rowStart = Math.min(anchor.row, focus.row);
  const rowEnd = Math.max(anchor.row, focus.row);
  const columnStart = Math.min(anchor.column, focus.column);
  const columnEnd = Math.max(anchor.column, focus.column);
  selection.scope.querySelectorAll<HTMLTableCellElement>('.reader-table > tbody > .table-main-row > td').forEach((cell) => {
    const position = getCellPosition(cell);
    const selected = Boolean(
      position && position.row >= rowStart && position.row <= rowEnd && position.column >= columnStart && position.column <= columnEnd
    );
    cell.classList.toggle(
      SELECTED_CELL_CLASS,
      selected
    );
    if (selected) cell.closest('.reader-table')?.classList.add(ACTIVE_TABLE_CLASS);
  });
}

function selectedText(): string {
  if (!selection) {
    return '';
  }
  return getSelectableRows(selection.scope)
    .map((row) => Array.from(row.cells)
      .filter((cell) => cell.classList.contains(SELECTED_CELL_CLASS))
      .map((cell) => cell.innerText.trim())
      .join('\t'))
    .filter((row) => row.length > 0)
    .join('\n');
}

export function bindStaticTableCellSelection(app: HTMLElement, roots: Array<HTMLElement | null>): void {
  roots.forEach((root) => {
    root?.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return;
      }
      if (isInteractiveCellTarget(event.target)) {
        clearSelection();
        return;
      }
      const cell = getBodyCell(event.target);
      if (!cell) {
        clearSelection();
        return;
      }
      event.preventDefault();
      window.getSelection()?.removeAllRanges();
      clearSelection();
      selection = { app, scope: getSelectionScope(cell, root), anchor: cell, focus: cell, dragged: false };
      refreshSelection();
    });

    root?.addEventListener('pointermove', (event) => {
      if (!selection || event.buttons !== 1) {
        return;
      }
      const cell = getBodyCell(document.elementFromPoint(event.clientX, event.clientY));
      if (!cell || getSelectionScope(cell, root) !== selection.scope) {
        return;
      }
      if (cell !== selection.focus) {
        selection.focus = cell;
        selection.dragged = true;
        refreshSelection();
      }
    });
  });

  if (selectionAppEventsBound.has(app)) {
    return;
  }
  selectionAppEventsBound.add(app);
  app.addEventListener('pointerup', () => {
    if (!selection) {
      return;
    }
    ignoreNextClick = selection.dragged;
  });
  window.addEventListener('copy', (event) => {
    if (!selection || selection.app !== app || !app.isConnected || !app.contains(selection.scope)) {
      return;
    }
    const text = selectedText();
    if (!text || !event.clipboardData) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    event.clipboardData.clearData();
    event.clipboardData.setData('text/plain', text);
  }, { capture: true });
}

export function consumeStaticTableDragClick(): boolean {
  const ignored = ignoreNextClick;
  ignoreNextClick = false;
  return ignored;
}
