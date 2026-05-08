import './text.css';
import type { ComponentEditorRenderer, ComponentReaderRenderer } from '../../component-helpers';
import { splitTextFillIn } from '../../../text-fill-in';
import { markdownToMobileAdjustmentEditorHtml } from '../../../markdown';

const FILL_IN_RENDER_TOKEN = 'HVY_FILL_IN_VALUE_TOKEN';

export const renderTextEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => {
  const fillIn = block.schema.fillIn ? splitTextFillIn(block.text) : null;
  if (fillIn) {
    const fillInBox = `<span
      class="text-fill-in-box"
      contenteditable="true"
      data-section-key="${helpers.escapeAttr(sectionKey)}"
      data-block-id="${helpers.escapeAttr(block.id)}"
      data-field="text-fill-in-value"
      data-fill-before="${helpers.escapeAttr(fillIn.before)}"
      data-fill-after="${helpers.escapeAttr(fillIn.after)}"
      data-placeholder="${helpers.escapeAttr(block.schema.placeholder || 'value')}"
    ></span>`;
    const html = helpers.markdownToEditorHtml(`${fillIn.before}${FILL_IN_RENDER_TOKEN}${fillIn.after}`).replace(
      FILL_IN_RENDER_TOKEN,
      fillInBox
    );
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
      data-section-key="${helpers.escapeAttr(sectionKey)}"
      data-block-id="${helpers.escapeAttr(block.id)}"
      data-field="block-rich"
      ${block.schema.align ? `style="text-align: ${helpers.escapeAttr(block.schema.align)};"` : ''}
      ${block.schema.placeholder ? `data-placeholder="${helpers.escapeAttr(block.schema.placeholder)}"` : ''}
    >${mobileAdjustment ? markdownToMobileAdjustmentEditorHtml(block.text) : helpers.markdownToEditorHtml(block.text)}</div>
  </div>
`;
};

export const renderTextReader: ComponentReaderRenderer = (_section, block, helpers) =>
  helpers.renderComponentFragment('text', block.text, block);
