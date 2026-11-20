import { expect, test } from 'vitest';

import { renderTableEditorFrame, renderTableEditorGrid } from '../src/editor/components/table/table-editor-grid';

test('renderTableEditorGrid emits the shared table editor structure with optional slots', () => {
  const expectedResult = renderTableEditorGrid({
    preambleHtml: '<div class="table-editor-head"><strong>Fake Table</strong></div>',
    colgroupHtml: '<colgroup><col class="table-utility-column"><col><col class="table-add-column-column"></colgroup>',
    columns: [
      {
        thClassName: 'table-column-header-align-left',
        thAttrs: 'data-column-index="0"',
        leadingHtml: '<span class="fake-lead">::</span>',
        editableAttrs: 'contenteditable="true" data-field="fake-col"',
        contentHtml: 'Fake Header',
        removeButtonAttrs: 'data-action="fake-remove-col"',
        afterHeadHtml: '<span class="fake-resize"></span>',
      },
    ],
    addColumnButtonAttrs: 'data-action="fake-add-col"',
    rows: [
      {
        trClassName: 'table-row-editor-empty',
        trAttrs: 'data-row-index="0"',
        leadingHtml: '<span class="fake-row-lead">::</span>',
        cells: [
          {
            tdClassName: 'table-column-align-right',
            tdAttrs: 'data-table-column-index="0"',
            editableAttrs: 'contenteditable="true" data-field="fake-cell"',
            contentHtml: 'Fake Value',
          },
        ],
        removeButtonAttrs: 'data-action="fake-remove-row"',
      },
    ],
    addRowButtonAttrs: 'data-action="fake-add-row"',
  });

  expect(expectedResult).toContain('<div class="table-editor"><div class="table-editor-head"><strong>Fake Table</strong></div><div class="table-editor-frame">');
  expect(expectedResult).toContain('style="--hvy-table-editor-columns: 1;"');
  expect(expectedResult).toContain('<colgroup>');
  expect(expectedResult).toContain('<th class="table-column-header-align-left" data-column-index="0">');
  expect(expectedResult).toContain('<div class="table-column-head">');
  expect(expectedResult).toContain('<span class="fake-lead">::</span>');
  expect(expectedResult).toContain('<div class="inline-editable table-inline-text table-column-name" contenteditable="true" data-field="fake-col">Fake Header</div>');
  expect(expectedResult).toContain('data-action="fake-remove-col" title="Remove column"');
  expect(expectedResult).toContain('<span class="fake-resize"></span>');
  expect(expectedResult).toContain('data-action="fake-add-col" title="Add column"');
  expect(expectedResult).toContain('<tr class="table-row-editor table-row-editor-main table-row-editor-empty" data-row-index="0">');
  expect(expectedResult).toContain('<td class="table-column-align-right" data-table-column-index="0">');
  expect(expectedResult).toContain('data-action="fake-remove-row" title="Remove row"');
  expect(expectedResult).toContain('<td colspan="3">');
  expect(expectedResult).toContain('data-action="fake-add-row"');
});

test('renderTableEditorGrid omits remove and add-column buttons when disabled', () => {
  const expectedResult = renderTableEditorGrid({
    columns: [
      {
        editableAttrs: 'contenteditable="false"',
        contentHtml: 'Only Column',
        removeButtonAttrs: null,
      },
    ],
    addColumnButtonAttrs: null,
    rows: [
      {
        cells: [{ editableAttrs: 'contenteditable="true"', contentHtml: 'Cell' }],
        removeButtonAttrs: null,
      },
    ],
    addRowButtonAttrs: 'data-action="fake-add-row"',
  });

  expect(expectedResult).not.toContain('title="Remove column"');
  expect(expectedResult).not.toContain('title="Add column"');
  expect(expectedResult).not.toContain('title="Remove row"');
  expect(expectedResult).toContain('<th class="table-add-column-cell"></th>');
});

test('renderTableEditorFrame wraps non-grid content in the shared table editor frame', () => {
  const expectedResult = renderTableEditorFrame('<div class="fake-error">Bad CSV</div>');

  expect(expectedResult).toBe('<div class="table-editor"><div class="table-editor-frame"><div class="fake-error">Bad CSV</div></div></div>');
});
