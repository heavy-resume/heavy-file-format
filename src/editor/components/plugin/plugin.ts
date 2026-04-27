import './plugin.css';
import type { ComponentEditorRenderer, ComponentReaderRenderer } from '../../component-helpers';
import type { VisualBlock } from '../../types';
import { getHostPlugins, getPluginDisplayName } from '../../../plugins/registry';
import { renderPluginMountPlaceholder } from '../../../plugins/mount';

// Renders the chooser used while a plugin block is empty (no plugin id yet).
// Lives in the block header — see renderPluginHeaderChooser below — but the
// markup is generated here so all plugin-block UI stays in this file.
export function renderPluginHeaderChooser(
  sectionKey: string,
  block: VisualBlock,
  escapeAttr: (v: string) => string,
  escapeHtml: (v: string) => string
): string {
  if ((block.schema.plugin || '').trim().length > 0) {
    return '';
  }
  const registrations = getHostPlugins();
  if (registrations.length === 0) {
    return `<span class="plugin-chooser-empty">No plugins installed</span>`;
  }
  const options = [
    `<option value="" selected>— select plugin —</option>`,
    ...registrations.map(
      (entry) => `<option value="${escapeAttr(entry.id)}">${escapeHtml(entry.displayName)}</option>`
    ),
  ].join('');
  return `
    <span class="plugin-chooser">
      <select data-field="block-plugin-pending">${options}</select>
      <button
        type="button"
        class="ghost"
        data-action="commit-plugin"
        data-section-key="${escapeAttr(sectionKey)}"
        data-block-id="${escapeAttr(block.id)}"
      >Use Plugin</button>
    </span>
  `;
}

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
    return `<div class="plugin-placeholder">Pick a plugin from the header above and click <strong>Use Plugin</strong>.</div>`;
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
