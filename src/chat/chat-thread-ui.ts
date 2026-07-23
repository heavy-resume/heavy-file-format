import { state } from '../state';

let lastBoundChatMessageCount = -1;
let lastBoundChatMessageSignature = '';
let lastChatScrollTop = 0;
let wasChatNearBottom = true;
const openChatWorkDetails = new Set<string>();
const chatExpandableBoundThreads = new WeakSet<HTMLElement>();

export type ChatThreadScrollState = {
  scrollTop: number;
  distanceFromBottom: number;
  stickToLatest: boolean;
} | null;

export function captureChatThreadScroll(root: ParentNode): ChatThreadScrollState {
  const chatScrollContainer = root.querySelector<HTMLDivElement>('[data-chat-scroll-container]');
  if (!chatScrollContainer || !state.chat.panelOpen) {
    return null;
  }
  const distanceFromBottom = chatScrollContainer.scrollHeight - chatScrollContainer.scrollTop - chatScrollContainer.clientHeight;
  return {
    scrollTop: chatScrollContainer.scrollTop,
    distanceFromBottom,
    stickToLatest: state.chat.isSending || distanceFromBottom <= 48,
  };
}

export function restoreChatThreadScroll(root: ParentNode, captured: ChatThreadScrollState): void {
  if (!captured || !state.chat.panelOpen) {
    return;
  }
  const restore = (): void => {
    const chatScrollContainer = root.querySelector<HTMLDivElement>('[data-chat-scroll-container]');
    if (!chatScrollContainer) {
      return;
    }
    if (captured.stickToLatest) {
      chatScrollContainer.scrollTop = chatScrollContainer.scrollHeight;
      return;
    }
    chatScrollContainer.scrollTop = Math.min(captured.scrollTop, chatScrollContainer.scrollHeight);
  };
  restore();
  window.requestAnimationFrame(() => {
    restore();
    window.requestAnimationFrame(restore);
  });
}

export function bindChatThreadUi(
  chatThread: HTMLDivElement | null,
  chatScrollContainer: HTMLDivElement | null,
  chatScrollBottomButton: HTMLButtonElement | null
): void {
  if (!chatThread || !chatScrollContainer || !chatScrollBottomButton) {
    if (!state.chat.panelOpen) {
      lastBoundChatMessageCount = state.chat.messages.length;
      lastBoundChatMessageSignature = chatMessageSignature();
    }
    return;
  }

  bindChatExpandableToggles(chatThread);

  const updateScrollButton = (): void => {
    const distanceFromBottom = chatScrollContainer.scrollHeight - chatScrollContainer.scrollTop - chatScrollContainer.clientHeight;
    wasChatNearBottom = distanceFromBottom <= 48;
    lastChatScrollTop = chatScrollContainer.scrollTop;
    chatScrollBottomButton.hidden = distanceFromBottom <= 32;
  };

  chatScrollContainer.addEventListener('scroll', updateScrollButton);

  chatScrollBottomButton.addEventListener('click', () => {
    chatScrollContainer.scrollTo({
      top: chatScrollContainer.scrollHeight,
      behavior: 'smooth',
    });
  });

  if (typeof chatThread.querySelectorAll === 'function') {
    chatThread.querySelectorAll<HTMLDetailsElement>('[data-chat-work-details]').forEach((details) => {
      const key = details.dataset.chatWorkDetails ?? '';
      if (key && openChatWorkDetails.has(key)) {
        details.open = true;
      }
      if (details.open) {
        scrollWorkDetailsToLatest(details);
      }
      details.addEventListener('toggle', () => {
        const nextKey = details.dataset.chatWorkDetails ?? '';
        if (!nextKey) {
          return;
        }
        if (details.open) {
          openChatWorkDetails.add(nextKey);
          scrollWorkDetailsToLatest(details);
        } else {
          openChatWorkDetails.delete(nextKey);
        }
      });
    });
  }

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      const nextSignature = chatMessageSignature();
      const messageCountChanged = state.chat.messages.length !== lastBoundChatMessageCount;
      const messageContentChanged = nextSignature !== lastBoundChatMessageSignature;
      const shouldStickToLatest = state.chat.isSending || wasChatNearBottom || state.chat.messages.length > lastBoundChatMessageCount;
      if ((messageCountChanged || messageContentChanged) && shouldStickToLatest) {
        scrollChatToLatest(chatScrollContainer);
      } else {
        chatScrollContainer.scrollTop = Math.min(lastChatScrollTop, chatScrollContainer.scrollHeight);
      }
      updateScrollButton();
      if (typeof chatThread.querySelectorAll === 'function') {
        chatThread.querySelectorAll<HTMLDetailsElement>('[data-chat-work-details][open]').forEach(scrollWorkDetailsToLatest);
      }
      lastBoundChatMessageCount = state.chat.messages.length;
      lastBoundChatMessageSignature = nextSignature;
    });
  });
}

function bindChatExpandableToggles(chatThread: HTMLElement): void {
  if (typeof chatThread.addEventListener !== 'function') {
    return;
  }
  if (chatExpandableBoundThreads.has(chatThread)) {
    return;
  }
  chatExpandableBoundThreads.add(chatThread);
  chatThread.addEventListener('click', (event) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const expandable = target?.closest<HTMLElement>('[data-chat-action="toggle-expandable"]');
    if (!expandable) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const readerEl = expandable.closest<HTMLElement>('[data-expandable-id]');
    if (!readerEl) {
      return;
    }

    const nextExpanded = expandable.getAttribute('aria-expanded') !== 'true';
    const hasStub = readerEl.dataset.chatExpandableHasStub === 'true';
    const alwaysShowStub = readerEl.dataset.chatExpandableAlwaysShowStub === 'true';

    readerEl.classList.toggle('is-expanded', nextExpanded);
    readerEl.classList.toggle('is-collapsed', !nextExpanded);
    readerEl.querySelectorAll<HTMLElement>('[data-chat-action="toggle-expandable"]').forEach((element) => {
      element.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
    });

    setChatExpandablePaneVisible(readerEl, 'stub', nextExpanded ? alwaysShowStub && hasStub : hasStub);
    setChatExpandablePaneVisible(readerEl, 'content', nextExpanded);
    setChatExpandablePaneVisible(readerEl, 'preview', !nextExpanded && !hasStub);
  });
}

function setChatExpandablePaneVisible(readerEl: HTMLElement, pane: 'stub' | 'content' | 'preview', visible: boolean): void {
  readerEl.querySelectorAll<HTMLElement>(`[data-chat-expandable-pane="${pane}"]`).forEach((element) => {
    element.hidden = !visible;
  });
}

function chatMessageSignature(): string {
  return state.chat.messages.map((message) => `${message.id}:${message.content.length}:${message.progress ? 'p' : ''}`).join('|');
}

function scrollChatToLatest(chatScrollContainer: HTMLDivElement): void {
  chatScrollContainer.scrollTop = chatScrollContainer.scrollHeight;
  window.requestAnimationFrame(() => {
    chatScrollContainer.scrollTop = chatScrollContainer.scrollHeight;
  });
}

function scrollWorkDetailsToLatest(details: HTMLDetailsElement): void {
  const scroller = details.querySelector<HTMLElement>('.chat-work-detail-scroll');
  if (!scroller) {
    return;
  }
  scroller.scrollTop = scroller.scrollHeight;
}
