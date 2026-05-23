import { requestProxyCompletion } from '../chat/chat';
import { parseJsonObjectResponse } from '../llm-tool-loop';
import { state } from '../state';
import type { JsonObject } from '../hvy/types';
import type { HvySemanticFilterMatch, HvySemanticFilterProvider } from './types';

export const chatSemanticFilterProvider: HvySemanticFilterProvider = async (request) => {
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
    signal: request.signal,
  });
  return parseSemanticFilterResponse(output, new Set(request.candidates.map((candidate) => candidate.candidateId)));
};

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
