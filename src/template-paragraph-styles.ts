import { Lexer } from 'marked';

/** Carry a placeholder's line style into subsequent plain Markdown paragraphs. */
export function inheritTemplateParagraphStyle(template: string, offset: number, value: string): string {
  if (!/[\r\n]/.test(value)) return value;
  const before = template.slice(0, offset).replace(/\r\n?/g, '\n');
  const marker = before.slice(before.lastIndexOf('\n') + 1).match(/^\^([a-z0-9_-]+)\^\s?/i)?.[0];
  if (!marker) return value;

  // A marker in a code block is literal, even when it precedes a template token.
  let position = 0;
  const sourceToken = Lexer.lex(template.replace(/\r\n?/g, '\n')).find((token) => {
    const start = position;
    position += token.raw.length;
    return start <= before.length && before.length < position;
  });
  if (sourceToken?.type !== 'paragraph') return value;

  let valueOffset = 0;
  return Lexer.lex(value).map((token) => {
    const start = valueOffset;
    valueOffset += token.raw.length;
    // Keep soft wraps together, preserve explicit styles, and leave structural
    // Markdown (including code, lists and tables) intact.
    if (start === 0 || token.type !== 'paragraph' || /^\\?\^[a-z0-9_-]+\^/i.test(token.raw)) {
      return token.raw;
    }
    return `${marker.trimEnd()} ${token.raw}`;
  }).join('');
}
