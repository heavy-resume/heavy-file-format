// Lazy-loads the local Brython core bundle. Only triggered the first time a
// scripting plugin actually needs to run user code, so a document with no
// scripting blocks pays nothing. HVY scripts disallow user imports, so we load
// a generated tiny VFS bootstrap instead of Brython's multi-megabyte stdlib.

export interface BrythonGlobal {
  protocol?: string;
  builtins: Record<string, unknown>;
  imported: Record<string, unknown>;
  VFS?: Record<string, unknown>;
  file_cache?: Record<string, unknown>;
  url2name?: Record<string, unknown>;
  import_info?: Record<string, unknown>;
  stdlib_module_names?: string[];
  update_VFS?: (entries: Record<string, unknown>) => void;
  python_to_js?: (src: string) => string;
  run_script?: (elt: HTMLElement, src: string, name: string, url: string, runLoop: boolean) => void;
  $options?: Record<string, unknown>;
  meta_path?: unknown[];
}

declare global {
  interface Window {
    __BRYTHON__?: BrythonGlobal;
    brython?: (options?: Record<string, unknown>) => void;
  }
}

let loadPromise: Promise<void> | null = null;

async function loadBrythonCore(): Promise<void> {
  const [coreModule, minimalVfsModule] = await Promise.all([
    import('brython/brython.min.js?raw'),
    import('virtual:hvy-brython-minimal-vfs'),
  ]);
  await loadScriptSource(`${coreModule.default}\n${minimalVfsModule.default}`);
}

function loadScriptSource(source: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    script.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load local Brython bundle.'));
    };
    document.head.appendChild(script);
  });
}

export function loadBrython(): Promise<void> {
  if (loadPromise) {
    return loadPromise;
  }
  loadPromise = (async () => {
    if (typeof window === 'undefined') {
      throw new Error('Brython requires a browser environment.');
    }
    if (!window.__BRYTHON__) {
      await loadBrythonCore();
    }
    if (typeof window.brython !== 'function') {
      throw new Error('Brython did not register its global initializer.');
    }
    if (typeof window.__BRYTHON__?.run_script !== 'function') {
      // debug: 0 = no source maps, faster init.
      window.brython({ debug: 0 });
    }
  })();
  return loadPromise;
}

export function getBrython(): BrythonGlobal {
  if (typeof window === 'undefined' || !window.__BRYTHON__) {
    throw new Error('Brython is not loaded yet. Call loadBrython() first.');
  }
  return window.__BRYTHON__;
}

export async function loadBrythonPythonImports(names: readonly string[]): Promise<void> {
  await loadBrython();
  if (names.length === 0) return;
  const { default: pythonLibraryVfsByName } = await import('virtual:hvy-brython-plugin-vfs');
  const brython = getBrython();
  if (typeof brython.update_VFS !== 'function') {
    throw new Error('Brython VFS registration API unavailable.');
  }
  const additions: Record<string, unknown> = {};
  for (const name of names) {
    const library = pythonLibraryVfsByName[name];
    if (!library) throw new Error(`Bundled Python import "${name}" is unavailable.`);
    for (const [moduleName, entry] of Object.entries(library)) {
      if (!Object.hasOwn(brython.VFS ?? {}, moduleName)) additions[moduleName] = entry;
    }
  }
  if (Object.keys(additions).length > 0) brython.update_VFS(additions);
}
