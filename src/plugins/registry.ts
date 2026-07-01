import { getActiveStateRuntime, state, type StateRuntime } from '../state';
import type { HvyOutputGenerator, HvyPlugin } from './types';

export interface DocumentPluginDefinition {
  id: string;
  source: string;
}

export const DB_TABLE_PLUGIN_ID = 'hvy.db-table';
export const FORM_PLUGIN_ID = 'hvy.form';
export const PROGRESS_BAR_PLUGIN_ID = 'hvy.progress-bar';
export const SCRIPTING_PLUGIN_ID = 'hvy.scripting';
export const GRAPH_PLUGIN_ID = 'hvy.graph';
export const DIAGRAM_PLUGIN_ID = 'hvy.diagram';
export const QR_CODE_PLUGIN_ID = 'hvy.qr-code';
export const VIDEO_PLUGIN_ID = 'hvy.video';
export const VIEWER_NOTE_PLUGIN_ID = 'hvy.viewer-note';
export const BUILTIN_DB_TABLE_PLUGIN_SOURCE = 'builtin://db-table';
export const BUILTIN_FORM_PLUGIN_SOURCE = 'builtin://form';
export const BUILTIN_PROGRESS_BAR_PLUGIN_SOURCE = 'builtin://progress-bar';
export const BUILTIN_SCRIPTING_PLUGIN_SOURCE = 'builtin://scripting';
export const BUILTIN_GRAPH_PLUGIN_SOURCE = 'builtin://graph';
export const BUILTIN_DIAGRAM_PLUGIN_SOURCE = 'builtin://diagram';
export const BUILTIN_QR_CODE_PLUGIN_SOURCE = 'builtin://qr-code';
export const BUILTIN_VIDEO_PLUGIN_SOURCE = 'builtin://video';
export const BUILTIN_VIEWER_NOTE_PLUGIN_SOURCE = 'builtin://viewer-note';

const BUILTIN_PLUGIN_SOURCES: Record<string, string> = {
  [DB_TABLE_PLUGIN_ID]: BUILTIN_DB_TABLE_PLUGIN_SOURCE,
  [FORM_PLUGIN_ID]: BUILTIN_FORM_PLUGIN_SOURCE,
  [PROGRESS_BAR_PLUGIN_ID]: BUILTIN_PROGRESS_BAR_PLUGIN_SOURCE,
  [SCRIPTING_PLUGIN_ID]: BUILTIN_SCRIPTING_PLUGIN_SOURCE,
  [GRAPH_PLUGIN_ID]: BUILTIN_GRAPH_PLUGIN_SOURCE,
  [DIAGRAM_PLUGIN_ID]: BUILTIN_DIAGRAM_PLUGIN_SOURCE,
  [QR_CODE_PLUGIN_ID]: BUILTIN_QR_CODE_PLUGIN_SOURCE,
  [VIDEO_PLUGIN_ID]: BUILTIN_VIDEO_PLUGIN_SOURCE,
  [VIEWER_NOTE_PLUGIN_ID]: BUILTIN_VIEWER_NOTE_PLUGIN_SOURCE,
};

export function isDbTablePluginId(pluginId: string): boolean {
  return pluginId === DB_TABLE_PLUGIN_ID;
}

// Host-supplied plugin objects. Keep insertion order — it drives the selector
// order and hook tie-breaking.
const fallbackHostPlugins: HvyPlugin[] = [];
const hostPluginsByRuntime = new WeakMap<StateRuntime, HvyPlugin[]>();

function getMutableHostPlugins(): HvyPlugin[] {
  try {
    const runtime = getActiveStateRuntime();
    let plugins = hostPluginsByRuntime.get(runtime);
    if (!plugins) {
      plugins = [...fallbackHostPlugins];
      hostPluginsByRuntime.set(runtime, plugins);
    }
    return plugins;
  } catch {
    return fallbackHostPlugins;
  }
}

export function registerHostPlugin(plugin: HvyPlugin): void {
  const hostPlugins = getMutableHostPlugins();
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
  const hostPlugins = getMutableHostPlugins();
  assertUniqueOutputGeneratorKeys(plugins);
  hostPlugins.length = 0;
  for (const plugin of plugins) {
    hostPlugins.push(plugin);
  }
}

export function getHostPlugins(): HvyPlugin[] {
  const hostPlugins = getMutableHostPlugins();
  return [...hostPlugins];
}

export function getRenderableHostPlugins(): HvyPlugin[] {
  const hostPlugins = getMutableHostPlugins();
  return hostPlugins.filter((plugin) => typeof plugin.create === 'function' || (plugin.components?.length ?? 0) > 0);
}

export function getHostPlugin(pluginId: string): HvyPlugin | null {
  const hostPlugins = getMutableHostPlugins();
  return hostPlugins.find((entry) => entry.id === pluginId) ?? null;
}

export function getAvailableOutputGenerators(): HvyOutputGenerator[] {
  const hostPlugins = getMutableHostPlugins();
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
    return getRenderableHostPlugins().map((entry) => ({
      id: entry.id,
      source: BUILTIN_PLUGIN_SOURCES[entry.id] ?? `host://${entry.id}`,
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
  if (pluginId === GRAPH_PLUGIN_ID) {
    return 'Graph';
  }
  if (pluginId === DIAGRAM_PLUGIN_ID) {
    return 'Diagram';
  }
  if (pluginId === QR_CODE_PLUGIN_ID) {
    return 'QR Code';
  }
  if (pluginId === VIDEO_PLUGIN_ID) {
    return 'Video';
  }
  if (pluginId === VIEWER_NOTE_PLUGIN_ID) {
    return 'Viewer Note';
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
