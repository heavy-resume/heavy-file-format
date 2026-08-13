import type { HvySemanticFilterMatch, HvySemanticFilterProviderResponse } from './types';

export function normalizeSemanticFilterProviderResponse(
  response: HvySemanticFilterProviderResponse,
  validCandidateIds: ReadonlySet<string>,
): HvySemanticFilterMatch[] {
  return typeof response === 'string'
    ? parseSemanticFilterResponse(response, validCandidateIds)
    : response;
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
