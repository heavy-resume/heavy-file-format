import { Encoder, Index } from 'flexsearch';
import englishEncoder from 'flexsearch/lang/en';

import { serializeDocument } from '../serialization';
import { buildSemanticFilterCandidates } from '../search/semantic-candidates';
import type { HvySemanticFilterCandidate } from '../search/types';
import type {
  HvyChatContextOptions,
  HvyChatContextRequest,
  HvyChatContextResult,
  HvyChatEvidence,
  HvyChatSearchCache,
  HvyChatSearchIndexKey,
  HvyChatSearchIndexRecord,
  VisualDocument,
} from '../types';
import { getDocumentAiContext } from '../document-ai-context';
import { markEmbeddingChatContextDocumentChanged } from './embedding-context';

const DEFAULT_MAX_RESULTS = 12;
const MIN_RESULTS_BEFORE_GAP_CUTOFF = 2;
const MAX_RECORD_TEXT_CHARS = 2_000;
const SCORE_GAP_MULTIPLIER = 2.5;
const SCORE_GAP_MIN_RELATIVE_DROP = 0.35;
const chatContextEncoder = new Encoder(englishEncoder);

interface RuntimeIndex {
  key: HvyChatSearchIndexKey;
  documentRevision: number;
  records: HvyChatSearchIndexRecord[];
  recordSearchHashes: Map<string, string>;
  index: Index;
}

const runtimeIndexes = new WeakMap<VisualDocument, RuntimeIndex>();
const pendingRuntimeIndexes = new WeakMap<VisualDocument, { documentRevision: number; promise: Promise<RuntimeIndex> }>();
const documentRevisions = new WeakMap<VisualDocument, number>();

export function markKeywordChatContextDocumentChanged(document: VisualDocument): void {
  documentRevisions.set(document, getKeywordDocumentRevision(document) + 1);
  pendingRuntimeIndexes.delete(document);
  markEmbeddingChatContextDocumentChanged(document);
}

export function isKeywordChatContextPrepared(document: VisualDocument): boolean {
  const cached = runtimeIndexes.get(document);
  return Boolean(cached && cached.documentRevision === getKeywordDocumentRevision(document));
}

export async function prepareKeywordChatContext(document: VisualDocument, cache: HvyChatSearchCache | null = null): Promise<void> {
  await getKeywordIndex(document, cache);
}

export async function buildKeywordChatContext(
  request: HvyChatContextRequest,
  options: HvyChatContextOptions = {},
  cache: HvyChatSearchCache | null = null
): Promise<HvyChatContextResult> {
  const maxContextChars = Math.max(1, Math.floor(options.maxContextChars ?? request.maxContextChars));
  const maxResults = Math.max(1, Math.floor(options.maxResults ?? DEFAULT_MAX_RESULTS));
  const index = await getKeywordIndex(request.document, cache);
  const queryTokens = tokenizeSearchText(request.question);
  if (queryTokens.length === 0 || index.records.length === 0) {
    return packKeywordContext(request.document, [], maxContextChars);
  }

  const flexMatches = new Set(
    (index.index.search(request.question, { limit: Math.max(maxResults * 6, 24), suggest: true }) as Array<string | number>)
      .map(String)
  );
  const scored = index.records
    .map((record) => scoreRecord(record, queryTokens, flexMatches.has(record.key)))
    .filter((result): result is { record: HvyChatSearchIndexRecord; score: number } => result !== null && result.score > 0)
    .sort((left, right) => right.score - left.score || left.record.documentOrder - right.record.documentOrder);
  const gapResults = applyScoreGapCutoff(scored);
  const selected = gapResults.slice(0, maxResults);
  const result = packKeywordContext(request.document, selected, maxContextChars);
  logKeywordChatContextDebug({
    request,
    maxContextChars,
    maxResults,
    queryTokens,
    totalRecords: index.records.length,
    flexMatchCount: flexMatches.size,
    ranked: scored,
    gapResults,
    selected,
    result,
  });
  return result;
}

function getKeywordIndex(document: VisualDocument, cache: HvyChatSearchCache | null): Promise<RuntimeIndex> | RuntimeIndex {
  const documentRevision = getKeywordDocumentRevision(document);
  const cached = runtimeIndexes.get(document);
  if (cached && cached.documentRevision === documentRevision) {
    return cached;
  }
  const pending = pendingRuntimeIndexes.get(document);
  if (pending && pending.documentRevision === documentRevision) {
    return pending.promise;
  }
  const key = buildIndexKey(document);
  if (cached && cached.key.fingerprint === key.fingerprint && cached.key.documentId === key.documentId) {
    cached.documentRevision = documentRevision;
    return cached;
  }
  if (cached && cached.key.documentId === key.documentId) {
    return trackPendingKeywordIndex(document, documentRevision, updateKeywordIndex(document, cached, key, documentRevision, cache));
  }
  return trackPendingKeywordIndex(document, documentRevision, buildKeywordIndex(document, key, documentRevision, cache));
}

function trackPendingKeywordIndex(document: VisualDocument, documentRevision: number, promise: Promise<RuntimeIndex>): Promise<RuntimeIndex> {
  pendingRuntimeIndexes.set(document, { documentRevision, promise });
  void promise.finally(() => {
    if (pendingRuntimeIndexes.get(document)?.promise === promise) {
      pendingRuntimeIndexes.delete(document);
    }
  });
  return promise;
}

async function buildKeywordIndex(
  document: VisualDocument,
  key: HvyChatSearchIndexKey,
  documentRevision: number,
  cache: HvyChatSearchCache | null
): Promise<RuntimeIndex> {
  const cached = await cache?.getIndex(key);
  const snapshot = cached?.version === 1 && Array.isArray(cached.records)
    ? cached
    : { version: 1 as const, records: buildIndexRecords(document) };
  const runtime = {
    key,
    documentRevision,
    records: snapshot.records,
    recordSearchHashes: buildRecordSearchHashes(snapshot.records),
    index: createFlexIndex(snapshot.records),
  };
  runtimeIndexes.set(document, runtime);
  if (!cached) {
    await cache?.putIndex(key, { version: 1, records: snapshot.records });
  }
  return runtime;
}

async function updateKeywordIndex(
  document: VisualDocument,
  runtime: RuntimeIndex,
  key: HvyChatSearchIndexKey,
  documentRevision: number,
  cache: HvyChatSearchCache | null
): Promise<RuntimeIndex> {
  const nextRecords = buildIndexRecords(document);
  const nextRecordsByKey = new Map(nextRecords.map((record) => [record.key, record]));
  const nextHashes = buildRecordSearchHashes(nextRecords);
  for (const [recordKey, previousHash] of runtime.recordSearchHashes) {
    const nextRecord = nextRecordsByKey.get(recordKey);
    if (!nextRecord) {
      runtime.index.remove(recordKey);
      continue;
    }
    const nextHash = nextHashes.get(recordKey);
    if (nextHash !== previousHash) {
      runtime.index.update(recordKey, buildRecordSearchText(nextRecord));
    }
  }
  for (const record of nextRecords) {
    if (!runtime.recordSearchHashes.has(record.key)) {
      runtime.index.add(record.key, buildRecordSearchText(record));
    }
  }
  runtime.key = key;
  runtime.documentRevision = documentRevision;
  runtime.records = nextRecords;
  runtime.recordSearchHashes = nextHashes;
  runtimeIndexes.set(document, runtime);
  await cache?.putIndex(key, { version: 1, records: nextRecords });
  return runtime;
}

function getKeywordDocumentRevision(document: VisualDocument): number {
  return documentRevisions.get(document) ?? 0;
}

function createFlexIndex(records: HvyChatSearchIndexRecord[]): Index {
  const index = new Index({ tokenize: 'forward', preset: 'score', encoder: englishEncoder });
  for (const record of records) {
    index.add(record.key, buildRecordSearchText(record));
  }
  return index;
}

function buildRecordSearchHashes(records: HvyChatSearchIndexRecord[]): Map<string, string> {
  return new Map(records.map((record) => [record.key, hashString(buildRecordSearchText(record))]));
}

function buildIndexKey(document: VisualDocument): HvyChatSearchIndexKey {
  const title = typeof document.meta.title === 'string' && document.meta.title.trim() ? document.meta.title.trim() : 'document';
  return {
    documentId: title,
    fingerprint: hashString(serializeDocument(document)),
  };
}

function buildIndexRecords(document: VisualDocument): HvyChatSearchIndexRecord[] {
  const documentTitle = typeof document.meta.title === 'string' ? document.meta.title.trim() : '';
  const aiContext = getDocumentAiContext(document);
  return buildSemanticFilterCandidates(document, { maxCandidateSummaryChars: MAX_RECORD_TEXT_CHARS })
    .map((candidate) => candidateToRecord(candidate, { documentTitle, aiContext }));
}

function buildRecordSearchText(record: HvyChatSearchIndexRecord): string {
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
  ].filter(Boolean).join(' ');
}

function candidateToRecord(
  candidate: HvySemanticFilterCandidate,
  metadata: { documentTitle: string; aiContext: string }
): HvyChatSearchIndexRecord {
  return {
    key: candidate.candidateId,
    targetKind: candidate.targetKind,
    sectionKey: candidate.sectionKey,
    ...(candidate.blockId ? { blockId: candidate.blockId } : {}),
    targetId: candidate.targetId,
    ...(candidate.targetRef ? { targetRef: candidate.targetRef } : {}),
    ...(candidate.targetPath ? { targetPath: candidate.targetPath } : {}),
    ...(metadata.documentTitle ? { documentTitle: metadata.documentTitle } : {}),
    ...(metadata.aiContext ? { aiContext: metadata.aiContext } : {}),
    label: candidate.label,
    ...(candidate.contextLabel ? { contextLabel: candidate.contextLabel } : {}),
    tags: candidate.tags,
    description: candidate.description,
    ...(candidate.componentType ? { componentType: candidate.componentType } : {}),
    text: truncateText(candidate.summary, MAX_RECORD_TEXT_CHARS),
    documentOrder: candidate.documentOrder,
  };
}

function scoreRecord(record: HvyChatSearchIndexRecord, queryTokens: string[], flexMatched: boolean): { record: HvyChatSearchIndexRecord; score: number } | null {
  let score = flexMatched ? 8 : 0;
  score += scoreField(queryTokens, record.label, 18, 6);
  score += scoreField(queryTokens, record.contextLabel ?? '', 12, 4);
  score += scoreField(queryTokens, record.description, 16, 5);
  score += scoreField(queryTokens, record.tags.join(' '), 16, 5);
  score += scoreField(queryTokens, record.componentType ?? '', 6, 2);
  score += scoreField(queryTokens, record.targetId, 4, 1);
  score += scoreField(queryTokens, record.text, 2, 1);
  return score > 0 ? { record, score } : null;
}

function scoreField(queryTokens: string[], value: string, exactWeight: number, partialWeight: number): number {
  if (!value.trim()) {
    return 0;
  }
  const target = value.toLowerCase();
  const targetTokens = new Set(tokenizeSearchText(target));
  return queryTokens.reduce((score, token) => {
    if (targetTokens.has(token)) {
      return score + exactWeight;
    }
    if (target.includes(token)) {
      return score + partialWeight;
    }
    return score;
  }, 0);
}

export function applyScoreGapCutoff<T extends { score: number }>(results: T[]): T[] {
  if (results.length <= MIN_RESULTS_BEFORE_GAP_CUTOFF + 1) {
    return results;
  }
  const drops = results.slice(1).map((result, index) => {
    const previous = results[index]!.score;
    return previous > 0 ? (previous - result.score) / previous : 0;
  });
  const eligible = drops
    .map((drop, index) => ({ drop, index }))
    .filter((entry) => entry.index + 1 >= MIN_RESULTS_BEFORE_GAP_CUTOFF);
  if (eligible.length === 0) {
    return results;
  }
  const largest = eligible.reduce((best, entry) => entry.drop > best.drop ? entry : best, eligible[0]!);
  const otherDrops = drops.filter((_, index) => index !== largest.index);
  const averageOtherDrop = otherDrops.length
    ? otherDrops.reduce((total, drop) => total + drop, 0) / otherDrops.length
    : 0;
  if (largest.drop < SCORE_GAP_MIN_RELATIVE_DROP || largest.drop < averageOtherDrop * SCORE_GAP_MULTIPLIER) {
    return results;
  }
  return results.slice(0, largest.index + 1);
}

function packKeywordContext(
  document: VisualDocument,
  results: Array<{ record: HvyChatSearchIndexRecord; score: number }>,
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

function formatEvidenceBlock(index: number, result: { record: HvyChatSearchIndexRecord; score: number }): string {
  const record = result.record;
  return [
    `[${index}] ${record.label}`,
    ...(record.contextLabel ? [`Context: ${record.contextLabel}`] : []),
    ...(record.description ? [`Description: ${record.description}`] : []),
    ...(record.tags.length ? [`Tags: ${record.tags.join(', ')}`] : []),
    ...(record.componentType ? [`Component: ${record.componentType}`] : []),
    `Score: ${result.score}`,
    'Text:',
    record.text || '(empty)',
  ].join('\n');
}

function toEvidence(result: { record: HvyChatSearchIndexRecord; score: number }): HvyChatEvidence {
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
    source: 'keyword',
  };
}

function logKeywordChatContextDebug(params: {
  request: HvyChatContextRequest;
  maxContextChars: number;
  maxResults: number;
  queryTokens: string[];
  totalRecords: number;
  flexMatchCount: number;
  ranked: Array<{ record: HvyChatSearchIndexRecord; score: number }>;
  gapResults: Array<{ record: HvyChatSearchIndexRecord; score: number }>;
  selected: Array<{ record: HvyChatSearchIndexRecord; score: number }>;
  result: HvyChatContextResult;
}): void {
  if (typeof window === 'undefined' || typeof console === 'undefined' || typeof console.debug !== 'function') {
    return;
  }
  const packedEvidenceCount = params.result.evidence?.length ?? 0;
  console.debug('[hvy:chat-context] keyword retrieval', {
    question: params.request.question,
    maxContextChars: params.maxContextChars,
    maxResults: params.maxResults,
    queryTokens: params.queryTokens,
    totalRecords: params.totalRecords,
    flexMatchCount: params.flexMatchCount,
    positiveScoreCount: params.ranked.length,
    clearGapKeptCount: params.gapResults.length,
    selectedCount: params.selected.length,
    packedEvidenceCount,
    budget: params.result.budget,
    rankedResults: params.ranked.map((result, index) => ({
      rank: index + 1,
      ...debugRecord(result),
    })),
    selectedResults: params.selected.map((result, index) => ({
      rank: index + 1,
      packed: index < packedEvidenceCount,
      packedPossiblyTruncated: params.result.budget.truncated && index === packedEvidenceCount - 1,
      ...debugRecord(result),
    })),
    context: params.result.context,
  });
}

function debugRecord(result: { record: HvyChatSearchIndexRecord; score: number }): Record<string, unknown> {
  return {
    key: result.record.key,
    score: result.score,
    documentOrder: result.record.documentOrder,
    targetKind: result.record.targetKind,
    targetId: result.record.targetId,
    targetRef: result.record.targetRef,
    targetPath: result.record.targetPath,
    sectionKey: result.record.sectionKey,
    blockId: result.record.blockId,
    label: result.record.label,
    contextLabel: result.record.contextLabel,
    tags: result.record.tags,
    description: result.record.description,
    componentType: result.record.componentType,
    textLength: result.record.text.length,
    text: result.record.text,
  };
}

function tokenizeSearchText(value: string): string[] {
  return [...new Set(chatContextEncoder.encode(value.toLowerCase()).filter((token) => token.length > 1))];
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
