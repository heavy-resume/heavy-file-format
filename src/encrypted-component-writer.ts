import { setAttachment } from './attachments';
import { visitBlocks } from './block-traversal';
import { fernetEncryptBytes, getEncryptionKey, type HvyEncryptionOptions } from './encryption';
import { getEncryptedAttachmentId } from './encrypted-component-reader';
import { serializeBlockFragment } from './serialization';
import type { VisualDocument } from './types';

/** Re-encrypts every unlocked encrypted component without executing its contents. */
export async function prepareEncryptedComponentsForSerialization(
  document: VisualDocument,
  options: HvyEncryptionOptions | null | undefined
): Promise<void> {
  const tasks: Promise<void>[] = [];
  visitBlocks(document.sections, (block) => {
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
