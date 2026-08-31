import { chevronLeftIcon, chevronRightIcon, closeIcon } from '../../../icons';

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
const COMPACT_TEXT_TOOLBAR_ACTION_LIMIT = 5;
const DEFAULT_COMPACT_TEXT_TOOLBAR_ACTION_KEYS = [
  'rich:heading-1',
  'rich:heading-2',
  'rich:bold',
  'rich:italic',
  'rich:underline',
];
let recentTextToolbarActionKeys: string[] = [...DEFAULT_COMPACT_TEXT_TOOLBAR_ACTION_KEYS];
let recentTextToolbarRevision = 0;

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

    syncCompactTextToolbar(shell, toolbarSlot);
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

function syncCompactTextToolbar(shell: HTMLElement, toolbarSlot: HTMLElement): void {
  const toolbar = toolbarSlot.querySelector<HTMLElement>(':scope > .rich-toolbar');
  if (!toolbar?.querySelector('[data-text-toolbar-dismiss]')) {
    return;
  }

  let compact = toolbar.querySelector<HTMLElement>(':scope > .text-toolbar-compact');
  if (!compact) {
    compact = shell.ownerDocument.createElement('div');
    compact.className = 'text-toolbar-compact';
    compact.setAttribute('role', 'group');
    compact.setAttribute('aria-label', 'Recent text controls');
    compact.innerHTML = `<button type="button" class="ghost icon-button text-toolbar-expand text-toolbar-expand-left" data-text-toolbar-expand="true" aria-label="Show all text controls">${chevronLeftIcon()}</button>
      <span class="text-toolbar-compact-actions"></span>
      <button type="button" class="ghost icon-button text-toolbar-expand text-toolbar-expand-right" data-text-toolbar-expand="true" aria-label="Show all text controls">${chevronRightIcon()}</button>`;
    toolbar.querySelector(':scope > [data-text-toolbar-dismiss]')?.after(compact);
  }

  const revision = String(recentTextToolbarRevision);
  if (compact.dataset.textToolbarRecentRevision === revision) {
    return;
  }

  const actions = compact.querySelector<HTMLElement>('.text-toolbar-compact-actions');
  if (!actions) {
    return;
  }
  const nextButtons = getCompactTextToolbarButtons(toolbar);
  const currentKeys = Array.from(actions.children).map((button) => getTextToolbarActionKey(button as HTMLElement));
  const nextKeys = nextButtons.map((button) => getTextToolbarActionKey(button));
  if (currentKeys.length === nextKeys.length && currentKeys.every((key, index) => key === nextKeys[index])) {
    compact.dataset.textToolbarRecentRevision = revision;
    return;
  }
  actions.replaceChildren(...nextButtons);
  compact.dataset.textToolbarRecentRevision = revision;
}

function getCompactTextToolbarButtons(toolbar: HTMLElement): HTMLButtonElement[] {
  const sourceButtons = Array.from(toolbar.querySelectorAll<HTMLButtonElement>(
    ':scope > .toolbar-segment button[data-rich-action], :scope > .toolbar-segment button[data-action="set-block-align"]'
  )).filter((button) => !button.closest('.paragraph-style-toolbar'));
  const sourceByKey = new Map<string, HTMLButtonElement>();
  sourceButtons.forEach((button) => {
    const key = getTextToolbarActionKey(button);
    if (key && !sourceByKey.has(key)) {
      sourceByKey.set(key, button);
    }
  });
  const requestedKeys = [
    ...recentTextToolbarActionKeys,
    ...DEFAULT_COMPACT_TEXT_TOOLBAR_ACTION_KEYS.filter((key) => !recentTextToolbarActionKeys.includes(key)),
  ];
  return requestedKeys
    .flatMap((key) => {
      const source = sourceByKey.get(key);
      if (!source) {
        return [];
      }
      const clone = source.cloneNode(true) as HTMLButtonElement;
      clone.dataset.textToolbarCompactAction = 'true';
      return [clone];
    })
    .slice(0, COMPACT_TEXT_TOOLBAR_ACTION_LIMIT);
}

function getTextToolbarActionKey(button: HTMLElement): string | null {
  const richAction = button.dataset.richAction;
  if (richAction && richAction !== 'text-line-style') {
    return `rich:${richAction}`;
  }
  if (button.dataset.action === 'set-block-align' && button.dataset.alignValue) {
    return `align:${button.dataset.alignValue}`;
  }
  return null;
}

function rememberTextToolbarAction(button: HTMLElement, shell: HTMLElement): void {
  if (button.closest('.paragraph-style-toolbar')) {
    return;
  }
  const key = getTextToolbarActionKey(button);
  if (!key) {
    return;
  }
  promoteTextToolbarActionKey(key, shell);
}

export function promoteTextToolbarHotkeyAction(action: string, editable: HTMLElement): void {
  const shell = editable.closest<HTMLElement>('.text-editor-shell');
  const toolbar = shell?.querySelector<HTMLElement>('.text-editor-toolbar-slot > .rich-toolbar');
  const source = toolbar ? getFullTextToolbarButton(toolbar, `rich:${action}`) : null;
  if (!shell || !source) {
    return;
  }
  promoteTextToolbarActionKey(`rich:${action}`, shell);
}

export function dismissTextToolbarForEscape(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : null;
  const shell = element?.closest<HTMLElement>('.text-editor-shell');
  const toolbar = shell?.querySelector<HTMLElement>('.text-editor-toolbar-slot > .rich-toolbar');
  if (!shell || !toolbar?.querySelector('[data-text-toolbar-dismiss]') || shell.classList.contains('is-text-toolbar-hidden')) {
    return false;
  }
  hideTextToolbar(shell, toolbar);
  return true;
}

function promoteTextToolbarActionKey(key: string, shell: HTMLElement): void {
  recentTextToolbarActionKeys = [
    key,
    ...recentTextToolbarActionKeys.filter((recentKey) => recentKey !== key),
  ].slice(0, COMPACT_TEXT_TOOLBAR_ACTION_LIMIT);
  recentTextToolbarRevision += 1;
  const toolbarSlot = shell.querySelector<HTMLElement>('.text-editor-toolbar-slot');
  if (toolbarSlot) {
    queueMicrotask(() => {
      if (!shell.isConnected || !toolbarSlot.isConnected) {
        return;
      }
      syncCompactTextToolbar(shell, toolbarSlot);
      updateTextToolbarLayout(shell, toolbarSlot);
    });
  }
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
    if (!target?.closest('[data-text-toolbar-dismiss], [data-text-toolbar-expand]')) {
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
      hideTextToolbar(shell, target.closest<HTMLElement>('.rich-toolbar'));
      return;
    }
    if (target?.closest('[data-text-toolbar-expand]')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const toolbar = target.closest<HTMLElement>('.rich-toolbar');
      toolbar?.classList.add('is-text-toolbar-expanded');
      const toolbarSlot = shell.querySelector<HTMLElement>('.text-editor-toolbar-slot');
      if (toolbarSlot) {
        updateTextToolbarLayout(shell, toolbarSlot);
      }
      return;
    }
    const toolbarAction = target?.closest<HTMLElement>('[data-rich-action], [data-action="set-block-align"]');
    if (toolbarAction?.closest('.rich-toolbar')) {
      if (toolbarAction.dataset.textToolbarCompactAction === 'true') {
        const toolbar = toolbarAction.closest<HTMLElement>('.rich-toolbar');
        const source = toolbar ? getFullTextToolbarButton(toolbar, getTextToolbarActionKey(toolbarAction)) : null;
        if (source) {
          event.preventDefault();
          event.stopImmediatePropagation();
          source.click();
          return;
        }
      }
      rememberTextToolbarAction(toolbarAction, shell);
    }
    if (target?.closest('.rich-editor') && !shell.classList.contains('is-disabled')) {
      shell.classList.remove('is-text-toolbar-hidden');
    }
  });
  shell.addEventListener('focusin', (event) => {
    if (!shell.classList.contains('is-text-toolbar-focus-controlled')
      || shell.classList.contains('is-disabled')) {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.rich-editor')) {
      shell.classList.remove('is-text-toolbar-hidden');
    }
  });
  shell.addEventListener('focusout', (event) => {
    if (!shell.classList.contains('is-text-toolbar-focus-controlled')) {
      return;
    }
    const nextTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (!nextTarget || !shell.contains(nextTarget)) {
      shell.classList.add('is-text-toolbar-hidden');
    }
  });
}

function hideTextToolbar(shell: HTMLElement, toolbar: HTMLElement | null): void {
  toolbar?.classList.remove('is-text-toolbar-expanded');
  toolbar?.querySelectorAll<HTMLElement>('.paragraph-style-toolbar').forEach((paragraphToolbar) => {
    paragraphToolbar.classList.remove('is-picker-open', 'is-style-edit-open');
    paragraphToolbar.querySelector<HTMLElement>('[data-action="open-paragraph-style-picker"]')?.setAttribute('aria-expanded', 'false');
    paragraphToolbar.querySelectorAll<HTMLElement>('.paragraph-style-edit-panel').forEach((panel) => {
      panel.hidden = true;
    });
  });
  shell.classList.add('is-text-toolbar-hidden');
}

function getFullTextToolbarButton(toolbar: HTMLElement, key: string | null): HTMLButtonElement | null {
  if (!key) {
    return null;
  }
  return Array.from(toolbar.querySelectorAll<HTMLButtonElement>(
    ':scope > .toolbar-segment button[data-rich-action], :scope > .toolbar-segment button[data-action="set-block-align"]'
  )).find((button) => !button.closest('.paragraph-style-toolbar') && getTextToolbarActionKey(button) === key) ?? null;
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
