import './text.css';
import type { ComponentEditorRenderer, ComponentReaderRenderer } from '../../component-helpers';
import { getTextFillInPlaceholder, splitTextFillIns } from '../../../text-fill-in';
import { state } from '../../../state';
import { getComponentSortValueDefs, getSortValueDefsForBlock, replaceSortValueAnnotations } from '../../../sort-values';
import type { SortValueDefinition } from '../../../types';
import { getReusableNameFromSectionKey } from '../../../component-defs';
import { findReusableOwner } from '../../../reusable';

const FILL_IN_RENDER_TOKEN_PREFIX = 'HVY_FILL_IN_VALUE_TOKEN_';

export const renderTextEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => {
  const textLineStyles = helpers.getTextLineStyles?.() ?? {};
  const codeLanguageInputAttrs = {
    'data-section-key': sectionKey,
    'data-block-id': block.id,
  };
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
    let html = renderMarkdownEditorHtmlWithSortValues(fillInSource, sectionKey, block, helpers, codeLanguageInputAttrs);
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
    : renderMarkdownEditorHtmlWithSortValues(block.text, sectionKey, block, helpers, codeLanguageInputAttrs);
  const mobileAdjustment = helpers.isMobileAdjustmentMode();
  const sortValueDefs = getSortValueDefsForEditorBlock(sectionKey, block);
  const useAsSelectionControl = mobileAdjustment
    ? ''
    : renderUseAsSelectionControl(sectionKey, block.id, sortValueDefs, helpers);
  const richToolbar = mobileAdjustment
    ? ''
    : helpers.renderRichToolbar(sectionKey, block.id, { includeAlign: true, includeFillIn: true, align: block.schema.align, currentMarkdown: block.text, textLineStyles });
  return `
  <div class="text-editor-shell">
    ${richToolbar ? `<div class="text-editor-toolbar-bounds"><div class="text-editor-toolbar-slot">${richToolbar}</div></div><div class="text-editor-toolbar-spacer"></div>` : ''}
    ${useAsSelectionControl}
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

function renderUseAsSelectionControl(
  sectionKey: string,
  blockId: string,
  sortValueDefs: Record<string, SortValueDefinition>,
  helpers: Parameters<ComponentEditorRenderer>[2]
): string {
  const sortOptions = Object.entries(sortValueDefs)
    .filter(([key]) => key.trim().length > 0)
    .sort(([left], [right]) => left.localeCompare(right, undefined, { sensitivity: 'base' }))
    .map(([key, definition]) => `<button
      type="button"
      class="ghost text-use-as-menu-item"
      data-rich-action="sort-value"
      data-sort-value-type="${helpers.escapeAttr(definition.type)}"
      data-sort-value-key="${helpers.escapeAttr(key)}"
      data-section-key="${helpers.escapeAttr(sectionKey)}"
      data-block-id="${helpers.escapeAttr(blockId)}"
      role="menuitem"
      title="Use selected text as the ${helpers.escapeAttr(key)} sort value"
    >Sort: ${helpers.escapeHtml(key)}</button>`)
    .join('');
  return `<div class="text-use-as-selection">
    <button
      type="button"
      class="text-use-as-button"
      aria-haspopup="menu"
      aria-expanded="false"
    >Use as...</button>
    <div class="text-use-as-menu" role="menu">
      <button
        type="button"
        class="ghost text-use-as-menu-item"
        data-rich-action="fill-in"
        data-section-key="${helpers.escapeAttr(sectionKey)}"
        data-block-id="${helpers.escapeAttr(blockId)}"
        role="menuitem"
      >Fill-in</button>
      ${sortOptions ? `<div class="text-use-as-menu-divider" role="separator"></div>${sortOptions}` : ''}
    </div>
  </div>`;
}

function renderRichTextWithFillIns(
  sectionKey: string,
  block: Parameters<ComponentEditorRenderer>[1],
  helpers: Parameters<ComponentEditorRenderer>[2],
  fillInParts: string[]
): string {
  const fillInSource = fillInParts
    .map((part, index) => (index < fillInParts.length - 1 ? `${part}${FILL_IN_RENDER_TOKEN_PREFIX}${index}` : part))
    .join('');
  let html = renderMarkdownEditorHtmlWithSortValues(fillInSource, sectionKey, block, helpers, {
    'data-section-key': sectionKey,
    'data-block-id': block.id,
  });
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

function renderMarkdownEditorHtmlWithSortValues(
  markdown: string,
  sectionKey: string,
  block: Parameters<ComponentEditorRenderer>[1],
  helpers: Parameters<ComponentEditorRenderer>[2],
  codeLanguageInputAttrs?: Record<string, string>
): string {
  const defs = getSortValueDefsForEditorBlock(sectionKey, block);
  if (Object.keys(defs).length === 0) {
    return helpers.markdownToEditorHtml(markdown, codeLanguageInputAttrs);
  }
  const replacements: string[] = [];
  const source = replaceSortValueAnnotations(markdown, (annotation) => {
    const token = `HVY_SORT_VALUE_TOKEN_${replacements.length}`;
    replacements.push(renderSortValueEditorControl(annotation.key, annotation.text, defs[annotation.key], sectionKey, block.id, helpers));
    return token;
  });
  let html = helpers.markdownToEditorHtml(source, codeLanguageInputAttrs);
  replacements.forEach((replacement, index) => {
    html = html.replace(`HVY_SORT_VALUE_TOKEN_${index}`, replacement);
  });
  return html;
}

function getSortValueDefsForEditorBlock(sectionKey: string, block: Parameters<ComponentEditorRenderer>[1]): Record<string, SortValueDefinition> {
  try {
    if (!state?.document) {
      return {};
    }
    if (getReusableNameFromSectionKey(sectionKey)) {
      const direct = getComponentSortValueDefs(state.document.meta, block.schema.component);
      if (Object.keys(direct).length > 0) {
        return direct;
      }
      const owner = findReusableOwner(sectionKey, block.id);
      return owner ? getComponentSortValueDefs(state.document.meta, owner.schema.component) : {};
    }
    return getSortValueDefsForBlock(state.document, block);
  } catch {
    return {};
  }
}

function renderSortValueEditorControl(
  key: string,
  text: string,
  definition: SortValueDefinition | undefined,
  sectionKey: string,
  blockId: string,
  helpers: Parameters<ComponentEditorRenderer>[2]
): string {
  if (definition?.type !== 'enum') {
    return `<span
      class="hvy-sort-value"
      data-hvy-sort-value="true"
      data-sort-value-key="${helpers.escapeAttr(key)}"
    >${helpers.escapeHtml(text)}</span>`;
  }
  const selected = text.trim();
  const options = (definition.options ?? []).map((option) =>
    `<option value="${helpers.escapeAttr(option.label)}"${option.label === selected ? ' selected' : ''}>${helpers.escapeHtml(option.label)}</option>`
  ).join('');
  return `<select
    class="hvy-sort-value hvy-sort-value-enum"
    contenteditable="false"
    data-hvy-sort-value="true"
    data-sort-value-key="${helpers.escapeAttr(key)}"
    data-field="sort-value-enum"
    data-section-key="${helpers.escapeAttr(sectionKey)}"
    data-block-id="${helpers.escapeAttr(blockId)}"
  >${options}</select>`;
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
