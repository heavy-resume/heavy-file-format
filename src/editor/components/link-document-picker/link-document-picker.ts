import './link-document-picker.css';

import type { VisualDocument } from '../../../types';
import { escapeAttr, escapeHtml } from '../../../utils';
import { getDocumentLinkTargetOptionsForDocument } from '../../../xref-ops';

const DOCUMENT_LINK_RESULT_LIMIT = 50;

export function renderLinkDocumentPicker(): string {
  return `<section class="link-document-options" data-link-document-options="true" hidden>
    <label class="link-document-search-wrap">
      <span>Target in this document</span>
      <input type="search" data-link-document-search="true" placeholder="Search by name or ID" autocomplete="off" />
    </label>
    <div class="link-document-option-list" data-link-document-options-list="true"></div>
    <div class="link-picker-result-status" data-link-document-result-status="true" aria-live="polite"></div>
  </section>`;
}

export function refreshLinkDocumentPicker(root: HTMLElement, document: VisualDocument, selectedTarget = ''): void {
  const optionsRoot = root.querySelector<HTMLElement>('[data-link-document-options-list="true"]');
  const status = root.querySelector<HTMLElement>('[data-link-document-result-status="true"]');
  if (!optionsRoot || !status) return;
  const query = root.querySelector<HTMLInputElement>('[data-link-document-search="true"]')?.value.trim().toLocaleLowerCase() ?? '';
  const matches = getDocumentLinkTargetOptionsForDocument(document).filter((option) => (
    !query || `${option.title} ${option.detail} ${option.value}`.toLocaleLowerCase().includes(query)
  ));
  const visible = matches.slice(0, DOCUMENT_LINK_RESULT_LIMIT);
  optionsRoot.innerHTML = visible.length === 0
    ? '<div class="link-picker-empty">No matching targets.</div>'
    : visible.map((option) => {
      const target = `#${option.value}`;
      const detail = option.detail ? `${option.detail} · ${target}` : target;
      return `<button type="button" class="ghost link-document-option${target === selectedTarget ? ' is-selected' : ''}" data-link-modal-action="select-document-target" data-link-document-target="${escapeAttr(target)}">
        <strong>${escapeHtml(option.title)}</strong><span>${escapeHtml(detail)}</span>
      </button>`;
    }).join('');
  status.textContent = matches.length > visible.length
    ? `Showing ${visible.length} of ${matches.length} targets. Type more to narrow the list.`
    : `${matches.length} target${matches.length === 1 ? '' : 's'}`;
}
