import type { HistoryEditorContext } from './history';

const HISTORY_SCROLL_TIMEOUT_MS = 900;

export async function prepareHistoryViewportTransition(
  context: HistoryEditorContext | null,
  preferredRoot?: HTMLElement | null,
): Promise<void> {
  if (!context || typeof document === 'undefined') {
    return;
  }
  const root = resolveHistoryRoot(context, preferredRoot);
  if (!root) {
    return;
  }
  const target = resolveHistoryTarget(root, context);
  const scrollContainer = target?.closest<HTMLElement>(
    '.editor-shell .editor-tree, .editor-sidebar-panel, .reader-document, .viewer-sidebar-panel, .full-pane'
  );
  if (!target || !scrollContainer || isFullyVisible(target, scrollContainer)) {
    return;
  }
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    centerTarget(target, scrollContainer, 'auto');
    return;
  }
  const destination = centerTarget(target, scrollContainer, 'smooth');
  await waitForScrollDestination(scrollContainer, destination);
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
): number {
  const targetRect = target.getBoundingClientRect();
  const containerRect = scrollContainer.getBoundingClientRect();
  const destination = Math.min(
    Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight),
    Math.max(
      0,
      scrollContainer.scrollTop
        + targetRect.top
        - containerRect.top
        - (scrollContainer.clientHeight - targetRect.height) / 2
    )
  );
  scrollContainer.scrollTo({
    top: destination,
    behavior,
  });
  return destination;
}

function waitForScrollDestination(scrollContainer: HTMLElement, destination: number): Promise<void> {
  const startedAt = performance.now();
  let settledFrames = 0;
  return new Promise((resolve) => {
    const check = (): void => {
      settledFrames = Math.abs(scrollContainer.scrollTop - destination) <= 1 ? settledFrames + 1 : 0;
      if (settledFrames >= 2 || performance.now() - startedAt >= HISTORY_SCROLL_TIMEOUT_MS) {
        resolve();
        return;
      }
      window.requestAnimationFrame(check);
    };
    window.requestAnimationFrame(check);
  });
}
