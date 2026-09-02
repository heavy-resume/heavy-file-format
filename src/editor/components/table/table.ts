import './table.css';
import type { ComponentEditorRenderer, ComponentReaderRenderer } from '../../component-helpers';
import type { TableRow } from '../../types';
import { closeIcon, plusIcon, settingsIcon } from '../../../icons';
import { renderAltAnnotationsAsFullText, renderAltAnnotationsAsMobileText } from '../../../markdown';
import { getComponentSortValueDefs, replaceSortValueAnnotations } from '../../../sort-values';
import type { SortValueDefinition } from '../../../types';
import { state } from '../../../state';
import { findReusableOwner } from '../../../reusable';
import { sanitizeInlineCss } from '../../../css-sanitizer';
import { getTableColumnProperties } from '../../../table-ops';
import { renderTableGrabberInsertMenu } from './table-grabber-insert-menu';

let readerTableStripeIndex = 0;

export function resetReaderTableStripeSequence(): void {
  readerTableStripeIndex = 0;
}

function getNextReaderTableStripeClass(): 'even' | 'odd' {
  const stripe = readerTableStripeIndex % 2 === 0 ? 'even' : 'odd';
  readerTableStripeIndex += 1;
  return stripe;
}

function renderTableInlineEditorHtml(
  value: string,
  sectionKey: string,
  blockId: string,
  block: Parameters<ComponentEditorRenderer>[1],
  helpers: Parameters<ComponentEditorRenderer>[2]
): string {
  const defs = getSortValueDefsForTableBlock(sectionKey, block);
  if (Object.keys(defs).length === 0) {
    return unwrapTableParagraphs(helpers.markdownToEditorHtml(value));
  }
  const replacements: string[] = [];
  const source = replaceSortValueAnnotations(value, (annotation) => {
    const token = `HVY_TABLE_SORT_VALUE_TOKEN_${replacements.length}`;
    replacements.push(renderTableSortValueEditorControl(annotation.key, annotation.text, defs[annotation.key], sectionKey, blockId, helpers));
    return token;
  });
  let html = unwrapTableParagraphs(helpers.markdownToEditorHtml(source));
  replacements.forEach((replacement, index) => {
    html = html.replace(`HVY_TABLE_SORT_VALUE_TOKEN_${index}`, replacement);
  });
  return html;
}

function getSortValueDefsForTableBlock(sectionKey: string, block: Parameters<ComponentEditorRenderer>[1]): Record<string, SortValueDefinition> {
  try {
    if (!state?.document) {
      return {};
    }
    const direct = getComponentSortValueDefs(state.document.meta, block.schema.component);
    if (Object.keys(direct).length > 0) {
      return direct;
    }
    const owner = findReusableOwner(sectionKey, block.id);
    return owner ? getComponentSortValueDefs(state.document.meta, owner.schema.component) : {};
  } catch {
    return {};
  }
}

function unwrapTableParagraphs(html: string): string {
  const trimmed = html.trim();
  if (!/<\/?p\b/i.test(trimmed)) {
    return html;
  }
  const paragraphsOnly = trimmed.replace(/<p\b[^>]*>[\s\S]*?<\/p>/gi, '').trim().length === 0;
  if (paragraphsOnly) {
    return Array.from(trimmed.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi), (match) => match[1] ?? '').join('<br>');
  }
  return trimmed.replace(/<\/p>\s*<p\b[^>]*>/gi, '<br>').replace(/<p\b[^>]*>/gi, '').replace(/<\/p>/gi, '');
}

function renderTableInlineReaderHtml(value: string, block: Parameters<ComponentReaderRenderer>[1], helpers: Parameters<ComponentReaderRenderer>[2]): string {
  return unwrapTableParagraphs(helpers.renderComponentFragment('text', value, block));
}

function renderTableInlineToolbar(
  _sectionKey: string,
  _blockId: string,
  _field: 'table-column' | 'table-cell',
  _helpers: Parameters<ComponentEditorRenderer>[2],
  _indices: { columnIndex?: number; rowIndex?: number; cellIndex?: number }
): string {
  return '';
}

function tableColumnClassNames(block: Parameters<ComponentEditorRenderer>[1], column: string, header: boolean): string {
  const properties = getTableColumnProperties(block.schema, column);
  return [
    properties.width !== 'auto' ? 'table-column-fixed' : '',
    properties.wrap ? 'table-column-wrap' : '',
    !properties.truncate ? 'table-column-no-truncate' : '',
    header ? `table-column-header-align-${properties.headerAlign}` : `table-column-align-${properties.align}`,
  ].filter(Boolean).join(' ');
}

function renderTableColumn(
  block: Parameters<ComponentEditorRenderer>[1],
  column: string,
  columnIndex: number,
  helpers: Parameters<ComponentEditorRenderer>[2]
): string {
  const width = getTableColumnProperties(block.schema, column).width;
  const style = width === 'auto' ? '' : sanitizeInlineCss(`width: ${width};`);
  return `<col data-table-column-index="${columnIndex}" data-table-column-name="${helpers.escapeAttr(column)}"${style ? ` style="${helpers.escapeAttr(style)}"` : ''}>`;
}

function renderAlignmentOptions(selected: string): string {
  return ['left', 'center', 'right']
    .map((value) => `<option value="${value}"${value === selected ? ' selected' : ''}>${value[0].toUpperCase()}${value.slice(1)}</option>`)
    .join('');
}

function renderTableColumnSettings(
  sectionKey: string,
  block: Parameters<ComponentEditorRenderer>[1],
  column: string,
  columnIndex: number,
  helpers: Parameters<ComponentEditorRenderer>[2]
): string {
  const properties = getTableColumnProperties(block.schema, column);
  const data = `data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(block.id)}" data-column-index="${columnIndex}"`;
  return `<details class="table-column-settings" data-escape-closes="true">
    <summary class="ghost table-column-settings-trigger" title="Column formatting" aria-label="Column formatting">${settingsIcon()}</summary>
    <div class="table-column-settings-panel">
      <label><span>Width</span><input type="text" data-field="table-column-width" ${data} value="${helpers.escapeAttr(properties.width)}" placeholder="auto"></label>
      <div class="table-column-overflow-setting">
        <span>Overflow:</span>
        <div class="table-column-overflow-options" role="group" aria-label="Overflow">
          <label><input type="checkbox" data-field="table-column-wrap" ${data}${properties.wrap ? ' checked' : ''}><span>Wrap</span></label>
          <label><input type="checkbox" data-field="table-column-truncate" ${data}${properties.truncate ? ' checked' : ''}><span>Truncate</span></label>
        </div>
      </div>
      <label><span>Cells</span><select data-field="table-column-align" ${data}>${renderAlignmentOptions(properties.align)}</select></label>
      <label><span>Header</span><select data-field="table-column-header-align" ${data}>${renderAlignmentOptions(properties.headerAlign)}</select></label>
      <button type="button" class="ghost table-column-auto-button" data-action="auto-fit-table-column" ${data}>Fit to contents</button>
      <button type="button" class="ghost table-column-auto-button" data-action="reset-table-column-width" ${data}>Automatic width</button>
    </div>
  </details>`;
}

function renderTableRowEditor(
  sectionKey: string,
  block: Parameters<ComponentEditorRenderer>[1],
  columns: string[],
  row: TableRow,
  rowIndex: number,
  helpers: Parameters<ComponentEditorRenderer>[2]
): string {
  const blockId = block.id;
  const safeColumns = columns.length > 0 ? columns : ['Column 1', 'Column 2'];
  const isEmptyRow = safeColumns.every((_column, cellIndex) => (row.cells[cellIndex] ?? '').trim().length === 0);
  return `
    <tr class="table-row-editor table-row-editor-main${isEmptyRow ? ' table-row-editor-empty' : ''}" data-table-row-drop="true" data-row-index="${rowIndex}" data-editor-deactivation-anchor="${helpers.escapeAttr(`table-${blockId}-row-${rowIndex}`)}">
      <td class="table-row-utility">
        ${renderTableGrabberInsertMenu({ kind: 'row', sectionKey, blockId, index: rowIndex, escapeAttr: helpers.escapeAttr })}
      </td>
      ${safeColumns
        .map(
          (_column, cellIndex) => {
            const rawPlaceholder = safeColumns[cellIndex] || 'Cell value';
            const placeholder = renderAltAnnotationsAsFullText(rawPlaceholder);
            const compactPlaceholder = renderAltAnnotationsAsMobileText(rawPlaceholder);
            return `<td class="${tableColumnClassNames(block, safeColumns[cellIndex], false)}" data-table-column-index="${cellIndex}">
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
                data-placeholder="${helpers.escapeAttr(placeholder)}"
                data-placeholder-compact="${helpers.escapeAttr(compactPlaceholder)}"
              >${renderTableInlineEditorHtml(row.cells[cellIndex] ?? '', sectionKey, blockId, block, helpers)}</div>
              ${renderTableInlineToolbar(sectionKey, blockId, 'table-cell', helpers, { rowIndex, cellIndex })}
            </div>
          </td>`;
          }
        )
        .join('')}
      <td class="table-row-utility table-row-remove-cell">
        <button type="button" class="danger remove-x" data-action="remove-table-row" data-section-key="${helpers.escapeAttr(
          sectionKey
        )}" data-block-id="${helpers.escapeAttr(blockId)}" data-row-index="${rowIndex}" title="Remove row">${closeIcon()}</button>
      </td>
    </tr>
  `;
}

function renderTableSortValueEditorControl(
  key: string,
  text: string,
  definition: SortValueDefinition | undefined,
  sectionKey: string,
  blockId: string,
  helpers: Parameters<ComponentEditorRenderer>[2]
): string {
  if (definition?.type !== 'enum') {
    return `<span class="hvy-sort-value" data-hvy-sort-value="true" data-sort-value-key="${helpers.escapeAttr(key)}">${helpers.escapeHtml(text)}</span>`;
  }
  const selected = text.trim();
  const options = (definition.options ?? []).map((option) =>
    `<option value="${helpers.escapeAttr(option.label)}"${option.label === selected ? ' selected' : ''}>${helpers.escapeHtml(option.label)}</option>`
  ).join('');
  return `<select
    class="hvy-sort-value hvy-sort-value-enum"
    contenteditable="false"
    data-hvy-sort-value="true"
    data-sort-value-key="${helpers.escapeAttr(key)}"
    data-field="sort-value-enum"
    data-section-key="${helpers.escapeAttr(sectionKey)}"
    data-block-id="${helpers.escapeAttr(blockId)}"
  >${options}</select>&#8203;`;
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
          <colgroup>
            <col class="table-utility-column">
            ${columns.map((column, columnIndex) => renderTableColumn(block, column, columnIndex, helpers)).join('')}
            <col class="table-add-column-column">
          </colgroup>
          <thead>
            <tr>
              <th class="table-utility-cell"></th>
              ${columns
                .map(
                  (column, columnIndex) => `
                    <th class="${tableColumnClassNames(block, column, true)}" data-table-column-drop="true" data-column-index="${columnIndex}" data-table-column-index="${columnIndex}">
                      <div class="table-column-head">
                        ${renderTableGrabberInsertMenu({
                          kind: 'column',
                          sectionKey,
                          blockId: block.id,
                          index: columnIndex,
                          disabled: block.schema.lock,
                          escapeAttr: helpers.escapeAttr,
                        })}
                        ${renderTableColumnSettings(sectionKey, block, column, columnIndex, helpers)}
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
                          >${unwrapTableParagraphs(helpers.markdownToEditorHtml(column))}</div>
                          ${renderTableInlineToolbar(sectionKey, block.id, 'table-column', helpers, { columnIndex })}
                        </div>
                        ${
                          block.schema.lock
                            ? ''
                            : `<button type="button" class="danger remove-x" data-action="remove-table-column" data-section-key="${helpers.escapeAttr(
                                sectionKey
                              )}" data-block-id="${helpers.escapeAttr(block.id)}" data-column-index="${columnIndex}" title="Remove column">${closeIcon()}</button>`
                        }
                      </div>
                      <span class="table-column-resize-handle" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(block.id)}" data-column-index="${columnIndex}" title="Drag to resize; double-click to fit contents" aria-hidden="true"></span>
                    </th>`
                )
                .join('')}
              <th class="table-add-column-cell">
                ${
                  block.schema.lock
                    ? ''
                    : `<button type="button" class="ghost table-add-button" data-action="add-table-column" data-section-key="${helpers.escapeAttr(
                        sectionKey
                      )}" data-block-id="${helpers.escapeAttr(block.id)}" title="Add column" aria-label="Add column">${plusIcon()}</button>`
                }
              </th>
            </tr>
          </thead>
          <tbody>
            ${block.schema.tableRows.map((row, rowIndex) => renderTableRowEditor(sectionKey, block, columns, row, rowIndex, helpers)).join('')}
            <tr class="table-add-row-line">
              <td colspan="${columns.length + 2}">
                <button type="button" class="ghost" data-action="add-table-row" data-section-key="${helpers.escapeAttr(
                  sectionKey
                )}" data-block-id="${helpers.escapeAttr(block.id)}">${plusIcon()} Row</button>
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
    <colgroup>${columns.map((column, columnIndex) => renderTableColumn(block, column, columnIndex, helpers)).join('')}</colgroup>
    ${
      block.schema.tableShowHeader
        ? `<thead>
      <tr>${columns.map((column, columnIndex) => `<th class="${tableColumnClassNames(block, column, true)}" data-table-column-index="${columnIndex}" title="${helpers.escapeAttr(renderAltAnnotationsAsFullText(column))}">${renderTableInlineReaderHtml(column, block, helpers)}</th>`).join('')}</tr>
    </thead>`
        : ''
    }
    <tbody>
      ${block.schema.tableRows
        .map(
          (row, rowIndex) => {
            const isEmptyRow = columns.every((_column, cellIndex) => (row.cells[cellIndex] ?? '').trim().length === 0);
            return `
            <tr class="table-main-row table-main-row-${getNextReaderTableStripeClass()}${isEmptyRow ? ' table-main-row-empty' : ''}" data-editor-deactivation-anchor="${helpers.escapeAttr(`table-${block.id}-row-${rowIndex}`)}">
              ${columns.map((_column, cellIndex) => {
                const rawValue = row.cells[cellIndex] ?? '';
                const value = helpers.escapeHtml(rawValue);
                const title = helpers.escapeAttr(row.cells[cellIndex] ?? '');
                if (value) {
                  return `<td class="${tableColumnClassNames(block, columns[cellIndex], false)}" data-table-column-index="${cellIndex}" title="${title}">${renderTableInlineReaderHtml(rawValue, block, helpers)}</td>`;
                }
                if (!isEmptyRow) {
                  return `<td class="${tableColumnClassNames(block, columns[cellIndex], false)}" data-table-column-index="${cellIndex}"></td>`;
                }
                const rawPlaceholder = columns[cellIndex] || 'Cell value';
                const placeholder = helpers.escapeAttr(renderAltAnnotationsAsFullText(rawPlaceholder));
                const compactPlaceholder = helpers.escapeAttr(renderAltAnnotationsAsMobileText(rawPlaceholder));
                return `<td class="${tableColumnClassNames(block, columns[cellIndex], false)}" data-table-column-index="${cellIndex}" data-placeholder="${placeholder}" data-placeholder-compact="${compactPlaceholder}"></td>`;
              }).join('')}
            </tr>
            `;
          }
        )
        .join('')}
    </tbody>
  </table></div>`;
};
