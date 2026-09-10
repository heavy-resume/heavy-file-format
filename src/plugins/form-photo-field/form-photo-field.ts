import type { HvyPluginContext } from '../types';
import { getImageAttachmentId, inferImageMediaType } from '../../attachments';
import {
  isAllowedImageAttachmentMediaType,
  prepareImageAttachmentBytes,
  resolveDocumentImageAttachmentMaxDimensions,
} from '../../image-attachments';
import type { ImageAttachmentMaxDimensions } from '../../types';

import './form-photo-field.css';

const DEFAULT_ACCEPT = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/avif',
  'image/bmp',
] as const;

export interface FormPhotoValue {
  attachmentId: string;
  imageFile: string;
  mediaType: string;
}

export interface FormPhotoMeta {
  css: string;
  accept: string[];
  maxBytes: number;
  maxWidth: number;
  maxHeight: number;
}

export function normalizeFormPhotoMeta(value: Record<string, unknown>): FormPhotoMeta {
  const accept = Array.isArray(value.accept)
    ? value.accept.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
    : typeof value.accept === 'string'
      ? value.accept.split(',').map((item) => item.trim()).filter(Boolean)
      : [];
  return {
    css: typeof value.css === 'string' ? value.css : '',
    accept,
    maxBytes: normalizePositiveInteger(value.maxBytes),
    maxWidth: normalizePositiveInteger(value.maxWidth),
    maxHeight: normalizePositiveInteger(value.maxHeight),
  };
}

export function getFormPhotoResizeBounds(
  meta: FormPhotoMeta,
  documentMeta: Record<string, unknown>,
  hostFallback?: ImageAttachmentMaxDimensions | null,
): ImageAttachmentMaxDimensions | null | undefined {
  if (meta.maxWidth > 0 || meta.maxHeight > 0) {
    return {
      ...(meta.maxWidth > 0 ? { width: meta.maxWidth } : {}),
      ...(meta.maxHeight > 0 ? { height: meta.maxHeight } : {}),
    };
  }
  return resolveDocumentImageAttachmentMaxDimensions(documentMeta, hostFallback);
}

interface CreateFormPhotoControlOptions {
  ctx: HvyPluginContext;
  label: string;
  required: boolean;
  meta: FormPhotoMeta;
  value: FormPhotoValue | null;
  imageAttachmentMaxDimensions?: ImageAttachmentMaxDimensions | null;
  onChange(value: FormPhotoValue | null): void;
  onError(message: string): void;
}

export function createFormPhotoControl(options: CreateFormPhotoControlOptions): HTMLElement {
  const control = document.createElement('div');
  control.className = 'hvy-form-photo-control';
  const preview = document.createElement('div');
  preview.className = 'hvy-form-photo-preview';
  const input = document.createElement('input');
  input.type = 'file';
  input.name = options.label;
  input.accept = (options.meta.accept.length > 0 ? options.meta.accept : DEFAULT_ACCEPT).join(',');
  input.required = options.required && !options.value;
  input.className = 'hvy-form-photo-input';
  const button = document.createElement('span');
  button.className = 'hvy-form-photo-button';
  button.textContent = options.value ? 'Replace photo' : 'Choose photo';
  const picker = document.createElement('label');
  picker.className = 'hvy-form-photo-picker';
  picker.append(input, button);
  control.append(preview, picker);

  let previewUrl: string | null = null;
  const renderPreview = (value: FormPhotoValue | null) => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
    preview.replaceChildren();
    if (!value) {
      const empty = document.createElement('span');
      empty.textContent = 'No photo selected';
      preview.appendChild(empty);
      return;
    }
    const attachment = options.ctx.attachments.get(value.attachmentId);
    if (!attachment) {
      const missing = document.createElement('span');
      missing.textContent = 'Photo attachment is missing';
      preview.appendChild(missing);
      return;
    }
    previewUrl = URL.createObjectURL(new Blob([Uint8Array.from(attachment.bytes)], { type: value.mediaType }));
    const image = document.createElement('img');
    image.alt = `${options.label} preview`;
    const releasePreviewUrl = () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        previewUrl = null;
      }
    };
    image.addEventListener('load', releasePreviewUrl, { once: true });
    image.addEventListener('error', releasePreviewUrl, { once: true });
    image.src = previewUrl;
    preview.appendChild(image);
  };
  renderPreview(options.value);

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    void stageFormPhoto(options, file)
      .then((value) => {
        options.onError('');
        options.onChange(value);
        input.required = false;
        button.textContent = 'Replace photo';
        renderPreview(value);
      })
      .catch((error) => {
        input.value = '';
        options.onError(error instanceof Error ? error.message : 'Could not upload photo.');
      });
  });
  return control;
}

async function stageFormPhoto(options: CreateFormPhotoControlOptions, file: File): Promise<FormPhotoValue> {
  if (options.meta.maxBytes > 0 && file.size > options.meta.maxBytes) {
    throw new Error(`Photo must be ${formatBytes(options.meta.maxBytes)} or smaller.`);
  }
  const mediaType = file.type || inferImageMediaType(file.name);
  const accepted = options.meta.accept.length > 0 ? options.meta.accept : [...DEFAULT_ACCEPT];
  if (!isAllowedImageAttachmentMediaType(mediaType) || !accepted.includes(mediaType)) {
    throw new Error('Choose a supported photo type.');
  }
  const prepared = await prepareImageAttachmentBytes(
    file,
    mediaType,
    getFormPhotoResizeBounds(options.meta, options.ctx.rawDocument.meta, options.imageAttachmentMaxDimensions),
  );
  const imageFile = uniquePhotoFilename(options.ctx, file.name || 'photo');
  const attachmentId = getImageAttachmentId(imageFile);
  options.ctx.attachments.set(attachmentId, { mediaType: prepared.mediaType }, prepared.bytes);
  return { attachmentId, imageFile, mediaType: prepared.mediaType };
}

function uniquePhotoFilename(ctx: HvyPluginContext, requested: string): string {
  const safe = requested.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'photo';
  const dot = safe.lastIndexOf('.');
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const extension = dot > 0 ? safe.slice(dot) : '';
  const ids = new Set(ctx.attachments.list().map((attachment) => attachment.id));
  let candidate = safe;
  let suffix = 2;
  while (ids.has(getImageAttachmentId(candidate))) {
    candidate = `${stem}-${suffix}${extension}`;
    suffix += 1;
  }
  return candidate;
}

function normalizePositiveInteger(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function formatBytes(bytes: number): string {
  return bytes >= 1_000_000
    ? `${Math.round(bytes / 100_000) / 10} MB`
    : `${Math.ceil(bytes / 1000)} KB`;
}
