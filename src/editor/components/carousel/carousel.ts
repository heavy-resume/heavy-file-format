import './carousel.css';

import type { ComponentEditorRenderer, ComponentReaderRenderer, ComponentRenderHelpers } from '../../component-helpers';
import type { CarouselImage, VisualBlock } from '../../types';
import { getImageAttachment, inferImageMediaType, listImageFilenames } from '../../../attachments';
import { findBlockByIds, resolveBlockContext } from '../../../block-ops';
import { recordHistory } from '../../../history';
import { syncReusableTemplateForBlock } from '../../../reusable';
import { getRefreshReaderPanels, getRenderApp, state } from '../../../state';
import { arrowDownIcon, arrowLeftIcon, arrowRightIcon, arrowUpIcon, cameraIcon, closeIcon } from '../../../icons';
import { getImageAttachmentReferenceCount, getImageBlobUrl, IMAGE_ATTACHMENT_ACCEPT, openImageCameraCapture, removeImageAttachmentIfLastReference, renderImageAttachmentPicker, renderImageElement, storeImageAttachment } from '../image/image';
import { isAllowedImageAttachmentMediaType, prepareImageAttachmentBytes, resolveDocumentImageAttachmentMaxDimensions } from '../../../image-attachments';
import { downloadBlob } from '../../../utils';

interface CarouselRuntimeState {
  index: number;
  pausedUntil: number;
  timer: number | null;
  observer: IntersectionObserver | null;
}

const runtimeState = new WeakMap<HTMLElement, CarouselRuntimeState>();

function normalizeDuration(value: number): number {
  return Math.max(800, Math.min(60000, Math.floor(value)));
}

function renderSlideImage(image: CarouselImage, helpers: ComponentRenderHelpers): string {
  const alt = image.imageAlt || image.caption || image.imageFile;
  const rendered = renderImageElement({
    filename: image.imageFile,
    alt,
    helpers,
    lazy: true,
    lazyCarousel: true,
  });
  if (!rendered) {
    return `<div class="hvy-carousel-missing">Missing attachment: ${helpers.escapeHtml(image.imageFile)}</div>`;
  }
  return rendered;
}

function renderReaderFrame(block: VisualBlock, helpers: ComponentRenderHelpers): string {
  if (block.schema.carouselImages.length === 0) {
    return '<div class="hvy-carousel-empty">No carousel images.</div>';
  }
  const frameClass = block.schema.carouselShowFrame
    ? 'hvy-carousel-reader-frame hvy-carousel-reader-frame-chrome'
    : 'hvy-carousel-reader-frame';
  const slides = block.schema.carouselImages
    .map((image, index) => {
      const caption = image.caption
        ? `<div class="hvy-carousel-caption">${helpers.escapeHtml(image.caption)}</div>`
        : '';
      return `<figure class="hvy-carousel-slide" data-carousel-slide="${index}">${renderSlideImage(image, helpers)}${caption}</figure>`;
    })
    .join('');
  const controls = block.schema.carouselShowControls
    ? `<button type="button" class="hvy-carousel-arrow hvy-carousel-arrow-left" data-carousel-action="prev" aria-label="Previous image">${arrowLeftIcon()}</button>
       <button type="button" class="hvy-carousel-arrow hvy-carousel-arrow-right" data-carousel-action="next" aria-label="Next image">${arrowRightIcon()}</button>`
    : '';
  const indicators = block.schema.carouselShowIndicators
    ? `<div class="hvy-carousel-indicators">${block.schema.carouselImages
        .map((_image, index) => `<button type="button" class="hvy-carousel-indicator" data-carousel-index="${index}" aria-label="Show image ${index + 1}" aria-pressed="false"></button>`)
        .join('')}</div>`
    : '';
  return `<div class="${frameClass}" data-carousel-reader="true" data-carousel-duration-ms="${helpers.escapeAttr(String(block.schema.carouselDurationMs))}" data-carousel-pause-on-hover="${block.schema.carouselPauseOnHover ? 'true' : 'false'}">
    <div class="hvy-carousel-track">${slides}</div>${controls}
  </div>${indicators}`;
}

export const renderCarouselReader: ComponentReaderRenderer = (_section, block, helpers) => {
  return `<div class="hvy-carousel hvy-carousel-reader">${renderReaderFrame(block, helpers)}</div>`;
};

export const renderCarouselEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => {
  return `<div class="hvy-carousel hvy-carousel-editor" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(block.id)}">
    ${renderReaderFrame(block, helpers)}
    <div class="hvy-carousel-editor-controls">
      <label class="hvy-carousel-duration-field"><span>Duration</span><input type="number" min="800" max="60000" step="100" data-field="carousel-duration-ms" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(block.id)}" value="${helpers.escapeAttr(String(block.schema.carouselDurationMs))}"></label>
      <label class="hvy-carousel-toggle"><input type="checkbox" data-field="carousel-pause-on-hover" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(block.id)}"${block.schema.carouselPauseOnHover ? ' checked' : ''}><span>Pause on hover</span></label>
      <label class="hvy-carousel-toggle"><input type="checkbox" data-field="carousel-show-controls" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(block.id)}"${block.schema.carouselShowControls ? ' checked' : ''}><span>Controls</span></label>
      <label class="hvy-carousel-toggle"><input type="checkbox" data-field="carousel-show-indicators" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(block.id)}"${block.schema.carouselShowIndicators ? ' checked' : ''}><span>Indicators</span></label>
      <label class="hvy-carousel-toggle"><input type="checkbox" data-field="carousel-show-frame" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(block.id)}"${block.schema.carouselShowFrame ? ' checked' : ''}><span>Frame</span></label>
    </div>
    <div class="hvy-carousel-upload-panel">
      <label class="hvy-carousel-pick-label">
        <input type="file" accept="${IMAGE_ATTACHMENT_ACCEPT}" multiple data-field="carousel-upload" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(block.id)}">
        <span class="hvy-carousel-pick-button">Add Images</span>
      </label>
      <button type="button" class="hvy-carousel-pick-button hvy-carousel-camera-button" data-action="carousel-take-photo" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(block.id)}">${cameraIcon()}<span>Take Photo</span></button>
    </div>
    <div class="hvy-carousel-attachment-panel">
      <div class="hvy-carousel-attachment-title">Attached images</div>
      ${renderImageAttachmentPicker({
        helpers,
        action: 'carousel-add-existing',
        sectionKey,
        blockId: block.id,
        emptyText: 'No attached images yet.',
      })}
    </div>
    <div class="hvy-carousel-image-list">
      ${block.schema.carouselImages.length === 0 ? '<div class="hvy-carousel-empty">Add images to build a carousel.</div>' : ''}
      ${block.schema.carouselImages.map((image, index) => renderEditorImageRow(image, index, block.schema.carouselImages.length, helpers, sectionKey, block.id)).join('')}
    </div>
  </div>`;
};

function renderEditorImageRow(
  image: CarouselImage,
  index: number,
  count: number,
  helpers: ComponentRenderHelpers,
  sectionKey: string,
  blockId: string
): string {
  const url = getImageBlobUrl(image.imageFile);
  const thumb = url
    ? `<img src="${helpers.escapeAttr(url)}" alt="${helpers.escapeAttr(image.imageAlt || image.imageFile)}">`
    : `<span>Missing</span>`;
  const download = url
    ? `<button type="button" class="hvy-carousel-download" data-action="carousel-download" data-carousel-index="${index}" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(blockId)}">Download</button>`
    : '';
  const deleteImage = getImageAttachmentReferenceCount(image.imageFile) === 1;
  return `<div class="hvy-carousel-image-row">
    <div class="hvy-carousel-thumb">
      ${thumb}
      ${deleteImage ? `<button type="button" class="hvy-carousel-delete-image image-attachment-delete" data-action="carousel-delete-image" data-carousel-index="${index}" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(blockId)}" title="Delete image attachment" aria-label="Delete image attachment ${helpers.escapeAttr(image.imageFile)}">${closeIcon()}</button>` : ''}
    </div>
    <div class="hvy-carousel-row-fields">
      <label><span>Caption</span><input type="text" data-field="carousel-caption" data-carousel-index="${index}" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(blockId)}" value="${helpers.escapeAttr(image.caption)}"></label>
      <label><span>Alt text</span><input type="text" data-field="carousel-alt" data-carousel-index="${index}" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(blockId)}" value="${helpers.escapeAttr(image.imageAlt)}"></label>
      <span class="muted">${helpers.escapeHtml(image.imageFile)}</span>
      ${download}
    </div>
    <div class="hvy-carousel-row-actions">
      <button type="button" class="ghost" data-action="carousel-move-up" data-carousel-index="${index}" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(blockId)}"${index === 0 ? ' disabled' : ''} title="Move up">${arrowUpIcon()}</button>
      <button type="button" class="ghost" data-action="carousel-move-down" data-carousel-index="${index}" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(blockId)}"${index === count - 1 ? ' disabled' : ''} title="Move down">${arrowDownIcon()}</button>
      <button type="button" class="ghost" data-action="carousel-remove" data-carousel-index="${index}" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(blockId)}" title="Remove">${closeIcon()}</button>
    </div>
  </div>`;
}

export function bindCarouselInteractions(app: HTMLElement): void {
  if (app.dataset.carouselBound !== 'true') {
    app.dataset.carouselBound = 'true';
    app.addEventListener('input', handleCarouselInput);
    app.addEventListener('change', handleCarouselChange);
    app.addEventListener('click', handleCarouselClick);
    app.addEventListener('focusin', handleCarouselFocusPause);
    app.addEventListener('mouseenter', handleCarouselHoverPause, true);
    app.addEventListener('mouseleave', handleCarouselHoverResume, true);
  }
  initializeCarouselReaders(app);
}

export function initializeCarouselReaders(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-carousel-reader="true"]').forEach((frame) => {
    if (runtimeState.has(frame)) {
      return;
    }
    const stateForFrame: CarouselRuntimeState = { index: 0, pausedUntil: 0, timer: null, observer: null };
    runtimeState.set(frame, stateForFrame);
    hydrateCarouselImagesAround(frame, 0);
    updateActiveIndicator(frame, 0);
    const start = () => {
      if (stateForFrame.timer !== null) {
        return;
      }
      stateForFrame.timer = window.setInterval(() => {
        if (!frame.isConnected) {
          if (stateForFrame.timer !== null) window.clearInterval(stateForFrame.timer);
          stateForFrame.timer = null;
          stateForFrame.observer?.disconnect();
          stateForFrame.observer = null;
          return;
        }
        if (Date.now() < stateForFrame.pausedUntil) {
          return;
        }
        scrollToCarouselIndex(frame, stateForFrame.index + 1, false);
      }, Number(frame.dataset.carouselDurationMs || 3000));
    };
    if ('IntersectionObserver' in window) {
      stateForFrame.observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.intersectionRatio > 0.5)) {
          start();
          stateForFrame.observer?.disconnect();
          stateForFrame.observer = null;
        }
      }, { threshold: 0.5 });
      stateForFrame.observer.observe(frame);
    } else {
      start();
    }
  });
}

function handleCarouselInput(event: Event): void {
  const target = event.target as HTMLInputElement | null;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }
  const field = target.dataset.field ?? '';
  if (field !== 'carousel-caption' && field !== 'carousel-alt' && field !== 'carousel-duration-ms') {
    return;
  }
  const block = resolveBlockContext(target)?.block ?? null;
  if (!block) return;
  recordHistory(`carousel:${block.id}:${field}`);
  if (field === 'carousel-duration-ms') {
    block.schema.carouselDurationMs = normalizeDuration(Number(target.value));
  } else {
    const index = Number(target.dataset.carouselIndex);
    const image = block.schema.carouselImages[index];
    if (!image) return;
    if (field === 'carousel-caption') image.caption = target.value;
    if (field === 'carousel-alt') image.imageAlt = target.value;
    syncCarouselEditorTextInput(target, image, index, field);
  }
  syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
  if (target.closest('.hvy-ai-reader-surface')) {
    return;
  }
  getRefreshReaderPanels()();
}

function syncCarouselEditorTextInput(target: HTMLInputElement, image: CarouselImage, index: number, field: string): void {
  const editor = target.closest<HTMLElement>('.hvy-carousel-editor');
  const slide = editor?.querySelector<HTMLElement>(`.hvy-carousel-slide[data-carousel-slide="${index}"]`);
  if (!slide) {
    return;
  }
  if (field === 'carousel-caption') {
    let caption = slide.querySelector<HTMLElement>('.hvy-carousel-caption');
    if (image.caption.trim().length === 0) {
      caption?.remove();
    } else {
      if (!caption) {
        caption = document.createElement('div');
        caption.className = 'hvy-carousel-caption';
        slide.append(caption);
      }
      caption.textContent = image.caption;
    }
  }
  if (field === 'carousel-alt' || field === 'carousel-caption') {
    const alt = image.imageAlt || image.caption || image.imageFile;
    slide.querySelector<HTMLImageElement>('img')?.setAttribute('alt', alt);
    target.closest<HTMLElement>('.hvy-carousel-image-row')
      ?.querySelector<HTMLImageElement>('.hvy-carousel-thumb img')
      ?.setAttribute('alt', image.imageAlt || image.imageFile);
  }
}

function handleCarouselChange(event: Event): void {
  const target = event.target as HTMLInputElement | null;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }
  const field = target.dataset.field ?? '';
  const block = resolveBlockContext(target)?.block ?? null;
  if (!block) return;
  if (field === 'carousel-upload') {
    const files = Array.from(target.files ?? []).filter((file) => {
      const mediaType = file.type || inferImageMediaType(file.name);
      return isAllowedImageAttachmentMediaType(mediaType);
    });
    if (files.length === 0) return;
    void appendCarouselImageFiles(block, target.dataset.sectionKey ?? '', files, `carousel-upload:${block.id}`);
    return;
  }
  if (field === 'carousel-pause-on-hover') block.schema.carouselPauseOnHover = target.checked;
  else if (field === 'carousel-show-controls') block.schema.carouselShowControls = target.checked;
  else if (field === 'carousel-show-indicators') block.schema.carouselShowIndicators = target.checked;
  else if (field === 'carousel-show-frame') block.schema.carouselShowFrame = target.checked;
  else return;
  recordHistory(`carousel:${block.id}:${field}`);
  syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
  getRefreshReaderPanels()();
  getRenderApp()();
}

function handleCarouselClick(event: Event): void {
  const target = event.target as HTMLElement | null;
  const readerButton = target?.closest<HTMLElement>('.hvy-carousel-arrow[data-carousel-action], .hvy-carousel-indicator[data-carousel-index]');
  if (readerButton) {
    const frame = readerButton.closest('.hvy-carousel')?.querySelector<HTMLElement>('[data-carousel-reader="true"]');
    if (frame) {
      const stateForFrame = runtimeState.get(frame);
      if (stateForFrame) stateForFrame.pausedUntil = Date.now() + Number(frame.dataset.carouselDurationMs || 3000);
      if (readerButton.dataset.carouselIndex) scrollToCarouselIndex(frame, Number(readerButton.dataset.carouselIndex), true);
      if (readerButton.dataset.carouselAction) scrollToCarouselIndex(frame, (stateForFrame?.index ?? 0) + (readerButton.dataset.carouselAction === 'prev' ? -1 : 1), true);
      return;
    }
  }
  const button = target?.closest<HTMLButtonElement>('[data-action^="carousel-"]');
  if (!button) return;
  const block = resolveBlockContext(button)?.block ?? findBlockByIds(button.dataset.sectionKey ?? '', button.dataset.blockId ?? '');
  if (!block) return;
  if (button.dataset.action === 'carousel-take-photo') {
    const root = button.closest<HTMLElement>('.hvy-document') ?? document.body;
    openImageCameraCapture(root, {
      title: 'Take photo',
      filenamePrefix: 'carousel-image',
      onCapture: (file) => appendCarouselImageFiles(block, button.dataset.sectionKey ?? '', [file], `carousel-camera:${block.id}`),
    });
    return;
  }
  if (button.dataset.action === 'carousel-add-existing') {
    const filename = button.dataset.imageFilename ?? '';
    if (!filename || !listImageFilenames(state.document).includes(filename)) return;
    recordHistory(`carousel:${block.id}:add-existing`);
    block.schema.carouselImages.push({ imageFile: filename, imageAlt: filename, caption: '' });
    syncReusableTemplateForBlock(button.dataset.sectionKey ?? '', block.id);
    getRenderApp()();
    return;
  }
  const index = Number(button.dataset.carouselIndex);
  if (button.dataset.action === 'carousel-delete-image') {
    const image = block.schema.carouselImages[index];
    if (!image || !removeImageAttachmentIfLastReference(image.imageFile)) return;
    recordHistory(`carousel:${block.id}:delete-image`);
    block.schema.carouselImages.splice(index, 1);
    syncReusableTemplateForBlock(button.dataset.sectionKey ?? '', block.id);
    getRenderApp()();
    return;
  }
  if (button.dataset.action === 'carousel-download') {
    const image = block.schema.carouselImages[index];
    if (!image) return;
    const attachment = getImageAttachment(state.document, image.imageFile);
    if (!attachment || attachment.bytes.length === 0) return;
    const mediaType = typeof attachment.meta.mediaType === 'string' ? attachment.meta.mediaType : 'application/octet-stream';
    const bytes = Uint8Array.from(attachment.bytes);
    const downloadEvent = new CustomEvent('hvy:download-attachment', {
      bubbles: true,
      cancelable: true,
      detail: { filename: image.imageFile, mediaType, bytes },
    });
    button.dispatchEvent(downloadEvent);
    if (!downloadEvent.defaultPrevented) {
      downloadBlob(image.imageFile, new Blob([bytes], { type: mediaType }));
    }
    return;
  }
  const nextImages = [...block.schema.carouselImages];
  if (button.dataset.action === 'carousel-remove') nextImages.splice(index, 1);
  if (button.dataset.action === 'carousel-move-up' && index > 0) [nextImages[index - 1], nextImages[index]] = [nextImages[index]!, nextImages[index - 1]!];
  if (button.dataset.action === 'carousel-move-down' && index < nextImages.length - 1) [nextImages[index], nextImages[index + 1]] = [nextImages[index + 1]!, nextImages[index]!];
  recordHistory(`carousel:${block.id}:${button.dataset.action}`);
  block.schema.carouselImages = nextImages;
  syncReusableTemplateForBlock(button.dataset.sectionKey ?? '', block.id);
  getRenderApp()();
}

async function appendCarouselImageFiles(block: VisualBlock, sectionKey: string, files: File[], historyGroup: string): Promise<void> {
  recordHistory(historyGroup);
  const images = await Promise.all(files.map(async (file) => {
    const mediaType = file.type || inferImageMediaType(file.name);
    const prepared = await prepareImageAttachmentBytes(
      file,
      mediaType,
      resolveDocumentImageAttachmentMaxDimensions(state.document.meta, state.imageAttachmentMaxDimensions)
    );
    await storeImageAttachment(file.name, prepared.mediaType, prepared.bytes);
    return { imageFile: file.name, imageAlt: file.name, caption: '' };
  }));
  block.schema.carouselImages.push(...images);
  syncReusableTemplateForBlock(sectionKey, block.id);
  getRenderApp()();
}

function handleCarouselFocusPause(event: Event): void {
  const frame = (event.target as HTMLElement | null)?.closest('.hvy-carousel')?.querySelector<HTMLElement>('[data-carousel-reader="true"]');
  if (!frame) return;
  const stateForFrame = runtimeState.get(frame);
  if (stateForFrame) stateForFrame.pausedUntil = Date.now() + Number(frame.dataset.carouselDurationMs || 3000);
}

function handleCarouselHoverPause(event: Event): void {
  const frame = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-carousel-reader="true"]');
  if (!frame || frame.dataset.carouselPauseOnHover !== 'true') return;
  const stateForFrame = runtimeState.get(frame);
  if (stateForFrame) stateForFrame.pausedUntil = Number.MAX_SAFE_INTEGER;
}

function handleCarouselHoverResume(event: Event): void {
  const frame = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-carousel-reader="true"]');
  if (!frame) return;
  const stateForFrame = runtimeState.get(frame);
  if (stateForFrame?.pausedUntil === Number.MAX_SAFE_INTEGER) {
    stateForFrame.pausedUntil = 0;
  }
}

function scrollToCarouselIndex(frame: HTMLElement, rawIndex: number, smooth: boolean): void {
  const track = frame.querySelector<HTMLElement>('.hvy-carousel-track');
  if (!track) return;
  const slides = Array.from(track.querySelectorAll<HTMLElement>('.hvy-carousel-slide'));
  const count = slides.length;
  if (count === 0) return;
  const index = ((rawIndex % count) + count) % count;
  const stateForFrame = runtimeState.get(frame);
  if (stateForFrame) stateForFrame.index = index;
  hydrateCarouselImagesAround(frame, index);
  const slide = slides[index];
  track.scrollTo({ left: slide ? getCarouselSlideScrollLeft(track, slide) : 0, behavior: smooth ? 'smooth' : 'auto' });
  updateActiveIndicator(frame, index);
}

function hydrateCarouselImagesAround(frame: HTMLElement, index: number): void {
  const slides = Array.from(frame.querySelectorAll<HTMLElement>('.hvy-carousel-slide'));
  const count = slides.length;
  if (count === 0) {
    return;
  }
  [index - 1, index, index + 1].forEach((rawIndex) => {
    const normalized = ((rawIndex % count) + count) % count;
    hydrateCarouselSlideImage(slides[normalized]);
  });
}

function hydrateCarouselSlideImage(slide: HTMLElement | undefined): void {
  const image = slide?.querySelector<HTMLImageElement>('img[data-hvy-carousel-lazy-image="true"]');
  if (!image || image.getAttribute('src')) {
    return;
  }
  const filename = image.dataset.imageFilename ?? '';
  const url = getImageBlobUrl(filename);
  if (url) {
    image.src = url;
    return;
  }
  const missing = image.ownerDocument.createElement('div');
  missing.className = 'hvy-carousel-missing';
  missing.textContent = `Missing attachment: ${filename}`;
  image.replaceWith(missing);
}

export function getCarouselSlideScrollLeft(track: HTMLElement, slide: HTMLElement): number {
  const trackRect = track.getBoundingClientRect();
  const slideRect = slide.getBoundingClientRect();
  return track.scrollLeft + slideRect.left - trackRect.left;
}

function updateActiveIndicator(frame: HTMLElement, index: number): void {
  const carousel = frame.closest('.hvy-carousel');
  carousel?.querySelectorAll<HTMLElement>('.hvy-carousel-indicator').forEach((indicator) => {
    const active = indicator.dataset.carouselIndex === String(index);
    indicator.classList.toggle('is-active', active);
    indicator.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}
