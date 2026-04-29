import type { JsonObject } from '../../hvy/types';

export const SCRIPTING_PLUGIN_VERSION = '0.1';

export function getScriptingPluginVersion(pluginConfig: JsonObject | null | undefined): string {
  const rawVersion = pluginConfig && typeof pluginConfig.version === 'string' ? pluginConfig.version.trim() : '';
  return rawVersion.length > 0 ? rawVersion : SCRIPTING_PLUGIN_VERSION;
}
