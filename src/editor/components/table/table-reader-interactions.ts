import { handleStaticTableCellClick } from './table-cell-modal';
import { bindStaticTableCellSelection, consumeStaticTableDragClick } from './table-cell-selection';

type StaticTableReaderActionRunner = (event: Event, action: () => void) => void;

export function bindStaticTableReaderInteractions(
  app: HTMLElement,
  roots: Array<HTMLElement | null>,
  runAction?: StaticTableReaderActionRunner,
): void {
  bindStaticTableCellSelection(app, roots);
  roots.forEach((root) => {
    root?.addEventListener('click', (event) => {
      if (consumeStaticTableDragClick()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (handleStaticTableCellClick(app, event, (action) => runAction ? runAction(event, action) : action())) {
        event.stopImmediatePropagation();
      }
    });
  });
}
