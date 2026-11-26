import { ensureDocumentAttachmentStore } from './attachment-store';
import type { HvyAttachmentDescriptor } from './attachment-store';
import { prepareEncryptedComponentsForSerialization } from './encrypted-component-writer';
import type { HvyEncryptionOptions } from './encryption';
import { serializeDocument, serializeDocumentBytes } from './serialization';
import type { VisualDocument } from './types';

export type MaybePromise<T> = T | Promise<T>;

export interface HvyDocumentSerializerRequest {
  textBody: string;
  tail: HvyAttachmentDescriptor[];
  recallAttachment(id: string): MaybePromise<Uint8Array | null>;
}

export interface HvyDocumentSerializerAdapter {
  serializeDocumentBytes(request: HvyDocumentSerializerRequest): MaybePromise<Uint8Array>;
}

export async function serializeDocumentBytesAsync(
  document: VisualDocument,
  serializer?: HvyDocumentSerializerAdapter | null,
  options?: { encryption?: HvyEncryptionOptions | null }
): Promise<Uint8Array> {
  await prepareEncryptedComponentsForSerialization(document, options?.encryption ?? null);
  if (!serializer) {
    return serializeDocumentBytes(document);
  }
  const store = ensureDocumentAttachmentStore(document);
  const textBody = serializeDocument(document);
  return serializer.serializeDocumentBytes({
    textBody,
    tail: store.listDescriptors(),
    recallAttachment(id) {
      return store.get(id)?.bytes ?? null;
    },
  });
}
