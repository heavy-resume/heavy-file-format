import type { ImageAttachmentMaxDimensions } from './types';
export type { ImageAttachmentMaxDimensions } from './types';

export interface PreparedImageAttachment {
  bytes: Uint8Array;
  mediaType: string;
}

export interface ImageAttachmentResizeAdapter {
  getDimensions(file: File): Promise<{ width: number; height: number }>;
  resize(file: File, options: { width: number; height: number; mediaType: string }): Promise<Uint8Array>;
}

const RESIZABLE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_IMAGE_ATTACHMENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/svg+xml',
  'image/avif',
  'image/bmp',
  'image/x-icon',
]);
const MIN_IMAGE_BOUND = 1;
const MAX_IMAGE_BOUND = 16384;
export const DEFAULT_IMAGE_ATTACHMENT_MAX_DIMENSIONS: Required<ImageAttachmentMaxDimensions> = {
  width: 2048,
  height: 2048,
};

export function resolveImageAttachmentMaxDimensions(
  value: ImageAttachmentMaxDimensions | null | undefined
): Required<ImageAttachmentMaxDimensions> | null {
  return value === undefined
    ? DEFAULT_IMAGE_ATTACHMENT_MAX_DIMENSIONS
    : normalizeImageAttachmentMaxDimensions(value);
}

export function normalizeImageAttachmentMaxDimensions(
  value: ImageAttachmentMaxDimensions | null | undefined
): Required<ImageAttachmentMaxDimensions> | null {
  if (!value) {
    return null;
  }
  const width = normalizeImageBound(value.width);
  const height = normalizeImageBound(value.height);
  if (width === null && height === null) {
    return null;
  }
  return {
    width: width ?? MAX_IMAGE_BOUND,
    height: height ?? MAX_IMAGE_BOUND,
  };
}

export function calculateContainedImageDimensions(
  source: { width: number; height: number },
  maxDimensions: Required<ImageAttachmentMaxDimensions>
): { width: number; height: number; resized: boolean } {
  const sourceWidth = Math.max(1, Math.floor(source.width));
  const sourceHeight = Math.max(1, Math.floor(source.height));
  const scale = Math.min(maxDimensions.width / sourceWidth, maxDimensions.height / sourceHeight, 1);
  if (scale >= 1) {
    return { width: sourceWidth, height: sourceHeight, resized: false };
  }
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
    resized: true,
  };
}

export function isAllowedImageAttachmentMediaType(mediaType: string): boolean {
  return ALLOWED_IMAGE_ATTACHMENT_TYPES.has(mediaType);
}

export async function prepareImageAttachmentBytes(
  file: File,
  mediaType: string,
  maxDimensions: ImageAttachmentMaxDimensions | null | undefined,
  adapter: ImageAttachmentResizeAdapter = browserImageAttachmentResizeAdapter
): Promise<PreparedImageAttachment> {
  if (!isAllowedImageAttachmentMediaType(mediaType)) {
    throw new Error(`Unsupported image attachment type: ${mediaType}`);
  }
  const originalBytes = new Uint8Array(await file.arrayBuffer());
  const normalizedMax = resolveImageAttachmentMaxDimensions(maxDimensions);
  if (!normalizedMax || !RESIZABLE_IMAGE_TYPES.has(mediaType)) {
    return { bytes: originalBytes, mediaType };
  }
  try {
    const dimensions = await adapter.getDimensions(file);
    const target = calculateContainedImageDimensions(dimensions, normalizedMax);
    if (!target.resized) {
      return { bytes: originalBytes, mediaType };
    }
    return {
      bytes: await adapter.resize(file, { width: target.width, height: target.height, mediaType }),
      mediaType,
    };
  } catch {
    return { bytes: originalBytes, mediaType };
  }
}

function normalizeImageBound(value: number | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(MIN_IMAGE_BOUND, Math.min(MAX_IMAGE_BOUND, Math.floor(value)));
}

const browserImageAttachmentResizeAdapter: ImageAttachmentResizeAdapter = {
  async getDimensions(file) {
    const image = await loadBrowserImage(file);
    const dimensions = { width: image.width, height: image.height };
    releaseBrowserImage(image);
    return dimensions;
  },
  async resize(file, options) {
    const image = await loadBrowserImage(file);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = options.width;
      canvas.height = options.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Canvas 2D context is unavailable.');
      }
      ctx.drawImage(image.source, 0, 0, options.width, options.height);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => {
          if (result) resolve(result);
          else reject(new Error('Image resize failed.'));
        }, options.mediaType);
      });
      return new Uint8Array(await blob.arrayBuffer());
    } finally {
      releaseBrowserImage(image);
    }
  },
};

type BrowserImageSource = {
  source: CanvasImageSource;
  width: number;
  height: number;
  close?: () => void;
};

async function loadBrowserImage(file: File): Promise<BrowserImageSource> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  }
  const url = URL.createObjectURL(file);
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image decode failed.'));
    img.src = url;
  });
  return {
    source: image,
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
    close: () => URL.revokeObjectURL(url),
  };
}

function releaseBrowserImage(image: BrowserImageSource): void {
  image.close?.();
}
