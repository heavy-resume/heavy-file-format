import type { JsonObject } from '../../hvy/types';
import type { VisualDocument } from '../../types';
import { getHostPlugin } from '../registry';

export interface ScriptingPluginsApi {
  call(pluginId: string, method: string, args?: JsonObject): unknown | Promise<unknown>;
  call_json(pluginId: string, method: string, argsJson?: string): unknown;
}

interface CreateScriptingPluginsApiOptions {
  allowAsync: boolean;
  requireDocumentPermission: boolean;
  onMutation?: () => void;
}

function hasDocumentScriptingPermission(document: VisualDocument, pluginId: string): boolean {
  if (!Array.isArray(document.meta.plugins)) return false;
  return document.meta.plugins.some((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
    const declaration = candidate as Record<string, unknown>;
    return declaration.id === pluginId
      && Array.isArray(declaration.permissions)
      && declaration.permissions.includes('scripting');
  });
}

function normalizeArgs(args: unknown): JsonObject {
  if (typeof args === 'undefined' || args === null) return {};
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new TypeError('Plugin scripting API args must be an object.');
  }
  return args as JsonObject;
}

export function createScriptingPluginsApi(
  document: VisualDocument,
  options: CreateScriptingPluginsApiOptions
): ScriptingPluginsApi {
  const call = (pluginIdValue: string, methodValue: string, args?: JsonObject): unknown | Promise<unknown> => {
    const pluginId = String(pluginIdValue ?? '').trim();
    const method = String(methodValue ?? '').trim();
    const plugin = getHostPlugin(pluginId);
    if (!plugin?.scripting) {
      throw new Error(`Plugin "${pluginId}" does not provide a scripting API.`);
    }
    if (options.requireDocumentPermission && !hasDocumentScriptingPermission(document, pluginId)) {
      throw new Error(`Plugin "${pluginId}" requires the "scripting" document permission.`);
    }
    const callable = Object.prototype.hasOwnProperty.call(plugin.scripting.methods, method)
      ? plugin.scripting.methods[method]
      : undefined;
    if (typeof callable !== 'function') {
      throw new Error(`Plugin "${pluginId}" does not provide scripting method "${method}".`);
    }
    const result = callable(normalizeArgs(args), {
      pluginId,
      rawDocument: document,
      markMutated: () => options.onMutation?.(),
    });
    if (
      !options.allowAsync
      && result !== null
      && (typeof result === 'object' || typeof result === 'function')
      && typeof (result as PromiseLike<unknown>).then === 'function'
    ) {
      // Avoid an unhandled rejection if an async-only method was accidentally
      // invoked from the synchronous sandbox.
      void Promise.resolve(result).catch(() => undefined);
      throw new Error(
        `Plugin scripting method "${pluginId}.${method}" is asynchronous; call it from an authorized power script.`
      );
    }
    return result;
  };

  return {
    call,
    call_json: (pluginId, method, argsJson = '{}') => {
      const parsed = JSON.parse(String(argsJson || '{}')) as unknown;
      return call(pluginId, method, normalizeArgs(parsed));
    },
  };
}
