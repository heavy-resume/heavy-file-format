export * from './reader';
export { instantiateReusableBlockFromDocument } from './document-templates';
export { serializeDocument } from './serialization';
export type {
  HvyDocumentSerializerAdapter,
  HvyDocumentSerializerRequest,
} from './document-byte-serialization';

import {
  serializeDocumentBytesAsync as serializeDocumentContentBytesAsync,
  type HvyDocumentSerializerAdapter,
} from './document-byte-serialization';
import { encryptDocumentBytes, getEncryptionKey, type HvyEncryptionOptions } from './encryption';
import type { VisualDocument } from './types';

export interface SerializeDocumentBytesOptions {
  encryption?: HvyEncryptionOptions | null;
  serializer?: HvyDocumentSerializerAdapter | null;
}

/** Serializes attachments, re-encrypts unlocked components, and preserves document encryption. */
export async function serializeDocumentBytesAsync(
  document: VisualDocument,
  options: SerializeDocumentBytesOptions = {}
): Promise<Uint8Array> {
  const encryption = options.encryption ?? null;
  const bytes = await serializeDocumentContentBytesAsync(
    document,
    options.serializer ?? null,
    { encryption },
  );
  if (document.encryption?.encrypted !== true || document.encryption.algorithm !== 'fernet') {
    return bytes;
  }
  const key = getEncryptionKey(encryption, document.encryption.keyId);
  if (!key) {
    throw new Error(`Missing Fernet key for encrypted HVY document: ${document.encryption.keyId}`);
  }
  return (await encryptDocumentBytes(bytes, {
    keyId: document.encryption.keyId,
    key,
  })).bytes;
}
