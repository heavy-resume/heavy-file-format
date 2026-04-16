import type { BlockSchema } from './editor/types';
import { moveItem } from './utils';

export function splitColumns(value: string): string[] {
  const columns = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return columns.length > 0 ? columns : ['Column 1', 'Column 2'];
}

export function normalizeTableColumns(columns: string[]): string[] {
  const cleaned = columns.map((column) => column.trim());
  const nonEmpty = cleaned.filter((column) => column.length > 0);
  const source = nonEmpty.length > 0 ? cleaned : ['Column 1', 'Column 2'];
  return source.map((column, index) => column.trim() || `Column ${index + 1}`);
}

export function getTableColumns(schema: BlockSchema): string[] {
  return normalizeTableColumns(splitColumns(schema.tableColumns));
}

export function setTableColumns(schema: BlockSchema, columns: string[]): void {
  const normalized = normalizeTableColumns(columns);
  schema.tableColumns = normalized.join(', ');
  schema.tableRows = schema.tableRows.map((row) => ({
    ...row,
    cells: normalized.map((_, index) => row.cells[index] ?? ''),
  }));
}

export function addTableColumn(schema: BlockSchema): void {
  const columns = getTableColumns(schema);
  const nextColumns = [...columns, `Column ${columns.length + 1}`];
  setTableColumns(schema, nextColumns);
}

export function removeTableColumn(schema: BlockSchema, columnIndex: number): void {
  const columns = getTableColumns(schema);
  if (columns.length <= 1 || columnIndex < 0 || columnIndex >= columns.length) {
    return;
  }
  const nextColumns = columns.filter((_, index) => index !== columnIndex);
  setTableColumns(schema, nextColumns);
}

export function moveTableColumn(schema: BlockSchema, fromIndex: number, toIndex: number): void {
  const columns = getTableColumns(schema);
  if (fromIndex === toIndex) {
    return;
  }
  const nextColumns = moveItem(columns, fromIndex, toIndex);
  const rows = schema.tableRows.map((row) => ({
    ...row,
    cells: moveItem(nextColumns.map((_, index) => row.cells[index] ?? ''), fromIndex, toIndex),
  }));
  schema.tableRows = rows;
  schema.tableColumns = nextColumns.join(', ');
}

export function moveTableRow(schema: BlockSchema, fromIndex: number, toIndex: number): void {
  if (fromIndex === toIndex) {
    return;
  }
  schema.tableRows = moveItem(schema.tableRows, fromIndex, toIndex);
}
