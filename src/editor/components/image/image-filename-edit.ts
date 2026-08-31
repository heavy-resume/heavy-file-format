import { getImageAttachment, getImageAttachmentId, listImageFilenames, removeAttachment, setAttachment } from '../../../attachments';
import { normalizeAttachmentBytes } from '../../../attachment-store';
import { recordHistory } from '../../../history';
import { syncReusableTemplateForBlock } from '../../../reusable';
import { getRefreshReaderPanels, state } from '../../../state';
import type { VisualBlock, VisualSection } from '../../types';
import { clearImageBlobUrlCache, resolveImageBlobUrl } from './image';

const boundFilenameEditorRoots = new WeakSet<HTMLElement>();

export function bindImageFilenameEditing(app: HTMLElement): void {
  if (boundFilenameEditorRoots.has(app)) return;
  boundFilenameEditorRoots.add(app);
  app.addEventListener('click', (event) => {
    const filenameButton = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('[data-image-filename-editor]');
    if (!filenameButton || !app.contains(filenameButton)) return;
    beginImageFilenameEdit(app, filenameButton);
  });
}

function beginImageFilenameEdit(app: HTMLElement, filenameButton: HTMLButtonElement): void {
  const filename = filenameButton.textContent?.trim() ?? '';
  if (!filename) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'image-filename image-filename-input';
  input.value = filename;
  input.setAttribute('aria-label', `Image attachment filename for ${filename}`);
  filenameButton.replaceWith(input);
  input.focus({ preventScroll: true });
  input.select();

  let finishing = false;
  const finish = async (cancel: boolean): Promise<void> => {
    if (finishing) return;
    finishing = true;
    const requestedFilename = input.value.trim();
    let renamed = false;
    if (!cancel) {
      try {
        renamed = await renameImageAttachment(filename, requestedFilename);
      } catch {
        renamed = false;
      }
    }
    const displayedFilename = renamed ? requestedFilename : filename;
    if (renamed) updateRenderedImageFilenames(app, filename, displayedFilename);
    filenameButton.textContent = displayedFilename;
    filenameButton.title = 'Rename image attachment';
    filenameButton.setAttribute('aria-label', `Rename image attachment ${displayedFilename}`);
    if (input.isConnected) input.replaceWith(filenameButton);
  };
  input.addEventListener('blur', () => { void finish(false); }, { once: true });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      input.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      void finish(true);
    }
  });
}

export async function renameImageAttachment(filename: string, nextFilenameValue: string): Promise<boolean> {
  const nextFilename = nextFilenameValue.trim();
  if (!filename || !nextFilename) return false;
  if (filename === nextFilename) return true;
  if (listImageFilenames(state.document).includes(nextFilename)) return false;
  const attachment = getImageAttachment(state.document, filename);
  if (!attachment) return false;

  let bytes = attachment.bytes;
  if (bytes.length === 0 && state.attachmentHost) {
    const recalled = await state.attachmentHost.recall(getImageAttachmentId(filename));
    if (recalled) bytes = await normalizeAttachmentBytes(recalled);
  }

  const nextId = getImageAttachmentId(nextFilename);
  const descriptor = await state.attachmentHost?.store(nextId, bytes, attachment.meta);
  const nextMeta = descriptor && typeof descriptor === 'object' ? descriptor.meta : attachment.meta;
  recordHistory(`image-attachment-rename:${filename}`);
  setAttachment(state.document, nextId, nextMeta, bytes);
  removeAttachment(state.document, getImageAttachmentId(filename));
  renameDocumentImageReferences(filename, nextFilename);
  await state.attachmentHost?.remove(getImageAttachmentId(filename));
  clearImageBlobUrlCache();
  getRefreshReaderPanels()();
  return true;
}

function renameDocumentImageReferences(filename: string, nextFilename: string): void {
  state.document.sections.forEach((section) => renameSectionImageReferences(section, filename, nextFilename));
}

function renameSectionImageReferences(section: VisualSection, filename: string, nextFilename: string): void {
  section.blocks.forEach((block) => {
    if (renameBlockImageReferences(block, filename, nextFilename)) {
      syncReusableTemplateForBlock(section.key, block.id);
    }
  });
  section.children.forEach((child) => renameSectionImageReferences(child, filename, nextFilename));
}

function renameBlockImageReferences(block: VisualBlock, filename: string, nextFilename: string): boolean {
  let renamed = false;
  if (block.schema.imageFile === filename) {
    block.schema.imageFile = nextFilename;
    renamed = true;
  }
  (block.schema.carouselImages ?? []).forEach((image) => {
    if (image.imageFile === filename) {
      image.imageFile = nextFilename;
      renamed = true;
    }
  });
  (block.schema.containerBlocks ?? []).forEach((child) => { renamed = renameBlockImageReferences(child, filename, nextFilename) || renamed; });
  (block.schema.componentListBlocks ?? []).forEach((child) => { renamed = renameBlockImageReferences(child, filename, nextFilename) || renamed; });
  (block.schema.gridItems ?? []).forEach((item) => { renamed = renameBlockImageReferences(item.block, filename, nextFilename) || renamed; });
  (block.schema.expandableStubBlocks?.children ?? []).forEach((child) => { renamed = renameBlockImageReferences(child, filename, nextFilename) || renamed; });
  (block.schema.expandableContentBlocks?.children ?? []).forEach((child) => { renamed = renameBlockImageReferences(child, filename, nextFilename) || renamed; });
  return renamed;
}

function updateRenderedImageFilenames(root: ParentNode, filename: string, nextFilename: string): void {
  root.querySelectorAll<HTMLElement>('[data-image-filename]').forEach((element) => {
    if (element.dataset.imageFilename !== filename) return;
    element.dataset.imageFilename = nextFilename;
    if (element instanceof HTMLImageElement) {
      void resolveImageBlobUrl(nextFilename).then((url) => {
        if (url && element.isConnected && element.dataset.imageFilename === nextFilename) element.src = url;
      });
    }
  });
  root.querySelectorAll<HTMLAnchorElement>('.image-download-link').forEach((link) => {
    if (link.download === filename) link.download = nextFilename;
  });
  root.querySelectorAll<HTMLButtonElement>('[data-image-filename-editor]').forEach((button) => {
    if (button.textContent?.trim() !== filename) return;
    button.textContent = nextFilename;
    button.setAttribute('aria-label', `Rename image attachment ${nextFilename}`);
  });
}
