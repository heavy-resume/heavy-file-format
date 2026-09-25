export const DEFAULT_COMPONENT_EDITOR_MINIMUM_WIDTH = '300px';

/** Width the component editor modal opens at when a component does not ask for a snugger panel. */
export const DEFAULT_COMPONENT_EDITOR_PREFERRED_WIDTH = '760px';

const SIMPLE_CSS_LENGTH = /^(?:0|(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|ch|ex|cap|ic|lh|rlh|vw|vh|vmin|vmax|cqw|cqh|cqi|cqb|cqmin|cqmax|cm|mm|q|in|pc|pt))$/i;

export function normalizeComponentEditorMinimumWidth(value: unknown): string {
  return normalizeComponentEditorWidth(value, DEFAULT_COMPONENT_EDITOR_MINIMUM_WIDTH);
}

export function normalizeComponentEditorPreferredWidth(value: unknown): string {
  return normalizeComponentEditorWidth(value, DEFAULT_COMPONENT_EDITOR_PREFERRED_WIDTH);
}

function normalizeComponentEditorWidth(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const candidate = value.trim();
  if (!candidate) {
    return fallback;
  }
  return SIMPLE_CSS_LENGTH.test(candidate) ? candidate : fallback;
}
