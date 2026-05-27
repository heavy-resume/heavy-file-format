import { cloneReusableBlock, cloneReusableSection } from './document-factory';
import { getImageAttachmentId, setAttachment } from './attachments';
import type { VisualBlock, VisualSection } from './editor/types';
import type { DocumentAttachment, HvyEditorClipboardHost, HvyEditorClipboardPayload, VisualDocument } from './types';

let editorClipboard: HvyEditorClipboardPayload | null = null;
let editorClipboardHost: HvyEditorClipboardHost | null = null;

export function setEditorClipboardHost(host: HvyEditorClipboardHost | null): void {
  editorClipboardHost = host;
}

export function copyComponentToEditorClipboard(
  block: VisualBlock,
  attachments: DocumentAttachment[] = [],
  options: { unwrapIntoEmptyContainer?: boolean } = {}
): void {
  writeEditorClipboard({
    kind: 'component',
    block: cloneReusableBlock(block),
    attachments: cloneAttachments(attachments),
    ...(options.unwrapIntoEmptyContainer ? { pasteBehavior: { unwrapIntoEmptyContainer: true } } : {}),
  });
}

export function copySectionToEditorClipboard(section: VisualSection, attachments: DocumentAttachment[] = []): void {
  writeEditorClipboard({
    kind: 'section',
    section: cloneReusableSection(section),
    attachments: cloneAttachments(attachments),
  });
}

export function hasComponentInEditorClipboard(): boolean {
  return readEditorClipboard()?.kind === 'component';
}

export function hasSectionInEditorClipboard(): boolean {
  return readEditorClipboard()?.kind === 'section';
}

export function cloneComponentFromEditorClipboard(): VisualBlock | null {
  return cloneComponentClipboardEntry()?.block ?? null;
}

export function cloneComponentClipboardEntry(): { block: VisualBlock; unwrapIntoEmptyContainer: boolean } | null {
  const clipboard = readEditorClipboard();
  return clipboard?.kind === 'component'
    ? {
        block: cloneReusableBlock(clipboard.block),
        unwrapIntoEmptyContainer: clipboard.pasteBehavior?.unwrapIntoEmptyContainer === true,
      }
    : null;
}

export function cloneAttachmentsFromEditorClipboard(): DocumentAttachment[] {
  return cloneAttachments(readEditorClipboard()?.attachments ?? []);
}

export function collectBlockAttachments(document: VisualDocument, block: VisualBlock): DocumentAttachment[] {
  const attachmentIds = new Set<string>();
  collectBlockAttachmentIds(block, attachmentIds);
  return document.attachments.filter((attachment) => attachmentIds.has(attachment.id));
}

export function collectSectionAttachments(document: VisualDocument, section: VisualSection): DocumentAttachment[] {
  const attachmentIds = new Set<string>();
  collectSectionAttachmentIds(section, attachmentIds);
  return document.attachments.filter((attachment) => attachmentIds.has(attachment.id));
}

export function installEditorClipboardAttachments(document: VisualDocument): void {
  cloneAttachmentsFromEditorClipboard().forEach((attachment) => {
    setAttachment(document, attachment.id, attachment.meta, attachment.bytes);
  });
}

export function cloneSectionFromEditorClipboard(targetLevel?: number): VisualSection | null {
  const clipboard = readEditorClipboard();
  return clipboard?.kind === 'section'
    ? cloneReusableSection(clipboard.section, targetLevel ?? clipboard.section.level)
    : null;
}

function readEditorClipboard(): HvyEditorClipboardPayload | null {
  return editorClipboardHost?.read() ?? editorClipboard;
}

function writeEditorClipboard(payload: HvyEditorClipboardPayload): void {
  if (editorClipboardHost) {
    editorClipboardHost.write(payload);
    return;
  }
  editorClipboard = payload;
}

function cloneAttachments(attachments: DocumentAttachment[]): DocumentAttachment[] {
  return attachments.map((attachment) => ({
    id: attachment.id,
    meta: { ...attachment.meta },
    bytes: Uint8Array.from(attachment.bytes),
  }));
}

function collectSectionAttachmentIds(section: VisualSection, attachmentIds: Set<string>): void {
  section.blocks.forEach((block) => collectBlockAttachmentIds(block, attachmentIds));
  section.children.forEach((child) => collectSectionAttachmentIds(child, attachmentIds));
}

function collectBlockAttachmentIds(block: VisualBlock, attachmentIds: Set<string>): void {
  const imageFile = typeof block.schema.imageFile === 'string' ? block.schema.imageFile.trim() : '';
  if (imageFile) {
    attachmentIds.add(getImageAttachmentId(imageFile));
  }
  (block.schema.carouselImages ?? []).forEach((image) => {
    if (image.imageFile.trim()) {
      attachmentIds.add(getImageAttachmentId(image.imageFile.trim()));
    }
  });
  (block.schema.containerBlocks ?? []).forEach((child) => collectBlockAttachmentIds(child, attachmentIds));
  (block.schema.componentListBlocks ?? []).forEach((child) => collectBlockAttachmentIds(child, attachmentIds));
  (block.schema.expandableStubBlocks?.children ?? []).forEach((child) => collectBlockAttachmentIds(child, attachmentIds));
  (block.schema.expandableContentBlocks?.children ?? []).forEach((child) => collectBlockAttachmentIds(child, attachmentIds));
  (block.schema.gridItems ?? []).forEach((item) => collectBlockAttachmentIds(item.block, attachmentIds));
}
