import './text.css';
import type { ComponentEditorRenderer, ComponentReaderRenderer } from '../../component-helpers';
import { splitTextFillIn } from '../../../text-fill-in';

export const renderTextEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => {
  const fillIn = block.schema.fillIn ? splitTextFillIn(block.text) : null;
  if (fillIn) {
    return `
      <div class="text-fill-in-editor" style="text-align: ${helpers.escapeAttr(block.schema.align)};">
        <span class="text-fill-in-scaffold">${helpers.escapeHtml(fillIn.before)}</span>
        <input
          data-section-key="${helpers.escapeAttr(sectionKey)}"
          data-block-id="${helpers.escapeAttr(block.id)}"
          data-field="text-fill-in-value"
          placeholder="${helpers.escapeAttr(block.schema.placeholder || 'value')}"
        />
        <span class="text-fill-in-scaffold">${helpers.escapeHtml(fillIn.after)}</span>
        <button type="button" class="secondary" data-action="apply-text-fill-in" data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(block.id)}">Apply</button>
      </div>
    `;
  }
  return `
    ${helpers.renderRichToolbar(sectionKey, block.id, { includeAlign: true, align: block.schema.align, currentMarkdown: block.text })}
  <div
    class="rich-editor"
    contenteditable="true"
    data-section-key="${helpers.escapeAttr(sectionKey)}"
    data-block-id="${helpers.escapeAttr(block.id)}"
    data-field="block-rich"
    ${block.schema.align ? `style="text-align: ${helpers.escapeAttr(block.schema.align)};"` : ''}
    ${block.schema.placeholder ? `data-placeholder="${helpers.escapeAttr(block.schema.placeholder)}"` : ''}
  >${helpers.markdownToEditorHtml(block.text)}</div>
`;
};

export const renderTextReader: ComponentReaderRenderer = (_section, block, helpers) =>
  helpers.renderComponentFragment('text', block.text, block);
