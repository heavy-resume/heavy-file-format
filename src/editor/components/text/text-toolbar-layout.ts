const textToolbarResizeObservers = new WeakMap<HTMLElement, ResizeObserver>();

export function syncTextToolbarLayout(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('.text-editor-shell').forEach((shell) => {
    const toolbar = shell.querySelector<HTMLElement>('.text-editor-toolbar-slot > .rich-toolbar');
    if (!toolbar) {
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
  shell.style.setProperty('--text-editor-toolbar-height', `${toolbar.offsetHeight}px`);
}
