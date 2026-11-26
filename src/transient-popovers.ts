interface ActiveTransientPopover {
  element: HTMLElement;
  dismiss: () => void;
  backdrop: HTMLElement | null;
}

// Keep ownership per mounted app so independent embedded documents do not interfere.
const activeTransientPopovers = new WeakMap<ParentNode, ActiveTransientPopover>();
const boundTransientPopoverRoots = new WeakSet<HTMLElement>();

export function activateTransientPopover(root: HTMLElement, element: HTMLElement, dismiss: () => void, backdrop: HTMLElement | null = null): void {
  if (!boundTransientPopoverRoots.has(root)) {
    root.addEventListener('pointerdown', (event) => {
      const active = activeTransientPopovers.get(root);
      if (active && event.target instanceof Node && !active.element.contains(event.target)) {
        // A backdrop owns its dismissal click. Keep it mounted through pointerup so
        // touch-generated clicks cannot be retargeted to controls underneath it.
        if (active.backdrop?.contains(event.target)) {
          return;
        }
        activeTransientPopovers.delete(root);
        active.dismiss();
      }
    }, { capture: true });
    boundTransientPopoverRoots.add(root);
  }
  const previous = activeTransientPopovers.get(root);
  if (previous?.element === element) {
    return;
  }
  activeTransientPopovers.delete(root);
  if (previous?.element.isConnected) {
    previous.dismiss();
  }
  activeTransientPopovers.set(root, { element, dismiss, backdrop });
}

export function releaseTransientPopover(root: ParentNode, element: HTMLElement | null): void {
  if (activeTransientPopovers.get(root)?.element === element) {
    activeTransientPopovers.delete(root);
  }
}
