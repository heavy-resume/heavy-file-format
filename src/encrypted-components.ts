import { getAttachment, setAttachment } from './attachments';
import type { VisualBlock } from './editor/types';
import { fernetDecryptBytes, fernetEncryptBytes, generateEncryptionKey, getEncryptionKey, rememberEncryptionKey, type HvyEncryptionOptions, type HvyGeneratedEncryptionKey } from './encryption';
import { createEmptyBlock } from './document-factory';
import { findBlockContainerById } from './section-ops';
import { deserializeDocumentWithDiagnostics, serializeBlockFragment } from './serialization';
import type { VisualDocument } from './types';

export const ENCRYPTED_ATTACHMENT_PREFIX = 'encrypted:';

export interface HvyEncryptedComponentResult extends HvyGeneratedEncryptionKey {
  attachmentId: string;
}

export async function decryptEncryptedComponents(document: VisualDocument, options: HvyEncryptionOptions | null | undefined): Promise<void> {
  const tasks: Promise<void>[] = [];
  visitDocumentBlocks(document, (block) => {
    if (block.schema.kind !== 'encrypted') {
      return;
    }
    const keyId = block.schema.keyId.trim();
    const key = getEncryptionKey(options, keyId);
    if (!key) {
      block.schema.encryptedBlock = null;
      block.schema.encryptedError = keyId ? `Missing key ${keyId}` : 'Missing key id';
      return;
    }
    tasks.push(decryptEncryptedBlock(document, block, key));
  });
  await Promise.all(tasks);
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
  location.container[location.index] = encryptedBlock;
  rememberEncryptionKey(options, { keyId, key });
  return { keyId, key, attachmentId };
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
  const key = getEncryptionKey(options, block.schema.keyId);
  if (!key) {
    throw new Error(`Missing Fernet key for encrypted component: ${block.schema.keyId}`);
  }
  await decryptEncryptedBlock(document, block, key);
  if (block.schema.encryptedBlock) {
    location.container[location.index] = block.schema.encryptedBlock;
  }
}

export function getEncryptedAttachmentId(keyId: string): string {
  return `${ENCRYPTED_ATTACHMENT_PREFIX}${keyId.trim()}`;
}

async function decryptEncryptedBlock(document: VisualDocument, block: VisualBlock, key: string): Promise<void> {
  if (block.schema.encryptedBlock && !block.schema.encryptedDirty) {
    return;
  }
  const attachmentId = block.schema.encryptedAttachmentId || getEncryptedAttachmentId(block.schema.keyId);
  const attachment = getAttachment(document, attachmentId);
  if (!attachment || attachment.bytes.length === 0) {
    block.schema.encryptedBlock = null;
    block.schema.encryptedError = `Missing encrypted attachment ${attachmentId}`;
    return;
  }
  try {
    const fragment = new TextDecoder().decode(await fernetDecryptBytes(attachment.bytes, key));
    const parsed = deserializeDocumentWithDiagnostics(`---
hvy_version: 0.1
---

<!--hvy: {"id":"encrypted-fragment"}-->
#! Encrypted Fragment

${fragment}
`, document.extension);
    const decrypted = parsed.document.sections[0]?.blocks[0] ?? null;
    block.schema.encryptedBlock = decrypted;
    block.schema.encryptedError = '';
  } catch (error) {
    block.schema.encryptedBlock = null;
    block.schema.encryptedError = error instanceof Error ? error.message : 'Encrypted component could not be decrypted.';
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
