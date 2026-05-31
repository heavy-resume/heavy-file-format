import { getActiveStateRuntime, runWithStateRuntime } from '../../state';
import { undoState, redoState } from './_imports';
import { openSearch } from '../../search/actions';

const shortcutRoots = new WeakSet<HTMLElement>();

export function bindShortcuts(_app: HTMLElement): void {
  if (shortcutRoots.has(_app)) {
    return;
  }
  shortcutRoots.add(_app);
  const containsAppNode = (node: HTMLElement | null): boolean => {
    if (!node) {
      return false;
    }
    return typeof _app.contains === 'function' ? _app.contains(node) : true;
  };
  let runtime: ReturnType<typeof getActiveStateRuntime> | null = null;
  try {
    runtime = getActiveStateRuntime();
  } catch {
    runtime = null;
  }
  window.addEventListener('keydown', (event) => {
    const targetInsideApp = event.target instanceof HTMLElement && containsAppNode(event.target);
    const activeElement = typeof document === 'undefined' ? null : document.activeElement;
    const focusInsideApp = activeElement instanceof HTMLElement && containsAppNode(activeElement);
    const pageFocus = typeof document !== 'undefined' && activeElement === document.body;
    if ((!targetInsideApp && !focusInsideApp && !pageFocus) || event.defaultPrevented) {
      return;
    }
    const handleShortcut = () => {
      if (isNativeUndoTarget(event.target)) {
        return;
      }
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'f' && !event.shiftKey) {
        if (isModalOpen()) {
          return;
        }
        event.preventDefault();
        openSearch(_app);
        return;
      }
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undoState();
        return;
      }
      if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault();
        redoState();
      }
    };
    if (runtime) {
      runWithStateRuntime(runtime, handleShortcut);
    } else {
      handleShortcut();
    }
  }, { capture: true });
}

function isModalOpen(): boolean {
  return Boolean(document.querySelector('.modal-root'));
}

export function isNativeUndoTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.closest('.theme-modal')) {
    return false;
  }
  if (target.closest('.rich-editor')) {
    return false;
  }
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true;
  }
  return target.isContentEditable;
}
