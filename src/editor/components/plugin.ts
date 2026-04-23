import type { ComponentEditorRenderer, ComponentReaderRenderer } from '../component-helpers';
import { renderSqlitePluginEditor, renderSqlitePluginReader, SQLITE_TABLE_PLUGIN_ID } from '../../plugin-sqlite';

export const renderPluginEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => {
  if (block.schema.plugin === SQLITE_TABLE_PLUGIN_ID || block.schema.plugin.trim().length === 0) {
    return renderSqlitePluginEditor(sectionKey, block, helpers);
  }

  return `
    <label>
      <span>Plugin</span>
      <input
        data-section-key="${helpers.escapeAttr(sectionKey)}"
        data-block-id="${helpers.escapeAttr(block.id)}"
        data-field="block-plugin"
        value="${helpers.escapeAttr(block.schema.plugin)}"
        placeholder="${helpers.escapeAttr(SQLITE_TABLE_PLUGIN_ID)}"
      />
    </label>
    <div class="plugin-placeholder">Plugin placeholder: ${helpers.escapeHtml(block.schema.plugin || 'No plugin set')}</div>
  `;
};

export const renderPluginReader: ComponentReaderRenderer = (section, block, helpers) => {
  if (block.schema.plugin === SQLITE_TABLE_PLUGIN_ID || block.schema.plugin.trim().length === 0) {
    return renderSqlitePluginReader(section, block, helpers);
  }

  return `<div class="plugin-placeholder">Plugin placeholder: ${helpers.escapeHtml(block.schema.plugin || 'No plugin set')}</div>`;
};
