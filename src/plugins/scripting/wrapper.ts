import { loadBrython, getBrython } from './brython-loader';
import { createScriptingRuntime, type ScriptingRuntime } from './runtime';
import type { VisualDocument } from '../../types';

// Counter for unique runtime ids — each script run gets its own slot on the
// shared __HVY_SCRIPTING__ global so concurrent runs don't collide.
let runtimeCounter = 0;

interface HvyScriptingGlobal {
  runtimes: Record<string, ScriptingRuntime>;
  sources: Record<string, string>;
  instrumentedSources: Record<string, string>;
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
    window.__HVY_SCRIPTING__ = { runtimes: {}, sources: {}, instrumentedSources: {}, errors: {}, callbacks: {} };
  }
  if (!window.__HVY_SCRIPTING__.callbacks) {
    window.__HVY_SCRIPTING__.callbacks = {};
  }
  if (!window.__HVY_SCRIPTING__.instrumentedSources) {
    window.__HVY_SCRIPTING__.instrumentedSources = {};
  }
  return window.__HVY_SCRIPTING__;
}

function isEscaped(line: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && line[cursor] === '\\'; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function analyzePythonLine(
  line: string,
  startingBracketDepth: number,
  activeTripleQuote: `'''` | `"""` | null
): {
  bracketDepth: number;
  lineContinuation: boolean;
  tripleQuote: `'''` | `"""` | null;
  isBlankOrComment: boolean;
} {
  let bracketDepth = startingBracketDepth;
  let tripleQuote = activeTripleQuote;
  let inSingleQuotedString: "'" | '"' | null = null;
  let sawCode = false;
  let lineContinuation = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (tripleQuote) {
      if (line.slice(index, index + 3) === tripleQuote && !isEscaped(line, index)) {
        tripleQuote = null;
        index += 2;
      }
      continue;
    }

    if (inSingleQuotedString) {
      if (char === inSingleQuotedString && !isEscaped(line, index)) {
        inSingleQuotedString = null;
      }
      continue;
    }

    if (char === '#') {
      break;
    }

    if (/\s/.test(char)) {
      continue;
    }

    sawCode = true;

    const tripleCandidate = line.slice(index, index + 3);
    if ((tripleCandidate === `'''` || tripleCandidate === `"""`) && !isEscaped(line, index)) {
      tripleQuote = tripleCandidate;
      index += 2;
      continue;
    }

    if ((char === "'" || char === '"') && !isEscaped(line, index)) {
      inSingleQuotedString = char;
      continue;
    }

    if (char === '(' || char === '[' || char === '{') {
      bracketDepth += 1;
      continue;
    }

    if (char === ')' || char === ']' || char === '}') {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }
  }

  let trimIndex = line.length - 1;
  while (trimIndex >= 0 && /\s/.test(line[trimIndex])) {
    trimIndex -= 1;
  }
  if (trimIndex >= 0 && line[trimIndex] === '\\' && !isEscaped(line, trimIndex)) {
    lineContinuation = true;
  }

  return {
    bracketDepth,
    lineContinuation,
    tripleQuote,
    isBlankOrComment: !sawCode,
  };
}

export function instrumentPythonSource(source: string): string {
  const lines = source.split('\n');
  const instrumented: string[] = [];

  let statementOpen = false;
  let bracketDepth = 0;
  let tripleQuote: `'''` | `"""` | null = null;

  for (const line of lines) {
    const analysis = analyzePythonLine(line, bracketDepth, tripleQuote);
    const indentation = line.match(/^\s*/)?.[0] ?? '';

    if (!analysis.isBlankOrComment && !statementOpen) {
      instrumented.push(`${indentation}__hvy_step__()`);
    }

    instrumented.push(line);

    bracketDepth = analysis.bracketDepth;
    tripleQuote = analysis.tripleQuote;

    if (!analysis.isBlankOrComment) {
      statementOpen = tripleQuote !== null || bracketDepth > 0 || analysis.lineContinuation;
    }
  }

  return instrumented.join('\n');
}

// The Python program executed for each user script. It pulls the runtime and
// source out of the shared JS global, prefers sys.settrace() for line
// counting, and falls back to a JS-side source rewrite if tracing is
// unavailable in the current Brython build.
export function buildPythonProgram(runtimeId: string): string {
  return `
from browser import window as __hvy_window__

__hvy_globals__ = __hvy_window__.__HVY_SCRIPTING__
__hvy_runtime__ = __hvy_globals__.runtimes['${runtimeId}']
__hvy_source__ = __hvy_globals__.sources['${runtimeId}']
__hvy_instrumented_source__ = __hvy_globals__.instrumentedSources['${runtimeId}']
__hvy_trace_enabled__ = False


def __hvy_trace__(frame, event, arg):
    if event == 'line':
        __hvy_runtime__.step()
    return __hvy_trace__


try:
    try:
        import sys as __hvy_sys__
        if hasattr(__hvy_sys__, 'settrace'):
            __hvy_sys__.settrace(__hvy_trace__)
            __hvy_trace_enabled__ = True
    except Exception:
        __hvy_trace_enabled__ = False

    __hvy_compilable_source__ = __hvy_source__ if __hvy_trace_enabled__ else __hvy_instrumented_source__
    __hvy_code__ = compile(__hvy_compilable_source__, '<hvy-script>', 'exec')
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
    if __hvy_trace_enabled__:
        try:
            __hvy_sys__.settrace(None)
        except Exception:
            pass
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
  scripting.instrumentedSources[runtimeId] = instrumentPythonSource(options.source);
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
      delete scripting.instrumentedSources[runtimeId];
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
