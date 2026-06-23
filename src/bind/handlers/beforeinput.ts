import { handleRichEditorBeforeInput, handleRichEditorCopy, handleRichEditorPlainTextPaste } from './_imports';

export function bindBeforeinput(app: HTMLElement): void {
  app.addEventListener('copy', (event) => {
    const editable = getRichEditable(event.target as HTMLElement);
    if (!editable) {
      return;
    }
    handleRichEditorCopy(event, editable);
  });

  app.addEventListener('paste', (event) => {
    const editable = getRichEditable(event.target as HTMLElement);
    if (!editable || !consumePendingPlainPaste(editable)) {
      return;
    }

    if (!handleRichEditorPlainTextPaste(event, editable)) {
      return;
    }

    event.preventDefault();
  });

  app.addEventListener('beforeinput', (event) => {
    const editable = getRichEditable(event.target as HTMLElement);

    if (!editable) {
      return;
    }

    if (!handleRichEditorBeforeInput(event as InputEvent, editable)) {
      return;
    }

    event.preventDefault();
  });
}

function getRichEditable(target: HTMLElement): HTMLElement | null {
  return target.dataset.field === 'block-rich' ||
    target.dataset.field === 'block-grid-rich' ||
    target.dataset.field === 'table-details-rich' ||
    target.dataset.field === 'caption-rich'
    ? target
    : target.closest<HTMLElement>(
        '[data-field="block-rich"], [data-field="block-grid-rich"], [data-field="table-details-rich"], [data-field="caption-rich"]'
      );
}

function consumePendingPlainPaste(editable: HTMLElement): boolean {
  const until = Number(editable.dataset.hvyPlainPasteUntil ?? '0');
  delete editable.dataset.hvyPlainPasteUntil;
  return Number.isFinite(until) && until >= Date.now();
}
