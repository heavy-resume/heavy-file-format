import { expect, test, vi } from 'vitest';

import { capturePaneScroll } from '../src/scroll';
import type { PaneScrollState } from '../src/types';

test('capturePaneScroll preserves viewer sidebar scroll position', () => {
  const previous: PaneScrollState = {
    editorTop: 1,
    editorSidebarTop: 2,
    viewerSidebarTop: 3,
    readerTop: 4,
    windowTop: 5,
  };
  const elementsBySelector = new Map<string, { scrollTop: number }>([
    ['.viewer-sidebar-panel', { scrollTop: 321 }],
    ['.viewer-shell .reader-document', { scrollTop: 654 }],
  ]);
  const app = {
    querySelector: vi.fn((selector: string) => elementsBySelector.get(selector) ?? null),
  } as unknown as HTMLElement;
  vi.stubGlobal('window', { scrollY: 987 });

  const result = capturePaneScroll(previous, app);

  expect(result).toEqual({
    editorTop: 1,
    editorSidebarTop: 2,
    viewerSidebarTop: 321,
    readerTop: 654,
    windowTop: 987,
  });
  vi.unstubAllGlobals();
});
