import './grid.css';
import type { ComponentEditorRenderer, ComponentReaderRenderer } from '../../component-helpers';
import type { GridItem, VisualBlock } from '../../types';
import { closeIcon } from '../../../icons';
import { coerceGridStackWidth, DEFAULT_GRID_STACK_WIDTH } from '../../../grid-ops';
import { state } from '../../../state';
import { compileSurfaceResponsiveCss } from '../../../surface-responsive-css';
import { arrowDownIcon, arrowUpIcon } from '../../../icons';

export const renderGridHeaderControls: ComponentEditorRenderer = (sectionKey, block, helpers) => `
  <div class="grid-columns-header-field" role="group" aria-label="Grid Columns">
    <span>Grid Columns</span>
    <div class="grid-columns-stepper">
      <input class="grid-columns-input" aria-label="Grid Columns" type="number" min="1" max="6" inputmode="numeric" data-section-key="${helpers.escapeAttr(
        sectionKey
      )}" data-block-id="${helpers.escapeAttr(block.id)}" data-field="block-grid-columns" value="${helpers.escapeAttr(
        String(block.schema.gridColumns)
      )}" />
      <div class="grid-columns-step-buttons">
        <button type="button" class="grid-columns-step-button" data-action="adjust-grid-columns" data-section-key="${helpers.escapeAttr(
          sectionKey
        )}" data-block-id="${helpers.escapeAttr(block.id)}" data-grid-columns-delta="1" aria-label="Increase grid columns"${block.schema.gridColumns >= 6 ? ' disabled' : ''}>${arrowUpIcon()}</button>
        <button type="button" class="grid-columns-step-button" data-action="adjust-grid-columns" data-section-key="${helpers.escapeAttr(
          sectionKey
        )}" data-block-id="${helpers.escapeAttr(block.id)}" data-grid-columns-delta="-1" aria-label="Decrease grid columns"${block.schema.gridColumns <= 1 ? ' disabled' : ''}>${arrowDownIcon()}</button>
      </div>
    </div>
  </div>
`;

export const renderGridEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => {
  const locked = block.schema.lock && helpers.isReusableDefinitionEditor?.() !== true;
  const advanced = helpers.isAdvancedEditorMode();
  const stackWidth = coerceGridStackWidth(block.schema.gridStackWidth);
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
  const renderedGridBlocks = new Map(
    helpers.renderEditorGridBlocks(
      sectionKey,
      block.schema.gridItems.map((item) => item.block),
      1,
      locked
    ).map((entry) => [entry.block, entry.html])
  );
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
          const cellMeta = advanced ? renderGridCellMeta(sectionKey, block.id, item, helpers) : '';
          // Cell CSS belongs to the rendered document. Applying it to this
          // authoring row can hide or reorder the controls away from source order.
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
            <div class="grid-field-head-actions">
              ${cellMeta}
              <button type="button" class="danger remove-x" data-action="remove-grid-item" data-section-key="${helpers.escapeAttr(
                sectionKey
              )}" data-block-id="${helpers.escapeAttr(block.id)}" data-grid-item-id="${helpers.escapeAttr(
                item.id
              )}" aria-label="Remove grid component" title="Delete component">${closeIcon()}</button>
            </div>
          </div>
          ${canChangeComponent
            ? `<div class="grid-item-controls">
                <select class="compact-select" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(
                    block.id
                  )}" data-field="block-grid-item-component" data-grid-item-id="${helpers.escapeAttr(item.id)}">
                    ${helpers.renderComponentOptions(item.block.schema.component)}
                </select>
              </div>`
            : ''}
          <div class="grid-item-editor-shell">
            ${renderedGridBlocks.get(item.block) ?? ''}
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

function renderGridCellMeta(
  sectionKey: string,
  blockId: string,
  item: GridItem,
  helpers: Parameters<ComponentEditorRenderer>[2]
): string {
  return `<details class="grid-cell-meta">
    <summary class="grid-cell-meta-button" aria-label="Cell Meta">Meta</summary>
    <div class="grid-cell-meta-body">
      <div class="grid-cell-meta-title">Cell Meta</div>
      <label class="grid-cell-id-field">
        <span>ID</span>
        <input data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(
          blockId
        )}" data-field="block-grid-item-id" data-grid-item-id="${helpers.escapeAttr(item.id)}" placeholder="grid-cell-id" value="${helpers.escapeAttr(
          item.idGenerated ? '' : item.id
        )}" />
      </label>
      <label class="grid-cell-css-field">
        <span>CSS</span>
        <textarea rows="3" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(
          blockId
        )}" data-field="block-grid-item-css" data-grid-item-id="${helpers.escapeAttr(item.id)}" spellcheck="false">${helpers.escapeHtml(
          item.css ?? ''
        )}</textarea>
      </label>
    </div>
  </details>`;
}

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
  const visibleCells = helpers.renderReaderGridBlocks(
    _section,
    block.schema.gridItems.map((item) => item.block),
    columns,
    { trimVerticalEdgeMargin: true }
  )
    .map((rendered) => {
      const item = itemsByBlock.get(rendered.block);
      return item ? { item, html: rendered.html } : null;
    })
    .filter((item): item is { item: GridItem; html: string } => item !== null)
    .filter((item) => item.html.trim().length > 0);
  const cells = visibleCells
    .map((item, index) => {
      const columnIndex = columns <= 1 ? 1 : (index % columns) + 1;
      const gridColumn = columns <= 1 ? '1 / -1' : `${columnIndex} / span 1`;
      const responsiveClass = getGridItemResponsiveClass(block.id, item.item.id);
      const responsiveCss = compileSurfaceResponsiveCss(item.item.css, `.${responsiveClass}`, state.document.meta);
      const cellStyle = [
        `grid-column: ${gridColumn};`,
        responsiveCss.inlineCss,
      ].filter(Boolean).join(' ');
      return `${responsiveCss.responsiveRules ? `<style>${responsiveCss.responsiveRules}</style>` : ''}<div class="reader-grid-cell ${helpers.escapeAttr(responsiveClass)}" data-grid-item-id="${helpers.escapeAttr(item.item.id)}" style="${helpers.escapeAttr(cellStyle)}">${item.html}</div>`;
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

function getGridItemResponsiveClass(blockId: string, itemId: string): string {
  return `grid-item-responsive-${hashGridStackKey(`${blockId}:${itemId}`)}`;
}

function hashGridStackKey(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
