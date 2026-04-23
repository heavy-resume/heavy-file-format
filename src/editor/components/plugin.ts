import type { ComponentEditorRenderer, ComponentReaderRenderer } from '../component-helpers';

const SQLITE_TABLE_PLUGIN_ID = 'dev.heavy.sqlite-table';

function getPluginConfigValue(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  return typeof value === 'string' ? value : '';
}

export const renderPluginEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => {
  const pluginId = block.schema.plugin;
  const source = getPluginConfigValue(block.schema.pluginConfig, 'source') || 'with-file';
  const table = getPluginConfigValue(block.schema.pluginConfig, 'table');
  const isSqlitePlugin = pluginId.length === 0 || pluginId === SQLITE_TABLE_PLUGIN_ID;

  return `
    <label>
      <span>Plugin</span>
      <input
        data-section-key="${helpers.escapeAttr(sectionKey)}"
        data-block-id="${helpers.escapeAttr(block.id)}"
        data-field="block-plugin"
        value="${helpers.escapeAttr(pluginId)}"
        placeholder="${helpers.escapeAttr(SQLITE_TABLE_PLUGIN_ID)}"
      />
    </label>
    ${isSqlitePlugin
      ? `
        <label>
          <span>Source</span>
          <select disabled>
            <option selected>${helpers.escapeHtml(source)}</option>
          </select>
        </label>
        <label>
          <span>Table Name</span>
          <input
            data-section-key="${helpers.escapeAttr(sectionKey)}"
            data-block-id="${helpers.escapeAttr(block.id)}"
            data-field="block-plugin-db-table"
            value="${helpers.escapeAttr(table)}"
            placeholder="records"
          />
        </label>
      `
      : ''
    }
    <div class="plugin-placeholder">${helpers.escapeHtml(buildPluginSummary(pluginId, block.schema.pluginConfig))}</div>
  `;
};

export const renderPluginReader: ComponentReaderRenderer = (_section, block, helpers) =>
  `<div class="plugin-placeholder">${helpers.escapeHtml(buildPluginSummary(block.schema.plugin, block.schema.pluginConfig))}</div>`;

function buildPluginSummary(pluginId: string, config: Record<string, unknown>): string {
  const label = pluginId.trim().length > 0 ? pluginId : 'Plugin not configured';
  const source = getPluginConfigValue(config, 'source');
  const table = getPluginConfigValue(config, 'table');
  const details = [source ? `source=${source}` : '', table ? `table=${table}` : ''].filter(Boolean).join(', ');
  return details.length > 0 ? `${label} (${details})` : label;
}
