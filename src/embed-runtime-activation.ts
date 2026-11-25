import { activateStateRuntime, type StateRuntime } from './state';

const rootRuntimes = new WeakMap<HTMLElement, StateRuntime>();
const boundRuntimeRoots = new WeakSet<HTMLElement>();

export function bindEmbedRuntimeActivation(root: HTMLElement, runtime: StateRuntime): void {
  rootRuntimes.set(root, runtime);
  if (boundRuntimeRoots.has(root)) return;
  boundRuntimeRoots.add(root);
  const activate = () => {
    const bound = rootRuntimes.get(root);
    if (bound) activateStateRuntime(bound);
  };
  root.addEventListener('click', activate, { capture: true });
  root.addEventListener('dblclick', activate, { capture: true });
  root.addEventListener('mousedown', activate, { capture: true });
  root.addEventListener('mouseup', activate, { capture: true });
  root.addEventListener('pointerdown', activate, { capture: true });
  root.addEventListener('pointerup', activate, { capture: true });
  root.addEventListener('contextmenu', activate, { capture: true });
  root.addEventListener('input', activate, { capture: true });
  root.addEventListener('change', activate, { capture: true });
  root.addEventListener('keydown', activate, { capture: true });
  root.addEventListener('keyup', activate, { capture: true });
  root.addEventListener('focusin', activate, { capture: true });
  root.addEventListener('submit', activate, { capture: true });
  root.addEventListener('dragstart', activate, { capture: true });
  root.addEventListener('dragover', activate, { capture: true });
  root.addEventListener('drop', activate, { capture: true });
}

export function unbindEmbedRuntimeActivation(root: HTMLElement, runtime: StateRuntime): void {
  if (rootRuntimes.get(root) === runtime) {
    rootRuntimes.delete(root);
  }
}
