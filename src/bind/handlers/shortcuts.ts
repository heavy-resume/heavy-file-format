import { getActiveStateRuntime, runWithStateRuntime, type StateRuntime } from '../../state';
import { undoState, redoState } from './_imports';
import { openSearch } from '../../search/actions';
import { consumeNextUndoTargetsDocument } from '../../edit-command-routing';

const shortcutRoots = new WeakSet<HTMLElement>();
const shortcutRootRuntimes = new WeakMap<HTMLElement, StateRuntime | null>();

export function bindShortcuts(_app: HTMLElement): void {
  let boundRuntime: StateRuntime | null = null;
  try {
    boundRuntime = getActiveStateRuntime();
  } catch {
    boundRuntime = null;
  }
  shortcutRootRuntimes.set(_app, boundRuntime);
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
  window.addEventListener('keydown', (event) => {
    if ('isConnected' in _app && !_app.isConnected) {
      return;
    }
    const targetInsideApp = event.target instanceof HTMLElement && containsAppNode(event.target);
    const activeElement = typeof document === 'undefined' ? null : document.activeElement;
    const focusInsideApp = activeElement instanceof HTMLElement && containsAppNode(activeElement);
    const pageFocus = typeof document !== 'undefined' && activeElement === document.body;
    if ((!targetInsideApp && !focusInsideApp && !pageFocus) || event.defaultPrevented) {
      return;
    }
    const handleShortcut = () => {
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
        const routeToDocument = consumeNextUndoTargetsDocument();
        if (!routeToDocument && isNativeUndoTarget(event.target) && hasNativeEditCommand(event.target, 'undo')) {
          return;
        }
        event.preventDefault();
        undoState();
        return;
      }
      if (key === 'y' || (key === 'z' && event.shiftKey)) {
        if (isNativeUndoTarget(event.target) && hasNativeEditCommand(event.target, 'redo')) {
          return;
        }
        event.preventDefault();
        redoState();
      }
    };
    const runtime = shortcutRootRuntimes.get(_app) ?? null;
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
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true;
  }
  return target.isContentEditable;
}

function hasNativeEditCommand(target: EventTarget | null, command: 'undo' | 'redo'): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return typeof document !== 'undefined' && document.queryCommandEnabled(command);
  }
  return true;
}
