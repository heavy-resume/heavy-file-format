import { state } from './state';

type SidebarHelpKind = 'editor' | 'viewer';
type SidebarHelpTimers = Record<SidebarHelpKind, number | null>;

const sidebarHelpDismissTimersByApp = new WeakMap<HTMLElement, SidebarHelpTimers>();

function getSidebarHelpTimers(app: HTMLElement): SidebarHelpTimers {
  let timers = sidebarHelpDismissTimersByApp.get(app);
  if (!timers) {
    timers = {
      editor: null,
      viewer: null,
    };
    sidebarHelpDismissTimersByApp.set(app, timers);
  }
  return timers;
}

export function shouldAutoDismissSidebarHelp(shell: HTMLElement | null, kind: SidebarHelpKind): boolean {
  if (!shell) {
    return true;
  }
  const balloon = shell.querySelector<HTMLElement>(kind === 'editor' ? '.editor-sidebar-help-balloon' : '.viewer-sidebar-help-balloon');
  const body = shell.querySelector<HTMLElement>(
    kind === 'editor'
      ? ':scope .editor-tree > .hvy-surface > .editor-tree-body'
      : ':scope .reader-document > .hvy-surface > .reader-document-body'
  );
  if (!balloon || !body) {
    return true;
  }

  const balloonRect = balloon.getBoundingClientRect();
  const bodyRect = body.getBoundingClientRect();
  if (balloonRect.width <= 0 || balloonRect.height <= 0 || bodyRect.width <= 0 || bodyRect.height <= 0) {
    return true;
  }

  return rectsOverlap(balloonRect, bodyRect);
}

export function scheduleSidebarHelpAutoClose(app: HTMLElement): void {
  scheduleSidebarHelpAutoCloseFor(app, 'editor');
  scheduleSidebarHelpAutoCloseFor(app, 'viewer');
}

export function dismissSidebarHelpBalloon(app: HTMLElement, kind: SidebarHelpKind): void {
  const timers = getSidebarHelpTimers(app);
  if (timers[kind] !== null) {
    window.clearTimeout(timers[kind]!);
    timers[kind] = null;
  }
  const balloon = app.querySelector<HTMLElement>(getSidebarHelpSelector(kind));
  if (!balloon || balloon.classList.contains('is-closing')) {
    setSidebarHelpDismissed(kind);
    return;
  }
  balloon.classList.add('is-closing');
  window.setTimeout(() => {
    setSidebarHelpDismissed(kind);
    balloon.remove();
  }, 180);
}

function scheduleSidebarHelpAutoCloseFor(app: HTMLElement, kind: SidebarHelpKind): void {
  const timers = getSidebarHelpTimers(app);
  if (timers[kind] !== null) {
    window.clearTimeout(timers[kind]!);
    timers[kind] = null;
  }
  if (getSidebarHelpDismissed(kind) || !app.querySelector(getSidebarHelpSelector(kind))) {
    return;
  }
  timers[kind] = window.setTimeout(() => {
    timers[kind] = null;
    const shell = app.querySelector<HTMLElement>(kind === 'editor' ? '.editor-shell' : '.viewer-shell');
    if (!shouldAutoDismissSidebarHelp(shell, kind)) {
      return;
    }
    dismissSidebarHelpBalloon(app, kind);
  }, 5000);
}

function getSidebarHelpSelector(kind: SidebarHelpKind): string {
  return kind === 'editor' ? '.editor-sidebar-help-balloon' : '.viewer-sidebar-help-balloon';
}

function getSidebarHelpDismissed(kind: SidebarHelpKind): boolean {
  return kind === 'editor' ? state.editorSidebarHelpDismissed : state.viewerSidebarHelpDismissed;
}

function setSidebarHelpDismissed(kind: SidebarHelpKind): void {
  if (kind === 'editor') {
    state.editorSidebarHelpDismissed = true;
  } else {
    state.viewerSidebarHelpDismissed = true;
  }
}

function rectsOverlap(left: DOMRect, right: DOMRect): boolean {
  return left.left < right.right
    && left.right > right.left
    && left.top < right.bottom
    && left.bottom > right.top;
}
