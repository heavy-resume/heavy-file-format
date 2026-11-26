// Small dialogs for canvas settings, following the plugin modal pattern
// (modal-root > modal-overlay + modal-panel with a modal-head), mounted in the
// surrounding editor shell so they stay inside the emulated preview frame.

// One open modal per kind: opening a dialog replaces an open dialog, but a
// dialog can stack over the expanded canvas.
const activeCanvasModals = new Map<string, { root: HTMLElement; dismiss(): void }>();

export interface CanvasModalOptions {
  title: string;
  invoker: HTMLElement;
  body: HTMLElement[];
  kind?: string;
  // Panel class, which sizes it through the shared modal variables. Defaults
  // to the small dialog size.
  panelClassName?: string;
  // Focused when the modal opens; defaults to its first field or button.
  initialFocus?: HTMLElement;
  closeLabel?: string;
  closeOnEscape?: boolean;
  closeOnOverlay?: boolean;
  onClose?(): void;
}

export interface CanvasModalHandle {
  dismiss(): void;
}

export function openCanvasModal(options: CanvasModalOptions): CanvasModalHandle {
  const kind = options.kind ?? 'dialog';
  activeCanvasModals.get(kind)?.dismiss();

  const root = document.createElement('div');
  root.className = 'modal-root hvy-canvas-modal-root';
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  if (options.closeOnOverlay !== false) overlay.dataset.canvasModalAction = 'close';

  const panel = document.createElement('section');
  panel.className = `modal-panel ${options.panelClassName ?? 'hvy-canvas-modal'}`;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  const titleId = `hvyCanvasModalTitle-${crypto.randomUUID().slice(0, 8)}`;
  panel.setAttribute('aria-labelledby', titleId);

  const head = document.createElement('div');
  head.className = 'modal-head';
  const title = document.createElement('h3');
  title.id = titleId;
  title.textContent = options.title;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'ghost';
  close.dataset.canvasModalAction = 'close';
  close.textContent = options.closeLabel ?? 'Close';
  head.append(title, close);

  const body = document.createElement('div');
  body.className = 'hvy-canvas-modal-body';
  body.append(...options.body);
  panel.append(head, body);
  root.append(overlay, panel);

  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || options.closeOnEscape === false) return;
    // Only the topmost canvas modal closes.
    if ([...activeCanvasModals.values()].at(-1)?.root !== root) return;
    event.stopPropagation();
    dismiss();
  };
  let dismissed = false;
  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    root.remove();
    document.removeEventListener('keydown', onKey, true);
    if (activeCanvasModals.get(kind)?.root === root) activeCanvasModals.delete(kind);
    options.onClose?.();
    if (options.invoker.isConnected) options.invoker.focus({ preventScroll: true });
  }
  root.addEventListener('click', (event) => {
    event.stopPropagation();
    const action = (event.target as HTMLElement).closest('[data-canvas-modal-action="close"]');
    // Only this modal's own controls close it, not ones inside content it hosts.
    if (action && (action === close || action === overlay)) dismiss();
  });
  document.addEventListener('keydown', onKey, true);

  const mount = options.invoker.closest<HTMLElement>('.viewer-shell, .editor-shell')
    ?? options.invoker.closest<HTMLElement>('.hvy-embed-layout')
    ?? options.invoker.closest<HTMLElement>('.hvy-document')
    ?? document.body;
  mount.appendChild(root);
  activeCanvasModals.set(kind, { root, dismiss });
  (options.initialFocus ?? panel.querySelector<HTMLElement>('input, button:not([data-canvas-modal-action])'))?.focus({ preventScroll: true });
  return { dismiss };
}

// A labelled number field that applies on Enter or when it loses focus.
export function canvasModalNumberField(label: string, value: number, min: number, max: number, commit: (value: number) => void, hint = ''): HTMLLabelElement {
  const wrapper = document.createElement('label');
  wrapper.className = 'hvy-canvas-control hvy-canvas-modal-field';
  const caption = document.createElement('span');
  caption.textContent = label;
  const input = document.createElement('input');
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.value = String(value);
  input.addEventListener('change', () => {
    const next = Math.min(max, Math.max(min, Math.round(Number(input.value))));
    if (!Number.isFinite(next)) return;
    input.value = String(next);
    commit(next);
  });
  wrapper.append(caption, input);
  if (hint) {
    const note = document.createElement('small');
    note.className = 'hvy-canvas-modal-hint';
    note.textContent = hint;
    wrapper.append(note);
  }
  return wrapper;
}

function fieldShell(label: string, className: string): { wrapper: HTMLLabelElement; caption: HTMLSpanElement } {
  const wrapper = document.createElement('label');
  wrapper.className = `hvy-canvas-control hvy-canvas-modal-field ${className}`;
  const caption = document.createElement('span');
  caption.textContent = label;
  wrapper.append(caption);
  return { wrapper, caption };
}

// `preview` runs while the picker is open; `commit` runs once the color is chosen.
export function canvasModalColorField(label: string, value: string, commit: (value: string) => void, preview?: (value: string) => void): HTMLLabelElement {
  const { wrapper } = fieldShell(label, 'hvy-canvas-color');
  const input = document.createElement('input');
  input.type = 'color';
  input.value = value;
  if (preview) input.addEventListener('input', () => preview(input.value));
  input.addEventListener('change', () => commit(input.value));
  wrapper.append(input);
  return wrapper;
}

// A percentage slider that commits when released, with its value shown beside
// it; `preview` runs while it is dragged.
export function canvasModalPercentField(label: string, value: number, commit: (value: number) => void, preview?: (value: number) => void): HTMLLabelElement {
  const { wrapper } = fieldShell(label, 'hvy-canvas-modal-range');
  const row = document.createElement('div');
  row.className = 'hvy-canvas-modal-range-row';
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = '100';
  input.step = '1';
  input.value = String(Math.round(value));
  const readout = document.createElement('output');
  readout.textContent = `${input.value}%`;
  input.addEventListener('input', () => {
    readout.textContent = `${input.value}%`;
    preview?.(Number(input.value));
  });
  input.addEventListener('change', () => commit(Number(input.value)));
  row.append(input, readout);
  wrapper.append(row);
  return wrapper;
}

export function canvasModalToggleField(label: string, checked: boolean, commit: (value: boolean) => void): HTMLLabelElement {
  const wrapper = document.createElement('label');
  // checkbox-label opts out of the modal grid layout for labels.
  wrapper.className = 'checkbox-label hvy-canvas-toggle hvy-canvas-modal-toggle';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  const track = document.createElement('span');
  track.className = 'hvy-canvas-toggle-track';
  const caption = document.createElement('span');
  caption.textContent = label;
  input.addEventListener('change', () => commit(input.checked));
  wrapper.append(input, track, caption);
  return wrapper;
}
