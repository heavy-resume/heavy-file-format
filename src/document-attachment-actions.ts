import type { HvyAttachmentHostAdapter } from './attachment-store';
import { ensureDocumentAttachmentStore, normalizeAttachmentBytes } from './attachment-store';
import { canPreviewUserFileAttachment, type UserFileAttachmentDescriptor } from './document-attachments';
import type { VisualDocument } from './types';
import { downloadBlob } from './utils';

export type HvyAttachmentAction = 'preview' | 'download';

export interface HvyAttachmentActionRequest {
  action: HvyAttachmentAction;
  id: string;
  name: string;
  filename: string;
  mediaType: string;
  length: number;
  getBytes(): Promise<Uint8Array | null>;
  getUrl(): Promise<string | Blob | null>;
}

export interface HvyAttachmentActionResult {
  handled: boolean;
}

export type HvyAttachmentActionHandler = (
  request: HvyAttachmentActionRequest,
) => HvyAttachmentActionResult | void | Promise<HvyAttachmentActionResult | void>;

const managedObjectUrls = new WeakMap<VisualDocument, Set<string>>();

export async function performUserFileAttachmentAction(
  document: VisualDocument,
  attachment: UserFileAttachmentDescriptor,
  action: HvyAttachmentAction,
  host?: HvyAttachmentHostAdapter | null,
  handler?: HvyAttachmentActionHandler | null,
): Promise<void> {
  const result = await handler?.({
    action,
    id: attachment.id,
    name: attachment.name,
    filename: attachment.filename,
    mediaType: attachment.mediaType,
    length: attachment.length,
    getBytes: () => recallUserFileAttachmentBytes(document, attachment, host),
    getUrl: async () => {
      const resolved = await host?.resolveUrl?.(attachment.id);
      if (resolved !== null && resolved !== undefined) return resolved;
      const bytes = await recallUserFileAttachmentBytes(document, attachment, host);
      return bytes ? new Blob([Uint8Array.from(bytes)], { type: attachment.mediaType }) : null;
    },
  });
  if (result && result.handled === true) return;
  if (action === 'preview') {
    await previewUserFileAttachment(document, attachment, host);
  } else {
    await downloadUserFileAttachment(document, attachment, host);
  }
}

export function releaseUserFileAttachmentObjectUrls(document: VisualDocument): void {
  const urls = managedObjectUrls.get(document);
  if (!urls) return;
  urls.forEach((url) => URL.revokeObjectURL(url));
  managedObjectUrls.delete(document);
}

export async function previewUserFileAttachment(
  document: VisualDocument,
  attachment: UserFileAttachmentDescriptor,
  host?: HvyAttachmentHostAdapter | null,
): Promise<void> {
  if (!canPreviewUserFileAttachment(attachment.mediaType)) {
    await downloadUserFileAttachment(document, attachment, host);
    return;
  }
  const previewWindow = window.open('about:blank', '_blank');
  const resolved = await resolveUserFileAttachmentUrl(document, attachment, host);
  if (!resolved) {
    previewWindow?.close();
    throw new Error(`Attachment "${attachment.name}" is unavailable.`);
  }
  if (previewWindow) {
    previewWindow.location.replace(resolved.url);
    previewWindow.opener = null;
  } else {
    window.open(resolved.url, '_blank', 'noopener,noreferrer');
  }
  if (resolved.managed) {
    rememberManagedObjectUrl(document, resolved.url);
    revokeObjectUrlAfterPreview(document, resolved.url, previewWindow);
  }
}

export async function downloadUserFileAttachment(
  document: VisualDocument,
  attachment: UserFileAttachmentDescriptor,
  host?: HvyAttachmentHostAdapter | null,
): Promise<void> {
  const bytes = await recallUserFileAttachmentBytes(document, attachment, host);
  if (!bytes) throw new Error(`Attachment "${attachment.name}" is unavailable.`);
  downloadBlob(safeAttachmentFilename(attachment.filename), new Blob([Uint8Array.from(bytes)], { type: attachment.mediaType }));
}

export async function recallUserFileAttachmentBytes(
  document: VisualDocument,
  attachment: UserFileAttachmentDescriptor,
  host?: HvyAttachmentHostAdapter | null,
): Promise<Uint8Array | null> {
  const local = ensureDocumentAttachmentStore(document).get(attachment.id);
  if (local && (local.bytes.length > 0 || attachment.length === 0)) return Uint8Array.from(local.bytes);
  const recalled = await host?.recall(attachment.id);
  return recalled === null || recalled === undefined ? null : normalizeAttachmentBytes(recalled);
}

async function resolveUserFileAttachmentUrl(
  document: VisualDocument,
  attachment: UserFileAttachmentDescriptor,
  host?: HvyAttachmentHostAdapter | null,
): Promise<{ url: string; managed: boolean } | null> {
  const resolved = await host?.resolveUrl?.(attachment.id);
  if (typeof resolved === 'string') return { url: resolved, managed: false };
  if (resolved instanceof Blob) return { url: URL.createObjectURL(resolved), managed: true };
  const bytes = await recallUserFileAttachmentBytes(document, attachment, host);
  return bytes
    ? { url: URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: attachment.mediaType })), managed: true }
    : null;
}

function rememberManagedObjectUrl(document: VisualDocument, url: string): void {
  const urls = managedObjectUrls.get(document) ?? new Set<string>();
  urls.add(url);
  managedObjectUrls.set(document, urls);
}

function revokeObjectUrlAfterPreview(document: VisualDocument, url: string, previewWindow: Window | null): void {
  let checks = 0;
  const interval = window.setInterval(() => {
    checks += 1;
    if (!previewWindow || previewWindow.closed || checks >= 360) {
      window.clearInterval(interval);
      URL.revokeObjectURL(url);
      managedObjectUrls.get(document)?.delete(url);
    }
  }, 5_000);
}

function safeAttachmentFilename(filename: string): string {
  return filename.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g, '').trim() || 'attachment';
}
