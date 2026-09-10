export const DEFAULT_SEMANTIC_FILTER_MAX_ATTEMPTS = 1;

export function normalizeSemanticFilterMaxAttempts(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : DEFAULT_SEMANTIC_FILTER_MAX_ATTEMPTS;
}
