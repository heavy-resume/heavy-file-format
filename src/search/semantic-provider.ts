import { requestProxyCompletion, traceAgentLoopEvent } from '../chat/chat';
import { parseJsonArrayResponse } from '../llm-tool-loop';
import { state } from '../state';
import type { HvySemanticFilterMatch, HvySemanticFilterProvider } from './types';

export const chatSemanticFilterProvider: HvySemanticFilterProvider = async (request) => {
  traceSemanticFilterEvent(request, 'semantic_filter_request', {
    prompt: request.prompt,
    documentTitle: request.documentTitle,
    windowIndex: request.windowIndex,
    windowCount: request.windowCount,
    windowLabel: request.windowLabel,
    candidateBudget: request.candidateBudget,
    candidates: request.candidates,
  });
  const output = await requestProxyCompletion({
    settings: state.chat.settings,
    messages: [{
      id: 'semantic-filter',
      role: 'user',
      content: 'Select the relevant candidates now.',
    }],
    context: request.instructionPrompt,
    responseInstructions: [
      'Return exactly one JSON array of candidate ID strings and no prose.',
      'Do not wrap the JSON array in Markdown fences.',
      'The response must be shaped like ["candidateId", "..."].',
      'Use only candidate IDs from the provided candidate list.',
    ].join('\n'),
    mode: 'qa',
    debugLabel: 'semantic-filter',
    traceRunId: request.traceRunId,
    signal: request.signal,
  });
  traceSemanticFilterEvent(request, 'semantic_filter_raw_response', {
    prompt: request.prompt,
    windowIndex: request.windowIndex,
    windowCount: request.windowCount,
    windowLabel: request.windowLabel,
    output,
  });
  try {
    const matches = parseSemanticFilterResponse(output, new Set(request.candidates.map((candidate) => candidate.candidateId)));
    traceSemanticFilterEvent(request, 'semantic_filter_parsed_matches', {
      prompt: request.prompt,
      windowIndex: request.windowIndex,
      windowCount: request.windowCount,
      windowLabel: request.windowLabel,
      matches,
    });
    return matches;
  } catch (error) {
    traceSemanticFilterEvent(request, 'semantic_filter_parse_error', {
      prompt: request.prompt,
      windowIndex: request.windowIndex,
      windowCount: request.windowCount,
      windowLabel: request.windowLabel,
      output,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

function traceSemanticFilterEvent(
  request: Parameters<HvySemanticFilterProvider>[0],
  stage: string,
  payload: Record<string, unknown>
): void {
  if (!request.traceRunId) {
    return;
  }
  traceAgentLoopEvent({
    runId: request.traceRunId,
    phase: 'qa',
    type: 'client_event',
    payload: {
      stage,
      ...payload,
    },
    signal: request.signal,
  });
}

export function parseSemanticFilterResponse(source: string, validCandidateIds: ReadonlySet<string>): HvySemanticFilterMatch[] {
  const parsed = parseJsonArrayResponse(source);
  if (parsed.ok === false) {
    throw new Error(`Semantic filtering returned invalid JSON list. ${parsed.message}`);
  }
  const normalizedMatches = parsed.value
    .map((entry) => normalizeSemanticMatch(entry, validCandidateIds))
    .filter((entry): entry is HvySemanticFilterMatch => entry !== null);
  if (parsed.value.length > 0 && normalizedMatches.length === 0) {
    throw new Error('Semantic filtering response did not include any valid candidate IDs.');
  }
  return normalizedMatches;
}

function normalizeSemanticMatch(entry: unknown, validCandidateIds: ReadonlySet<string>): HvySemanticFilterMatch | null {
  if (typeof entry === 'string') {
    const candidateId = entry.trim();
    return candidateId && validCandidateIds.has(candidateId) ? { candidateId } : null;
  }
  return null;
}
