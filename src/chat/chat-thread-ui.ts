import { state } from '../state';

let lastBoundChatMessageCount = -1;
let lastBoundChatMessageSignature = '';
let lastChatScrollTop = 0;
let wasChatNearBottom = true;

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
