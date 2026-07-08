import { getAttachment, setAttachment } from '../attachments';
import { ensureDocumentAttachmentStore, type HvyAttachmentHostAdapter } from '../attachment-store';
import { getDocumentAiContext } from '../document-ai-context';
import { buildSemanticRetrievalChunks } from '../search/semantic-candidates';
import type { HvyDocumentSearchDocument, HvyDocumentSearchResult } from '../search/types';
import type {
  HvyChatContextOptions,
  HvyChatContextPreparationProgressCallback,
  HvyChatContextRequest,
  HvyChatContextResult,
  HvyChatEvidence,
  HvyChatSearchIndexRecord,
  HvyEmbeddingProvider,
  HvyEmbeddingProviderRequest,
  HvyEmbeddingVector,
  VisualDocument,
} from '../types';

const DEFAULT_MAX_RESULTS = 12;
const DEFAULT_EMBEDDING_BATCH_SIZE = 8;
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-ada-002';
const MAX_RECORD_TEXT_CHARS = 2_000;
const EMBEDDING_ATTACHMENT_MEDIA_TYPE = 'application/vnd.hvy.embedding-index';
const EMBEDDING_INDEX_VERSION = 1;
const EMBEDDING_INDEX_MAGIC = 'HVYEIDX1';
const EMBEDDING_INDEX_HEADER_SIZE = 24;

interface EmbeddingRecord extends HvyChatSearchIndexRecord {
  embeddingText: string;
  textHash: string;
}

interface RuntimeEmbeddingIndex {
  profile: EmbeddingIndexProfile;
  documentRevision: number;
  records: EmbeddingRecord[];
  vectors: Map<string, number[]>;
  textHashes: Map<string, string>;
  persistToAttachments: boolean;
  lastBuildStats: HvyEmbeddingCacheBuildStats;
}

interface EmbeddingIndexProfile {
  model: string;
  dimensions?: number;
  fingerprint: string;
  recordsHash: string;
  attachmentId: string;
}

interface EmbeddingIndexSnapshot {
  version: 1;
  model: string;
  dimensions?: number;
  fingerprint: string;
  recordsHash: string;
  entries: Array<HvyEmbeddingVector & { textHash: string; chunk?: HvyEmbeddingIndexChunk }>;
}

interface EmbeddingSearchResult {
  record: EmbeddingRecord;
  score: number;
}

export interface HvyEmbeddingCacheBuildStats {
  totalChunks: number;
  reusedChunks: number;
  rebuiltChunks: number;
  missingVectors: number;
  alreadyPrepared: boolean;
}

export interface HvyEmbeddingIndexVector {
  id: string;
  textHash: string;
  vector: number[];
  model: string;
  dimensions?: number;
}

export interface HvyEmbeddingIndexChunk {
  id: string;
  text: string;
  textHash: string;
  targetKind: HvyChatSearchIndexRecord['targetKind'];
  sectionKey: string;
  blockId?: string;
  targetId: string;
  targetRef?: string;
  targetPath?: string;
  label: string;
  contextLabel?: string;
  documentTitle?: string;
  documentOrder: number;
}

export interface HvyEmbeddingIndexUpdatePlan {
  model: string;
  dimensions?: number;
  chunks: HvyEmbeddingIndexChunk[];
  reused: HvyEmbeddingIndexVector[];
  inputsToEmbed: Array<{ id: string; text: string; textHash: string }>;
  stale: HvyEmbeddingIndexVector[];
  removed: HvyEmbeddingIndexVector[];
}

export interface HvyEmbeddingIndexUpdateRequest {
  document: VisualDocument;
  embeddingModel?: string;
  embeddingDimensions?: number;
  targetChunkChars?: number;
  overlapChars?: number;
  existingVectors?: HvyEmbeddingIndexVector[];
}

export interface HvySerializedEmbeddingIndex {
  attachmentId: string;
  model: string;
  dimensions?: number;
  chunks: HvyEmbeddingIndexChunk[];
  vectors: HvyEmbeddingIndexVector[];
}

export interface HvySerializedEmbeddingIndexReadOptions {
  embeddingModel?: string;
  embeddingDimensions?: number;
}

const runtimeIndexes = new WeakMap<VisualDocument, RuntimeEmbeddingIndex>();
const pendingRuntimeIndexes = new WeakMap<VisualDocument, { documentRevision: number; profileKey: string; promise: Promise<RuntimeEmbeddingIndex> }>();
const documentRevisions = new WeakMap<VisualDocument, number>();

export function markEmbeddingChatContextDocumentChanged(document: VisualDocument): void {
  documentRevisions.set(document, getEmbeddingDocumentRevision(document) + 1);
  pendingRuntimeIndexes.delete(document);
}

export function isEmbeddingChatContextPrepared(document: VisualDocument, options: HvyChatContextOptions = {}): boolean {
  const cached = runtimeIndexes.get(document);
  if (!cached) {
    return false;
  }
  const profile = buildEmbeddingIndexProfile(document, buildEmbeddingRecords(document), options);
  return cached.documentRevision === getEmbeddingDocumentRevision(document)
    && getEmbeddingProfileKey(cached.profile) === getEmbeddingProfileKey(profile);
}

export function materializePreparedEmbeddingAttachments(document: VisualDocument): void {
  const runtime = runtimeIndexes.get(document);
  if (!runtime || !runtime.persistToAttachments || document.extension !== '.hvy') {
    return;
  }
  writeEmbeddingAttachment(document, runtime);
}

export async function persistPreparedEmbeddingAttachments(
  document: VisualDocument,
  host: HvyAttachmentHostAdapter | null | undefined
): Promise<void> {
  const runtime = runtimeIndexes.get(document);
  if (!runtime || !runtime.persistToAttachments || document.extension !== '.hvy') {
    return;
  }
  if (!host) {
    writeEmbeddingAttachment(document, runtime);
    return;
  }
  const { id, meta, bytes } = buildEmbeddingAttachment(runtime);
  const descriptor = await host.store(id, bytes, meta);
  ensureDocumentAttachmentStore(document).setDescriptor(
    descriptor && typeof descriptor === 'object'
      ? descriptor
      : { id, meta, length: bytes.length }
  );
}

export async function prepareEmbeddingChatContext(
  document: VisualDocument,
  options: HvyChatContextOptions = {},
  embeddingProvider: HvyEmbeddingProvider | null = null,
  signal?: AbortSignal
): Promise<HvyEmbeddingCacheBuildStats> {
  if (!embeddingProvider) {
    throw new Error('Embedding chat context requires an embeddingProvider.');
  }
  const index = await getEmbeddingIndex(document, {
    ...options,
    persistEmbeddingsToAttachments: options.persistEmbeddingsToAttachments === true,
  }, embeddingProvider, signal);
  return index.lastBuildStats;
}

export function planEmbeddingIndexUpdate(request: HvyEmbeddingIndexUpdateRequest): HvyEmbeddingIndexUpdatePlan {
  const model = getEmbeddingModel({
    embeddingModel: request.embeddingModel,
    embeddingDimensions: request.embeddingDimensions,
    embeddingBatchSize: undefined,
  });
  const dimensions = normalizeDimensions(request.embeddingDimensions);
  const records = buildEmbeddingRecords(request.document, {
    ...(request.targetChunkChars !== undefined ? { targetChunkChars: request.targetChunkChars } : {}),
    ...(request.overlapChars !== undefined ? { overlapChars: request.overlapChars } : {}),
  });
  const chunks = records.map(recordToEmbeddingIndexChunk);
  const currentHashes = new Map(records.map((record) => [record.key, record.textHash]));
  const reused: HvyEmbeddingIndexVector[] = [];
  const stale: HvyEmbeddingIndexVector[] = [];
  const removed: HvyEmbeddingIndexVector[] = [];
  const seen = new Set<string>();
  for (const vector of request.existingVectors ?? []) {
    const vectorDimensions = normalizeDimensions(vector.dimensions);
    const matchesProfile = vector.model === model && vectorDimensions === dimensions;
    const currentHash = currentHashes.get(vector.id);
    const normalizedVector = normalizeVector(vector.vector);
    if (!currentHash) {
      removed.push(vector);
    } else if (matchesProfile && currentHash === vector.textHash && normalizedVector) {
      reused.push({
        id: vector.id,
        textHash: vector.textHash,
        vector: normalizedVector,
        model: vector.model,
        ...(vectorDimensions !== undefined ? { dimensions: vectorDimensions } : {}),
      });
      seen.add(vector.id);
    } else {
      stale.push(vector);
    }
  }
  const inputsToEmbed = records
    .filter((record) => !seen.has(record.key))
    .map((record) => ({
      id: record.key,
      text: record.embeddingText,
      textHash: record.textHash,
    }));
  return {
    model,
    ...(dimensions !== undefined ? { dimensions } : {}),
    chunks,
    reused,
    inputsToEmbed,
    stale,
    removed,
  };
}

export function readEmbeddingIndexFromDocumentBytes(
  bytes: Uint8Array,
  extension: VisualDocument['extension'],
  options: HvySerializedEmbeddingIndexReadOptions = {}
): HvySerializedEmbeddingIndex[] {
  if (extension !== '.hvy') {
    return [];
  }
  const model = options.embeddingModel?.trim();
  const dimensions = normalizeDimensions(options.embeddingDimensions);
  return readTailAttachmentSlices(bytes)
    .filter((attachment) => attachment.meta.mediaType === EMBEDDING_ATTACHMENT_MEDIA_TYPE)
    .flatMap((attachment): HvySerializedEmbeddingIndex[] => {
      try {
        const snapshot = parseEmbeddingIndexBinary(attachment.bytes);
        if (
          (model && snapshot.model !== model)
          || (dimensions !== undefined && snapshot.dimensions !== dimensions)
        ) {
          return [];
        }
        return [{
          attachmentId: attachment.id,
          model: snapshot.model,
          ...(snapshot.dimensions !== undefined ? { dimensions: snapshot.dimensions } : {}),
          chunks: snapshot.entries.flatMap((entry) => entry.chunk ? [entry.chunk] : []),
          vectors: snapshot.entries.map((entry) => ({
            id: entry.id,
            textHash: entry.textHash,
            vector: entry.vector,
            model: snapshot.model,
            ...(snapshot.dimensions !== undefined ? { dimensions: snapshot.dimensions } : {}),
          })),
        }];
      } catch {
        return [];
      }
    });
}

export async function buildEmbeddingChatContext(
  request: HvyChatContextRequest,
  options: HvyChatContextOptions = {},
  embeddingProvider: HvyEmbeddingProvider | null = null
): Promise<HvyChatContextResult> {
  if (!embeddingProvider) {
    throw new Error('Embedding chat context requires an embeddingProvider.');
  }
  const maxContextChars = Math.max(1, Math.floor(options.maxContextChars ?? request.maxContextChars));
  const maxResults = Math.max(1, Math.floor(options.maxResults ?? DEFAULT_MAX_RESULTS));
  const index = await getEmbeddingIndex(request.document, options, embeddingProvider, request.signal, request.onProgress);
  if (index.records.length === 0) {
    return packEmbeddingContext(request.document, [], maxContextChars);
  }
  const queryVector = await embedSingleText({
    provider: embeddingProvider,
    model: index.profile.model,
    text: request.question,
    ...(index.profile.dimensions !== undefined ? { dimensions: index.profile.dimensions } : {}),
    ...(request.signal ? { signal: request.signal } : {}),
  });
  throwIfAborted(request.signal);
  const minScore = typeof options.embeddingMinScore === 'number' && Number.isFinite(options.embeddingMinScore)
    ? options.embeddingMinScore
    : -1;
  const selected = rankEmbeddingRecords(index.records, index.vectors, queryVector)
    .filter((result) => result.score >= minScore)
    .slice(0, maxResults);
  return packEmbeddingContext(request.document, selected, maxContextChars);
}

export async function searchDocumentsByEmbedding(options: {
  documents: HvyDocumentSearchDocument[];
  query: string;
  embeddingProvider?: HvyEmbeddingProvider | null;
  embeddingModel?: string;
  embeddingDimensions?: number;
  embeddingBatchSize?: number;
  maxResults?: number;
  minScore?: number;
  signal?: AbortSignal;
}): Promise<HvyDocumentSearchResult[]> {
  if (!options.embeddingProvider) {
    throw new Error('Embedding document search requires an embeddingProvider.');
  }
  const query = options.query.trim();
  if (!query || options.documents.length === 0) {
    return [];
  }
  const model = getEmbeddingModel({
    embeddingModel: options.embeddingModel,
    embeddingDimensions: options.embeddingDimensions,
    embeddingBatchSize: options.embeddingBatchSize,
  });
  const dimensions = normalizeDimensions(options.embeddingDimensions);
  const batchSize = normalizeBatchSize(options.embeddingBatchSize);
  const records: Array<EmbeddingRecord & { documentId: string; documentTitle?: string; documentOffset: number }> = [];
  for (const [documentIndex, entry] of options.documents.entries()) {
    const documentId = entry.documentId.trim();
    if (!documentId) {
      continue;
    }
    const documentTitle = entry.documentTitle?.trim() || getDocumentTitle(entry.document);
    const documentRecords = buildEmbeddingRecords(entry.document);
    records.push(...documentRecords.map((record) => ({
      ...record,
      key: `document:${documentId}:${record.key}`,
      documentId,
      ...(documentTitle ? { documentTitle } : {}),
      documentOffset: documentIndex * 1_000_000,
    })));
  }
  if (records.length === 0) {
    return [];
  }
  const vectors = await embedRecords({
    provider: options.embeddingProvider,
    model,
    records,
    batchSize,
    ...(dimensions !== undefined ? { dimensions } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const queryVector = await embedSingleText({
    provider: options.embeddingProvider,
    model,
    text: query,
    ...(dimensions !== undefined ? { dimensions } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const minScore = typeof options.minScore === 'number' && Number.isFinite(options.minScore) ? options.minScore : -1;
  const maxResults = Math.max(1, Math.floor(options.maxResults ?? Number.MAX_SAFE_INTEGER));
  return rankEmbeddingRecords(records, vectors, queryVector)
    .filter((result) => result.score >= minScore)
    .slice(0, maxResults)
    .map((result, index): HvyDocumentSearchResult => ({
      id: `${result.record.documentId}:embedding-${index + 1}`,
      documentId: result.record.documentId,
      ...(result.record.documentTitle ? { documentTitle: result.record.documentTitle } : {}),
      category: 'semantic',
      targetKind: result.record.targetKind,
      sectionKey: result.record.sectionKey,
      ...(result.record.blockId ? { blockId: result.record.blockId } : {}),
      targetId: result.record.targetId,
      ...(result.record.targetRef ? { targetRef: result.record.targetRef } : {}),
      ...(result.record.targetPath ? { targetPath: result.record.targetPath } : {}),
      label: result.record.label,
      ...(result.record.contextLabel ? { contextLabel: result.record.contextLabel } : {}),
      preview: result.record.text,
      matchedText: query,
      sourceField: 'Embedding match',
      matches: [{
        field: 'embedding',
        label: 'Embedding match',
        preview: result.record.text,
        matchedText: query,
      }],
      documentOrder: result.record.documentOffset + result.record.documentOrder,
      score: result.score,
    }));
}

async function getEmbeddingIndex(
  document: VisualDocument,
  options: HvyChatContextOptions,
  embeddingProvider: HvyEmbeddingProvider,
  signal?: AbortSignal,
  onProgress?: HvyChatContextPreparationProgressCallback
): Promise<RuntimeEmbeddingIndex> {
  const documentRevision = getEmbeddingDocumentRevision(document);
  const records = buildEmbeddingRecords(document);
  const profile = buildEmbeddingIndexProfile(document, records, options);
  const profileKey = getEmbeddingProfileKey(profile);
  const cached = runtimeIndexes.get(document);
  if (cached && cached.documentRevision === documentRevision && getEmbeddingProfileKey(cached.profile) === profileKey) {
    cached.persistToAttachments ||= options.persistEmbeddingsToAttachments === true;
    cached.lastBuildStats = {
      totalChunks: records.length,
      reusedChunks: records.length,
      rebuiltChunks: 0,
      missingVectors: records.filter((record) => !cached.vectors.has(record.key)).length,
      alreadyPrepared: true,
    };
    return cached;
  }
  const pending = pendingRuntimeIndexes.get(document);
  if (pending && pending.documentRevision === documentRevision && pending.profileKey === profileKey) {
    return pending.promise;
  }
  const promise = buildRuntimeEmbeddingIndex({
    document,
    records,
    profile,
    documentRevision,
    options,
    embeddingProvider,
    onProgress,
    ...(signal ? { signal } : {}),
  });
  pendingRuntimeIndexes.set(document, { documentRevision, profileKey, promise });
  void promise.finally(() => {
    if (pendingRuntimeIndexes.get(document)?.promise === promise) {
      pendingRuntimeIndexes.delete(document);
    }
  });
  return promise;
}

async function buildRuntimeEmbeddingIndex(params: {
  document: VisualDocument;
  records: EmbeddingRecord[];
  profile: EmbeddingIndexProfile;
  documentRevision: number;
  options: HvyChatContextOptions;
  embeddingProvider: HvyEmbeddingProvider;
  onProgress?: HvyChatContextPreparationProgressCallback;
  signal?: AbortSignal;
}): Promise<RuntimeEmbeddingIndex> {
  const attached = readEmbeddingAttachment(params.document, params.profile);
  const existing = runtimeIndexes.get(params.document);
  const vectors = new Map<string, number[]>();
  const textHashes = new Map<string, string>();
  const previousEntries = collectReusableEmbeddingEntries(params.records, [
    ...(existing && getEmbeddingProfileKey(existing.profile) === getEmbeddingProfileKey(params.profile)
      ? params.records.map((record) => ({
        id: record.key,
        textHash: existing.textHashes.get(record.key) ?? '',
        vector: existing.vectors.get(record.key) ?? [],
      }))
      : []),
    ...(attached?.entries ?? []),
  ]);
  for (const entry of previousEntries) {
    vectors.set(entry.id, entry.vector);
    textHashes.set(entry.id, entry.textHash);
  }
  const missingRecords = params.records.filter((record) => !vectors.has(record.key));
  const rebuiltChunks = missingRecords.length;
  const reportProgress = (embeddedChunks: number): void => {
    void params.onProgress?.({
      totalChunks: params.records.length,
      reusedChunks: previousEntries.length,
      missingChunks: missingRecords.length,
      embeddedChunks,
    });
  };
  if (missingRecords.length > 0) {
    reportProgress(0);
    const embedded = await embedRecords({
      provider: params.embeddingProvider,
      model: params.profile.model,
      records: missingRecords,
      batchSize: normalizeBatchSize(params.options.embeddingBatchSize),
      onProgress: reportProgress,
      ...(params.profile.dimensions !== undefined ? { dimensions: params.profile.dimensions } : {}),
      ...(params.signal ? { signal: params.signal } : {}),
    });
    for (const record of missingRecords) {
      const vector = embedded.get(record.key);
      if (vector) {
        vectors.set(record.key, vector);
        textHashes.set(record.key, record.textHash);
      }
    }
  }
  const runtime = {
    profile: params.profile,
    documentRevision: params.documentRevision,
    records: params.records,
    vectors,
    textHashes,
    persistToAttachments: params.options.persistEmbeddingsToAttachments === true,
    lastBuildStats: {
      totalChunks: params.records.length,
      reusedChunks: previousEntries.length,
      rebuiltChunks,
      missingVectors: params.records.filter((record) => !vectors.has(record.key)).length,
      alreadyPrepared: false,
    },
  };
  runtimeIndexes.set(params.document, runtime);
  return runtime;
}

function buildEmbeddingRecords(
  document: VisualDocument,
  options: { targetChunkChars?: number; overlapChars?: number } = {}
): EmbeddingRecord[] {
  const documentTitle = getDocumentTitle(document);
  const aiContext = getDocumentAiContext(document);
  return buildSemanticRetrievalChunks(document, {
    targetChunkChars: options.targetChunkChars ?? MAX_RECORD_TEXT_CHARS,
    ...(options.overlapChars !== undefined ? { overlapChars: options.overlapChars } : {}),
  })
    .map((candidate): EmbeddingRecord => {
      const text = truncateText(candidate.summary, MAX_RECORD_TEXT_CHARS);
      const record: HvyChatSearchIndexRecord = {
        key: candidate.chunkId,
        targetKind: candidate.targetKind,
        sectionKey: candidate.sectionKey,
        ...(candidate.blockId ? { blockId: candidate.blockId } : {}),
        targetId: candidate.targetId,
        ...(candidate.targetRef ? { targetRef: candidate.targetRef } : {}),
        ...(candidate.targetPath ? { targetPath: candidate.targetPath } : {}),
        ...(documentTitle ? { documentTitle } : {}),
        ...(aiContext ? { aiContext } : {}),
        label: candidate.label,
        ...(candidate.contextLabel ? { contextLabel: candidate.contextLabel } : {}),
        tags: candidate.tags,
        description: candidate.description,
        ...(candidate.componentType ? { componentType: candidate.componentType } : {}),
        text,
        documentOrder: candidate.documentOrder,
      };
      const embeddingText = buildRecordEmbeddingText(record);
      return {
        ...record,
        embeddingText,
        textHash: hashString(embeddingText),
      };
    });
}

function recordToEmbeddingIndexChunk(record: EmbeddingRecord): HvyEmbeddingIndexChunk {
  return {
    id: record.key,
    text: record.embeddingText,
    textHash: record.textHash,
    targetKind: record.targetKind,
    sectionKey: record.sectionKey,
    ...(record.blockId ? { blockId: record.blockId } : {}),
    targetId: record.targetId,
    ...(record.targetRef ? { targetRef: record.targetRef } : {}),
    ...(record.targetPath ? { targetPath: record.targetPath } : {}),
    label: record.label,
    ...(record.contextLabel ? { contextLabel: record.contextLabel } : {}),
    ...(record.documentTitle ? { documentTitle: record.documentTitle } : {}),
    documentOrder: record.documentOrder,
  };
}

function buildRecordEmbeddingText(record: HvyChatSearchIndexRecord): string {
  return [
    record.documentTitle,
    record.aiContext,
    record.label,
    record.contextLabel,
    record.tags.join(' '),
    record.description,
    record.componentType,
    record.targetId,
    record.targetRef,
    record.targetPath,
    record.text,
  ].filter(Boolean).join('\n');
}

function collectReusableEmbeddingEntries(
  records: EmbeddingRecord[],
  entries: Array<HvyEmbeddingVector & { textHash: string }>
): Array<HvyEmbeddingVector & { textHash: string }> {
  const currentHashes = new Map(records.map((record) => [record.key, record.textHash]));
  const reusable = new Map<string, HvyEmbeddingVector & { textHash: string }>();
  for (const entry of entries) {
    if (!entry.textHash || currentHashes.get(entry.id) !== entry.textHash) {
      continue;
    }
    const vector = normalizeVector(entry.vector);
    if (!vector) {
      continue;
    }
    reusable.set(entry.id, { id: entry.id, textHash: entry.textHash, vector });
  }
  return [...reusable.values()];
}

async function embedRecords(params: {
  provider: HvyEmbeddingProvider;
  model: string;
  records: EmbeddingRecord[];
  batchSize: number;
  onProgress?: (embeddedChunks: number) => void;
  dimensions?: number;
  signal?: AbortSignal;
}): Promise<Map<string, number[]>> {
  const vectors = new Map<string, number[]>();
  for (let index = 0; index < params.records.length; index += params.batchSize) {
    throwIfAborted(params.signal);
    const batch = params.records.slice(index, index + params.batchSize);
    const response = await params.provider(buildEmbeddingProviderRequest({
      model: params.model,
      inputs: batch.map((record) => ({ id: record.key, text: record.embeddingText })),
      ...(params.dimensions !== undefined ? { dimensions: params.dimensions } : {}),
      ...(params.signal ? { signal: params.signal } : {}),
    }));
    for (const entry of response) {
      const vector = normalizeVector(entry.vector);
      if (vector) {
        vectors.set(entry.id, vector);
      }
    }
    params.onProgress?.(Math.min(params.records.length, index + batch.length));
  }
  return vectors;
}

async function embedSingleText(params: {
  provider: HvyEmbeddingProvider;
  model: string;
  text: string;
  dimensions?: number;
  signal?: AbortSignal;
}): Promise<number[]> {
  const response = await params.provider(buildEmbeddingProviderRequest({
    model: params.model,
    inputs: [{ id: 'query', text: params.text }],
    ...(params.dimensions !== undefined ? { dimensions: params.dimensions } : {}),
    ...(params.signal ? { signal: params.signal } : {}),
  }));
  const vector = normalizeVector(response.find((entry) => entry.id === 'query')?.vector ?? response[0]?.vector);
  if (!vector) {
    throw new Error('Embedding provider did not return a vector for the query.');
  }
  return vector;
}

function buildEmbeddingProviderRequest(request: HvyEmbeddingProviderRequest): HvyEmbeddingProviderRequest {
  return request;
}

function rankEmbeddingRecords<T extends EmbeddingRecord>(
  records: T[],
  vectors: Map<string, number[]>,
  queryVector: number[]
): Array<{ record: T; score: number }> {
  return records
    .map((record) => {
      const vector = vectors.get(record.key);
      if (!vector) {
        return null;
      }
      const score = cosineSimilarity(queryVector, vector);
      return Number.isFinite(score) ? { record, score } : null;
    })
    .filter((result): result is { record: T; score: number } => result !== null)
    .sort((left, right) => right.score - left.score || getTargetKindRank(left.record) - getTargetKindRank(right.record) || left.record.documentOrder - right.record.documentOrder);
}

function getTargetKindRank(record: EmbeddingRecord): number {
  return record.targetKind === 'block' ? 0 : 1;
}

function packEmbeddingContext(
  document: VisualDocument,
  results: EmbeddingSearchResult[],
  maxContextChars: number
): HvyChatContextResult {
  const aiContext = getDocumentAiContext(document);
  const header = [
    ...(aiContext ? ['Document context:', aiContext, ''] : []),
    'Retrieved document evidence:',
  ].join('\n');
  let context = header;
  const evidence: HvyChatEvidence[] = [];
  let truncated = false;
  for (const [index, result] of results.entries()) {
    const block = formatEvidenceBlock(index + 1, result);
    const separator = context.endsWith('\n') ? '' : '\n\n';
    if (context.length + separator.length + block.length <= maxContextChars) {
      context += `${separator}${block}`;
      evidence.push(toEvidence(result));
      continue;
    }
    const remaining = maxContextChars - context.length - separator.length;
    if (remaining > 80) {
      context += `${separator}${truncateText(block, remaining)}`;
      evidence.push(toEvidence(result));
    }
    truncated = true;
    break;
  }
  if (context.length > maxContextChars) {
    context = context.slice(0, maxContextChars);
    truncated = true;
  }
  return {
    context,
    ...(evidence.length ? { evidence } : {}),
    budget: {
      maxContextChars,
      usedContextChars: context.length,
      truncated,
    },
  };
}

function formatEvidenceBlock(index: number, result: EmbeddingSearchResult): string {
  const record = result.record;
  return [
    `[${index}] ${record.label}`,
    ...(record.contextLabel ? [`Context: ${record.contextLabel}`] : []),
    ...(record.description ? [`Description: ${record.description}`] : []),
    ...(record.tags.length ? [`Tags: ${record.tags.join(', ')}`] : []),
    ...(record.componentType ? [`Component: ${record.componentType}`] : []),
    `Score: ${roundScore(result.score)}`,
    'Text:',
    record.text || '(empty)',
  ].join('\n');
}

function toEvidence(result: EmbeddingSearchResult): HvyChatEvidence {
  return {
    label: result.record.label,
    ...(result.record.contextLabel ? { contextLabel: result.record.contextLabel } : {}),
    targetKind: result.record.targetKind,
    targetId: result.record.targetId,
    ...(result.record.targetRef ? { targetRef: result.record.targetRef } : {}),
    ...(result.record.targetPath ? { targetPath: result.record.targetPath } : {}),
    sectionKey: result.record.sectionKey,
    ...(result.record.blockId ? { blockId: result.record.blockId } : {}),
    score: result.score,
    source: 'embedding',
  };
}

function buildEmbeddingIndexProfile(
  document: VisualDocument,
  records: EmbeddingRecord[],
  options: HvyChatContextOptions
): EmbeddingIndexProfile {
  const model = getEmbeddingModel(options);
  const dimensions = normalizeDimensions(options.embeddingDimensions);
  const fingerprint = hashString([
    JSON.stringify(document.meta),
    records.map((record) => `${record.key}:${record.textHash}`).join('|'),
  ].join('\n'));
  const recordsHash = hashString(records.map((record) => [
    record.key,
    record.textHash,
    record.targetKind,
    record.targetId,
    record.targetRef ?? '',
    record.targetPath ?? '',
  ].join(':')).join('|'));
  const profileSeed = `${model}|${dimensions ?? ''}|semantic-retrieval-chunks-v1`;
  return {
    model,
    ...(dimensions !== undefined ? { dimensions } : {}),
    fingerprint,
    recordsHash,
    attachmentId: `embedding-index:${hashString(profileSeed)}`,
  };
}

function readEmbeddingAttachment(document: VisualDocument, profile: EmbeddingIndexProfile): EmbeddingIndexSnapshot | null {
  const attachments = [
    getAttachment(document, profile.attachmentId),
    ...document.attachments.filter((attachment) => attachment.id !== profile.attachmentId),
  ].filter((attachment): attachment is NonNullable<typeof attachment> => attachment?.meta.mediaType === EMBEDDING_ATTACHMENT_MEDIA_TYPE);
  for (const attachment of attachments) {
    const snapshot = parseEmbeddingAttachmentBytes(attachment.bytes, profile);
    if (snapshot) {
      return snapshot;
    }
  }
  return null;
}

function readTailAttachmentSlices(bytes: Uint8Array): Array<{ id: string; meta: Record<string, unknown>; bytes: Uint8Array }> {
  const sentinel = new TextEncoder().encode('\n--HVY-TAIL--\n');
  const sentinelIndex = lastIndexOfBytes(bytes, sentinel);
  if (sentinelIndex < 0) {
    return [];
  }
  const prefixText = new TextDecoder().decode(bytes.slice(0, sentinelIndex)).replace(/\r\n/g, '\n');
  const directives: Array<{ id: string; meta: Record<string, unknown>; length: number }> = [];
  let cursor = prefixText.length;
  while (cursor > 0) {
    const previousNewline = prefixText.lastIndexOf('\n', cursor - 1);
    const lineStart = previousNewline + 1;
    const line = prefixText.slice(lineStart, cursor).trim();
    const match = line.match(/^<!--hvy:tail\s+(\{.*\})\s*-->$/);
    if (!match) {
      break;
    }
    const parsed = parseTailAttachmentDirective(match[1]!);
    if (!parsed) {
      return [];
    }
    directives.unshift(parsed);
    cursor = previousNewline;
  }
  if (directives.length === 0) {
    return [];
  }
  const tailStart = sentinelIndex + sentinel.length;
  let offset = 0;
  return directives.flatMap((directive) => {
    const start = tailStart + offset;
    const end = start + directive.length;
    offset += directive.length;
    if (start < tailStart || end > bytes.length) {
      return [];
    }
    return {
      id: directive.id,
      meta: directive.meta,
      bytes: bytes.slice(start, end),
    };
  });
}

function parseTailAttachmentDirective(source: string): { id: string; meta: Record<string, unknown>; length: number } | null {
  try {
    const parsed = JSON.parse(source);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const meta = parsed as Record<string, unknown>;
    const id = typeof meta.id === 'string' ? meta.id : '';
    const length = typeof meta.length === 'number' && Number.isFinite(meta.length) ? Math.floor(meta.length) : -1;
    if (!id || length < 0) {
      return null;
    }
    return { id, meta, length };
  } catch {
    return null;
  }
}

function parseEmbeddingAttachmentBytes(bytes: Uint8Array, profile: EmbeddingIndexProfile): EmbeddingIndexSnapshot | null {
  try {
    const parsed = parseEmbeddingIndexBinary(bytes);
    if (
      parsed.version !== EMBEDDING_INDEX_VERSION
      || parsed.model !== profile.model
      || parsed.dimensions !== profile.dimensions
      || !Array.isArray(parsed.entries)
    ) {
      return null;
    }
    return parsed as EmbeddingIndexSnapshot;
  } catch {
    return null;
  }
}

function writeEmbeddingAttachment(document: VisualDocument, runtime: RuntimeEmbeddingIndex): void {
  const attachment = buildEmbeddingAttachment(runtime);
  setAttachment(document, attachment.id, attachment.meta, attachment.bytes);
}

function buildEmbeddingAttachment(runtime: RuntimeEmbeddingIndex): { id: string; meta: Record<string, unknown>; bytes: Uint8Array } {
  const snapshot: EmbeddingIndexSnapshot = {
    version: EMBEDDING_INDEX_VERSION,
    model: runtime.profile.model,
    ...(runtime.profile.dimensions !== undefined ? { dimensions: runtime.profile.dimensions } : {}),
    fingerprint: runtime.profile.fingerprint,
    recordsHash: runtime.profile.recordsHash,
    entries: runtime.records.flatMap((record) => {
      const vector = runtime.vectors.get(record.key);
      const textHash = runtime.textHashes.get(record.key);
      return vector && textHash === record.textHash ? [{ id: record.key, textHash, vector, chunk: recordToEmbeddingIndexChunk(record) }] : [];
    }),
  };
  return {
    id: runtime.profile.attachmentId,
    meta: {
      mediaType: EMBEDDING_ATTACHMENT_MEDIA_TYPE,
      model: runtime.profile.model,
      ...(runtime.profile.dimensions !== undefined ? { dimensions: runtime.profile.dimensions } : {}),
      derived: true,
    },
    bytes: serializeEmbeddingIndexBinary(snapshot),
  };
}

function serializeEmbeddingIndexBinary(snapshot: EmbeddingIndexSnapshot): Uint8Array {
  const dimensionCount = getSnapshotDimensionCount(snapshot);
  const vectorCount = snapshot.entries.length;
  const metadata = new TextEncoder().encode(JSON.stringify({
    version: snapshot.version,
    model: snapshot.model,
    ...(snapshot.dimensions !== undefined ? { dimensions: snapshot.dimensions } : {}),
    fingerprint: snapshot.fingerprint,
    recordsHash: snapshot.recordsHash,
    ids: snapshot.entries.map((entry) => entry.id),
    hashes: snapshot.entries.map((entry) => entry.textHash),
    chunks: snapshot.entries.map((entry) => entry.chunk ?? null),
  }));
  const vectorBytes = vectorCount * dimensionCount * Float32Array.BYTES_PER_ELEMENT;
  const bytes = new Uint8Array(EMBEDDING_INDEX_HEADER_SIZE + metadata.length + vectorBytes);
  bytes.set(new TextEncoder().encode(EMBEDDING_INDEX_MAGIC), 0);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(8, EMBEDDING_INDEX_VERSION, true);
  view.setUint32(12, metadata.length, true);
  view.setUint32(16, vectorCount, true);
  view.setUint32(20, dimensionCount, true);
  bytes.set(metadata, EMBEDDING_INDEX_HEADER_SIZE);
  let offset = EMBEDDING_INDEX_HEADER_SIZE + metadata.length;
  for (const entry of snapshot.entries) {
    if (entry.vector.length !== dimensionCount) {
      throw new Error('Embedding vectors must have consistent dimensions before caching.');
    }
    for (const value of entry.vector) {
      view.setFloat32(offset, value, true);
      offset += Float32Array.BYTES_PER_ELEMENT;
    }
  }
  return bytes;
}

function parseEmbeddingIndexBinary(bytes: Uint8Array): EmbeddingIndexSnapshot {
  if (bytes.length < EMBEDDING_INDEX_HEADER_SIZE) {
    throw new Error('Embedding index attachment is too small.');
  }
  const magic = new TextDecoder().decode(bytes.slice(0, 8));
  if (magic !== EMBEDDING_INDEX_MAGIC) {
    throw new Error('Embedding index attachment has an invalid magic header.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(8, true);
  const metadataLength = view.getUint32(12, true);
  const vectorCount = view.getUint32(16, true);
  const dimensionCount = view.getUint32(20, true);
  const vectorBytes = vectorCount * dimensionCount * Float32Array.BYTES_PER_ELEMENT;
  const expectedLength = EMBEDDING_INDEX_HEADER_SIZE + metadataLength + vectorBytes;
  if (version !== EMBEDDING_INDEX_VERSION || expectedLength !== bytes.length) {
    throw new Error('Embedding index attachment has an invalid header.');
  }
  const metadataBytes = bytes.slice(EMBEDDING_INDEX_HEADER_SIZE, EMBEDDING_INDEX_HEADER_SIZE + metadataLength);
  const metadata = JSON.parse(new TextDecoder().decode(metadataBytes)) as {
    version?: unknown;
    model?: unknown;
    dimensions?: unknown;
    fingerprint?: unknown;
    recordsHash?: unknown;
    ids?: unknown;
    hashes?: unknown;
    chunks?: unknown;
  };
  if (
    metadata.version !== EMBEDDING_INDEX_VERSION
    || typeof metadata.model !== 'string'
    || typeof metadata.fingerprint !== 'string'
    || typeof metadata.recordsHash !== 'string'
    || !Array.isArray(metadata.ids)
    || !Array.isArray(metadata.hashes)
    || !Array.isArray(metadata.chunks)
    || metadata.ids.length !== vectorCount
    || metadata.hashes.length !== vectorCount
    || metadata.chunks.length !== vectorCount
    || metadata.ids.some((id) => typeof id !== 'string')
    || metadata.hashes.some((hash) => typeof hash !== 'string')
  ) {
    throw new Error('Embedding index attachment has invalid metadata.');
  }
  if (metadata.dimensions !== undefined && (typeof metadata.dimensions !== 'number' || !Number.isFinite(metadata.dimensions))) {
    throw new Error('Embedding index attachment has invalid dimensions.');
  }
  const entries: Array<HvyEmbeddingVector & { textHash: string; chunk?: HvyEmbeddingIndexChunk }> = [];
  let offset = EMBEDDING_INDEX_HEADER_SIZE + metadataLength;
  const ids = metadata.ids as string[];
  const hashes = metadata.hashes as string[];
  const chunks = metadata.chunks as unknown[];
  for (const [entryIndex, id] of ids.entries()) {
    const vector: number[] = [];
    for (let index = 0; index < dimensionCount; index += 1) {
      vector.push(view.getFloat32(offset, true));
      offset += Float32Array.BYTES_PER_ELEMENT;
    }
    const chunk = normalizeEmbeddingIndexChunk(chunks[entryIndex]);
    entries.push({
      id,
      textHash: hashes[entryIndex]!,
      vector,
      ...(chunk ? { chunk } : {}),
    });
  }
  return {
    version: EMBEDDING_INDEX_VERSION,
    model: metadata.model,
    ...(metadata.dimensions !== undefined ? { dimensions: Math.floor(metadata.dimensions) } : {}),
    fingerprint: metadata.fingerprint,
    recordsHash: metadata.recordsHash,
    entries,
  };
}

function normalizeEmbeddingIndexChunk(value: unknown): HvyEmbeddingIndexChunk | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const chunk = value as Partial<HvyEmbeddingIndexChunk>;
  if (
    typeof chunk.id !== 'string'
    || typeof chunk.text !== 'string'
    || typeof chunk.textHash !== 'string'
    || (chunk.targetKind !== 'section' && chunk.targetKind !== 'block')
    || typeof chunk.sectionKey !== 'string'
    || typeof chunk.targetId !== 'string'
    || typeof chunk.label !== 'string'
    || typeof chunk.documentOrder !== 'number'
    || !Number.isFinite(chunk.documentOrder)
  ) {
    return null;
  }
  return {
    id: chunk.id,
    text: chunk.text,
    textHash: chunk.textHash,
    targetKind: chunk.targetKind,
    sectionKey: chunk.sectionKey,
    ...(typeof chunk.blockId === 'string' ? { blockId: chunk.blockId } : {}),
    targetId: chunk.targetId,
    ...(typeof chunk.targetRef === 'string' ? { targetRef: chunk.targetRef } : {}),
    ...(typeof chunk.targetPath === 'string' ? { targetPath: chunk.targetPath } : {}),
    label: chunk.label,
    ...(typeof chunk.contextLabel === 'string' ? { contextLabel: chunk.contextLabel } : {}),
    ...(typeof chunk.documentTitle === 'string' ? { documentTitle: chunk.documentTitle } : {}),
    documentOrder: chunk.documentOrder,
  };
}

function getSnapshotDimensionCount(snapshot: EmbeddingIndexSnapshot): number {
  const firstVector = snapshot.entries[0]?.vector;
  if (!firstVector || firstVector.length === 0) {
    return 0;
  }
  return firstVector.length;
}

function getEmbeddingModel(options: Pick<HvyChatContextOptions, 'embeddingModel' | 'embeddingDimensions' | 'embeddingBatchSize'>): string {
  return options.embeddingModel?.trim() || DEFAULT_EMBEDDING_MODEL;
}

function normalizeDimensions(dimensions: number | undefined): number | undefined {
  if (typeof dimensions !== 'number' || !Number.isFinite(dimensions)) {
    return undefined;
  }
  return Math.max(1, Math.floor(dimensions));
}

function normalizeBatchSize(batchSize: number | undefined): number {
  if (typeof batchSize !== 'number' || !Number.isFinite(batchSize)) {
    return DEFAULT_EMBEDDING_BATCH_SIZE;
  }
  return Math.max(1, Math.floor(batchSize));
}

function normalizeVector(vector: number[] | undefined): number[] | null {
  if (!Array.isArray(vector) || vector.length === 0 || vector.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    return null;
  }
  return vector;
}

function cosineSimilarity(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  if (length === 0) {
    return Number.NaN;
  }
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index]!;
    const rightValue = right[index]!;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return Number.NaN;
  }
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function getEmbeddingProfileKey(profile: EmbeddingIndexProfile): string {
  return `${profile.model}|${profile.dimensions ?? ''}`;
}

function getEmbeddingDocumentRevision(document: VisualDocument): number {
  return documentRevisions.get(document) ?? 0;
}

function getDocumentTitle(document: VisualDocument): string {
  return typeof document.meta.title === 'string' ? document.meta.title.trim() : '';
}

function roundScore(score: number): number {
  return Math.round(score * 10_000) / 10_000;
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  if (maxChars <= 3) {
    return value.slice(0, maxChars);
  }
  return `${value.slice(0, maxChars - 3).trimEnd()}...`;
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function lastIndexOfBytes(source: Uint8Array, needle: Uint8Array): number {
  if (needle.length === 0 || source.length < needle.length) {
    return -1;
  }
  for (let index = source.length - needle.length; index >= 0; index -= 1) {
    let matches = true;
    for (let needleIndex = 0; needleIndex < needle.length; needleIndex += 1) {
      if (source[index + needleIndex] !== needle[needleIndex]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return index;
    }
  }
  return -1;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }
  throw new DOMException('The operation was aborted.', 'AbortError');
}
