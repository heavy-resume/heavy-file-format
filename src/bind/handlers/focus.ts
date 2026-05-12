import { state, getRenderApp, commitTagEditorDraft, findSectionByKey, commitInlineTableEdit, recordHistory, refreshRichToolbarState, tagStateHelpers } from './_imports';

export function bindFocus(app: HTMLElement): void {
  app.addEventListener('focusin', (event) => {
    const target = event.target as HTMLElement;
    if (target.dataset.field !== 'table-cell' && target.dataset.field !== 'table-column') {
      return;
    }
    const sectionKey = target.dataset.sectionKey ?? '';
    const blockId = target.dataset.blockId ?? '';
    const rowIndex = target.dataset.rowIndex ?? '';
    const cellIndex = target.dataset.cellIndex ?? '';
    const columnIndex = target.dataset.columnIndex ?? '';
    recordHistory(`table-edit:${sectionKey}:${blockId}:${rowIndex}:${cellIndex}:${columnIndex}`);
    requestAnimationFrame(() => refreshRichToolbarState(target));
  });

  app.addEventListener('focusout', (event) => {
    const rawTarget = event.target as HTMLElement;
    const target = rawTarget.dataset.field ? rawTarget : rawTarget.closest<HTMLElement>('[data-field]') ?? rawTarget;
    if (target.dataset.field === 'table-cell' || target.dataset.field === 'table-column') {
      commitInlineTableEdit(target);
    }
    if (target instanceof HTMLInputElement) {
      commitTagEditorDraft(target, tagStateHelpers);
      if (target.dataset.field === 'section-title') {
        const sectionKey = target.dataset.sectionKey;
        const section = sectionKey ? findSectionByKey(state.document.sections, sectionKey) : null;
        if (section && target.value.trim().length === 0) {
          section.title = 'Unnamed Section';
        }
        state.activeEditorSectionTitleKey = null;
        state.clearSectionTitleOnFocusKey = null;
        const nextTarget = event.relatedTarget instanceof HTMLElement ? event.relatedTarget : null;
        if (nextTarget?.closest('.component-picker, [data-action="add-block"]')) {
          return;
        }
        getRenderApp()();
      }
    }
  });
}
