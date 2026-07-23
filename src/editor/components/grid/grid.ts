import './grid.css';
import type { ComponentEditorRenderer, ComponentReaderRenderer } from '../../component-helpers';
import type { GridItem, VisualBlock } from '../../types';
import { closeIcon } from '../../../icons';
import { coerceGridStackWidth, DEFAULT_GRID_STACK_WIDTH } from '../../../grid-ops';

export const renderGridEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => {
  const locked = block.schema.lock && helpers.isReusableDefinitionEditor?.() !== true;
  const stackWidth = coerceGridStackWidth(block.schema.gridStackWidth);
  const stackWidthInputValue = getGridStackWidthInputValue(stackWidth);
  const stackNever = stackWidth === 'never';
  const stackClass = getGridStackClass(block.id, stackWidth);
  const layoutClasses = [
    'grid-fields',
    stackWidth === DEFAULT_GRID_STACK_WIDTH ? '' : 'has-custom-grid-stack',
    stackWidth === 'never' ? 'grid-stack-never' : '',
    stackClass,
  ].filter(Boolean).join(' ');
  const stackCss = renderGridStackCss(stackClass, stackWidth, helpers);
  const firstPlacementTarget = helpers.renderComponentPlacementTarget({
    container: 'grid',
    sectionKey,
    parentBlockId: block.id,
    placement: block.schema.gridItems.length > 0 ? 'before' : 'end',
    targetGridItemId: block.schema.gridItems[0]?.id,
  });
  const placementMode = firstPlacementTarget.length > 0;
  const addGridGhost = locked || placementMode
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
    <div class="grid-stack-width-field">
      <label>
        <span>Stack Width</span>
        <input class="grid-stack-width-input" type="text" inputmode="text" spellcheck="false" placeholder="${DEFAULT_GRID_STACK_WIDTH}" data-section-key="${helpers.escapeAttr(
          sectionKey
        )}" data-block-id="${helpers.escapeAttr(block.id)}" data-field="block-grid-stack-width" value="${helpers.escapeAttr(
          stackWidthInputValue
        )}" ${stackNever ? 'disabled' : ''} />
      </label>
      <label class="checkbox-label grid-stack-never-toggle">
        <span>Never</span>
        <input type="checkbox" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(
          block.id
        )}" data-field="block-grid-stack-never" ${stackNever ? 'checked' : ''} />
      </label>
    </div>
  </div>
  ${stackCss}
  <div class="${helpers.escapeAttr(layoutClasses)}" style="--grid-columns: ${helpers.escapeAttr(String(block.schema.gridColumns))};">
    ${[
      block.schema.gridItems.length === 0 ? firstPlacementTarget : '',
      ...block.schema.gridItems.map(
        (item, index) => {
          const canChangeComponent = isBlankDefaultGridItem(item.block);
          const beforePlacementTarget = index === 0 ? firstPlacementTarget : '';
          const afterPlacementTarget = helpers.renderComponentPlacementTarget({
            container: 'grid',
            sectionKey,
            parentBlockId: block.id,
            placement: 'after',
            targetGridItemId: item.id,
          });
          return `<div class="grid-field-row">
          ${beforePlacementTarget}
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
            )}" aria-label="Remove grid component" title="Delete component">${closeIcon()}</button>
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
            ${helpers.renderEditorBlock(sectionKey, item.block, locked)}
          </div>
          ${afterPlacementTarget}
        </div>
        `;
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
  const stackWidth = coerceGridStackWidth(block.schema.gridStackWidth);
  const stackClass = getGridStackClass(block.id, stackWidth);
  const layoutClasses = [
    'reader-grid-layout',
    stackWidth === DEFAULT_GRID_STACK_WIDTH ? '' : 'has-custom-grid-stack',
    stackWidth === 'never' ? 'grid-stack-never' : '',
    stackClass,
  ].filter(Boolean).join(' ');
  const stackCss = renderGridStackCss(stackClass, stackWidth, helpers);
  const itemsByBlock = new Map(block.schema.gridItems.map((item) => [item.block, item]));
  const visibleCells = helpers.orderReaderBlocks(block.schema.gridItems.map((item) => item.block))
    .map((orderedBlock) => {
      const item = itemsByBlock.get(orderedBlock);
      return item ? { item, html: helpers.renderReaderBlock(_section, orderedBlock, { trimVerticalEdgeMargin: true }) } : null;
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
  return `${stackCss}<div class="${helpers.escapeAttr(layoutClasses)}" style="${helpers.escapeAttr(gridStyle)}">${cells}</div>`;
};

function renderGridStackCss(className: string, stackWidth: string, helpers: Parameters<ComponentReaderRenderer>[2]): string {
  if (stackWidth === DEFAULT_GRID_STACK_WIDTH || stackWidth === 'never') {
    return '';
  }
  return `<style>@container hvy-surface (inline-size <= ${helpers.escapeHtml(stackWidth)}) { .${className} { grid-template-columns: 1fr !important; } .${className} > .reader-grid-cell { grid-column: 1 / -1 !important; } }</style>`;
}

function getGridStackClass(blockId: string, stackWidth: string): string {
  return `grid-stack-${hashGridStackKey(`${blockId}:${stackWidth}`)}`;
}

function getGridStackWidthInputValue(stackWidth: string): string {
  return stackWidth === DEFAULT_GRID_STACK_WIDTH || stackWidth === 'never' ? '' : stackWidth;
}

function hashGridStackKey(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
