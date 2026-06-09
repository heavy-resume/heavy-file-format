import { expect, test } from 'vitest';

import { isResponsiveSidebarShellCompact, updateResponsiveSidebarShellState } from '../src/responsive-sidebar-tab';

function createShell(classes: string[] = []): HTMLElement {
  const values = new Set(classes);
  return {
    classList: {
      contains: (name: string) => values.has(name),
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
  } as unknown as HTMLElement;
}

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
