import { loadBrython, getBrython } from './brython-loader';
import { createScriptingRuntime, type ScriptingRuntime } from './runtime';
import type { VisualDocument } from '../../types';

// Counter for unique runtime ids — each script run gets its own slot on the
// shared __HVY_SCRIPTING__ global so concurrent runs don't collide.
let runtimeCounter = 0;

interface HvyScriptingGlobal {
  runtimes: Record<string, ScriptingRuntime>;
  sources: Record<string, string>;
  errors: Record<string, string | null>;
  callbacks: Record<string, () => void>;
}

declare global {
  interface Window {
    __HVY_SCRIPTING__?: HvyScriptingGlobal;
  }
}

function getScriptingGlobal(): HvyScriptingGlobal {
  if (typeof window === 'undefined') {
    throw new Error('Scripting runtime requires a browser environment.');
  }
  if (!window.__HVY_SCRIPTING__) {
    window.__HVY_SCRIPTING__ = { runtimes: {}, sources: {}, errors: {}, callbacks: {} };
  }
  if (!window.__HVY_SCRIPTING__.callbacks) {
    window.__HVY_SCRIPTING__.callbacks = {};
  }
  return window.__HVY_SCRIPTING__;
}

// The Python program executed for each user script. It pulls the runtime and
// source out of the shared JS global, walks the AST inserting __hvy_step__
// before every statement (recursively into nested blocks), then exec's the
// instrumented module against globals where `doc` is already bound. Each
// step bumps the runtime's counter and raises if it overflows the budget.
function buildPythonProgram(runtimeId: string): string {
  return `
import ast as __hvy_ast__
from browser import window as __hvy_window__

__hvy_globals__ = __hvy_window__.__HVY_SCRIPTING__
__hvy_runtime__ = __hvy_globals__.runtimes['${runtimeId}']
__hvy_source__ = __hvy_globals__.sources['${runtimeId}']


def __hvy_instrument__(src):
    tree = __hvy_ast__.parse(src)

    def _wrap(stmt):
        stepped = __hvy_ast__.parse('__hvy_step__()').body[0]
        __hvy_ast__.copy_location(stepped, stmt)
        return [stepped, stmt]

    class _Tracer(__hvy_ast__.NodeTransformer):
        def _wrap_body(self, body):
            return [s for stmt in body for s in _wrap(stmt)]

        def visit_FunctionDef(self, node):
            self.generic_visit(node)
            node.body = self._wrap_body(node.body)
            return node

        def visit_AsyncFunctionDef(self, node):
            self.generic_visit(node)
            node.body = self._wrap_body(node.body)
            return node

        def visit_For(self, node):
            self.generic_visit(node)
            node.body = self._wrap_body(node.body)
            node.orelse = self._wrap_body(node.orelse)
            return node

        def visit_AsyncFor(self, node):
            return self.visit_For(node)

        def visit_While(self, node):
            self.generic_visit(node)
            node.body = self._wrap_body(node.body)
            node.orelse = self._wrap_body(node.orelse)
            return node

        def visit_If(self, node):
            self.generic_visit(node)
            node.body = self._wrap_body(node.body)
            node.orelse = self._wrap_body(node.orelse)
            return node

        def visit_Try(self, node):
            self.generic_visit(node)
            node.body = self._wrap_body(node.body)
            node.orelse = self._wrap_body(node.orelse)
            node.finalbody = self._wrap_body(node.finalbody)
            for handler in node.handlers:
                handler.body = self._wrap_body(handler.body)
            return node

        def visit_With(self, node):
            self.generic_visit(node)
            node.body = self._wrap_body(node.body)
            return node

        def visit_AsyncWith(self, node):
            return self.visit_With(node)

        def visit_Compare(self, node):
            # Avoids a Brython 3.14.0 bug where generic_visit causes singletons 
            # like ast.Eq in Compare.ops to be dropped, causing a ValueError later.
            return node

    _Tracer().visit(tree)
    tree.body = [s for stmt in tree.body for s in _wrap(stmt)]
    __hvy_ast__.fix_missing_locations(tree)
    return tree


try:
    __hvy_module__ = __hvy_instrument__(__hvy_source__)
    __hvy_code__ = compile(__hvy_module__, '<hvy-script>', 'exec')
    __hvy_user_globals__ = {
        '__hvy_step__': __hvy_runtime__.step,
        'doc': __hvy_runtime__.doc,
        '__name__': '__hvy_script__',
    }
    exec(__hvy_code__, __hvy_user_globals__)
    __hvy_runtime__.doc.rerender()
except Exception as __hvy_err__:
    import traceback as __hvy_tb__
    __hvy_globals__.errors['${runtimeId}'] = __hvy_tb__.format_exc()
finally:
    __hvy_globals__.callbacks['${runtimeId}']()
`;
}

export interface ScriptingRunResult {
  ok: boolean;
  error?: string;
  linesExecuted: number;
  toolCalls: number;
}

export interface RunUserScriptOptions {
  document: VisualDocument;
  source: string;
  maxLines?: number;
}

export async function runUserScript(options: RunUserScriptOptions): Promise<ScriptingRunResult> {
  if (options.source.trim().length === 0) {
    return { ok: true, linesExecuted: 0, toolCalls: 0 };
  }

  try {
    await loadBrython();
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to load Brython.',
      linesExecuted: 0,
      toolCalls: 0,
    };
  }

  const runtime = createScriptingRuntime({ document: options.document, maxLines: options.maxLines });
  const runtimeId = `r${++runtimeCounter}`;
  const scripting = getScriptingGlobal();
  scripting.runtimes[runtimeId] = runtime;
  scripting.sources[runtimeId] = options.source;
  scripting.errors[runtimeId] = null;

  // Do not append this to the DOM or use type="text/python", otherwise 
  // Brython 3.14+ will detect the DOM mutation and run the script automatically 
  // in addition to the manual run_script call below, causing a double-execution.
  const scriptElement = document.createElement('script');
  scriptElement.id = `hvy-script-${runtimeId}`;
  scriptElement.textContent = buildPythonProgram(runtimeId);

  return new Promise((resolve) => {
    scripting.callbacks[runtimeId] = () => {
      const error = scripting.errors[runtimeId];
      const result: ScriptingRunResult = error
        ? {
            ok: false,
            error,
            linesExecuted: runtime.stats.linesExecuted,
            toolCalls: runtime.stats.toolCalls,
          }
        : {
            ok: true,
            linesExecuted: runtime.stats.linesExecuted,
            toolCalls: runtime.stats.toolCalls,
          };

      delete scripting.runtimes[runtimeId];
      delete scripting.sources[runtimeId];
      delete scripting.errors[runtimeId];
      delete scripting.callbacks[runtimeId];

      resolve(result);
    };

    try {
      const brython = getBrython() as unknown as {
        run_script?: (elt: HTMLElement, src: string, name: string, url: string, runLoop: boolean) => void;
      };
      if (typeof brython.run_script !== 'function') {
        throw new Error('Brython run_script API unavailable.');
      }

      brython.run_script(
        scriptElement,
        scriptElement.textContent || '',
        `hvy_script_${runtimeId}`,
        window.location.href || 'http://localhost/hvy-plugin',
        true
      );
    } catch (error) {
      let message = String(error);
      try {
        const brython = getBrython() as unknown as { error_trace?: (e: unknown) => string };
        if (typeof brython.error_trace === 'function' && error && typeof error === 'object' && '__class__' in error) {
          message = brython.error_trace(error);
        } else if (error instanceof Error) {
          message = error.message;
        }
      } catch (_) {
        // fallback to original error string
      }
      scripting.errors[runtimeId] = message;
      scripting.callbacks[runtimeId]();
    }
  });
}
