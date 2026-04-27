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
    window.__HVY_SCRIPTING__ = { runtimes: {}, sources: {}, errors: {} };
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
    __hvy_globals__.errors['${runtimeId}'] = None
except Exception as __hvy_err__:
    import traceback as __hvy_tb__
    __hvy_globals__.errors['${runtimeId}'] = __hvy_tb__.format_exc()
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

  const scriptElement = document.createElement('script');
  scriptElement.type = 'text/python';
  scriptElement.id = `hvy-script-${runtimeId}`;
  scriptElement.textContent = buildPythonProgram(runtimeId);
  document.head.appendChild(scriptElement);

  try {
    const brython = getBrython() as unknown as { run_script?: (elt: HTMLElement, name: string) => void };
    if (typeof brython.run_script !== 'function') {
      throw new Error('Brython run_script API unavailable.');
    }
    brython.run_script(scriptElement, `hvy_script_${runtimeId}`);
    const error = scripting.errors[runtimeId];
    if (error) {
      return {
        ok: false,
        error,
        linesExecuted: runtime.stats.linesExecuted,
        toolCalls: runtime.stats.toolCalls,
      };
    }
    return {
      ok: true,
      linesExecuted: runtime.stats.linesExecuted,
      toolCalls: runtime.stats.toolCalls,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: message,
      linesExecuted: runtime.stats.linesExecuted,
      toolCalls: runtime.stats.toolCalls,
    };
  } finally {
    scriptElement.remove();
    delete scripting.runtimes[runtimeId];
    delete scripting.sources[runtimeId];
    delete scripting.errors[runtimeId];
  }
}
