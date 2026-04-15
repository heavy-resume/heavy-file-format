import type { ComponentEditorRenderer, ComponentReaderRenderer } from '../component-helpers';
import type { TableRow } from '../types';

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
              data-placeholder="Cell value"
            >${helpers.escapeHtml(row.cells[cellIndex] ?? '')}</div>
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
        <table class="table-editor-grid">
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
                        <div
                          class="inline-editable table-inline-text table-column-name"
                          contenteditable="${block.schema.lock ? 'false' : 'true'}"
                          spellcheck="false"
                          data-inline-text="true"
                          data-section-key="${helpers.escapeAttr(sectionKey)}"
                          data-block-id="${helpers.escapeAttr(block.id)}"
                          data-column-index="${columnIndex}"
                          data-field="table-column"
                        >${helpers.escapeHtml(column)}</div>
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
  const columns = helpers.getTableColumns(block.schema);
  return `<table class="reader-table">
    ${
      block.schema.tableShowHeader
        ? `<thead>
      <tr>${columns.map((column) => `<th>${helpers.escapeHtml(column)}</th>`).join('')}</tr>
    </thead>`
        : ''
    }
    <tbody>
      ${block.schema.tableRows
        .map(
          (row, rowIndex) => `
            <tr class="table-main-row table-main-row-${rowIndex % 2 === 0 ? 'even' : 'odd'}">
              ${columns.map((_, cellIndex) => `<td>${helpers.escapeHtml(row.cells[cellIndex] ?? '')}</td>`).join('')}
            </tr>
            `
        )
        .join('')}
    </tbody>
  </table>`;
};
