import type { VisualDocument } from '../types';
import { serializeDocumentBytes } from '../serialization';
import { getActiveStateRuntime, type StateRuntime } from '../state';

interface PdfArtifactEntry {
  signature: Uint8Array;
  promise: Promise<Blob>;
}

export class HvyPdfArtifactCache {
  private entry: PdfArtifactEntry | null = null;

  get(document: VisualDocument, generate: (document: VisualDocument) => Promise<Blob>): Promise<Blob> {
    const signature = serializeDocumentBytes(document);
    const existing = this.entry;
    if (existing && bytesEqual(existing.signature, signature)) {
      return existing.promise;
    }

    const promise = generate(document);
    const entry = { signature, promise };
    this.entry = entry;
    void promise.catch(() => {
      if (this.entry === entry) {
        this.entry = null;
      }
    });
    return promise;
  }

  invalidate(document: VisualDocument): void {
    if (this.entry && bytesEqual(this.entry.signature, serializeDocumentBytes(document))) {
      this.entry = null;
    }
  }
}

let standaloneArtifactCache = new HvyPdfArtifactCache();
const artifactCachesByRuntime = new WeakMap<StateRuntime, HvyPdfArtifactCache>();

export function getActivePdfArtifactCache(): HvyPdfArtifactCache {
  let runtime: StateRuntime;
  try {
    runtime = getActiveStateRuntime();
  } catch {
    return standaloneArtifactCache;
  }
  let cache = artifactCachesByRuntime.get(runtime);
  if (!cache) {
    cache = new HvyPdfArtifactCache();
    artifactCachesByRuntime.set(runtime, cache);
  }
  return cache;
}

export function releasePdfArtifactCache(runtime: StateRuntime): void {
  artifactCachesByRuntime.delete(runtime);
}

export function resetStandalonePdfArtifactCacheForTests(): void {
  standaloneArtifactCache = new HvyPdfArtifactCache();
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}
