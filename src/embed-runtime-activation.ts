import { activateStateRuntime, type StateRuntime } from './state';

const rootRuntimes = new WeakMap<HTMLElement, StateRuntime>();
const boundRuntimeRoots = new WeakSet<HTMLElement>();

export function bindEmbedRuntimeActivation(root: HTMLElement, runtime: StateRuntime): void {
  rootRuntimes.set(root, runtime);
  if (boundRuntimeRoots.has(root)) return;
  boundRuntimeRoots.add(root);
  root.addEventListener('click', () => activateStateRuntime(rootRuntimes.get(root)!), { capture: true });
  root.addEventListener('dblclick', () => activateStateRuntime(rootRuntimes.get(root)!), { capture: true });
  root.addEventListener('mousedown', () => activateStateRuntime(rootRuntimes.get(root)!), { capture: true });
  root.addEventListener('mouseup', () => activateStateRuntime(rootRuntimes.get(root)!), { capture: true });
  root.addEventListener('pointerdown', () => activateStateRuntime(rootRuntimes.get(root)!), { capture: true });
  root.addEventListener('pointerup', () => activateStateRuntime(rootRuntimes.get(root)!), { capture: true });
  root.addEventListener('contextmenu', () => activateStateRuntime(rootRuntimes.get(root)!), { capture: true });
  root.addEventListener('input', () => activateStateRuntime(rootRuntimes.get(root)!), { capture: true });
  root.addEventListener('change', () => activateStateRuntime(rootRuntimes.get(root)!), { capture: true });
  root.addEventListener('keydown', () => activateStateRuntime(rootRuntimes.get(root)!), { capture: true });
  root.addEventListener('keyup', () => activateStateRuntime(rootRuntimes.get(root)!), { capture: true });
  root.addEventListener('focusin', () => activateStateRuntime(rootRuntimes.get(root)!), { capture: true });
  root.addEventListener('submit', () => activateStateRuntime(rootRuntimes.get(root)!), { capture: true });
  root.addEventListener('dragstart', () => activateStateRuntime(rootRuntimes.get(root)!), { capture: true });
  root.addEventListener('dragover', () => activateStateRuntime(rootRuntimes.get(root)!), { capture: true });
  root.addEventListener('drop', () => activateStateRuntime(rootRuntimes.get(root)!), { capture: true });
}
