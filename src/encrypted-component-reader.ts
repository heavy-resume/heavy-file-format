import { getAttachment } from './attachments';
import type { VisualBlock } from './editor/types';
import { fernetDecryptBytes, getEncryptionKey, type HvyEncryptionOptions } from './encryption';
import { deserializeDocumentWithDiagnostics } from './serialization';
import type { VisualDocument } from './types';

export const ENCRYPTED_ATTACHMENT_PREFIX = 'encrypted:';

/** Decrypts readable encrypted components without executing their content. */
export async function decryptEncryptedComponents(
  document: VisualDocument,
  options: HvyEncryptionOptions | null | undefined
): Promise<boolean> {
  const tasks: Promise<void>[] = [];
  let touched = false;
  visitDocumentBlocks(document, (block) => {
    if (block.schema.kind !== 'encrypted') {
      return;
    }
    touched = true;
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
  return touched;
}

export function getEncryptedAttachmentId(keyId: string): string {
  return `${ENCRYPTED_ATTACHMENT_PREFIX}${keyId.trim()}`;
}

export async function decryptEncryptedBlock(document: VisualDocument, block: VisualBlock, key: string): Promise<void> {
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
  for (const section of document.sections) {
    visitBlocks(section.blocks);
  }
}
