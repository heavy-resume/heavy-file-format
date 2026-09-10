import { getActiveStateRuntime, runWithStateRuntime, state, type StateRuntime } from '../../state';
import { undoStateAsync, redoStateAsync } from './_imports';
import { closeSearch, openSearch } from '../../search/actions';

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
      if (event.key === 'Escape' && state.search.open && !_app.querySelector('#modalRoot')) {
        event.preventDefault();
        event.stopPropagation();
        closeSearch(_app);
        return;
      }
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'f' && !event.shiftKey) {
        if (isModalOpen() || isRawEditorOpen(_app)) {
          return;
        }
        event.preventDefault();
        openSearch(_app);
        return;
      }
      if (key === 'z' && !event.shiftKey) {
        if (isNativeUndoTarget(event.target) && !isDocumentUndoTarget(event.target)) {
          return;
        }
        event.preventDefault();
        void undoStateAsync(_app);
        return;
      }
      if (key === 'y' || (key === 'z' && event.shiftKey)) {
        if (isNativeUndoTarget(event.target) && !isDocumentUndoTarget(event.target)) {
          return;
        }
        event.preventDefault();
        void redoStateAsync(_app);
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

function isRawEditorOpen(app: HTMLElement): boolean {
  return Boolean(app.querySelector('.raw-editor-shell'));
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

export function isDocumentUndoTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.closest('.modal-root') && !target.closest('.theme-modal')) {
    return false;
  }
  const field = target.dataset.field ?? '';
  if (field.startsWith('chat-') || field.startsWith('search-') || field.startsWith('cli-')) {
    return false;
  }
  return Boolean(
    target.closest('.editor-block[data-active-editor-block="true"]')
    || target.closest('[data-hvy-plugin-mount="true"][data-plugin-mode="editor"]')
    || field
  );
}
