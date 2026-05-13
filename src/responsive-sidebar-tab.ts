import { state } from './state';
import { shouldAutoDismissSidebarHelp } from './sidebar-help';

type SidebarKind = 'editor' | 'viewer';

const sidebarTabTimers: Record<SidebarKind, { reveal: number | null; hide: number | null; lastTop: number }> = {
  editor: { reveal: null, hide: null, lastTop: 0 },
  viewer: { reveal: null, hide: null, lastTop: 0 },
};

export function revealHiddenSidebarTabFromCorner(target: HTMLElement | null, event: PointerEvent): void {
  const shell = getCompactSidebarShell(target, event);
  if (!shell || !isCompactPreviewShell(shell) || shell.classList.contains('is-sidebar-open')) {
    return;
  }
  const box = shell.getBoundingClientRect();
  const inTopLeftCorner =
    event.clientX >= box.left
    && event.clientX <= box.left + 88
    && event.clientY >= box.top
    && event.clientY <= box.top + 88;
  if (!inTopLeftCorner) {
    return;
  }
  revealSidebarTab(shell.classList.contains('editor-shell') ? 'editor' : 'viewer', shell);
}

export function peekHiddenSidebarTabFromCorner(target: HTMLElement | null, event: PointerEvent): void {
  if (event.pointerType && event.pointerType !== 'mouse') {
    return;
  }
  const shell = getCompactSidebarShell(target, event);
  if (!shell || !isCompactPreviewShell(shell) || shell.classList.contains('is-sidebar-open')) {
    return;
  }
  const kind = shell.classList.contains('editor-shell') ? 'editor' : 'viewer';
  const box = shell.getBoundingClientRect();
  const inTopLeftCorner =
    event.clientX >= box.left
    && event.clientX <= box.left + 96
    && event.clientY >= box.top
    && event.clientY <= box.top + 96;
  if (!inTopLeftCorner) {
    shell.classList.remove('is-sidebar-tab-peeking');
    return;
  }
  peekSidebarTab(kind, shell);
  scheduleSidebarTabHide(kind, shell, 1800);
}

export function handleResponsiveSidebarTabScroll(target: HTMLElement | null): void {
  const editorTree = target?.closest<HTMLElement>('.editor-tree');
  if (editorTree) {
    handleSidebarScrollable('editor', editorTree, editorTree.closest<HTMLElement>('.editor-shell'));
    return;
  }

  const readerDocument = target?.closest<HTMLElement>('.reader-document');
  if (readerDocument) {
    handleSidebarScrollable('viewer', readerDocument, readerDocument.closest<HTMLElement>('.viewer-shell'));
  }
}

function handleSidebarScrollable(kind: SidebarKind, scrollable: HTMLElement, shell: HTMLElement | null): void {
  if (!shell || !isCompactPreviewShell(shell) || shell.classList.contains('is-sidebar-open')) {
    return;
  }
  const timerState = sidebarTabTimers[kind];
  const currentTop = scrollable.scrollTop;
  const delta = currentTop - timerState.lastTop;
  timerState.lastTop = currentTop;

  if (delta < -2) {
    revealSidebarTab(kind, shell);
    scheduleSidebarTabHide(kind, shell, 5000);
    return;
  }

  if (delta > 2) {
    if (shouldAutoDismissSidebarHelp(shell, kind)) {
      dismissSidebarHelp(kind, shell);
    }
    hideSidebarTab(kind, shell);
  }

  scheduleSidebarTabReveal(kind, shell);
}

function isCompactPreviewShell(shell: HTMLElement): boolean {
  return shell.classList.contains('hvy-preview-frame-phone') || shell.classList.contains('hvy-preview-frame-tablet');
}

function getCompactSidebarShell(target: HTMLElement | null, event: PointerEvent): HTMLElement | null {
  const targetShell =
    target?.closest<HTMLElement>('.editor-shell')
    ?? target?.closest<HTMLElement>('.viewer-shell');
  if (targetShell) {
    return targetShell;
  }
  return document.elementsFromPoint(event.clientX, event.clientY)
    .map((element) => element instanceof HTMLElement ? element.closest<HTMLElement>('.editor-shell, .viewer-shell') : null)
    .find((shell): shell is HTMLElement => Boolean(shell)) ?? null;
}

function revealSidebarTab(kind: SidebarKind, shell: HTMLElement): void {
  clearSidebarTabTimer(sidebarTabTimers[kind], 'reveal');
  shell.classList.add('is-sidebar-tab-visible');
  shell.classList.remove('is-sidebar-tab-hidden');
  shell.classList.remove('is-sidebar-tab-peeking');
}

function peekSidebarTab(kind: SidebarKind, shell: HTMLElement): void {
  clearSidebarTabTimer(sidebarTabTimers[kind], 'reveal');
  if (shell.classList.contains('is-sidebar-tab-visible') || shell.querySelector('.editor-sidebar-help-balloon, .viewer-sidebar-help-balloon')) {
    return;
  }
  shell.classList.add('is-sidebar-tab-peeking');
  shell.classList.remove('is-sidebar-tab-hidden');
}

function hideSidebarTab(kind: SidebarKind, shell: HTMLElement): void {
  clearSidebarTabTimer(sidebarTabTimers[kind], 'hide');
  if (shell.querySelector('.editor-sidebar-help-balloon, .viewer-sidebar-help-balloon')) {
    return;
  }
  shell.classList.add('is-sidebar-tab-hidden');
  shell.classList.remove('is-sidebar-tab-visible');
  shell.classList.remove('is-sidebar-tab-peeking');
}

function dismissSidebarHelp(kind: SidebarKind, shell: HTMLElement): void {
  const balloon = shell.querySelector<HTMLElement>('.editor-sidebar-help-balloon, .viewer-sidebar-help-balloon');
  if (!balloon) {
    return;
  }
  balloon.remove();
  if (kind === 'editor') {
    state.editorSidebarHelpDismissed = true;
  } else {
    state.viewerSidebarHelpDismissed = true;
  }
}

function scheduleSidebarTabReveal(kind: SidebarKind, shell: HTMLElement): void {
  const timerState = sidebarTabTimers[kind];
  clearSidebarTabTimer(timerState, 'reveal');
  timerState.reveal = window.setTimeout(() => {
    timerState.reveal = null;
    if (!shell.isConnected || shell.classList.contains('is-sidebar-open')) {
      return;
    }
    revealSidebarTab(kind, shell);
    scheduleSidebarTabHide(kind, shell, 5000);
  }, 750);
}

function scheduleSidebarTabHide(kind: SidebarKind, shell: HTMLElement, delay: number): void {
  const timerState = sidebarTabTimers[kind];
  clearSidebarTabTimer(timerState, 'hide');
  timerState.hide = window.setTimeout(() => {
    timerState.hide = null;
    if (!shell.isConnected || shell.classList.contains('is-sidebar-open')) {
      return;
    }
    hideSidebarTab(kind, shell);
  }, delay);
}

function clearSidebarTabTimer(timerState: { reveal: number | null; hide: number | null }, key: 'reveal' | 'hide'): void {
  if (timerState[key] !== null) {
    window.clearTimeout(timerState[key]!);
    timerState[key] = null;
  }
}
