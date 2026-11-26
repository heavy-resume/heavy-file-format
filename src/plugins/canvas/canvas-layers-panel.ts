import { closeIcon, plusIcon, settingsIcon } from '../../icons';
import type { CanvasLayer } from './canvas-drawing-format';
import { canvasEyeIcon, canvasEyeOffIcon, canvasGripIcon, canvasLockIcon, canvasUnlockIcon } from './canvas-icons';
import { makeActionButton } from './canvas-toolbar';

export interface CanvasLayersPanelActions {
  // A click (`additive` false) or Shift-click (`additive` true) on a layer row.
  select(layerId: string, additive: boolean): void;
  add(): void;
  remove(layerId: string): void;
  // Moves a layer to `index` in the bottom-first layer order.
  moveTo(layerId: string, index: number): void;
  setVisible(layerId: string, visible: boolean): void;
  setLocked(layerId: string, locked: boolean): void;
  rename(layerId: string, name: string): void;
  openSettings(layerId: string, invoker: HTMLElement): void;
}

// Rows are listed top layer first, matching how they stack on the canvas.
// While a rename input is open or a row is being dragged, the panel is left
// alone; finishing either rebuilds it.
export function renderCanvasLayersPanel(
  panel: HTMLElement,
  layers: CanvasLayer[],
  activeLayerId: string,
  selectedLayerIds: ReadonlySet<string>,
  actions: CanvasLayersPanelActions,
): void {
  if (panel.querySelector('.hvy-canvas-layer-rename') || panel.classList.contains('is-reordering')) return;
  panel.replaceChildren();
  const header = document.createElement('div');
  header.className = 'hvy-canvas-layers-header';
  const title = document.createElement('span');
  title.textContent = 'Layers';
  header.append(title, makeActionButton('Add layer', plusIcon(), actions.add));

  // Divs with list roles: document typography styles ol/li inside reader blocks.
  const list = document.createElement('div');
  list.className = 'hvy-canvas-layers-list';
  list.setAttribute('role', 'list');
  const topFirst = [...layers].reverse();
  const toArrayIndex = (displayIndex: number) => layers.length - 1 - displayIndex;
  topFirst.forEach((layer, displayIndex) => {
    const row = document.createElement('div');
    row.className = 'hvy-canvas-layer-row';
    row.setAttribute('role', 'listitem');
    row.classList.toggle('is-active', layer.id === activeLayerId);
    row.classList.toggle('is-selected', selectedLayerIds.has(layer.id));
    row.classList.toggle('is-hidden', !layer.visible);
    row.classList.toggle('has-filter', Boolean(layer.filter));
    row.dataset.layerId = layer.id;

    const grip = makeActionButton(`Drag to reorder ${layer.name}`, canvasGripIcon(), () => {});
    grip.classList.add('hvy-canvas-layer-grip');
    grip.addEventListener('pointerdown', (event) => startReorder(event, panel, list, row, displayIndex, (target) => {
      if (target !== displayIndex) actions.moveTo(layer.id, toArrayIndex(target));
    }));
    grip.addEventListener('keydown', (event) => {
      const delta = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
      const target = displayIndex + delta;
      if (!delta || target < 0 || target >= topFirst.length) return;
      event.preventDefault();
      actions.moveTo(layer.id, toArrayIndex(target));
    });

    const visibility = makeActionButton(layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`, layer.visible ? canvasEyeIcon() : canvasEyeOffIcon(), () => actions.setVisible(layer.id, !layer.visible));
    visibility.setAttribute('aria-pressed', String(!layer.visible));
    const lock = makeActionButton(layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`, layer.locked ? canvasLockIcon() : canvasUnlockIcon(), () => actions.setLocked(layer.id, !layer.locked));
    lock.setAttribute('aria-pressed', String(layer.locked));
    lock.classList.toggle('is-active', layer.locked);

    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'hvy-canvas-layer-name';
    name.textContent = layer.name;
    name.title = 'Click to draw on this layer, Shift-click to add it to the selection (or isolate it), double-click to rename.';
    name.setAttribute('aria-pressed', String(selectedLayerIds.has(layer.id)));
    name.setAttribute('aria-current', String(layer.id === activeLayerId));
    name.addEventListener('click', (event) => actions.select(layer.id, event.shiftKey));
    name.addEventListener('dblclick', () => openRename(name, layer, actions));

    const settings = makeActionButton(`${layer.name} settings`, settingsIcon(), () => actions.openSettings(layer.id, settings));
    settings.classList.toggle('is-active', Boolean(layer.filter));
    const remove = makeActionButton(`Delete ${layer.name}`, closeIcon(), () => actions.remove(layer.id), true);
    remove.disabled = layers.length <= 1;

    row.append(grip, visibility, lock, name, settings, remove);
    list.appendChild(row);
  });
  panel.append(header, list);
}

// Drags a row by its grip: the row follows the pointer, an indicator shows the
// drop position, and releasing reports the target display index.
function startReorder(
  event: PointerEvent,
  panel: HTMLElement,
  list: HTMLElement,
  row: HTMLElement,
  displayIndex: number,
  drop: (displayIndex: number) => void,
): void {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const grip = event.currentTarget as HTMLElement;
  grip.setPointerCapture(event.pointerId);
  const rows = [...list.querySelectorAll<HTMLElement>('.hvy-canvas-layer-row')];
  const midpoints = rows.map((candidate) => {
    const rect = candidate.getBoundingClientRect();
    return rect.top + rect.height / 2;
  });
  const startY = event.clientY;
  let target = displayIndex;
  const indicator = document.createElement('div');
  indicator.className = 'hvy-canvas-layer-drop-indicator';
  list.appendChild(indicator);
  panel.classList.add('is-reordering');
  row.classList.add('is-dragging');

  const placeIndicator = () => {
    const anchor = rows[target]!;
    const top = target > displayIndex ? anchor.offsetTop + anchor.offsetHeight : anchor.offsetTop;
    indicator.style.top = `${top - 1}px`;
    indicator.hidden = target === displayIndex;
  };
  placeIndicator();

  const onMove = (moveEvent: PointerEvent) => {
    row.style.transform = `translateY(${moveEvent.clientY - startY}px)`;
    // The row lands after every other row whose middle the pointer is below.
    target = midpoints.filter((midpoint, index) => index !== displayIndex && moveEvent.clientY > midpoint).length;
    placeIndicator();
  };
  const finish = (endEvent: PointerEvent) => {
    grip.removeEventListener('pointermove', onMove);
    grip.removeEventListener('pointerup', finish);
    grip.removeEventListener('pointercancel', finish);
    if (grip.hasPointerCapture(endEvent.pointerId)) grip.releasePointerCapture(endEvent.pointerId);
    indicator.remove();
    row.classList.remove('is-dragging');
    row.style.transform = '';
    panel.classList.remove('is-reordering');
    if (endEvent.type === 'pointerup') drop(target);
  };
  grip.addEventListener('pointermove', onMove);
  grip.addEventListener('pointerup', finish);
  grip.addEventListener('pointercancel', finish);
}

function openRename(nameButton: HTMLButtonElement, layer: CanvasLayer, actions: CanvasLayersPanelActions): void {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'hvy-canvas-layer-rename';
  input.value = layer.name;
  input.setAttribute('aria-label', `Rename ${layer.name}`);
  let done = false;
  const finish = (save: boolean) => {
    if (done) return;
    done = true;
    const next = input.value.trim();
    input.remove();
    if (save && next && next !== layer.name) actions.rename(layer.id, next);
    else actions.select(layer.id, false);
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') finish(true);
    if (event.key === 'Escape') finish(false);
    event.stopPropagation();
  });
  input.addEventListener('blur', () => finish(true));
  nameButton.replaceWith(input);
  input.focus();
  input.select();
}
