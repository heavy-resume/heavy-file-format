import { loadBrython, getBrython } from './brython-loader';
import { createScriptingRuntime, type ScriptingFormApi, type ScriptingRuntime } from './runtime';
import type { VisualDocument } from '../../types';
import { getScriptingPluginVersion, SCRIPTING_PLUGIN_VERSION } from './version';
import { createScriptingDbRuntime } from '../db-table';

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

function shouldSuppressBrythonConsoleNoise(args: unknown[]): boolean {
  const first = args[0];
  return typeof first === 'string' && first.startsWith('method from func w-o $infos');
}

function withSuppressedBrythonConsoleNoise(run: () => void): void {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = (...args: unknown[]) => {
    if (!shouldSuppressBrythonConsoleNoise(args)) {
      originalLog(...args);
    }
  };
  console.warn = (...args: unknown[]) => {
    if (!shouldSuppressBrythonConsoleNoise(args)) {
      originalWarn(...args);
    }
  };
  console.error = (...args: unknown[]) => {
    if (!shouldSuppressBrythonConsoleNoise(args)) {
      originalError(...args);
    }
  };

  try {
    run();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
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

function isImportStatementStart(line: string): boolean {
  const trimmed = line.trimStart();
  return /^import\b/.test(trimmed) || /^from\b.*\bimport\b/.test(trimmed);
}

const STRIPPED_IMPORT_MESSAGE = 'Import statements are not allowed in HVY scripts.';

export function comparePluginVersions(left: string, right: string): number {
  const leftParts = left.split('.').map((part) => Number.parseInt(part, 10));
  const rightParts = right.split('.').map((part) => Number.parseInt(part, 10));
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = Number.isFinite(leftParts[index]) ? leftParts[index] : 0;
    const rightValue = Number.isFinite(rightParts[index]) ? rightParts[index] : 0;
    if (leftValue > rightValue) {
      return 1;
    }
    if (leftValue < rightValue) {
      return -1;
    }
  }
  return 0;
}

export function buildScriptingVersionMismatchMessage(requestedVersion: string): string {
  return `This HVY scripting block requires plugin version ${requestedVersion}, but this client supports ${SCRIPTING_PLUGIN_VERSION}.`;
}

export function getScriptingTraceLabel(componentId?: string): string {
  const trimmed = componentId?.trim() ?? '';
  return trimmed.length > 0 ? trimmed.replace(/[<>]/g, '') : 'hvy-script';
}

export function stripPythonImports(source: string): string {
  const lines = source.split('\n');
  const stripped: string[] = [];

  let statementOpen = false;
  let bracketDepth = 0;
  let tripleQuote: `'''` | `"""` | null = null;
  let strippingImport = false;

  for (const line of lines) {
    const analysis = analyzePythonLine(line, bracketDepth, tripleQuote);
    const indentation = line.match(/^\s*/)?.[0] ?? '';

    if (!statementOpen && !analysis.isBlankOrComment && isImportStatementStart(line)) {
      stripped.push(`${indentation}raise RuntimeError(${JSON.stringify(STRIPPED_IMPORT_MESSAGE)})`);
      strippingImport = true;
    } else if (strippingImport) {
      stripped.push('');
    } else {
      stripped.push(line);
    }

    bracketDepth = analysis.bracketDepth;
    tripleQuote = analysis.tripleQuote;

    if (!analysis.isBlankOrComment) {
      statementOpen = tripleQuote !== null || bracketDepth > 0 || analysis.lineContinuation;
    }

    if (strippingImport && !statementOpen) {
      strippingImport = false;
    }
  }

  return stripped.join('\n');
}

export function summarizeScriptingError(rawError: string): string {
  const trimmed = rawError.trim();
  if (trimmed.length === 0) {
    return 'Script failed.';
  }

  const lineMatch = trimmed.match(/File "<[^"]+>", line (\d+)/);
  const lineSuffix = lineMatch ? ` (line ${lineMatch[1]})` : '';
  const lines = trimmed.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  const lastLine = lines.at(-1) ?? 'Script failed.';

  if (lastLine.includes(STRIPPED_IMPORT_MESSAGE)) {
    return `${STRIPPED_IMPORT_MESSAGE}${lineSuffix}`;
  }

  const exceptionMatch = lastLine.match(/^([A-Za-z_][A-Za-z0-9_.]*):\s*(.+)$/);
  if (exceptionMatch) {
    return `${exceptionMatch[1]}: ${exceptionMatch[2]}${lineSuffix}`;
  }

  return `${lastLine}${lineSuffix}`;
}

export function cleanScriptingErrorDetail(rawError: string): string {
  const trimmed = rawError.trim();
  if (trimmed.length === 0) {
    return 'Script failed.';
  }

  const lines = trimmed.split('\n');
  const cleaned = lines.filter((line, index) => {
    const nextLine = lines[index + 1] ?? '';
    if (line.includes('File "#hvy_script_')) {
      return false;
    }
    if (line.trim() === 'exec(__hvy_code__, __hvy_user_globals__)') {
      return false;
    }
    if (line.trim() === '<module>' && nextLine.trim() === 'exec(__hvy_code__, __hvy_user_globals__)') {
      return false;
    }
    return true;
  });

  return cleaned.join('\n').trim();
}

// The Python program executed for each user script. It pulls the runtime and
// source out of the shared JS global, prefers sys.settrace() for line
// counting, and falls back to a JS-side source rewrite if tracing is
// unavailable in the current Brython build.
export function buildPythonProgram(runtimeId: string, componentId?: string): string {
  const traceLabel = getScriptingTraceLabel(componentId);
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
    __hvy_code__ = compile(__hvy_compilable_source__, '<${traceLabel}>', 'exec')
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
  errorDetail?: string;
  linesExecuted: number;
  toolCalls: number;
}

export interface RunUserScriptOptions {
  document: VisualDocument;
  source: string;
  componentId?: string;
  pluginVersion?: string;
  maxLines?: number;
  form?: ScriptingFormApi;
}

export async function runUserScript(options: RunUserScriptOptions): Promise<ScriptingRunResult> {
  if (options.source.trim().length === 0) {
    return { ok: true, linesExecuted: 0, toolCalls: 0 };
  }

  const requestedVersion = getScriptingPluginVersion(options.pluginVersion ? { version: options.pluginVersion } : undefined);
  if (comparePluginVersions(requestedVersion, SCRIPTING_PLUGIN_VERSION) > 0) {
    const error = buildScriptingVersionMismatchMessage(requestedVersion);
    return {
      ok: false,
      error,
      errorDetail: error,
      linesExecuted: 0,
      toolCalls: 0,
    };
  }

  try {
    await loadBrython();
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to load Brython.',
      errorDetail: error instanceof Error ? error.stack ?? error.message : 'Failed to load Brython.',
      linesExecuted: 0,
      toolCalls: 0,
    };
  }

  let dbMutated = false;
  let runtime: ScriptingRuntime | null = null;
  let scriptingDb: Awaited<ReturnType<typeof createScriptingDbRuntime>>;
  try {
    scriptingDb = await createScriptingDbRuntime(options.document, () => {
      dbMutated = true;
      runtime?.markMutated();
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to initialize document database.',
      errorDetail: error instanceof Error ? error.stack ?? error.message : 'Failed to initialize document database.',
      linesExecuted: 0,
      toolCalls: 0,
    };
  }
  runtime = createScriptingRuntime({
    document: options.document,
    maxLines: options.maxLines,
    form: options.form,
    db: scriptingDb.api,
  });
  const runtimeId = `r${++runtimeCounter}`;
  const scripting = getScriptingGlobal();
  const sanitizedSource = stripPythonImports(options.source);
  scripting.runtimes[runtimeId] = runtime;
  scripting.sources[runtimeId] = sanitizedSource;
  scripting.instrumentedSources[runtimeId] = instrumentPythonSource(sanitizedSource);
  scripting.errors[runtimeId] = null;

  // Do not append this to the DOM or use type="text/python", otherwise 
  // Brython 3.14+ will detect the DOM mutation and run the script automatically 
  // in addition to the manual run_script call below, causing a double-execution.
  const scriptElement = document.createElement('script');
  scriptElement.id = `hvy-script-${runtimeId}`;
  scriptElement.textContent = buildPythonProgram(runtimeId, options.componentId);

  return new Promise((resolve) => {
    scripting.callbacks[runtimeId] = () => {
      const error = scripting.errors[runtimeId];
      const result: ScriptingRunResult = error
        ? {
            ok: false,
            error: summarizeScriptingError(error),
            errorDetail: cleanScriptingErrorDetail(error),
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
      scriptingDb.dispose();
      if (dbMutated) {
        runtime.doc.rerender();
      }

      resolve(result);
    };

    try {
      const brython = getBrython() as unknown as {
        run_script?: (elt: HTMLElement, src: string, name: string, url: string, runLoop: boolean) => void;
      };
      if (typeof brython.run_script !== 'function') {
        throw new Error('Brython run_script API unavailable.');
      }
      const runScript = brython.run_script;

      withSuppressedBrythonConsoleNoise(() => {
        runScript(
          scriptElement,
          scriptElement.textContent || '',
          `hvy_script_${runtimeId}`,
          window.location.href || 'http://localhost/hvy-plugin',
          true
        );
      });
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
