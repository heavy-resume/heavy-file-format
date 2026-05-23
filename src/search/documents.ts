import { getReferenceAppConfig } from '../reference-config';
import type {
  HvyDocumentSearchDocument,
  HvyDocumentSearchRequest,
  HvyDocumentSearchResponse,
  HvyDocumentSearchResult,
  HvySearchResult,
  HvySemanticFilterCandidate,
  HvySemanticFilterMatch,
  SearchCategory,
} from './types';
import { builtInSearchProvider } from './search-provider';
import {
  applySemanticCandidateBudget,
  buildSemanticFilterCandidates,
  buildSemanticFilterInstructionPrompt,
  getDefaultSemanticCandidateBudget,
  getSemanticDocumentTitle,
} from './semantic-candidates';

const DEFAULT_SEARCH_CATEGORIES: SearchCategory[] = ['tags', 'contents', 'description'];

export async function searchDocuments(request: HvyDocumentSearchRequest): Promise<HvyDocumentSearchResponse> {
  const query = request.query.trim();
  const mode = request.mode ?? 'keyword';
  if (!query || request.documents.length === 0) {
    return { query, mode, results: [] };
  }
  throwIfAborted(request.signal);
  return mode === 'semantic'
    ? searchDocumentsSemantically(request, query)
    : searchDocumentsByKeyword(request, query);
}

async function searchDocumentsByKeyword(
  request: HvyDocumentSearchRequest,
  query: string
): Promise<HvyDocumentSearchResponse> {
  const provider = request.searchProvider ?? getReferenceAppConfig().searchProvider ?? builtInSearchProvider;
  const categories = request.categories ?? DEFAULT_SEARCH_CATEGORIES;
  const results: HvyDocumentSearchResult[] = [];
  for (const [documentIndex, entry] of normalizeSearchDocuments(request.documents).entries()) {
    throwIfAborted(request.signal);
    const documentResults = await provider({
      document: entry.document,
      query,
      caseSensitive: request.caseSensitive ?? false,
      categories,
      ...(request.signal ? { signal: request.signal } : {}),
    });
    results.push(...documentResults.map((result) => attachDocumentResult(result, entry, documentIndex)));
  }
  return {
    query,
    mode: 'keyword',
    results,
  };
}

async function searchDocumentsSemantically(
  request: HvyDocumentSearchRequest,
  query: string
): Promise<HvyDocumentSearchResponse> {
  const provider = request.semanticFilterProvider ?? getReferenceAppConfig().semanticFilterProvider;
  if (!provider) {
    throw new Error('Semantic document search requires a semanticFilterProvider.');
  }

  const budgetDefaults = getDefaultSemanticCandidateBudget();
  const maxCandidateSummaryChars = request.maxCandidateSummaryChars ?? budgetDefaults.maxCandidateSummaryChars;
  const maxTotalCandidateChars = request.maxTotalCandidateChars ?? budgetDefaults.maxTotalCandidateChars;
  const packet = buildDocumentSemanticCandidatePacket(normalizeSearchDocuments(request.documents), {
    maxCandidateSummaryChars,
    maxTotalCandidateChars,
  });
  if (packet.candidates.length === 0) {
    return {
      query,
      mode: 'semantic',
      results: [],
      candidateBudget: packet.candidateBudget,
    };
  }

  throwIfAborted(request.signal);
  const matches = await provider({
    prompt: query,
    instructionPrompt: buildSemanticFilterInstructionPrompt(query, packet.candidates),
    candidates: packet.candidates,
    candidateBudget: packet.candidateBudget,
    ...(request.signal ? { signal: request.signal } : {}),
  });
  throwIfAborted(request.signal);

  return {
    query,
    mode: 'semantic',
    results: buildDocumentSemanticSearchResults(packet.candidates, matches, query),
    candidateBudget: packet.candidateBudget,
  };
}

function buildDocumentSemanticCandidatePacket(
  documents: NormalizedSearchDocument[],
  options: { maxCandidateSummaryChars: number; maxTotalCandidateChars: number }
) {
  const sections: HvySemanticFilterCandidate[] = [];
  const blocks: HvySemanticFilterCandidate[] = [];

  for (const entry of documents) {
    const title = entry.documentTitle || getSemanticDocumentTitle(entry.document);
    for (const candidate of buildSemanticFilterCandidates(entry.document, {
      maxCandidateSummaryChars: options.maxCandidateSummaryChars,
    })) {
      const nextCandidate: HvySemanticFilterCandidate = {
        ...candidate,
        candidateId: `document:${entry.documentId}:${candidate.candidateId}`,
        documentId: entry.documentId,
        ...(title ? { documentTitle: title } : {}),
      };
      if (nextCandidate.targetKind === 'section') {
        sections.push(nextCandidate);
      } else {
        blocks.push(nextCandidate);
      }
    }
  }

  return applySemanticCandidateBudget([...sections, ...blocks], options);
}

function buildDocumentSemanticSearchResults(
  candidates: HvySemanticFilterCandidate[],
  matches: HvySemanticFilterMatch[],
  query: string
): HvyDocumentSearchResult[] {
  const candidatesById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const seen = new Set<string>();
  const results: HvyDocumentSearchResult[] = [];
  for (const match of matches) {
    const candidate = candidatesById.get(match.candidateId);
    if (!candidate?.documentId || seen.has(candidate.candidateId)) {
      continue;
    }
    seen.add(candidate.candidateId);
    const reason = typeof match.reason === 'string' && match.reason.trim()
      ? match.reason.trim()
      : candidate.summary;
    results.push({
      id: `${candidate.documentId}:semantic-${results.length + 1}`,
      documentId: candidate.documentId,
      ...(candidate.documentTitle ? { documentTitle: candidate.documentTitle } : {}),
      category: 'semantic',
      targetKind: candidate.targetKind,
      sectionKey: candidate.sectionKey,
      ...(candidate.blockId ? { blockId: candidate.blockId } : {}),
      targetId: candidate.targetId,
      ...(candidate.targetPath ? { targetPath: candidate.targetPath } : {}),
      label: candidate.label,
      ...(candidate.locationLabel ? { locationLabel: candidate.locationLabel } : {}),
      ...(candidate.contextLabel ? { contextLabel: candidate.contextLabel } : {}),
      preview: reason,
      matchedText: query,
      sourceField: 'Semantic match',
      matches: [{
        field: 'semantic',
        label: 'Reason',
        preview: reason,
        matchedText: query,
      }],
      documentOrder: candidate.documentOrder,
      ...(typeof match.score === 'number' && Number.isFinite(match.score) ? { score: match.score } : {}),
    });
  }
  return results;
}

interface NormalizedSearchDocument extends HvyDocumentSearchDocument {
  documentTitle?: string;
}

function normalizeSearchDocuments(documents: HvyDocumentSearchDocument[]): NormalizedSearchDocument[] {
  return documents
    .map((entry) => ({
      ...entry,
      documentId: entry.documentId.trim(),
      documentTitle: entry.documentTitle?.trim() || getSemanticDocumentTitle(entry.document) || undefined,
    }))
    .filter((entry) => entry.documentId);
}

function attachDocumentResult(
  result: HvySearchResult,
  entry: NormalizedSearchDocument,
  documentIndex: number
): HvyDocumentSearchResult {
  return {
    ...result,
    id: `${entry.documentId}:${result.id}`,
    documentId: entry.documentId,
    ...(entry.documentTitle ? { documentTitle: entry.documentTitle } : {}),
    documentOrder: documentIndex * 1_000_000 + (result.documentOrder ?? 0),
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }
  throw new DOMException('The operation was aborted.', 'AbortError');
}
