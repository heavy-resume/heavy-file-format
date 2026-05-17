export function formatQueryResultTable(columns: string[], rows: string[][]): string {
  return [
    columns.join(' | '),
    columns.map(() => '---').join(' | '),
    ...rows.map((row) => row.map((cell) => cell.replaceAll('\n', '\\n').replaceAll('|', '\\|')).join(' | ')),
  ].join('\n');
}
