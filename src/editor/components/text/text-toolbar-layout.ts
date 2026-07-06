const textToolbarResizeObservers = new WeakMap<HTMLElement, ResizeObserver>();
const textToolbarPendingMeasurements = new WeakMap<HTMLElement, {
  frame: number | null;
  observer: MutationObserver | null;
  retries: number;
}>();

const MAX_CONNECTED_MEASURE_RETRIES = 6;

export function syncTextToolbarLayout(root: ParentNode): void {
  const shells = root instanceof HTMLElement && root.matches('.text-editor-shell')
    ? [root, ...Array.from(root.querySelectorAll<HTMLElement>('.text-editor-shell'))]
    : Array.from(root.querySelectorAll<HTMLElement>('.text-editor-shell'));
  shells.forEach((shell) => {
    const toolbar = shell.querySelector<HTMLElement>('.text-editor-toolbar-slot > .rich-toolbar');
    if (!toolbar) {
      clearPendingTextToolbarMeasurement(shell);
      textToolbarResizeObservers.get(shell)?.disconnect();
      textToolbarResizeObservers.delete(shell);
      shell.style.removeProperty('--text-editor-toolbar-height');
      return;
    }

    updateTextToolbarHeight(shell, toolbar);
    if (typeof ResizeObserver !== 'function' || textToolbarResizeObservers.has(shell)) {
      return;
    }
    const observer = new ResizeObserver(() => updateTextToolbarHeight(shell, toolbar));
    observer.observe(toolbar);
    textToolbarResizeObservers.set(shell, observer);
  });
}

function updateTextToolbarHeight(shell: HTMLElement, toolbar: HTMLElement): void {
  if (!shell.isConnected || !toolbar.isConnected) {
    scheduleTextToolbarMeasurement(shell, toolbar, MAX_CONNECTED_MEASURE_RETRIES);
    return;
  }

  const height = toolbar.offsetHeight;
  if (height <= 0) {
    scheduleTextToolbarMeasurement(shell, toolbar, MAX_CONNECTED_MEASURE_RETRIES);
    return;
  }

  clearPendingTextToolbarMeasurement(shell);
  shell.style.setProperty('--text-editor-toolbar-height', `${height}px`);
}

function scheduleTextToolbarMeasurement(shell: HTMLElement, toolbar: HTMLElement, retries: number): void {
  const pending = textToolbarPendingMeasurements.get(shell) ?? { frame: null, observer: null, retries };
  pending.retries = Math.max(pending.retries, retries);

  if (!shell.isConnected && !pending.observer && typeof MutationObserver === 'function') {
    const root = shell.ownerDocument.documentElement;
    pending.observer = new MutationObserver(() => {
      if (shell.isConnected) {
        scheduleTextToolbarMeasurement(shell, toolbar, MAX_CONNECTED_MEASURE_RETRIES);
      }
    });
    pending.observer.observe(root, { childList: true, subtree: true });
  }

  if (pending.frame !== null || typeof requestAnimationFrame !== 'function') {
    textToolbarPendingMeasurements.set(shell, pending);
    return;
  }

  pending.frame = requestAnimationFrame(() => {
    pending.frame = null;
    const currentToolbar = shell.querySelector<HTMLElement>('.text-editor-toolbar-slot > .rich-toolbar');
    if (currentToolbar !== toolbar) {
      clearPendingTextToolbarMeasurement(shell);
      if (currentToolbar) {
        updateTextToolbarHeight(shell, currentToolbar);
      }
      return;
    }

    if (!shell.isConnected || !toolbar.isConnected) {
      textToolbarPendingMeasurements.set(shell, pending);
      return;
    }

    const height = toolbar.offsetHeight;
    if (height > 0) {
      clearPendingTextToolbarMeasurement(shell);
      shell.style.setProperty('--text-editor-toolbar-height', `${height}px`);
      return;
    }

    pending.retries -= 1;
    textToolbarPendingMeasurements.set(shell, pending);
    if (pending.retries > 0) {
      scheduleTextToolbarMeasurement(shell, toolbar, pending.retries);
    } else if (shell.isConnected) {
      clearPendingTextToolbarMeasurement(shell);
    }
  });

  textToolbarPendingMeasurements.set(shell, pending);
}

function clearPendingTextToolbarMeasurement(shell: HTMLElement): void {
  const pending = textToolbarPendingMeasurements.get(shell);
  if (!pending) {
    return;
  }
  if (pending.frame !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(pending.frame);
  }
  pending.observer?.disconnect();
  textToolbarPendingMeasurements.delete(shell);
}
