import './image.css';
import type { ComponentEditorRenderer, ComponentReaderRenderer, ComponentRenderHelpers } from '../../component-helpers';
import type { VisualBlock, VisualSection } from '../../types';
import { getImageAttachment, getImageAttachmentId, listImageFilenames, removeAttachment, setAttachment, inferImageMediaType } from '../../../attachments';
import { getAttachmentDescriptors } from '../../../attachment-store';
import { state, getRefreshReaderPanels, getRenderApp } from '../../../state';
import { sanitizeInlineCss } from '../../../css-sanitizer';
import { findBlockByIds } from '../../../block-ops';
import { recordHistory } from '../../../history';
import { syncReusableTemplateForBlock } from '../../../reusable';
import { isAllowedImageAttachmentMediaType, prepareImageAttachmentBytes, resolveDocumentImageAttachmentMaxDimensions } from '../../../image-attachments';
import { cameraIcon, closeIcon, plusIcon } from '../../../icons';
import type { JsonObject } from '../../../hvy/types';
import { elapsedMs, logPerfTrace, nowMs } from '../../../perf-trace';
import { getMatchingImagePresetCss, mergeImagePresetCss } from './image-preset-css';
import { getTextCaptionMarkdown, normalizeTextCaption, renderTextCaptionHtml } from '../../../caption';

export { mergeImagePresetCss } from './image-preset-css';

const blobUrlCache = new Map<string, { url: string; bytes: Uint8Array }>();
const imageDragDropBoundRoots = new WeakSet<HTMLElement>();
const lazyImageHydrationObservers = new WeakMap<ParentNode, IntersectionObserver[]>();
export const IMAGE_ATTACHMENT_ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml,image/avif,image/bmp,image/x-icon';
const IMAGE_SIZE_PRESETS = ['small', 'medium', 'large', 'fit-width', 'fit-height'] as const;

type LegacyCameraNavigator = Navigator & {
  getUserMedia?: (
    constraints: MediaStreamConstraints,
    successCallback: (stream: MediaStream) => void,
    errorCallback: (error: unknown) => void,
  ) => void;
  webkitGetUserMedia?: (
    constraints: MediaStreamConstraints,
    successCallback: (stream: MediaStream) => void,
    errorCallback: (error: unknown) => void,
  ) => void;
};

export function getImageBlobUrl(filename: string): string | null {
  if (!filename) {
    return null;
  }
  const attachmentId = getImageAttachmentId(filename);
  const hostUrl = state.attachmentHost?.resolveUrl?.(attachmentId);
  if (typeof hostUrl === 'string' && hostUrl.length > 0) {
    return hostUrl;
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

export function hasImageAttachmentSource(filename: string): boolean {
  if (!filename) {
    return false;
  }
  const id = getImageAttachmentId(filename);
  const hostUrl = state.attachmentHost?.resolveUrl?.(id);
  if (typeof hostUrl === 'string' && hostUrl.length > 0) {
    return true;
  }
  return getAttachmentDescriptors(state.document).some((descriptor) => descriptor.id === id);
}

export function renderImageElement(options: {
  filename: string;
  alt: string;
  helpers: ComponentRenderHelpers;
  className?: string;
  style?: string;
  lazy?: boolean;
  lazyCarousel?: boolean;
}): string | null {
  const shouldDeferSrc = (options.lazy ?? true) || options.lazyCarousel;
  const url = shouldDeferSrc ? null : getImageBlobUrl(options.filename);
  if (!url && !hasImageAttachmentSource(options.filename)) {
    return null;
  }
  const classAttr = options.className ? ` class="${options.helpers.escapeAttr(options.className)}"` : '';
  const srcAttr = url ? ` src="${options.helpers.escapeAttr(url)}"` : '';
  const loadingAttr = options.lazy ?? true ? ' loading="lazy"' : '';
  const styleAttr = options.style ? ` style="${options.helpers.escapeAttr(options.style)}"` : '';
  const lazyAttr = options.lazyCarousel ? ' data-hvy-carousel-lazy-image="true"' : '';
  const imageLazyAttr = shouldDeferSrc && !options.lazyCarousel ? ' data-hvy-lazy-image="true"' : '';
  return `<img${classAttr}${srcAttr}${loadingAttr} alt="${options.helpers.escapeAttr(options.alt)}" data-image-filename="${options.helpers.escapeAttr(options.filename)}"${lazyAttr}${imageLazyAttr}${styleAttr} />`;
}

export function clearImageBlobUrlCache(): void {
  for (const entry of blobUrlCache.values()) {
    URL.revokeObjectURL(entry.url);
  }
  blobUrlCache.clear();
}

export function bindLazyImageHydration(root: ParentNode): void {
  const startedAt = nowMs();
  lazyImageHydrationObservers.get(root)?.forEach((observer) => observer.disconnect());
  lazyImageHydrationObservers.delete(root);
  const images = Array.from(root.querySelectorAll<HTMLImageElement>('img[data-hvy-lazy-image="true"]'))
    .filter((image) => !image.getAttribute('src'));
  if (images.length === 0) {
    return;
  }
  if (typeof IntersectionObserver === 'undefined') {
    images.forEach(hydrateLazyImage);
    logPerfTrace('image-lazy-hydration:bind', {
      elapsedMs: elapsedMs(startedAt),
      imageCount: images.length,
      hydratedImmediately: images.length,
      observerCount: 0,
      targetCount: images.length,
      observerUnavailable: true,
    });
    return;
  }
  const imagesByScroller = new Map<Element | null, HTMLImageElement[]>();
  images.forEach((image) => {
    const scroller = image.closest('.reader-document, .editor-tree');
    imagesByScroller.set(scroller, [...(imagesByScroller.get(scroller) ?? []), image]);
  });
  const observers: IntersectionObserver[] = [];
  let targetCount = 0;
  imagesByScroller.forEach((scrollerImages, scroller) => {
    const imagesByTarget = new Map<Element, HTMLImageElement[]>();
    scrollerImages.forEach((image) => {
      const target = image.closest('.reader-section, .editor-section-card') ?? image;
      imagesByTarget.set(target, [...(imagesByTarget.get(target) ?? []), image]);
    });
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }
        observer.unobserve(entry.target);
        (imagesByTarget.get(entry.target) ?? []).forEach(hydrateLazyImage);
      });
    }, {
      root: scroller,
      rootMargin: '200px 0px',
      threshold: 0,
    });
    imagesByTarget.forEach((_targetImages, target) => observer.observe(target));
    targetCount += imagesByTarget.size;
    observers.push(observer);
  });
  lazyImageHydrationObservers.set(root, observers);
  logPerfTrace('image-lazy-hydration:bind', {
    elapsedMs: elapsedMs(startedAt),
    imageCount: images.length,
    hydratedImmediately: 0,
    observerCount: observers.length,
    targetCount,
  });
}

function hydrateLazyImage(image: HTMLImageElement): void {
  if (image.getAttribute('src')) {
    return;
  }
  const startedAt = nowMs();
  const filename = image.dataset.imageFilename ?? '';
  const url = getImageBlobUrl(filename);
  if (url) {
    observeHydratedImageLoad(image, filename, startedAt);
    image.src = url;
    image.dataset.hvyLazyImage = 'loaded';
    logPerfTrace('image-lazy-hydration:src-set', {
      filename,
      elapsedMs: elapsedMs(startedAt),
      complete: image.complete,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
    });
    return;
  }
  const missing = image.ownerDocument.createElement('div');
  missing.className = 'image-empty muted';
  missing.textContent = `Missing attachment: ${filename}`;
  image.replaceWith(missing);
  logPerfTrace('image-lazy-hydration:missing', {
    filename,
    elapsedMs: elapsedMs(startedAt),
  });
}

function observeHydratedImageLoad(image: HTMLImageElement, filename: string, startedAt: number): void {
  if (image.dataset.hvyLazyImageLoadObserved === 'true') {
    return;
  }
  image.dataset.hvyLazyImageLoadObserved = 'true';
  image.addEventListener('load', () => {
    logPerfTrace('image-lazy-hydration:load', {
      filename,
      elapsedMs: elapsedMs(startedAt),
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
    });
    if (typeof image.decode === 'function') {
      const decodeStartedAt = nowMs();
      void image.decode()
        .then(() => {
          logPerfTrace('image-lazy-hydration:decode', {
            filename,
            elapsedMs: elapsedMs(decodeStartedAt),
          });
        })
        .catch((error) => {
          logPerfTrace('image-lazy-hydration:decode-error', {
            filename,
            elapsedMs: elapsedMs(decodeStartedAt),
            message: error instanceof Error ? error.message : String(error),
          });
        });
    }
  }, { once: true });
  image.addEventListener('error', () => {
    logPerfTrace('image-lazy-hydration:error', {
      filename,
      elapsedMs: elapsedMs(startedAt),
    });
  }, { once: true });
}

export function renderImageAttachmentPicker(options: {
  helpers: ComponentRenderHelpers;
  action: string;
  actionLabel: string;
  sectionKey: string;
  blockId: string;
  selectedFilename?: string;
  selectedLabel?: string;
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
      const actionText = selected && options.selectedLabel ? options.selectedLabel : options.actionLabel;
      const actionIcon = selected && options.selectedLabel ? '' : plusIcon();
      const actionTitle = `${actionText}: ${filename}`;
      return `<div class="image-attachment-choice-wrap">
        <button
          type="button"
          class="image-attachment-choice${selected ? ' is-selected' : ''}"
          data-action="${options.helpers.escapeAttr(options.action)}"
          data-section-key="${options.helpers.escapeAttr(options.sectionKey)}"
          data-block-id="${options.helpers.escapeAttr(options.blockId)}"
          data-image-filename="${options.helpers.escapeAttr(filename)}"
          title="${options.helpers.escapeAttr(actionTitle)}"
          aria-label="${options.helpers.escapeAttr(actionTitle)}"
        >
          <span class="image-attachment-choice-thumb">${preview}</span>
          <span class="image-attachment-choice-name">${options.helpers.escapeHtml(filename)}</span>
          <span class="image-attachment-choice-action">${actionIcon}<span>${options.helpers.escapeHtml(actionText)}</span></span>
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
    captureButton.disabled = true;
    if (status) status.textContent = 'Capturing image...';
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      if (status) status.textContent = 'Could not capture image.';
      captureButton.disabled = false;
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) {
        if (status) status.textContent = 'Could not capture image.';
        captureButton.disabled = false;
        return;
      }
      const file = new File([blob], `${options.filenamePrefix}-${formatCameraTimestamp(new Date())}.jpg`, { type: 'image/jpeg' });
      void Promise.resolve(options.onCapture(file))
        .then(close)
        .catch((error) => {
          console.error('Camera capture failed', error);
          if (status) status.textContent = `Could not add captured image: ${error instanceof Error ? error.message : String(error)}`;
          if (captureButton.isConnected) {
            captureButton.disabled = false;
          }
        });
    }, 'image/jpeg', 0.9);
  });

  if (!video) {
    if (status) status.textContent = 'Camera is unavailable in this browser.';
    return;
  }

  const cameraRequest = requestCameraStream({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  if (!cameraRequest) {
    if (status) status.textContent = 'Camera is unavailable in this browser.';
    return;
  }

  void cameraRequest
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

function requestCameraStream(constraints: MediaStreamConstraints): Promise<MediaStream> | null {
  if (navigator.mediaDevices?.getUserMedia) {
    return navigator.mediaDevices.getUserMedia(constraints);
  }
  const legacyNavigator = navigator as LegacyCameraNavigator;
  const getUserMedia = legacyNavigator.getUserMedia || legacyNavigator.webkitGetUserMedia;
  if (!getUserMedia) {
    return null;
  }
  return new Promise((resolve, reject) => {
    getUserMedia.call(navigator, constraints, resolve, reject);
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
  const captionContent = renderTextCaptionHtml(block.schema.caption, helpers);
  const captionAlign = normalizeTextCaption(block.schema.caption)?.schema.align ?? 'center';
  const captionHtml = captionContent
    ? `<figcaption class="image-caption" style="text-align: ${helpers.escapeAttr(captionAlign)};">${captionContent}</figcaption>`
    : '';
  const image = renderImageElement({
    filename,
    alt,
    helpers,
    className: 'image-block-img',
    style: sanitizeInlineCss(block.schema.css),
    lazy: true,
  });
  if (!image) {
    return `<div class="image-empty muted">Missing attachment: ${helpers.escapeHtml(filename)}</div>`;
  }
  return `<figure class="image-figure">${image}${captionHtml}</figure>`;
}

export const renderImageEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => {
  const filename = block.schema.imageFile.trim();
  const downloadUrl = filename ? getImageBlobUrl(filename) : null;
  const canDeleteCurrentImage = filename && getImageAttachmentReferenceCount(filename) === 1;
  const activeSizePreset = getMatchingImagePresetCss(block.schema.css, IMAGE_SIZE_PRESETS);
  return `
    <div class="image-editor">
      <div class="image-toolbar">
        <div class="toolbar-segment image-align-buttons" role="group" aria-label="Image alignment">
          <button type="button" class="ghost" data-action="image-preset" data-image-preset="left" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(block.id)}" title="Align left">Left</button>
          <button type="button" class="ghost" data-action="image-preset" data-image-preset="center" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(block.id)}" title="Align center">Center</button>
          <button type="button" class="ghost" data-action="image-preset" data-image-preset="right" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(block.id)}" title="Align right">Right</button>
        </div>
        <div class="toolbar-segment image-fit-buttons" role="group" aria-label="Image size">
          ${renderImageSizePresetButton('small', 'Small', 'Small (20rem wide)', activeSizePreset, sectionKey, block.id, helpers)}
          ${renderImageSizePresetButton('medium', 'Medium', 'Medium (30rem wide)', activeSizePreset, sectionKey, block.id, helpers)}
          ${renderImageSizePresetButton('large', 'Large', 'Large (40rem wide)', activeSizePreset, sectionKey, block.id, helpers)}
          ${renderImageSizePresetButton('fit-width', 'Fit Width', 'Fit width', activeSizePreset, sectionKey, block.id, helpers)}
          ${renderImageSizePresetButton('fit-height', 'Fit Height', 'Fit height', activeSizePreset, sectionKey, block.id, helpers)}
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
        <label class="image-alt-label">
          <span>Caption</span>
          <button
            type="button"
            class="image-pick-button image-caption-edit-button"
            data-action="open-image-caption-modal"
            data-section-key="${helpers.escapeAttr(sectionKey)}"
            data-block-id="${helpers.escapeAttr(block.id)}"
          >${getTextCaptionMarkdown(block.schema.caption).trim() ? 'Edit caption' : 'Add caption'}</button>
        </label>
      </div>
      <div class="image-attachment-panel">
        <div class="image-attachment-panel-title">Use an attached image</div>
        ${renderImageAttachmentPicker({
          helpers,
          action: 'image-use-existing',
          actionLabel: 'Use image',
          sectionKey,
          blockId: block.id,
          selectedFilename: filename,
          selectedLabel: 'Current image',
          emptyText: 'No attached images yet.',
        })}
      </div>
    </div>
  `;
};

function renderImageSizePresetButton(
  preset: string,
  label: string,
  title: string,
  activePreset: string | null,
  sectionKey: string,
  blockId: string,
  helpers: ComponentRenderHelpers
): string {
  const active = preset === activePreset;
  return `<button type="button" class="ghost${active ? ' is-active' : ''}" data-action="image-preset" data-image-preset="${helpers.escapeAttr(preset)}" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(blockId)}" title="${helpers.escapeAttr(title)}" aria-pressed="${active ? 'true' : 'false'}">${helpers.escapeHtml(label)}</button>`;
}

export const renderImageReader: ComponentReaderRenderer = (_section, block, helpers) => {
  return `<div class="image-reader">${renderPreview(block, helpers)}</div>`;
};

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
  const id = getImageAttachmentId(filename);
  removeAttachment(state.document, id);
  void state.attachmentHost?.remove(id);
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
  const id = getImageAttachmentId(filename);
  removeAttachment(state.document, id);
  void state.attachmentHost?.remove(id);
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
  block.schema.caption = null;
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
  count += (block.schema.carouselImages ?? []).filter((image) => image.imageFile === filename).length;
  count += (block.schema.containerBlocks ?? []).reduce((total, child) => total + countBlockImageReferences(child, filename), 0);
  count += (block.schema.componentListBlocks ?? []).reduce((total, child) => total + countBlockImageReferences(child, filename), 0);
  count += (block.schema.gridItems ?? []).reduce((total, item) => total + countBlockImageReferences(item.block, filename), 0);
  count += (block.schema.expandableStubBlocks?.children ?? []).reduce((total, child) => total + countBlockImageReferences(child, filename), 0);
  count += (block.schema.expandableContentBlocks?.children ?? []).reduce((total, child) => total + countBlockImageReferences(child, filename), 0);
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
  const prepared = await prepareImageAttachmentBytes(
    file,
    mediaType,
    resolveDocumentImageAttachmentMaxDimensions(state.document.meta, state.imageAttachmentMaxDimensions)
  );
  recordHistory(`image-upload:${blockId}`);
  await storeImageAttachment(filename, prepared.mediaType, prepared.bytes);
  block.schema.imageFile = filename;
  if (!block.schema.imageAlt) {
    block.schema.imageAlt = filename;
  }
  clearImageBlobUrlCache();
  syncReusableTemplateForBlock(sectionKey, blockId);
  getRenderApp()();
}

export async function storeImageAttachment(filename: string, mediaType: string, bytes: Uint8Array): Promise<void> {
  const id = getImageAttachmentId(filename);
  const meta: JsonObject = { mediaType };
  const descriptor = await state.attachmentHost?.store(id, bytes, meta);
  const nextMeta = descriptor && typeof descriptor === 'object' ? descriptor.meta : meta;
  setAttachment(state.document, id, nextMeta, bytes);
  clearImageBlobUrlCache();
}

export async function reduceExistingImageAttachments(): Promise<{ reduced: number; skipped: number }> {
  const filenames = listImageFilenames(state.document);
  const maxDimensions = resolveDocumentImageAttachmentMaxDimensions(state.document.meta, state.imageAttachmentMaxDimensions);
  const reduced: Array<{ id: string; meta: JsonObject; bytes: Uint8Array }> = [];
  let skipped = 0;
  for (const filename of filenames) {
    const attachment = getImageAttachment(state.document, filename);
    if (!attachment || attachment.bytes.length === 0) {
      skipped += 1;
      continue;
    }
    const mediaType = typeof attachment.meta.mediaType === 'string'
      ? attachment.meta.mediaType
      : inferImageMediaType(filename);
    if (!isAllowedImageAttachmentMediaType(mediaType)) {
      skipped += 1;
      continue;
    }
    const file = new File([Uint8Array.from(attachment.bytes)], filename, { type: mediaType });
    const prepared = await prepareImageAttachmentBytes(file, mediaType, maxDimensions);
    if (!prepared.resized) {
      skipped += 1;
      continue;
    }
    reduced.push({
      id: getImageAttachmentId(filename),
      meta: { ...attachment.meta, mediaType: prepared.mediaType },
      bytes: prepared.bytes,
    });
  }
  if (reduced.length === 0) {
    return { reduced: 0, skipped };
  }
  recordHistory('image-attachments:reduce-existing');
  for (const entry of reduced) {
    const descriptor = await state.attachmentHost?.store(entry.id, entry.bytes, entry.meta);
    const nextMeta = descriptor && typeof descriptor === 'object' ? descriptor.meta : entry.meta;
    setAttachment(state.document, entry.id, nextMeta, entry.bytes);
  }
  clearImageBlobUrlCache();
  getRenderApp()();
  return { reduced: reduced.length, skipped };
}

export function bindImageDragAndDrop(app: HTMLElement): void {
  if (imageDragDropBoundRoots.has(app)) {
    return;
  }
  imageDragDropBoundRoots.add(app);
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
