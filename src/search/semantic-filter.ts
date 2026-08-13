import {
  buildSemanticFilterWindowRequest,
  type HvySemanticFilterCandidateWindow,
} from './semantic-candidates';
import type {
  HvySearchResult,
  HvySemanticFilterCandidate,
  HvySemanticFilterMatch,
  HvySemanticFilterProvider,
} from './types';
import { requestSemanticFilterMatches } from './semantic-response';
import { normalizeSemanticFilterConcurrency } from './semantic-filter-concurrency';

export async function runSemanticFilterWindows(options: {
  prompt: string;
  provider: HvySemanticFilterProvider;
  windows: HvySemanticFilterCandidateWindow[];
  documentTitle?: string;
  traceRunId?: string;
  signal?: AbortSignal;
  concurrency?: number;
  maxAttempts?: number;
  onWindowComplete?: (progress: { completedWindows: number; matchedCandidates: number }) => void;
}): Promise<HvySemanticFilterMatch[]> {
  const runAbortController = new AbortController();
  const abortRunFromCaller = (): void => runAbortController.abort(options.signal?.reason);
  if (options.signal?.aborted) {
    abortRunFromCaller();
  } else {
    options.signal?.addEventListener('abort', abortRunFromCaller, { once: true });
  }
  const runSignal = runAbortController.signal;
  const matches: HvySemanticFilterMatch[] = [];
  let nextWindowIndex = 0;
  let completedWindows = 0;
  let matchedCandidates = 0;
  const concurrency = normalizeSemanticFilterConcurrency(options.concurrency);
  const workerCount = Math.min(concurrency, Math.max(1, options.windows.length));

  const runWorker = async (): Promise<void> => {
    while (!runSignal.aborted) {
      const window = options.windows[nextWindowIndex];
      nextWindowIndex += 1;
      if (!window) {
        return;
      }
      const providerRequest = buildSemanticFilterWindowRequest(options.prompt, window, {
        ...(options.documentTitle ? { documentTitle: options.documentTitle } : {}),
        ...(options.traceRunId ? { traceRunId: options.traceRunId } : {}),
        signal: runSignal,
      });
      let windowMatches: HvySemanticFilterMatch[];
      try {
        windowMatches = await requestSemanticFilterMatches(options.provider, providerRequest, {
          maxAttempts: options.maxAttempts,
        });
      } catch (error) {
        if (!runSignal.aborted) {
          runAbortController.abort(error);
        }
        throw error;
      }
      if (runSignal.aborted) {
        return;
      }
      matches.push(...windowMatches);
      completedWindows += 1;
      matchedCandidates += windowMatches.length;
      options.onWindowComplete?.({ completedWindows, matchedCandidates });
    }
  };

  try {
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
    return matches;
  } finally {
    options.signal?.removeEventListener('abort', abortRunFromCaller);
  }
}

export function buildSemanticSearchResults(
  candidates: HvySemanticFilterCandidate[],
  matches: HvySemanticFilterMatch[],
  prompt: string
): HvySearchResult[] {
  const candidatesById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const seen = new Set<string>();
  const results: HvySearchResult[] = [];
  for (const match of matches) {
    const candidate = candidatesById.get(match.candidateId);
    if (!candidate || seen.has(candidate.candidateId)) {
      continue;
    }
    seen.add(candidate.candidateId);
    const reason = typeof match.reason === 'string' && match.reason.trim()
      ? match.reason.trim()
      : candidate.summary;
    results.push({
      id: `semantic-${results.length + 1}`,
      category: 'semantic',
      targetKind: candidate.targetKind,
      sectionKey: candidate.sectionKey,
      ...(candidate.blockId ? { blockId: candidate.blockId } : {}),
      targetId: candidate.targetId,
      ...(candidate.targetRef ? { targetRef: candidate.targetRef } : {}),
      ...(candidate.targetPath ? { targetPath: candidate.targetPath } : {}),
      label: candidate.label,
      ...(candidate.locationLabel ? { locationLabel: candidate.locationLabel } : {}),
      ...(candidate.contextLabel ? { contextLabel: candidate.contextLabel } : {}),
      preview: reason,
      matchedText: prompt,
      sourceField: 'Semantic match',
      matches: [{
        field: 'semantic',
        label: 'Reason',
        preview: reason,
        matchedText: prompt,
      }],
      documentOrder: candidate.documentOrder,
      ...(typeof match.score === 'number' && Number.isFinite(match.score) ? { score: match.score } : {}),
    });
  }
  return results.sort((left, right) => (left.documentOrder ?? 0) - (right.documentOrder ?? 0));
}
