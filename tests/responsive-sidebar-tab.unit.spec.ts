import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import {
  handleResponsiveSidebarTabScroll,
  isResponsiveSidebarShellCompact,
  resetResponsiveSidebarTabTimersForTests,
  updateResponsiveSidebarShellState,
} from '../src/responsive-sidebar-tab';

function createShell(classes: string[] = []): HTMLElement {
  const values = new Set(classes);
  return {
    classList: {
      contains: (name: string) => values.has(name),
      add: (...names: string[]) => names.forEach((name) => values.add(name)),
      remove: (...names: string[]) => names.forEach((name) => values.delete(name)),
      toggle: (name: string, force?: boolean) => {
        if (force) {
          values.add(name);
          return true;
        }
        values.delete(name);
        return false;
      },
    },
    getBoundingClientRect: () => ({ width: 960 }),
    isConnected: true,
    querySelector: () => null,
  } as unknown as HTMLElement;
}

function createEditorTree(shell: HTMLElement, scrollTop: number): HTMLElement {
  const tree = {
    scrollTop,
    closest: (selector: string) => {
      if (selector === '.editor-tree') {
        return tree;
      }
      if (selector === '.editor-shell') {
        return shell;
      }
      return null;
    },
  };
  return tree as unknown as HTMLElement;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  });
  resetResponsiveSidebarTabTimersForTests();
});

afterEach(() => {
  resetResponsiveSidebarTabTimersForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('responsive sidebar shell becomes compact from actual shell width', () => {
  const shell = createShell();

  updateResponsiveSidebarShellState(shell, 390);

  expect(shell.classList.contains('hvy-compact-sidebar-shell')).toBe(true);
  expect(isResponsiveSidebarShellCompact(shell, 390)).toBe(true);
});

test('responsive sidebar shell clears compact tab state when actual shell is wide', () => {
  const shell = createShell([
    'hvy-compact-sidebar-shell',
    'is-sidebar-tab-hidden',
    'is-sidebar-tab-visible',
    'is-sidebar-tab-peeking',
  ]);

  updateResponsiveSidebarShellState(shell, 960);

  expect(shell.classList.contains('hvy-compact-sidebar-shell')).toBe(false);
  expect(shell.classList.contains('is-sidebar-tab-hidden')).toBe(false);
  expect(shell.classList.contains('is-sidebar-tab-visible')).toBe(false);
  expect(shell.classList.contains('is-sidebar-tab-peeking')).toBe(false);
});

test('responsive sidebar shell keeps preview frames compact independent of width', () => {
  const shell = createShell(['hvy-preview-frame-phone']);

  expect(isResponsiveSidebarShellCompact(shell, 960)).toBe(true);
});

test('responsive sidebar tab can reveal after an idle scroll event', () => {
  const shell = createShell(['editor-shell', 'is-sidebar-closed', 'hvy-preview-frame-phone']);
  const editorTree = createEditorTree(shell, 0);

  handleResponsiveSidebarTabScroll(editorTree);
  vi.advanceTimersByTime(750);

  expect(shell.classList.contains('is-sidebar-tab-visible')).toBe(true);
});

test('responsive sidebar tab can reveal after scrolling down', () => {
  const shell = createShell(['editor-shell', 'is-sidebar-closed', 'hvy-preview-frame-phone']);
  const editorTree = createEditorTree(shell, 20);

  handleResponsiveSidebarTabScroll(editorTree);
  expect(shell.classList.contains('is-sidebar-tab-hidden')).toBe(true);

  vi.advanceTimersByTime(750);
  expect(shell.classList.contains('is-sidebar-tab-visible')).toBe(true);
});

test('responsive sidebar tab can still reveal briefly after scrolling up', () => {
  const shell = createShell(['editor-shell', 'is-sidebar-closed', 'hvy-preview-frame-phone']);
  const editorTree = createEditorTree(shell, 20);

  handleResponsiveSidebarTabScroll(editorTree);
  editorTree.scrollTop = 10;
  handleResponsiveSidebarTabScroll(editorTree);
  expect(shell.classList.contains('is-sidebar-tab-visible')).toBe(true);

  vi.advanceTimersByTime(5000);
  expect(shell.classList.contains('is-sidebar-tab-hidden')).toBe(true);
});

test('responsive sidebar tab does not reappear after its auto-hide timer', () => {
  const shell = createShell(['editor-shell', 'is-sidebar-closed', 'hvy-preview-frame-phone']);
  const editorTree = createEditorTree(shell, 20);

  handleResponsiveSidebarTabScroll(editorTree);
  editorTree.scrollTop = 10;
  handleResponsiveSidebarTabScroll(editorTree);
  expect(shell.classList.contains('is-sidebar-tab-visible')).toBe(true);

  vi.advanceTimersByTime(4500);
  handleResponsiveSidebarTabScroll(editorTree);
  vi.advanceTimersByTime(500);
  expect(shell.classList.contains('is-sidebar-tab-hidden')).toBe(true);

  vi.advanceTimersByTime(750);
  expect(shell.classList.contains('is-sidebar-tab-visible')).toBe(false);
});
