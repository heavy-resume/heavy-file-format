import { marked } from 'marked';
import DOMPurify from 'dompurify';
import helpHvyRaw from './help.hvy?raw';
import { deserializeDocument } from '../../serialization';
import type { VisualSection } from '../../editor/types';

let cachedHelpHtml: string | null = null;

function renderHelpHtml(): string {
  if (cachedHelpHtml !== null) {
    return cachedHelpHtml;
  }
  try {
    const doc = deserializeDocument(helpHvyRaw, '.hvy');
    cachedHelpHtml = renderSections(doc.sections);
  } catch (error) {
    cachedHelpHtml = `<p>Failed to render help: ${error instanceof Error ? error.message : String(error)}</p>`;
  }
  return cachedHelpHtml;
}

function renderSections(sections: VisualSection[]): string {
  return sections
    .map((section) => {
      const title = section.title || 'Section';
      const collapsed = section.expanded === false;
      const body = section.blocks
        .map((block) => {
          const text = block.text ?? '';
          if (text.trim().length === 0) {
            return '';
          }
          const html = DOMPurify.sanitize(marked.parse(text) as string);
          return `<div class="hvy-scripting-help-block">${html}</div>`;
        })
        .join('');
      const childHtml = renderSections(section.children);
      const inner = `${body}${childHtml}`;
      const escapedTitle = escapeHtml(title);
      if (collapsed) {
        return `<details><summary>${escapedTitle}</summary>${inner}</details>`;
      }
      return `<details open><summary>${escapedTitle}</summary>${inner}</details>`;
    })
    .join('');
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
  body.className = 'hvy-scripting-help-modal-body';
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
  document.addEventListener('keydown', onKey);

  document.body.appendChild(backdrop);
  activeBackdrop = backdrop;
}
