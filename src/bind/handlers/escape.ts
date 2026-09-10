import { closeChatPanel } from '../../chat/chat';
import { closeActiveSidebar } from '../../navigation';
import { closeSearch } from '../../search/actions';
import { closeAiEditPopover } from '../../ai-edit-popover';
import { closeModal } from '../../navigation';
import { getRenderApp, state } from '../../state';
import { dismissTextToolbarForEscape } from '../../editor/components/text/text-toolbar-layout';

function dismissDetailsPopoverForEscape(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : null;
  const details = element?.closest<HTMLDetailsElement>('details[data-escape-closes="true"][open]');
  if (!details) {
    return false;
  }
  details.open = false;
  details.querySelector<HTMLElement>(':scope > summary')?.focus({ preventScroll: true });
  return true;
}

function finishActiveEditorBlockForEscape(app: HTMLElement, target: EventTarget | null): boolean {
  const targetElement = target instanceof Element ? target : null;
  const activeBlock = targetElement?.closest<HTMLElement>('.editor-block[data-active-editor-block="true"]')
    ?? app.querySelector<HTMLElement>('.editor-block[data-active-editor-block="true"]');
  const doneButton = activeBlock?.querySelector<HTMLButtonElement>(
    ':scope > .editor-block-done-row > .editor-block-done-button'
  );
  if (!doneButton) {
    return false;
  }
  doneButton.click();
  return true;
}

export function handleEscapeKey(app: HTMLElement, event: KeyboardEvent): boolean {
  if (event.key !== 'Escape') {
    return false;
  }
  if (app.querySelector('#modalRoot')) {
    event.preventDefault();
    event.stopPropagation();
    closeModal();
    getRenderApp()();
    return true;
  }
  if (state.search.open) {
    event.preventDefault();
    event.stopPropagation();
    closeSearch(app);
    return true;
  }
  if (dismissDetailsPopoverForEscape(event.target)) {
    event.preventDefault();
    event.stopPropagation();
    return true;
  }
  if (state.chat.panelOpen) {
    event.preventDefault();
    event.stopPropagation();
    closeChatPanel(state.chat);
    getRenderApp()();
    return true;
  }
  if (dismissTextToolbarForEscape(event.target)) {
    event.preventDefault();
    event.stopPropagation();
    return true;
  }
  if (closeActiveSidebar(app)) {
    event.preventDefault();
    event.stopPropagation();
    return true;
  }
  if (state.aiEdit.sectionKey && state.aiEdit.blockId && !state.aiEdit.isSending) {
    event.preventDefault();
    event.stopPropagation();
    closeAiEditPopover();
    getRenderApp()();
    return true;
  }
  if (finishActiveEditorBlockForEscape(app, event.target)) {
    event.preventDefault();
    event.stopPropagation();
    return true;
  }
  return false;
}
