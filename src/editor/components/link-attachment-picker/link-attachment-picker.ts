import './link-attachment-picker.css';

import {
  encodeUserFileAttachmentTarget,
  formatUserFileAttachmentByteLength,
  listUserFileAttachments,
} from '../../../document-attachments';
import type { VisualDocument } from '../../../types';

const ATTACHMENT_LINK_RESULT_LIMIT = 50;
const attachmentNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function renderLinkAttachmentPicker(): string {
  return `<section class="link-attachment-picker" data-link-attachment-picker="true" hidden>
    <div class="link-attachment-picker-head">
      <strong>Choose an attachment</strong>
      <label class="link-attachment-sort-wrap"><span>Sort</span><select data-link-attachment-sort="true" aria-label="Sort attachments"><option value="recent">Recently added</option><option value="name">Name</option></select></label>
    </div>
    <label class="link-attachment-search-wrap">
      <span>Find an attachment</span>
      <input type="search" data-link-attachment-search="true" placeholder="Search by name or filename" autocomplete="off" />
    </label>
    <div class="link-attachment-options" data-link-attachment-options="true"></div>
    <div class="link-picker-result-status" data-link-attachment-result-status="true" aria-live="polite"></div>
  </section>`;
}

export function refreshLinkAttachmentPicker(root: HTMLElement, document: VisualDocument, selectedTarget = ''): void {
  const attachments = listUserFileAttachments(document);
  const optionsRoot = root.querySelector<HTMLElement>('[data-link-attachment-options="true"]');
  const status = root.querySelector<HTMLElement>('[data-link-attachment-result-status="true"]');
  if (!optionsRoot || !status) return;
  const search = root.querySelector<HTMLInputElement>('[data-link-attachment-search="true"]')?.value.trim().toLocaleLowerCase() ?? '';
  const sort = root.querySelector<HTMLSelectElement>('[data-link-attachment-sort="true"]')?.value ?? 'recent';
  const matching = attachments.map((attachment, index) => ({ attachment, index }))
    .filter(({ attachment }) => `${attachment.name} ${attachment.filename}`.toLocaleLowerCase().includes(search))
    .sort((left, right) => sort === 'name'
      ? attachmentNameCollator.compare(left.attachment.name, right.attachment.name)
      : right.index - left.index);
  const visible = matching.slice(0, ATTACHMENT_LINK_RESULT_LIMIT);
  optionsRoot.innerHTML = attachments.length === 0
    ? '<div class="link-attachment-empty">No attachments in this document. Add them from Document Meta.</div>'
    : visible.length === 0
      ? '<div class="link-attachment-empty">No matching attachments.</div>'
      : visible.map(({ attachment }) => {
        const target = encodeUserFileAttachmentTarget(attachment.name);
        return `<button type="button" class="link-attachment-option${target === selectedTarget ? ' is-selected' : ''}" data-link-modal-action="select-attachment-target" data-link-attachment-target="${escapeAttribute(target)}">
        <strong>${escapeHtml(attachment.name)}</strong>
        <span>${escapeHtml(attachment.filename)} · ${escapeHtml(attachment.mediaType)} · ${formatUserFileAttachmentByteLength(attachment.length)}</span>
      </button>`;
      }).join('');
  status.textContent = matching.length > visible.length
    ? `Showing ${visible.length} of ${matching.length} attachments. Type more to narrow the list.`
    : `${matching.length} attachment${matching.length === 1 ? '' : 's'}`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;');
}
