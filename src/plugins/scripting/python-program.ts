import { SCRIPT_PUBLIC_DUNDER_NAMES, SCRIPT_RESTRICTED_BUILTIN_NAMES } from './script-source-policy';
import sandboxPrelude from './python/sandbox-prelude.py?raw';
import randomShim from './python/random-shim.py?raw';
import datetimeShim from './python/datetime-shim.py?raw';
import datetimeFormatShim from './python/datetime-format-shim.py?raw';
import timezoneShim from './python/timezone-shim.py?raw';
import reShim from './python/re-shim.py?raw';
import docArguments from './python/doc-arguments.py?raw';
import hostBridge from './python/host-bridge.py?raw';
import programRunner from './python/program-runner.py?raw';

export const SCRIPTING_LIBRARY_OPTIONS = ['random', 're', 'datetime', 'zoneinfo', 'tzlocal'] as const;
export type ScriptingLibraryName = (typeof SCRIPTING_LIBRARY_OPTIONS)[number];

// `zoneinfo` and `tzlocal` hand out tzinfo objects for the checked `datetime`
// classes, so every date/time library loads the same files.
const DATE_TIME_LIBRARY_FILES = [datetimeShim, datetimeFormatShim, timezoneShim];
const LIBRARY_FILES: Record<ScriptingLibraryName, readonly string[]> = {
  random: [randomShim],
  re: [reShim],
  datetime: DATE_TIME_LIBRARY_FILES,
  zoneinfo: DATE_TIME_LIBRARY_FILES,
  tzlocal: DATE_TIME_LIBRARY_FILES,
};

// Order matters: later files call functions and classes defined by earlier ones,
// and the runner executes the user script once everything else is defined.
// Library files are only compiled into programs that enable that library.
function getProgramFiles(libraries: readonly ScriptingLibraryName[]): string[] {
  const libraryFiles = new Set(libraries.flatMap((library) => LIBRARY_FILES[library]));
  return [sandboxPrelude, ...libraryFiles, docArguments, hostBridge, programRunner];
}

export function getScriptingTraceLabel(componentId?: string): string {
  const trimmed = componentId?.trim() ?? '';
  return trimmed.length > 0 ? trimmed.replace(/[<>]/g, '') : 'hvy-script';
}

// The Python program executed for each user script. It pulls the runtime,
// source and other per-run values out of the shared JS global, so the program
// text only depends on the enabled libraries and its compiled JavaScript can be
// reused across runs. It prefers sys.settrace() for line counting, and falls
// back to a JS-side source rewrite if tracing is unavailable in the current
// Brython build. The .py files stay free of template interpolation; the
// constants they need are assigned in this header.
export function buildPythonProgram(libraries: readonly ScriptingLibraryName[] = []): string {
  const header = [
    `__hvy_allowed_libraries__ = ${JSON.stringify(libraries)}`,
    `__hvy_restricted_builtin_names__ = ${JSON.stringify(SCRIPT_RESTRICTED_BUILTIN_NAMES)}`,
    `__hvy_public_dunder_names__ = ${JSON.stringify(SCRIPT_PUBLIC_DUNDER_NAMES)}`,
  ].join('\n');
  return [header, ...getProgramFiles(libraries)].join('\n\n');
}
