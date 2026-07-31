import { getActiveStateRuntime, type StateRuntime } from '../../state';
import type { VisualDocument } from '../../types';
import type { HvyPlugin } from '../types';

export type HvyPluginAuthorizationMode = 'prompt' | 'enabled' | 'hidden';

export interface HvyPluginAuthorizationRequest {
  document: VisualDocument;
  id: string;
  uuid?: string;
  version: string;
}

export type HvyGetPluginAuthorization = (request: HvyPluginAuthorizationRequest) => boolean;
export type HvyPluginAuthorizationChanged = (
  request: HvyPluginAuthorizationRequest & { accepted: boolean }
) => void;

interface AuthorizationCallbacks {
  getAcceptance: HvyGetPluginAuthorization | null;
  onAcceptanceChanged: HvyPluginAuthorizationChanged | null;
}

const modes = new WeakMap<StateRuntime, HvyPluginAuthorizationMode>();
const callbacks = new WeakMap<StateRuntime, AuthorizationCallbacks>();
const sessionAcceptance = new WeakMap<StateRuntime, WeakMap<VisualDocument, Set<string>>>();

function pluginKey(plugin: Pick<HvyPlugin, 'id' | 'uuid' | 'version'>): string {
  return JSON.stringify([plugin.id, plugin.uuid ?? null, plugin.version]);
}

function requestFor(
  document: VisualDocument,
  plugin: Pick<HvyPlugin, 'id' | 'uuid' | 'version'>
): HvyPluginAuthorizationRequest {
  return { document, id: plugin.id, ...(plugin.uuid ? { uuid: plugin.uuid } : {}), version: plugin.version };
}

function getSessionSet(runtime: StateRuntime, document: VisualDocument): Set<string> {
  let documents = sessionAcceptance.get(runtime);
  if (!documents) {
    documents = new WeakMap();
    sessionAcceptance.set(runtime, documents);
  }
  let accepted = documents.get(document);
  if (!accepted) {
    accepted = new Set();
    documents.set(document, accepted);
  }
  return accepted;
}

export function setPluginAuthorizationMode(
  mode: HvyPluginAuthorizationMode,
  runtime: StateRuntime = getActiveStateRuntime()
): void {
  modes.set(runtime, mode);
}

export function setPluginAuthorizationCallbacks(
  next: AuthorizationCallbacks,
  runtime: StateRuntime = getActiveStateRuntime()
): void {
  if (next.getAcceptance || next.onAcceptanceChanged) callbacks.set(runtime, next);
  else callbacks.delete(runtime);
}

export function getPluginAuthorizationMode(
  document: VisualDocument,
  plugin: Pick<HvyPlugin, 'id' | 'uuid' | 'version'>,
  runtime: StateRuntime = getActiveStateRuntime()
): HvyPluginAuthorizationMode {
  const configured = modes.get(runtime) ?? 'prompt';
  if (configured !== 'prompt') return configured;
  if (getSessionSet(runtime, document).has(pluginKey(plugin))) return 'enabled';
  return callbacks.get(runtime)?.getAcceptance?.(requestFor(document, plugin)) ? 'enabled' : 'prompt';
}

export function setPluginAuthorized(
  document: VisualDocument,
  plugin: Pick<HvyPlugin, 'id' | 'uuid' | 'version'>,
  accepted: boolean,
  runtime: StateRuntime = getActiveStateRuntime()
): void {
  const acceptedPlugins = getSessionSet(runtime, document);
  const key = pluginKey(plugin);
  if (accepted) acceptedPlugins.add(key);
  else acceptedPlugins.delete(key);
  callbacks.get(runtime)?.onAcceptanceChanged?.({ ...requestFor(document, plugin), accepted });
}

export function clearPluginAuthorization(runtime: StateRuntime): void {
  modes.delete(runtime);
  callbacks.delete(runtime);
  sessionAcceptance.delete(runtime);
}
