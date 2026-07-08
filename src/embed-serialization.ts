import {
  serializeDocument,
  serializeDocumentBytesAsync,
  type HvyDocumentSerializerAdapter,
} from './serialization';
import {
  ensureDocumentAttachmentStore,
  normalizeAttachmentBytes,
  type HvyAttachmentDescriptor,
  type HvyAttachmentHostAdapter,
} from './attachment-store';
import type { VisualDocument } from './types';
import { encryptDocumentBytes, getEncryptionKey, type HvyEncryptionOptions } from './encryption';
import { prepareEncryptedComponentsForSerialization } from './encrypted-components';
import { persistPreparedEmbeddingAttachments } from './chat/embedding-context';

export async function serializeMountedDocumentBytesAsync(
  document: VisualDocument,
  host: HvyAttachmentHostAdapter | null | undefined,
  serializer: HvyDocumentSerializerAdapter | null | undefined,
  encryption?: HvyEncryptionOptions | null
): Promise<Uint8Array> {
  await persistPreparedEmbeddingAttachments(document, host);
  await prepareEncryptedComponentsForSerialization(document, encryption ?? null);
  if (!host && !serializer) {
    return maybeEncryptMountedDocument(document, await serializeDocumentBytesAsync(document, null, { encryption }), encryption ?? null);
  }
  const store = ensureDocumentAttachmentStore(document);
  if (host) {
    for (const descriptor of await host.list()) {
      if (!store.getDescriptor(descriptor.id)) {
        store.setDescriptor(descriptor);
      }
    }
  }
  const tail = mergeAttachmentDescriptors(store.listDescriptors(), []);
  const textBody = serializeDocument(document);
  const recallAttachment = async (id: string): Promise<Uint8Array | null> => {
    const local = store.get(id);
    if (local && local.bytes.length > 0) {
      return local.bytes;
    }
    if (!host) {
      return local?.bytes ?? null;
    }
    const recalled = await host.recall(id);
    return recalled ? await normalizeAttachmentBytes(recalled) : null;
  };
  if (serializer) {
    return maybeEncryptMountedDocument(document, await serializer.serializeDocumentBytes({ textBody, tail, recallAttachment }), encryption ?? null);
  }
  return maybeEncryptMountedDocument(document, await serializeStandardDocumentBytes(textBody, tail, recallAttachment), encryption ?? null);
}

async function maybeEncryptMountedDocument(document: VisualDocument, bytes: Uint8Array, encryption: HvyEncryptionOptions | null): Promise<Uint8Array> {
  if (document.encryption?.encrypted !== true || document.encryption.algorithm !== 'fernet') {
    return bytes;
  }
  const key = getEncryptionKey(encryption, document.encryption.keyId);
  if (key) {
    return (await encryptDocumentBytes(bytes, { keyId: document.encryption.keyId, key })).bytes;
  }
  throw new Error(`Missing Fernet key for encrypted HVY document: ${document.encryption.keyId}`);
}

function mergeAttachmentDescriptors(
  local: HvyAttachmentDescriptor[],
  external: HvyAttachmentDescriptor[]
): HvyAttachmentDescriptor[] {
  const merged = new Map<string, HvyAttachmentDescriptor>();
  local.forEach((descriptor) => merged.set(descriptor.id, descriptor));
  external.forEach((descriptor) => merged.set(descriptor.id, descriptor));
  return [...merged.values()];
}

async function serializeStandardDocumentBytes(
  textBody: string,
  tail: HvyAttachmentDescriptor[],
  recallAttachment: (id: string) => Promise<Uint8Array | null>
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const textBytes = encoder.encode(textBody);
  const payloads = await Promise.all(tail.map((descriptor) => recallAttachment(descriptor.id)));
  const totalPayloadLength = payloads.reduce((sum, bytes) => sum + (bytes?.length ?? 0), 0);
  if (totalPayloadLength === 0) {
    return textBytes;
  }
  const combined = new Uint8Array(textBytes.length + totalPayloadLength);
  combined.set(textBytes, 0);
  let offset = textBytes.length;
  for (const bytes of payloads) {
    if (!bytes) {
      continue;
    }
    combined.set(bytes, offset);
    offset += bytes.length;
  }
  return combined;
}
