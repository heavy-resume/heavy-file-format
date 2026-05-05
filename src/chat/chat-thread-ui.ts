import { state } from '../state';

let lastBoundChatMessageCount = -1;
let lastBoundChatMessageSignature = '';
let lastChatScrollTop = 0;
let wasChatNearBottom = true;
const openChatWorkDetails = new Set<string>();

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

  chatThread.querySelectorAll<HTMLDetailsElement>('[data-chat-work-details]').forEach((details) => {
    const key = details.dataset.chatWorkDetails ?? '';
    if (key && openChatWorkDetails.has(key)) {
      details.open = true;
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
    if (details.open) {
      scrollWorkDetailsToLatest(details);
    }
  });

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
      chatThread.querySelectorAll<HTMLDetailsElement>('[data-chat-work-details][open]').forEach(scrollWorkDetailsToLatest);
      lastBoundChatMessageCount = state.chat.messages.length;
      lastBoundChatMessageSignature = nextSignature;
    });
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
