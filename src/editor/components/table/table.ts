import './table.css';
import type { ComponentEditorRenderer, ComponentReaderRenderer } from '../../component-helpers';
import type { TableRow } from '../../types';

let readerTableStripeIndex = 0;

export function resetReaderTableStripeSequence(): void {
  readerTableStripeIndex = 0;
}

function getNextReaderTableStripeClass(): 'even' | 'odd' {
  const stripe = readerTableStripeIndex % 2 === 0 ? 'even' : 'odd';
  readerTableStripeIndex += 1;
  return stripe;
}

function renderTableInlineEditorHtml(value: string, helpers: Parameters<ComponentEditorRenderer>[2]): string {
  return helpers.markdownToEditorHtml(value).replace(/^<p>([\s\S]*)<\/p>$/i, '$1');
}

function renderTableInlineReaderHtml(value: string, block: Parameters<ComponentReaderRenderer>[1], helpers: Parameters<ComponentReaderRenderer>[2]): string {
  return helpers.renderComponentFragment('text', value, block);
}

function renderTableInlineToolbar(
  sectionKey: string,
  blockId: string,
  field: 'table-column' | 'table-cell',
  helpers: Parameters<ComponentEditorRenderer>[2],
  indices: { columnIndex?: number; rowIndex?: number; cellIndex?: number }
): string {
  const rowAttrs = indices.rowIndex === undefined ? '' : ` data-row-index="${indices.rowIndex}"`;
  const columnAttrs = indices.columnIndex === undefined ? '' : ` data-column-index="${indices.columnIndex}"`;
  const cellAttrs = indices.cellIndex === undefined ? '' : ` data-cell-index="${indices.cellIndex}"`;
  return `<div class="table-inline-toolbar" aria-label="Table inline tools">
    <button type="button" class="ghost" data-rich-action="short" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(blockId)}" data-rich-field="${field}"${rowAttrs}${columnAttrs}${cellAttrs} title="Short text">Short</button>
    <button type="button" class="ghost" data-rich-action="nowrap" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(blockId)}" data-rich-field="${field}"${rowAttrs}${columnAttrs}${cellAttrs} title="No wrap">Nowrap</button>
  </div>`;
}

function renderTableRowEditor(
  sectionKey: string,
  blockId: string,
  columns: string[],
  row: TableRow,
  rowIndex: number,
  helpers: Parameters<ComponentEditorRenderer>[2]
): string {
  const safeColumns = columns.length > 0 ? columns : ['Column 1', 'Column 2'];
  return `
    <tr class="table-row-editor table-row-editor-main" data-table-row-drop="true" data-row-index="${rowIndex}">
      <td class="table-row-utility">
        <button
          type="button"
          class="table-drag-handle"
          draggable="true"
          data-drag-handle="table-row"
          data-section-key="${helpers.escapeAttr(sectionKey)}"
          data-block-id="${helpers.escapeAttr(blockId)}"
          data-row-index="${rowIndex}"
          title="Drag to reorder row"
        >::</button>
      </td>
      ${safeColumns
        .map(
          (_column, cellIndex) => `<td>
            <div class="table-inline-edit-shell">
              <div
                class="inline-editable table-inline-text"
                contenteditable="true"
                spellcheck="false"
                data-inline-text="true"
                data-section-key="${helpers.escapeAttr(sectionKey)}"
                data-block-id="${helpers.escapeAttr(blockId)}"
                data-row-index="${rowIndex}"
                data-cell-index="${cellIndex}"
                data-field="table-cell"
                data-placeholder="${helpers.escapeAttr(safeColumns[cellIndex] || 'Cell value')}"
              >${renderTableInlineEditorHtml(row.cells[cellIndex] ?? '', helpers)}</div>
              ${renderTableInlineToolbar(sectionKey, blockId, 'table-cell', helpers, { rowIndex, cellIndex })}
            </div>
          </td>`
        )
        .join('')}
      <td class="table-row-utility table-row-remove-cell">
        <button type="button" class="danger remove-x" data-action="remove-table-row" data-section-key="${helpers.escapeAttr(
          sectionKey
        )}" data-block-id="${helpers.escapeAttr(blockId)}" data-row-index="${rowIndex}" title="Remove row">×</button>
      </td>
    </tr>
  `;
}

export const renderTableEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => {
  const columns = helpers.getTableColumns(block.schema);
  return `
    <div class="table-editor">
      <div class="table-editor-head">
        <strong>Inline Table Editor</strong>
        <span>Rename headers, edit cells in place, and drag handles to reorder.</span>
      </div>
      <label class="table-header-toggle">
        <input
          type="checkbox"
          data-section-key="${helpers.escapeAttr(sectionKey)}"
          data-block-id="${helpers.escapeAttr(block.id)}"
          data-field="table-show-header"
          ${block.schema.tableShowHeader ? 'checked' : ''}
        />
        Show header row
      </label>
      <div class="table-editor-frame">
        <table class="table-editor-grid" style="--hvy-table-editor-columns: ${Math.max(columns.length, 1)};">
          <thead>
            <tr>
              <th class="table-utility-cell"></th>
              ${columns
                .map(
                  (column, columnIndex) => `
                    <th data-table-column-drop="true" data-column-index="${columnIndex}">
                      <div class="table-column-head">
                        <button
                          type="button"
                          class="table-drag-handle"
                          draggable="true"
                          ${block.schema.lock ? 'disabled' : ''}
                          data-drag-handle="table-column"
                          data-section-key="${helpers.escapeAttr(sectionKey)}"
                          data-block-id="${helpers.escapeAttr(block.id)}"
                          data-column-index="${columnIndex}"
                          title="Drag to reorder column"
                        >::</button>
                        <div class="table-inline-edit-shell">
                          <div
                            class="inline-editable table-inline-text table-column-name"
                            contenteditable="${block.schema.lock ? 'false' : 'true'}"
                            spellcheck="false"
                            data-inline-text="true"
                            data-section-key="${helpers.escapeAttr(sectionKey)}"
                            data-block-id="${helpers.escapeAttr(block.id)}"
                            data-column-index="${columnIndex}"
                            data-field="table-column"
                          >${renderTableInlineEditorHtml(column, helpers)}</div>
                          ${renderTableInlineToolbar(sectionKey, block.id, 'table-column', helpers, { columnIndex })}
                        </div>
                        ${
                          block.schema.lock
                            ? ''
                            : `<button type="button" class="danger remove-x" data-action="remove-table-column" data-section-key="${helpers.escapeAttr(
                                sectionKey
                              )}" data-block-id="${helpers.escapeAttr(block.id)}" data-column-index="${columnIndex}" title="Remove column">×</button>`
                        }
                      </div>
                    </th>`
                )
                .join('')}
              <th class="table-add-column-cell">
                ${
                  block.schema.lock
                    ? ''
                    : `<button type="button" class="ghost table-add-button" data-action="add-table-column" data-section-key="${helpers.escapeAttr(
                        sectionKey
                      )}" data-block-id="${helpers.escapeAttr(block.id)}" title="Add column">+</button>`
                }
              </th>
            </tr>
          </thead>
          <tbody>
            ${block.schema.tableRows.map((row, rowIndex) => renderTableRowEditor(sectionKey, block.id, columns, row, rowIndex, helpers)).join('')}
            <tr class="table-add-row-line">
              <td colspan="${columns.length + 2}">
                <button type="button" class="ghost" data-action="add-table-row" data-section-key="${helpers.escapeAttr(
                  sectionKey
                )}" data-block-id="${helpers.escapeAttr(block.id)}">+ Add Row</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
};

export const renderTableReader: ComponentReaderRenderer = (_section, block, helpers) => {
  if (block.schema.tableShowHeader) {
    resetReaderTableStripeSequence();
  }
  const columns = helpers.getTableColumns(block.schema);
  return `<div class="reader-table-frame"><table class="reader-table">
    ${
      block.schema.tableShowHeader
        ? `<thead>
      <tr>${columns.map((column) => `<th title="${helpers.escapeAttr(column)}">${renderTableInlineReaderHtml(column, block, helpers)}</th>`).join('')}</tr>
    </thead>`
        : ''
    }
    <tbody>
      ${block.schema.tableRows
        .map(
          (row) => `
            <tr class="table-main-row table-main-row-${getNextReaderTableStripeClass()}">
              ${columns.map((column, cellIndex) => {
                const value = helpers.escapeHtml(row.cells[cellIndex] ?? '');
                const title = helpers.escapeAttr(row.cells[cellIndex] ?? '');
                const placeholder = helpers.escapeAttr(column || 'Cell value');
                return value
                  ? `<td title="${title}">${renderTableInlineReaderHtml(row.cells[cellIndex] ?? '', block, helpers)}</td>`
                  : `<td data-placeholder="${placeholder}"></td>`;
              }).join('')}
            </tr>
            `
        )
        .join('')}
    </tbody>
  </table></div>`;
};
