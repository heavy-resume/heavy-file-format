import type { JsonObject } from './hvy/types';
import type { DocumentAttachment, VisualDocument } from './types';

export const DB_ATTACHMENT_ID = 'db';
export const IMAGE_ATTACHMENT_PREFIX = 'image:';

export function getAttachment(document: VisualDocument, id: string): DocumentAttachment | null {
  return document.attachments.find((entry) => entry.id === id) ?? null;
}

export function setAttachment(document: VisualDocument, id: string, meta: JsonObject, bytes: Uint8Array): void {
  const next: DocumentAttachment = { id, meta, bytes };
  const index = document.attachments.findIndex((entry) => entry.id === id);
  if (index >= 0) {
    document.attachments[index] = next;
  } else {
    document.attachments.push(next);
  }
}

export function removeAttachment(document: VisualDocument, id: string): void {
  const index = document.attachments.findIndex((entry) => entry.id === id);
  if (index >= 0) {
    document.attachments.splice(index, 1);
  }
}

export function getImageAttachmentId(filename: string): string {
  return `${IMAGE_ATTACHMENT_PREFIX}${filename}`;
}

export function getImageAttachment(document: VisualDocument, filename: string): DocumentAttachment | null {
  return getAttachment(document, getImageAttachmentId(filename));
}

export function setImageAttachment(
  document: VisualDocument,
  filename: string,
  mediaType: string,
  bytes: Uint8Array
): void {
  setAttachment(document, getImageAttachmentId(filename), { mediaType }, bytes);
}

export function listImageFilenames(document: VisualDocument): string[] {
  return document.attachments
    .filter((entry) => entry.id.startsWith(IMAGE_ATTACHMENT_PREFIX))
    .map((entry) => entry.id.slice(IMAGE_ATTACHMENT_PREFIX.length));
}

export function inferImageMediaType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.avif')) return 'image/avif';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  if (lower.endsWith('.ico')) return 'image/x-icon';
  return 'application/octet-stream';
}
