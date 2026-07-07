import { closeChatPanel } from '../../chat/chat';
import { closeActiveSidebar } from '../../navigation';
import { closeSearch } from '../../search/actions';
import { closeAiEditPopover } from '../../ai-edit-popover';
import { getRenderApp, state } from '../../state';

export function handleEscapeKey(app: HTMLElement, event: KeyboardEvent): boolean {
  if (event.key !== 'Escape') {
    return false;
  }
  if (state.search.open) {
    event.preventDefault();
    event.stopPropagation();
    closeSearch(app);
    return true;
  }
  if (state.chat.panelOpen) {
    event.preventDefault();
    event.stopPropagation();
    closeChatPanel(state.chat);
    getRenderApp()();
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
  return false;
}
