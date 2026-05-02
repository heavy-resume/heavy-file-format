import { appActionRegistry } from '../app-actions/registry';
import { openRemoveConfirmationModal } from './remove-confirmation-modal';

export function bindClickActions(app: HTMLElement): void {
  app.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const actionButton = target.closest<HTMLElement>('[data-action]');
    if (!actionButton) {
      return;
    }

    const action = actionButton.dataset.action;
    if (!action) {
      return;
    }

    const handler = appActionRegistry[action];
    if (!handler) {
      return;
    }

    if (requiresRemoveConfirmation(action)) {
      event.preventDefault();
      openRemoveConfirmationModal(() => {
        const sectionKey = actionButton.dataset.sectionKey ?? '';
        const blockId = actionButton.dataset.blockId ?? '';
        handler({ app, actionButton, event, sectionKey, blockId, target });
      });
      return;
    }

    const sectionKey = actionButton.dataset.sectionKey ?? '';
    const blockId = actionButton.dataset.blockId ?? '';

    handler({ app, actionButton, event, sectionKey, blockId, target });
  });
}

function requiresRemoveConfirmation(action: string): boolean {
  return new Set(['remove-component-def', 'remove-section-def']).has(action);
}
