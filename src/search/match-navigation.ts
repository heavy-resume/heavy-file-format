import type { HvySearchMatch, HvySearchResult } from './types';

const MATCH_NAVIGATION_ID_SEPARATOR = '::hvy-match:';

export function expandSearchMatchResults(results: HvySearchResult[]): HvySearchResult[] {
  return results.flatMap((result) => getResultMatches(result).map((match, index) => ({
    ...result,
    id: index === 0 ? result.id : `${result.id}${MATCH_NAVIGATION_ID_SEPARATOR}${index}`,
    preview: match.preview,
    matchedText: match.matchedText,
    matchOrdinal: match.matchOrdinal ?? index,
    sourceField: match.label || result.sourceField,
    matches: [match],
  })));
}

export function getSearchComponentResultId(navigationResultId: string): string {
  return navigationResultId.split(MATCH_NAVIGATION_ID_SEPARATOR, 1)[0] ?? navigationResultId;
}

function getResultMatches(result: HvySearchResult): HvySearchMatch[] {
  if (result.matches?.length) {
    return result.matches;
  }
  return [{
    field: result.sourceField,
    label: result.sourceField,
    preview: result.preview,
    matchedText: result.matchedText,
    matchOrdinal: result.matchOrdinal ?? 0,
  }];
}
