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
    const toolbarSlot = shell.querySelector<HTMLElement>('.text-editor-toolbar-slot');
    if (!toolbarSlot) {
      clearPendingTextToolbarMeasurement(shell);
      textToolbarResizeObservers.get(shell)?.disconnect();
      textToolbarResizeObservers.delete(shell);
      shell.style.removeProperty('--text-editor-toolbar-height');
      return;
    }

    updateTextToolbarHeight(shell, toolbarSlot);
    if (typeof ResizeObserver !== 'function' || textToolbarResizeObservers.has(shell)) {
      return;
    }
    const observer = new ResizeObserver(() => updateTextToolbarHeight(shell, toolbarSlot));
    observer.observe(toolbarSlot);
    textToolbarResizeObservers.set(shell, observer);
  });
}

function updateTextToolbarHeight(shell: HTMLElement, toolbarSlot: HTMLElement): void {
  if (!shell.isConnected || !toolbarSlot.isConnected) {
    scheduleTextToolbarMeasurement(shell, toolbarSlot, MAX_CONNECTED_MEASURE_RETRIES);
    return;
  }

  const height = toolbarSlot.offsetHeight;
  if (height <= 0) {
    scheduleTextToolbarMeasurement(shell, toolbarSlot, MAX_CONNECTED_MEASURE_RETRIES);
    return;
  }

  clearPendingTextToolbarMeasurement(shell);
  shell.style.setProperty('--text-editor-toolbar-height', `${height}px`);
}

function scheduleTextToolbarMeasurement(shell: HTMLElement, toolbarSlot: HTMLElement, retries: number): void {
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
    const currentToolbarSlot = shell.querySelector<HTMLElement>('.text-editor-toolbar-slot');
    if (currentToolbarSlot !== toolbarSlot) {
      clearPendingTextToolbarMeasurement(shell);
      if (currentToolbarSlot) {
        updateTextToolbarHeight(shell, currentToolbarSlot);
      }
      return;
    }

    if (!shell.isConnected || !toolbarSlot.isConnected) {
      textToolbarPendingMeasurements.set(shell, pending);
      return;
    }

    const height = toolbarSlot.offsetHeight;
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
