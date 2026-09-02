import { state, setDraggedSectionKey, setDraggedTableItem, draggedSectionKey, draggedTableItem, getRenderApp, findSectionByKey, moveSectionRelative, recordHistory, moveTableColumn, moveTableRow } from './_imports';

const SECTION_DRAG_SCROLL_EDGE_PX = 72;
const SECTION_DRAG_SCROLL_MAX_PX = 28;
const TABLE_ROW_DRAG_IMAGE_ENABLED = false;

interface SectionDragAutoScrollState {
  scroller: HTMLElement | null;
  pointerY: number;
  frameId: number | null;
}

interface SectionDropPreviewState {
  card: HTMLElement | null;
}

interface TableRowDropPreviewState {
  row: HTMLElement | null;
  sourceRow: HTMLElement | null;
  dragImage: HTMLElement | null;
}

interface TableColumnDropPreviewState {
  column: HTMLElement | null;
  cells: HTMLElement[];
}

const sectionDragAutoScroll: SectionDragAutoScrollState = {
  scroller: null,
  pointerY: 0,
  frameId: null,
};

const sectionDropPreview: SectionDropPreviewState = {
  card: null,
};

const tableRowDropPreview: TableRowDropPreviewState = {
  row: null,
  sourceRow: null,
  dragImage: null,
};

const tableColumnDropPreview: TableColumnDropPreviewState = {
  column: null,
  cells: [],
};

export function bindDnd(app: HTMLElement): void {
  app.addEventListener('dragstart', (event) => {
    const target = event.target as HTMLElement;
    const sectionHandle = target.closest<HTMLElement>('[data-drag-handle="section"]');
    if (sectionHandle) {
      setDraggedSectionKey(sectionHandle.dataset.sectionKey ?? null);
      event.dataTransfer?.setData('text/plain', draggedSectionKey ?? '');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
      }
      return;
    }

    const tableRowHandle = target.closest<HTMLElement>('[data-drag-handle="table-row"]');
    if (tableRowHandle) {
      const sectionKey = tableRowHandle.dataset.sectionKey;
      const blockId = tableRowHandle.dataset.blockId;
      const index = Number.parseInt(tableRowHandle.dataset.rowIndex ?? '', 10);
      if (!sectionKey || !blockId || Number.isNaN(index)) {
        return;
      }
      setDraggedTableItem({ kind: 'row', sectionKey, blockId, index });
      event.dataTransfer?.setData('text/plain', `${blockId}:${index}`);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        const sourceRow = tableRowHandle.closest<HTMLElement>('[data-table-row-drop]');
        if (sourceRow) {
          tableRowDropPreview.sourceRow = sourceRow;
          sourceRow.classList.add('is-table-row-drag-source');
          if (TABLE_ROW_DRAG_IMAGE_ENABLED) {
            const dragImage = createTableRowDragImage(app, sourceRow);
            const bounds = sourceRow.getBoundingClientRect();
            const dragImageBounds = dragImage.getBoundingClientRect();
            event.dataTransfer.setDragImage(
              dragImage,
              Math.min(Math.max(event.clientX - bounds.left, 18), dragImageBounds.width),
              Math.min(Math.max(event.clientY - bounds.top, 8), dragImageBounds.height)
            );
          }
        }
      }
      return;
    }

    const tableColumnHandle = target.closest<HTMLElement>('[data-drag-handle="table-column"]');
    if (tableColumnHandle) {
      const sectionKey = tableColumnHandle.dataset.sectionKey;
      const blockId = tableColumnHandle.dataset.blockId;
      const index = Number.parseInt(tableColumnHandle.dataset.columnIndex ?? '', 10);
      if (!sectionKey || !blockId || Number.isNaN(index)) {
        return;
      }
      setDraggedTableItem({ kind: 'column', sectionKey, blockId, index });
      event.dataTransfer?.setData('text/plain', `${blockId}:${index}`);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
      }
    }
  });

  app.addEventListener('dragover', (event) => {
    const target = event.target as HTMLElement;
    if (draggedSectionKey) {
      updateSectionDragAutoScroll(app, target, event.clientY);
      updateSectionDropPreview(target, event.clientY);
    }
    if (draggedSectionKey && target.closest<HTMLElement>('[data-editor-section]')) {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
      return;
    }

    if (draggedTableItem?.kind === 'row') {
      const rowDrop = getMatchingTableRowDrop(target, draggedTableItem);
      if (rowDrop) {
        event.preventDefault();
        updateTableRowDropPreview(rowDrop, event.clientY);
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = 'move';
        }
        return;
      }
      clearTableRowDropPreview();
    }

    if (draggedTableItem?.kind === 'column') {
      const columnDrop = getMatchingTableColumnDrop(target, draggedTableItem);
      if (columnDrop) {
        event.preventDefault();
        updateTableColumnDropPreview(columnDrop, event.clientX);
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = 'move';
        }
        return;
      }
      clearTableColumnDropPreview();
    }
  });

  app.addEventListener('drop', (event) => {
    const target = event.target as HTMLElement;

    if (draggedSectionKey) {
      const sectionCard = target.closest<HTMLElement>('[data-editor-section]');
      const targetKey = sectionCard?.dataset.editorSection;
      if (!sectionCard || !targetKey) {
        setDraggedSectionKey(null);
        stopSectionDragAutoScroll();
        clearSectionDropPreview();
        return;
      }
      event.preventDefault();
      const bounds = sectionCard.getBoundingClientRect();
      const position = getSectionDropPosition(event.clientY, bounds);
      recordHistory();
      if (moveSectionRelative(state.document.sections, draggedSectionKey, targetKey, position)) {
        getRenderApp()();
      }
      setDraggedSectionKey(null);
      stopSectionDragAutoScroll();
      clearSectionDropPreview();
      return;
    }

    const activeTableDrag = draggedTableItem;
    if (!activeTableDrag) {
      return;
    }

    const section = findSectionByKey(state.document.sections, activeTableDrag.sectionKey);
    const block = section?.blocks.find((candidate) => candidate.id === activeTableDrag.blockId);
    if (!block) {
      setDraggedTableItem(null);
      clearTableRowDropPreview();
      clearTableColumnDropPreview();
      return;
    }

    if (activeTableDrag.kind === 'row') {
      const rowDrop = getMatchingTableRowDrop(target, activeTableDrag);
      const rowIndex = Number.parseInt(rowDrop?.dataset.rowIndex ?? '', 10);
      if (rowDrop && !Number.isNaN(rowIndex)) {
        event.preventDefault();
        const position = getTableRowDropPosition(event.clientY, rowDrop.getBoundingClientRect());
        const moveIndex = getTableItemMoveIndex(activeTableDrag.index, rowIndex, position, block.schema.tableRows.length);
        if (moveIndex !== activeTableDrag.index) {
          recordHistory();
          moveTableRow(block.schema, activeTableDrag.index, moveIndex);
          getRenderApp()();
        }
      }
      setDraggedTableItem(null);
      clearTableRowDropPreview();
      return;
    }

    const columnDrop = getMatchingTableColumnDrop(target, activeTableDrag);
    const columnIndex = Number.parseInt(columnDrop?.dataset.columnIndex ?? '', 10);
    if (columnDrop && !Number.isNaN(columnIndex)) {
      event.preventDefault();
      const position = getTableColumnDropPosition(event.clientX, columnDrop.getBoundingClientRect());
      const moveIndex = getTableItemMoveIndex(activeTableDrag.index, columnIndex, position, block.schema.tableColumns.length);
      if (moveIndex !== activeTableDrag.index) {
        recordHistory();
        moveTableColumn(block.schema, activeTableDrag.index, moveIndex);
        getRenderApp()();
      }
    }
    setDraggedTableItem(null);
    clearTableColumnDropPreview();
  });

  app.addEventListener('dragend', () => {
    setDraggedSectionKey(null);
    setDraggedTableItem(null);
    stopSectionDragAutoScroll();
    clearSectionDropPreview();
    clearTableRowDropPreview();
    clearTableColumnDropPreview();
  });
}

export function getSectionDropPosition(pointerY: number, sectionRect: Pick<DOMRect, 'top' | 'height'>): 'before' | 'after' {
  return pointerY < sectionRect.top + sectionRect.height / 2 ? 'before' : 'after';
}

export function getTableRowDropPosition(pointerY: number, rowRect: Pick<DOMRect, 'top' | 'height'>): 'before' | 'after' {
  return pointerY < rowRect.top + rowRect.height / 2 ? 'before' : 'after';
}

export function getTableColumnDropPosition(pointerX: number, columnRect: Pick<DOMRect, 'left' | 'width'>): 'before' | 'after' {
  return pointerX < columnRect.left + columnRect.width / 2 ? 'before' : 'after';
}

export function getTableItemMoveIndex(
  fromIndex: number,
  targetIndex: number,
  position: 'before' | 'after',
  itemCount: number
): number {
  const insertionIndex = targetIndex + (position === 'after' ? 1 : 0);
  const adjustedIndex = insertionIndex > fromIndex ? insertionIndex - 1 : insertionIndex;
  return Math.max(0, Math.min(itemCount - 1, adjustedIndex));
}

export function getTableRowDragImageSize(
  rowSize: { width: number; height: number },
  previewSize: { width: number; height: number }
): { width: number; height: number } {
  const width = rowSize.width > previewSize.width
    ? Math.min(rowSize.width, previewSize.width * 0.85)
    : rowSize.width;
  return {
    width: Math.max(1, width),
    height: Math.max(1, Math.min(rowSize.height, previewSize.height * 0.35)),
  };
}

export function calculateSectionDragAutoScrollDelta(pointerY: number, scrollerRect: Pick<DOMRect, 'top' | 'bottom'>): number {
  if (pointerY < scrollerRect.top + SECTION_DRAG_SCROLL_EDGE_PX) {
    const intensity = (SECTION_DRAG_SCROLL_EDGE_PX - (pointerY - scrollerRect.top)) / SECTION_DRAG_SCROLL_EDGE_PX;
    return -Math.max(1, Math.round(SECTION_DRAG_SCROLL_MAX_PX * Math.min(1, Math.max(0, intensity))));
  }
  if (pointerY > scrollerRect.bottom - SECTION_DRAG_SCROLL_EDGE_PX) {
    const intensity = (SECTION_DRAG_SCROLL_EDGE_PX - (scrollerRect.bottom - pointerY)) / SECTION_DRAG_SCROLL_EDGE_PX;
    return Math.max(1, Math.round(SECTION_DRAG_SCROLL_MAX_PX * Math.min(1, Math.max(0, intensity))));
  }
  return 0;
}

function updateSectionDragAutoScroll(app: HTMLElement, target: HTMLElement, pointerY: number): void {
  const scroller = findSectionDragScroller(app, target);
  if (!scroller) {
    stopSectionDragAutoScroll();
    return;
  }
  sectionDragAutoScroll.scroller = scroller;
  sectionDragAutoScroll.pointerY = pointerY;
  scheduleSectionDragAutoScroll();
}

function updateSectionDropPreview(target: HTMLElement, pointerY: number): void {
  const sectionCard = target.closest<HTMLElement>('[data-editor-section]');
  const targetKey = sectionCard?.dataset.editorSection;
  if (!sectionCard || !targetKey || targetKey === draggedSectionKey) {
    clearSectionDropPreview();
    return;
  }

  const position = getSectionDropPosition(pointerY, sectionCard.getBoundingClientRect());
  if (sectionDropPreview.card && sectionDropPreview.card !== sectionCard) {
    clearSectionDropPreview();
  }

  sectionDropPreview.card = sectionCard;
  sectionCard.classList.toggle('is-section-drop-before', position === 'before');
  sectionCard.classList.toggle('is-section-drop-after', position === 'after');
  sectionCard.dataset.sectionDropTitle = getDraggedSectionPreviewTitle();
}

function getDraggedSectionPreviewTitle(): string {
  const section = draggedSectionKey ? findSectionByKey(state.document.sections, draggedSectionKey) : null;
  const title = section?.title.trim() || section?.customId.trim() || 'Section';
  return `Move ${title}`;
}

function clearSectionDropPreview(): void {
  if (!sectionDropPreview.card) {
    return;
  }
  sectionDropPreview.card.classList.remove('is-section-drop-before', 'is-section-drop-after');
  delete sectionDropPreview.card.dataset.sectionDropTitle;
  sectionDropPreview.card = null;
}

function getMatchingTableRowDrop(
  target: HTMLElement,
  activeDrag: NonNullable<typeof draggedTableItem>
): HTMLElement | null {
  const row = target.closest<HTMLElement>('[data-table-row-drop]');
  if (
    !row
    || row.dataset.sectionKey !== activeDrag.sectionKey
    || row.dataset.blockId !== activeDrag.blockId
  ) {
    return null;
  }
  return row;
}

function updateTableRowDropPreview(row: HTMLElement, pointerY: number): void {
  const position = getTableRowDropPosition(pointerY, row.getBoundingClientRect());
  if (tableRowDropPreview.row && tableRowDropPreview.row !== row) {
    clearTableRowDropTarget();
  }
  tableRowDropPreview.row = row;
  row.classList.toggle('is-table-row-drop-before', position === 'before');
  row.classList.toggle('is-table-row-drop-after', position === 'after');
}

function clearTableRowDropTarget(): void {
  tableRowDropPreview.row?.classList.remove('is-table-row-drop-before', 'is-table-row-drop-after');
  tableRowDropPreview.row = null;
}

function createTableRowDragImage(app: HTMLElement, sourceRow: HTMLElement): HTMLElement {
  removeTableRowDragImage(tableRowDropPreview.dragImage);
  const sourceTable = sourceRow.closest<HTMLTableElement>('table');
  const bounds = sourceRow.getBoundingClientRect();
  const previewBounds = sourceRow.closest<HTMLElement>('.hvy-preview-frame')?.getBoundingClientRect()
    ?? app.getBoundingClientRect();
  const dragImageSize = getTableRowDragImageSize(bounds, previewBounds);
  const dragImage = document.createElement('div');
  dragImage.className = 'table-row-drag-image';
  dragImage.style.width = `${dragImageSize.width}px`;
  dragImage.style.height = `${dragImageSize.height}px`;
  dragImage.setAttribute('aria-hidden', 'true');
  const table = document.createElement('table');
  table.className = 'table-editor-grid table-row-drag-image-table';
  table.style.cssText = sourceTable?.style.cssText ?? '';
  table.style.width = `${bounds.width}px`;
  table.style.height = `${bounds.height}px`;
  const colgroup = sourceTable?.querySelector('colgroup')?.cloneNode(true);
  if (colgroup) {
    table.append(colgroup);
  }
  const body = document.createElement('tbody');
  const row = sourceRow.cloneNode(true) as HTMLElement;
  row.classList.remove('is-table-row-drag-source', 'is-table-row-drop-before', 'is-table-row-drop-after');
  const sourceValues = Array.from(sourceRow.querySelectorAll<HTMLElement>('[data-field="table-cell"]'));
  row.querySelectorAll<HTMLElement>('[data-field="table-cell"]').forEach((element, index) => {
    element.textContent = sourceValues[index]?.innerText || sourceValues[index]?.textContent || '';
    element.removeAttribute('data-placeholder');
    element.removeAttribute('data-placeholder-compact');
  });
  row.querySelectorAll<HTMLElement>('[contenteditable]').forEach((element) => {
    element.removeAttribute('contenteditable');
    element.removeAttribute('tabindex');
  });
  row.querySelectorAll<HTMLElement>('.table-inline-toolbar, .table-grabber-insert-menu, .table-row-remove-cell > button').forEach((element) => element.remove());
  body.append(row);
  table.append(body);
  dragImage.append(table);
  app.append(dragImage);
  tableRowDropPreview.dragImage = dragImage;
  return dragImage;
}

function removeTableRowDragImage(dragImage: HTMLElement | null): void {
  dragImage?.remove();
  if (tableRowDropPreview.dragImage === dragImage) {
    tableRowDropPreview.dragImage = null;
  }
}

function clearTableRowDropPreview(): void {
  clearTableRowDropTarget();
  tableRowDropPreview.sourceRow?.classList.remove('is-table-row-drag-source');
  tableRowDropPreview.sourceRow = null;
  removeTableRowDragImage(tableRowDropPreview.dragImage);
}

function getMatchingTableColumnDrop(
  target: HTMLElement,
  activeDrag: NonNullable<typeof draggedTableItem>
): HTMLElement | null {
  const column = target.closest<HTMLElement>('[data-table-column-drop]');
  if (
    !column
    || column.dataset.sectionKey !== activeDrag.sectionKey
    || column.dataset.blockId !== activeDrag.blockId
  ) {
    return null;
  }
  return column;
}

function updateTableColumnDropPreview(column: HTMLElement, pointerX: number): void {
  const position = getTableColumnDropPosition(pointerX, column.getBoundingClientRect());
  if (tableColumnDropPreview.column && tableColumnDropPreview.column !== column) {
    clearTableColumnDropPreview();
  }
  tableColumnDropPreview.column = column;
  const columnIndex = column.dataset.columnIndex;
  tableColumnDropPreview.cells = columnIndex === undefined
    ? [column]
    : Array.from(column.closest('table')?.querySelectorAll<HTMLElement>(`:is(th, td)[data-table-column-index="${columnIndex}"]`) ?? [column]);
  tableColumnDropPreview.cells.forEach((cell) => {
    cell.classList.toggle('is-table-column-drop-before', position === 'before');
    cell.classList.toggle('is-table-column-drop-after', position === 'after');
  });
}

function clearTableColumnDropPreview(): void {
  tableColumnDropPreview.cells.forEach((cell) => cell.classList.remove('is-table-column-drop-before', 'is-table-column-drop-after'));
  tableColumnDropPreview.column = null;
  tableColumnDropPreview.cells = [];
}

function findSectionDragScroller(app: HTMLElement, target: HTMLElement): HTMLElement | null {
  return target.closest<HTMLElement>('.editor-sidebar-panel, .editor-tree')
    ?? app.querySelector<HTMLElement>('.editor-shell .editor-tree');
}

function scheduleSectionDragAutoScroll(): void {
  if (sectionDragAutoScroll.frameId !== null) {
    return;
  }
  sectionDragAutoScroll.frameId = window.requestAnimationFrame(runSectionDragAutoScroll);
}

function runSectionDragAutoScroll(): void {
  sectionDragAutoScroll.frameId = null;
  if (!draggedSectionKey || !sectionDragAutoScroll.scroller) {
    stopSectionDragAutoScroll();
    return;
  }
  const scroller = sectionDragAutoScroll.scroller;
  const delta = calculateSectionDragAutoScrollDelta(sectionDragAutoScroll.pointerY, scroller.getBoundingClientRect());
  if (delta === 0) {
    return;
  }
  const before = scroller.scrollTop;
  scroller.scrollTop = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight, before + delta));
  if (scroller.scrollTop !== before) {
    scheduleSectionDragAutoScroll();
  }
}

function stopSectionDragAutoScroll(): void {
  if (sectionDragAutoScroll.frameId !== null) {
    window.cancelAnimationFrame(sectionDragAutoScroll.frameId);
  }
  sectionDragAutoScroll.frameId = null;
  sectionDragAutoScroll.scroller = null;
}
