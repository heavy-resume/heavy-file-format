import { handleInlineCheckboxBackspace } from './_imports';

export function bindBeforeinput(app: HTMLElement): void {
  app.addEventListener('beforeinput', (event) => {
    const target = event.target as HTMLElement;
    if (
      target.dataset.field !== 'block-rich' &&
      target.dataset.field !== 'block-grid-rich' &&
      target.dataset.field !== 'table-details-rich'
    ) {
      return;
    }

    if ((event as InputEvent).inputType !== 'deleteContentBackward') {
      return;
    }

    if (!handleInlineCheckboxBackspace(target)) {
      return;
    }

    event.preventDefault();
    target.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
}
