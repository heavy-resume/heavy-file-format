import type { ComponentEditorRenderer, ComponentReaderRenderer } from '../component-helpers';

export const renderPluginEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => `
  <label>
    <span>Plugin URL</span>
    <input data-section-key="${helpers.escapeAttr(sectionKey)}" data-block-id="${helpers.escapeAttr(
      block.id
    )}" data-field="block-plugin-url" value="${helpers.escapeAttr(block.schema.pluginUrl)}" />
  </label>
  <div class="plugin-placeholder">Plugin placeholder: ${helpers.escapeHtml(block.schema.pluginUrl || 'No URL set')}</div>
`;

export const renderPluginReader: ComponentReaderRenderer = (_section, block, helpers) =>
  `<div class="plugin-placeholder">Plugin placeholder: ${helpers.escapeHtml(block.schema.pluginUrl || 'No URL set')}</div>`;
