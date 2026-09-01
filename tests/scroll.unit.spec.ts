import { expect, test, vi } from 'vitest';

import { captureElementScrollAnchor, capturePaneScroll, restoreElementScrollAnchor } from '../src/scroll';
import type { PaneScrollState } from '../src/types';

test('capturePaneScroll preserves viewer sidebar scroll position', () => {
  const previous: PaneScrollState = {
    fullPaneTop: 7,
    editorTop: 1,
    editorSidebarTop: 2,
    viewerSidebarTop: 3,
    readerTop: 4,
    windowLeft: 6,
    windowTop: 5,
  };
  const elementsBySelector = new Map<string, { scrollTop: number }>([
    ['.full-pane', { scrollTop: 123 }],
    ['.viewer-sidebar-panel', { scrollTop: 321 }],
    ['.viewer-shell .reader-document', { scrollTop: 654 }],
  ]);
  const app = {
    querySelector: vi.fn((selector: string) => elementsBySelector.get(selector) ?? null),
  } as unknown as HTMLElement;
  vi.stubGlobal('window', { scrollX: 789, scrollY: 987 });

  const result = capturePaneScroll(previous, app);

  expect(result).toEqual({
    fullPaneTop: 123,
    editorTop: 1,
    editorSidebarTop: 2,
    viewerSidebarTop: 321,
    readerTop: 654,
    windowLeft: 789,
    windowTop: 987,
  });
  vi.unstubAllGlobals();
});

test('element scroll anchors preserve the element viewport position after a structural render', () => {
  const scrollContainer = {
    classList: { contains: (name: string) => name === 'editor-tree' },
    scrollTop: 200,
  };
  let layoutTop = 440;
  const element = {
    closest: vi.fn(() => scrollContainer),
    getBoundingClientRect: vi.fn(() => ({ top: layoutTop - scrollContainer.scrollTop })),
  };
  const root = {
    contains: vi.fn(() => true),
    querySelector: vi.fn((selector: string) => selector === '.editor-shell .editor-tree' ? scrollContainer : element),
  } as unknown as HTMLElement;
  vi.stubGlobal('window', { requestAnimationFrame: (callback: FrameRequestCallback) => callback(0) });

  const anchor = captureElementScrollAnchor(root, element as unknown as HTMLElement, '[data-anchor="expected"]');
  layoutTop = 495;
  restoreElementScrollAnchor(root, anchor);

  expect(scrollContainer.scrollTop).toBe(255);
  vi.unstubAllGlobals();
});
