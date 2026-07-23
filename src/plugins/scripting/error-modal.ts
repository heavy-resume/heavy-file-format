import './error-modal.css';

let activeErrorModalRoot: HTMLElement | null = null;

export function openScriptingErrorModal(detail: string, invoker?: HTMLElement | null): void {
  activeErrorModalRoot?.remove();

  const modalRoot = document.createElement('div');
  modalRoot.className = 'modal-root hvy-scripting-error-modal-root';

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.dataset.scriptingErrorAction = 'close';

  const modal = document.createElement('section');
  modal.className = 'modal-panel hvy-scripting-error-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'hvyScriptingErrorModalTitle');

  const head = document.createElement('div');
  head.className = 'modal-head';
  const title = document.createElement('h3');
  title.id = 'hvyScriptingErrorModalTitle';
  title.textContent = 'Script traceback';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'ghost';
  close.dataset.scriptingErrorAction = 'close';
  close.textContent = 'Close';
  head.appendChild(title);
  head.appendChild(close);

  const traceback = document.createElement('pre');
  traceback.className = 'hvy-scripting-error-modal-detail';
  traceback.textContent = detail;

  modal.appendChild(head);
  modal.appendChild(traceback);
  modalRoot.appendChild(overlay);
  modalRoot.appendChild(modal);

  const dismiss = () => {
    modalRoot.remove();
    document.removeEventListener('keydown', onKey);
    if (activeErrorModalRoot === modalRoot) activeErrorModalRoot = null;
    invoker?.focus();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') dismiss();
  };
  modalRoot.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('[data-scripting-error-action="close"]')) dismiss();
  });
  document.addEventListener('keydown', onKey);

  const mount = invoker?.closest<HTMLElement>('.viewer-shell, .editor-shell')
    ?? invoker?.closest<HTMLElement>('.hvy-embed-layout')
    ?? document.querySelector<HTMLElement>('#app')
    ?? document.body;
  mount.appendChild(modalRoot);
  activeErrorModalRoot = modalRoot;
  close.focus();
}
