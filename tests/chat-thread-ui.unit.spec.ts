import { expect, test, vi } from 'vitest';

import { bindChatThreadUi } from '../src/chat/chat-thread-ui';
import { createDefaultChatState } from '../src/chat/chat';
import { initState } from '../src/state';

function makeScrollContainer() {
  const listeners = new Map<string, () => void>();
  return {
    scrollTop: 140,
    scrollHeight: 500,
    clientHeight: 200,
    addEventListener: vi.fn((event: string, listener: () => void) => {
      listeners.set(event, listener);
    }),
    scrollTo: vi.fn(),
    trigger: (event: string) => listeners.get(event)?.(),
  };
}

test('bindChatThreadUi restores scroll when chat rerenders without new messages', () => {
  const chat = createDefaultChatState();
  chat.messages = [{ id: 'm1', role: 'assistant', content: 'One' }];
  initState({ chat } as never);
  vi.stubGlobal('window', {
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    },
  });

  const firstContainer = makeScrollContainer();
  bindChatThreadUi({} as HTMLDivElement, firstContainer as unknown as HTMLDivElement, { hidden: true, addEventListener: vi.fn() } as unknown as HTMLButtonElement);
  firstContainer.scrollTop = 160;
  firstContainer.trigger('scroll');

  const rerenderedContainer = makeScrollContainer();
  rerenderedContainer.scrollTop = 0;
  bindChatThreadUi({} as HTMLDivElement, rerenderedContainer as unknown as HTMLDivElement, { hidden: true, addEventListener: vi.fn() } as unknown as HTMLButtonElement);

  expect(rerenderedContainer.scrollTop).toBe(160);
  vi.unstubAllGlobals();
});

test('bindChatThreadUi waits for two frames before restoring scroll', () => {
  const chat = createDefaultChatState();
  chat.messages = [
    { id: 'm1', role: 'assistant', content: 'One' },
    { id: 'm2', role: 'assistant', content: 'Two' },
  ];
  initState({ chat } as never);
  const frameCallbacks: FrameRequestCallback[] = [];
  vi.stubGlobal('window', {
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    },
  });

  const container = makeScrollContainer();
  container.scrollTop = 0;
  bindChatThreadUi({} as HTMLDivElement, container as unknown as HTMLDivElement, { hidden: true, addEventListener: vi.fn() } as unknown as HTMLButtonElement);

  expect(container.scrollTop).toBe(0);
  frameCallbacks.shift()?.(0);
  expect(container.scrollTop).toBe(0);
  frameCallbacks.shift()?.(16);
  expect(container.scrollTop).toBe(500);
  vi.unstubAllGlobals();
});
