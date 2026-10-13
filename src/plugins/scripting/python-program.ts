import { SCRIPT_PUBLIC_DUNDER_NAMES, SCRIPT_RESTRICTED_BUILTIN_NAMES } from './script-source-policy';
import sandboxPrelude from './python/sandbox-prelude.py?raw';
import randomShim from './python/random-shim.py?raw';
import datetimeShim from './python/datetime-shim.py?raw';
import reShim from './python/re-shim.py?raw';
import hostBridge from './python/host-bridge.py?raw';
import programRunner from './python/program-runner.py?raw';

export const SCRIPTING_LIBRARY_OPTIONS = ['random', 're', 'datetime'] as const;
export type ScriptingLibraryName = (typeof SCRIPTING_LIBRARY_OPTIONS)[number];

// Order matters: later files call functions and classes defined by earlier ones,
// and the runner executes the user script once everything else is defined.
const PROGRAM_FILES = [sandboxPrelude, randomShim, datetimeShim, reShim, hostBridge, programRunner];

export function getScriptingTraceLabel(componentId?: string): string {
  const trimmed = componentId?.trim() ?? '';
  return trimmed.length > 0 ? trimmed.replace(/[<>]/g, '') : 'hvy-script';
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

// The Python program executed for each user script. It pulls the runtime and
// source out of the shared JS global, prefers sys.settrace() for line
// counting, and falls back to a JS-side source rewrite if tracing is
// unavailable in the current Brython build. The .py files stay free of
// template interpolation; per-run values are assigned in this header.
export function buildPythonProgram(
  runtimeId: string,
  componentId?: string,
  injectedGlobals: Record<string, unknown> = {},
  libraries: readonly string[] = [],
  compiledDefinitionKey?: string,
): string {
  const allowedLibraries = libraries.filter((name): name is ScriptingLibraryName => (SCRIPTING_LIBRARY_OPTIONS as readonly string[]).includes(name));
  const injectedEntries = Object.entries(injectedGlobals)
    .filter(([name]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
    .map(([name, value]) => `${JSON.stringify(name)}: ${toPythonLiteral(value)}`);
  const header = [
    `__hvy_static_runtime_id__ = ${compiledDefinitionKey ? 'None' : JSON.stringify(runtimeId)}`,
    `__hvy_definition_key__ = ${compiledDefinitionKey ? JSON.stringify(compiledDefinitionKey) : 'None'}`,
    `__hvy_trace_filename__ = ${JSON.stringify(`<${getScriptingTraceLabel(componentId)}>`)}`,
    `__hvy_allowed_libraries__ = ${JSON.stringify(allowedLibraries)}`,
    `__hvy_restricted_builtin_names__ = ${JSON.stringify(SCRIPT_RESTRICTED_BUILTIN_NAMES)}`,
    `__hvy_public_dunder_names__ = ${JSON.stringify(SCRIPT_PUBLIC_DUNDER_NAMES)}`,
    `__hvy_injected_globals__ = {${injectedEntries.join(', ')}}`,
  ].join('\n');
  return [header, ...PROGRAM_FILES].join('\n\n');
}
