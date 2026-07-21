import { loadBrython, getBrython } from './brython-loader';
import { createScriptingRuntime, type ScriptingDbApi, type ScriptingFormApi, type ScriptingRuntime } from './runtime';
import type { HvyPdfExportRuleRecorder } from '../../pdf-export/types';
import type { VisualDocument } from '../../types';
import type { HvyPluginHookChangeReason } from '../types';
import { getScriptingPluginVersion, SCRIPTING_PLUGIN_VERSION } from './version';
import { hasDocumentDbTables } from '../db-table-model';
import { notifyDocumentMayHaveChanged } from '../../document-change';
import { getActiveStateRuntime, runWithStateRuntime, type StateRuntime } from '../../state';

export const SCRIPTING_LIBRARY_OPTIONS = ['random', 're', 'datetime'] as const;
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
  regex: HvyScriptingRegexBridge;
}

interface HvyScriptingRegexMatch {
  matched: boolean;
  captureCount(): number;
  captureAt(index: number): string | null;
  index: number;
  end: number;
}

interface HvyScriptingRegexFindAllResult {
  count(): number;
  isTuple(index: number): boolean;
  tupleCount(index: number): number;
  valueAt(index: number, groupIndex: number): string | null;
}

interface HvyScriptingRegexSplitResult {
  count(): number;
  valueAt(index: number): string;
}

interface HvyScriptingRegexBridge {
  exec(pattern: string, flags: string, source: string): HvyScriptingRegexMatch;
  findall(pattern: string, flags: string, source: string): HvyScriptingRegexFindAllResult;
  sub(pattern: string, flags: string, replacement: string, source: string, count: number): string;
  split(pattern: string, flags: string, source: string, maxsplit: number): HvyScriptingRegexSplitResult;
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
    window.__HVY_SCRIPTING__ = { runtimes: {}, sources: {}, instrumentedSources: {}, errors: {}, results: {}, callbacks: {}, regex: createScriptingRegexBridge() };
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
  if (!window.__HVY_SCRIPTING__.regex) {
    window.__HVY_SCRIPTING__.regex = createScriptingRegexBridge();
  }
  return window.__HVY_SCRIPTING__;
}

function normalizeRegexFlags(flags: string, globalSearch: boolean): string {
  const out = new Set<string>();
  for (const flag of flags) {
    if (flag === 'g') {
      continue;
    }
    out.add(flag);
  }
  if (globalSearch) {
    out.add('g');
  }
  return Array.from(out).join('');
}

function createRegex(pattern: string, flags: string, globalSearch: boolean): RegExp {
  return new RegExp(pattern, normalizeRegexFlags(flags, globalSearch));
}

function createScriptingRegexBridge(): HvyScriptingRegexBridge {
  return {
    exec(pattern, flags, source) {
      const regex = createRegex(pattern, flags, true);
      const match = regex.exec(source);
      if (!match) {
        return { matched: false, captureCount: () => 0, captureAt: () => null, index: -1, end: -1 };
      }
      const captures = Array.from(match, (value) => value ?? null);
      return {
        matched: true,
        captureCount: () => captures.length,
        captureAt: (index) => captures[Math.trunc(index)] ?? null,
        index: match.index,
        end: match.index + match[0].length,
      };
    },
    findall(pattern, flags, source) {
      const regex = createRegex(pattern, flags, true);
      const out: Array<string | null | Array<string | null>> = [];
      let match: RegExpExecArray | null;
      while ((match = regex.exec(source)) !== null) {
        if (match.length > 2) {
          out.push(match.slice(1).map((value) => value ?? null));
        } else if (match.length === 2) {
          out.push(match[1] ?? null);
        } else {
          out.push(match[0]);
        }
        if (match[0] === '') {
          regex.lastIndex += 1;
        }
      }
      return {
        count: () => out.length,
        isTuple: (index) => Array.isArray(out[Math.trunc(index)]),
        tupleCount: (index) => {
          const item = out[Math.trunc(index)];
          return Array.isArray(item) ? item.length : 1;
        },
        valueAt: (index, groupIndex) => {
          const item = out[Math.trunc(index)];
          if (Array.isArray(item)) {
            return item[Math.trunc(groupIndex)] ?? null;
          }
          return item ?? null;
        },
      };
    },
    sub(pattern, flags, replacement, source, count) {
      const limit = Math.floor(Number.isFinite(count) ? count : 0);
      if (limit <= 0) {
        return source.replace(createRegex(pattern, flags, true), replacement);
      }
      let replaced = 0;
      return source.replace(createRegex(pattern, flags, true), (match) => {
        if (replaced >= limit) {
          return match;
        }
        replaced += 1;
        return replacement;
      });
    },
    split(pattern, flags, source, maxsplit) {
      const limit = Math.floor(Number.isFinite(maxsplit) ? maxsplit : 0);
      if (limit <= 0) {
        const parts = source.split(createRegex(pattern, flags, true));
        return {
          count: () => parts.length,
          valueAt: (index) => parts[Math.trunc(index)] ?? '',
        };
      }
      const out: string[] = [];
      const regex = createRegex(pattern, flags, true);
      let cursor = 0;
      let splitCount = 0;
      let match: RegExpExecArray | null;
      while (splitCount < limit && (match = regex.exec(source)) !== null) {
        out.push(source.slice(cursor, match.index));
        cursor = match.index + match[0].length;
        splitCount += 1;
        if (match[0] === '') {
          regex.lastIndex += 1;
        }
      }
      out.push(source.slice(cursor));
      return {
        count: () => out.length,
        valueAt: (index) => out[Math.trunc(index)] ?? '',
      };
    },
  };
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

function getAllowedImportReplacement(line: string, allowedLibraries: readonly string[]): string | null {
  const allowed = new Set(allowedLibraries);
  const trimmed = line.trimStart();
  const importMatch = trimmed.match(/^import\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+as\s+[A-Za-z_][A-Za-z0-9_]*)?\s*$/);
  if (importMatch) {
    const library = importMatch[1] ?? '';
    if (!allowed.has(library)) {
      return null;
    }
    const aliasMatch = trimmed.match(/\s+as\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/);
    return aliasMatch?.[1] ? `${aliasMatch[1]} = ${library}` : '';
  }
  const fromMatch = trimmed.match(/^from\s+([A-Za-z_][A-Za-z0-9_]*)\s+import\s+(.+?)\s*$/);
  if (fromMatch) {
    const library = fromMatch[1] ?? '';
    if (!allowed.has(library)) {
      return null;
    }
    const imports = (fromMatch[2] ?? '').split(',').map((item) => item.trim()).filter(Boolean);
    if (imports.length === 0) {
      return null;
    }
    const parsedImports: Array<{ name: string; alias: string }> = [];
    for (const item of imports) {
      const itemMatch = item.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?$/);
      if (!itemMatch) {
        return null;
      }
      const name = itemMatch[1] ?? '';
      const alias = itemMatch[2] ?? name;
      parsedImports.push({ name, alias });
    }
    // Resolve every attribute from the module before binding local names. This
    // matters when an imported name shadows the module itself, as in
    // `from datetime import datetime, timedelta`.
    const moduleExpression = parsedImports.some(({ alias }) => alias === library)
      ? `__import__(${JSON.stringify(library)})`
      : library;
    return parsedImports.map(({ name, alias }) => `${alias} = ${moduleExpression}.${name}`).join('\n');
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
      const replacement = getAllowedImportReplacement(line, allowedLibraries);
      if (replacement !== null) {
        stripped.push(replacement.split('\n').map((replacementLine) => `${indentation}${replacementLine}`).join('\n'));
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
  const userFrameIndex = lines.findIndex((line) => /^\s*File "<[^"<>]+>", line \d+/.test(line));
  if (userFrameIndex >= 0) {
    const tracebackHeader = lines.find((line) => line.startsWith('Traceback '));
    return [tracebackHeader, ...lines.slice(userFrameIndex)].filter((line): line is string => line !== undefined).join('\n').trim();
  }

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


__hvy_private_attribute_names__ = (
    '__dict__',
    '__func__',
    '__globals__',
    '__getattr__',
    '__getattribute__',
    '_HvyDocProxy__js_doc',
    '_HvyToolProxy__js_doc',
)


def __hvy_require_public_attribute__(name):
    if str(name) in __hvy_private_attribute_names__:
        raise AttributeError("HVY scripts cannot access private runtime attribute '" + str(name) + "'.")


def __hvy_getattr__(value, name, *default):
    __hvy_require_public_attribute__(name)
    if len(default) > 1:
        raise TypeError("getattr expected at most 3 arguments")
    if len(default) == 1:
        return getattr(value, name, default[0])
    return getattr(value, name)


def __hvy_hasattr__(value, name):
    try:
        __hvy_getattr__(value, name)
        return True
    except AttributeError:
        return False


def __hvy_setattr__(value, name, replacement):
    __hvy_require_public_attribute__(name)
    return setattr(value, name, replacement)


def __hvy_delattr__(value, name):
    __hvy_require_public_attribute__(name)
    return delattr(value, name)


def __hvy_script_import__(name, globals=None, locals=None, fromlist=(), level=0):
    root_name = str(name).split('.')[0]
    if level != 0 or root_name not in __hvy_allowed_libraries__:
        raise RuntimeError("Import statements are not allowed in HVY scripts.")
    if root_name == "random":
        return __HvyRandomModule__()
    if root_name == "re":
        return __HvyReModule__()
    if root_name == "datetime":
        return __HvyDatetimeModule__()
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


def __hvy_is_leap_year__(year):
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


def __hvy_days_in_month__(year, month):
    if month == 2:
        return 29 if __hvy_is_leap_year__(year) else 28
    return (31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)[month - 1]


def __hvy_date_to_ordinal__(year, month, day):
    before_month = (0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334)[month - 1]
    return 365 * (year - 1) + (year - 1) // 4 - (year - 1) // 100 + (year - 1) // 400 + before_month + (1 if month > 2 and __hvy_is_leap_year__(year) else 0) + day


def __hvy_ordinal_to_date__(ordinal):
    if ordinal < 1 or ordinal > 3652059:
        raise OverflowError("date value out of range")
    low = 1
    high = 9999
    while low <= high:
        middle = (low + high) // 2
        first = __hvy_date_to_ordinal__(middle, 1, 1)
        following = __hvy_date_to_ordinal__(middle + 1, 1, 1) if middle < 9999 else 3652060
        if ordinal < first:
            high = middle - 1
        elif ordinal >= following:
            low = middle + 1
        else:
            year = middle
            break
    day_of_year = ordinal - __hvy_date_to_ordinal__(year, 1, 1) + 1
    month = 1
    while day_of_year > __hvy_days_in_month__(year, month):
        day_of_year -= __hvy_days_in_month__(year, month)
        month += 1
    return year, month, day_of_year


class __HvyTimedelta__:
    def __init__(self, days=0, seconds=0, microseconds=0, milliseconds=0, minutes=0, hours=0, weeks=0):
        values = (days, seconds, microseconds, milliseconds, minutes, hours, weeks)
        if not all(isinstance(value, (int, float)) for value in values):
            raise TypeError("timedelta arguments must be numbers")
        total = (weeks * 7 + days) * 86400000000 + hours * 3600000000 + minutes * 60000000 + seconds * 1000000 + milliseconds * 1000 + microseconds
        self.__total_microseconds = int(round(total))
        self.days, remainder = divmod(self.__total_microseconds, 86400000000)
        self.seconds, self.microseconds = divmod(remainder, 1000000)

    def total_seconds(self):
        return self.__total_microseconds / 1000000

    def _total_microseconds_value(self):
        return self.__total_microseconds

    def __add__(self, other):
        if isinstance(other, __HvyTimedelta__):
            return __HvyTimedelta__(microseconds=self.__total_microseconds + other._total_microseconds_value())
        return NotImplemented

    def __sub__(self, other):
        if isinstance(other, __HvyTimedelta__):
            return __HvyTimedelta__(microseconds=self.__total_microseconds - other._total_microseconds_value())
        return NotImplemented

    def __neg__(self):
        return __HvyTimedelta__(microseconds=-self.__total_microseconds)

    def __eq__(self, other):
        return isinstance(other, __HvyTimedelta__) and self.__total_microseconds == other._total_microseconds_value()

    def __lt__(self, other):
        if not isinstance(other, __HvyTimedelta__):
            return NotImplemented
        return self.__total_microseconds < other._total_microseconds_value()

    def __le__(self, other):
        if not isinstance(other, __HvyTimedelta__):
            return NotImplemented
        return self.__total_microseconds <= other._total_microseconds_value()


class __HvyDate__:
    def __init__(self, year, month, day):
        if not all(isinstance(value, int) for value in (year, month, day)):
            raise TypeError("date arguments must be integers")
        if year < 1 or year > 9999:
            raise ValueError("year must be in 1..9999")
        if month < 1 or month > 12:
            raise ValueError("month must be in 1..12")
        if day < 1 or day > __hvy_days_in_month__(year, month):
            raise ValueError("day is out of range for month")
        self.year = year
        self.month = month
        self.day = day

    def __ordinal(self):
        return __hvy_date_to_ordinal__(self.year, self.month, self.day)

    def weekday(self):
        return (self.__ordinal() - 1) % 7

    def isocalendar(self):
        ordinal = self.__ordinal()
        thursday = ordinal + (3 - self.weekday())
        iso_year = __hvy_ordinal_to_date__(thursday)[0]
        first_thursday = __hvy_date_to_ordinal__(iso_year, 1, 4)
        first_thursday += 3 - ((first_thursday - 1) % 7)
        return iso_year, (thursday - first_thursday) // 7 + 1, self.weekday() + 1

    def isoformat(self):
        return f"{self.year:04d}-{self.month:02d}-{self.day:02d}"

    def strftime(self, format):
        return __hvy_strftime__(self, str(format))

    def __add__(self, other):
        if isinstance(other, __HvyTimedelta__):
            year, month, day = __hvy_ordinal_to_date__(self.__ordinal() + other.days)
            return __HvyDate__(year, month, day)
        return NotImplemented

    def __sub__(self, other):
        if isinstance(other, __HvyTimedelta__):
            return self + (-other)
        if isinstance(other, __HvyDate__):
            return __HvyTimedelta__(days=self.__ordinal() - other.__ordinal())
        return NotImplemented

    def __eq__(self, other):
        return isinstance(other, __HvyDate__) and (self.year, self.month, self.day) == (other.year, other.month, other.day)

    def __lt__(self, other):
        if not isinstance(other, __HvyDate__):
            return NotImplemented
        return (self.year, self.month, self.day) < (other.year, other.month, other.day)

    def __le__(self, other):
        if not isinstance(other, __HvyDate__):
            return NotImplemented
        return self == other or self < other


class __HvyDateTime__(__HvyDate__):
    def __init__(self, year, month, day, hour=0, minute=0, second=0, microsecond=0):
        super().__init__(year, month, day)
        if not all(isinstance(value, int) for value in (hour, minute, second, microsecond)):
            raise TypeError("datetime arguments must be integers")
        if hour < 0 or hour > 23:
            raise ValueError("hour must be in 0..23")
        if minute < 0 or minute > 59:
            raise ValueError("minute must be in 0..59")
        if second < 0 or second > 59:
            raise ValueError("second must be in 0..59")
        if microsecond < 0 or microsecond > 999999:
            raise ValueError("microsecond must be in 0..999999")
        self.hour = hour
        self.minute = minute
        self.second = second
        self.microsecond = microsecond

    def __total_microseconds(self):
        return ((self._ordinal_value() - 1) * 86400 + self.hour * 3600 + self.minute * 60 + self.second) * 1000000 + self.microsecond

    def _ordinal_value(self):
        return __hvy_date_to_ordinal__(self.year, self.month, self.day)

    @classmethod
    def fromisoformat(cls, value):
        source = str(value)
        if source.endswith("Z") or "+" in source[10:] or "-" in source[10:]:
            raise ValueError("timezone-aware datetimes are not supported")
        parts = source.replace("T", " ", 1).split(" ")
        date_parts = parts[0].split("-")
        if len(date_parts) != 3 or len(parts) > 2:
            raise ValueError("Invalid isoformat string")
        time_values = [0, 0, 0, 0]
        if len(parts) == 2 and parts[1] != "":
            time_source = parts[1]
            fraction = ""
            if "." in time_source:
                time_source, fraction = time_source.split(".", 1)
                if not fraction.isdigit() or len(fraction) > 6:
                    raise ValueError("Invalid isoformat string")
                time_values[3] = int((fraction + "000000")[:6])
            clock = time_source.split(":")
            if len(clock) < 2 or len(clock) > 3 or not all(item.isdigit() for item in clock):
                raise ValueError("Invalid isoformat string")
            for index, item in enumerate(clock):
                time_values[index] = int(item)
        if not all(item.isdigit() for item in date_parts):
            raise ValueError("Invalid isoformat string")
        return cls(int(date_parts[0]), int(date_parts[1]), int(date_parts[2]), *time_values)

    @classmethod
    def strptime(cls, value, format):
        source = str(value)
        template = str(format)
        fields = {"Y": 1900, "m": 1, "d": 1, "H": 0, "M": 0, "S": 0, "f": 0}
        widths = {"Y": 4, "m": 2, "d": 2, "H": 2, "M": 2, "S": 2}
        source_index = 0
        format_index = 0
        while format_index < len(template):
            if template[format_index] != "%":
                if source_index >= len(source) or source[source_index] != template[format_index]:
                    raise ValueError("time data does not match format")
                source_index += 1
                format_index += 1
                continue
            format_index += 1
            if format_index >= len(template):
                raise ValueError("stray % in format")
            directive = template[format_index]
            format_index += 1
            if directive == "%":
                if source_index >= len(source) or source[source_index] != "%":
                    raise ValueError("time data does not match format")
                source_index += 1
                continue
            if directive == "f":
                end = source_index
                while end < len(source) and end - source_index < 6 and source[end].isdigit():
                    end += 1
                token = source[source_index:end]
                if token == "":
                    raise ValueError("time data does not match format")
                fields[directive] = int((token + "000000")[:6])
                source_index = end
                continue
            if directive not in widths:
                raise ValueError("unsupported datetime format directive: %" + directive)
            width = widths[directive]
            token = source[source_index:source_index + width]
            if len(token) != width or not token.isdigit():
                raise ValueError("time data does not match format")
            fields[directive] = int(token)
            source_index += width
        if source_index != len(source):
            raise ValueError("unconverted data remains")
        return cls(fields["Y"], fields["m"], fields["d"], fields["H"], fields["M"], fields["S"], fields["f"])

    def date(self):
        return __HvyDate__(self.year, self.month, self.day)

    def isoformat(self, sep="T", timespec="auto"):
        if timespec not in ("auto", "hours", "minutes", "seconds", "milliseconds", "microseconds"):
            raise ValueError("unsupported timespec")
        output = f"{self.year:04d}-{self.month:02d}-{self.day:02d}{sep}{self.hour:02d}"
        if timespec != "hours":
            output += f":{self.minute:02d}"
        include_seconds = timespec in ("auto", "seconds", "milliseconds", "microseconds")
        if include_seconds:
            output += f":{self.second:02d}"
        if timespec == "milliseconds":
            output += f".{self.microsecond // 1000:03d}"
        elif timespec == "microseconds" or (timespec == "auto" and self.microsecond):
            output += f".{self.microsecond:06d}"
        return output

    def __add__(self, other):
        if not isinstance(other, __HvyTimedelta__):
            return NotImplemented
        total = self.__total_microseconds() + other._total_microseconds_value()
        ordinal_minus_one, remainder = divmod(total, 86400000000)
        year, month, day = __hvy_ordinal_to_date__(ordinal_minus_one + 1)
        hour, remainder = divmod(remainder, 3600000000)
        minute, remainder = divmod(remainder, 60000000)
        second, microsecond = divmod(remainder, 1000000)
        return __HvyDateTime__(year, month, day, hour, minute, second, microsecond)

    def __sub__(self, other):
        if isinstance(other, __HvyTimedelta__):
            return self + (-other)
        if isinstance(other, __HvyDateTime__):
            return __HvyTimedelta__(microseconds=self.__total_microseconds() - other.__total_microseconds())
        return NotImplemented

    def __eq__(self, other):
        return isinstance(other, __HvyDateTime__) and self.__total_microseconds() == other.__total_microseconds()

    def __lt__(self, other):
        if not isinstance(other, __HvyDateTime__):
            return NotImplemented
        return self.__total_microseconds() < other.__total_microseconds()

    def __le__(self, other):
        if not isinstance(other, __HvyDateTime__):
            return NotImplemented
        return self.__total_microseconds() <= other.__total_microseconds()


def __hvy_strftime__(value, format):
    iso_year, iso_week, iso_weekday = value.isocalendar()
    day_of_year = __hvy_date_to_ordinal__(value.year, value.month, value.day) - __hvy_date_to_ordinal__(value.year, 1, 1) + 1
    replacements = {
        "Y": f"{value.year:04d}", "y": f"{value.year % 100:02d}", "m": f"{value.month:02d}",
        "d": f"{value.day:02d}", "j": f"{day_of_year:03d}", "w": str((value.weekday() + 1) % 7),
        "u": str(value.weekday() + 1), "V": f"{iso_week:02d}", "G": f"{iso_year:04d}", "g": f"{iso_year % 100:02d}",
        "H": f"{getattr(value, 'hour', 0):02d}", "M": f"{getattr(value, 'minute', 0):02d}",
        "S": f"{getattr(value, 'second', 0):02d}", "f": f"{getattr(value, 'microsecond', 0):06d}", "%": "%",
    }
    output = ""
    index = 0
    while index < len(format):
        if format[index] != "%":
            output += format[index]
            index += 1
            continue
        index += 1
        if index >= len(format) or format[index] not in replacements:
            raise ValueError("unsupported datetime format directive")
        output += replacements[format[index]]
        index += 1
    return output


class __HvyDateTimeFacade__:
    def __call__(self, year, month, day, hour=0, minute=0, second=0, microsecond=0):
        return __HvyDateTime__(year, month, day, hour, minute, second, microsecond)

    def fromisoformat(self, value):
        return __HvyDateTime__.fromisoformat(value)

    def strptime(self, value, format):
        return __HvyDateTime__.strptime(value, format)


class __HvyTimedeltaFacade__:
    def __call__(self, days=0, seconds=0, microseconds=0, milliseconds=0, minutes=0, hours=0, weeks=0):
        return __HvyTimedelta__(days, seconds, microseconds, milliseconds, minutes, hours, weeks)


class __HvyDatetimeModule__:
    datetime = __HvyDateTimeFacade__()
    timedelta = __HvyTimedeltaFacade__()


class __HvyReMatch__:
    def __init__(self, regex_match, source):
        self.__regex_match = regex_match
        self.string = source
        self.__capture_count = int(regex_match.captureCount())
        self.lastindex = self.__capture_count - 1 if self.__capture_count > 1 else None

    def group(self, *indexes):
        if len(indexes) == 0:
            indexes = (0,)
        values = []
        for index in indexes:
            if not isinstance(index, int):
                raise TypeError("HVY re match group indexes must be integers.")
            if index < 0 or index >= self.__capture_count:
                raise IndexError("no such group")
            value = self.__regex_match.captureAt(index)
            values.append(None if value is None else str(value))
        return values[0] if len(values) == 1 else tuple(values)

    def groups(self):
        return tuple(self.group(index) for index in range(1, self.__capture_count))

    def start(self, index=0):
        if index != 0:
            raise RuntimeError("HVY re match start() only supports group 0.")
        return int(self.__regex_match.index)

    def end(self, index=0):
        if index != 0:
            raise RuntimeError("HVY re match end() only supports group 0.")
        return int(self.__regex_match.end)

    def span(self, index=0):
        return (self.start(index), self.end(index))


class __HvyRePattern__:
    def __init__(self, pattern, flags=0):
        self.pattern = str(pattern)
        self.flags = int(flags or 0)

    def __hvy_js_flags__(self, global_search=False):
        flags = "u"
        if self.flags & __HvyReModule__.IGNORECASE:
            flags += "i"
        if self.flags & __HvyReModule__.MULTILINE:
            flags += "m"
        if self.flags & __HvyReModule__.DOTALL:
            flags += "s"
        return flags

    def search(self, string):
        source = str(string)
        found = __hvy_globals__.regex.exec(self.pattern, self.__hvy_js_flags__(), source)
        return None if not found.matched else __HvyReMatch__(found, source)

    def match(self, string):
        source = str(string)
        found = __hvy_globals__.regex.exec(self.pattern, self.__hvy_js_flags__(), source)
        if not found.matched or int(found.index) != 0:
            return None
        return __HvyReMatch__(found, source)

    def fullmatch(self, string):
        source = str(string)
        found = self.match(source)
        if found is None or found.end(0) != len(source):
            return None
        return found

    def findall(self, string):
        results = __hvy_globals__.regex.findall(self.pattern, self.__hvy_js_flags__(), str(string))
        out = []
        for index in range(0, int(results.count())):
            if results.isTuple(index):
                out.append(tuple(
                    None if results.valueAt(index, group_index) is None else str(results.valueAt(index, group_index))
                    for group_index in range(0, int(results.tupleCount(index)))
                ))
            else:
                value = results.valueAt(index, 0)
                out.append(None if value is None else str(value))
        return out

    def sub(self, repl, string, count=0):
        return str(__hvy_globals__.regex.sub(self.pattern, self.__hvy_js_flags__(), str(repl), str(string), int(count or 0)))

    def split(self, string, maxsplit=0):
        results = __hvy_globals__.regex.split(self.pattern, self.__hvy_js_flags__(), str(string), int(maxsplit or 0))
        return [str(results.valueAt(index)) for index in range(0, int(results.count()))]


class __HvyReModule__:
    IGNORECASE = 2
    I = IGNORECASE
    MULTILINE = 8
    M = MULTILINE
    DOTALL = 16
    S = DOTALL

    def compile(self, pattern, flags=0):
        return __HvyRePattern__(pattern, flags)

    def search(self, pattern, string, flags=0):
        return self.compile(pattern, flags).search(string)

    def match(self, pattern, string, flags=0):
        return self.compile(pattern, flags).match(string)

    def fullmatch(self, pattern, string, flags=0):
        return self.compile(pattern, flags).fullmatch(string)

    def findall(self, pattern, string, flags=0):
        return self.compile(pattern, flags).findall(string)

    def sub(self, pattern, repl, string, count=0, flags=0):
        return self.compile(pattern, flags).sub(repl, string, count)

    def split(self, pattern, string, maxsplit=0, flags=0):
        return self.compile(pattern, flags).split(string, maxsplit)


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
    'getattr': __hvy_getattr__,
    'hasattr': __hvy_hasattr__,
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
    'setattr': __hvy_setattr__,
    'sum': sum,
    'tuple': tuple,
    'delattr': __hvy_delattr__,
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
        'getattr': __hvy_getattr__,
        'globals': __hvy_safe_globals__,
        'hasattr': __hvy_hasattr__,
        'setattr': __hvy_setattr__,
        'delattr': __hvy_delattr__,
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
  exportRuleRecorder?: HvyPdfExportRuleRecorder;
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

  let stateRuntime: StateRuntime | null = null;
  try {
    stateRuntime = getActiveStateRuntime();
  } catch {
    // Standalone scripting tests and pre-bootstrap runs do not have an active state runtime.
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
    exportRuleRecorder: options.exportRuleRecorder,
    onMutationFlushed: () => {
      if (!stateRuntime) {
        return;
      }
      runWithStateRuntime(stateRuntime, () => {
        notifyDocumentMayHaveChanged(`script:${options.changeReason ?? 'run'}`, 'script', { authoritative: true });
      });
    },
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
