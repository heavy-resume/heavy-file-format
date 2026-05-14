import { state } from '../state';
import type { HvyOutputGenerator, HvyPlugin } from './types';

export interface DocumentPluginDefinition {
  id: string;
  source: string;
}

export const DB_TABLE_PLUGIN_ID = 'dev.heavy.db-table';
export const FORM_PLUGIN_ID = 'dev.heavy.form';
export const PROGRESS_BAR_PLUGIN_ID = 'dev.heavy.progress-bar';
export const SCRIPTING_PLUGIN_ID = 'dev.heavy.scripting';
export const BUILTIN_DB_TABLE_PLUGIN_SOURCE = 'builtin://db-table';
export const BUILTIN_FORM_PLUGIN_SOURCE = 'builtin://form';
export const BUILTIN_PROGRESS_BAR_PLUGIN_SOURCE = 'builtin://progress-bar';
export const BUILTIN_SCRIPTING_PLUGIN_SOURCE = 'builtin://scripting';

export function isDbTablePluginId(pluginId: string): boolean {
  return pluginId === DB_TABLE_PLUGIN_ID;
}

// Host-supplied plugin objects. Keep insertion order — it drives the selector
// order and hook tie-breaking.
const hostPlugins: HvyPlugin[] = [];

export function registerHostPlugin(plugin: HvyPlugin): void {
  const nextPlugins = [...hostPlugins];
  const nextExistingIndex = nextPlugins.findIndex((entry) => entry.id === plugin.id);
  if (nextExistingIndex >= 0) {
    nextPlugins[nextExistingIndex] = plugin;
  } else {
    nextPlugins.push(plugin);
  }
  assertUniqueOutputGeneratorKeys(nextPlugins);
  const existingIndex = hostPlugins.findIndex((entry) => entry.id === plugin.id);
  if (existingIndex >= 0) {
    hostPlugins[existingIndex] = plugin;
  } else {
    hostPlugins.push(plugin);
  }
}

export function setHostPlugins(plugins: HvyPlugin[]): void {
  assertUniqueOutputGeneratorKeys(plugins);
  hostPlugins.length = 0;
  for (const plugin of plugins) {
    hostPlugins.push(plugin);
  }
}

export function getHostPlugins(): HvyPlugin[] {
  return [...hostPlugins];
}

export function getHostPlugin(pluginId: string): HvyPlugin | null {
  return hostPlugins.find((entry) => entry.id === pluginId) ?? null;
}

export function getAvailableOutputGenerators(): HvyOutputGenerator[] {
  return hostPlugins.flatMap((plugin) => plugin.outputGenerators ?? []);
}

export function getOutputGenerator(key: string): HvyOutputGenerator | null {
  return getAvailableOutputGenerators().find((generator) => generator.key === key) ?? null;
}

export function getAvailableDocumentPlugins(): DocumentPluginDefinition[] {
  const plugins = Array.isArray(state.document.meta.plugins) ? state.document.meta.plugins : [];
  const normalized = plugins
    .map((candidate) => {
      if (!candidate || typeof candidate !== 'object') {
        return null;
      }
      const plugin = candidate as Record<string, unknown>;
      const id = typeof plugin.id === 'string' ? plugin.id.trim() : '';
      const source = typeof plugin.source === 'string' ? plugin.source.trim() : '';
      if (id.length === 0) {
        return null;
      }
      return { id, source };
    })
    .filter((candidate): candidate is DocumentPluginDefinition => candidate !== null);

  if (normalized.length === 0) {
    return hostPlugins.map((entry) => ({
      id: entry.id,
      source:
        entry.id === DB_TABLE_PLUGIN_ID
          ? BUILTIN_DB_TABLE_PLUGIN_SOURCE
          : entry.id === FORM_PLUGIN_ID
            ? BUILTIN_FORM_PLUGIN_SOURCE
          : entry.id === PROGRESS_BAR_PLUGIN_ID
            ? BUILTIN_PROGRESS_BAR_PLUGIN_SOURCE
            : entry.id === SCRIPTING_PLUGIN_ID
              ? BUILTIN_SCRIPTING_PLUGIN_SOURCE
              : `host://${entry.id}`,
    }));
  }

  return normalized;
}

export function getPluginDisplayName(pluginId: string): string {
  const registration = getHostPlugin(pluginId);
  if (registration) {
    return registration.displayName;
  }
  if (isDbTablePluginId(pluginId)) {
    return 'DB Table';
  }
  if (pluginId === FORM_PLUGIN_ID) {
    return 'Form';
  }
  return pluginId;
}

function assertUniqueOutputGeneratorKeys(plugins: HvyPlugin[]): void {
  const seen = new Set<string>();
  for (const plugin of plugins) {
    for (const generator of plugin.outputGenerators ?? []) {
      const key = generator.key.trim();
      if (!key) {
        throw new Error(`Output generator key for plugin "${plugin.id}" cannot be blank.`);
      }
      if (seen.has(key)) {
        throw new Error(`Duplicate output generator key "${key}".`);
      }
      seen.add(key);
    }
  }
}
