export type HvyHistoryArtifactKind = 'sqlite-checkpoint';

export interface HvyHistoryArtifactPutRequest {
  kind: HvyHistoryArtifactKind;
  bytes: Uint8Array;
  reason: string;
  namespace: string;
}

export interface HvyHistoryArtifactStored {
  id: string;
}

export interface HvyHistoryArtifactStore {
  put(request: HvyHistoryArtifactPutRequest): Promise<HvyHistoryArtifactStored>;
  get(id: string): Promise<Uint8Array | Blob | ArrayBuffer | null>;
  remove(id: string): Promise<void>;
}

export interface HvyHistoryArtifactReference {
  id: string;
  kind: HvyHistoryArtifactKind;
  byteLength: number;
  checksum: string;
}

export class InMemoryHvyHistoryArtifactStore implements HvyHistoryArtifactStore {
  private readonly artifacts = new Map<string, Uint8Array>();

  async put(request: HvyHistoryArtifactPutRequest): Promise<HvyHistoryArtifactStored> {
    const id = `${request.namespace}:${crypto.randomUUID()}`;
    this.artifacts.set(id, Uint8Array.from(request.bytes));
    return { id };
  }

  async get(id: string): Promise<Uint8Array | null> {
    const bytes = this.artifacts.get(id);
    return bytes ? Uint8Array.from(bytes) : null;
  }

  async remove(id: string): Promise<void> {
    this.artifacts.delete(id);
  }

  get size(): number {
    return this.artifacts.size;
  }
}

export async function storeHvyHistoryArtifact(
  store: HvyHistoryArtifactStore,
  request: HvyHistoryArtifactPutRequest
): Promise<HvyHistoryArtifactReference> {
  const bytes = Uint8Array.from(request.bytes);
  const checksum = await checksumHvyHistoryBytes(bytes);
  const stored = await store.put({ ...request, bytes });
  if (!stored.id.trim()) throw new Error('History artifact storage returned an empty id.');
  return {
    id: stored.id,
    kind: request.kind,
    byteLength: bytes.length,
    checksum,
  };
}

export async function recallHvyHistoryArtifact(
  store: HvyHistoryArtifactStore,
  reference: HvyHistoryArtifactReference
): Promise<Uint8Array> {
  const value = await store.get(reference.id);
  if (value === null) throw new Error(`History artifact "${reference.id}" is unavailable.`);
  const bytes = await normalizeHistoryArtifactBytes(value);
  if (bytes.length !== reference.byteLength) {
    throw new Error(`History artifact "${reference.id}" has an unexpected length.`);
  }
  if (await checksumHvyHistoryBytes(bytes) !== reference.checksum) {
    throw new Error(`History artifact "${reference.id}" failed its integrity check.`);
  }
  return bytes;
}

async function normalizeHistoryArtifactBytes(value: Uint8Array | Blob | ArrayBuffer): Promise<Uint8Array> {
  if (value instanceof Uint8Array) return Uint8Array.from(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  return new Uint8Array(await value.arrayBuffer());
}

async function checksumHvyHistoryBytes(bytes: Uint8Array): Promise<string> {
  const digestInput = Uint8Array.from(bytes).buffer;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', digestInput));
  return Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('');
}
