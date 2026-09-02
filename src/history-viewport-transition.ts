import type { HistoryEditorContext } from './history';

export interface HistoryViewportTransition {
  context: HistoryEditorContext;
  root: HTMLElement;
}

const HISTORY_SCROLL_TIMEOUT_MS = 600;

export async function prepareHistoryViewportTransition(
  context: HistoryEditorContext | null,
  preferredRoot?: HTMLElement | null,
): Promise<HistoryViewportTransition | null> {
  if (!context || typeof document === 'undefined') {
    return null;
  }
  const root = resolveHistoryRoot(context, preferredRoot);
  if (!root) {
    return null;
  }
  const target = resolveHistoryTarget(root, context);
  const scrollContainer = target?.closest<HTMLElement>(
    '.editor-shell .editor-tree, .editor-sidebar-panel, .reader-document, .viewer-sidebar-panel, .full-pane'
  );
  if (!target || !scrollContainer || isFullyVisible(target, scrollContainer)) {
    return { context, root };
  }
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    centerTarget(target, scrollContainer, 'auto');
    return { context, root };
  }
  centerTarget(target, scrollContainer, 'smooth');
  await waitForScrollTarget(target, scrollContainer);
  return { context, root };
}

export function animateHistoryRestore(
  action: 'undo' | 'redo',
  transition: HistoryViewportTransition | null,
): void {
  if (!transition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return;
  }
  const target = resolveHistoryTarget(transition.root, transition.context);
  if (!target || typeof target.animate !== 'function') {
    return;
  }
  const animation = target.animate([
    { opacity: 0.45, transform: 'scale(0.985)' },
    { opacity: 1, transform: 'scale(1)' },
  ], {
    duration: 220,
    easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  });
  animation.id = `hvy-history-${action}`;
}

function resolveHistoryRoot(
  context: HistoryEditorContext,
  preferredRoot?: HTMLElement | null,
): HTMLElement | null {
  if (preferredRoot?.isConnected && resolveHistoryTarget(preferredRoot, context)) {
    return preferredRoot;
  }
  const activeRoot = document.activeElement instanceof HTMLElement
    ? document.activeElement.closest<HTMLElement>('.hvy-document')
    : null;
  if (activeRoot && resolveHistoryTarget(activeRoot, context)) {
    return activeRoot;
  }
  return Array.from(document.querySelectorAll<HTMLElement>('.hvy-document'))
    .find((candidate) => Boolean(resolveHistoryTarget(candidate, context))) ?? null;
}

function resolveHistoryTarget(root: HTMLElement, context: HistoryEditorContext): HTMLElement | null {
  const scope = context.sectionKey && context.blockId
    ? root.querySelector<HTMLElement>(
        `[data-editor-section="${CSS.escape(context.sectionKey)}"] `
        + `:is(.editor-block, .editor-block-passive)[data-block-id="${CSS.escape(context.blockId)}"]`
      )
    : context.sectionKey
      ? root.querySelector<HTMLElement>(`[data-editor-section="${CSS.escape(context.sectionKey)}"]`)
    : root;
  if (!scope) {
    return null;
  }
  const { preferredEditorTarget: preferred } = context;
  if (!preferred) {
    return scope;
  }
  const fields = scope.querySelectorAll<HTMLElement>(`[data-field="${CSS.escape(preferred.field)}"]`);
  return fields.item(preferred.fieldIndex ?? 0) ?? scope;
}

function isFullyVisible(target: HTMLElement, scrollContainer: HTMLElement): boolean {
  const targetRect = target.getBoundingClientRect();
  const containerRect = scrollContainer.getBoundingClientRect();
  const visibleTop = containerRect.top + scrollContainer.clientTop;
  const visibleBottom = visibleTop + scrollContainer.clientHeight;
  return targetRect.top >= visibleTop && targetRect.bottom <= visibleBottom;
}

function centerTarget(
  target: HTMLElement,
  scrollContainer: HTMLElement,
  behavior: ScrollBehavior,
): void {
  const targetRect = target.getBoundingClientRect();
  const containerRect = scrollContainer.getBoundingClientRect();
  scrollContainer.scrollTo({
    top: Math.max(
      0,
      scrollContainer.scrollTop
        + targetRect.top
        - containerRect.top
        - (scrollContainer.clientHeight - targetRect.height) / 2
    ),
    behavior,
  });
}

function waitForScrollTarget(target: HTMLElement, scrollContainer: HTMLElement): Promise<void> {
  const startedAt = performance.now();
  let visibleFrames = 0;
  return new Promise((resolve) => {
    const check = (): void => {
      visibleFrames = isFullyVisible(target, scrollContainer) ? visibleFrames + 1 : 0;
      if (visibleFrames >= 2 || performance.now() - startedAt >= HISTORY_SCROLL_TIMEOUT_MS) {
        resolve();
        return;
      }
      window.requestAnimationFrame(check);
    };
    window.requestAnimationFrame(check);
  });
}
