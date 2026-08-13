import type {
  HvySemanticFilterMatch,
  HvySemanticFilterProvider,
  HvySemanticFilterProviderResponse,
  HvySemanticFilterRequest,
} from './types';
import { traceSemanticFilterEvent } from './semantic-trace';
import { normalizeSemanticFilterMaxAttempts } from './semantic-filter-attempts';

const SEMANTIC_FILTER_REPAIR_INSTRUCTION = [
  'This response does not follow the required format.',
  'End with one JSON array containing only candidate IDs from the supplied candidate list.',
  'Use canonical candidate IDs; preserve prefixes such as "component:".',
  'Return the corrected response now.',
].join(' ');

export async function requestSemanticFilterMatches(
  provider: HvySemanticFilterProvider,
  request: HvySemanticFilterRequest,
  options: { maxAttempts?: number } = {},
): Promise<HvySemanticFilterMatch[]> {
  const maxAttempts = normalizeSemanticFilterMaxAttempts(options.maxAttempts);
  let lastParseError: unknown = null;
  const { repair: _incomingRepair, attempt: _incomingAttempt, ...baseRequest } = request;

  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
    const freshRequest: HvySemanticFilterRequest = {
      ...baseRequest,
      attempt: { number: attemptNumber, total: maxAttempts },
    };
    let freshResponse: HvySemanticFilterProviderResponse;
    try {
      freshResponse = await provider(freshRequest);
    } catch (providerError) {
      throw providerError;
    }
    try {
      return normalizeAndTraceSemanticFilterResponse(freshResponse, freshRequest);
    } catch (parseError) {
      traceSemanticFilterParseError(freshResponse, freshRequest, parseError);
      lastParseError = parseError;
      if (typeof freshResponse !== 'string') {
        throw parseError;
      }
    }

    const repairRequest: HvySemanticFilterRequest = {
      ...freshRequest,
      repair: {
        previousResponse: freshResponse,
        instruction: buildSemanticFilterRepairInstruction(lastParseError),
      },
    };
    let repairResponse: HvySemanticFilterProviderResponse;
    try {
      repairResponse = await provider(repairRequest);
    } catch (providerError) {
      console.error('[HVY] Semantic filter repair request failed.', providerError);
      throw new Error(
        'Semantic filtering returned an invalid response, and the repair request could not be completed. Try again.',
        { cause: providerError },
      );
    }
    try {
      return normalizeAndTraceSemanticFilterResponse(repairResponse, repairRequest);
    } catch (parseError) {
      traceSemanticFilterParseError(repairResponse, repairRequest, parseError);
      lastParseError = parseError;
      if (typeof repairResponse !== 'string') {
        throw parseError;
      }
    }
  }

  if (lastParseError) {
    throw lastParseError;
  }
  throw new Error('Semantic filtering exhausted its configured attempts.');
}

function buildSemanticFilterRepairInstruction(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `${SEMANTIC_FILTER_REPAIR_INSTRUCTION} Validation error: ${detail}`;
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
    const candidateId = resolveSemanticCandidateId(entry.trim(), validCandidateIds);
    return candidateId ? { candidateId } : null;
  }
  return null;
}

function resolveSemanticCandidateId(candidateId: string, validCandidateIds: ReadonlySet<string>): string | null {
  if (!candidateId) {
    return null;
  }
  if (validCandidateIds.has(candidateId)) {
    return candidateId;
  }
  const canonicalComponentId = `component:${candidateId}`;
  return validCandidateIds.has(canonicalComponentId) ? canonicalComponentId : null;
}
