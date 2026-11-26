import './table.css';
import { closeIcon, plusIcon } from '../../../icons';

export interface TableEditorGridColumn {
  thClassName?: string;
  thAttrs?: string;
  leadingHtml?: string;
  editableAttrs: string;
  contentHtml: string;
  removeButtonAttrs?: string | null;
  afterHeadHtml?: string;
}

export interface TableEditorGridCell {
  tdClassName?: string;
  tdAttrs?: string;
  editableAttrs: string;
  contentHtml: string;
}

export interface TableEditorGridRow {
  trClassName?: string;
  trAttrs?: string;
  leadingHtml?: string;
  cells: TableEditorGridCell[];
  removeButtonAttrs?: string | null;
}

export interface TableEditorGridOptions {
  preambleHtml?: string;
  colgroupHtml?: string;
  columns: TableEditorGridColumn[];
  addColumnButtonAttrs?: string | null;
  rows: TableEditorGridRow[];
  addRowButtonAttrs: string;
}

function attrSuffix(attrs?: string | null): string {
  const trimmed = attrs?.trim();
  return trimmed ? ` ${trimmed}` : '';
}

function classAttr(className?: string): string {
  const trimmed = className?.trim();
  return trimmed ? ` class="${trimmed}"` : '';
}

export function renderTableEditorFrame(contentHtml: string, preambleHtml = ''): string {
  return `<div class="table-editor">${preambleHtml}<div class="table-editor-frame">${contentHtml}</div></div>`;
}

export function renderTableEditorGrid(options: TableEditorGridOptions): string {
  const columnCount = Math.max(options.columns.length, 1);
  const headerCells = options.columns
    .map((column) => {
      const removeButton = column.removeButtonAttrs != null
        ? `<button type="button" class="danger remove-x"${attrSuffix(column.removeButtonAttrs)} title="Remove column">${closeIcon()}</button>`
        : '';
      return `<th${classAttr(column.thClassName)}${attrSuffix(column.thAttrs)}>
        <div class="table-column-head">
          ${column.leadingHtml ?? ''}
          <div class="table-inline-edit-shell">
            <div class="inline-editable table-inline-text table-column-name"${attrSuffix(column.editableAttrs)}>${column.contentHtml}</div>
          </div>
          ${removeButton}
        </div>
        ${column.afterHeadHtml ?? ''}
      </th>`;
    })
    .join('');

  const addColumnButton = options.addColumnButtonAttrs != null
    ? `<button type="button" class="ghost table-add-button"${attrSuffix(options.addColumnButtonAttrs)} title="Add column" aria-label="Add column">${plusIcon()}</button>`
    : '';

  const bodyRows = options.rows
    .map((row) => {
      const rowClasses = ['table-row-editor', 'table-row-editor-main', row.trClassName?.trim() ?? '']
        .filter(Boolean)
        .join(' ');
      const cells = row.cells
        .map((cell) => `<td${classAttr(cell.tdClassName)}${attrSuffix(cell.tdAttrs)}>
          <div class="table-inline-edit-shell">
            <div class="inline-editable table-inline-text"${attrSuffix(cell.editableAttrs)}>${cell.contentHtml}</div>
          </div>
        </td>`)
        .join('');
      const removeButton = row.removeButtonAttrs != null
        ? `<button type="button" class="danger remove-x"${attrSuffix(row.removeButtonAttrs)} title="Remove row">${closeIcon()}</button>`
        : '';
      return `<tr class="${rowClasses}"${attrSuffix(row.trAttrs)}>
        <td class="table-row-utility">${row.leadingHtml ?? ''}</td>
        ${cells}
        <td class="table-row-utility table-row-remove-cell">${removeButton}</td>
      </tr>`;
    })
    .join('');

  const tableHtml = `<table class="table-editor-grid" style="--hvy-table-editor-columns: ${columnCount};">
    ${options.colgroupHtml ?? ''}
    <thead>
      <tr>
        <th class="table-utility-cell"></th>
        ${headerCells}
        <th class="table-add-column-cell">${addColumnButton}</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows}
      <tr class="table-add-row-line">
        <td colspan="${columnCount + 2}">
          <button type="button" class="ghost"${attrSuffix(options.addRowButtonAttrs)}>${plusIcon()} Row</button>
        </td>
      </tr>
    </tbody>
  </table>`;

  return renderTableEditorFrame(tableHtml, options.preambleHtml ?? '');
}
