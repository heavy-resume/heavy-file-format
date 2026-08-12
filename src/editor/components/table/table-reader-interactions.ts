import { handleStaticTableCellClick } from './table-cell-modal';
import { bindStaticTableCellSelection, consumeStaticTableDragClick } from './table-cell-selection';

export function bindStaticTableReaderInteractions(app: HTMLElement, roots: Array<HTMLElement | null>): void {
  bindStaticTableCellSelection(app, roots);
  roots.forEach((root) => {
    root?.addEventListener('click', (event) => {
      if (consumeStaticTableDragClick()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (handleStaticTableCellClick(app, event)) {
        event.stopImmediatePropagation();
      }
    });
  });
}
