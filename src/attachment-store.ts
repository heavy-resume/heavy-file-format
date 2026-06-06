import type { JsonObject } from './hvy/types';
import type { DocumentAttachment, VisualDocument } from './types';

export type MaybePromise<T> = T | Promise<T>;

export interface HvyAttachmentDescriptor {
  id: string;
  meta: JsonObject;
  length: number;
}

export interface HvyAttachmentHostAdapter {
  list(): MaybePromise<HvyAttachmentDescriptor[]>;
  recall(id: string): MaybePromise<Uint8Array | Blob | ArrayBuffer | null>;
  store(id: string, bytes: Uint8Array, meta: JsonObject): MaybePromise<void | HvyAttachmentDescriptor>;
  remove(id: string): MaybePromise<void>;
  resolveUrl?(id: string): MaybePromise<string | null>;
}

export interface AttachmentStoreEntry {
  id: string;
  meta: JsonObject;
  length: number;
  bytes?: Uint8Array;
  source?: {
    bytes: Uint8Array;
    offset: number;
    length: number;
  };
}

export class AttachmentStore {
  private entries: AttachmentStoreEntry[] = [];
  private index = new Map<string, AttachmentStoreEntry>();
  private version = 0;

  constructor(entries: AttachmentStoreEntry[] = []) {
    entries.forEach((entry) => this.setEntry(entry));
  }

  getVersion(): number {
    return this.version;
  }

  get(id: string): DocumentAttachment | null {
    const entry = this.index.get(id);
    if (!entry) {
      return null;
    }
    return {
      id: entry.id,
      meta: entry.meta,
      bytes: materializeAttachmentEntryBytes(entry),
    };
  }

  getDescriptor(id: string): HvyAttachmentDescriptor | null {
    const entry = this.index.get(id);
    return entry ? descriptorFromEntry(entry) : null;
  }

  list(): DocumentAttachment[] {
    return this.entries.map((entry) => ({
      id: entry.id,
      meta: entry.meta,
      bytes: materializeAttachmentEntryBytes(entry),
    }));
  }

  listDescriptors(): HvyAttachmentDescriptor[] {
    return this.entries.map((entry) => descriptorFromEntry(entry));
  }

  set(id: string, meta: JsonObject, bytes: Uint8Array): void {
    this.setEntry({ id, meta, length: bytes.length, bytes });
  }

  setDescriptor(descriptor: HvyAttachmentDescriptor): void {
    this.setEntry({ id: descriptor.id, meta: descriptor.meta, length: descriptor.length });
  }

  remove(id: string): void {
    const entry = this.index.get(id);
    if (!entry) {
      return;
    }
    this.entries = this.entries.filter((candidate) => candidate !== entry);
    this.index.delete(id);
    this.version += 1;
  }

  replace(attachments: DocumentAttachment[]): void {
    this.entries = [];
    this.index.clear();
    attachments.forEach((attachment) => {
      this.entries.push({
        id: attachment.id,
        meta: attachment.meta,
        length: attachment.bytes.length,
        bytes: attachment.bytes,
      });
    });
    this.rebuildIndex();
    this.version += 1;
  }

  private setEntry(entry: AttachmentStoreEntry): void {
    const next = normalizeAttachmentStoreEntry(entry);
    const existing = this.index.get(next.id);
    if (existing) {
      const entryIndex = this.entries.indexOf(existing);
      if (entryIndex >= 0) {
        this.entries[entryIndex] = next;
      }
    } else {
      this.entries.push(next);
    }
    this.index.set(next.id, next);
    this.version += 1;
  }

  private rebuildIndex(): void {
    this.index.clear();
    this.entries.forEach((entry) => {
      this.index.set(entry.id, entry);
    });
  }
}

export function createAttachmentStore(attachments: DocumentAttachment[] = []): AttachmentStore {
  return new AttachmentStore(attachments.map((attachment) => ({
    id: attachment.id,
    meta: attachment.meta,
    length: attachment.bytes.length,
    bytes: attachment.bytes,
  })));
}

export function createLazyAttachmentStore(entries: AttachmentStoreEntry[]): AttachmentStore {
  return new AttachmentStore(entries);
}

export function ensureDocumentAttachmentStore(document: VisualDocument): AttachmentStore {
  if (document.attachmentStore) {
    return document.attachmentStore;
  }
  const sourceAttachments = Array.isArray(document.attachments) ? document.attachments : [];
  const store = createAttachmentStore(sourceAttachments);
  attachStoreToDocument(document, store);
  return store;
}

export function attachStoreToDocument(document: VisualDocument, store: AttachmentStore): void {
  Object.defineProperty(document, 'attachmentStore', {
    configurable: true,
    enumerable: false,
    writable: true,
    value: store,
  });
  Object.defineProperty(document, 'attachments', {
    configurable: true,
    enumerable: true,
    get() {
      return store.list();
    },
    set(value: DocumentAttachment[]) {
      store.replace(Array.isArray(value) ? value : []);
    },
  });
}

export function getAttachmentDescriptors(document: VisualDocument): HvyAttachmentDescriptor[] {
  return ensureDocumentAttachmentStore(document).listDescriptors();
}

export function normalizeAttachmentBytes(value: Uint8Array | Blob | ArrayBuffer): MaybePromise<Uint8Array> {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  return value.arrayBuffer().then((buffer) => new Uint8Array(buffer));
}

export function hydrateHostAttachmentDescriptorsSync(
  document: VisualDocument,
  host: HvyAttachmentHostAdapter | null | undefined
): void {
  if (!host) {
    return;
  }
  const descriptors = host.list();
  if (!Array.isArray(descriptors)) {
    return;
  }
  const store = ensureDocumentAttachmentStore(document);
  for (const descriptor of descriptors) {
    if (!store.getDescriptor(descriptor.id)) {
      store.setDescriptor(descriptor);
    }
  }
}

function normalizeAttachmentStoreEntry(entry: AttachmentStoreEntry): AttachmentStoreEntry {
  const length = Math.max(0, Math.floor(entry.length));
  return {
    id: entry.id,
    meta: entry.meta,
    length,
    ...(entry.bytes ? { bytes: entry.bytes } : {}),
    ...(entry.source ? { source: { ...entry.source, length } } : {}),
  };
}

function descriptorFromEntry(entry: AttachmentStoreEntry): HvyAttachmentDescriptor {
  return {
    id: entry.id,
    meta: entry.meta,
    length: entry.bytes ? entry.bytes.length : entry.length,
  };
}

function materializeAttachmentEntryBytes(entry: AttachmentStoreEntry): Uint8Array {
  if (entry.bytes) {
    return entry.bytes;
  }
  if (!entry.source) {
    return new Uint8Array();
  }
  entry.bytes = entry.source.bytes.slice(entry.source.offset, entry.source.offset + entry.source.length);
  entry.length = entry.bytes.length;
  return entry.bytes;
}
