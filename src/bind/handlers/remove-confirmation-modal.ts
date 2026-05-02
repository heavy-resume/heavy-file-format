let pendingConfirmDeletion: (() => void) | null = null;

export function openRemoveConfirmationModal(onConfirm: () => void): void {
  closeRemoveConfirmationModal(false);
  pendingConfirmDeletion = onConfirm;
  const modal = document.createElement('div');
  modal.className = 'modal-root remove-confirmation-modal-root';
  modal.innerHTML = `
    <div class="modal-overlay" data-remove-modal-action="cancel"></div>
    <section class="modal-panel remove-confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="removeConfirmationTitle">
      <div class="modal-head">
        <h3 id="removeConfirmationTitle">Confirm deletion?</h3>
      </div>
      <div class="modal-head-actions">
        <button type="button" class="ghost" data-remove-modal-action="cancel">Cancel</button>
        <button type="button" class="danger" data-remove-modal-action="confirm">Delete</button>
      </div>
    </section>
  `;
  modal.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const removeModalAction = target.closest<HTMLElement>('[data-remove-modal-action]');
    if (!removeModalAction) {
      return;
    }
    event.preventDefault();
    const action = removeModalAction.dataset.removeModalAction;
    if (action === 'confirm' && pendingConfirmDeletion) {
      const confirmDeletion = pendingConfirmDeletion;
      closeRemoveConfirmationModal();
      confirmDeletion();
      return;
    }
    closeRemoveConfirmationModal();
  });
  document.body.appendChild(modal);
  modal.querySelector<HTMLButtonElement>('[data-remove-modal-action="cancel"]')?.focus();
}

export function closeRemoveConfirmationModal(clearPending = true): void {
  document.querySelector('.remove-confirmation-modal-root')?.remove();
  if (clearPending) {
    pendingConfirmDeletion = null;
  }
}
