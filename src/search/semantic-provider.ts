import { requestProxyCompletion } from '../chat/chat';
import { state } from '../state';
import type { HvySemanticFilterMatch, HvySemanticFilterProvider } from './types';
import { traceSemanticFilterEvent } from './semantic-trace';

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
      'Follow the semantic filter selection contract in the context exactly.',
      'Include the first-pass relevance notes requested by the context.',
      'End with one JSON array containing exactly the candidate IDs selected in the first pass.',
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

export function parseSemanticFilterResponse(source: string, validCandidateIds: ReadonlySet<string>): HvySemanticFilterMatch[] {
  const parsed = parseLastSemanticJsonArrayResponse(source);
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

function parseLastSemanticJsonArrayResponse(source: string): { ok: true; value: unknown[] } | { ok: false; message: string } {
  const trimmed = source.trim();
  let lastArray: unknown[] | null = null;
  for (let index = trimmed.length - 1; index >= 0; index -= 1) {
    if (trimmed[index] !== '[') {
      continue;
    }
    const end = findJsonValueEnd(trimmed, index);
    if (end < index) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed.slice(index, end + 1)) as unknown;
      if (Array.isArray(parsed)) {
        lastArray = parsed;
        break;
      }
    } catch {
      continue;
    }
  }
  if (lastArray) {
    return { ok: true, value: lastArray };
  }
  return { ok: false, message: 'Response did not include a parseable JSON array.' };
}

function findJsonValueEnd(source: string, startIndex: number): number {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '[') {
      stack.push(']');
      continue;
    }
    if (char === '{') {
      stack.push('}');
      continue;
    }
    if (char === ']' || char === '}') {
      if (stack.pop() !== char) {
        return -1;
      }
      if (stack.length === 0) {
        return index;
      }
    }
  }
  return -1;
}

function normalizeSemanticMatch(entry: unknown, validCandidateIds: ReadonlySet<string>): HvySemanticFilterMatch | null {
  if (typeof entry === 'string') {
    const candidateId = entry.trim();
    return candidateId && validCandidateIds.has(candidateId) ? { candidateId } : null;
  }
  return null;
}
