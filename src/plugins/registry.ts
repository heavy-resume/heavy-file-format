import { state } from '../state';
import type { HvyPluginRegistration } from './types';

export interface DocumentPluginDefinition {
  id: string;
  source: string;
}

export const DB_TABLE_PLUGIN_ID = 'dev.heavy.db-table';
export const PROGRESS_BAR_PLUGIN_ID = 'dev.heavy.progress-bar';
export const SCRIPTING_PLUGIN_ID = 'dev.heavy.scripting';
export const BUILTIN_DB_TABLE_PLUGIN_SOURCE = 'builtin://db-table';
export const BUILTIN_PROGRESS_BAR_PLUGIN_SOURCE = 'builtin://progress-bar';
export const BUILTIN_SCRIPTING_PLUGIN_SOURCE = 'builtin://scripting';

export function isDbTablePluginId(pluginId: string): boolean {
  return pluginId === DB_TABLE_PLUGIN_ID;
}

// Host-supplied plugin registrations. The reference embedding sets these at
// startup; third-party hosts can append their own. Keep insertion order — it
// drives the order shown in the selector.
const hostPluginRegistrations: HvyPluginRegistration[] = [];

export function registerHostPlugin(registration: HvyPluginRegistration): void {
  const existingIndex = hostPluginRegistrations.findIndex((entry) => entry.id === registration.id);
  if (existingIndex >= 0) {
    hostPluginRegistrations[existingIndex] = registration;
  } else {
    hostPluginRegistrations.push(registration);
  }
}

export function setHostPlugins(registrations: HvyPluginRegistration[]): void {
  hostPluginRegistrations.length = 0;
  for (const registration of registrations) {
    hostPluginRegistrations.push(registration);
  }
}

export function getHostPlugins(): HvyPluginRegistration[] {
  return [...hostPluginRegistrations];
}

export function getHostPlugin(pluginId: string): HvyPluginRegistration | null {
  return hostPluginRegistrations.find((entry) => entry.id === pluginId) ?? null;
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
    return hostPluginRegistrations.map((entry) => ({
      id: entry.id,
      source:
        entry.id === DB_TABLE_PLUGIN_ID
          ? BUILTIN_DB_TABLE_PLUGIN_SOURCE
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
  return pluginId;
}
