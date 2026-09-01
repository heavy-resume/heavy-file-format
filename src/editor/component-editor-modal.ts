import { getActiveStateRuntime, runWithStateRuntime, state, type StateRuntime } from '../state';
import { scrollPendingEditorActivation } from '../scroll';

interface EditorModalContext {
  sectionKey: string;
  blockId: string;
  label: string;
}

interface EditorModalLayer extends EditorModalContext {
  gate: HTMLElement;
  content: HTMLElement;
  layer: HTMLElement;
  headerControls: HTMLElement | null;
  headerControlsParent: HTMLElement | null;
  headerControlsNextSibling: ChildNode | null;
  headerLayer: HTMLElement;
}

interface ComponentEditorModalController {
  app: HTMLElement;
  runtime: StateRuntime;
  observer: MutationObserver;
  resizeObserver: ResizeObserver;
  observedGates: WeakSet<HTMLElement>;
  contexts: EditorModalContext[];
  layers: EditorModalLayer[];
  scheduled: boolean;
  completionContextKey: string | null;
  completionContext: EditorModalContext | null;
}

const controllers = new WeakMap<HTMLElement, ComponentEditorModalController>();

export function bindComponentEditorModal(app: HTMLElement): void {
  let controller = controllers.get(app);
  if (!controller) {
    controller = createController(app, getActiveStateRuntime());
    controllers.set(app, controller);
  }
  scheduleSync(app, controller);
}

function createController(app: HTMLElement, runtime: StateRuntime): ComponentEditorModalController {
  const controller: ComponentEditorModalController = {
    app,
    runtime,
    observer: null as unknown as MutationObserver,
    resizeObserver: null as unknown as ResizeObserver,
    observedGates: new WeakSet<HTMLElement>(),
    contexts: [],
    layers: [],
    scheduled: false,
    completionContextKey: null,
    completionContext: null,
  };
  controller.resizeObserver = new ResizeObserver((entries) => {
    entries.forEach((entry) => updateGateWidth(entry.target as HTMLElement));
  });
  controller.observer = new MutationObserver(() => scheduleSync(app, controller));
  controller.observer.observe(app, { childList: true, subtree: true });
  app.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const openButton = target.closest<HTMLElement>('[data-hvy-component-editor-action="open"]');
    if (openButton) {
      event.preventDefault();
      event.stopPropagation();
      runWithStateRuntime(controller.runtime, () => openGate(app, controller, openButton));
      return;
    }
    const modalAction = target.closest<HTMLElement>('[data-hvy-component-editor-modal-action]');
    if (!modalAction) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    runWithStateRuntime(controller.runtime, () => handleModalAction(app, controller, modalAction));
  });
  return controller;
}

function scheduleSync(app: HTMLElement, controller: ComponentEditorModalController): void {
  if (controller.scheduled) {
    return;
  }
  controller.scheduled = true;
  queueMicrotask(() => {
    controller.scheduled = false;
    runWithStateRuntime(controller.runtime, () => syncController(app, controller));
  });
}

function syncController(app: HTMLElement, controller: ComponentEditorModalController): void {
  app.querySelectorAll<HTMLElement>('[data-hvy-component-editor-gate="true"]').forEach((gate) => {
    if (!controller.observedGates.has(gate)) {
      controller.observedGates.add(gate);
      controller.resizeObserver.observe(gate);
    }
    updateGateWidth(gate);
  });

  if (controller.contexts.length === 0) {
    return;
  }
  const openEditorIds = new Set(state.activeEditorBlockSnapshots.map(
    (snapshot) => `${snapshot.sectionKey}\u0000${snapshot.blockId}`
  ));
  if (controller.completionContextKey !== null && !openEditorIds.has(controller.completionContextKey)) {
    const completedContext = controller.completionContext;
    closeModal(controller);
    if (completedContext) {
      reactivateCompletedContext(app, completedContext);
    }
    return;
  }
  controller.contexts = controller.contexts.filter((context) => openEditorIds.has(contextKey(context)));
  if (controller.contexts.length === 0 || !app.querySelector('.editor-shell')) {
    closeModal(controller);
    return;
  }
  if (!app.querySelector('.component-editor-modal-root')) {
    controller.layers = [];
    showContext(app, controller, controller.contexts.length - 1);
  }
}

function updateGateWidth(gate: HTMLElement): void {
  if (!gate.isConnected) {
    return;
  }
  const ruler = gate.querySelector<HTMLElement>(':scope > .component-editor-minimum-ruler');
  if (!ruler) {
    return;
  }
  const availableWidth = gate.getBoundingClientRect().width;
  const minimumWidth = ruler.getBoundingClientRect().width;
  const isTooNarrow = availableWidth + 0.5 < minimumWidth;
  gate.classList.toggle('is-component-editor-too-narrow', isTooNarrow);
  const content = gate.querySelector<HTMLElement>(':scope > .component-editor-inline-content');
  content?.toggleAttribute('inert', isTooNarrow);
  if (isTooNarrow) {
    content?.setAttribute('aria-hidden', 'true');
  } else {
    content?.removeAttribute('aria-hidden');
  }
}

function openGate(app: HTMLElement, controller: ComponentEditorModalController, button: HTMLElement): void {
  const gate = button.closest<HTMLElement>('[data-hvy-component-editor-gate="true"]');
  if (!gate) {
    return;
  }
  const context = contextFromGate(gate);
  const existingIndex = controller.contexts.findIndex((candidate) => sameContext(candidate, context));
  if (existingIndex >= 0) {
    showContext(app, controller, existingIndex);
    return;
  }
  controller.contexts.push(context);
  portalGate(app, controller, gate, context);
}

function showContext(app: HTMLElement, controller: ComponentEditorModalController, index: number): void {
  if (index < 0 || index >= controller.contexts.length) {
    return;
  }
  restoreLayers(controller);
  controller.contexts = controller.contexts.slice(0, index + 1);
  const context = controller.contexts[index];
  const gate = findGate(app, context);
  if (!gate) {
    closeModal(controller);
    return;
  }
  portalGate(app, controller, gate, context);
}

function portalGate(
  app: HTMLElement,
  controller: ComponentEditorModalController,
  gate: HTMLElement,
  context: EditorModalContext
): void {
  const content = gate.querySelector<HTMLElement>(':scope > .component-editor-inline-content');
  if (!content) {
    return;
  }
  content.removeAttribute('inert');
  content.removeAttribute('aria-hidden');
  let modalRoot = app.querySelector<HTMLElement>('.component-editor-modal-root');
  if (!modalRoot) {
    modalRoot = createModal(app);
  }
  controller.layers.forEach((entry) => {
    entry.layer.hidden = true;
    entry.headerLayer.hidden = true;
  });
  const body = modalRoot.querySelector<HTMLElement>('.component-editor-modal-body');
  const headerSlot = modalRoot.querySelector<HTMLElement>('.component-editor-modal-header-controls');
  if (!body || !headerSlot) {
    return;
  }
  const headerControls = gate.closest<HTMLElement>('.editor-block')
    ?.querySelector<HTMLElement>(':scope > .editor-block-head .component-editor-header-controls') ?? null;
  const headerControlsParent = headerControls?.parentElement ?? null;
  const headerControlsNextSibling = headerControls?.nextSibling ?? null;
  const headerLayer = document.createElement('div');
  headerLayer.className = 'component-editor-modal-header-control-layer';
  if (headerControls) {
    headerLayer.append(headerControls);
  }
  headerSlot.append(headerLayer);
  const layer = document.createElement('div');
  layer.className = 'component-editor-modal-layer';
  layer.style.setProperty('--hvy-component-editor-minimum-width', gate.style.getPropertyValue('--hvy-component-editor-minimum-width'));
  layer.append(content);
  body.append(layer);
  controller.layers.push({
    ...context,
    gate,
    content,
    layer,
    headerControls,
    headerControlsParent,
    headerControlsNextSibling,
    headerLayer,
  });
  renderModalHeader(modalRoot, controller.contexts);
  modalRoot.querySelector<HTMLElement>('.component-editor-modal-panel')?.focus({ preventScroll: true });
}

function createModal(app: HTMLElement): HTMLElement {
  const modalRoot = document.createElement('div');
  modalRoot.className = 'modal-root component-editor-modal-root';
  modalRoot.innerHTML = `
    <div class="modal-overlay" aria-hidden="true"></div>
    <section class="modal-panel component-editor-modal-panel" role="dialog" aria-modal="true" aria-labelledby="componentEditorModalTitle" tabindex="-1">
      <header class="component-editor-modal-head">
        <nav class="component-editor-modal-context" aria-label="Editor context"></nav>
        <div class="component-editor-modal-title-row">
          <h3 id="componentEditorModalTitle">Edit component</h3>
          <div class="component-editor-modal-header-controls"></div>
        </div>
      </header>
      <div class="component-editor-modal-body"></div>
      <footer class="component-editor-modal-actions">
        <button type="button" class="ghost" data-hvy-component-editor-modal-action="cancel">Cancel</button>
        <button type="button" class="secondary" data-hvy-component-editor-modal-action="done">Done</button>
      </footer>
    </section>`;
  (app.querySelector('.editor-shell') ?? app).append(modalRoot);
  return modalRoot;
}

function renderModalHeader(modalRoot: HTMLElement, contexts: EditorModalContext[]): void {
  const nav = modalRoot.querySelector<HTMLElement>('.component-editor-modal-context');
  const title = modalRoot.querySelector<HTMLElement>('#componentEditorModalTitle');
  if (!nav || !title) {
    return;
  }
  const ancestorContexts = contexts.slice(0, -1);
  nav.replaceChildren(...ancestorContexts.map((context, index) => {
    const item = document.createElement('button');
    item.textContent = context.label;
    item.className = 'component-editor-modal-context-item';
    item.type = 'button';
    item.dataset.hvyComponentEditorModalAction = 'context';
    item.dataset.contextIndex = String(index);
    return item;
  }));
  nav.hidden = ancestorContexts.length === 0;
  title.textContent = `Edit ${contexts.at(-1)?.label ?? 'component'}`;
}

function handleModalAction(app: HTMLElement, controller: ComponentEditorModalController, action: HTMLElement): void {
  const kind = action.dataset.hvyComponentEditorModalAction;
  if (kind === 'context') {
    showContext(app, controller, Number(action.dataset.contextIndex));
    return;
  }
  if (kind !== 'cancel' && kind !== 'done') {
    return;
  }
  const context = controller.contexts.at(-1);
  if (!context) {
    closeModal(controller);
    return;
  }
  const contextBlock = [...app.querySelectorAll<HTMLElement>('.editor-block[data-active-editor-block="true"]')]
    .find((candidate) => candidate.dataset.sectionKey === context.sectionKey && candidate.dataset.blockId === context.blockId);
  const selector = kind === 'cancel' ? ':scope > .editor-block-done-row > .editor-block-cancel-button' : ':scope > .editor-block-done-row > .editor-block-done-button';
  const completionButton = contextBlock?.querySelector<HTMLButtonElement>(selector);
  if (!completionButton) {
    return;
  }
  controller.completionContextKey = contextKey(context);
  controller.completionContext = context;
  completionButton.click();
  scheduleSync(app, controller);
}

function closeModal(controller: ComponentEditorModalController): void {
  restoreLayers(controller);
  controller.contexts = [];
  controller.completionContextKey = null;
  controller.completionContext = null;
  controller.app.querySelector('.component-editor-modal-root')?.remove();
}

function reactivateCompletedContext(app: HTMLElement, context: EditorModalContext): void {
  const passiveBlock = [...app.querySelectorAll<HTMLElement>('[data-action="activate-block"]')].find((candidate) => (
    candidate.dataset.sectionKey === context.sectionKey && candidate.dataset.blockId === context.blockId
  ));
  passiveBlock?.click();
  if (state.pendingEditorActivation?.sectionKey === context.sectionKey
    && state.pendingEditorActivation.blockId === context.blockId) {
    state.pendingEditorActivation.suppressFocus = true;
    scrollPendingEditorActivation(app);
  }
  findGate(app, context)
    ?.querySelector<HTMLElement>('[data-hvy-component-editor-action="open"]')
    ?.focus({ preventScroll: true });
}

function restoreLayers(controller: ComponentEditorModalController): void {
  for (let index = controller.layers.length - 1; index >= 0; index -= 1) {
    const entry = controller.layers[index];
    if (entry.gate.isConnected || entry.gate.closest('.component-editor-modal-layer')) {
      entry.gate.append(entry.content);
    }
    if (entry.headerControls && entry.headerControlsParent?.isConnected) {
      if (entry.headerControlsNextSibling?.parentNode === entry.headerControlsParent) {
        entry.headerControlsParent.insertBefore(entry.headerControls, entry.headerControlsNextSibling);
      } else {
        entry.headerControlsParent.append(entry.headerControls);
      }
    }
    entry.headerLayer.remove();
    entry.layer.remove();
  }
  controller.layers = [];
}

function findGate(app: HTMLElement, context: EditorModalContext): HTMLElement | null {
  return [...app.querySelectorAll<HTMLElement>('[data-hvy-component-editor-gate="true"]')].find((gate) => (
    gate.dataset.sectionKey === context.sectionKey && gate.dataset.blockId === context.blockId
  )) ?? null;
}

function contextFromGate(gate: HTMLElement): EditorModalContext {
  return {
    sectionKey: gate.dataset.sectionKey ?? '',
    blockId: gate.dataset.blockId ?? '',
    label: gate.dataset.componentLabel || 'component',
  };
}

function sameContext(left: EditorModalContext, right: EditorModalContext): boolean {
  return left.sectionKey === right.sectionKey && left.blockId === right.blockId;
}

function contextKey(context: Pick<EditorModalContext, 'sectionKey' | 'blockId'>): string {
  return `${context.sectionKey}\u0000${context.blockId}`;
}
