import { shortcutsBound, setShortcutsBound, undoState, redoState } from './_imports';

export function bindShortcuts(_app: HTMLElement): void {
  if (!shortcutsBound) {
    window.addEventListener('keydown', (event) => {
      if (isNativeUndoTarget(event.target)) {
        return;
      }
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undoState();
        return;
      }
      if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault();
        redoState();
      }
    });
    setShortcutsBound(true);
  }
}

export function isNativeUndoTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true;
  }
  return target.isContentEditable;
}
