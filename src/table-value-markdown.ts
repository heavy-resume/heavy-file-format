import { marked, type Token, type Tokens } from 'marked';

import type { TableRow } from './editor/types';

export function parseStaticTableValueMarkdown(source: string, expectedColumnCount: number): TableRow[] | null {
  const trimmed = source.trim();
  if (!trimmed) {
    return null;
  }
  const meaningfulTokens = marked.lexer(trimmed, { gfm: true, breaks: false })
    .filter((token) => token.type !== 'space' && token.type !== 'def');
  if (meaningfulTokens.length !== 1 || !isTableToken(meaningfulTokens[0])) {
    return null;
  }
  const table = meaningfulTokens[0];
  if (table.raw.trim() !== trimmed || table.header.length !== expectedColumnCount) {
    return null;
  }
  return table.rows.map((row) => ({
    cells: Array.from({ length: expectedColumnCount }, (_value, index) => decodeStaticTableCell(row[index]?.text ?? '')),
  }));
}

export function serializeStaticTableValueMarkdown(columns: string[], rows: TableRow[]): string {
  const normalizedColumns = columns.length > 0 ? columns : ['Column 1'];
  const header = `| ${normalizedColumns.map(encodeStaticTableCell).join(' | ')} |`;
  const divider = `| ${normalizedColumns.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) =>
    `| ${normalizedColumns.map((_column, index) => encodeStaticTableCell(row.cells[index] ?? '')).join(' | ')} |`
  );
  return [header, divider, ...body].join('\n');
}

function isTableToken(token: Token | undefined): token is Tokens.Table {
  return token?.type === 'table' && Array.isArray((token as Tokens.Table).header);
}

function encodeStaticTableCell(value: string): string {
  const encoded = value
    .replace(/&/g, '&amp;')
    .replace(/\|/g, '&#124;')
    .replace(/\r/g, '&#13;')
    .replace(/\n/g, '&#10;')
    .replace(/\t/g, '&#9;');
  return encoded.replace(/^ +| +$/g, (spaces) => '&#32;'.repeat(spaces.length));
}

function decodeStaticTableCell(value: string): string {
  return value
    .replace(/&#13;/g, '\r')
    .replace(/&#10;/g, '\n')
    .replace(/&#9;/g, '\t')
    .replace(/&#32;/g, ' ')
    .replace(/&#124;/g, '|')
    .replace(/&amp;/g, '&');
}
