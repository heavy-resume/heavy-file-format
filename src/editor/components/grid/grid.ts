import './grid.css';
import type { ComponentEditorRenderer, ComponentReaderRenderer } from '../../component-helpers';
import type { GridItem, VisualBlock } from '../../types';
import { closeIcon } from '../../../icons';

export const renderGridEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => {
  const firstPlacementTarget = helpers.renderComponentPlacementTarget({
    container: 'grid',
    sectionKey,
    parentBlockId: block.id,
    placement: block.schema.gridItems.length > 0 ? 'before' : 'end',
    targetGridItemId: block.schema.gridItems[0]?.id,
  });
  const placementMode = firstPlacementTarget.length > 0;
  const addGridGhost = block.schema.lock || placementMode
    ? ''
    : `<div class="ghost-section-card add-ghost grid-add-ghost">
        ${helpers.renderAddComponentPicker({
          id: `grid:${sectionKey}:${block.id}`,
          action: 'add-grid-item',
          sectionKey,
          blockId: block.id,
          label: 'Grid component type',
        })}
      </div>`;
  return `
  <div class="editor-grid schema-grid">
    <label>
      <span>Grid Columns</span>
      <input class="grid-columns-input" type="number" min="1" max="6" data-section-key="${helpers.escapeAttr(
        sectionKey
      )}" data-block-id="${helpers.escapeAttr(block.id)}" data-field="block-grid-columns" value="${helpers.escapeAttr(
        String(block.schema.gridColumns)
      )}" />
    </label>
  </div>
  <div class="grid-fields" style="--grid-columns: ${helpers.escapeAttr(String(block.schema.gridColumns))};">
    ${[
      firstPlacementTarget,
      ...block.schema.gridItems.map(
        (item) => {
          const canChangeComponent = isBlankDefaultGridItem(item.block);
          return `<div class="grid-field-row">
          <div class="grid-field-head">
            <div class="section-drag-title">
              <div class="editor-order-controls">
                <button type="button" class="order-arrow-button" data-action="move-grid-item-up" data-section-key="${helpers.escapeAttr(
                  sectionKey
                )}" data-block-id="${helpers.escapeAttr(block.id)}" data-grid-item-id="${helpers.escapeAttr(item.id)}" aria-label="Move grid item up">▲</button>
                <button type="button" class="order-arrow-button" data-action="move-grid-item-down" data-section-key="${helpers.escapeAttr(
                  sectionKey
                )}" data-block-id="${helpers.escapeAttr(block.id)}" data-grid-item-id="${helpers.escapeAttr(item.id)}" aria-label="Move grid item down">▼</button>
              </div>
            </div>
            <button type="button" class="danger remove-x" data-action="remove-grid-item" data-section-key="${helpers.escapeAttr(
              sectionKey
            )}" data-block-id="${helpers.escapeAttr(block.id)}" data-grid-item-id="${helpers.escapeAttr(
              item.id
            )}" aria-label="Remove grid component" title="Delete component" data-tooltip="Delete component">${closeIcon()}</button>
          </div>
          <div class="grid-item-controls">
            ${
              canChangeComponent
                ? `<select class="compact-select" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(
                    block.id
                  )}" data-field="block-grid-item-component" data-grid-item-id="${helpers.escapeAttr(item.id)}">
                    ${helpers.renderComponentOptions(item.block.schema.component)}
                  </select>`
                : `<span class="grid-item-component-label">${helpers.escapeHtml(item.block.schema.component || 'text')}</span>`
            }
          </div>
          <div class="grid-item-editor-shell">
            ${helpers.renderEditorBlock(sectionKey, item.block, block.schema.lock)}
          </div>
        </div>
        ${helpers.renderComponentPlacementTarget({
          container: 'grid',
          sectionKey,
          parentBlockId: block.id,
          placement: 'after',
          targetGridItemId: item.id,
        })}`;
        }
      ),
      addGridGhost,
    ].join('')}
  </div>
`;
};

function isBlankDefaultGridItem(block: VisualBlock): boolean {
  if ((block.schema.component || 'text') !== 'text') {
    return false;
  }
  if (block.schema.kind !== 'text') {
    return false;
  }
  return block.text.trim().length === 0
    && block.schema.placeholder.trim().length === 0
    && !block.schema.fillIn;
}

export const renderGridReader: ComponentReaderRenderer = (_section, block, helpers) => {
  const columns = Math.max(1, Math.min(6, block.schema.gridColumns));
  const gridStyle = `grid-template-columns: repeat(${columns}, minmax(0, 1fr));`;
  const itemsByBlock = new Map(block.schema.gridItems.map((item) => [item.block, item]));
  const visibleCells = helpers.orderReaderBlocks(block.schema.gridItems.map((item) => item.block))
    .map((orderedBlock) => {
      const item = itemsByBlock.get(orderedBlock);
      return item ? { item, html: helpers.renderReaderBlock(_section, orderedBlock) } : null;
    })
    .filter((item): item is { item: GridItem; html: string } => item !== null)
    .filter((item) => item.html.trim().length > 0);
  const cells = visibleCells
    .map((item, index) => {
      const columnIndex = columns <= 1 ? 1 : (index % columns) + 1;
      const gridColumn = columns <= 1 ? '1 / -1' : `${columnIndex} / span 1`;
      const cellStyle = [
        `grid-column: ${gridColumn};`,
      ].filter(Boolean).join(' ');
      return `<div class="reader-grid-cell" style="${helpers.escapeAttr(cellStyle)}">${item.html}</div>`;
    })
    .join('');
  if (!cells.trim()) {
    return '';
  }
  return `<div class="reader-grid-layout" style="${helpers.escapeAttr(gridStyle)}">${cells}</div>`;
};
