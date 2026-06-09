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

export async function serializeMountedDocumentBytesAsync(
  document: VisualDocument,
  host: HvyAttachmentHostAdapter | null | undefined,
  serializer: HvyDocumentSerializerAdapter | null | undefined
): Promise<Uint8Array> {
  if (!host && !serializer) {
    return serializeDocumentBytesAsync(document);
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
    return serializer.serializeDocumentBytes({ textBody, tail, recallAttachment });
  }
  return serializeStandardDocumentBytes(textBody, tail, recallAttachment);
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
