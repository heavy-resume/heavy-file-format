// Lazy-loads Brython 3.14.0 from a CDN. Only triggered the first time a
// scripting plugin actually needs to run user code, so a document with no
// scripting blocks pays nothing.

const BRYTHON_VERSION = '3.14.0';
const BRYTHON_CORE_URL = `https://cdn.jsdelivr.net/npm/brython@${BRYTHON_VERSION}/brython.min.js`;
const BRYTHON_STDLIB_URL = `https://cdn.jsdelivr.net/npm/brython@${BRYTHON_VERSION}/brython_stdlib.min.js`;

interface BrythonGlobal {
  builtins: Record<string, unknown>;
  imported: Record<string, unknown>;
  python_to_js?: (src: string) => string;
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

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
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
      await loadScript(BRYTHON_CORE_URL);
      await loadScript(BRYTHON_STDLIB_URL);
    }
    if (typeof window.brython !== 'function') {
      throw new Error('Brython did not register its global initializer.');
    }
    // debug: 0 = no source maps, faster init.
    window.brython({ debug: 0 });
  })();
  return loadPromise;
}

export function getBrython(): BrythonGlobal {
  if (typeof window === 'undefined' || !window.__BRYTHON__) {
    throw new Error('Brython is not loaded yet. Call loadBrython() first.');
  }
  return window.__BRYTHON__;
}
