import type { ComponentEditorRenderer, ComponentReaderRenderer, TableDetailsRenderer } from '../component-helpers';
import type { TableRow, VisualSection } from '../types';

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
    <tr class="table-row-editor" data-table-row-drop="true" data-row-index="${rowIndex}">
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
      <td class="table-more-cell">
        <button type="button" class="ghost more-details-button" data-action="open-table-details" data-section-key="${helpers.escapeAttr(
          sectionKey
        )}" data-block-id="${helpers.escapeAttr(blockId)}" data-row-index="${rowIndex}">More details</button>
      </td>
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
                          data-drag-handle="table-column"
                          data-section-key="${helpers.escapeAttr(sectionKey)}"
                          data-block-id="${helpers.escapeAttr(block.id)}"
                          data-column-index="${columnIndex}"
                          title="Drag to reorder column"
                        >::</button>
                        <div
                          class="inline-editable table-inline-text table-column-name"
                          contenteditable="true"
                          spellcheck="false"
                          data-inline-text="true"
                          data-section-key="${helpers.escapeAttr(sectionKey)}"
                          data-block-id="${helpers.escapeAttr(block.id)}"
                          data-column-index="${columnIndex}"
                          data-field="table-column"
                        >${helpers.escapeHtml(column)}</div>
                        <button type="button" class="danger remove-x" data-action="remove-table-column" data-section-key="${helpers.escapeAttr(
                          sectionKey
                        )}" data-block-id="${helpers.escapeAttr(block.id)}" data-column-index="${columnIndex}" title="Remove column">×</button>
                      </div>
                    </th>`
                )
                .join('')}
              <th class="table-more-column">More details</th>
              <th class="table-add-column-cell">
                <button type="button" class="ghost table-add-button" data-action="add-table-column" data-section-key="${helpers.escapeAttr(
                  sectionKey
                )}" data-block-id="${helpers.escapeAttr(block.id)}" title="Add column">+</button>
              </th>
            </tr>
          </thead>
          <tbody>
            ${block.schema.tableRows.map((row, rowIndex) => renderTableRowEditor(sectionKey, block.id, columns, row, rowIndex, helpers)).join('')}
            <tr class="table-add-row-line">
              <td colspan="${columns.length + 3}">
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

export const renderTableDetailsEditor: TableDetailsRenderer = (sectionKey, row, helpers) => {
  row.detailsComponent = 'container';
  return `
    <div class="table-details-modal-body">
      <div class="expandable-label">Details Container</div>
      ${(row.detailsBlocks ?? []).map((block) => helpers.renderEditorBlock(sectionKey, block)).join('')}
    </div>
  `;
};

function renderTableDetailsContent(row: TableRow, helpers: Parameters<ComponentReaderRenderer>[2]): string {
  const title = row.detailsTitle.trim();
  const fauxSection: VisualSection = {
    key: 'table-details',
    customId: '',
    idEditorOpen: false,
    isGhost: false,
    title: '',
    level: 1,
    expanded: true,
    highlight: false,
    customCss: '',
    blocks: [],
    children: [],
  };
  const body = (row.detailsBlocks ?? []).map((innerBlock) => helpers.renderReaderBlock(fauxSection, innerBlock)).join('');
  return `<div class="reader-table-details-container reader-block reader-block-container">
    <div class="reader-container-title">${helpers.escapeHtml(title || 'Details')}</div>
    <div class="reader-container-body">${body}</div>
  </div>`;
}

export const renderTableReader: ComponentReaderRenderer = (section, block, helpers) => {
  const columns = helpers.getTableColumns(block.schema);
  return `<table class="reader-table">
    <thead>
      <tr>${columns.map((column) => `<th>${helpers.escapeHtml(column)}</th>`).join('')}<th>More details</th></tr>
    </thead>
    <tbody>
      ${block.schema.tableRows
        .map(
          (row, rowIndex) => `
            <tr class="table-main-row table-main-row-${rowIndex % 2 === 0 ? 'even' : 'odd'} ${row.clickable ? 'is-clickable' : 'is-static'}">
              ${columns.map((_, cellIndex) => `<td>${helpers.escapeHtml(row.cells[cellIndex] ?? '')}</td>`).join('')}
              <td><button type="button" class="ghost more-details-button" ${
                row.clickable
                  ? `data-reader-action="toggle-table-row" data-section-key="${helpers.escapeAttr(section.key)}" data-block-id="${helpers.escapeAttr(
                      block.id
                    )}" data-row-index="${rowIndex}"`
                  : 'disabled'
              }>${row.expanded ? 'Hide' : 'More details'}</button></td>
            </tr>
            ${row.expanded ? `<tr class="table-details-row"><td colspan="${Math.max(columns.length, 1) + 1}">${renderTableDetailsContent(row, helpers)}</td></tr>` : ''}`
        )
        .join('')}
    </tbody>
  </table>`;
};
