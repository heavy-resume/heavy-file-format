import type {
  HvySemanticFilterMatch,
  HvySemanticFilterProvider,
  HvySemanticFilterProviderResponse,
  HvySemanticFilterRequest,
} from './types';
import { traceSemanticFilterEvent } from './semantic-trace';

const SEMANTIC_FILTER_REPAIR_INSTRUCTION = [
  'This response does not follow the required format.',
  'End with one JSON array containing only candidate IDs from the supplied candidate list.',
  'Return the corrected response now.',
].join(' ');

export async function requestSemanticFilterMatches(
  provider: HvySemanticFilterProvider,
  request: HvySemanticFilterRequest,
): Promise<HvySemanticFilterMatch[]> {
  const response = await provider(request);
  try {
    return normalizeAndTraceSemanticFilterResponse(response, request);
  } catch (error) {
    traceSemanticFilterParseError(response, request, error);
    if (typeof response !== 'string' || request.repair) {
      throw error;
    }
    const repairRequest: HvySemanticFilterRequest = {
      ...request,
      repair: {
        previousResponse: response,
        instruction: SEMANTIC_FILTER_REPAIR_INSTRUCTION,
      },
    };
    let repairedResponse: HvySemanticFilterProviderResponse;
    try {
      repairedResponse = await provider(repairRequest);
    } catch (repairRequestError) {
      console.error('[HVY] Semantic filter repair request failed.', repairRequestError);
      throw new Error(
        'Semantic filtering returned an invalid response, and the repair request could not be completed. Try again.',
        { cause: repairRequestError },
      );
    }
    try {
      return normalizeAndTraceSemanticFilterResponse(repairedResponse, repairRequest);
    } catch (repairError) {
      traceSemanticFilterParseError(repairedResponse, repairRequest, repairError);
      throw repairError;
    }
  }
}

export function normalizeSemanticFilterProviderResponse(
  response: HvySemanticFilterProviderResponse,
  validCandidateIds: ReadonlySet<string>,
): HvySemanticFilterMatch[] {
  return typeof response === 'string'
    ? parseSemanticFilterResponse(response, validCandidateIds)
    : response;
}

function getValidCandidateIds(request: HvySemanticFilterRequest): ReadonlySet<string> {
  return new Set(request.candidates.map((candidate) => candidate.candidateId));
}

function normalizeAndTraceSemanticFilterResponse(
  response: HvySemanticFilterProviderResponse,
  request: HvySemanticFilterRequest,
): HvySemanticFilterMatch[] {
  const matches = normalizeSemanticFilterProviderResponse(response, getValidCandidateIds(request));
  traceSemanticFilterEvent(request, 'semantic_filter_parsed_matches', {
    prompt: request.prompt,
    windowIndex: request.windowIndex,
    windowCount: request.windowCount,
    windowLabel: request.windowLabel,
    matches,
  });
  return matches;
}

function traceSemanticFilterParseError(
  response: HvySemanticFilterProviderResponse,
  request: HvySemanticFilterRequest,
  error: unknown,
): void {
  traceSemanticFilterEvent(request, 'semantic_filter_parse_error', {
    prompt: request.prompt,
    windowIndex: request.windowIndex,
    windowCount: request.windowCount,
    windowLabel: request.windowLabel,
    output: response,
    error: error instanceof Error ? error.message : String(error),
  });
}

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
