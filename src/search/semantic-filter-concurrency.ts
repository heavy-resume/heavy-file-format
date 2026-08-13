export const DEFAULT_SEMANTIC_FILTER_CONCURRENCY = 3;

export function normalizeSemanticFilterConcurrency(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : DEFAULT_SEMANTIC_FILTER_CONCURRENCY;
}
