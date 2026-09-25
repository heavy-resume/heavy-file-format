import { wrapPythonSourceInFunction } from './python-source';

interface PythonCompiler {
  python_to_js: (source: string, moduleName: string) => string;
  script_path: string;
  imported: Record<string, unknown>;
  url2name: Record<string, unknown>;
  file_cache: Record<string, unknown>;
}

export interface PythonSyntaxIssue {
  name: string;
  message: string;
  line: number;
  column: number;
}

let compilerPromise: Promise<PythonCompiler> | undefined;
const results = new Map<string, PythonSyntaxIssue | null>();
const MAX_CACHED_SOURCES = 128;
const SYNTAX_MODULE = '__hvy_syntax_check__';

async function loadSyntaxCompiler(): Promise<PythonCompiler> {
  if (typeof window !== 'undefined') {
    const { loadBrython, getBrython } = await import('./brython-loader');
    await loadBrython();
    return getBrython() as PythonCompiler;
  }

  // The CLI uses the same bundled compiler in its own realm. It must not add
  // Brython globals or DOM shims to the host process. No user code is executed.
  // Keep the Node-only module out of the browser bundle's dependency graph.
  const vmModule = 'node:vm';
  const [{ runInNewContext }, { default: core }] = await Promise.all([
    import(/* @vite-ignore */ vmModule) as Promise<typeof import('node:vm')>,
    import('brython/brython.min.js?raw'),
  ]);
  const host: Record<string, unknown> = {
    URL, Event, performance,
    process: { release: { name: 'node' } },
    module: { exports: {} },
    addEventListener: () => {},
  };
  host.self = host;
  host.global = host;
  runInNewContext(core, host, { filename: 'hvy-syntax-brython.js' });
  return host.__BRYTHON__ as PythonCompiler;
}

export async function checkPythonSyntax(source: string): Promise<PythonSyntaxIssue | null> {
  if (!source.trim()) return null;
  if (results.has(source)) return results.get(source)!;
  const compiler = await (compilerPromise ??= loadSyntaxCompiler());
  const filename = `${compiler.script_path}#${SYNTAX_MODULE}`;
  const wrappedSource = wrapPythonSourceInFunction(source);
  let issue: PythonSyntaxIssue | null = null;
  try {
    // Translation performs parsing and compiler checks; never evaluate the JS.
    // Brython's compiler-stage errors also read source text from file_cache.
    compiler.file_cache[filename] = wrappedSource;
    compiler.python_to_js(wrappedSource, SYNTAX_MODULE);
  } catch (error) {
    const pythonError = error as {
      __class__?: { __name__?: string };
      args?: unknown[];
      lineno?: number;
      offset?: number;
    };
    const name = pythonError?.__class__?.__name__;
    if (name !== 'SyntaxError' && name !== 'IndentationError' && name !== 'TabError') {
      throw error;
    }
    issue = {
      name,
      message: String(pythonError.args?.[0] ?? name).replace(
        /\b(on line |detected at line )(\d+)/g,
        (_match, prefix: string, line: string) => `${prefix}${Math.max(1, Number(line) - 1)}`,
      ),
      line: Math.max(1, (pythonError.lineno ?? 2) - 1),
      column: Math.max(1, (pythonError.offset ?? 5) - 4),
    };
  } finally {
    delete compiler.imported[SYNTAX_MODULE];
    delete compiler.url2name[filename];
    delete compiler.file_cache[filename];
  }
  // Document diagnostics run after edits too; unchanged scripts need no repeat
  // compilation. Bound the cache so old script bodies do not accumulate.
  if (results.size >= MAX_CACHED_SOURCES) results.delete(results.keys().next().value!);
  results.set(source, issue);
  return issue;
}
