import './container.css';
import type { ComponentEditorRenderer, ComponentReaderRenderer } from '../../component-helpers';

export const renderContainerEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => {
  helpers.ensureContainerBlocks(block);
  const addKey = `container:${sectionKey}:${block.id}`;
  return `
    <div class="container-inner-blocks">
      ${block.schema.containerBlocks.map((innerBlock) => helpers.renderEditorBlock(sectionKey, innerBlock, block.schema.lock)).join('')}
    </div>
    ${
      block.schema.lock
        ? ''
        : `<article class="ghost-section-card add-ghost container-add-ghost">
            ${helpers.renderAddComponentPicker({
              id: addKey,
              action: 'add-container-block',
              sectionKey,
              blockId: block.id,
              label: 'Container component type',
            })}
          </article>`
    }
  `;
};

export const renderContainerReader: ComponentReaderRenderer = (section, block, helpers) => {
  helpers.ensureContainerBlocks(block);
  const body = block.schema.containerBlocks.map((innerBlock) => helpers.renderReaderBlock(section, innerBlock)).join('');
  return body ? `<div class="reader-container-body">${body}</div>` : '';
};
