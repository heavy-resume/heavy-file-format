import { state, getRenderApp, handleTagEditorKeydown, applyRichAction, handleRichEditorKeydown, openLinkInlineModal, closeAiEditPopover, submitAiEditRequest, handleInlineCheckboxBackspace, tagStateHelpers } from './_imports';

export function bindKeydown(app: HTMLElement): void {
  app.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    if (event.key === 'Escape' && state.aiEdit.sectionKey && state.aiEdit.blockId && !state.aiEdit.isSending) {
      closeAiEditPopover();
      getRenderApp()();
      return;
    }
    if (
      target instanceof HTMLTextAreaElement &&
      target.dataset.field === 'chat-input' &&
      event.key === 'Enter' &&
      !event.shiftKey
    ) {
      event.preventDefault();
      target.closest('form')?.requestSubmit();
      return;
    }
    if (
      target instanceof HTMLTextAreaElement &&
      target.dataset.field === 'ai-edit-input' &&
      event.key === 'Enter' &&
      !event.shiftKey
    ) {
      event.preventDefault();
      void submitAiEditRequest();
      return;
    }
    if (target instanceof HTMLInputElement && handleTagEditorKeydown(event, target, tagStateHelpers)) {
      return;
    }
    if (target.dataset.inlineText === 'true' && event.key === 'Enter') {
      event.preventDefault();
      return;
    }

    const richTarget =
      target.dataset.field === 'block-rich' ||
      target.dataset.field === 'block-grid-rich' ||
      target.dataset.field === 'table-details-rich'
        ? target
        : target.closest<HTMLElement>(
            '[data-field="block-rich"], [data-field="block-grid-rich"], [data-field="table-details-rich"]'
          );

    if (!richTarget) {
      return;
    }

    if (event.key === 'Backspace' && handleInlineCheckboxBackspace(richTarget)) {
      event.preventDefault();
      richTarget.dispatchEvent(new InputEvent('input', { bubbles: true }));
      return;
    }

    if (handleRichEditorKeydown(event, richTarget)) {
      return;
    }

    const meta = event.metaKey || event.ctrlKey;
    if (!meta) {
      return;
    }

    const key = event.key.toLowerCase();
    if (key === 'b') {
      event.preventDefault();
      applyRichAction('bold', richTarget);
      return;
    }

    if (key === 'i') {
      event.preventDefault();
      applyRichAction('italic', richTarget);
      return;
    }

    if (key === 'k') {
      event.preventDefault();
      openLinkInlineModal(app, richTarget);
    }
  });
}
