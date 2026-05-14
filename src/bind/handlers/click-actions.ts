import { appActionRegistry } from '../app-actions/registry';
import { openRemoveConfirmationModal } from './remove-confirmation-modal';
import { logClickTrace } from '../click-trace';

export function bindClickActions(app: HTMLElement): void {
  app.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const actionButton = target.closest<HTMLElement>('[data-action]');
    logClickTrace(event, 'app-action-dispatch:enter', {
      action: actionButton?.dataset.action ?? null,
    });
    if (!actionButton) {
      logClickTrace(event, 'app-action-dispatch:skip', {
        skipReason: 'no-data-action',
      });
      return;
    }

    const action = actionButton.dataset.action;
    if (!action) {
      logClickTrace(event, 'app-action-dispatch:skip', {
        skipReason: 'missing-action',
      });
      return;
    }

    const handler = appActionRegistry[action];
    if (!handler) {
      logClickTrace(event, 'app-action-dispatch:skip', {
        skipReason: 'no-app-action-handler',
        action,
      });
      return;
    }

    if (requiresRemoveConfirmation(action)) {
      event.preventDefault();
      logClickTrace(event, 'app-action-dispatch:confirm-required', {
        action,
      });
      openRemoveConfirmationModal(() => {
        const sectionKey = actionButton.dataset.sectionKey ?? '';
        const blockId = actionButton.dataset.blockId ?? '';
        handler({ app, actionButton, event, sectionKey, blockId, target });
      }, app);
      return;
    }

    const sectionKey = actionButton.dataset.sectionKey ?? '';
    const blockId = actionButton.dataset.blockId ?? '';

    logClickTrace(event, 'app-action-dispatch:handled', {
      action,
      sectionKey,
      blockId,
    });
    handler({ app, actionButton, event, sectionKey, blockId, target });
  });
}

function requiresRemoveConfirmation(action: string): boolean {
  return new Set(['remove-component-def', 'remove-section-def']).has(action);
}
