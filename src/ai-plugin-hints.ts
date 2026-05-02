import { createEmptyBlock } from './document-factory';
import type { VisualBlock } from './editor/types';
import { getHostPlugin, getHostPlugins } from './plugins/registry';

export interface AiPluginHint {
  id: string;
  displayName: string;
  hint: string;
}

function readPluginHint(registration: ReturnType<typeof getHostPlugins>[number], block: VisualBlock): string {
  if (typeof registration.aiHint === 'string') {
    return registration.aiHint.trim();
  }
  if (typeof registration.aiHint === 'function') {
    return registration.aiHint(block).trim();
  }
  return '';
}

function readPluginHelp(registration: ReturnType<typeof getHostPlugins>[number], block?: VisualBlock): string {
  if (typeof registration.aiHelp === 'string') {
    return registration.aiHelp.trim();
  }
  if (typeof registration.aiHelp === 'function') {
    return registration.aiHelp(block).trim();
  }
  return readPluginHint(registration, block ?? createEmptyBlock('plugin', true));
}

export function getRegisteredPluginAiHints(): AiPluginHint[] {
  return getHostPlugins().map((registration) => {
    const block = createEmptyBlock('plugin', true);
    block.schema.plugin = registration.id;
    const hint = readPluginHint(registration, block);
    return {
      id: registration.id,
      displayName: registration.displayName,
      hint,
    };
  });
}

export function getPluginAiHintForBlock(block: VisualBlock): string {
  const pluginId = typeof block.schema.plugin === 'string' ? block.schema.plugin : '';
  const registration = pluginId.length > 0 ? getHostPlugin(pluginId) : null;
  if (!registration) {
    return '';
  }
  return readPluginHint(registration, block);
}

export function getPluginAiHelp(pluginId: string, block?: VisualBlock): string {
  const registration = getHostPlugin(pluginId);
  if (!registration) {
    return `No registered plugin found for "${pluginId}".`;
  }
  const help = readPluginHelp(registration, block);
  return [
    `${registration.displayName} (${registration.id})`,
    help || '(no plugin-specific help registered)',
  ].join('\n');
}
