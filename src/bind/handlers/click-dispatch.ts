import { state, findSectionByKey, getReusableNameFromSectionKey, applyRichAction, openLinkInlineModal } from './_imports';
import { actionRegistry } from '../actions/registry';

export function bindClickDispatch(app: HTMLElement): void {
  app.addEventListener('mousedown', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-rich-action]')) {
      event.preventDefault();
    }
  });

  app.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;

    if (target.closest('select') || target.closest('input')) {
      return;
    }

    const richButton = target.closest<HTMLElement>('[data-rich-action]');
    if (richButton) {
      event.preventDefault();
      const sectionKey = richButton.dataset.sectionKey;
      const blockId = richButton.dataset.blockId;
      const action = richButton.dataset.richAction;
      const richField = richButton.dataset.richField ?? 'block-rich';
      const gridItemId = richButton.dataset.gridItemId;
      const rowIndex = richButton.dataset.rowIndex;
      if (sectionKey && blockId && action) {
        const selectorBase = `[data-section-key="${sectionKey}"][data-block-id="${blockId}"][data-field="${richField}"]`;
        const editable = rowIndex
          ? app.querySelector<HTMLElement>(`${selectorBase}[data-row-index="${rowIndex}"]`)
          : gridItemId
          ? app.querySelector<HTMLElement>(`${selectorBase}[data-grid-item-id="${gridItemId}"]`)
          : app.querySelector<HTMLElement>(selectorBase);
        if (editable) {
          if (action === 'link') {
            openLinkInlineModal(app, editable);
            return;
          }
          if (!editable.contains(document.activeElement)) {
            editable.focus();
          }
          applyRichAction(action, editable);
        }
      }
      return;
    }

    const actionButton = target.closest<HTMLElement>('[data-action]');
    if (!actionButton) {
      return;
    }

    const action = actionButton.dataset.action;
    if (!action) {
      return;
    }

    const handler = actionRegistry[action];
    if (!handler) {
      return;
    }

    const sectionKey = actionButton.dataset.sectionKey ?? '';
    const blockId = actionButton.dataset.blockId ?? '';

    if (action === 'add-top-level-section') {
      handler({ app, actionButton, sectionKey, blockId, section: null, reusableName: null });
      return;
    }

    if (sectionKey.length === 0) {
      return;
    }

    const reusableName = getReusableNameFromSectionKey(sectionKey);
    const section = reusableName ? null : findSectionByKey(state.document.sections, sectionKey);
    if (!section && !reusableName) {
      return;
    }

    handler({ app, actionButton, sectionKey, blockId, section, reusableName });
  });
}
