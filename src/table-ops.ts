import type { BlockSchema, TableColumnProperties, TableRow } from './editor/types';
import { moveItem } from './utils';

export const DEFAULT_TABLE_COLUMN_PROPERTIES: Required<TableColumnProperties> = {
  width: 'auto',
  wrap: false,
  truncate: true,
  align: 'left',
  headerAlign: 'center',
};

export function normalizeTableColumns(columns: string[]): string[] {
  const cleaned = columns.map((column) => column.trim());
  const nonEmpty = cleaned.filter((column) => column.length > 0);
  const source = nonEmpty.length > 0 ? cleaned : ['Column 1', 'Column 2'];
  return source.map((column, index) => column.trim() || `Column ${index + 1}`);
}

export function getTableColumns(schema: BlockSchema): string[] {
  return normalizeTableColumns(schema.tableColumns);
}

export function getTableColumnProperties(schema: BlockSchema, column: string): Required<TableColumnProperties> {
  return {
    ...DEFAULT_TABLE_COLUMN_PROPERTIES,
    ...(schema.tableColumnProperties?.[column] ?? {}),
  };
}

export function setTableColumnProperties(
  schema: BlockSchema,
  column: string,
  patch: Partial<TableColumnProperties>
): void {
  schema.tableColumnProperties ??= {};
  const current = schema.tableColumnProperties[column] ?? {};
  const next: TableColumnProperties = { ...current, ...patch };
  if (!next.width || next.width.trim() === 'auto') delete next.width;
  else next.width = next.width.trim();
  if (next.wrap !== true) delete next.wrap;
  if (next.truncate !== false) delete next.truncate;
  if (!next.align || next.align === DEFAULT_TABLE_COLUMN_PROPERTIES.align) delete next.align;
  if (!next.headerAlign || next.headerAlign === DEFAULT_TABLE_COLUMN_PROPERTIES.headerAlign) delete next.headerAlign;
  if (Object.keys(next).length === 0) {
    delete schema.tableColumnProperties[column];
    return;
  }
  schema.tableColumnProperties[column] = next;
}

export function setTableColumns(schema: BlockSchema, columns: string[]): void {
  schema.tableColumnProperties ??= {};
  const previousColumns = getTableColumns(schema);
  const normalized = normalizeTableColumns(columns);
  previousColumns.forEach((previousColumn, index) => {
    const nextColumn = normalized[index];
    if (!nextColumn || nextColumn === previousColumn || !schema.tableColumnProperties[previousColumn]) {
      return;
    }
    const previousWasUnique = previousColumns.filter((column) => column === previousColumn).length === 1;
    const nextIsUnique = normalized.filter((column) => column === nextColumn).length === 1;
    if (previousWasUnique && nextIsUnique && !schema.tableColumnProperties[nextColumn]) {
      schema.tableColumnProperties[nextColumn] = schema.tableColumnProperties[previousColumn];
      delete schema.tableColumnProperties[previousColumn];
    }
  });
  schema.tableColumns = normalized;
  for (const column of Object.keys(schema.tableColumnProperties)) {
    if (!normalized.includes(column)) {
      delete schema.tableColumnProperties[column];
    }
  }
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

export function insertTableColumn(schema: BlockSchema, columnIndex: number): void {
  const columns = getTableColumns(schema);
  const insertionIndex = Math.min(Math.max(columnIndex, 0), columns.length);
  const nextColumns = [...columns];
  nextColumns.splice(insertionIndex, 0, `Column ${columns.length + 1}`);
  schema.tableColumns = nextColumns;
  schema.tableRows = schema.tableRows.map((row) => {
    const cells = columns.map((_column, index) => row.cells[index] ?? '');
    cells.splice(insertionIndex, 0, '');
    return { ...row, cells };
  });
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
  schema.tableColumns = nextColumns;
}

export function moveTableRow(schema: BlockSchema, fromIndex: number, toIndex: number): void {
  if (fromIndex === toIndex) {
    return;
  }
  schema.tableRows = moveItem(schema.tableRows, fromIndex, toIndex);
}

export function createKeyboardInsertedTableRow(columnCount: number): TableRow {
  return {
    cells: new Array(Math.max(columnCount, 1)).fill(''),
    editorCreatedByEnter: true,
  };
}

export function isEmptyTableRow(row: TableRow, columnCount: number): boolean {
  const cellCount = Math.max(columnCount, row.cells.length, 1);
  return Array.from({ length: cellCount }).every((_item, cellIndex) => (row.cells[cellIndex] ?? '').trim().length === 0);
}

export function pruneEmptyKeyboardInsertedTableRows(schema: BlockSchema): boolean {
  const columnCount = getTableColumns(schema).length;
  const nextRows = schema.tableRows.filter((row) => !row.editorCreatedByEnter || !isEmptyTableRow(row, columnCount));
  if (nextRows.length === schema.tableRows.length) {
    return false;
  }
  schema.tableRows = nextRows;
  return true;
}
