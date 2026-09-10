export const DEFAULT_COMPONENT_EDITOR_MINIMUM_WIDTH = '300px';

const SIMPLE_CSS_LENGTH = /^(?:0|(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|ch|ex|cap|ic|lh|rlh|vw|vh|vmin|vmax|cqw|cqh|cqi|cqb|cqmin|cqmax|cm|mm|q|in|pc|pt))$/i;

export function normalizeComponentEditorMinimumWidth(value: unknown): string {
  if (typeof value !== 'string') {
    return DEFAULT_COMPONENT_EDITOR_MINIMUM_WIDTH;
  }
  const candidate = value.trim();
  if (!candidate) {
    return DEFAULT_COMPONENT_EDITOR_MINIMUM_WIDTH;
  }
  return SIMPLE_CSS_LENGTH.test(candidate)
    ? candidate
    : DEFAULT_COMPONENT_EDITOR_MINIMUM_WIDTH;
}
