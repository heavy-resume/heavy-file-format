import type { ComponentEditorRenderer, ComponentReaderRenderer } from '../component-helpers';

export const renderGridEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => `
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
    ${block.schema.gridItems
      .map(
        (item, index) => `<div class="grid-field-row">
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
              <strong>Grid Item ${index + 1}</strong>
            </div>
            <button type="button" class="danger remove-x" data-action="remove-grid-item" data-section-key="${helpers.escapeAttr(
              sectionKey
            )}" data-block-id="${helpers.escapeAttr(block.id)}" data-grid-item-id="${helpers.escapeAttr(item.id)}">×</button>
          </div>
          <div class="grid-item-controls">
            <select class="compact-select" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(
              block.id
            )}" data-field="block-grid-item-component" data-grid-item-id="${helpers.escapeAttr(item.id)}">
              ${helpers.renderComponentOptions(item.block.schema.component)}
            </select>
            <select class="compact-select" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(
              block.id
            )}" data-field="block-grid-item-column" data-grid-item-id="${helpers.escapeAttr(item.id)}">
              ${helpers.renderOption('left', item.column)}
              ${helpers.renderOption('right', item.column)}
              ${helpers.renderOption('full', item.column)}
            </select>
          </div>
          <div class="grid-item-editor-shell">
            ${helpers.renderEditorBlock(sectionKey, item.block, block.schema.lock)}
          </div>
        </div>`
      )
      .join('')}
  </div>
  ${
    block.schema.lock
      ? ''
      : `<article class="ghost-section-card add-ghost grid-add-ghost" data-action="add-grid-item" data-section-key="${helpers.escapeAttr(
          sectionKey
        )}" data-block-id="${helpers.escapeAttr(block.id)}">
          <div class="ghost-plus-big"><span>+</span></div>
          <div class="ghost-label">Add Grid Component</div>
          <label class="ghost-component-picker">
            <select aria-label="Grid component type" data-field="new-grid-component-type" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(
          block.id
        )}">
              ${helpers.renderComponentOptions(helpers.getSelectedAddComponent(block.id, 'text'))}
            </select>
          </label>
        </article>`
  }
`;

export const renderGridReader: ComponentReaderRenderer = (_section, block, helpers) => {
  const columns = Math.max(1, Math.min(6, block.schema.gridColumns));
  const gridStyle = `grid-template-columns: repeat(${columns}, minmax(0, 1fr));`;
  const cells = block.schema.gridItems
    .map((item) => {
      const gridColumn =
        item.column === 'full' ? '1 / -1' : item.column === 'right' && columns > 1 ? `${Math.min(columns, 2)} / span 1` : '1 / span 1';
      const alignClass = item.column === 'right' ? ' align-right' : item.column === 'full' ? ' align-full' : ' align-left';
      return `<div class="reader-grid-cell${alignClass}" style="grid-column: ${helpers.escapeAttr(gridColumn)};">${helpers.renderReaderBlock(
        _section,
        item.block
      )}</div>`;
    })
    .join('');
  return `<div class="reader-grid-layout" style="${helpers.escapeAttr(gridStyle)}">${cells}</div>`;
};
