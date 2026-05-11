export const TEXT_FILL_IN_MARKER = '<!-- value -->';

export function hasTextFillInMarker(text: string): boolean {
  return text.includes(TEXT_FILL_IN_MARKER);
}

export function prepareTextFillIn(text: string): { text: string; placeholder: string } {
  if (hasTextFillInMarker(text)) {
    return { text, placeholder: '' };
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return { text: TEXT_FILL_IN_MARKER, placeholder: '' };
  }
  const heading = trimmed.match(/^(#{1,6}\s+)(.+)$/);
  if (heading) {
    return { text: `${heading[1]}${TEXT_FILL_IN_MARKER}`, placeholder: heading[2].trim() };
  }
  const bracketed = trimmed.match(/^\[(.*)\]$/);
  if (bracketed) {
    return { text: `[${TEXT_FILL_IN_MARKER}]`, placeholder: bracketed[1].trim() };
  }
  return { text: TEXT_FILL_IN_MARKER, placeholder: trimmed };
}

export function removeTextFillInMarkers(text: string): string {
  return text.replaceAll(TEXT_FILL_IN_MARKER, '').trimEnd();
}

export function applyTextFillInValue(text: string, value: string): string {
  return text.replace(TEXT_FILL_IN_MARKER, value);
}

export function applyTextFillInValueAtIndex(text: string, index: number, value: string): string {
  let currentIndex = 0;
  return text.replaceAll(TEXT_FILL_IN_MARKER, () => (currentIndex++ === index ? value : TEXT_FILL_IN_MARKER));
}

export function splitTextFillIn(text: string): { before: string; after: string } | null {
  const index = text.indexOf(TEXT_FILL_IN_MARKER);
  if (index < 0) {
    return null;
  }
  return {
    before: text.slice(0, index),
    after: text.slice(index + TEXT_FILL_IN_MARKER.length),
  };
}

export function splitTextFillIns(text: string): string[] {
  return text.split(TEXT_FILL_IN_MARKER);
}

export function getTextFillInPlaceholder(placeholder: string, index: number): string {
  const placeholders = placeholder.split(',').map((value) => value.trim()).filter(Boolean);
  return placeholders[index] ?? placeholders[0] ?? 'value';
}
