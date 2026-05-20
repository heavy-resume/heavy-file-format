export function highlightSearchHtml(html: string, query: string, caseSensitive: boolean): string {
  const trimmed = query.trim();
  if (!trimmed) {
    return html;
  }
  const pattern = new RegExp(escapeRegExp(trimmed), caseSensitive ? 'g' : 'gi');
  return html
    .split(/(<[^>]+>)/g)
    .map((part) => {
      if (part.startsWith('<') && part.endsWith('>')) {
        return part;
      }
      return part.replace(pattern, (match) => `<mark class="search-match-marker">${match}</mark>`);
    })
    .join('');
}

export function highlightPlainText(value: string, query: string, caseSensitive: boolean, escapeHtml: (value: string) => string): string {
  return highlightSearchHtml(escapeHtml(value), query, caseSensitive);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
