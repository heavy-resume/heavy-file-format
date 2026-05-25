import { state, getRenderApp, getRefreshReaderPanels, commitTagEditorDraft, findBlockByIds, findSectionByKey, commitInlineTableEdit, recordHistory, refreshRichToolbarState, resolveBlockContext, deactivateEditorBlock, tagStateHelpers, assignSectionTitleAndGeneratedId } from './_imports';
import { commitTextFillInElement } from '../../text-fill-in-commit';
import { runDocumentEditHooksAfterCommit } from '../../document-edit-hooks';

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
    if (target.dataset.field === 'text-fill-in-value') {
      commitTextFillInElement(target, 'focusout');
      const editor = target.closest<HTMLElement>('.text-fill-in-editor');
      const nextTarget = event.relatedTarget instanceof HTMLElement ? event.relatedTarget : null;
      if (editor && nextTarget && editor.contains(nextTarget)) {
        return;
      }
      const context = resolveBlockContext(target);
      const sectionKey = target.dataset.sectionKey ?? '';
      const blockId = target.dataset.blockId ?? '';
      if (context && sectionKey && blockId && !context.block.schema.fillIn) {
        deferCompletedFillInDeactivation(sectionKey, blockId);
      }
      return;
    }
    if (target.dataset.field === 'table-cell' || target.dataset.field === 'table-column') {
      commitInlineTableEdit(target);
    }
    if (target instanceof HTMLInputElement) {
      commitTagEditorDraft(target, tagStateHelpers);
      if (target.dataset.field === 'section-title') {
        const sectionKey = target.dataset.sectionKey;
        const section = sectionKey ? findSectionByKey(state.document.sections, sectionKey) : null;
        if (section && target.value.trim().length === 0) {
          assignSectionTitleAndGeneratedId(state.document.sections, section, 'Unnamed Section');
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

function deferCompletedFillInDeactivation(sectionKey: string, blockId: string): void {
  window.setTimeout(() => {
    const block = findBlockByIds(sectionKey, blockId);
    if (!block || block.schema.fillIn) {
      return;
    }
    if (deactivateEditorBlock(sectionKey, blockId) === 'unchanged') {
      return;
    }
    runDocumentEditHooksAfterCommit();
    getRefreshReaderPanels()();
    getRenderApp()();
  }, 0);
}
