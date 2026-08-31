import { state } from './_imports';
import { findBlockByIds, refreshReaderPanelsOutsideActiveEditor } from '../../block-ops';
import { recordHistory } from '../../history';
import { syncReusableTemplateForBlock } from '../../reusable';
import { getTableColumns, setTableColumnProperties } from '../../table-ops';
import { clampTableColumnWidth, measureTableColumnTextSamples, type TableColumnTextSample } from '../../table-column-sizing';

export function bindResize(app: HTMLElement): void {
  app.addEventListener('pointerdown', (event) => {
    const handle = (event.target as Element | null)?.closest<HTMLElement>('.table-column-resize-handle');
    if (!handle || event.button !== 0) return;
    const sectionKey = handle.dataset.sectionKey ?? '';
    const blockId = handle.dataset.blockId ?? '';
    const columnIndex = Number.parseInt(handle.dataset.columnIndex ?? '', 10);
    const block = findBlockByIds(sectionKey, blockId);
    const table = handle.closest<HTMLTableElement>('.table-editor-grid');
    const header = handle.closest<HTMLTableCellElement>('th');
    const column = block ? getTableColumns(block.schema)[columnIndex] : '';
    if (!block || !table || !header || !column) return;

    event.preventDefault();
    event.stopPropagation();
    const matchingIndexes = getTableColumns(block.schema)
      .map((candidate, index) => candidate === column ? index : -1)
      .filter((index) => index >= 0);
    const startX = event.clientX;
    const startWidth = header.getBoundingClientRect().width;
    let nextWidth = startWidth;
    let moved = false;
    handle.classList.add('is-resizing');

    const onPointerMove = (moveEvent: PointerEvent): void => {
      if (moveEvent.pointerId !== event.pointerId) return;
      const delta = moveEvent.clientX - startX;
      if (!moved && Math.abs(delta) > 1) {
        moved = true;
        recordHistory(`table-column-width:${sectionKey}:${blockId}:${column}`);
      }
      nextWidth = clampTableColumnWidth(startWidth + delta);
      applyTableColumnPixelWidth(table, matchingIndexes, nextWidth);
    };
    const finish = (upEvent: PointerEvent): void => {
      if (upEvent.pointerId !== event.pointerId) return;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      handle.classList.remove('is-resizing');
      if (!moved) return;
      setTableColumnProperties(block.schema, column, { width: `${Math.round(nextWidth)}px` });
      syncReusableTemplateForBlock(sectionKey, block.id);
      refreshReaderPanelsOutsideActiveEditor(table);
      table.querySelectorAll<HTMLInputElement>('[data-field="table-column-width"]').forEach((input) => {
        const index = Number.parseInt(input.dataset.columnIndex ?? '', 10);
        if (matchingIndexes.includes(index)) input.value = `${Math.round(nextWidth)}px`;
      });
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  });

  app.addEventListener('dblclick', (event) => {
    const handle = (event.target as Element | null)?.closest<HTMLElement>('.table-column-resize-handle');
    if (!handle) return;
    event.preventDefault();
    event.stopPropagation();
    autoFitStaticTableColumn(handle);
  });

  app.addEventListener('mousedown', (event) => {
    if (event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement | null;
    const draggablePanel = target?.closest<HTMLElement>('[data-draggable-panel]');
    if (draggablePanel && !target?.closest('button, input, select, textarea, a, [contenteditable="true"]')) {
      beginDraggablePanelMove(app, draggablePanel, event);
      return;
    }
    const head = target?.closest<HTMLElement>('.ai-edit-popover-head');
    if (!head) {
      return;
    }
    if (target?.closest('button, input, select, textarea, a')) {
      return;
    }
    const popover = head.closest<HTMLElement>('.ai-edit-popover');
    if (!popover) {
      return;
    }

    event.preventDefault();
    const startClientX = event.clientX;
    const startClientY = event.clientY;
    const startPopupX = state.aiEdit.popupX;
    const startPopupY = state.aiEdit.popupY;

    const clamp = (x: number, y: number): { x: number; y: number } => {
      const shell = popover.closest<HTMLElement>('.viewer-shell') ?? app.querySelector<HTMLElement>('.viewer-shell');
      const shellRect = shell?.getBoundingClientRect();
      const frameWidth = shell?.clientWidth || shellRect?.width || window.innerWidth;
      const frameHeight = shell?.clientHeight || shellRect?.height || window.innerHeight;
      const maxX = Math.max(0, frameWidth - popover.offsetWidth);
      const maxY = Math.max(0, frameHeight - popover.offsetHeight);
      return {
        x: Math.min(Math.max(x, 0), maxX),
        y: Math.min(Math.max(y, 0), maxY),
      };
    };

    const onMove = (moveEvent: MouseEvent): void => {
      const next = clamp(
        startPopupX + (moveEvent.clientX - startClientX),
        startPopupY + (moveEvent.clientY - startClientY)
      );
      popover.style.left = `${next.x}px`;
      popover.style.top = `${next.y}px`;
    };

    const onUp = (upEvent: MouseEvent): void => {
      const next = clamp(
        startPopupX + (upEvent.clientX - startClientX),
        startPopupY + (upEvent.clientY - startClientY)
      );
      state.aiEdit.popupX = next.x;
      state.aiEdit.popupY = next.y;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}

function beginDraggablePanelMove(app: HTMLElement, panel: HTMLElement, event: MouseEvent): void {
  event.preventDefault();
  const surface = panel.closest<HTMLElement>('.editor-shell, .viewer-shell') ?? app;
  const startClientX = event.clientX;
  const startClientY = event.clientY;
  const startX = panel.offsetLeft;
  const startY = panel.offsetTop;
  panel.classList.add('is-dragging');

  const clamp = (x: number, y: number): { x: number; y: number } => ({
    x: Math.min(Math.max(x, 0), Math.max(0, surface.clientWidth - panel.offsetWidth)),
    y: Math.min(Math.max(y, 0), Math.max(0, surface.clientHeight - panel.offsetHeight)),
  });
  const move = (moveEvent: MouseEvent): void => {
    const next = clamp(
      startX + moveEvent.clientX - startClientX,
      startY + moveEvent.clientY - startClientY
    );
    panel.style.left = `${Math.round(next.x)}px`;
    panel.style.top = `${Math.round(next.y)}px`;
  };
  const finish = (): void => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', finish);
    panel.classList.remove('is-dragging');
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', finish);
}

export function autoFitStaticTableColumn(target: HTMLElement): boolean {
  const sectionKey = target.dataset.sectionKey ?? '';
  const blockId = target.dataset.blockId ?? '';
  const columnIndex = Number.parseInt(target.dataset.columnIndex ?? '', 10);
  const block = findBlockByIds(sectionKey, blockId);
  const table = target.closest<HTMLTableElement>('.table-editor-grid');
  const column = block ? getTableColumns(block.schema)[columnIndex] : '';
  if (!block || !table || !column) return false;
  const matchingIndexes = getTableColumns(block.schema)
    .map((candidate, index) => candidate === column ? index : -1)
    .filter((index) => index >= 0);
  const width = measureTableColumnContent(table, matchingIndexes);
  recordHistory(`table-column-fit:${sectionKey}:${blockId}:${column}`);
  setTableColumnProperties(block.schema, column, { width: `${width}px` });
  applyTableColumnPixelWidth(table, matchingIndexes, width);
  table.querySelectorAll<HTMLInputElement>('[data-field="table-column-width"]').forEach((input) => {
    const index = Number.parseInt(input.dataset.columnIndex ?? '', 10);
    if (matchingIndexes.includes(index)) input.value = `${width}px`;
  });
  syncReusableTemplateForBlock(sectionKey, block.id);
  refreshReaderPanelsOutsideActiveEditor(table);
  return true;
}

function applyTableColumnPixelWidth(table: HTMLTableElement, columnIndexes: number[], width: number): void {
  columnIndexes.forEach((columnIndex) => {
    const col = table.querySelector<HTMLTableColElement>(`col[data-table-column-index="${columnIndex}"]`);
    if (col) col.style.width = `${Math.round(width)}px`;
    table.querySelectorAll<HTMLElement>(`th[data-table-column-index="${columnIndex}"], td[data-table-column-index="${columnIndex}"]`)
      .forEach((cell) => cell.classList.add('table-column-fixed'));
  });
}

function measureTableColumnContent(table: HTMLTableElement, columnIndexes: number[]): number {
  const root = table.closest<HTMLElement>('.table-editor') ?? table;
  const samples: TableColumnTextSample[] = [];
  columnIndexes.forEach((columnIndex) => {
    table.querySelectorAll<HTMLTableCellElement>(`th[data-table-column-index="${columnIndex}"], td[data-table-column-index="${columnIndex}"]`)
      .forEach((cell) => {
        const source = cell.tagName === 'TH'
          ? cell.querySelector<HTMLElement>('.table-column-name')
          : cell.querySelector<HTMLElement>('.table-inline-text');
        if (!source) return;
        samples.push({ source, text: source.textContent ?? '', padding: cell.tagName === 'TH' ? 76 : 24 });
      });
  });
  return measureTableColumnTextSamples(root, samples);
}
