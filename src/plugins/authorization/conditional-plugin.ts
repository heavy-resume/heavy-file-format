import type { HvyPlugin } from '../types';
import type { VisualDocument } from '../../types';
import { getPluginAuthorizationMode } from './plugin-authorization-policy';

export interface HvyConditionalPluginOptions {
  id: string;
  uuid?: string;
  version: string;
  hvyApiVersion: string;
  displayName: string;
  load(): Promise<HvyPlugin>;
}

const loadedImplementations = new WeakMap<HvyPlugin, Promise<HvyPlugin>>();

export function createConditionallyAllowedPlugin(options: HvyConditionalPluginOptions): HvyPlugin {
  return {
    id: options.id,
    ...(options.uuid ? { uuid: options.uuid } : {}),
    version: options.version,
    hvyApiVersion: options.hvyApiVersion,
    displayName: options.displayName,
    authorization: 'required',
    load: options.load,
  };
}

export async function loadConditionallyAllowedPlugin(registration: HvyPlugin): Promise<HvyPlugin> {
  if (!registration.load) throw new Error(`Plugin "${registration.id}" does not provide a loader.`);
  let pending = loadedImplementations.get(registration);
  if (!pending) {
    pending = registration.load().then((plugin) => {
      for (const field of ['id', 'uuid', 'version', 'hvyApiVersion', 'displayName'] as const) {
        if (plugin[field] !== registration[field]) {
          throw new Error(`Loaded plugin ${field} does not match its registered metadata.`);
        }
      }
      settledImplementations.set(registration, plugin);
      return plugin;
    });
    loadedImplementations.set(registration, pending);
  }
  return pending;
}

export function getLoadedConditionalPlugin(
  registration: HvyPlugin,
  document: VisualDocument
): HvyPlugin {
  if (registration.authorization !== 'required') return registration;
  if (getPluginAuthorizationMode(document, registration) !== 'enabled') return registration;
  const pending = loadedImplementations.get(registration);
  if (!pending) return registration;
  // Promise state is intentionally not inspected synchronously. The mount that
  // authorized the plugin refreshes after load; later lookups receive the
  // implementation through this settled-value cache.
  return settledImplementations.get(registration) ?? registration;
}

const settledImplementations = new WeakMap<HvyPlugin, HvyPlugin>();
