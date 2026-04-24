import { state } from '../state';

export interface DocumentPluginDefinition {
  id: string;
  source: string;
}

export const DB_TABLE_PLUGIN_ID = 'dev.heavy.db-table';
export const BUILTIN_DB_TABLE_PLUGIN_SOURCE = 'builtin://db-table';

export function isDbTablePluginId(pluginId: string): boolean {
  return pluginId === DB_TABLE_PLUGIN_ID;
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
    return [{ id: DB_TABLE_PLUGIN_ID, source: BUILTIN_DB_TABLE_PLUGIN_SOURCE }];
  }

  return normalized;
}

export function getPluginDisplayName(pluginId: string): string {
  if (isDbTablePluginId(pluginId)) {
    return 'DB Table';
  }
  return pluginId;
}
