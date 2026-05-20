import { captureChatThreadScroll, restoreChatThreadScroll, type ChatThreadScrollState } from './chat/chat-thread-ui';
import { capturePaneScroll, restorePaneScroll } from './scroll';
import type { PaneScrollState } from './types';

interface RenderScrollState {
  paneScroll: PaneScrollState;
  chatScroll: ChatThreadScrollState;
}

export function captureRenderScroll(
  root: HTMLElement,
  previousPaneScroll: PaneScrollState,
  paneScrollOverride: PaneScrollState | null = null
): RenderScrollState {
  return {
    paneScroll: paneScrollOverride ?? capturePaneScroll(previousPaneScroll, root),
    chatScroll: captureChatThreadScroll(root),
  };
}

export function restoreRenderScroll(root: HTMLElement, captured: RenderScrollState): void {
  restorePaneScroll(captured.paneScroll, root);
  restoreChatThreadScroll(root, captured.chatScroll);
}
