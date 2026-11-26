import { markdownToReaderHtml } from './markdown';
import { renderAltAnnotationsAsFullText } from './responsive-annotation-text';

export function markdownToPlainText(markdown: string): string {
  if (!markdown.trim()) {
    return '';
  }
  // Alt annotations render both full and compact spans; plain text carries the full text only.
  const html = markdownToReaderHtml(renderAltAnnotationsAsFullText(markdown));
  if (typeof document === 'undefined') {
    return decodeHtmlEntities(html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
  }
  const template = document.createElement('template');
  template.innerHTML = html;
  return (template.content.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|#39|#039);/gi, (entity, token: string) => {
    const normalized = token.toLowerCase();
    if (normalized === 'amp') return '&';
    if (normalized === 'lt') return '<';
    if (normalized === 'gt') return '>';
    if (normalized === 'quot') return '"';
    if (normalized === 'apos' || normalized === '#39' || normalized === '#039') return "'";
    if (normalized.startsWith('#x')) {
      return String.fromCodePoint(Number.parseInt(normalized.slice(2), 16));
    }
    if (normalized.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(normalized.slice(1), 10));
    }
    return entity;
  });
}
