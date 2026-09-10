const PRESERVED_LINE_BREAK = '\u0000';

const RENDERED_BLOCK_TAGS = new Set([
  'blockquote', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'li', 'ol', 'p', 'pre',
  'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul',
]);

export function normalizeRenderedMarkdownSoftBreaks(html: string): string {
  const parts = html.split(/(<[^>]+>)/g);
  let preservedWhitespaceDepth = 0;
  return parts.map((part, index) => {
    if (part.startsWith('<') && part.endsWith('>')) {
      const tag = part.match(/^<\s*(\/)?\s*([a-z0-9-]+)/i);
      const name = tag?.[2]?.toLocaleLowerCase();
      if (name === 'pre' || name === 'code') {
        preservedWhitespaceDepth += tag?.[1] ? -1 : /\/\s*>$/.test(part) ? 0 : 1;
      }
      return part;
    }
    if (preservedWhitespaceDepth > 0 || !/\r?\n/.test(part)) {
      return part;
    }
    if (/\S/.test(part)) {
      return part.replace(/\r?\n/g, ' ');
    }
    const previousTag = getRenderedHtmlTagName(parts[index - 1]);
    const nextTag = getRenderedHtmlTagName(parts[index + 1]);
    return previousTag && nextTag && !RENDERED_BLOCK_TAGS.has(previousTag) && !RENDERED_BLOCK_TAGS.has(nextTag)
      ? ' '
      : part;
  }).join('');
}

export function renderedMarkdownHtmlToSearchText(html: string): string {
  const protectedHtml = html.replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, (pre) =>
    pre.replace(/\r?\n/g, PRESERVED_LINE_BREAK)
  );
  return decodeRenderedTextEntities(
    protectedHtml
      .replace(/<br\s*\/?\s*>/gi, '\n\n')
      .replace(/<\/(?:blockquote|div|h[1-6]|li|ol|p|pre|table|tbody|td|th|thead|tr|ul)>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
  )
    .split(/\n{2,}/)
    .map((segment) =>
      segment
        .replace(/[\t\n ]+/g, ' ')
        .trim()
        .replaceAll(PRESERVED_LINE_BREAK, '\n')
        .replace(/^\n+|\n+$/g, '')
    )
    .filter(Boolean)
    .join('\n\n');
}

function getRenderedHtmlTagName(part: string | undefined): string | null {
  return part?.match(/^<\s*\/?\s*([a-z0-9-]+)/i)?.[1]?.toLocaleLowerCase() ?? null;
}

function decodeRenderedTextEntities(value: string): string {
  return value.replace(/&(?:#(\d+)|#x([\da-f]+)|amp|apos|gt|lt|quot);/gi, (entity, decimal, hexadecimal) => {
    if (decimal) {
      return decodeRenderedTextCodePoint(entity, Number.parseInt(decimal, 10));
    }
    if (hexadecimal) {
      return decodeRenderedTextCodePoint(entity, Number.parseInt(hexadecimal, 16));
    }
    return ({
      '&amp;': '&',
      '&apos;': "'",
      '&gt;': '>',
      '&lt;': '<',
      '&quot;': '"',
    } as Record<string, string>)[entity.toLocaleLowerCase()] ?? entity;
  });
}

function decodeRenderedTextCodePoint(entity: string, codePoint: number): string {
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : entity;
}
