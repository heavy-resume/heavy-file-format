import './text.css';
import type { ComponentEditorRenderer, ComponentReaderRenderer } from '../../component-helpers';
import { getTextFillInPlaceholder, splitTextFillIns } from '../../../text-fill-in';
import { state } from '../../../state';

const FILL_IN_RENDER_TOKEN_PREFIX = 'HVY_FILL_IN_VALUE_TOKEN_';

export const renderTextEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => {
  const textLineStyles = helpers.getTextLineStyles?.() ?? {};
  const fillInParts = block.schema.fillIn ? splitTextFillIns(block.text) : [];
  const alignStyle = block.schema.align === 'left' ? '' : ` style="text-align: ${helpers.escapeAttr(block.schema.align)};"`;
  if (fillInParts.length > 1 && isFillInEditorMode(sectionKey, block.id)) {
    const richToolbar = fillInParts.length === 2
      ? helpers.renderRichToolbar(sectionKey, block.id, { field: 'text-fill-in-rich', includeAlign: true, align: block.schema.align, currentMarkdown: block.text, textLineStyles })
      : '';
    const richEditorAttributes = richToolbar
      ? `
        data-section-key="${helpers.escapeAttr(sectionKey)}"
        data-block-id="${helpers.escapeAttr(block.id)}"
        data-field="text-fill-in-rich"
        contenteditable="false"`
      : '';
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
          data-placeholder="${helpers.escapeAttr(getTextFillInPlaceholder(block.text, index))}"
        ></span>`
      );
    }
    return `
      ${richToolbar}
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
      <div
        class="rich-editor text-fill-in-editor"
        ${richEditorAttributes}
        data-fill-parts="${helpers.escapeAttr(JSON.stringify(fillInParts))}"
        ${alignStyle}
      >
        ${html}
      </div>
    `;
  }
  const editorHtml = fillInParts.length > 1
    ? renderRichTextWithFillIns(sectionKey, block, helpers, fillInParts)
    : helpers.markdownToEditorHtml(block.text);
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
  const richToolbar = mobileAdjustment
    ? ''
    : helpers.renderRichToolbar(sectionKey, block.id, { includeAlign: true, includeFillIn: true, align: block.schema.align, currentMarkdown: block.text, textLineStyles });
  return `
  <div class="text-editor-shell">
    ${richToolbar ? `<div class="text-editor-toolbar-bounds"><div class="text-editor-toolbar-slot">${richToolbar}</div></div><div class="text-editor-toolbar-spacer"></div>` : ''}
    ${fillInSelectionButton}
    <div
      class="rich-editor${mobileAdjustment ? ' mobile-adjustment-editor' : ''}"
      contenteditable="true"
      spellcheck="true"
      data-section-key="${helpers.escapeAttr(sectionKey)}"
      data-block-id="${helpers.escapeAttr(block.id)}"
      data-field="block-rich"
      ${alignStyle}
      ${block.schema.placeholder ? `data-placeholder="${helpers.escapeAttr(block.schema.placeholder)}"` : ''}
    >${editorHtml}</div>
  </div>
`;
};

function renderRichTextWithFillIns(
  sectionKey: string,
  block: Parameters<ComponentEditorRenderer>[1],
  helpers: Parameters<ComponentEditorRenderer>[2],
  fillInParts: string[]
): string {
  const fillInSource = fillInParts
    .map((part, index) => (index < fillInParts.length - 1 ? `${part}${FILL_IN_RENDER_TOKEN_PREFIX}${index}` : part))
    .join('');
  let html = helpers.markdownToEditorHtml(fillInSource);
  for (let index = 0; index < fillInParts.length - 1; index += 1) {
    const placeholder = getTextFillInPlaceholder(block.text, index);
    html = html.replace(
      `${FILL_IN_RENDER_TOKEN_PREFIX}${index}`,
      `<span
        class="text-fill-in-box text-fill-in-rich-marker"
        contenteditable="false"
        data-section-key="${helpers.escapeAttr(sectionKey)}"
        data-block-id="${helpers.escapeAttr(block.id)}"
        data-hvy-fill-in-marker="true"
        data-placeholder="${helpers.escapeAttr(placeholder)}"
      >${helpers.escapeHtml(placeholder || 'value')}</span>`
    );
  }
  return html;
}

function isFillInEditorMode(sectionKey: string, blockId: string): boolean {
  return state.activeTextEditorMode?.sectionKey === sectionKey
    && state.activeTextEditorMode.blockId === blockId
    && state.activeTextEditorMode.mode === 'fill-in';
}

export const renderTextReader: ComponentReaderRenderer = (section, block, helpers) =>
  block.schema.showCopy
    ? `${helpers.renderComponentFragment('text', block.text, block, section.key)}
      <button
        type="button"
        class="text-copy-button"
        data-action="copy-text-component"
        data-section-key="${helpers.escapeAttr(section.key)}"
        data-block-id="${helpers.escapeAttr(block.id)}"
        aria-label="Copy text"
        title="Copy text"
      ><span class="text-copy-icon" aria-hidden="true"></span></button>`
    : helpers.renderComponentFragment('text', block.text, block, section.key);
