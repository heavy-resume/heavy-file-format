import type { VisualBlock } from './types';
import { getHostPlugin } from '../plugins/registry';
import { DEFAULT_COMPONENT_EDITOR_MINIMUM_WIDTH, normalizeComponentEditorMinimumWidth } from './component-editor-width-value';

export { DEFAULT_COMPONENT_EDITOR_MINIMUM_WIDTH, normalizeComponentEditorMinimumWidth } from './component-editor-width-value';

export function getComponentEditorMinimumWidth(block: VisualBlock): string {
  if (block.schema.kind !== 'plugin') {
    return DEFAULT_COMPONENT_EDITOR_MINIMUM_WIDTH;
  }
  const pluginId = (block.schema.plugin || '').trim();
  return normalizeComponentEditorMinimumWidth(getHostPlugin(pluginId)?.minimumEditorWidth);
}
