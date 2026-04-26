import './image.css';
import type { ComponentEditorRenderer, ComponentReaderRenderer, ComponentRenderHelpers } from '../../component-helpers';
import type { VisualBlock } from '../../types';
import { getImageAttachment, setImageAttachment, inferImageMediaType } from '../../../attachments';
import { state, getRefreshReaderPanels, getRenderApp } from '../../../state';
import { sanitizeInlineCss } from '../../../css-sanitizer';
import { findBlockByIds } from '../../../block-ops';
import { recordHistory } from '../../../history';
import { syncReusableTemplateForBlock } from '../../../reusable';

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
  const styleAttr = ` style="${helpers.escapeAttr(sanitizeInlineCss(block.schema.customCss))}"`;
  return `<img class="image-block-img" src="${helpers.escapeAttr(url)}" alt="${helpers.escapeAttr(alt)}" data-image-filename="${helpers.escapeAttr(filename)}"${styleAttr} />`;
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
          <button type="button" class="ghost" data-action="image-preset" data-image-preset="small" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(block.id)}" title="Small (20rem wide)">Small</button>
          <button type="button" class="ghost" data-action="image-preset" data-image-preset="medium" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(block.id)}" title="Medium (40rem wide)">Medium</button>
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

interface ImagePresetDefinition {
  /** Properties this preset writes onto the block. */
  props: Record<string, string>;
  /** Properties this preset *clears* from the existing inline css before writing
   * `props`. Anything not listed here is preserved verbatim. */
  controls: string[];
}

const POSITION_CONTROLS = ['margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'display'];
const SIZE_CONTROLS = ['width', 'height', 'display'];

const IMAGE_PRESETS: Record<string, ImagePresetDefinition> = {
  left: {
    props: { margin: '0.5rem auto 0.5rem 0', display: 'block' },
    controls: POSITION_CONTROLS,
  },
  center: {
    props: { margin: '0.5rem auto', display: 'block' },
    controls: POSITION_CONTROLS,
  },
  right: {
    props: { margin: '0.5rem 0 0.5rem auto', display: 'block' },
    controls: POSITION_CONTROLS,
  },
  small: {
    props: { width: '20rem', height: 'auto', display: 'block' },
    controls: SIZE_CONTROLS,
  },
  medium: {
    props: { width: '40rem', height: 'auto', display: 'block' },
    controls: SIZE_CONTROLS,
  },
  'fit-width': {
    props: { width: '100%', height: 'auto', display: 'block' },
    controls: SIZE_CONTROLS,
  },
  'fit-height': {
    props: { height: '100%', width: 'auto', display: 'block' },
    controls: SIZE_CONTROLS,
  },
};

function parseInlineCssDeclarations(css: string): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  for (const segment of css.split(';')) {
    const colon = segment.indexOf(':');
    if (colon < 0) continue;
    const prop = segment.slice(0, colon).trim().toLowerCase();
    const value = segment.slice(colon + 1).trim();
    if (prop.length === 0 || value.length === 0) continue;
    entries.push([prop, value]);
  }
  return entries;
}

function serializeInlineCssDeclarations(entries: Array<[string, string]>): string {
  return entries.map(([prop, value]) => `${prop}: ${value};`).join(' ');
}

export function mergeImagePresetCss(existingCss: string, preset: string): string | null {
  const definition = IMAGE_PRESETS[preset];
  if (!definition) return null;
  const cleared = new Set(definition.controls.map((prop) => prop.toLowerCase()));
  const preserved = parseInlineCssDeclarations(existingCss).filter(([prop]) => !cleared.has(prop));
  const merged = [...preserved, ...Object.entries(definition.props)];
  return serializeInlineCssDeclarations(merged);
}

export function applyImagePreset(sectionKey: string, blockId: string, preset: string): void {
  const block = findBlockByIds(sectionKey, blockId);
  if (!block) return;
  const merged = mergeImagePresetCss(block.schema.customCss, preset);
  if (merged === null) return;
  recordHistory(`image-preset:${blockId}:${preset}`);
  block.schema.customCss = merged;
  syncReusableTemplateForBlock(sectionKey, blockId);
  getRefreshReaderPanels()();
  getRenderApp()();
}

export async function handleImageUpload(target: HTMLElement, file: File): Promise<void> {
  const sectionKey = target.dataset.sectionKey ?? '';
  const blockId = target.dataset.blockId ?? '';
  if (!sectionKey || !blockId) return;
  const block = findBlockByIds(sectionKey, blockId);
  if (!block) return;
  const filename = file.name;
  if (!filename) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mediaType = file.type || inferImageMediaType(filename);
  recordHistory(`image-upload:${blockId}`);
  setImageAttachment(state.document, filename, mediaType, bytes);
  block.schema.imageFile = filename;
  if (!block.schema.imageAlt) {
    block.schema.imageAlt = filename;
  }
  clearImageBlobUrlCache();
  syncReusableTemplateForBlock(sectionKey, blockId);
  getRenderApp()();
}

export function bindImageDragAndDrop(app: HTMLElement): void {
  const overClass = 'image-dropzone-active';
  app.addEventListener('dragenter', (event) => {
    const dropzone = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-image-dropzone="true"]');
    if (!dropzone) return;
    event.preventDefault();
    dropzone.classList.add(overClass);
  });
  app.addEventListener('dragover', (event) => {
    const dropzone = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-image-dropzone="true"]');
    if (!dropzone) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    dropzone.classList.add(overClass);
  });
  app.addEventListener('dragleave', (event) => {
    const dropzone = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-image-dropzone="true"]');
    if (!dropzone) return;
    if (!dropzone.contains(event.relatedTarget as Node | null)) {
      dropzone.classList.remove(overClass);
    }
  });
  app.addEventListener('drop', (event) => {
    const dropzone = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-image-dropzone="true"]');
    if (!dropzone) return;
    event.preventDefault();
    dropzone.classList.remove(overClass);
    const file = event.dataTransfer?.files?.[0];
    if (!file || !/^image\//.test(file.type)) return;
    void handleImageUpload(dropzone, file);
  });
}
