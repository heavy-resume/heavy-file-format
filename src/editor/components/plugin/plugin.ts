import './plugin.css';
import type { ComponentEditorRenderer, ComponentReaderRenderer } from '../../component-helpers';
import { renderDbTablePluginEditor, renderDbTablePluginReader } from '../../../plugins/db-table';
import { DB_TABLE_PLUGIN_ID, getPluginDisplayName, isDbTablePluginId } from '../../../plugins/registry';

export const renderPluginEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => {
  if (isDbTablePluginId(block.schema.plugin) || block.schema.plugin.trim().length === 0) {
    return renderDbTablePluginEditor(sectionKey, block, helpers);
  }

  return `
    <label>
      <span>DB Table</span>
      <select
        data-section-key="${helpers.escapeAttr(sectionKey)}"
        data-block-id="${helpers.escapeAttr(block.id)}"
        data-field="block-plugin"
        disabled
      >
        <option selected>${helpers.escapeHtml(getPluginDisplayName(block.schema.plugin || DB_TABLE_PLUGIN_ID))}</option>
      </select>
    </label>
    <div class="plugin-placeholder">This plugin is not available in the current reader.</div>
  `;
};

export const renderPluginReader: ComponentReaderRenderer = (section, block, helpers) => {
  if (isDbTablePluginId(block.schema.plugin) || block.schema.plugin.trim().length === 0) {
    return renderDbTablePluginReader(section, block, helpers);
  }

  return `<div class="plugin-placeholder">This plugin is not available in the current reader.</div>`;
};
