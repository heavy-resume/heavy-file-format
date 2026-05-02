import { state } from '../state';

let lastBoundChatMessageCount = -1;
let lastChatScrollTop = 0;
let wasChatNearBottom = true;

export function bindChatThreadUi(
  chatThread: HTMLDivElement | null,
  chatScrollContainer: HTMLDivElement | null,
  chatScrollBottomButton: HTMLButtonElement | null
): void {
  if (!chatThread || !chatScrollContainer || !chatScrollBottomButton) {
    lastBoundChatMessageCount = state.chat.messages.length;
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
    if (state.chat.messages.length !== lastBoundChatMessageCount) {
      if (wasChatNearBottom || state.chat.messages.length > lastBoundChatMessageCount) {
        chatScrollContainer.scrollTop = chatScrollContainer.scrollHeight;
      } else {
        chatScrollContainer.scrollTop = Math.min(lastChatScrollTop, chatScrollContainer.scrollHeight);
      }
    } else {
      chatScrollContainer.scrollTop = Math.min(lastChatScrollTop, chatScrollContainer.scrollHeight);
    }
    updateScrollButton();
    lastBoundChatMessageCount = state.chat.messages.length;
  });
}
