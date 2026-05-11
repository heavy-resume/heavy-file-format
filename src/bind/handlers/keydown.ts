import { state, getRenderApp, handleTagEditorKeydown, applyRichAction, handleRichEditorKeydown, refreshRichToolbarState, openLinkInlineModal, closeAiEditPopover, submitAiEditRequest, handleInlineCheckboxBackspace, tagStateHelpers, findSectionByKey, createEmptyBlock, setActiveEditorBlock, recordHistory } from './_imports';
import { completeCliInput } from '../../cli-ui/completion';
import { selectAdjacentSearchResult } from '../../search/actions';
import { handleEscapeKey } from './escape';

export function bindKeydown(app: HTMLElement): void {
  app.addEventListener('keyup', (event) => {
    const target = event.target as HTMLElement;
    const richTarget = getRichTarget(target);
    if (richTarget) {
      refreshRichToolbarState(richTarget);
    }
  });

  app.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    if (handleEscapeKey(app, event)) {
      return;
    }
    if (state.search.open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      selectAdjacentSearchResult(app, event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (state.search.open && (event.key === 'Enter') && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      selectAdjacentSearchResult(app, event.shiftKey ? -1 : 1);
      return;
    }
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
    if (target instanceof HTMLInputElement && target.id === 'cliInput' && event.key === 'Tab') {
      const completed = completeCliInput({
        document: state.document,
        session: state.cliSession,
        value: target.value,
        selectionStart: target.selectionStart ?? target.value.length,
        selectionEnd: target.selectionEnd ?? target.value.length,
      });
      if (completed) {
        event.preventDefault();
        target.value = completed.value;
        target.setSelectionRange(completed.selectionStart, completed.selectionEnd);
        state.cliDraft = completed.value;
      }
      return;
    }
    if (target instanceof HTMLInputElement && handleTagEditorKeydown(event, target, tagStateHelpers)) {
      return;
    }
    if (target instanceof HTMLInputElement && target.dataset.field === 'section-title' && event.key === 'Enter') {
      event.preventDefault();
      const sectionKey = target.dataset.sectionKey;
      const section = sectionKey ? findSectionByKey(state.document.sections, sectionKey) : null;
      if (section) {
        section.title = target.value;
        if ((event.metaKey || event.ctrlKey) && section.title.trim().length > 0 && section.blocks.length === 0 && section.children.length === 0) {
          recordHistory(`section-title-heading:${section.key}`);
          const newBlock = createEmptyBlock('text');
          newBlock.text = `${'#'.repeat(getEmptySectionHeadingLevel(section.key))} ${section.title.trim()}`;
          section.blocks.push(newBlock);
          state.activeEditorSectionTitleKey = null;
          state.clearSectionTitleOnFocusKey = null;
          setActiveEditorBlock(section.key, newBlock.id);
        } else {
          state.activeEditorSectionTitleKey = null;
          state.clearSectionTitleOnFocusKey = null;
        }
        getRenderApp()();
      }
      return;
    }
    if (target.dataset.inlineText === 'true' && event.key === 'Enter') {
      event.preventDefault();
      return;
    }

    if (target instanceof HTMLElement && target.dataset.field === 'text-fill-in-value' && event.key === 'Enter') {
      event.preventDefault();
      if (event.metaKey || event.ctrlKey) {
        insertFillInLineBreak(target);
        target.dispatchEvent(new InputEvent('input', { bubbles: true }));
      } else {
        target.blur();
      }
      return;
    }

    const richTarget = getRichTarget(target);

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

    if (key === 'u') {
      event.preventDefault();
      applyRichAction('underline', richTarget);
      return;
    }

    if (key === 'k') {
      event.preventDefault();
      openLinkInlineModal(app, richTarget);
    }
  });
}

function insertFillInLineBreak(editable: HTMLElement): void {
  editable.textContent = `${(editable.textContent ?? '').replaceAll('\u200b', '')}\n\u200b`;
  const selection = window.getSelection();
  const range = document.createRange();
  const textNode = editable.firstChild;
  if (textNode?.nodeType === Node.TEXT_NODE) {
    range.setStart(textNode, Math.max(0, (textNode.textContent ?? '').length - 1));
  } else {
    range.selectNodeContents(editable);
  }
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function getRichTarget(target: HTMLElement): HTMLElement | null {
  return target.dataset.field === 'block-rich' ||
    target.dataset.field === 'block-grid-rich' ||
    target.dataset.field === 'table-details-rich' ||
    target.dataset.field === 'table-column' ||
    target.dataset.field === 'table-cell'
    ? target
    : target.closest<HTMLElement>(
        '[data-field="block-rich"], [data-field="block-grid-rich"], [data-field="table-details-rich"], [data-field="table-column"], [data-field="table-cell"]'
      );
}

function getEmptySectionHeadingLevel(sectionKey: string): 1 | 2 | 3 {
  const value = state.addComponentBySection[`empty-heading:${sectionKey}`];
  if (value === 'h2') {
    return 2;
  }
  if (value === 'h3') {
    return 3;
  }
  return 1;
}
