import type { GraphType } from './graph-chart-config';

export interface CsvParseResult {
  rows: string[][];
  error: string | null;
}

export interface GraphBuildResult {
  data: Record<string, unknown>;
  error: string | null;
}

export const DEFAULT_GRAPH_CSV = 'Label,Value\nExample A,10\nExample B,20\nExample C,15';

export function parseGraphCsv(csv: string): CsvParseResult {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (inQuotes) {
    return { rows: [], error: 'CSV contains an unclosed quoted value.' };
  }
  row.push(field);
  rows.push(row);
  const trimmedRows = rows
    .map((cells) => cells.map((cell) => cell.trim()))
    .filter((cells) => cells.some((cell) => cell.length > 0));
  if (trimmedRows.length === 0) {
    return { rows: [], error: null };
  }
  const width = trimmedRows[0]?.length ?? 0;
  if (width === 0) {
    return { rows: [], error: null };
  }
  const inconsistent = trimmedRows.some((cells) => cells.length !== width);
  return {
    rows: trimmedRows,
    error: inconsistent ? 'CSV rows must all have the same number of columns.' : null,
  };
}

export function serializeGraphCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCsvCell).join(',')).join('\n');
}

function escapeCsvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function numberOrNull(value: string): number | null {
  const normalized = value.replace(/,/g, '').trim();
  if (!normalized) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

export function buildGraphChartData(csv: string, type: GraphType): GraphBuildResult {
  const parsed = parseGraphCsv(csv);
  if (parsed.error) {
    return { data: {}, error: parsed.error };
  }
  if (parsed.rows.length < 2) {
    return { data: {}, error: 'Graph data needs a header row and at least one data row.' };
  }
  const [headers, ...bodyRows] = parsed.rows;
  if (!headers || headers.length < 2) {
    return { data: {}, error: 'Graph data needs at least two columns.' };
  }
  if (type === 'scatter' || type === 'bubble') {
    const requiredColumns = type === 'bubble' ? 3 : 2;
    if (headers.length < requiredColumns) {
      return { data: {}, error: `${type} charts need ${requiredColumns} numeric columns.` };
    }
    const points = bodyRows.map((row) => {
      const x = numberOrNull(row[0] ?? '');
      const y = numberOrNull(row[1] ?? '');
      const r = type === 'bubble' ? numberOrNull(row[2] ?? '') : null;
      return { x, y, r };
    });
    if (points.some((point) => point.x === null || point.y === null || (type === 'bubble' && point.r === null))) {
      return { data: {}, error: `${type} chart values must be numeric.` };
    }
    return {
      data: {
        datasets: [{
          label: headers[1] || 'Series 1',
          data: points.map((point) => type === 'bubble' ? { x: point.x, y: point.y, r: point.r } : { x: point.x, y: point.y }),
        }],
      },
      error: null,
    };
  }

  const labels = bodyRows.map((row) => row[0] ?? '');
  const numericColumnIndexes = headers.slice(1).map((_header, offset) => offset + 1);
  if (type === 'pie' || type === 'doughnut' || type === 'polarArea') {
    const column = numericColumnIndexes[0];
    const values = bodyRows.map((row) => numberOrNull(row[column] ?? ''));
    if (values.some((value) => value === null)) {
      return { data: {}, error: `${type} chart values must be numeric.` };
    }
    return {
      data: {
        labels,
        datasets: [{ label: headers[column] || 'Value', data: values }],
      },
      error: null,
    };
  }

  const datasets = numericColumnIndexes.map((column) => {
    const values = bodyRows.map((row) => numberOrNull(row[column] ?? ''));
    return {
      label: headers[column] || `Series ${column}`,
      data: values,
    };
  });
  if (datasets.some((dataset) => dataset.data.some((value) => value === null))) {
    return { data: {}, error: `${type} chart values must be numeric.` };
  }
  return { data: { labels, datasets }, error: null };
}

/** Rows the editor table edits; unparseable or empty text falls back to the starter data. */
export function getEditableGraphRows(csv: string): string[][] {
  const parsed = parseGraphCsv(csv.trim().length > 0 ? csv : DEFAULT_GRAPH_CSV);
  if (parsed.rows.length > 0 && !parsed.error) {
    return parsed.rows.map((row) => [...row]);
  }
  return parseGraphCsv(DEFAULT_GRAPH_CSV).rows.map((row) => [...row]);
}
