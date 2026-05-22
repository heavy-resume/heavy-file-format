import { loadBrython, getBrython } from './brython-loader';
import { createScriptingRuntime, type ScriptingDbApi, type ScriptingFormApi, type ScriptingRuntime } from './runtime';
import type { VisualDocument } from '../../types';
import type { HvyPluginHookChangeReason } from '../types';
import { getScriptingPluginVersion, SCRIPTING_PLUGIN_VERSION } from './version';
import { hasDocumentDbTables } from '../db-table-model';

export const SCRIPTING_LIBRARY_OPTIONS = ['random'] as const;
export type ScriptingLibraryName = (typeof SCRIPTING_LIBRARY_OPTIONS)[number];

// Counter for unique runtime ids — each script run gets its own slot on the
// shared __HVY_SCRIPTING__ global so concurrent runs don't collide.
let runtimeCounter = 0;

interface HvyScriptingGlobal {
  runtimes: Record<string, ScriptingRuntime>;
  sources: Record<string, string>;
  instrumentedSources: Record<string, string>;
  errors: Record<string, string | null>;
  results: Record<string, unknown>;
  callbacks: Record<string, () => void>;
}

interface LoadedScriptingDbRuntime {
  api: ScriptingDbApi;
  dispose(): void;
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
    window.__HVY_SCRIPTING__ = { runtimes: {}, sources: {}, instrumentedSources: {}, errors: {}, results: {}, callbacks: {} };
  }
  if (!window.__HVY_SCRIPTING__.callbacks) {
    window.__HVY_SCRIPTING__.callbacks = {};
  }
  if (!window.__HVY_SCRIPTING__.instrumentedSources) {
    window.__HVY_SCRIPTING__.instrumentedSources = {};
  }
  if (!window.__HVY_SCRIPTING__.results) {
    window.__HVY_SCRIPTING__.results = {};
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

function shouldInitializeScriptingDb(document: VisualDocument, source: string): boolean {
  if (hasDocumentDbTables(document)) {
    return true;
  }
  return /\bdoc\s*\.\s*db\b|\bdb\b/u.test(source);
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
    const trimmed = line.trimStart();

    if (!analysis.isBlankOrComment && !statementOpen && !isCompoundContinuationLine(trimmed)) {
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

function isCompoundContinuationLine(trimmedLine: string): boolean {
  return /^(elif|else|except|finally)\b/.test(trimmedLine);
}

export function wrapPythonSourceInFunction(source: string): string {
  const lines = source.split('\n');
  const body = lines.length > 0 && lines.some((line) => line.trim().length > 0)
    ? lines.map((line) => `    ${line}`)
    : ['    pass'];
  return [
    'def __hvy_user_main__():',
    ...body,
  ].join('\n');
}

function isImportStatementStart(line: string): boolean {
  const trimmed = line.trimStart();
  return /^import\b/.test(trimmed) || /^from\b.*\bimport\b/.test(trimmed);
}

function getAllowedImportLibrary(line: string, allowedLibraries: readonly string[]): string | null {
  const allowed = new Set(allowedLibraries);
  const trimmed = line.trimStart();
  const importMatch = trimmed.match(/^import\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+as\s+[A-Za-z_][A-Za-z0-9_]*)?\s*$/);
  if (importMatch) {
    return allowed.has(importMatch[1] ?? '') ? importMatch[1] ?? null : null;
  }
  const fromMatch = trimmed.match(/^from\s+([A-Za-z_][A-Za-z0-9_]*)\s+import\b/);
  if (fromMatch) {
    return allowed.has(fromMatch[1] ?? '') ? fromMatch[1] ?? null : null;
  }
  return null;
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

export function stripPythonImports(source: string, allowedLibraries: readonly string[] = []): string {
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
      if (getAllowedImportLibrary(line, allowedLibraries)) {
        stripped.push('');
        strippingImport = false;
      } else {
        stripped.push(`${indentation}raise RuntimeError(${JSON.stringify(STRIPPED_IMPORT_MESSAGE)})`);
        strippingImport = true;
      }
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
export function buildPythonProgram(runtimeId: string, componentId?: string, injectedGlobals: Record<string, unknown> = {}, libraries: readonly string[] = []): string {
  const traceLabel = getScriptingTraceLabel(componentId);
  const allowedLibraries = libraries.filter((name): name is ScriptingLibraryName => (SCRIPTING_LIBRARY_OPTIONS as readonly string[]).includes(name));
  const injectedAssignments = Object.entries(injectedGlobals)
    .filter(([name]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
    .map(([name, value]) => `    __hvy_user_globals__[${JSON.stringify(name)}] = ${toPythonLiteral(value)}`)
    .join('\n');
  const libraryList = `[${allowedLibraries.map((name) => JSON.stringify(name)).join(', ')}]`;
  return `
from browser import window as __hvy_window__

__hvy_globals__ = __hvy_window__.__HVY_SCRIPTING__
__hvy_runtime__ = __hvy_globals__.runtimes['${runtimeId}']
__hvy_source__ = __hvy_globals__.sources['${runtimeId}']
__hvy_instrumented_source__ = __hvy_globals__.instrumentedSources['${runtimeId}']
__hvy_trace_enabled__ = False
__hvy_builtin_import__ = __import__
__hvy_builtin_eval__ = eval
__hvy_allowed_libraries__ = ${libraryList}
__hvy_forbidden_global_names__ = (
    'window',
    'document',
    'browser',
    '__BRYTHON__',
    '__hvy_window__',
    '__hvy_globals__',
    '__hvy_runtime__',
    '__hvy_source__',
    '__hvy_instrumented_source__',
    '__hvy_user_globals__',
    '__hvy_user_main__',
)


def __hvy_sanitize_user_globals__():
    try:
        for __hvy_name__ in __hvy_forbidden_global_names__:
            __hvy_user_globals__.pop(__hvy_name__, None)
    except Exception:
        pass


def __hvy_user_step__():
    __hvy_step_error__ = __hvy_runtime__.step()
    if __hvy_step_error__:
        raise RuntimeError(__hvy_step_error__)
    __hvy_sanitize_user_globals__()


def __hvy_safe_globals__():
    __hvy_sanitize_user_globals__()
    return {
        __hvy_key__: __hvy_value__
        for __hvy_key__, __hvy_value__ in __hvy_user_globals__.items()
        if __hvy_key__ not in __hvy_forbidden_global_names__
    }


def __hvy_safe_eval__(expression, globals=None, locals=None):
    if isinstance(expression, str) and expression.strip() in __hvy_forbidden_global_names__:
        raise NameError("name '" + expression.strip() + "' is not defined")
    if globals is not None or locals is not None:
        raise RuntimeError("Custom eval globals are not allowed in HVY scripts.")
    __hvy_sanitize_user_globals__()
    return __hvy_builtin_eval__(expression, __hvy_user_globals__, __hvy_user_globals__)


def __hvy_blocked_import__(*args, **kwargs):
    raise RuntimeError("Import statements are not allowed in HVY scripts.")


def __hvy_script_import__(name, globals=None, locals=None, fromlist=(), level=0):
    root_name = str(name).split('.')[0]
    if level != 0 or root_name not in __hvy_allowed_libraries__:
        raise RuntimeError("Import statements are not allowed in HVY scripts.")
    if root_name == "random":
        return __HvyRandomModule__()
    return __hvy_builtin_import__(name, globals, locals, fromlist, level)


class __HvyRandomModule__:
    def random(self):
        return __hvy_window__.Math.random()

    def shuffle(self, items):
        index = len(items) - 1
        while index > 0:
            swap_index = int(__hvy_window__.Math.floor(__hvy_window__.Math.random() * (index + 1)))
            temp = items[index]
            items[index] = items[swap_index]
            items[swap_index] = temp
            index -= 1


def __hvy_print__(*values, sep=' ', end='\\n', file=None, flush=False):
    if file is not None:
        raise RuntimeError("print(file=...) is not supported in HVY scripts.")
    text = str(sep).join([str(value) for value in values]) + str(end)
    if text.endswith('\\n'):
        text = text[:-1]
    __hvy_runtime__.doc.log_json(__hvy_to_json__([text]))


__hvy_safe_builtins__ = {
    'abs': abs,
    'all': all,
    'any': any,
    'bool': bool,
    'dict': dict,
    'enumerate': enumerate,
    'float': float,
    'int': int,
    'isinstance': isinstance,
    'len': len,
    'list': list,
    'max': max,
    'min': min,
    'print': __hvy_print__,
    'range': range,
    'round': round,
    'set': set,
    'sorted': sorted,
    'str': str,
    'sum': sum,
    'tuple': tuple,
    'zip': zip,
    'BaseException': BaseException,
    'Exception': Exception,
    'RuntimeError': RuntimeError,
    'TypeError': TypeError,
    'ValueError': ValueError,
    '__import__': __hvy_script_import__,
}


def __hvy_json_escape__(value):
    out = '"'
    for ch in str(value):
        if ch == '\\\\':
            out += '\\\\\\\\'
        elif ch == '"':
            out += '\\\\"'
        elif ch == '\\n':
            out += '\\\\n'
        elif ch == '\\r':
            out += '\\\\r'
        elif ch == '\\t':
            out += '\\\\t'
        else:
            out += ch
    return out + '"'


def __hvy_to_json__(value):
    if value is None:
        return 'null'
    if value is True:
        return 'true'
    if value is False:
        return 'false'
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        return __hvy_json_escape__(value)
    if isinstance(value, (list, tuple)):
        return '[' + ','.join([__hvy_to_json__(item) for item in value]) + ']'
    if isinstance(value, dict):
        parts = []
        for key, item in value.items():
            parts.append(__hvy_json_escape__(key) + ':' + __hvy_to_json__(item))
        return '{' + ','.join(parts) + '}'
    return __hvy_json_escape__(value)


class __HvyToolProxy__:
    def __init__(self, js_doc):
        self.__js_doc = js_doc

    def __call__(self, name, args=None, **kwargs):
        if args is None:
            merged = {}
        elif isinstance(args, dict):
            merged = dict(args)
        else:
            raise TypeError("doc.tool args must be a dict when provided")
        merged.update(kwargs)
        return self.__js_doc.tool_json(name, __hvy_to_json__(merged))

    def __getattr__(self, name):
        def __hvy_named_tool__(*args, **kwargs):
            if len(args) == 0:
                return self(name, None, **kwargs)
            if len(args) == 1:
                if name in ("get_updated_components", "get_components") and not isinstance(args[0], dict):
                    merged = {"component": args[0]}
                    merged.update(kwargs)
                    return self(name, merged)
                return self(name, args[0], **kwargs)
            raise TypeError("doc.tool.NAME accepts at most one positional args dict")
        return __hvy_named_tool__


class __HvyDocProxy__:
    def __init__(self, js_doc):
        self.__js_doc = js_doc
        self.tool = __HvyToolProxy__(js_doc)

    def __getattr__(self, name):
        return getattr(self.__js_doc, name)


def __hvy_trace__(frame, event, arg):
    if frame.f_code.co_filename != '<${traceLabel}>':
        return None
    if event == 'line':
        __hvy_user_step__()
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
        '__hvy_step__': __hvy_user_step__,
        '__import__': __hvy_script_import__,
        '__builtins__': __hvy_safe_builtins__,
        'doc': __HvyDocProxy__(__hvy_runtime__.doc),
        'eval': __hvy_safe_eval__,
        'globals': __hvy_safe_globals__,
        '__name__': '__hvy_script__',
    }
    for __hvy_library__ in __hvy_allowed_libraries__:
        __hvy_user_globals__[__hvy_library__] = __hvy_script_import__(__hvy_library__)
${injectedAssignments}
    __hvy_sanitize_user_globals__()
    exec(__hvy_code__, __hvy_user_globals__)
    __hvy_entrypoint__ = __hvy_user_globals__.get('__hvy_user_main__')
    __hvy_sanitize_user_globals__()
    if __hvy_entrypoint__ is not None:
        __hvy_globals__.results['${runtimeId}'] = __hvy_entrypoint__()
    __hvy_runtime__.doc.rerender()
except Exception as __hvy_err__:
    __hvy_globals__.errors['${runtimeId}'] = __hvy_window__.__BRYTHON__.error_trace(__hvy_err__)
finally:
    if __hvy_trace_enabled__:
        try:
            __hvy_sys__.settrace(None)
        except Exception:
            pass
    __hvy_globals__.callbacks['${runtimeId}']()
`;
}

function toPythonLiteral(value: unknown): string {
  if (value === null || typeof value === 'undefined') {
    return 'None';
  }
  if (typeof value === 'boolean') {
    return value ? 'True' : 'False';
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return JSON.stringify(String(value));
}

export interface ScriptingRunResult {
  ok: boolean;
  error?: string;
  errorDetail?: string;
  stepsExecuted: number;
  stepBudget: number;
  /** @deprecated Use stepsExecuted. */
  linesExecuted: number;
  toolCalls: number;
  logs?: string[];
  returnValue?: unknown;
}

export interface RunUserScriptOptions {
  document: VisualDocument;
  previousDocument?: VisualDocument | null;
  source: string;
  componentId?: string;
  pluginVersion?: string;
  maxLines?: number;
  changeReason?: HvyPluginHookChangeReason;
  form?: ScriptingFormApi;
  injectedGlobals?: Record<string, unknown>;
  libraries?: readonly string[];
}

export async function runUserScript(options: RunUserScriptOptions): Promise<ScriptingRunResult> {
  if (options.source.trim().length === 0) {
    return { ok: true, stepsExecuted: 0, stepBudget: options.maxLines ?? 100_000, linesExecuted: 0, toolCalls: 0 };
  }

  const requestedVersion = getScriptingPluginVersion(options.pluginVersion ? { version: options.pluginVersion } : undefined);
  if (comparePluginVersions(requestedVersion, SCRIPTING_PLUGIN_VERSION) > 0) {
    const error = buildScriptingVersionMismatchMessage(requestedVersion);
    return {
      ok: false,
      error,
      errorDetail: error,
      stepsExecuted: 0,
      stepBudget: options.maxLines ?? 100_000,
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
      stepsExecuted: 0,
      stepBudget: options.maxLines ?? 100_000,
      linesExecuted: 0,
      toolCalls: 0,
    };
  }

  let dbMutated = false;
  let runtime: ScriptingRuntime | null = null;
  let scriptingDb: LoadedScriptingDbRuntime | null = null;
  if (shouldInitializeScriptingDb(options.document, options.source)) {
    try {
      const { createScriptingDbRuntime } = await import('../db-table');
      scriptingDb = await createScriptingDbRuntime(options.document, () => {
        dbMutated = true;
        runtime?.markMutated();
      });
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to initialize document database.',
        errorDetail: error instanceof Error ? error.stack ?? error.message : 'Failed to initialize document database.',
        stepsExecuted: 0,
        stepBudget: options.maxLines ?? 100_000,
        linesExecuted: 0,
        toolCalls: 0,
      };
    }
  }
  runtime = createScriptingRuntime({
    document: options.document,
    previousDocument: options.previousDocument,
    maxLines: options.maxLines,
    changeReason: options.changeReason,
    form: options.form,
    db: scriptingDb?.api,
  });
  const runtimeId = `r${++runtimeCounter}`;
  const scripting = getScriptingGlobal();
  const libraries = (options.libraries ?? []).filter((name): name is ScriptingLibraryName => (SCRIPTING_LIBRARY_OPTIONS as readonly string[]).includes(name));
  const sanitizedSource = stripPythonImports(options.source, libraries);
  scripting.runtimes[runtimeId] = runtime;
  scripting.sources[runtimeId] = wrapPythonSourceInFunction(sanitizedSource);
  scripting.instrumentedSources[runtimeId] = wrapPythonSourceInFunction(instrumentPythonSource(sanitizedSource));
  scripting.errors[runtimeId] = null;
  scripting.results[runtimeId] = undefined;

  // Do not append this to the DOM or use type="text/python", otherwise 
  // Brython 3.14+ will detect the DOM mutation and run the script automatically 
  // in addition to the manual run_script call below, causing a double-execution.
  const scriptElement = document.createElement('script');
  scriptElement.id = `hvy-script-${runtimeId}`;
  scriptElement.textContent = buildPythonProgram(runtimeId, options.componentId, options.injectedGlobals ?? {}, libraries);

  return new Promise((resolve) => {
    scripting.callbacks[runtimeId] = () => {
      const error = scripting.errors[runtimeId];
      const result: ScriptingRunResult = error
        ? {
            ok: false,
            error: summarizeScriptingError(error),
            errorDetail: cleanScriptingErrorDetail(error),
            stepsExecuted: runtime.stats.stepsExecuted,
            stepBudget: runtime.stats.stepBudget,
            linesExecuted: runtime.stats.linesExecuted,
            toolCalls: runtime.stats.toolCalls,
            logs: [...runtime.stats.logs],
          }
        : {
            ok: true,
            stepsExecuted: runtime.stats.stepsExecuted,
            stepBudget: runtime.stats.stepBudget,
            linesExecuted: runtime.stats.linesExecuted,
            toolCalls: runtime.stats.toolCalls,
            returnValue: scripting.results[runtimeId],
            logs: [...runtime.stats.logs],
          };

      delete scripting.runtimes[runtimeId];
      delete scripting.sources[runtimeId];
      delete scripting.instrumentedSources[runtimeId];
      delete scripting.errors[runtimeId];
      delete scripting.results[runtimeId];
      delete scripting.callbacks[runtimeId];
      scriptingDb?.dispose();
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
          `${window.location.href || 'http://localhost/hvy-plugin'}#hvy-script-${runtimeId}`,
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
