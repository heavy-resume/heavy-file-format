import './code.css';
import type { ComponentEditorRenderer, ComponentReaderRenderer } from '../../component-helpers';

export const renderCodeEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => `
  <div class="code-editor-shell">
    <div class="code-editor-head">
      <label class="code-language-field">
        <span>Language</span>
        <input
          data-section-key="${helpers.escapeAttr(sectionKey)}"
          data-block-id="${helpers.escapeAttr(block.id)}"
          data-field="block-code-language"
          value="${helpers.escapeAttr(block.schema.codeLanguage)}"
          placeholder="ts, py, json..."
        />
      </label>
    </div>
    <textarea class="code-editor" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(
      block.id
    )}" data-field="block-code" spellcheck="false">${helpers.escapeHtml(block.text)}</textarea>
  </div>
`;

export const renderCodeReader: ComponentReaderRenderer = (_section, block, helpers) =>
  helpers.renderComponentFragment('code', block.text, block);
