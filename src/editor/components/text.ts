import type { ComponentEditorRenderer, ComponentReaderRenderer } from '../component-helpers';

export const renderTextEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => `
  ${helpers.renderRichToolbar(sectionKey, block.id, { includeAlign: true, align: block.schema.align })}
  <div
    class="rich-editor"
    contenteditable="true"
    data-section-key="${helpers.escapeAttr(sectionKey)}"
    data-block-id="${helpers.escapeAttr(block.id)}"
    data-field="block-rich"
    ${block.schema.placeholder ? `data-placeholder="${helpers.escapeAttr(block.schema.placeholder)}"` : ''}
  >${helpers.markdownToEditorHtml(block.text)}</div>
`;

export const renderTextReader: ComponentReaderRenderer = (_section, block, helpers) =>
  helpers.renderComponentFragment('text', block.text, block);
