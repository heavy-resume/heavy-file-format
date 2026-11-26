import './table.css';
import type { ComponentEditorRenderer, ComponentReaderRenderer } from '../../component-helpers';
import type { TableRow } from '../../types';
import { settingsIcon } from '../../../icons';
import { renderAltAnnotationsAsFullText, renderAltAnnotationsAsMobileText } from '../../../markdown';
import { markdownToPlainText } from '../../../markdown-plain-text';
import { findSortValueOwnerBlock, getComponentSortValueDefs, replaceSortValueAnnotations, type ListValueKind } from '../../../sort-values';
import type { SortValueDefinition } from '../../../types';
import { state } from '../../../state';
import { findReusableOwner } from '../../../reusable';
import { sanitizeInlineCss } from '../../../css-sanitizer';
import { getTableColumnProperties } from '../../../table-ops';
import { renderTableGrabberInsertMenu } from './table-grabber-insert-menu';
import { renderTableEditorGrid, type TableEditorGridRow } from './table-editor-grid';

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
  const groupDefs = getSortValueDefsForTableBlock(sectionKey, block, 'group');
  if (Object.keys(defs).length === 0 && Object.keys(groupDefs).length === 0) {
    return unwrapTableParagraphs(helpers.markdownToEditorHtml(value));
  }
  const replacements: string[] = [];
  let source = value;
  for (const kind of ['sort', 'group'] as const) {
    source = replaceSortValueAnnotations(source, (annotation) => {
      const token = `HVY_TABLE_SORT_VALUE_TOKEN_${replacements.length}`;
      replacements.push(renderTableSortValueEditorControl(annotation.key, annotation.text, (kind === 'group' ? groupDefs : defs)[annotation.key], sectionKey, blockId, helpers, kind));
      return token;
    }, kind);
  }
  let html = unwrapTableParagraphs(helpers.markdownToEditorHtml(source));
  replacements.forEach((replacement, index) => {
    html = html.replace(`HVY_TABLE_SORT_VALUE_TOKEN_${index}`, replacement);
  });
  return html;
}

function getSortValueDefsForTableBlock(sectionKey: string, block: Parameters<ComponentEditorRenderer>[1], kind: ListValueKind = 'sort'): Record<string, SortValueDefinition> {
  try {
    if (!state?.document) {
      return {};
    }
    const listOwner = findSortValueOwnerBlock(state.document, block.id);
    if (listOwner) return getComponentSortValueDefs(state.document.meta, listOwner.schema.component, kind);
    const direct = getComponentSortValueDefs(state.document.meta, block.schema.component, kind);
    if (Object.keys(direct).length > 0) {
      return direct;
    }
    const owner = findReusableOwner(sectionKey, block.id);
    return owner ? getComponentSortValueDefs(state.document.meta, owner.schema.component, kind) : {};
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
    return Array.from(trimmed.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi), (match) => match[1] ?? '').join('<br><br>');
  }
  return trimmed.replace(/<\/p>\s*<p\b[^>]*>/gi, '<br><br>').replace(/<p\b[^>]*>/gi, '').replace(/<\/p>/gi, '');
}

function renderTableInlineReaderHtml(value: string, block: Parameters<ComponentReaderRenderer>[1], helpers: Parameters<ComponentReaderRenderer>[2]): string {
  return unwrapTableParagraphs(helpers.renderComponentFragment('text', value, block));
}

function renderTableHoverTitleAttr(markdown: string, helpers: Parameters<ComponentReaderRenderer>[2]): string {
  const visibleText = markdownToPlainText(markdown);
  return visibleText ? ` title="${helpers.escapeAttr(visibleText)}"` : '';
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

function buildTableEditorRow(
  sectionKey: string,
  block: Parameters<ComponentEditorRenderer>[1],
  columns: string[],
  row: TableRow,
  rowIndex: number,
  helpers: Parameters<ComponentEditorRenderer>[2]
): TableEditorGridRow {
  const blockId = block.id;
  const escapedSection = helpers.escapeAttr(sectionKey);
  const escapedBlockId = helpers.escapeAttr(blockId);
  const safeColumns = columns.length > 0 ? columns : ['Column 1', 'Column 2'];
  const isEmptyRow = safeColumns.every((_column, cellIndex) => (row.cells[cellIndex] ?? '').trim().length === 0);
  return {
    trClassName: isEmptyRow ? 'table-row-editor-empty' : '',
    trAttrs: `data-table-row-drop="true" data-section-key="${escapedSection}" data-block-id="${escapedBlockId}" data-row-index="${rowIndex}" data-editor-deactivation-anchor="${helpers.escapeAttr(`table-${blockId}-row-${rowIndex}`)}"`,
    leadingHtml: renderTableGrabberInsertMenu({ kind: 'row', sectionKey, blockId, index: rowIndex, escapeAttr: helpers.escapeAttr }),
    cells: safeColumns.map((_column, cellIndex) => {
      const rawPlaceholder = safeColumns[cellIndex] || 'Cell value';
      const placeholder = renderAltAnnotationsAsFullText(rawPlaceholder);
      const compactPlaceholder = renderAltAnnotationsAsMobileText(rawPlaceholder);
      return {
        tdClassName: tableColumnClassNames(block, safeColumns[cellIndex], false),
        tdAttrs: `data-table-column-index="${cellIndex}"`,
        editableAttrs: `contenteditable="true" spellcheck="true" data-inline-text="true" data-section-key="${escapedSection}" data-block-id="${escapedBlockId}" data-row-index="${rowIndex}" data-cell-index="${cellIndex}" data-field="table-cell" data-placeholder="${helpers.escapeAttr(placeholder)}" data-placeholder-compact="${helpers.escapeAttr(compactPlaceholder)}"`,
        contentHtml: renderTableInlineEditorHtml(row.cells[cellIndex] ?? '', sectionKey, blockId, block, helpers),
      };
    }),
    removeButtonAttrs: `data-action="remove-table-row" data-section-key="${escapedSection}" data-block-id="${escapedBlockId}" data-row-index="${rowIndex}"`,
  };
}

function renderTableSortValueEditorControl(
  key: string,
  text: string,
  definition: SortValueDefinition | undefined,
  sectionKey: string,
  blockId: string,
  helpers: Parameters<ComponentEditorRenderer>[2],
  kind: ListValueKind = 'sort'
): string {
  if (definition?.type !== 'enum') {
    return `<span class="hvy-sort-value" data-hvy-sort-value="true" data-value-kind="${kind}" data-sort-value-key="${helpers.escapeAttr(key)}">${helpers.escapeHtml(text)}</span>`;
  }
  const selected = text.trim();
  const options = (definition.options ?? []).map((option) =>
    `<option value="${helpers.escapeAttr(option.label)}"${option.label === selected ? ' selected' : ''}>${helpers.escapeHtml(option.label)}</option>`
  ).join('');
  return `<select
    class="hvy-sort-value hvy-sort-value-enum"
    contenteditable="false"
    data-hvy-sort-value="true" data-value-kind="${kind}"
    data-sort-value-key="${helpers.escapeAttr(key)}"
    data-field="sort-value-enum"
    data-section-key="${helpers.escapeAttr(sectionKey)}"
    data-block-id="${helpers.escapeAttr(blockId)}"
  >${options}</select>&#8203;`;
}

export const renderTableEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => {
  const columns = helpers.getTableColumns(block.schema);
  const escapedSection = helpers.escapeAttr(sectionKey);
  const escapedBlockId = helpers.escapeAttr(block.id);
  const preambleHtml = `
    <div class="table-editor-head">
      <strong>Inline Table Editor</strong>
      <span>Rename headers, edit cells in place, and drag handles to reorder.</span>
    </div>
    <label class="table-header-toggle">
      <input
        type="checkbox"
        data-section-key="${escapedSection}"
        data-block-id="${escapedBlockId}"
        data-field="table-show-header"
        ${block.schema.tableShowHeader ? 'checked' : ''}
      />
      Show header row
    </label>`;
  const colgroupHtml = `<colgroup>
    <col class="table-utility-column">
    ${columns.map((column, columnIndex) => renderTableColumn(block, column, columnIndex, helpers)).join('')}
    <col class="table-add-column-column">
  </colgroup>`;

  return renderTableEditorGrid({
    preambleHtml,
    colgroupHtml,
    columns: columns.map((column, columnIndex) => ({
      thClassName: tableColumnClassNames(block, column, true),
      thAttrs: `data-table-column-drop="true" data-section-key="${escapedSection}" data-block-id="${escapedBlockId}" data-column-index="${columnIndex}" data-table-column-index="${columnIndex}"`,
      leadingHtml: `${renderTableGrabberInsertMenu({
        kind: 'column',
        sectionKey,
        blockId: block.id,
        index: columnIndex,
        disabled: block.schema.lock,
        escapeAttr: helpers.escapeAttr,
      })}${renderTableColumnSettings(sectionKey, block, column, columnIndex, helpers)}`,
      editableAttrs: `contenteditable="${block.schema.lock ? 'false' : 'true'}" spellcheck="true" data-inline-text="true" data-section-key="${escapedSection}" data-block-id="${escapedBlockId}" data-column-index="${columnIndex}" data-field="table-column"`,
      contentHtml: unwrapTableParagraphs(helpers.markdownToEditorHtml(column)),
      removeButtonAttrs: block.schema.lock
        ? null
        : `data-action="remove-table-column" data-section-key="${escapedSection}" data-block-id="${escapedBlockId}" data-column-index="${columnIndex}"`,
      afterHeadHtml: `<span class="table-column-resize-handle" data-section-key="${escapedSection}" data-block-id="${escapedBlockId}" data-column-index="${columnIndex}" title="Drag to resize; double-click to fit contents" aria-hidden="true"></span>`,
    })),
    addColumnButtonAttrs: block.schema.lock
      ? null
      : `data-action="add-table-column" data-section-key="${escapedSection}" data-block-id="${escapedBlockId}"`,
    rows: block.schema.tableRows.map((row, rowIndex) => buildTableEditorRow(sectionKey, block, columns, row, rowIndex, helpers)),
    addRowButtonAttrs: `data-action="add-table-row" data-section-key="${escapedSection}" data-block-id="${escapedBlockId}"`,
  });
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
      <tr>${columns.map((column, columnIndex) => `<th class="${tableColumnClassNames(block, column, true)}" data-table-column-index="${columnIndex}"${renderTableHoverTitleAttr(column, helpers)}>${renderTableInlineReaderHtml(column, block, helpers)}</th>`).join('')}</tr>
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
                if (value) {
                  return `<td class="${tableColumnClassNames(block, columns[cellIndex], false)}" data-table-column-index="${cellIndex}"${renderTableHoverTitleAttr(rawValue, helpers)}>${renderTableInlineReaderHtml(rawValue, block, helpers)}</td>`;
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
