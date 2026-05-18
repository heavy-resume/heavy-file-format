import './image.css';
import type { ComponentEditorRenderer, ComponentReaderRenderer, ComponentRenderHelpers } from '../../component-helpers';
import type { VisualBlock, VisualSection } from '../../types';
import { getImageAttachment, getImageAttachmentId, listImageFilenames, removeAttachment, setImageAttachment, inferImageMediaType } from '../../../attachments';
import { state, getRefreshReaderPanels, getRenderApp } from '../../../state';
import { sanitizeInlineCss } from '../../../css-sanitizer';
import { findBlockByIds } from '../../../block-ops';
import { recordHistory } from '../../../history';
import { syncReusableTemplateForBlock } from '../../../reusable';
import { isAllowedImageAttachmentMediaType, prepareImageAttachmentBytes } from '../../../image-attachments';
import { cameraIcon, closeIcon } from '../../../icons';

const blobUrlCache = new Map<string, { url: string; bytes: Uint8Array }>();
export const IMAGE_ATTACHMENT_ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml,image/avif,image/bmp,image/x-icon';

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

export function renderImageAttachmentPicker(options: {
  helpers: ComponentRenderHelpers;
  action: string;
  sectionKey: string;
  blockId: string;
  selectedFilename?: string;
  emptyText: string;
}): string {
  const filenames = listImageFilenames(state.document);
  if (filenames.length === 0) {
    return `<div class="image-attachment-empty muted">${options.helpers.escapeHtml(options.emptyText)}</div>`;
  }
  return `<div class="image-attachment-picker" aria-label="Attached images">
    ${filenames.map((filename) => {
      const url = getImageBlobUrl(filename);
      const selected = filename === options.selectedFilename;
      const unused = isImageAttachmentUnused(filename);
      const preview = url
        ? `<img src="${options.helpers.escapeAttr(url)}" alt="">`
        : '<span>Missing</span>';
      return `<div class="image-attachment-choice-wrap">
        <button
          type="button"
          class="image-attachment-choice${selected ? ' is-selected' : ''}"
          data-action="${options.helpers.escapeAttr(options.action)}"
          data-section-key="${options.helpers.escapeAttr(options.sectionKey)}"
          data-block-id="${options.helpers.escapeAttr(options.blockId)}"
          data-image-filename="${options.helpers.escapeAttr(filename)}"
          title="${options.helpers.escapeAttr(filename)}"
        >
          <span class="image-attachment-choice-thumb">${preview}</span>
          <span class="image-attachment-choice-name">${options.helpers.escapeHtml(filename)}</span>
        </button>
        ${unused ? `<button
          type="button"
          class="image-attachment-delete"
          data-action="image-delete-unused"
          data-section-key="${options.helpers.escapeAttr(options.sectionKey)}"
          data-block-id="${options.helpers.escapeAttr(options.blockId)}"
          data-image-filename="${options.helpers.escapeAttr(filename)}"
          title="Delete unused image"
          aria-label="Delete unused image ${options.helpers.escapeAttr(filename)}"
        >${closeIcon()}</button>` : ''}
      </div>`;
    }).join('')}
  </div>`;
}

export function openImageCameraCapture(app: HTMLElement, options: {
  title: string;
  filenamePrefix: string;
  onCapture: (file: File) => void | Promise<void>;
}): void {
  closeImageCameraCapture();
  const modal = document.createElement('div');
  modal.className = 'modal-root image-camera-modal-root';
  modal.innerHTML = `
    <div class="modal-overlay" data-camera-close="true"></div>
    <section class="modal-panel image-camera-modal" role="dialog" aria-modal="true" aria-label="${escapeModalAttr(options.title)}">
      <div class="image-camera-header">
        <h3>${escapeModalHtml(options.title)}</h3>
        <button type="button" class="ghost image-camera-close" data-camera-close="true">Close</button>
      </div>
      <video class="image-camera-video" autoplay playsinline muted></video>
      <div class="image-camera-status muted" data-camera-status>Starting camera...</div>
      <div class="image-camera-actions">
        <button type="button" class="image-camera-capture-button" data-camera-capture disabled>${cameraIcon()}<span>Capture</span></button>
        <button type="button" class="ghost" data-camera-close="true">Cancel</button>
      </div>
    </section>
  `;
  app.appendChild(modal);

  const video = modal.querySelector<HTMLVideoElement>('.image-camera-video');
  const status = modal.querySelector<HTMLElement>('[data-camera-status]');
  const captureButton = modal.querySelector<HTMLButtonElement>('[data-camera-capture]');
  let stream: MediaStream | null = null;

  const close = () => {
    stream?.getTracks().forEach((track) => track.stop());
    modal.remove();
  };

  modal.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-camera-close="true"]')) {
      close();
    }
  });

  captureButton?.addEventListener('click', () => {
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) {
        if (status) status.textContent = 'Could not capture image.';
        return;
      }
      const file = new File([blob], `${options.filenamePrefix}-${formatCameraTimestamp(new Date())}.jpg`, { type: 'image/jpeg' });
      void Promise.resolve(options.onCapture(file)).then(close);
    }, 'image/jpeg', 0.9);
  });

  if (!navigator.mediaDevices?.getUserMedia || !video) {
    if (status) status.textContent = 'Camera is unavailable in this browser.';
    return;
  }

  void navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
    .then((cameraStream) => {
      stream = cameraStream;
      video.srcObject = cameraStream;
      if (captureButton) captureButton.disabled = false;
      if (status) status.textContent = 'Camera ready.';
    })
    .catch(() => {
      if (status) status.textContent = 'Camera permission was denied or unavailable.';
    });
}

function closeImageCameraCapture(): void {
  document.querySelectorAll<HTMLElement>('.image-camera-modal-root').forEach((modal) => {
    modal.querySelectorAll<HTMLVideoElement>('video').forEach((video) => {
      const stream = video.srcObject instanceof MediaStream ? video.srcObject : null;
      stream?.getTracks().forEach((track) => track.stop());
    });
    modal.remove();
  });
}

function formatCameraTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function escapeModalHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeModalAttr(value: string): string {
  return escapeModalHtml(value).replace(/'/g, '&#39;');
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
  const styleAttr = ` style="${helpers.escapeAttr(sanitizeInlineCss(block.schema.css))}"`;
  return `<img class="image-block-img" src="${helpers.escapeAttr(url)}" alt="${helpers.escapeAttr(alt)}" data-image-filename="${helpers.escapeAttr(filename)}"${styleAttr} />`;
}

export const renderImageEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => {
  const filename = block.schema.imageFile.trim();
  const downloadUrl = filename ? getImageBlobUrl(filename) : null;
  const canDeleteCurrentImage = filename && getImageAttachmentReferenceCount(filename) === 1;
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
        ${canDeleteCurrentImage ? `<button
          type="button"
          class="image-current-delete-button image-attachment-delete"
          data-action="image-delete-current"
          data-section-key="${helpers.escapeAttr(sectionKey)}"
          data-block-id="${helpers.escapeAttr(block.id)}"
          data-image-filename="${helpers.escapeAttr(filename)}"
          title="Delete image attachment"
          aria-label="Delete image attachment ${helpers.escapeAttr(filename)}"
        >${closeIcon()}</button>` : ''}
        ${renderPreview(block, helpers)}
        <div class="image-dropzone-hint">
          <span>Drop an image here or</span>
          <label class="image-pick-label">
            <input type="file" accept="${IMAGE_ATTACHMENT_ACCEPT}" data-field="image-upload" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(block.id)}" />
            <span class="image-pick-button">choose a file</span>
          </label>
          <button type="button" class="image-pick-button image-camera-button" data-action="image-take-photo" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(block.id)}">${cameraIcon()}<span>take a photo</span></button>
          ${filename && downloadUrl ? `<a class="image-download-link" href="${helpers.escapeAttr(downloadUrl)}" download="${helpers.escapeAttr(filename)}">download</a>` : ''}
        </div>
        <div class="image-filename muted">${filename ? helpers.escapeHtml(filename) : 'No file selected'}</div>
      </div>
      <div class="image-attachment-panel">
        <div class="image-attachment-panel-title">Attached images</div>
        ${renderImageAttachmentPicker({
          helpers,
          action: 'image-use-existing',
          sectionKey,
          blockId: block.id,
          selectedFilename: filename,
          emptyText: 'No attached images yet.',
        })}
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
  const merged = mergeImagePresetCss(block.schema.css, preset);
  if (merged === null) return;
  recordHistory(`image-preset:${blockId}:${preset}`);
  block.schema.css = merged;
  syncReusableTemplateForBlock(sectionKey, blockId);
  getRefreshReaderPanels()();
  getRenderApp()();
}

export function useExistingImageAttachment(sectionKey: string, blockId: string, filename: string): void {
  const block = findBlockByIds(sectionKey, blockId);
  if (!block || !listImageFilenames(state.document).includes(filename)) return;
  recordHistory(`image-existing:${blockId}`);
  block.schema.imageFile = filename;
  if (!block.schema.imageAlt) {
    block.schema.imageAlt = filename;
  }
  syncReusableTemplateForBlock(sectionKey, blockId);
  getRefreshReaderPanels()();
  getRenderApp()();
}

export function deleteUnusedImageAttachment(filename: string): void {
  if (!filename || !listImageFilenames(state.document).includes(filename)) return;
  if (!isImageAttachmentUnused(filename)) return;
  recordHistory(`image-attachment-delete:${filename}`);
  removeAttachment(state.document, getImageAttachmentId(filename));
  clearImageBlobUrlCache();
  getRenderApp()();
}

export function isImageAttachmentUnused(filename: string): boolean {
  if (!filename) return false;
  return getImageAttachmentReferenceCount(filename) === 0;
}

export function getImageAttachmentReferenceCount(filename: string): number {
  if (!filename) return 0;
  return state.document.sections.reduce((count, section) => count + countSectionImageReferences(section, filename), 0);
}

export function removeImageAttachmentIfLastReference(filename: string): boolean {
  if (!filename || getImageAttachmentReferenceCount(filename) !== 1) return false;
  removeAttachment(state.document, getImageAttachmentId(filename));
  clearImageBlobUrlCache();
  return true;
}

export function deleteCurrentImageAttachment(sectionKey: string, blockId: string, filename: string): void {
  const block = findBlockByIds(sectionKey, blockId);
  if (!block || block.schema.imageFile !== filename) return;
  if (!removeImageAttachmentIfLastReference(filename)) return;
  recordHistory(`image-current-delete:${blockId}`);
  block.schema.imageFile = '';
  block.schema.imageAlt = '';
  syncReusableTemplateForBlock(sectionKey, blockId);
  getRefreshReaderPanels()();
  getRenderApp()();
}

function countSectionImageReferences(section: VisualSection, filename: string): number {
  return section.blocks.reduce((count, block) => count + countBlockImageReferences(block, filename), 0)
    + section.children.reduce((count, child) => count + countSectionImageReferences(child, filename), 0);
}

function countBlockImageReferences(block: VisualBlock, filename: string): number {
  let count = block.schema.imageFile === filename ? 1 : 0;
  count += block.schema.carouselImages.filter((image) => image.imageFile === filename).length;
  count += block.schema.containerBlocks.reduce((total, child) => total + countBlockImageReferences(child, filename), 0);
  count += block.schema.componentListBlocks.reduce((total, child) => total + countBlockImageReferences(child, filename), 0);
  count += block.schema.gridItems.reduce((total, item) => total + countBlockImageReferences(item.block, filename), 0);
  count += block.schema.expandableStubBlocks.children.reduce((total, child) => total + countBlockImageReferences(child, filename), 0);
  count += block.schema.expandableContentBlocks.children.reduce((total, child) => total + countBlockImageReferences(child, filename), 0);
  return count;
}

export async function handleImageUpload(target: HTMLElement, file: File): Promise<void> {
  const sectionKey = target.dataset.sectionKey ?? '';
  const blockId = target.dataset.blockId ?? '';
  if (!sectionKey || !blockId) return;
  const block = findBlockByIds(sectionKey, blockId);
  if (!block) return;
  const filename = file.name;
  if (!filename) return;
  const mediaType = file.type || inferImageMediaType(filename);
  if (!isAllowedImageAttachmentMediaType(mediaType)) return;
  const prepared = await prepareImageAttachmentBytes(file, mediaType, state.imageAttachmentMaxDimensions);
  recordHistory(`image-upload:${blockId}`);
  setImageAttachment(state.document, filename, prepared.mediaType, prepared.bytes);
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
    if (!file || !isAllowedImageAttachmentMediaType(file.type || inferImageMediaType(file.name))) return;
    void handleImageUpload(dropzone, file);
  });
}
