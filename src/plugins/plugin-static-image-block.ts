import { defaultBlockSchema } from '../document-factory';
import type { TextCaptionPayload, VisualBlock } from '../editor/types';
import type { HvyPluginPdfStaticRenderContext } from './types';

export interface PluginStaticImageOptions {
  // Filename prefix for the generated attachment, e.g. "qr-code" -> "qr-code-<id>.png".
  filenamePrefix: string;
  bytes: Uint8Array;
  mediaType: 'image/png' | 'image/jpeg' | 'image/svg+xml';
  imageAlt: string;
  caption?: TextCaptionPayload | null;
}

const STATIC_IMAGE_EXTENSIONS: Record<PluginStaticImageOptions['mediaType'], string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
};

export function createPluginStaticImageFilename(filenamePrefix: string, blockId: string, extension: string): string {
  const safeId = blockId.trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || filenamePrefix;
  return `${filenamePrefix}-${safeId}.${extension}`;
}

// Stores rendered bytes as an image attachment and returns an ordinary image
// block that replaces the plugin block in a PDF/static export clone. The image
// keeps the plugin block's css so author sizing/alignment carries over.
export function writePluginStaticImageBlock(ctx: HvyPluginPdfStaticRenderContext, options: PluginStaticImageOptions): VisualBlock {
  const sourceId = ctx.block.schema.id || ctx.block.id || options.filenamePrefix;
  const imageFile = createPluginStaticImageFilename(options.filenamePrefix, sourceId, STATIC_IMAGE_EXTENSIONS[options.mediaType]);
  ctx.attachments.set(`image:${imageFile}`, { mediaType: options.mediaType }, options.bytes);
  const schema = defaultBlockSchema('image');
  schema.id = `${sourceId}-static`;
  schema.css = ctx.block.schema.css;
  schema.imageFile = imageFile;
  schema.imageAlt = options.imageAlt;
  schema.caption = options.caption ?? null;
  return {
    id: `${ctx.block.id}-static`,
    text: '',
    schema,
    schemaMode: false,
  };
}
