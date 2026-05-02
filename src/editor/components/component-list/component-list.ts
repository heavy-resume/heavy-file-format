import './component-list.css';
import type { ComponentEditorRenderer, ComponentReaderRenderer } from '../../component-helpers';
import { getComponentListAddLabel } from './component-list-labels';

export const renderComponentListEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => {
  helpers.ensureComponentListBlocks(block);
  const hasItems = (block.schema.componentListBlocks ?? []).length > 0;
  const listComponent = block.schema.componentListComponent || 'text';
  return `
    ${
      hasItems
        ? `<div class="component-list-type-summary">List type: <strong>${helpers.escapeHtml(listComponent)}</strong></div>`
        : `<label>
          <span>List Component Type</span>
          <select data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(
            block.id
          )}" data-field="block-component-list-component">
            ${helpers.renderComponentOptions(listComponent)}
          </select>
        </label>`
    }
    <div class="container-inner-blocks">
      ${(block.schema.componentListBlocks ?? []).map((innerBlock) => helpers.renderEditorBlock(sectionKey, innerBlock, block.schema.lock)).join('')}
    </div>
    ${
      block.schema.lock
        ? ''
        : `<article class="ghost-section-card add-ghost container-add-ghost" data-action="add-component-list-item" data-section-key="${helpers.escapeAttr(
            sectionKey
          )}" data-block-id="${helpers.escapeAttr(block.id)}">
            <div class="ghost-plus-big"><span>+</span></div>
            <div class="ghost-label">${helpers.escapeHtml(getComponentListAddLabel(block))}</div>
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
