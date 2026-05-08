import { state, getRenderApp, handleDbTableFrameScroll } from './_imports';

type SidebarKind = 'editor' | 'viewer';

const sidebarTabTimers: Record<SidebarKind, { reveal: number | null; hide: number | null; lastTop: number }> = {
  editor: { reveal: null, hide: null, lastTop: 0 },
  viewer: { reveal: null, hide: null, lastTop: 0 },
};

export function bindScrollHandler(app: HTMLElement): void {
  app.addEventListener('scroll', (event) => {
    const target = event.target as HTMLElement | null;
    handleResponsiveSidebarTabScroll(target);
    const frame = target?.closest<HTMLElement>('[data-db-table-frame="true"]');
    if (!frame) {
      return;
    }
    if (!handleDbTableFrameScroll(frame)) {
      return;
    }
    getRenderApp()();
  }, true);
}

function handleResponsiveSidebarTabScroll(target: HTMLElement | null): void {
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
    dismissSidebarHelp(kind, shell);
    hideSidebarTab(kind, shell);
  }

  scheduleSidebarTabReveal(kind, shell);
}

function isCompactPreviewShell(shell: HTMLElement): boolean {
  return shell.classList.contains('hvy-preview-frame-phone') || shell.classList.contains('hvy-preview-frame-tablet');
}

function revealSidebarTab(kind: SidebarKind, shell: HTMLElement): void {
  clearSidebarTabTimer(sidebarTabTimers[kind], 'reveal');
  shell.classList.add('is-sidebar-tab-visible');
  shell.classList.remove('is-sidebar-tab-hidden');
}

function hideSidebarTab(kind: SidebarKind, shell: HTMLElement): void {
  clearSidebarTabTimer(sidebarTabTimers[kind], 'hide');
  if (shell.querySelector('.editor-sidebar-help-balloon, .viewer-sidebar-help-balloon')) {
    return;
  }
  shell.classList.add('is-sidebar-tab-hidden');
  shell.classList.remove('is-sidebar-tab-visible');
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
