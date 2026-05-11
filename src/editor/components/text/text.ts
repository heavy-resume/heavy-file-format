import './text.css';
import type { ComponentEditorRenderer, ComponentReaderRenderer } from '../../component-helpers';
import { getTextFillInPlaceholder, splitTextFillIns } from '../../../text-fill-in';

const FILL_IN_RENDER_TOKEN_PREFIX = 'HVY_FILL_IN_VALUE_TOKEN_';

export const renderTextEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => {
  const fillInParts = block.schema.fillIn ? splitTextFillIns(block.text) : [];
  if (fillInParts.length > 1) {
    const fillInSource = fillInParts
      .map((part, index) => (index < fillInParts.length - 1 ? `${part}${FILL_IN_RENDER_TOKEN_PREFIX}${index}` : part))
      .join('');
    let html = helpers.markdownToEditorHtml(fillInSource);
    for (let index = 0; index < fillInParts.length - 1; index += 1) {
      html = html.replace(
        `${FILL_IN_RENDER_TOKEN_PREFIX}${index}`,
        `<span
          class="text-fill-in-box"
          contenteditable="true"
          spellcheck="true"
          data-section-key="${helpers.escapeAttr(sectionKey)}"
          data-block-id="${helpers.escapeAttr(block.id)}"
          data-field="text-fill-in-value"
          data-fill-index="${String(index)}"
          data-placeholder="${helpers.escapeAttr(getTextFillInPlaceholder(block.schema.placeholder, index))}"
        ></span>`
      );
    }
    return `
      <div class="rich-toolbar text-fill-in-toolbar">
        <div class="toolbar-segment" role="group" aria-label="Fill-in slot">
          <button
            type="button"
            class="ghost"
            data-action="remove-text-fill-in"
            data-section-key="${helpers.escapeAttr(sectionKey)}"
            data-block-id="${helpers.escapeAttr(block.id)}"
          >Remove Fill-in</button>
        </div>
      </div>
      <div class="rich-editor text-fill-in-editor" style="text-align: ${helpers.escapeAttr(block.schema.align)};">
        ${html}
      </div>
    `;
  }
  const mobileAdjustment = helpers.isMobileAdjustmentMode();
  const fillInSelectionButton = mobileAdjustment
    ? ''
    : `<button
        type="button"
        class="text-fill-in-selection-button"
        data-rich-action="fill-in"
        data-section-key="${helpers.escapeAttr(sectionKey)}"
        data-block-id="${helpers.escapeAttr(block.id)}"
      >Convert to Fill-in</button>`;
  return `
    ${mobileAdjustment ? '' : helpers.renderRichToolbar(sectionKey, block.id, { includeAlign: true, includeFillIn: true, align: block.schema.align, currentMarkdown: block.text })}
  <div class="text-editor-shell">
    ${fillInSelectionButton}
    <div
      class="rich-editor${mobileAdjustment ? ' mobile-adjustment-editor' : ''}"
      contenteditable="true"
      spellcheck="true"
      data-section-key="${helpers.escapeAttr(sectionKey)}"
      data-block-id="${helpers.escapeAttr(block.id)}"
      data-field="block-rich"
      ${block.schema.align ? `style="text-align: ${helpers.escapeAttr(block.schema.align)};"` : ''}
      ${block.schema.placeholder ? `data-placeholder="${helpers.escapeAttr(block.schema.placeholder)}"` : ''}
    >${helpers.markdownToEditorHtml(block.text)}</div>
  </div>
`;
};

export const renderTextReader: ComponentReaderRenderer = (_section, block, helpers) =>
  helpers.renderComponentFragment('text', block.text, block);
