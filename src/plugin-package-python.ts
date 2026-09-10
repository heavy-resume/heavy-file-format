import {
  validatePluginAgainstManifest,
  type HvyPluginPackageManifest,
} from './plugin-package';
import { getBrython, loadBrythonPythonImports } from './plugins/scripting/brython-loader';
import { normalizeBrythonHostValue } from './plugins/scripting/brython-host-values';
import type { HvyPlugin } from './plugins/types';

export interface LoadHvyPluginPythonOptions {
  manifest: HvyPluginPackageManifest;
  files: Readonly<Record<string, Uint8Array>>;
  resourceUrl(path: string): string;
}

export interface LoadedHvyPluginPython {
  plugin: HvyPlugin;
  dispose(): void;
}

interface PythonPluginBridge {
  contexts: Record<string, {
    manifest: HvyPluginPackageManifest;
    resourceUrl(path: string): string;
  }>;
  results: Record<string, unknown>;
  errors: Record<string, string | null>;
  callbacks: Record<string, () => void>;
}

declare global {
  interface Window {
    __HVY_PLUGIN_PYTHON__?: PythonPluginBridge;
  }
}

let pythonPluginSequence = 0;

function getPythonPluginBridge(): PythonPluginBridge {
  window.__HVY_PLUGIN_PYTHON__ ??= {
    contexts: {},
    results: {},
    errors: {},
    callbacks: {},
  };
  return window.__HVY_PLUGIN_PYTHON__;
}

function pythonIdentifier(value: string, path: string): string {
  if (!/^[A-Za-z_]\w*$/.test(value)) {
    throw new Error(`Python plugin module path "${path}" contains invalid module name "${value}".`);
  }
  return value;
}

function moduleNameForPath(namespace: string, path: string): { name: string; package: boolean } {
  const segments = path.split('/');
  const filename = segments.pop()!;
  const stem = filename.slice(0, -3);
  const moduleSegments = segments.map((segment) => pythonIdentifier(segment, path));
  if (stem === '__init__') {
    return {
      name: [namespace, ...moduleSegments].join('.'),
      package: true,
    };
  }
  return {
    name: [namespace, ...moduleSegments, pythonIdentifier(stem, path)].join('.'),
    package: false,
  };
}

function createPackageVfs(
  namespace: string,
  files: Readonly<Record<string, Uint8Array>>
): { entries: Record<string, unknown>; pythonModuleNames: Set<string> } {
  const entries: Record<string, unknown> = {
    [namespace]: ['.py', '', [], 1],
  };
  const pythonModuleNames = new Set<string>([namespace]);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (const [path, bytes] of Object.entries(files)) {
    if (!path.toLowerCase().endsWith('.py')) continue;
    let source: string;
    try {
      source = decoder.decode(bytes);
    } catch (error) {
      throw new Error(`Python plugin source "${path}" must be valid UTF-8.`, { cause: error });
    }
    const module = moduleNameForPath(namespace, path);
    const nameSegments = module.name.split('.');
    for (let length = 1; length < nameSegments.length; length += 1) {
      const packageName = nameSegments.slice(0, length).join('.');
      entries[packageName] ??= ['.py', '', [], 1];
      pythonModuleNames.add(packageName);
    }
    entries[module.name] = module.package
      ? ['.py', source, [], 1]
      : ['.py', source, []];
    pythonModuleNames.add(module.name);
  }
  return { entries, pythonModuleNames };
}

function formatPythonPluginError(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error;
  const brython = getBrython() as ReturnType<typeof getBrython> & {
    error_trace?: (value: unknown) => string;
  };
  try {
    if (typeof brython.error_trace === 'function' && error && typeof error === 'object' && '__class__' in error) {
      return brython.error_trace(error);
    }
  } catch (_) {
    // Use the ordinary error string below.
  }
  return error instanceof Error ? error.message : String(error);
}

function deletePythonPluginModules(moduleNames: Set<string>, runnerName: string): void {
  const brython = getBrython() as ReturnType<typeof getBrython> & {
    precompiled?: Record<string, unknown>;
    scripts?: Record<string, unknown>;
  };
  for (const moduleName of moduleNames) {
    delete brython.VFS?.[moduleName];
    delete brython.imported[moduleName];
    delete brython.precompiled?.[moduleName];
    delete brython.file_cache?.[moduleName];
    delete brython.url2name?.[moduleName];
    delete brython.import_info?.[moduleName];
  }
  delete brython.imported[runnerName];
  for (const [filename, moduleName] of Object.entries(brython.url2name ?? {})) {
    if (moduleName !== runnerName) continue;
    delete brython.url2name?.[filename];
    delete brython.file_cache?.[filename];
    delete brython.import_info?.[filename];
    delete brython.scripts?.[filename];
  }
  if (brython.VFS) brython.stdlib_module_names = Object.keys(brython.VFS);
}

export async function loadHvyPluginPython(
  options: LoadHvyPluginPythonOptions
): Promise<LoadedHvyPluginPython> {
  await loadBrythonPythonImports(options.manifest.pythonImports ?? []);
  const brython = getBrython();
  if (typeof brython.update_VFS !== 'function' || typeof brython.run_script !== 'function') {
    throw new Error('Brython plugin loading APIs are unavailable.');
  }

  const sequence = ++pythonPluginSequence;
  const namespace = `__hvy_plugin_${sequence}`;
  const runnerName = `hvy_plugin_loader_${sequence}`;
  const bridgeId = `p${sequence}`;
  const { entries, pythonModuleNames } = createPackageVfs(namespace, options.files);
  const entryModule = moduleNameForPath(namespace, options.manifest.entry).name;
  if (!pythonModuleNames.has(entryModule)) {
    throw new Error(`Python plugin entry "${options.manifest.entry}" is unavailable.`);
  }
  brython.update_VFS(entries);

  const bridge = getPythonPluginBridge();
  bridge.contexts[bridgeId] = {
    manifest: options.manifest,
    resourceUrl: options.resourceUrl,
  };
  bridge.errors[bridgeId] = null;
  bridge.results[bridgeId] = undefined;

  const source = `
from browser import window as __hvy_window__

__hvy_bridge__ = __hvy_window__.__HVY_PLUGIN_PYTHON__
try:
    __hvy_module__ = __import__(${JSON.stringify(entryModule)}, fromlist=["plugin"])
    if not hasattr(__hvy_module__, "plugin"):
        raise RuntimeError("Python plugin entry must export a top-level plugin value.")
    __hvy_plugin__ = getattr(__hvy_module__, "plugin")
    if callable(__hvy_plugin__):
        __hvy_js_context__ = __hvy_bridge__.contexts[${JSON.stringify(bridgeId)}]
        __hvy_plugin__ = __hvy_plugin__({
            "manifest": __hvy_js_context__.manifest,
            "resource_url": __hvy_js_context__.resourceUrl,
        })
    __hvy_bridge__.results[${JSON.stringify(bridgeId)}] = __hvy_window__.__BRYTHON__.pyobj2jsobj(__hvy_plugin__)
except BaseException as __hvy_error__:
    __hvy_bridge__.errors[${JSON.stringify(bridgeId)}] = __hvy_window__.__BRYTHON__.error_trace(__hvy_error__)
finally:
    __hvy_bridge__.callbacks[${JSON.stringify(bridgeId)}]()
`;
  const scriptElement = document.createElement('script');
  scriptElement.id = runnerName;
  scriptElement.textContent = source;

  try {
    const exportedPlugin = await new Promise<unknown>((resolve, reject) => {
      bridge.callbacks[bridgeId] = () => {
        const error = bridge.errors[bridgeId];
        if (error) {
          reject(new Error(error));
          return;
        }
        Promise.resolve(bridge.results[bridgeId]).then(
          resolve,
          (reason) => reject(new Error(formatPythonPluginError(reason)))
        );
      };
      try {
        const previousProtocol = brython.protocol;
        try {
          // Package imports are VFS-only. Brython omits its URL finders for
          // file-protocol executions, while the already-mounted VFS remains
          // available for package-relative and requested local modules.
          brython.protocol = 'file';
          brython.run_script!(
            scriptElement,
            source,
            runnerName,
            `${window.location.href || 'http://localhost/hvy-plugin'}#${runnerName}`,
            true
          );
        } finally {
          brython.protocol = previousProtocol;
        }
      } catch (error) {
        reject(new Error(formatPythonPluginError(error)));
      }
    });
    const plugin = normalizeBrythonHostValue(exportedPlugin) as HvyPlugin;
    validatePluginAgainstManifest(plugin, options.manifest);
    let disposed = false;
    return {
      plugin,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        deletePythonPluginModules(pythonModuleNames, runnerName);
      },
    };
  } catch (error) {
    deletePythonPluginModules(pythonModuleNames, runnerName);
    throw error;
  } finally {
    delete bridge.contexts[bridgeId];
    delete bridge.results[bridgeId];
    delete bridge.errors[bridgeId];
    delete bridge.callbacks[bridgeId];
  }
}
