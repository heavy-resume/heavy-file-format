import { handleInlineCheckboxBackspace } from './_imports';

export function bindBeforeinput(app: HTMLElement): void {
  app.addEventListener('beforeinput', (event) => {
    const target = event.target as HTMLElement;
    const editable =
      target.dataset.field === 'block-rich' ||
      target.dataset.field === 'block-grid-rich' ||
      target.dataset.field === 'table-details-rich'
        ? target
        : target.closest<HTMLElement>(
            '[data-field="block-rich"], [data-field="block-grid-rich"], [data-field="table-details-rich"]'
          );

    if (!editable) {
      return;
    }

    if ((event as InputEvent).inputType !== 'deleteContentBackward') {
      return;
    }

    if (!handleInlineCheckboxBackspace(editable)) {
      return;
    }

    event.preventDefault();
    editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
}
