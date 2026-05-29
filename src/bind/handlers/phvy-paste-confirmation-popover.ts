let pendingConfirmPaste: (() => void) | null = null;
let pendingCancelPaste: (() => void) | null = null;

export function openPhvyPasteConfirmationPopover(confirmPaste: () => void, cancelPaste: () => void, app: HTMLElement): void {
  closePhvyPasteConfirmationPopover();
  pendingConfirmPaste = confirmPaste;
  pendingCancelPaste = cancelPaste;

  const modal = document.createElement('div');
  modal.className = 'modal-root phvy-paste-confirmation-popover-root';
  modal.innerHTML = `
    <div class="modal-overlay" data-phvy-paste-action="cancel"></div>
    <section class="modal-panel remove-confirmation-modal phvy-paste-confirmation-popover" role="dialog" aria-modal="true" aria-labelledby="phvyPasteConfirmationTitle">
      <div class="modal-head">
        <h3 id="phvyPasteConfirmationTitle">Remove incompatible components?</h3>
      </div>
      <div class="modal-head-actions">
        <button type="button" class="secondary" data-phvy-paste-action="confirm">Yes</button>
        <button type="button" class="ghost" data-phvy-paste-action="cancel">No</button>
      </div>
    </section>
  `;

  modal.addEventListener('click', (event) => {
    const target = hasClosest(event.target) ? event.target : null;
    const action = target?.closest<HTMLElement>('[data-phvy-paste-action]')?.dataset.phvyPasteAction;
    if (action === 'confirm' && pendingConfirmPaste) {
      const confirm = pendingConfirmPaste;
      closePhvyPasteConfirmationPopover();
      confirm();
      return;
    }
    if (action === 'cancel' && pendingCancelPaste) {
      const cancel = pendingCancelPaste;
      closePhvyPasteConfirmationPopover();
      cancel();
    }
  });

  app.append(modal);
}

function hasClosest(value: EventTarget | null): value is HTMLElement {
  return !!value && typeof (value as HTMLElement).closest === 'function';
}

export function closePhvyPasteConfirmationPopover(): void {
  document.querySelector('.phvy-paste-confirmation-popover-root')?.remove();
  pendingConfirmPaste = null;
  pendingCancelPaste = null;
}
