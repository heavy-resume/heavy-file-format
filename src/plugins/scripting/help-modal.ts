import helpHvyRaw from './help.hvy?raw';
import { deserializeDocument } from '../../serialization';

import { getReaderRenderer } from '../../state';
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
  try {
    const doc = getHelpDoc();
    const renderer = getReaderRenderer();
    if (renderer && renderer.renderReaderSections) {
      cachedHelpHtml = renderer.renderReaderSections(doc.sections);
    } else {
      cachedHelpHtml = `<p>Failed to access HVY reader renderer.</p>`;
    }
  } catch (error) {
    cachedHelpHtml = `<p>Failed to render help: ${error instanceof Error ? error.message : String(error)}</p>`;
  }
  return cachedHelpHtml || '';
}

let activeBackdrop: HTMLElement | null = null;

export function openScriptingHelpModal(): void {
  if (activeBackdrop) return;
  const backdrop = document.createElement('div');
  backdrop.className = 'hvy-scripting-help-modal-backdrop';

  const modal = document.createElement('div');
  modal.className = 'hvy-scripting-help-modal';

  const head = document.createElement('div');
  head.className = 'hvy-scripting-help-modal-head';
  const title = document.createElement('strong');
  title.textContent = 'Scripting plugin — Help';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'ghost';
  close.textContent = 'Close';
  head.appendChild(title);
  head.appendChild(close);

  const body = document.createElement('div');
  body.className = 'hvy-scripting-help-modal-body reader-pane';
  body.innerHTML = renderHelpHtml();

  modal.appendChild(head);
  modal.appendChild(body);
  backdrop.appendChild(modal);

  const dismiss = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    activeBackdrop = null;
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      dismiss();
    }
  };
  close.addEventListener('click', dismiss);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) {
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

  document.body.appendChild(backdrop);
  activeBackdrop = backdrop;
}
