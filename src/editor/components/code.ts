import type { ComponentEditorRenderer, ComponentReaderRenderer } from '../component-helpers';

export const renderCodeEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => `
  <label>
    <span>Language</span>
    <input data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(
      block.id
    )}" data-field="block-code-language" value="${helpers.escapeAttr(block.schema.codeLanguage)}" />
  </label>
  <textarea class="code-editor" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(
    block.id
  )}" data-field="block-code">${helpers.escapeHtml(block.text)}</textarea>
`;

export const renderCodeReader: ComponentReaderRenderer = (_section, block, helpers) =>
  helpers.renderComponentFragment('code', block.text, block);
