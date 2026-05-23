import { requestProxyCompletion, traceAgentLoopEvent } from '../chat/chat';
import { parseJsonObjectResponse } from '../llm-tool-loop';
import { state } from '../state';
import type { JsonObject } from '../hvy/types';
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
      'Return exactly one JSON object and no prose.',
      'The JSON object must be shaped like {"matches":["candidateId", "..."]}.',
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
  const parsed = parseJsonObjectResponse(source);
  if (parsed.ok === false) {
    throw new Error(`Semantic filtering returned invalid JSON. ${parsed.message}`);
  }
  const matches = Array.isArray(parsed.value.matches) ? parsed.value.matches : null;
  if (!matches) {
    throw new Error('Semantic filtering response must include a matches array.');
  }
  return matches
    .map((entry) => normalizeSemanticMatch(entry, validCandidateIds))
    .filter((entry): entry is HvySemanticFilterMatch => entry !== null);
}

function normalizeSemanticMatch(entry: unknown, validCandidateIds: ReadonlySet<string>): HvySemanticFilterMatch | null {
  if (typeof entry === 'string') {
    const candidateId = entry.trim();
    return candidateId && validCandidateIds.has(candidateId) ? { candidateId } : null;
  }
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return null;
  }
  const record = entry as JsonObject;
  const candidateId = typeof record.candidateId === 'string' ? record.candidateId.trim() : '';
  if (!candidateId || !validCandidateIds.has(candidateId)) {
    return null;
  }
  const reason = typeof record.reason === 'string' && record.reason.trim() ? record.reason.trim() : undefined;
  return {
    candidateId,
    ...(reason ? { reason } : {}),
    ...(typeof record.score === 'number' && Number.isFinite(record.score)
      ? { score: Math.max(0, Math.min(1, record.score)) }
      : {}),
  };
}
