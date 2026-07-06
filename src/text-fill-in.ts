export const TEXT_FILL_IN_MARKER = '<!-- value -->';
const TEXT_FILL_IN_MARKER_SOURCE = '<!--\\s*value(?:\\s+(\\{.*?\\}))?\\s*-->';
const TEXT_FILL_IN_MARKER_SPLIT_SOURCE = '<!--\\s*value(?:\\s+\\{.*?\\})?\\s*-->';
const TEXT_FILL_IN_MARKER_PATTERN = new RegExp(TEXT_FILL_IN_MARKER_SOURCE, 'g');
const TEXT_FILL_IN_MARKER_SPLIT_PATTERN = new RegExp(TEXT_FILL_IN_MARKER_SPLIT_SOURCE, 'g');
const TEXT_FILL_IN_EMPTY_EMPHASIS_PATTERN = new RegExp(`(\\*\\*\\*|___|\\*\\*|__|\\*|_)${TEXT_FILL_IN_MARKER_SPLIT_SOURCE}\\1`, 'g');

export interface TextFillInMarker {
  marker: string;
  placeholder: string;
}

export function hasTextFillInMarker(text: string): boolean {
  return findTextFillInMarkers(text).length > 0;
}

export function createTextFillInMarker(placeholder = ''): string {
  const trimmed = placeholder.trim();
  return trimmed.length > 0
    ? `<!-- value ${JSON.stringify({ placeholder: trimmed })} -->`
    : TEXT_FILL_IN_MARKER;
}

export function prepareTextFillIn(text: string): { text: string; placeholder: string } {
  if (hasTextFillInMarker(text)) {
    return { text, placeholder: '' };
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return { text: createTextFillInMarker(), placeholder: '' };
  }
  const heading = trimmed.match(/^(#{1,6}\s+)(.+)$/);
  if (heading) {
    return { text: `${heading[1]}${createTextFillInMarker(heading[2].trim())}`, placeholder: '' };
  }
  const bracketed = trimmed.match(/^\[(.*)\]$/);
  if (bracketed) {
    return { text: `[${createTextFillInMarker(bracketed[1].trim())}]`, placeholder: '' };
  }
  return { text: createTextFillInMarker(trimmed), placeholder: '' };
}

export function removeTextFillInMarkers(text: string): string {
  return text
    .replace(TEXT_FILL_IN_EMPTY_EMPHASIS_PATTERN, '')
    .replace(TEXT_FILL_IN_MARKER_SPLIT_PATTERN, '')
    .trimEnd();
}

export function applyTextFillInValue(text: string, value: string): string {
  return text.replace(TEXT_FILL_IN_MARKER_SPLIT_PATTERN, value);
}

export function applyTextFillInValueAtIndex(text: string, index: number, value: string): string {
  let currentIndex = 0;
  return text.replace(TEXT_FILL_IN_MARKER_SPLIT_PATTERN, (marker) => (currentIndex++ === index ? value : marker));
}

export function splitTextFillIn(text: string): { before: string; after: string } | null {
  const match = [...text.matchAll(TEXT_FILL_IN_MARKER_SPLIT_PATTERN)][0];
  const index = match?.index ?? -1;
  if (index < 0) {
    return null;
  }
  return {
    before: text.slice(0, index),
    after: text.slice(index + (match?.[0].length ?? 0)),
  };
}

export function splitTextFillIns(text: string): string[] {
  return text.split(TEXT_FILL_IN_MARKER_SPLIT_PATTERN);
}

export function findTextFillInMarkers(text: string): TextFillInMarker[] {
  return [...text.matchAll(TEXT_FILL_IN_MARKER_PATTERN)].map((match) => ({
    marker: match[0],
    placeholder: parseTextFillInPlaceholder(match[1]),
  }));
}

export function getTextFillInPlaceholder(text: string, index: number): string {
  return findTextFillInMarkers(text)[index]?.placeholder || 'value';
}

function parseTextFillInPlaceholder(payload: string | undefined): string {
  if (!payload) {
    return '';
  }
  try {
    const parsed = JSON.parse(payload) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) && typeof (parsed as { placeholder?: unknown }).placeholder === 'string'
      ? (parsed as { placeholder: string }).placeholder.trim()
      : '';
  } catch {
    return '';
  }
}
