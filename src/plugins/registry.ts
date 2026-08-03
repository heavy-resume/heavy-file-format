import { getActiveStateRuntime, state, type StateRuntime } from '../state';
import type { VisualDocument } from '../types';
import { rcompare, satisfies, valid } from 'semver';
import { isReservedHvyPluginName, normalizeHvyPluginDeclarations } from './declarations';
import type { HvyOutputGenerator, HvyPlugin, HvyPluginInput } from './types';
import { getLoadedConditionalPlugin } from './authorization/conditional-plugin';

export interface DocumentPluginDefinition {
  id: string;
  uuid?: string;
  versionRange?: string;
  permissions: string[];
}

export const HVY_PLUGIN_API_VERSION = '0.1';
export const HVY_BUILT_IN_PLUGIN_VERSION = '0.1.0';
export const HVY_LEGACY_PLUGIN_VERSION = '0.0.0';
export const DB_TABLE_PLUGIN_ID = 'hvy.db-table';
export const DB_TABLE_PLUGIN_VERSION = '0.2.0';
export const FORM_PLUGIN_ID = 'hvy.form';
export const PROGRESS_BAR_PLUGIN_ID = 'hvy.progress-bar';
export const SCRIPTING_PLUGIN_ID = 'hvy.scripting';
export const GRAPH_PLUGIN_ID = 'hvy.graph';
export const DIAGRAM_PLUGIN_ID = 'hvy.diagram';
export const QR_CODE_PLUGIN_ID = 'hvy.qr-code';
export const VIDEO_PLUGIN_ID = 'hvy.video';
export const EDITABLE_TEXT_PLUGIN_ID = 'hvy.editable-text';
export const CANVAS_PLUGIN_ID = 'hvy.canvas';
export const POWER_SCRIPTING_PLUGIN_ID = 'hvy.power-scripting';
export function createBuiltInPluginMetadata(id: string, version = HVY_BUILT_IN_PLUGIN_VERSION): Pick<HvyPlugin, 'id' | 'version' | 'hvyApiVersion'> {
  return {
    id,
    version,
    hvyApiVersion: HVY_PLUGIN_API_VERSION,
  };
}

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

export function registerHostPlugin(input: HvyPluginInput): void {
  const plugin = normalizeHostPlugin(input);
  validateHostPlugin(plugin);
  const hostPlugins = getMutableHostPlugins();
  const nextPlugins = [...hostPlugins];
  const nextExistingIndex = nextPlugins.findIndex((entry) => (
    entry.id === plugin.id && entry.uuid === plugin.uuid && entry.version === plugin.version
  ));
  if (nextExistingIndex >= 0) {
    nextPlugins[nextExistingIndex] = plugin;
  } else {
    nextPlugins.push(plugin);
  }
  assertUniqueOutputGeneratorKeys(selectHostPlugins(nextPlugins));
  const existingIndex = hostPlugins.findIndex((entry) => (
    entry.id === plugin.id && entry.uuid === plugin.uuid && entry.version === plugin.version
  ));
  if (existingIndex >= 0) {
    hostPlugins[existingIndex] = plugin;
  } else {
    hostPlugins.push(plugin);
  }
}

export function setHostPlugins(inputs: HvyPluginInput[]): void {
  const hostPlugins = getMutableHostPlugins();
  const plugins = inputs.map(normalizeHostPlugin);
  plugins.forEach(validateHostPlugin);
  assertUniqueOutputGeneratorKeys(selectHostPlugins(plugins));
  hostPlugins.length = 0;
  for (const plugin of plugins) {
    hostPlugins.push(plugin);
  }
}

function normalizeHostPlugin(plugin: HvyPluginInput): HvyPlugin {
  return {
    ...plugin,
    version: plugin.version === undefined ? HVY_LEGACY_PLUGIN_VERSION : plugin.version,
    hvyApiVersion: plugin.hvyApiVersion === undefined ? HVY_PLUGIN_API_VERSION : plugin.hvyApiVersion,
  };
}

export function getHostPlugins(): HvyPlugin[] {
  const hostPlugins = getMutableHostPlugins();
  const activeDocument = state?.document as VisualDocument | undefined;
  return selectHostPlugins(hostPlugins, activeDocument);
}

export function getRenderableHostPlugins(): HvyPlugin[] {
  const hostPlugins = getHostPlugins();
  return hostPlugins.filter((plugin) => (
    typeof plugin.create === 'function'
    || (plugin.components?.length ?? 0) > 0
    || (plugin.authorization === 'required' && typeof plugin.load === 'function')
  ));
}

export function getHostPlugin(pluginName: string, document?: VisualDocument): HvyPlugin | null {
  const hostPlugins = getMutableHostPlugins();
  const candidates = hostPlugins
    .filter((entry) => entry.id === pluginName && entry.hvyApiVersion === HVY_PLUGIN_API_VERSION)
    .sort((left, right) => rcompare(left.version, right.version));
  const activeDocument = document ?? (state?.document as VisualDocument | undefined);
  const declaration = activeDocument
    ? getDocumentPluginDefinitions(activeDocument).find((entry) => entry.id === pluginName)
    : undefined;
  if (!declaration) {
    if (new Set(candidates.map((entry) => entry.uuid)).size > 1) return null;
    return candidates[0]
      ? (activeDocument ? getLoadedConditionalPlugin(candidates[0], activeDocument) : candidates[0])
      : null;
  }
  if (!declaration.uuid && new Set(candidates.map((entry) => entry.uuid)).size > 1) return null;
  const selected = candidates.find((entry) => (
    (!declaration.uuid || entry.uuid === declaration.uuid)
    && (!declaration.versionRange || satisfies(entry.version, declaration.versionRange))
  )) ?? null;
  return selected ? getLoadedConditionalPlugin(selected, activeDocument!) : null;
}

export function getAvailableOutputGenerators(): HvyOutputGenerator[] {
  const hostPlugins = getHostPlugins();
  return hostPlugins.flatMap((plugin) => plugin.outputGenerators ?? []);
}

export function getOutputGenerator(key: string): HvyOutputGenerator | null {
  return getAvailableOutputGenerators().find((generator) => generator.key === key) ?? null;
}

export function getAvailableDocumentPlugins(): DocumentPluginDefinition[] {
  const normalized = getDocumentPluginDefinitions(state.document);
  if (normalized.length === 0) {
    return getRenderableHostPlugins().map((entry) => ({
      id: entry.id,
      ...(!isReservedHvyPluginName(entry.id) && entry.uuid ? { uuid: entry.uuid } : {}),
      permissions: [],
    }));
  }
  return normalized;
}

export function getDocumentPluginDefinitions(document: VisualDocument): DocumentPluginDefinition[] {
  const plugins = normalizeHvyPluginDeclarations(document.meta.plugins);
  return plugins
    .map((candidate) => {
      if (!candidate || typeof candidate !== 'object') {
        return null;
      }
      const plugin = candidate as Record<string, unknown>;
      const id = typeof plugin.id === 'string' ? plugin.id.trim() : '';
      const uuid = typeof plugin.uuid === 'string' && plugin.uuid.trim() ? plugin.uuid : '';
      const versionRange = typeof plugin.versionRange === 'string' ? plugin.versionRange.trim() : '';
      const permissions = Array.isArray(plugin.permissions)
        ? plugin.permissions.filter((permission): permission is string => typeof permission === 'string')
        : [];
      if (id.length === 0) {
        return null;
      }
      if (uuid && [...uuid].length > 64) {
        return null;
      }
      return { id, ...(uuid ? { uuid } : {}), ...(versionRange ? { versionRange } : {}), permissions };
    })
    .filter((candidate): candidate is DocumentPluginDefinition => candidate !== null);
}

export function getPluginDisplayName(pluginName: string): string {
  const registration = getHostPlugin(pluginName);
  if (registration) {
    return registration.displayName;
  }
  if (isDbTablePluginId(pluginName)) {
    return 'DB Table';
  }
  if (pluginName === FORM_PLUGIN_ID) {
    return 'Form';
  }
  if (pluginName === GRAPH_PLUGIN_ID) {
    return 'Graph';
  }
  if (pluginName === DIAGRAM_PLUGIN_ID) {
    return 'Diagram';
  }
  if (pluginName === QR_CODE_PLUGIN_ID) {
    return 'QR Code';
  }
  if (pluginName === VIDEO_PLUGIN_ID) {
    return 'Video';
  }
  if (pluginName === EDITABLE_TEXT_PLUGIN_ID) {
    return 'Editable Text';
  }
  if (pluginName === CANVAS_PLUGIN_ID) {
    return 'Canvas';
  }
  if (pluginName === POWER_SCRIPTING_PLUGIN_ID) {
    return 'Power Scripting';
  }
  return pluginName;
}

function validateHostPlugin(plugin: HvyPlugin): void {
  if (!plugin.id.trim()) throw new Error('Plugin id cannot be blank.');
  if (typeof plugin.uuid !== 'undefined') {
    if (typeof plugin.uuid !== 'string' || !plugin.uuid.trim()) {
      throw new Error(`Plugin "${plugin.id}" uuid must be a non-empty string.`);
    }
    if ([...plugin.uuid].length > 64) throw new Error(`Plugin "${plugin.id}" uuid cannot exceed 64 characters.`);
  }
  if (!valid(plugin.version)) throw new Error(`Plugin "${plugin.id}" has invalid version "${plugin.version}".`);
  if (plugin.hvyApiVersion !== HVY_PLUGIN_API_VERSION) {
    throw new Error(`Plugin "${plugin.id}" requires unsupported HVY plugin API "${plugin.hvyApiVersion}".`);
  }
}

function selectHostPlugins(plugins: HvyPlugin[], document?: VisualDocument): HvyPlugin[] {
  const names = [...new Set(plugins.map((plugin) => plugin.id))];
  return names.flatMap((name) => {
    const declaration = document
      ? getDocumentPluginDefinitions(document).find((entry) => entry.id === name)
      : undefined;
    const candidates = plugins.filter((entry) => (
      entry.id === name
      && entry.hvyApiVersion === HVY_PLUGIN_API_VERSION
      && (!declaration || (
        (!declaration.uuid || entry.uuid === declaration.uuid)
        && (!declaration.versionRange || satisfies(entry.version, declaration.versionRange))
      ))
    ));
    if ((!declaration || !declaration.uuid) && new Set(candidates.map((entry) => entry.uuid)).size > 1) return [];
    const selected = candidates.sort((left, right) => rcompare(left.version, right.version))[0];
    return selected ? [document ? getLoadedConditionalPlugin(selected, document) : selected] : [];
  });
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
