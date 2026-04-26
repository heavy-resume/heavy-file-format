import { appActionRegistry } from '../app-actions/registry';

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

    const sectionKey = actionButton.dataset.sectionKey ?? '';
    const blockId = actionButton.dataset.blockId ?? '';

    handler({ app, actionButton, event, sectionKey, blockId, target });
  });
}
