import type { ComponentEditorRenderer, ComponentReaderRenderer } from '../component-helpers';

export const renderContainerEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => {
  helpers.ensureContainerBlocks(block);
  const addKey = `container:${sectionKey}:${block.id}`;
  return `
    <label>
      <span>Container Title</span>
      <input data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(
        block.id
      )}" data-field="block-container-title" value="${helpers.escapeAttr(block.schema.containerTitle)}" />
    </label>
    <div class="container-inner-blocks">
      ${block.schema.containerBlocks.map((innerBlock) => helpers.renderEditorBlock(sectionKey, innerBlock)).join('')}
    </div>
    <article class="ghost-section-card add-ghost container-add-ghost" data-action="add-container-block" data-section-key="${helpers.escapeAttr(
      sectionKey
    )}" data-block-id="${helpers.escapeAttr(block.id)}">
      <div class="ghost-plus-big"><span>+</span></div>
      <div class="ghost-label">Add Component</div>
      <label class="ghost-component-picker">
        <select aria-label="Container component type" data-field="container-new-component-type" data-container-key="${helpers.escapeAttr(addKey)}">
          ${helpers.renderComponentOptions(helpers.getSelectedAddComponent(addKey, 'text'))}
        </select>
      </label>
    </article>
  `;
};

export const renderContainerReader: ComponentReaderRenderer = (section, block, helpers) => {
  helpers.ensureContainerBlocks(block);
  const title = block.schema.containerTitle || 'Container';
  const body = block.schema.containerBlocks.map((innerBlock) => helpers.renderReaderBlock(section, innerBlock)).join('');
  return `<div class="reader-container-title">${helpers.escapeHtml(title)}</div>${body ? `<div class="reader-container-body">${body}</div>` : ''}`;
};
