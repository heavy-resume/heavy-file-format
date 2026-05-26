import { state, setDraggedSectionKey, setDraggedTableItem, draggedSectionKey, draggedTableItem, getRenderApp, findSectionByKey, moveSectionRelative, recordHistory, moveTableColumn, moveTableRow } from './_imports';

const SECTION_DRAG_SCROLL_EDGE_PX = 72;
const SECTION_DRAG_SCROLL_MAX_PX = 28;

interface SectionDragAutoScrollState {
  scroller: HTMLElement | null;
  pointerY: number;
  frameId: number | null;
}

interface SectionDropPreviewState {
  card: HTMLElement | null;
}

const sectionDragAutoScroll: SectionDragAutoScrollState = {
  scroller: null,
  pointerY: 0,
  frameId: null,
};

const sectionDropPreview: SectionDropPreviewState = {
  card: null,
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

    if (draggedTableItem?.kind === 'row' && target.closest<HTMLElement>('[data-table-row-drop]')) {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
      return;
    }

    if (draggedTableItem?.kind === 'column' && target.closest<HTMLElement>('[data-table-column-drop]')) {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
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
      return;
    }

    if (activeTableDrag.kind === 'row') {
      const rowDrop = target.closest<HTMLElement>('[data-table-row-drop]');
      const rowIndex = Number.parseInt(rowDrop?.dataset.rowIndex ?? '', 10);
      if (rowDrop && !Number.isNaN(rowIndex)) {
        event.preventDefault();
        recordHistory();
        moveTableRow(block.schema, activeTableDrag.index, rowIndex);
        getRenderApp()();
      }
      setDraggedTableItem(null);
      return;
    }

    const columnDrop = target.closest<HTMLElement>('[data-table-column-drop]');
    const columnIndex = Number.parseInt(columnDrop?.dataset.columnIndex ?? '', 10);
    if (columnDrop && !Number.isNaN(columnIndex)) {
      event.preventDefault();
      recordHistory();
      moveTableColumn(block.schema, activeTableDrag.index, columnIndex);
      getRenderApp()();
    }
    setDraggedTableItem(null);
  });

  app.addEventListener('dragend', () => {
    setDraggedSectionKey(null);
    setDraggedTableItem(null);
    stopSectionDragAutoScroll();
    clearSectionDropPreview();
  });
}

export function getSectionDropPosition(pointerY: number, sectionRect: Pick<DOMRect, 'top' | 'height'>): 'before' | 'after' {
  return pointerY < sectionRect.top + sectionRect.height / 2 ? 'before' : 'after';
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
