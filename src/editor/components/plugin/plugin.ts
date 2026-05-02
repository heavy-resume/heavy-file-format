import './plugin.css';
import type { ComponentEditorRenderer, ComponentReaderRenderer } from '../../component-helpers';
import type { VisualBlock } from '../../types';
import { getHostPlugins, getPluginDisplayName } from '../../../plugins/registry';
import { renderPluginMountPlaceholder } from '../../../plugins/mount';

// Returns the title shown in the block header. For locked plugins, it's the
// installed plugin's display name (or the raw id with "(unavailable)" if the
// host doesn't know it).
export function getPluginBlockHeaderLabel(block: VisualBlock): string {
  const id = (block.schema.plugin || '').trim();
  if (id.length === 0) {
    return 'Plugin';
  }
  const known = getHostPlugins().some((entry) => entry.id === id);
  return known ? getPluginDisplayName(id) : `${getPluginDisplayName(id)} (unavailable)`;
}

export const renderPluginEditor: ComponentEditorRenderer = (sectionKey, block) => {
  const pluginId = (block.schema.plugin || '').trim();
  if (pluginId.length === 0) {
    return `<div class="plugin-placeholder">Add a plugin from the component picker.</div>`;
  }
  return renderPluginMountPlaceholder(pluginId, 'editor', sectionKey, block.id, (value) =>
    value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  );
};

export const renderPluginReader: ComponentReaderRenderer = (section, block, helpers) => {
  const pluginId = (block.schema.plugin || '').trim();
  if (pluginId.length === 0) {
    return `<div class="plugin-placeholder">No plugin selected.</div>`;
  }
  return renderPluginMountPlaceholder(pluginId, 'reader', section.key, block.id, helpers.escapeAttr);
};
