import { installBrythonInteropPolicy, type BrythonInteropRuntime } from './brython-interop-policy';
import { applyBrythonSourcePatches } from './brython-source-patches';

// Lazy-loads the local Brython core bundle. Only triggered the first time a
// scripting plugin actually needs to run user code, so a document with no
// scripting blocks pays nothing. HVY scripts disallow user imports, so we load
// a generated tiny VFS bootstrap instead of Brython's multi-megabyte stdlib.

export interface BrythonGlobal {
  protocol?: string;
  script_path?: string;
  builtins: Record<string, unknown>;
  imported: Record<string, unknown>;
  VFS?: Record<string, unknown>;
  file_cache?: Record<string, unknown>;
  url2name?: Record<string, unknown>;
  import_info?: Record<string, unknown>;
  stdlib_module_names?: string[];
  update_VFS?: (entries: Record<string, unknown>) => void;
  python_to_js?: (src: string, scriptId?: string) => string;
  run_script?: (elt: HTMLElement, src: string, name: string, url: string, runLoop: boolean) => void;
  $options?: Record<string, unknown>;
  meta_path?: unknown[];
}

export type BrythonRealmWindow = Window & typeof globalThis & {
  __BRYTHON__?: BrythonGlobal;
  brython?: (options?: Record<string, unknown>) => void;
};

const HVY_BRYTHON_IFRAME_ATTR = 'data-hvy-brython-realm';

let loadPromise: Promise<void> | null = null;
let realmIframe: HTMLIFrameElement | null = null;

function ensureBrythonRealmWindow(): BrythonRealmWindow {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('Brython requires a browser environment.');
  }
  if (realmIframe?.isConnected && realmIframe.contentWindow) {
    return realmIframe.contentWindow as BrythonRealmWindow;
  }
  const existing = document.querySelector<HTMLIFrameElement>(`iframe[${HVY_BRYTHON_IFRAME_ATTR}="true"]`);
  if (existing?.isConnected && existing.contentWindow) {
    realmIframe = existing;
    return existing.contentWindow as BrythonRealmWindow;
  }
  const iframe = document.createElement('iframe');
  iframe.setAttribute(HVY_BRYTHON_IFRAME_ATTR, 'true');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.tabIndex = -1;
  iframe.style.display = 'none';
  const container = document.body ?? document.documentElement;
  if (!container) {
    throw new Error('Document root is unavailable for Brython runtime.');
  }
  container.appendChild(iframe);
  const realmWindow = iframe.contentWindow as BrythonRealmWindow | null;
  if (!realmWindow || !iframe.contentDocument) {
    iframe.remove();
    throw new Error('Failed to create isolated Brython iframe realm.');
  }
  realmIframe = iframe;
  return realmWindow;
}

async function loadBrythonCore(realmDocument: Document): Promise<void> {
  const [coreModule, minimalVfsModule] = await Promise.all([
    import('brython/brython.min.js?raw'),
    import('virtual:hvy-brython-minimal-vfs'),
  ]);
  await loadScriptSource(realmDocument, `${applyBrythonSourcePatches(coreModule.default)}\n${minimalVfsModule.default}`);
}

function loadScriptSource(realmDocument: Document, source: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const script = realmDocument.createElement('script');
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
    (realmDocument.head ?? realmDocument.documentElement).appendChild(script);
  });
}

export function loadBrython(): Promise<void> {
  if (loadPromise) {
    return loadPromise;
  }
  loadPromise = (async () => {
    const realmWindow = ensureBrythonRealmWindow();
    if (!realmWindow.__BRYTHON__) {
      await loadBrythonCore(realmWindow.document);
    }
    if (typeof realmWindow.brython !== 'function') {
      throw new Error('Brython did not register its global initializer.');
    }
    if (typeof realmWindow.__BRYTHON__?.run_script !== 'function') {
      // debug: 0 = no source maps, faster init.
      realmWindow.brython({ debug: 0 });
    }
    const interopRuntime = realmWindow.__BRYTHON__ as unknown as BrythonInteropRuntime;
    if (!interopRuntime.hvyBlockedAttributeNames) {
      installBrythonInteropPolicy(interopRuntime);
    }
  })().catch((error) => {
    loadPromise = null;
    throw error;
  });
  return loadPromise;
}

export function getBrythonWindow(): BrythonRealmWindow {
  if (typeof window === 'undefined' || !realmIframe?.isConnected || !realmIframe.contentWindow) {
    throw new Error('Brython is not loaded yet. Call loadBrython() first.');
  }
  return realmIframe.contentWindow as BrythonRealmWindow;
}

export function getBrython(): BrythonGlobal {
  const realmWindow = getBrythonWindow();
  if (!realmWindow.__BRYTHON__) {
    throw new Error('Brython is not loaded yet. Call loadBrython() first.');
  }
  return realmWindow.__BRYTHON__;
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
