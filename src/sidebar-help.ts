type SidebarHelpKind = 'editor' | 'viewer';

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

function rectsOverlap(left: DOMRect, right: DOMRect): boolean {
  return left.left < right.right
    && left.right > right.left
    && left.top < right.bottom
    && left.bottom > right.top;
}
