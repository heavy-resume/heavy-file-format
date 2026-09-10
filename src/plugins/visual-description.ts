import type { VisualBlock } from '../editor/types';
import type { VisualDocument } from '../types';
import { getHostPlugin } from './registry';

export const PLUGIN_VISUAL_DESCRIPTION_FIELD = 'pluginVisualDescription';
export const PLUGIN_VISUAL_DESCRIPTION_LABEL = 'Visual description';

export function getPluginVisualDescription(document: VisualDocument, block: VisualBlock): string {
  if (block.schema.component !== 'plugin') {
    return '';
  }
  const pluginId = block.schema.plugin.trim();
  const capability = pluginId ? getHostPlugin(pluginId)?.visualDescription : undefined;
  if (!capability) {
    return '';
  }
  return capability.describe({ block, rawDocument: document })?.trim() ?? '';
}

export function formatPluginVisualDescriptionForAgent(description: string): string {
  const normalized = description.trim();
  if (!normalized) {
    return '';
  }
  return [
    '--- begin plugin visual description (rendered output; not serialized document text) ---',
    normalized,
    '--- end plugin visual description ---',
  ].join('\n');
}
