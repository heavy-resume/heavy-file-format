import type { VisualBlock } from '../../types';
import { inferImageMediaType } from '../../../attachments';
import { assignAutoBlockId } from '../../../auto-block-id';
import { createEmptyBlock, createEmptySectionWithMeta, ensureContainerBlocks } from '../../../document-factory';
import { isAllowedImageAttachmentMediaType, prepareImageAttachmentBytes, resolveDocumentImageAttachmentMaxDimensions } from '../../../image-attachments';
import { recordHistory } from '../../../history';
import { findBlockByIds } from '../../../block-ops';
import { findBlockContainerById, findSectionByKey } from '../../../section-ops';
import { horizontalArrowsIcon, verticalArrowsIcon } from '../../../icons';
import { state, getActiveStateRuntime, getRefreshReaderPanels, getRenderApp, runWithStateRuntimeAsync } from '../../../state';
import { syncReusableTemplateForBlock } from '../../../reusable';
import { clearImageBlobUrlCache, handleImageUpload, storeImageAttachment } from './image';

const boundRoots = new WeakSet<HTMLElement>();
const DROP_ACTIVE_CLASS = 'image-document-drop-active';
const DROP_BEFORE_CLASS = 'image-document-drop-before';
const DROP_AFTER_CLASS = 'image-document-drop-after';
const pendingModeChoices = new WeakMap<HTMLElement, { root: HTMLElement; resolve: (mode: ImageDropInsertMode | null) => void }>();

export type ImageDropInsertMode = 'images' | 'carousel';

export type DocumentImageDropPlacement =
  | { kind: 'relative'; sectionKey: string; blockId: string; position: 'before' | 'after' }
  | { kind: 'container-end'; sectionKey: string; blockId: string }
  | { kind: 'section-index'; sectionKey: string; index: number }
  | { kind: 'new-section'; location?: 'main' | 'sidebar'; beforeSectionKey?: string };

interface ResolvedDocumentImageDrop {
  placement: DocumentImageDropPlacement;
  previewElement: HTMLElement;
  previewPosition: 'before' | 'after';
}

export function bindImageDragAndDrop(app: HTMLElement): void {
  if (boundRoots.has(app)) return;
  boundRoots.add(app);

  app.addEventListener('dragenter', (event) => {
    const dropzone = getImageComponentDropzone(event);
    if (dropzone) {
      event.preventDefault();
      dropzone.classList.add('image-dropzone-active');
    }
  });

  app.addEventListener('dragover', (event) => {
    const dropzone = getImageComponentDropzone(event);
    if (dropzone) {
      event.preventDefault();
      clearDocumentDropPreview(app);
      dropzone.classList.add('image-dropzone-active');
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      return;
    }
    if (!isPotentialImageFileDrag(event.dataTransfer)) {
      clearDocumentDropPreview(app);
      return;
    }
    event.preventDefault();
    const resolved = isAllowedImageFileDrag(event.dataTransfer)
      ? resolveDocumentImageDrop(app, event.target as HTMLElement | null, event.clientX, event.clientY)
      : null;
    clearDocumentDropPreview(app);
    if (!resolved) {
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
      return;
    }
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    resolved.previewElement.classList.add(
      DROP_ACTIVE_CLASS,
      resolved.previewPosition === 'before' ? DROP_BEFORE_CLASS : DROP_AFTER_CLASS,
    );
  });

  app.addEventListener('dragleave', (event) => {
    const dropzone = getImageComponentDropzone(event);
    if (dropzone && !dropzone.contains(event.relatedTarget as Node | null)) {
      dropzone.classList.remove('image-dropzone-active');
    }
    if (!app.contains(event.relatedTarget as Node | null)) clearDocumentDropPreview(app);
  });

  app.addEventListener('drop', (event) => {
    const dropzone = getImageComponentDropzone(event);
    if (dropzone) {
      event.preventDefault();
      dropzone.classList.remove('image-dropzone-active');
      const file = event.dataTransfer?.files?.[0];
      if (file && isAllowedImageFile(file)) void handleImageUpload(dropzone, file);
      return;
    }

    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.some(isPotentialImageFile)) event.preventDefault();
    const resolved = resolveDocumentImageDrop(app, event.target as HTMLElement | null, event.clientX, event.clientY);
    clearDocumentDropPreview(app);
    if (!resolved || files.length === 0 || files.some((file) => !isAllowedImageFile(file))) return;
    const runtime = getActiveStateRuntime();
    void runWithStateRuntimeAsync(runtime, async () => {
      const mode = files.length > 1 && state.document.extension !== '.phvy'
        ? await requestImageDropInsertMode(app, resolved.previewElement)
        : 'images';
      if (mode) await insertDroppedImageFiles(resolved.placement, files, mode);
    });
  });
}

function getImageComponentDropzone(event: Event): HTMLElement | null {
  return (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-image-dropzone="true"]') ?? null;
}

function isAllowedImageFile(file: File): boolean {
  return Boolean(file.name) && isAllowedImageAttachmentMediaType(file.type || inferImageMediaType(file.name));
}

function isPotentialImageFile(file: File): boolean {
  return (file.type || inferImageMediaType(file.name)).startsWith('image/');
}

function isPotentialImageFileDrag(transfer: DataTransfer | null): boolean {
  if (!transfer) return false;
  const fileItems = Array.from(transfer.items ?? []).filter((item) => item.kind === 'file');
  if (fileItems.length > 0) {
    return fileItems.some((item) => !item.type || item.type.startsWith('image/'));
  }
  return Array.from(transfer.types ?? []).includes('Files');
}

function isAllowedImageFileDrag(transfer: DataTransfer | null): boolean {
  if (!transfer) return false;
  const fileItems = Array.from(transfer.items ?? []).filter((item) => item.kind === 'file');
  return fileItems.length === 0
    ? Array.from(transfer.types ?? []).includes('Files')
    : fileItems.every((item) => !item.type || isAllowedImageAttachmentMediaType(item.type));
}

export function resolveDocumentImageDrop(
  app: HTMLElement,
  target: HTMLElement | null,
  clientX: number,
  clientY: number,
): ResolvedDocumentImageDrop | null {
  if (!target || target.closest('[data-image-dropzone="true"]')) return null;

  const sectionGap = target.closest<HTMLElement>('[data-image-section-drop-gap="true"]');
  if (sectionGap) {
    const bounds = sectionGap.getBoundingClientRect();
    const beforeSectionKey = sectionGap.dataset.beforeSectionKey ?? '';
    const beforeSection = beforeSectionKey ? findSectionByKey(state.document.sections, beforeSectionKey) : null;
    if (!beforeSection || !containsX(bounds, clientX)) return null;
    return {
      placement: {
        kind: 'new-section',
        location: sectionGap.dataset.sectionLocation === 'sidebar' ? 'sidebar' : 'main',
        beforeSectionKey,
      },
      previewElement: sectionGap,
      previewPosition: 'after',
    };
  }

  const blockElement = target.closest<HTMLElement>('[data-hvy-virtual-item="editor-block"]');
  const nestedContainer = target.closest<HTMLElement>('[data-image-drop-block-container="container"]');
  const nestedReaderBlock = target.closest<HTMLElement>('[data-hvy-virtual-item="reader-block"]');
  if (nestedContainer && nestedReaderBlock && nestedReaderBlock.dataset.blockId !== nestedContainer.dataset.blockId) {
    const sectionKey = nestedReaderBlock.dataset.sectionKey ?? '';
    const blockId = nestedReaderBlock.dataset.blockId ?? '';
    const bounds = nestedReaderBlock.getBoundingClientRect();
    const location = findBlockContainerById(state.document.sections, sectionKey, blockId);
    const section = findSectionByKey(state.document.sections, sectionKey);
    const owner = location?.ownerBlockId ? findBlockByIds(sectionKey, location.ownerBlockId) : null;
    if (!section || !location || (section.lock && location.ownerBlockId === null) || owner?.schema.lock || !containsX(bounds, clientX)) return null;
    const position = clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
    return {
      placement: { kind: 'relative', sectionKey, blockId, position },
      previewElement: nestedReaderBlock,
      previewPosition: position,
    };
  }
  if (nestedContainer && blockElement?.dataset.blockId === nestedContainer.dataset.blockId) {
    const sectionKey = nestedContainer.dataset.sectionKey ?? '';
    const blockId = nestedContainer.dataset.blockId ?? '';
    const bounds = nestedContainer.getBoundingClientRect();
    const owner = findBlockByIds(sectionKey, blockId);
    if (!sectionKey || !blockId || !owner || owner.schema.lock || !containsX(bounds, clientX)) return null;
    return {
      placement: { kind: 'container-end', sectionKey, blockId },
      previewElement: nestedContainer,
      previewPosition: 'after',
    };
  }

  if (blockElement) {
    const sectionKey = blockElement.dataset.sectionKey ?? '';
    const blockId = blockElement.dataset.blockId ?? '';
    const bounds = blockElement.getBoundingClientRect();
    const location = findBlockContainerById(state.document.sections, sectionKey, blockId);
    const section = findSectionByKey(state.document.sections, sectionKey);
    if (!sectionKey || !blockId || !location || !section || (section.lock && location.ownerBlockId === null) || blockElement.dataset.parentLocked === 'true' || !containsX(bounds, clientX)) {
      return null;
    }
    const position = clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
    return {
      placement: { kind: 'relative', sectionKey, blockId, position },
      previewElement: blockElement,
      previewPosition: position,
    };
  }

  const sectionInsertGhost = target.closest<HTMLElement>('.compact-add-component-ghost');
  const sectionBlocks = sectionInsertGhost?.parentElement;
  const sectionElement = sectionBlocks?.parentElement;
  if (
    sectionInsertGhost
    && sectionBlocks?.classList.contains('editor-blocks')
    && sectionElement?.hasAttribute('data-editor-section')
  ) {
    const sectionKey = sectionElement.dataset.editorSection ?? '';
    const section = findSectionByKey(state.document.sections, sectionKey);
    const bounds = sectionInsertGhost.getBoundingClientRect();
    if (!section || section.lock || !containsX(bounds, clientX)) return null;
    return {
      placement: { kind: 'section-index', sectionKey, index: section.blocks.length },
      previewElement: sectionInsertGhost,
      previewPosition: 'after',
    };
  }

  const body = target.closest<HTMLElement>('.editor-tree-body')
    ?? (target.closest('.editor-document-tail') ? app.querySelector<HTMLElement>('.editor-tree-body') : null);
  if (!body) return null;
  const topLevelSections = getTopLevelSectionElements(body);
  const lastSection = topLevelSections.at(-1);
  const horizontalBounds = lastSection?.getBoundingClientRect() ?? body.getBoundingClientRect();
  if (!containsX(horizontalBounds, clientX) || (lastSection && clientY < horizontalBounds.bottom)) return null;
  const lastSectionKey = getRenderedSectionKey(lastSection);
  const lastDocumentSection = lastSectionKey ? findSectionByKey(state.document.sections, lastSectionKey) : null;
  return {
    placement: {
      kind: 'new-section',
      location: lastDocumentSection?.location ?? (body.classList.contains('editor-sidebar-tree-body') ? 'sidebar' : 'main'),
    },
    previewElement: body,
    previewPosition: 'after',
  };
}

function getTopLevelSectionElements(body: HTMLElement): HTMLElement[] {
  return Array.from(body.children).filter(
    (element): element is HTMLElement => element instanceof HTMLElement && (
      Boolean(element.dataset.editorSection)
      || (element.dataset.hvyVirtualKind === 'editor' && element.dataset.hvyVirtualSubsection === 'false')
    ),
  );
}

function getRenderedSectionKey(element: HTMLElement | undefined): string {
  return element?.dataset.editorSection ?? element?.dataset.sectionKey ?? '';
}

function containsX(rect: Pick<DOMRect, 'left' | 'right'>, clientX: number): boolean {
  return clientX >= rect.left && clientX <= rect.right;
}

function clearDocumentDropPreview(app: HTMLElement): void {
  app.querySelectorAll<HTMLElement>(`.${DROP_ACTIVE_CLASS}`).forEach((element) => {
    element.classList.remove(DROP_ACTIVE_CLASS, DROP_BEFORE_CLASS, DROP_AFTER_CLASS);
  });
}

export async function insertDroppedImageFiles(
  placement: DocumentImageDropPlacement,
  files: File[],
  mode: ImageDropInsertMode = 'images',
): Promise<boolean> {
  if (files.length === 0 || files.some((file) => !isAllowedImageFile(file))) return false;
  const preparedFiles = await Promise.all(files.map(async (file) => {
    const mediaType = file.type || inferImageMediaType(file.name);
    const prepared = await prepareImageAttachmentBytes(
      file,
      mediaType,
      resolveDocumentImageAttachmentMaxDimensions(state.document.meta, state.imageAttachmentMaxDimensions),
    );
    return { filename: file.name, mediaType: prepared.mediaType, bytes: prepared.bytes };
  }));
  let destination = placement.kind === 'new-section' ? null : resolveInsertionDestination(placement);
  if (placement.kind !== 'new-section' && !destination) return false;
  recordHistory();
  if (placement.kind === 'new-section') {
    const section = createEmptySectionWithMeta(1, '', false, state.document.meta);
    section.location = placement.location ?? 'main';
    const beforeIndex = placement.beforeSectionKey
      ? state.document.sections.findIndex((candidate) => candidate.key === placement.beforeSectionKey)
      : -1;
    if (beforeIndex >= 0) {
      state.document.sections.splice(beforeIndex, 0, section);
    } else {
      let insertIndex = section.location === 'main'
        ? state.document.sections.findIndex((candidate) => candidate.location === 'sidebar')
        : state.document.sections.length;
      if (insertIndex < 0) insertIndex = state.document.sections.length;
      for (let index = state.document.sections.length - 1; index >= 0; index -= 1) {
        if (state.document.sections[index]?.location === section.location) {
          insertIndex = index + 1;
          break;
        }
      }
      state.document.sections.splice(insertIndex, 0, section);
    }
    destination = {
      blocks: section.blocks,
      index: 0,
      sectionKey: section.key,
      inheritedTags: section.tags,
      reusableOwnerBlockId: null,
    };
  }
  if (!destination) return false;
  for (const file of preparedFiles) await storeImageAttachment(file.filename, file.mediaType, file.bytes);
  const blocks = mode === 'carousel'
    ? [createDroppedCarouselBlock(preparedFiles.map((file) => file.filename), destination.inheritedTags)]
    : preparedFiles.map((file) => createDroppedImageBlock(file.filename, destination.inheritedTags));
  destination.blocks.splice(destination.index, 0, ...blocks);
  if (destination.reusableOwnerBlockId) syncReusableTemplateForBlock(destination.sectionKey, destination.reusableOwnerBlockId);
  clearImageBlobUrlCache();
  getRefreshReaderPanels()();
  getRenderApp()();
  return true;
}

function createDroppedCarouselBlock(filenames: string[], inheritedTags: string): VisualBlock {
  const block = createEmptyBlock('carousel', false, state.document.meta);
  block.schema.carouselImages = filenames.map((filename) => ({ imageFile: filename, imageAlt: filename, caption: '' }));
  assignAutoBlockId(block, { document: state.document, inheritedTags });
  return block;
}

function requestImageDropInsertMode(
  app: HTMLElement,
  previewElement: HTMLElement,
): Promise<ImageDropInsertMode | null> {
  const existing = pendingModeChoices.get(app);
  if (existing) {
    existing.root.remove();
    existing.resolve(null);
  }
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'modal-root image-drop-choice-root';
    root.innerHTML = `
      <div class="modal-overlay" data-image-drop-choice="cancel"></div>
      <section class="modal-panel image-drop-choice-modal" role="dialog" aria-modal="true" aria-labelledby="imageDropChoiceTitle" tabindex="-1">
        <div class="image-drop-choice-head">
          <h3 id="imageDropChoiceTitle">How should these images be added?</h3>
        </div>
        <div class="image-drop-choice-actions">
          <button type="button" class="image-drop-choice-card" data-image-drop-choice="images">
            <span class="image-drop-choice-background">${verticalArrowsIcon()}</span>
            <strong>Images</strong>
          </button>
          <button type="button" class="image-drop-choice-card" data-image-drop-choice="carousel">
            <span class="image-drop-choice-background">${horizontalArrowsIcon()}</span>
            <strong>Carousel</strong>
          </button>
        </div>
        <button type="button" class="ghost image-drop-choice-cancel" data-image-drop-choice="cancel">Cancel</button>
      </section>
    `;
    const finish = (mode: ImageDropInsertMode | null): void => {
      root.remove();
      pendingModeChoices.delete(app);
      resolve(mode);
    };
    pendingModeChoices.set(app, { root, resolve });
    root.addEventListener('click', (event) => {
      const mode = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-image-drop-choice]')?.dataset.imageDropChoice;
      if (mode === 'images' || mode === 'carousel') finish(mode);
      else if (mode === 'cancel') finish(null);
    });
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(null);
      }
    });
    (previewElement.closest<HTMLElement>('.hvy-surface') ?? app).append(root);
    root.querySelector<HTMLElement>('.image-drop-choice-modal')?.focus();
  });
}

function createDroppedImageBlock(filename: string, inheritedTags: string): VisualBlock {
  const block = createEmptyBlock('image', false, state.document.meta);
  block.schema.imageFile = filename;
  assignAutoBlockId(block, { document: state.document, inheritedTags });
  return block;
}

function resolveInsertionDestination(placement: DocumentImageDropPlacement): {
  blocks: VisualBlock[];
  index: number;
  sectionKey: string;
  inheritedTags: string;
  reusableOwnerBlockId: string | null;
} | null {
  if (placement.kind === 'new-section') return null;
  const section = findSectionByKey(state.document.sections, placement.sectionKey);
  if (!section) return null;
  if (placement.kind === 'section-index') {
    if (section.lock) return null;
    return {
      blocks: section.blocks,
      index: Math.max(0, Math.min(placement.index, section.blocks.length)),
      sectionKey: section.key,
      inheritedTags: section.tags,
      reusableOwnerBlockId: null,
    };
  }
  if (placement.kind === 'container-end') {
    const owner = findBlockByIds(placement.sectionKey, placement.blockId);
    if (!owner || owner.schema.lock) return null;
    ensureContainerBlocks(owner);
    return {
      blocks: owner.schema.containerBlocks,
      index: owner.schema.containerBlocks.length,
      sectionKey: section.key,
      inheritedTags: owner.schema.tags,
      reusableOwnerBlockId: owner.id,
    };
  }
  const location = findBlockContainerById(state.document.sections, placement.sectionKey, placement.blockId);
  if (!location) return null;
  if (section.lock && location.ownerBlockId === null) return null;
  const owner = location.ownerBlockId ? findBlockByIds(placement.sectionKey, location.ownerBlockId) : null;
  if (owner?.schema.lock) return null;
  return {
    blocks: location.container,
    index: location.index + (placement.position === 'after' ? 1 : 0),
    sectionKey: section.key,
    inheritedTags: owner?.schema.tags ?? section.tags,
    reusableOwnerBlockId: owner?.id ?? null,
  };
}
