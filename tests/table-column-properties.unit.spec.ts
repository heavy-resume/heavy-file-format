import { expect, test } from 'vitest';

import { defaultBlockSchema } from '../src/document-factory';
import { getTableColumnProperties, insertTableColumn, setTableColumnProperties, setTableColumns } from '../src/table-ops';

test('table column properties stay sparse and follow a unique renamed column', () => {
  const schema = defaultBlockSchema('table');
  schema.tableColumns = ['Name', 'Status'];

  setTableColumnProperties(schema, 'Name', { width: '12rem', wrap: true, align: 'left', headerAlign: 'center' });
  expect(schema.tableColumnProperties).toEqual({ Name: { width: '12rem', wrap: true } });
  expect(getTableColumnProperties(schema, 'Name')).toEqual({
    width: '12rem',
    wrap: true,
    truncate: true,
    align: 'left',
    headerAlign: 'center',
  });

  setTableColumns(schema, ['Person', 'Status']);
  expect(schema.tableColumnProperties).toEqual({ Person: { width: '12rem', wrap: true } });

  setTableColumnProperties(schema, 'Person', { width: 'auto', wrap: false });
  expect(schema.tableColumnProperties).toEqual({});
});

test('reader truncation is implicit unless explicitly disabled', () => {
  const schema = defaultBlockSchema('table');
  setTableColumnProperties(schema, 'Column 1', { truncate: true });
  expect(schema.tableColumnProperties).toEqual({});

  setTableColumnProperties(schema, 'Column 1', { truncate: false });
  expect(schema.tableColumnProperties).toEqual({ 'Column 1': { truncate: false } });
  expect(getTableColumnProperties(schema, 'Column 1').truncate).toBe(false);
});

test('duplicate labels share properties and removed labels are pruned', () => {
  const schema = defaultBlockSchema('table');
  schema.tableColumns = ['Value', 'Value'];
  setTableColumnProperties(schema, 'Value', { align: 'right' });

  expect(getTableColumnProperties(schema, schema.tableColumns[0])).toEqual(getTableColumnProperties(schema, schema.tableColumns[1]));
  setTableColumns(schema, ['Other']);
  expect(schema.tableColumnProperties).toEqual({});
});

test('inserting a table column preserves existing cell alignment', () => {
  const schema = defaultBlockSchema('table');
  schema.tableColumns = ['Role', 'Scope'];
  schema.tableRows = [
    { cells: ['Alpha', 'Open'] },
    { cells: ['Beta', 'Closed'] },
  ];

  // BEFORE: each existing cell corresponds to its original header.
  expect(schema.tableRows).toEqual([
    { cells: ['Alpha', 'Open'] },
    { cells: ['Beta', 'Closed'] },
  ]);

  // TOOL CALL: insert a blank column between the existing columns.
  insertTableColumn(schema, 1);

  // AFTER: the new cells are blank and the existing values remain under their original headers.
  expect(schema.tableColumns).toEqual(['Role', 'Column 3', 'Scope']);
  expect(schema.tableRows).toEqual([
    { cells: ['Alpha', '', 'Open'] },
    { cells: ['Beta', '', 'Closed'] },
  ]);
});
