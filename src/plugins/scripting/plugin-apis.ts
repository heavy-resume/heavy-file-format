import type { JsonObject } from '../../hvy/types';
import type { VisualDocument } from '../../types';
import { getHostPlugin } from '../registry';

export interface ScriptingPluginsApi {
  call(pluginId: string, method: string, args?: JsonObject): unknown | Promise<unknown>;
  call_json(pluginId: string, method: string, argsJson?: string): unknown;
  call_marshaled(
    pluginId: string,
    method: string,
    argsJson?: string,
    callbacksByPath?: Record<string, (...args: unknown[]) => unknown>
  ): unknown;
}

interface CreateScriptingPluginsApiOptions {
  allowAsync: boolean;
  requireDocumentPermission: boolean;
  onMutation?: () => void;
  wrapCallback?: (
    callback: (...args: unknown[]) => unknown
  ) => (...args: unknown[]) => unknown;
}

function decodeJsonPointerSegment(segment: string): string {
  return segment.replaceAll('~1', '/').replaceAll('~0', '~');
}

function setValueAtJsonPointer(
  root: JsonObject,
  pointer: string,
  value: (...args: unknown[]) => unknown
): void {
  if (!pointer.startsWith('/')) {
    throw new TypeError(`Plugin callback path "${pointer}" is invalid.`);
  }
  const segments = pointer.slice(1).split('/').map(decodeJsonPointerSegment);
  let target: unknown = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]!;
    if (!target || typeof target !== 'object') {
      throw new TypeError(`Plugin callback path "${pointer}" does not resolve inside args.`);
    }
    target = (target as Record<string, unknown>)[segment];
  }
  if (!target || typeof target !== 'object') {
    throw new TypeError(`Plugin callback path "${pointer}" does not resolve inside args.`);
  }
  const finalSegment = segments.at(-1)!;
  if (Array.isArray(target)) {
    if (!/^\d+$/.test(finalSegment) || Number(finalSegment) >= target.length) {
      throw new TypeError(`Plugin callback path "${pointer}" does not resolve inside args.`);
    }
    target[Number(finalSegment)] = value;
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(target, finalSegment)) {
    throw new TypeError(`Plugin callback path "${pointer}" does not resolve inside args.`);
  }
  (target as Record<string, unknown>)[finalSegment] = value;
}

function hasDocumentScriptingPermission(document: VisualDocument, pluginName: string): boolean {
  if (!Array.isArray(document.meta.plugins)) return false;
  return document.meta.plugins.some((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
    const declaration = candidate as Record<string, unknown>;
    return declaration.id === pluginName
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
    const pluginName = String(pluginIdValue ?? '').trim();
    const method = String(methodValue ?? '').trim();
    const plugin = getHostPlugin(pluginName, document);
    if (!plugin?.scripting) {
      throw new Error(`Plugin "${pluginName}" does not provide a scripting API.`);
    }
    if (options.requireDocumentPermission && !hasDocumentScriptingPermission(document, pluginName)) {
      throw new Error(`Plugin "${pluginName}" requires the "scripting" document permission.`);
    }
    const callable = Object.prototype.hasOwnProperty.call(plugin.scripting.methods, method)
      ? plugin.scripting.methods[method]
      : undefined;
    if (typeof callable !== 'function') {
      throw new Error(`Plugin "${pluginName}" does not provide scripting method "${method}".`);
    }
    const result = callable(normalizeArgs(args), {
      pluginId: pluginName,
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
        `Plugin scripting method "${pluginName}.${method}" is asynchronous; call it from an authorized power script.`
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
    call_marshaled: (pluginId, method, argsJson = '{}', callbacksByPath = {}) => {
      const parsed = normalizeArgs(JSON.parse(String(argsJson || '{}')) as unknown);
      for (const [path, callback] of Object.entries(callbacksByPath)) {
        if (typeof callback !== 'function') {
          throw new TypeError(`Plugin callback at path "${path}" must be callable.`);
        }
        setValueAtJsonPointer(parsed, path, options.wrapCallback?.(callback) ?? callback);
      }
      return call(pluginId, method, parsed);
    },
  };
}
