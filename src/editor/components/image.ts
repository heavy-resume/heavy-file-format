import type { ComponentEditorRenderer, ComponentReaderRenderer, ComponentRenderHelpers } from '../component-helpers';
import type { VisualBlock } from '../types';
import { getImageAttachment } from '../../attachments';
import { state } from '../../state';

const blobUrlCache = new Map<string, { url: string; bytes: Uint8Array }>();

export function getImageBlobUrl(filename: string): string | null {
  if (!filename) {
    return null;
  }
  const attachment = getImageAttachment(state.document, filename);
  if (!attachment || attachment.bytes.length === 0) {
    return null;
  }
  const cached = blobUrlCache.get(filename);
  if (cached && cached.bytes === attachment.bytes) {
    return cached.url;
  }
  if (cached) {
    URL.revokeObjectURL(cached.url);
  }
  const mediaType = typeof attachment.meta.mediaType === 'string' ? attachment.meta.mediaType : 'application/octet-stream';
  const blob = new Blob([Uint8Array.from(attachment.bytes)], { type: mediaType });
  const url = URL.createObjectURL(blob);
  blobUrlCache.set(filename, { url, bytes: attachment.bytes });
  return url;
}

export function clearImageBlobUrlCache(): void {
  for (const entry of blobUrlCache.values()) {
    URL.revokeObjectURL(entry.url);
  }
  blobUrlCache.clear();
}

function renderPreview(block: VisualBlock, helpers: ComponentRenderHelpers): string {
  const filename = block.schema.imageFile.trim();
  const alt = block.schema.imageAlt || filename || 'Image';
  if (!filename) {
    return '<div class="image-empty muted">No image attached.</div>';
  }
  const url = getImageBlobUrl(filename);
  if (!url) {
    return `<div class="image-empty muted">Missing attachment: ${helpers.escapeHtml(filename)}</div>`;
  }
  return `<img class="image-block-img" src="${helpers.escapeAttr(url)}" alt="${helpers.escapeAttr(alt)}" data-image-filename="${helpers.escapeAttr(filename)}" />`;
}

export const renderImageEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => {
  const filename = block.schema.imageFile.trim();
  return `
    <div class="image-editor">
      <div class="image-toolbar">
        <div class="toolbar-segment image-align-buttons" role="group" aria-label="Image alignment">
          <button type="button" class="ghost" data-action="image-preset" data-image-preset="left" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(block.id)}" title="Align left">Left</button>
          <button type="button" class="ghost" data-action="image-preset" data-image-preset="center" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(block.id)}" title="Align center">Center</button>
          <button type="button" class="ghost" data-action="image-preset" data-image-preset="right" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(block.id)}" title="Align right">Right</button>
        </div>
        <div class="toolbar-segment image-fit-buttons" role="group" aria-label="Image size">
          <button type="button" class="ghost" data-action="image-preset" data-image-preset="fit-width" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(block.id)}" title="Fit width">Fit Width</button>
          <button type="button" class="ghost" data-action="image-preset" data-image-preset="fit-height" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(block.id)}" title="Fit height">Fit Height</button>
        </div>
      </div>
      <div
        class="image-dropzone${filename ? ' has-image' : ''}"
        data-image-dropzone="true"
        data-section-key="${helpers.escapeAttr(sectionKey)}"
        data-block-id="${helpers.escapeAttr(block.id)}"
      >
        ${renderPreview(block, helpers)}
        <div class="image-dropzone-hint">
          <span>Drop an image here or</span>
          <label class="image-pick-label">
            <input type="file" accept="image/*" data-field="image-upload" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(block.id)}" />
            <span class="image-pick-button">choose a file</span>
          </label>
        </div>
        <div class="image-filename muted">${filename ? helpers.escapeHtml(filename) : 'No file selected'}</div>
      </div>
      <div class="image-alt-label-container">
        <label class="image-alt-label">
          <span>Alt text</span>
          <textarea
            rows="2"
            data-section-key="${helpers.escapeAttr(sectionKey)}"
            data-block-id="${helpers.escapeAttr(block.id)}"
            data-field="image-alt"
            placeholder="Describe the image"
          >${helpers.escapeHtml(block.schema.imageAlt)}</textarea>
        </label>
      </div>
    </div>
  `;
};

export const renderImageReader: ComponentReaderRenderer = (_section, block, helpers) => {
  return `<div class="image-reader">${renderPreview(block, helpers)}</div>`;
};
