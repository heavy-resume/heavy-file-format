import { closeIcon } from '../../../icons';

const textToolbarResizeObservers = new WeakMap<HTMLElement, ResizeObserver>();
const textToolbarVisibilityBindings = new WeakSet<HTMLElement>();
const textToolbarScrollBindings = new WeakMap<HTMLElement, {
  frame: number | null;
  listener: () => void;
  target: EventTarget;
}>();
const textToolbarPendingMeasurements = new WeakMap<HTMLElement, {
  frame: number | null;
  observer: MutationObserver | null;
}>();

const FLOATING_TOOLBAR_EDGE_INSET_PX = 10;
const FLOATING_TOOLBAR_GAP_PX = 8;

export function renderTextToolbarDismissButton(): string {
  return `<button type="button" class="ghost text-toolbar-dismiss" data-text-toolbar-dismiss="true" aria-label="Hide text controls" title="Hide text controls">${closeIcon()}</button>`;
}

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
      clearTextToolbarScrollBinding(shell);
      shell.style.removeProperty('--text-editor-toolbar-max-inline-size');
      shell.style.removeProperty('--text-editor-toolbar-offset-x');
      shell.style.removeProperty('--text-editor-toolbar-height');
      shell.classList.remove('is-text-toolbar-below');
      return;
    }

    bindTextToolbarVisibility(shell);
    bindTextToolbarScroll(shell);
    updateTextToolbarLayout(shell, toolbarSlot);
    if (typeof ResizeObserver !== 'function' || textToolbarResizeObservers.has(shell)) {
      return;
    }
    const observer = new ResizeObserver(() => updateTextToolbarLayout(shell, toolbarSlot));
    observer.observe(toolbarSlot);
    observer.observe(shell);
    const boundary = findTextToolbarBoundary(shell);
    if (boundary !== shell) {
      observer.observe(boundary);
    }
    textToolbarResizeObservers.set(shell, observer);
  });
}

function updateTextToolbarLayout(shell: HTMLElement, toolbarSlot: HTMLElement): void {
  if (!shell.isConnected || !toolbarSlot.isConnected) {
    scheduleTextToolbarMeasurement(shell, toolbarSlot);
    return;
  }

  updateFloatingTextToolbarGeometry(shell, toolbarSlot);
  clearPendingTextToolbarMeasurement(shell);
}

function scheduleTextToolbarMeasurement(shell: HTMLElement, toolbarSlot: HTMLElement): void {
  const pending = textToolbarPendingMeasurements.get(shell) ?? { frame: null, observer: null };

  if (!shell.isConnected && !pending.observer && typeof MutationObserver === 'function') {
    const root = shell.ownerDocument.documentElement;
    pending.observer = new MutationObserver(() => {
      if (shell.isConnected) {
        scheduleTextToolbarMeasurement(shell, toolbarSlot);
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
        updateTextToolbarLayout(shell, currentToolbarSlot);
      }
      return;
    }

    if (!shell.isConnected || !toolbarSlot.isConnected) {
      textToolbarPendingMeasurements.set(shell, pending);
      return;
    }

    updateTextToolbarLayout(shell, toolbarSlot);
  });

  textToolbarPendingMeasurements.set(shell, pending);
}

function updateFloatingTextToolbarGeometry(shell: HTMLElement, toolbarSlot: HTMLElement): void {
  if (shell.closest('.editor-block:not([data-active-editor-block="true"])')) {
    shell.style.removeProperty('--text-editor-toolbar-max-inline-size');
    shell.style.removeProperty('--text-editor-toolbar-offset-x');
    shell.style.removeProperty('--text-editor-toolbar-height');
    shell.classList.remove('is-text-toolbar-below');
    return;
  }

  const boundary = findTextToolbarBoundary(shell);
  const shellBox = shell.getBoundingClientRect();
  const boundaryBox = boundary.getBoundingClientRect();
  const scrollport = shell.closest<HTMLElement>('.editor-tree, .editor-sidebar-panel');
  const scrollportBox = scrollport?.getBoundingClientRect();
  const boundaryLeft = Math.max(boundaryBox.left, scrollportBox?.left ?? boundaryBox.left);
  const boundaryRight = Math.min(boundaryBox.right, scrollportBox?.right ?? boundaryBox.right);
  const availableWidth = Math.max(0, boundaryRight - boundaryLeft - (FLOATING_TOOLBAR_EDGE_INSET_PX * 2));
  if (availableWidth <= 0 || shellBox.width <= 0) {
    return;
  }

  setStylePropertyIfChanged(shell, '--text-editor-toolbar-max-inline-size', `${availableWidth}px`);
  const toolbarBox = toolbarSlot.getBoundingClientRect();
  if (toolbarBox.width <= 0 || toolbarBox.height <= 0) {
    return;
  }
  setStylePropertyIfChanged(shell, '--text-editor-toolbar-height', `${toolbarBox.height}px`);

  const visibleTop = Math.max(boundaryBox.top, scrollportBox?.top ?? boundaryBox.top);
  const visibleBottom = Math.min(boundaryBox.bottom, scrollportBox?.bottom ?? boundaryBox.bottom);
  const hasRoomAbove = shellBox.top - visibleTop >= toolbarBox.height + FLOATING_TOOLBAR_GAP_PX;
  const hasVisibleComponentBottom = shellBox.bottom <= visibleBottom - FLOATING_TOOLBAR_GAP_PX;
  shell.classList.toggle('is-text-toolbar-below', !hasRoomAbove && hasVisibleComponentBottom);

  const preferredLeft = getPreferredTextToolbarLeft(shell, toolbarBox.width, shellBox);
  const minimumLeft = boundaryLeft + FLOATING_TOOLBAR_EDGE_INSET_PX;
  const maximumLeft = boundaryRight - FLOATING_TOOLBAR_EDGE_INSET_PX - toolbarBox.width;
  const toolbarLeft = Math.min(Math.max(preferredLeft, minimumLeft), maximumLeft);

  setStylePropertyIfChanged(shell, '--text-editor-toolbar-offset-x', `${toolbarLeft - shellBox.left}px`);
}

function getPreferredTextToolbarLeft(shell: HTMLElement, toolbarWidth: number, shellBox: DOMRect): number {
  const gridCell = shell.closest<HTMLElement>('.grid-field-row');
  if (!gridCell || !gridCell.parentElement) {
    return shellBox.left + ((shellBox.width - toolbarWidth) / 2);
  }

  const gridCellBox = gridCell.getBoundingClientRect();
  const visualRow = Array.from(gridCell.parentElement.children)
    .filter((element): element is HTMLElement => element instanceof HTMLElement && element.matches('.grid-field-row'))
    .filter((element) => Math.abs(element.getBoundingClientRect().top - gridCellBox.top) <= 1)
    .sort((left, right) => left.getBoundingClientRect().left - right.getBoundingClientRect().left);
  if (visualRow.length <= 1) {
    return gridCellBox.left + ((gridCellBox.width - toolbarWidth) / 2);
  }
  if (visualRow[0] === gridCell) {
    return gridCellBox.left;
  }
  if (visualRow[visualRow.length - 1] === gridCell) {
    return gridCellBox.right - toolbarWidth;
  }
  return gridCellBox.left + ((gridCellBox.width - toolbarWidth) / 2);
}

function bindTextToolbarVisibility(shell: HTMLElement): void {
  if (textToolbarVisibilityBindings.has(shell)) {
    return;
  }
  textToolbarVisibilityBindings.add(shell);
  shell.addEventListener('mousedown', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('[data-text-toolbar-dismiss]')) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  });
  shell.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-text-toolbar-dismiss]')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      shell.classList.add('is-text-toolbar-hidden');
      return;
    }
    if (target?.closest('.rich-editor')) {
      shell.classList.remove('is-text-toolbar-hidden');
    }
  });
}

function bindTextToolbarScroll(shell: HTMLElement): void {
  const target = shell.closest<HTMLElement>('.editor-tree, .editor-sidebar-panel')
    ?? shell.ownerDocument.defaultView;
  if (!target) {
    clearTextToolbarScrollBinding(shell);
    return;
  }

  const current = textToolbarScrollBindings.get(shell);
  if (current?.target === target) {
    return;
  }
  clearTextToolbarScrollBinding(shell);

  const binding = {
    frame: null as number | null,
    listener: () => {
      if (binding.frame !== null || typeof requestAnimationFrame !== 'function') {
        return;
      }
      binding.frame = requestAnimationFrame(() => {
        binding.frame = null;
        const toolbarSlot = shell.querySelector<HTMLElement>('.text-editor-toolbar-slot');
        if (toolbarSlot) {
          updateTextToolbarLayout(shell, toolbarSlot);
        }
      });
    },
    target,
  };
  target.addEventListener('scroll', binding.listener, { passive: true });
  textToolbarScrollBindings.set(shell, binding);
}

function clearTextToolbarScrollBinding(shell: HTMLElement): void {
  const binding = textToolbarScrollBindings.get(shell);
  if (!binding) {
    return;
  }
  binding.target.removeEventListener('scroll', binding.listener);
  if (binding.frame !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(binding.frame);
  }
  textToolbarScrollBindings.delete(shell);
}

function findTextToolbarBoundary(shell: HTMLElement): HTMLElement {
  return shell.closest<HTMLElement>('.editor-tree-body, .editor-sidebar-panel, .reader-document, .hvy-surface')
    ?? shell;
}

function setStylePropertyIfChanged(element: HTMLElement, property: string, value: string): void {
  if (element.style.getPropertyValue(property) !== value) {
    element.style.setProperty(property, value);
  }
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
