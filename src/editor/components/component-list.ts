import type { ComponentEditorRenderer, ComponentReaderRenderer } from '../component-helpers';

export const renderComponentListEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => {
  helpers.ensureComponentListBlocks(block);
  return `
    <label>
      <span>List Component Type</span>
      <select data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(
        block.id
      )}" data-field="block-component-list-component">
        ${helpers.renderComponentOptions(block.schema.componentListComponent || 'text')}
      </select>
    </label>
    <div class="container-inner-blocks">
      ${(block.schema.componentListBlocks ?? []).map((innerBlock) => helpers.renderEditorBlock(sectionKey, innerBlock)).join('')}
    </div>
    ${
      block.schema.lock
        ? ''
        : `<article class="ghost-section-card add-ghost container-add-ghost" data-action="add-component-list-item" data-section-key="${helpers.escapeAttr(
            sectionKey
          )}" data-block-id="${helpers.escapeAttr(block.id)}">
            <div class="ghost-plus-big"><span>+</span></div>
            <div class="ghost-label">Add List Item</div>
          </article>`
    }
  `;
};

export const renderComponentListReader: ComponentReaderRenderer = (section, block, helpers) => {
  helpers.ensureComponentListBlocks(block);
  return `<div class="reader-component-list">${(block.schema.componentListBlocks ?? [])
    .map((innerBlock) => helpers.renderReaderBlock(section, innerBlock))
    .join('')}</div>`;
};
