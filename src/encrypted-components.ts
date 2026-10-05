import { removeAttachment, setAttachment } from './attachments';
import type { VisualBlock } from './editor/types';
import { fernetEncryptBytes, forgetEncryptionKey, generateEncryptionKey, getEncryptionKey, rememberEncryptionKey, type HvyEncryptionOptions, type HvyGeneratedEncryptionKey } from './encryption';
import { createEmptyBlock } from './document-factory';
import { findBlockContainerById, replaceBlockById } from './section-ops';
import { serializeBlockFragment } from './serialization';
import type { VisualDocument } from './types';
import { decryptEncryptedBlock, getEncryptedAttachmentId } from './encrypted-component-reader';
export { decryptEncryptedComponents, getEncryptedAttachmentId } from './encrypted-component-reader';

export interface HvyEncryptedComponentResult extends HvyGeneratedEncryptionKey {
  attachmentId: string;
  encryptedBlockId: string;
}

export async function prepareEncryptedComponentsForSerialization(
  document: VisualDocument,
  options: HvyEncryptionOptions | null | undefined
): Promise<void> {
  const tasks: Promise<void>[] = [];
  visitDocumentBlocks(document, (block) => {
    if (block.schema.kind !== 'encrypted' || !block.schema.encryptedBlock) {
      return;
    }
    const keyId = block.schema.keyId.trim();
    const key = getEncryptionKey(options, keyId);
    if (!key) {
      throw new Error(`Missing Fernet key for encrypted component: ${keyId}`);
    }
    tasks.push((async () => {
      const fragment = serializeBlockFragment(block.schema.encryptedBlock!, document.meta);
      const tokenBytes = await fernetEncryptBytes(new TextEncoder().encode(fragment), key);
      setAttachment(document, getEncryptedAttachmentId(keyId), { mediaType: 'application/vnd.hvy.encrypted-component+fernet' }, tokenBytes);
      block.schema.encryptedDirty = false;
      block.schema.encryptedError = '';
    })());
  });
  await Promise.all(tasks);
}

export async function encryptComponentInDocument(
  document: VisualDocument,
  sectionKey: string,
  blockId: string,
  options: HvyEncryptionOptions | null | undefined
): Promise<HvyEncryptedComponentResult> {
  const location = findBlockContainerById(document.sections, sectionKey, blockId);
  const block = location?.container[location.index] ?? null;
  if (!location || !block || block.schema.kind === 'encrypted') {
    throw new Error('Component could not be encrypted.');
  }
  const generated = generateEncryptionKey();
  const keyId = options?.keyId?.trim() || generated.keyId;
  const key = options?.key?.trim() || getEncryptionKey(options, keyId) || generated.key;
  const attachmentId = getEncryptedAttachmentId(keyId);
  const fragment = serializeBlockFragment(block, document.meta);
  const tokenBytes = await fernetEncryptBytes(new TextEncoder().encode(fragment), key);
  setAttachment(document, attachmentId, { mediaType: 'application/vnd.hvy.encrypted-component+fernet' }, tokenBytes);
  const encryptedBlock = createEmptyBlock('encrypted');
  encryptedBlock.schema.keyId = keyId;
  encryptedBlock.schema.encryptedAttachmentId = attachmentId;
  encryptedBlock.schema.encryptedBlock = block;
  encryptedBlock.schema.encryptedDirty = false;
  if (!replaceBlockById(document.sections, sectionKey, blockId, encryptedBlock)) {
    throw new Error('Component could not be encrypted.');
  }
  rememberEncryptionKey(options, { keyId, key });
  return { keyId, key, attachmentId, encryptedBlockId: encryptedBlock.id };
}

export async function changeEncryptedComponentKeyInDocument(
  document: VisualDocument,
  sectionKey: string,
  blockId: string,
  options: HvyEncryptionOptions | null | undefined
): Promise<HvyEncryptedComponentResult> {
  const location = findBlockContainerById(document.sections, sectionKey, blockId);
  const block = location?.container[location.index] ?? null;
  if (!block || block.schema.kind !== 'encrypted' || !block.schema.encryptedBlock) {
    throw new Error('Encrypted component must be unlocked before its key can be changed.');
  }
  const previousKeyId = block.schema.keyId;
  const previousAttachmentId = block.schema.encryptedAttachmentId || getEncryptedAttachmentId(previousKeyId);
  const generated = generateEncryptionKey();
  const attachmentId = getEncryptedAttachmentId(generated.keyId);
  const fragment = serializeBlockFragment(block.schema.encryptedBlock, document.meta);
  const tokenBytes = await fernetEncryptBytes(new TextEncoder().encode(fragment), generated.key);
  setAttachment(document, attachmentId, { mediaType: 'application/vnd.hvy.encrypted-component+fernet' }, tokenBytes);
  block.schema.keyId = generated.keyId;
  block.schema.encryptedAttachmentId = attachmentId;
  block.schema.encryptedDirty = false;
  block.schema.encryptedError = '';
  rememberEncryptionKey(options, generated);
  removeAttachment(document, previousAttachmentId);
  forgetEncryptionKey(options, previousKeyId);
  return { ...generated, attachmentId, encryptedBlockId: block.id };
}

export async function decryptComponentInDocument(
  document: VisualDocument,
  sectionKey: string,
  blockId: string,
  options: HvyEncryptionOptions | null | undefined
): Promise<void> {
  const location = findBlockContainerById(document.sections, sectionKey, blockId);
  const block = location?.container[location.index] ?? null;
  if (!location || !block || block.schema.kind !== 'encrypted') {
    return;
  }
  const previousKeyId = block.schema.keyId;
  const previousAttachmentId = block.schema.encryptedAttachmentId || getEncryptedAttachmentId(previousKeyId);
  const key = getEncryptionKey(options, block.schema.keyId);
  if (!key) {
    throw new Error(`Missing Fernet key for encrypted component: ${block.schema.keyId}`);
  }
  await decryptEncryptedBlock(document, block, key);
  if (block.schema.encryptedBlock) {
    if (!replaceBlockById(document.sections, sectionKey, blockId, block.schema.encryptedBlock)) {
      throw new Error('Component encryption could not be removed.');
    }
    removeAttachment(document, previousAttachmentId);
    forgetEncryptionKey(options, previousKeyId);
  }
}

function visitDocumentBlocks(document: VisualDocument, visitor: (block: VisualBlock) => void): void {
  for (const section of document.sections) {
    const visitBlocks = (blocks: VisualBlock[]): void => {
      for (const block of blocks) {
        visitor(block);
        visitBlocks(block.schema.containerBlocks ?? []);
        visitBlocks(block.schema.componentListBlocks ?? []);
        visitBlocks(block.schema.expandableStubBlocks?.children ?? []);
        visitBlocks(block.schema.expandableContentBlocks?.children ?? []);
        for (const item of block.schema.gridItems ?? []) {
          visitBlocks([item.block]);
        }
        if (block.schema.kind === 'encrypted' && block.schema.encryptedBlock) {
          visitBlocks([block.schema.encryptedBlock]);
        }
      }
    };
    visitBlocks(section.blocks);
  }
}
