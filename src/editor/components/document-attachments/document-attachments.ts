import './document-attachments.css';

import {
  canPreviewUserFileAttachment,
  countUserFileAttachmentReferences,
  createUniqueUserFileAttachmentId,
  defaultUserFileAttachmentName,
  formatUserFileAttachmentByteLength,
  getUserFileAttachmentCategory,
  inferUserFileAttachmentMediaType,
  listUserFileAttachments,
  normalizeUserFileAttachmentName,
  removeUserFileAttachment,
  renameUserFileAttachment,
  replaceUserFileAttachment,
  storeUserFileAttachment,
  suggestUniqueUserFileAttachmentName,
  type UserFileAttachmentDescriptor,
  type UserFileAttachmentCategory,
} from '../../../document-attachments';
import { performUserFileAttachmentAction } from '../../../document-attachment-actions';
import { runUserFileAttachmentHistoryCommand } from '../../../attachment-history-controller';
import { captureHistoryStackState, recordHistory, restoreHistoryStackState } from '../../../history';
import { closeIcon, plusIcon } from '../../../icons';
import { getRenderApp, state } from '../../../state';
import { openRemoveConfirmationModal } from '../../../bind/handlers/remove-confirmation-modal';
import type { VisualDocument } from '../../../types';
import { renderDeleteControl } from '../delete-control/delete-control';

interface AttachmentManagerRenderHelpers {
  escapeAttr(value: string): string;
  escapeHtml(value: string): string;
}

const boundRoots = new WeakSet<HTMLElement>();

export function renderDocumentAttachmentManager(
  document: VisualDocument,
  helpers: AttachmentManagerRenderHelpers,
): string {
  const attachments = listUserFileAttachments(document);
  const availableCategories = new Set(attachments.map((attachment) => getUserFileAttachmentCategory(attachment.mediaType)));
  const filters = ([
    { value: 'pdf', label: 'PDF' },
    { value: 'image', label: 'Images' },
    { value: 'audio', label: 'Audio' },
    { value: 'video', label: 'Video' },
    { value: 'text', label: 'Text' },
    { value: 'other', label: 'Other' },
  ] satisfies Array<{ value: UserFileAttachmentCategory; label: string }>)
    .filter((filter) => availableCategories.has(filter.value));
  return `<section class="document-attachment-manager" data-document-attachment-manager="true">
    <div class="document-attachment-manager-head">
      <div>
        <strong>Attachments</strong>
        <span>${attachments.length} file${attachments.length === 1 ? '' : 's'}</span>
      </div>
      <label class="hvy-button secondary document-attachment-add">
        ${plusIcon()}
        <span>Add files</span>
        <input type="file" multiple data-document-attachment-upload="true" />
      </label>
    </div>
    <p class="document-attachment-manager-help">Files live with this document and can be linked from text by name.</p>
    <div class="document-attachment-dropzone" data-document-attachment-dropzone="true" tabindex="0">
      ${attachmentTrayIcon()}
      <span>Drop PDFs or other files here</span>
    </div>
    <div class="document-attachment-tools"${attachments.length === 0 ? ' hidden' : ''}>
      <input type="search" data-document-attachment-search="true" placeholder="Search attachments" autocomplete="off" />
      <div class="document-attachment-filters" role="group" aria-label="Filter attachments by type">
        <button type="button" class="ghost document-attachment-filter is-active" data-document-attachment-filter="all" aria-pressed="true">All</button>
        ${filters.map((filter) => `<button type="button" class="ghost document-attachment-filter" data-document-attachment-filter="${filter.value}" aria-pressed="false">${filter.label}</button>`).join('')}
      </div>
    </div>
    <div class="document-attachment-status" data-document-attachment-status="true" role="status"></div>
    <div class="document-attachment-list">
      ${attachments.length === 0
        ? `<div class="document-attachment-empty">${attachmentDocumentIcon()}<strong>No document attachments</strong><span>Add a file here, or attach one while creating a link.</span></div>`
        : attachments.map((attachment) => renderAttachmentRow(document, attachment, helpers)).join('')}
    </div>
  </section>`;
}

export function bindDocumentAttachmentManager(app: HTMLElement): void {
  if (boundRoots.has(app)) return;
  boundRoots.add(app);

  app.addEventListener('input', (event) => {
    const input = event.target;
    if (input instanceof HTMLInputElement && input.dataset.documentAttachmentSearch === 'true') {
      filterAttachmentRows(input.closest<HTMLElement>('[data-document-attachment-manager="true"]'));
    }
  });

  app.addEventListener('change', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (input.dataset.documentAttachmentUpload === 'true') {
      const files = Array.from(input.files ?? []);
      input.value = '';
      if (files.length > 0) void addAttachmentFiles(app, files);
      return;
    }
    const id = input.dataset.documentAttachmentId ?? '';
    if (input.dataset.documentAttachmentReplace === 'true') {
      const file = input.files?.[0];
      input.value = '';
      if (id && file) void replaceAttachmentFile(app, id, file);
      return;
    }
    if (input.dataset.documentAttachmentName === 'true' && id) {
      void commitAttachmentName(app, input, id);
    }
  });

  app.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const filter = target.closest<HTMLButtonElement>('[data-document-attachment-filter]');
    if (filter) {
      const manager = filter.closest<HTMLElement>('[data-document-attachment-manager="true"]');
      manager?.querySelectorAll<HTMLButtonElement>('[data-document-attachment-filter]').forEach((button) => {
        const active = button === filter;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      filterAttachmentRows(manager);
      return;
    }
    const action = target.closest<HTMLElement>('[data-document-attachment-action]');
    const id = action?.dataset.documentAttachmentId ?? '';
    if (!action || !id) return;
    if (action.dataset.documentAttachmentAction === 'preview') {
      void previewAttachment(app, id);
    } else if (action.dataset.documentAttachmentAction === 'download') {
      void downloadAttachment(app, id);
    } else if (action.dataset.documentAttachmentAction === 'delete') {
      const descriptor = listUserFileAttachments(state.document).find((entry) => entry.id === id);
      if (!descriptor) return;
      const references = countUserFileAttachmentReferences(state.document, descriptor.name);
      openRemoveConfirmationModal(() => void deleteAttachment(app, id), app);
      setAttachmentManagerStatus(app, references > 0
        ? `${descriptor.name} is linked ${references} time${references === 1 ? '' : 's'}. Confirm deletion to remove it.`
        : `Confirm deletion of ${descriptor.name}.`);
    }
  });

  app.addEventListener('dragenter', handleAttachmentDrag);
  app.addEventListener('dragover', handleAttachmentDrag);
  app.addEventListener('dragleave', (event) => {
    const dropzone = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-document-attachment-dropzone="true"]');
    if (dropzone && !dropzone.contains(event.relatedTarget as Node | null)) {
      dropzone.classList.remove('is-dragging');
    }
    if (!app.contains(event.relatedTarget as Node | null)) clearGeneralAttachmentDrag(app);
  });
  app.addEventListener('drop', (event) => {
    const dropzone = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-document-attachment-dropzone="true"]');
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (dropzone) {
      event.preventDefault();
      event.stopImmediatePropagation();
      dropzone.classList.remove('is-dragging');
      if (files.length > 0) void addAttachmentFiles(app, files);
      return;
    }
    clearGeneralAttachmentDrag(app);
    if (!isGeneralDocumentDropTarget(event.target) || files.length === 0 || files.every(isImageFile)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openAttachmentDropConfirmation(app, files);
  });
}

function renderAttachmentRow(
  document: VisualDocument,
  attachment: UserFileAttachmentDescriptor,
  helpers: AttachmentManagerRenderHelpers,
): string {
  const category = getUserFileAttachmentCategory(attachment.mediaType);
  const references = countUserFileAttachmentReferences(document, attachment.name);
  const usage = references === 0 ? 'Not linked' : `Linked ${references} time${references === 1 ? '' : 's'}`;
  const searchable = `${attachment.name} ${attachment.filename}`.toLocaleLowerCase();
  return `<article class="document-attachment-row" data-document-attachment-row="true" data-document-attachment-category="${category}" data-document-attachment-searchable="${helpers.escapeAttr(searchable)}" data-document-attachment-id="${helpers.escapeAttr(attachment.id)}">
    <div class="document-attachment-kind is-${category}">${attachmentTypeIcon(category)}<span>${category === 'pdf' ? 'PDF' : category}</span></div>
    <div class="document-attachment-details">
      <input class="document-attachment-name" data-document-attachment-name="true" data-document-attachment-id="${helpers.escapeAttr(attachment.id)}" value="${helpers.escapeAttr(attachment.name)}" aria-label="Attachment name for ${helpers.escapeAttr(attachment.filename)}" />
      <div class="document-attachment-file-meta">
        <span title="${helpers.escapeAttr(attachment.filename)}">${helpers.escapeHtml(attachment.filename)}</span>
        <span>${formatUserFileAttachmentByteLength(attachment.length)}</span>
        <span class="document-attachment-usage${references === 0 ? ' is-unused' : ''}">${usage}</span>
      </div>
    </div>
    <div class="document-attachment-actions">
      ${canPreviewUserFileAttachment(attachment.mediaType) ? `<button type="button" class="ghost" data-document-attachment-action="preview" data-document-attachment-id="${helpers.escapeAttr(attachment.id)}">Preview</button>` : ''}
      <button type="button" class="ghost" data-document-attachment-action="download" data-document-attachment-id="${helpers.escapeAttr(attachment.id)}">Download</button>
      <label class="hvy-button ghost document-attachment-replace">Replace<input type="file" data-document-attachment-replace="true" data-document-attachment-id="${helpers.escapeAttr(attachment.id)}" /></label>
      ${renderDeleteControl({
        className: 'document-attachment-delete',
        label: `Delete attachment ${attachment.name}`,
        title: 'Delete attachment',
        attributes: {
          'data-document-attachment-action': 'delete',
          'data-document-attachment-id': attachment.id,
        },
      })}
    </div>
  </article>`;
}

async function addAttachmentFiles(app: HTMLElement, files: File[]): Promise<void> {
  const namedFiles = files.map((file) => ({
    file,
    name: suggestUniqueUserFileAttachmentName(state.document, defaultUserFileAttachmentName(file.name)),
  }));
  await storeNamedAttachmentFiles(app, namedFiles);
}

async function storeNamedAttachmentFiles(app: HTMLElement, namedFiles: Array<{ file: File; name: string }>): Promise<void> {
  let lastId = '';
  try {
    const requests: Array<{ id: string; name: string; filename: string; mediaType: string; bytes: Uint8Array }> = [];
    for (const { file, name } of namedFiles) {
      requests.push({
        id: createUniqueUserFileAttachmentId(state.document, requests.map((request) => request.id)),
        name,
        filename: file.name,
        mediaType: file.type || inferUserFileAttachmentMediaType(file.name),
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
    }
    await runUserFileAttachmentHistoryCommand({
      label: 'Add document attachments',
      reason: 'Add document attachments',
      document: state.document,
      host: state.attachmentHost,
      affectedIds: requests.map((request) => request.id),
      recordBefore: () => recordHistory(undefined, { notify: false }),
      captureHistoryState: captureHistoryStackState,
      rollbackHistory: restoreHistoryStackState,
      execute: async () => {
        for (const request of requests) {
          const stored = await storeUserFileAttachment(
            state.document,
            request,
            state.attachmentHost,
            state.attachmentLimits,
          );
          lastId = stored.id;
        }
      },
    });
    state.metaPanelOpen = true;
    getRenderApp()();
    window.requestAnimationFrame(() => {
      const input = app.querySelector<HTMLInputElement>(`[data-document-attachment-name="true"][data-document-attachment-id="${CSS.escape(lastId)}"]`);
      const row = input?.closest<HTMLElement>('[data-document-attachment-row="true"]');
      row?.classList.add('is-new');
      row?.scrollIntoView({ block: 'nearest' });
      input?.focus({ preventScroll: true });
      input?.select();
      if (row) window.setTimeout(() => row.classList.remove('is-new'), 1_600);
    });
  } catch (error) {
    setAttachmentManagerStatus(app, attachmentErrorMessage(error));
  }
}

async function replaceAttachmentFile(app: HTMLElement, id: string, file: File): Promise<void> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await runUserFileAttachmentHistoryCommand({
      label: 'Replace document attachment',
      reason: 'Replace document attachment',
      document: state.document,
      host: state.attachmentHost,
      affectedIds: [id],
      recordBefore: () => recordHistory(undefined, { notify: false }),
      captureHistoryState: captureHistoryStackState,
      rollbackHistory: restoreHistoryStackState,
      execute: () => replaceUserFileAttachment(state.document, id, {
        filename: file.name,
        mediaType: file.type || inferUserFileAttachmentMediaType(file.name),
        bytes,
      }, state.attachmentHost, state.attachmentLimits),
    });
    getRenderApp()();
  } catch (error) {
    setAttachmentManagerStatus(app, attachmentErrorMessage(error));
  }
}

async function commitAttachmentName(app: HTMLElement, input: HTMLInputElement, id: string): Promise<void> {
  const descriptor = listUserFileAttachments(state.document).find((entry) => entry.id === id);
  if (!descriptor || input.value.trim() === descriptor.name) return;
  try {
    await runUserFileAttachmentHistoryCommand({
      label: 'Rename document attachment',
      reason: 'Rename document attachment',
      document: state.document,
      host: state.attachmentHost,
      affectedIds: [id],
      recordBefore: () => recordHistory(undefined, { notify: false }),
      captureHistoryState: captureHistoryStackState,
      rollbackHistory: restoreHistoryStackState,
      execute: () => renameUserFileAttachment(state.document, id, input.value, state.attachmentHost),
    });
    input.value = input.value.trim();
    input.closest<HTMLElement>('[data-document-attachment-row="true"]')?.setAttribute(
      'data-document-attachment-searchable',
      `${input.value.trim()} ${descriptor.filename}`.toLocaleLowerCase(),
    );
    setAttachmentManagerStatus(app, `Renamed attachment to ${input.value.trim()}.`);
  } catch (error) {
    input.value = descriptor.name;
    input.focus({ preventScroll: true });
    input.select();
    setAttachmentManagerStatus(app, attachmentErrorMessage(error));
  }
}

async function deleteAttachment(app: HTMLElement, id: string): Promise<void> {
  try {
    await runUserFileAttachmentHistoryCommand({
      label: 'Delete document attachment',
      reason: 'Delete document attachment',
      document: state.document,
      host: state.attachmentHost,
      affectedIds: [id],
      recordBefore: () => recordHistory(undefined, { notify: false }),
      captureHistoryState: captureHistoryStackState,
      rollbackHistory: restoreHistoryStackState,
      execute: () => removeUserFileAttachment(state.document, id, state.attachmentHost),
    });
    getRenderApp()();
  } catch (error) {
    setAttachmentManagerStatus(app, attachmentErrorMessage(error));
  }
}

async function previewAttachment(app: HTMLElement, id: string): Promise<void> {
  const descriptor = listUserFileAttachments(state.document).find((entry) => entry.id === id);
  if (!descriptor) return;
  try {
    await performUserFileAttachmentAction(state.document, descriptor, 'preview', state.attachmentHost, state.attachmentAction);
  } catch (error) {
    setAttachmentManagerStatus(app, attachmentErrorMessage(error));
  }
}

async function downloadAttachment(app: HTMLElement, id: string): Promise<void> {
  const descriptor = listUserFileAttachments(state.document).find((entry) => entry.id === id);
  if (!descriptor) return;
  try {
    await performUserFileAttachmentAction(state.document, descriptor, 'download', state.attachmentHost, state.attachmentAction);
  } catch (error) {
    setAttachmentManagerStatus(app, attachmentErrorMessage(error));
  }
}

function handleAttachmentDrag(event: DragEvent): void {
  const dropzone = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-document-attachment-dropzone="true"]');
  if (dropzone && Array.from(event.dataTransfer?.types ?? []).includes('Files')) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    dropzone.classList.add('is-dragging');
    return;
  }
  if (!isGeneralDocumentDropTarget(event.target) || !hasNonImageFileDrag(event.dataTransfer)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  (event.target as HTMLElement).closest<HTMLElement>('#editorTree, .editor-tree')?.classList.add('document-attachment-surface-dragging');
}

function openAttachmentDropConfirmation(app: HTMLElement, files: File[]): void {
  app.querySelector('.document-attachment-drop-confirm-root')?.remove();
  const proposedNames: string[] = [];
  for (const file of files) {
    const baseName = suggestUniqueUserFileAttachmentName(state.document, defaultUserFileAttachmentName(file.name));
    let name = baseName;
    let suffix = 2;
    while (proposedNames.some((candidate) => normalizeUserFileAttachmentName(candidate) === normalizeUserFileAttachmentName(name))) {
      name = `${baseName} ${suffix}`;
      suffix += 1;
    }
    proposedNames.push(name);
  }
  const root = document.createElement('div');
  root.className = 'modal-root document-attachment-drop-confirm-root';
  const heading = files.length === 1
    ? `Add “${files[0]!.name}” as an attachment?`
    : `Add ${files.length} files as attachments?`;
  root.innerHTML = `<div class="modal-overlay" data-document-attachment-drop-confirm="cancel"></div>
    <section class="modal-panel document-attachment-drop-confirm" role="dialog" aria-modal="true" aria-labelledby="documentAttachmentDropTitle">
      <div class="modal-head"><h3 id="documentAttachmentDropTitle">${escapeHtmlText(heading)}</h3>
        <button type="button" class="ghost document-attachment-drop-close" data-document-attachment-drop-confirm="cancel" aria-label="Cancel attachment addition">${closeIcon()}</button>
      </div>
      <p>It will be stored with this document and can be linked from text anywhere in the document.</p>
      <div class="document-attachment-drop-name-list">
        ${files.map((file, index) => `<label><span>${escapeHtmlText(file.name)}</span><input data-document-attachment-drop-name="${index}" value="${escapeAttributeText(proposedNames[index]!)}" aria-label="Attachment name for ${escapeAttributeText(file.name)}" /></label>`).join('')}
      </div>
      <div class="modal-head-actions"><button type="button" class="ghost" data-document-attachment-drop-confirm="cancel">Cancel</button><button type="button" class="secondary" data-document-attachment-drop-confirm="add">Add attachment${files.length === 1 ? '' : 's'}</button></div>
    </section>`;
  root.addEventListener('click', (event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>('[data-document-attachment-drop-confirm]')?.dataset.documentAttachmentDropConfirm;
    if (!action) return;
    event.preventDefault();
    if (action === 'cancel') {
      root.remove();
      return;
    }
    const namedFiles = files.map((file, index) => ({
      file,
      name: root.querySelector<HTMLInputElement>(`[data-document-attachment-drop-name="${index}"]`)?.value ?? proposedNames[index]!,
    }));
    root.remove();
    void storeNamedAttachmentFiles(app, namedFiles);
  });
  (app.querySelector<HTMLElement>('.full-pane') ?? app).append(root);
  root.querySelector<HTMLInputElement>('[data-document-attachment-drop-name="0"]')?.focus({ preventScroll: true });
  root.querySelector<HTMLInputElement>('[data-document-attachment-drop-name="0"]')?.select();
}

function isGeneralDocumentDropTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('#editorTree, .editor-tree'));
}

function hasNonImageFileDrag(transfer: DataTransfer | null): boolean {
  const items = Array.from(transfer?.items ?? []).filter((item) => item.kind === 'file');
  return items.some((item) => Boolean(item.type) && !item.type.startsWith('image/'));
}

function isImageFile(file: File): boolean {
  return (file.type || inferUserFileAttachmentMediaType(file.name)).startsWith('image/');
}

function clearGeneralAttachmentDrag(app: HTMLElement): void {
  app.querySelectorAll('.document-attachment-surface-dragging').forEach((element) => element.classList.remove('document-attachment-surface-dragging'));
}

function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttributeText(value: string): string {
  return escapeHtmlText(value).replace(/"/g, '&quot;');
}

function filterAttachmentRows(manager: HTMLElement | null | undefined): void {
  if (!manager) return;
  const query = manager.querySelector<HTMLInputElement>('[data-document-attachment-search="true"]')?.value.trim().toLocaleLowerCase() ?? '';
  const category = manager.querySelector<HTMLElement>('[data-document-attachment-filter].is-active')?.dataset.documentAttachmentFilter ?? 'all';
  manager.querySelectorAll<HTMLElement>('[data-document-attachment-row="true"]').forEach((row) => {
    row.hidden = (category !== 'all' && row.dataset.documentAttachmentCategory !== category)
      || !(row.dataset.documentAttachmentSearchable ?? '').includes(query);
  });
}

function setAttachmentManagerStatus(app: HTMLElement, message: string): void {
  const status = app.querySelector<HTMLElement>('[data-document-attachment-status="true"]');
  if (status) status.textContent = message;
}

function attachmentErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function attachmentTrayIcon(): string {
  return `<svg class="hvy-ui-icon document-attachment-tray-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 14v5h16v-5M12 4v11M7.5 8.5 12 4l4.5 4.5" /></svg>`;
}

function attachmentDocumentIcon(): string {
  return `<svg class="hvy-ui-icon document-attachment-empty-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 2h8l4 4v16H6zM14 2v5h5M9 12h6M9 16h6" /></svg>`;
}

function attachmentTypeIcon(category: UserFileAttachmentCategory): string {
  const detail = category === 'image'
    ? '<circle cx="9" cy="9" r="1.5"/><path d="m7 17 3.5-4 2.5 2 2-2 3 4"/>'
    : category === 'audio'
      ? '<path d="M10 9v8M10 9l7-2v8M10 17a2 2 0 1 1-2-2h2M17 15a2 2 0 1 1-2-2h2"/>'
      : category === 'video'
        ? '<rect x="5" y="8" width="10" height="9" rx="2"/><path d="m15 11 4-2v7l-4-2"/>'
        : '<path d="M8 11h8M8 15h8"/>';
  return `<svg class="hvy-ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 2h8l4 4v16H6zM14 2v5h5"/>${detail}</svg>`;
}
