import './plugin.css';
import type { ComponentEditorRenderer, ComponentReaderRenderer } from '../../component-helpers';
import { getHostPlugins, getPluginDisplayName } from '../../../plugins/registry';
import { renderPluginMountPlaceholder } from '../../../plugins/mount';

function renderPluginSelector(sectionKey: string, blockId: string, selected: string, escapeAttr: (v: string) => string, escapeHtml: (v: string) => string): string {
  const registrations = getHostPlugins();
  const knownIds = new Set(registrations.map((entry) => entry.id));
  const placeholderOption = `<option value="" ${selected.length === 0 ? 'selected' : ''}>— select plugin —</option>`;
  const knownOptions = registrations
    .map((entry) => `<option value="${escapeAttr(entry.id)}" ${entry.id === selected ? 'selected' : ''}>${escapeHtml(entry.displayName)}</option>`)
    .join('');
  const unknownOption =
    selected.length > 0 && !knownIds.has(selected)
      ? `<option value="${escapeAttr(selected)}" selected>${escapeHtml(getPluginDisplayName(selected))} (unavailable)</option>`
      : '';
  return `
    <label class="plugin-selector">
      <span>Plugin</span>
      <select
        data-section-key="${escapeAttr(sectionKey)}"
        data-block-id="${escapeAttr(blockId)}"
        data-field="block-plugin"
      >${placeholderOption}${knownOptions}${unknownOption}</select>
    </label>
  `;
}

export const renderPluginEditor: ComponentEditorRenderer = (sectionKey, block, helpers) => {
  const pluginId = (block.schema.plugin || '').trim();
  const selector = renderPluginSelector(sectionKey, block.id, pluginId, helpers.escapeAttr, helpers.escapeHtml);

  if (pluginId.length === 0) {
    return `${selector}<div class="plugin-placeholder">Choose a plugin to use here.</div>`;
  }

  const mount = renderPluginMountPlaceholder(pluginId, 'editor', sectionKey, block.id, helpers.escapeAttr);
  return `${selector}${mount}`;
};

export const renderPluginReader: ComponentReaderRenderer = (section, block, helpers) => {
  const pluginId = (block.schema.plugin || '').trim();
  if (pluginId.length === 0) {
    return `<div class="plugin-placeholder">No plugin selected.</div>`;
  }
  return renderPluginMountPlaceholder(pluginId, 'reader', section.key, block.id, helpers.escapeAttr);
};
