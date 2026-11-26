export function renderAltAnnotationsAsFullText(markdown: string): string {
  return replaceAltAnnotations(markdown, (_rawJson, fullText) => fullText);
}

export function renderAltAnnotationsAsMobileText(markdown: string): string {
  return replaceAltAnnotations(markdown, (rawJson, fullText) => parseAltAnnotationPayload(rawJson)?.compact ?? fullText);
}

function replaceAltAnnotations(markdown: string, replacement: (rawJson: string, fullText: string) => string): string {
  return (markdown || '').replace(/<!--hvy:alt\s+(\{.*?\})-->([\s\S]*?)<!--\/hvy:alt-->/g, (_match, rawJson, fullText) =>
    replacement(rawJson, fullText)
  );
}

export function parseAltAnnotationPayload(rawJson: string): { compact: string } | null {
  try {
    const parsed = JSON.parse(rawJson) as { compact?: unknown };
    return typeof parsed.compact === 'string' ? { compact: parsed.compact } : null;
  } catch {
    return null;
  }
}
