import helpHvyRaw from './help.hvy?raw';
import { deserializeDocument } from '../../serialization';

import { getReaderRenderer, state } from '../../state';
import { findSectionByKey } from '../../section-ops';

let cachedDoc: ReturnType<typeof deserializeDocument> | null = null;
let cachedHelpHtml: string | null = null;

function getHelpDoc() {
  if (!cachedDoc) {
    cachedDoc = deserializeDocument(helpHvyRaw, '.hvy');
  }
  return cachedDoc;
}

function renderHelpHtml(): string {
  const previousView = state.currentView;
  try {
    state.currentView = 'viewer';
    const doc = getHelpDoc();
    const renderer = getReaderRenderer();
    if (renderer && renderer.renderReaderSections) {
      cachedHelpHtml = renderer.renderReaderSections(doc.sections);
    } else {
      cachedHelpHtml = `<p>Failed to access HVY reader renderer.</p>`;
    }
  } catch (error) {
    cachedHelpHtml = `<p>Failed to render help: ${error instanceof Error ? error.message : String(error)}</p>`;
  } finally {
    state.currentView = previousView;
  }
  return cachedHelpHtml || '';
}

let activeModalRoot: HTMLElement | null = null;

export function openScriptingHelpModal(invoker?: HTMLElement | null): void {
  if (activeModalRoot) return;
  const modalRoot = document.createElement('div');
  modalRoot.className = 'modal-root hvy-scripting-help-modal-root';

  const modal = document.createElement('div');
  modal.className = 'modal-panel hvy-scripting-help-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'scriptingHelpModalTitle');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.dataset.scriptingHelpAction = 'close';

  const head = document.createElement('div');
  head.className = 'modal-head';
  const title = document.createElement('h3');
  title.id = 'scriptingHelpModalTitle';
  title.textContent = 'Scripting plugin — Help';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'ghost';
  close.dataset.scriptingHelpAction = 'close';
  close.textContent = 'Close';
  const actions = document.createElement('div');
  actions.className = 'modal-head-actions';
  actions.appendChild(close);
  head.appendChild(title);
  head.appendChild(actions);

  const body = document.createElement('div');
  body.className = 'hvy-scripting-help-modal-body reader-document hvy-reader-surface';
  body.innerHTML = renderHelpHtml();

  modal.appendChild(head);
  modal.appendChild(body);
  modalRoot.appendChild(overlay);
  modalRoot.appendChild(modal);

  const dismiss = () => {
    modalRoot.remove();
    document.removeEventListener('keydown', onKey);
    activeModalRoot = null;
    invoker?.focus();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      dismiss();
    }
  };
  modalRoot.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest<HTMLElement>('[data-scripting-help-action="close"]')) {
      dismiss();
    }
  });

  // Local handler for reader toggle (expand/collapse help sections)
  modal.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const toggle = target.closest<HTMLElement>('[data-reader-action="toggle-expand"]');
    if (toggle) {
      const sectionKey = toggle.dataset.sectionKey;
      if (!sectionKey || !cachedDoc) return;
      const section = findSectionByKey(cachedDoc.sections, sectionKey);
      if (section) {
        section.expanded = !section.expanded;
        // re-render local doc
        body.innerHTML = renderHelpHtml();
      }
    }
  });

  document.addEventListener('keydown', onKey);

  const mount = invoker?.closest<HTMLElement>('.viewer-shell, .editor-shell')
    ?? invoker?.closest<HTMLElement>('.hvy-embed-layout')
    ?? document.querySelector<HTMLElement>('#app')
    ?? document.body;
  mount.appendChild(modalRoot);
  activeModalRoot = modalRoot;
  close.focus();
}
