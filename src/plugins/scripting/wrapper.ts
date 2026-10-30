import { loadBrython, getBrython } from './brython-loader';
import { instrumentPythonSource, stripPythonImports, wrapPythonSourceInFunction } from './python-source';
import {
  buildPythonProgram,
  getScriptingTraceLabel,
  SCRIPTING_LIBRARY_OPTIONS,
  type ScriptingLibraryName,
} from './python-program';
import { createScriptingRegexBridge, type HvyScriptingRegexBridge } from './regex-bridge';
import { cleanScriptingErrorDetail, summarizeScriptingError } from './script-error-text';
import { checkScriptSourcePolicy } from './script-source-policy';
import { createScriptingRuntime, type ScriptingDbApi, type ScriptingFormApi, type ScriptingRuntime } from './runtime';
import { createScriptingPluginsApi } from './plugin-apis';
import type { HvyPdfExportRuleRecorder } from '../../pdf-export/types';
import type { VisualDocument } from '../../types';
import type { HvyPluginHookChangeReason } from '../types';
import {
  buildScriptingVersionMismatchMessage,
  comparePluginVersions,
  getScriptingPluginVersion,
  SCRIPTING_PLUGIN_VERSION,
} from './version';
import { hasDocumentDatabaseTables } from '../database-table-targets';
import { notifyDocumentMayHaveChanged } from '../../document-change';
import { runPluginDocumentHooks } from '../hooks';
import { getActiveStateRuntime, runWithStateRuntime, type StateRuntime } from '../../state';
import {
  beginScriptCycleExecution,
  createScriptInvocationIdentity,
  type ScriptCycleExecution,
} from './cycle-coordinator';
import type { DatabaseChangeSnapshot } from '../../database-change-tracker';
import {
  isScriptingCallbackRuntimeDisposed,
  registerScriptingCallbackCleanup,
} from './callback-lifecycle';
import {
  normalizeBrythonHostArguments,
  normalizeBrythonHostValue,
} from './brython-host-values';

// Counter for unique runtime ids — each script run gets its own slot on the
// shared __HVY_SCRIPTING__ global so concurrent runs don't collide.
let runtimeCounter = 0;
let compiledProgramCounter = 0;

type HvyScriptingValueKind = 'array' | 'object' | 'bytes' | 'function' | 'other';

// Lets the Python argument helpers classify JavaScript-backed values a script
// holds (rows, plugin results, attachment bytes), which Python cannot inspect.
function getScriptingValueKind(value: unknown): HvyScriptingValueKind {
  if (typeof value === 'function') return 'function';
  if (!value || typeof value !== 'object') return 'other';
  if (Array.isArray(value)) return 'array';
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return 'bytes';
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? 'object' : 'other';
}

interface HvyScriptingGlobal {
  runtimes: Record<string, ScriptingRuntime>;
  sources: Record<string, string>;
  instrumentedSources: Record<string, string>;
  errors: Record<string, string | null>;
  results: Record<string, unknown>;
  callbacks: Record<string, () => void>;
  regex: HvyScriptingRegexBridge;
  sourcePolicyError(source: string): string | null;
  valueKind(value: unknown): HvyScriptingValueKind;
  compiledDefinitionSources: Map<string, string>;
  compiledDefinitions: Map<string, unknown>;
  activeRuntimeIds: Map<string, string>;
  compiledPrograms: Map<string, { source: string; scriptId: string; execute: () => unknown }>;
}

interface LoadedScriptingDbRuntime {
  api: ScriptingDbApi;
  settleUnfinishedTransaction(outcome: 'commit' | 'rollback'): boolean;
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
    window.__HVY_SCRIPTING__ = {
      runtimes: {},
      sources: {},
      instrumentedSources: {},
      errors: {},
      results: {},
      callbacks: {},
      regex: createScriptingRegexBridge(),
      sourcePolicyError: (source) => checkScriptSourcePolicy(source)?.message ?? null,
      valueKind: getScriptingValueKind,
      compiledDefinitionSources: new Map(),
      compiledDefinitions: new Map(),
      activeRuntimeIds: new Map(),
      compiledPrograms: new Map(),
    };
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
  if (!window.__HVY_SCRIPTING__.valueKind) {
    window.__HVY_SCRIPTING__.valueKind = getScriptingValueKind;
  }
  if (!window.__HVY_SCRIPTING__.compiledDefinitionSources) {
    window.__HVY_SCRIPTING__.compiledDefinitionSources = new Map();
  }
  if (!window.__HVY_SCRIPTING__.compiledDefinitions) {
    window.__HVY_SCRIPTING__.compiledDefinitions = new Map();
  }
  if (!window.__HVY_SCRIPTING__.activeRuntimeIds) {
    window.__HVY_SCRIPTING__.activeRuntimeIds = new Map();
  }
  if (!window.__HVY_SCRIPTING__.compiledPrograms) {
    window.__HVY_SCRIPTING__.compiledPrograms = new Map();
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
  if (hasDocumentDatabaseTables(document)) {
    return true;
  }
  return /\bdoc\s*\.\s*db\b|\bdb\b/u.test(source);
}


function executeCachedPythonProgram(
  scripting: HvyScriptingGlobal,
  cacheKey: string,
  runtimeId: string,
  source: string,
): void {
  let cached = scripting.compiledPrograms.get(cacheKey);
  if (!cached || cached.source !== source) {
    const brython = getBrython();
    if (typeof brython.python_to_js !== 'function') {
      throw new Error('Brython Python-to-JavaScript compiler API unavailable.');
    }
    const scriptId = `hvy_cached_${++compiledProgramCounter}`;
    const translated = brython.python_to_js(source, scriptId);
    cached = {
      source,
      scriptId,
      execute: new Function(`return ${translated}`) as () => unknown,
    };
    scripting.compiledPrograms.set(cacheKey, cached);
  }
  scripting.activeRuntimeIds.set(cacheKey, runtimeId);
  try {
    getBrython().imported[cached.scriptId] = {};
    cached.execute();
  } finally {
    scripting.activeRuntimeIds.delete(cacheKey);
  }
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
  renderOnMutation?: boolean;
  /** True when a trusted user event started this run; see beginScriptCycleExecution. */
  startedByUser?: boolean;
  form?: ScriptingFormApi;
  exportRuleRecorder?: HvyPdfExportRuleRecorder;
  injectedGlobals?: Record<string, unknown>;
  libraries?: readonly string[];
  databaseChanges?: DatabaseChangeSnapshot;
  onCallbackError?: (result: ScriptingRunResult) => void;
  cacheDefinition?: boolean;
}

export async function runUserScript(options: RunUserScriptOptions): Promise<ScriptingRunResult> {
  if (options.source.trim().length === 0) {
    return { ok: true, stepsExecuted: 0, stepBudget: options.maxLines ?? 100_000, linesExecuted: 0, toolCalls: 0 };
  }

  const policyIssue = checkScriptSourcePolicy(options.source);
  if (policyIssue) {
    const error = `${policyIssue.message} (line ${policyIssue.line}, column ${policyIssue.column})`;
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
    const activeStateRuntime = getActiveStateRuntime();
    if (activeStateRuntime.state.document === options.document) {
      stateRuntime = activeStateRuntime;
    }
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
      }, options.databaseChanges);
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
  let cycleExecution: ScriptCycleExecution | null = null;
  if (stateRuntime) {
    cycleExecution = beginScriptCycleExecution(
      stateRuntime,
      options.document,
      createScriptInvocationIdentity(options.componentId ?? 'hvy-script', options.source),
      { startedByUser: options.startedByUser }
    );
  }
  let renderCycleExecution = cycleExecution;
  let initialExecutionActive = true;
  let hasPluginCallbacks = false;
  let callbackResourcesActive = true;
  const callbackIdentity = createScriptInvocationIdentity(
    options.componentId ?? 'hvy-script',
    options.source
  );
  const releaseCallbackResources = () => {
    if (!callbackResourcesActive) return;
    callbackResourcesActive = false;
    scriptingDb?.dispose();
  };
  let callbackErrorReported = false;
  const reportCallbackError = (error: string) => {
    callbackErrorReported = true;
    options.onCallbackError?.({
      ok: false,
      error: summarizeScriptingError(error),
      errorDetail: cleanScriptingErrorDetail(error),
      stepsExecuted: runtime?.stats.stepsExecuted ?? 0,
      stepBudget: runtime?.stats.stepBudget ?? (options.maxLines ?? 100_000),
      linesExecuted: runtime?.stats.linesExecuted ?? 0,
      toolCalls: runtime?.stats.toolCalls ?? 0,
      logs: [...(runtime?.stats.logs ?? [])],
    });
  };
  runtime = createScriptingRuntime({
    document: options.document,
    previousDocument: options.previousDocument,
    maxLines: options.maxLines,
    changeReason: options.changeReason,
    renderOnMutation: options.renderOnMutation,
    form: options.form,
    db: scriptingDb?.api,
    plugins: createScriptingPluginsApi(options.document, {
      allowAsync: false,
      requireDocumentPermission: true,
      onMutation: () => runtime?.markMutated(),
      wrapCallback: (callback) => {
        hasPluginCallbacks = true;
        return (...args) => {
          if (!callbackResourcesActive) return undefined;
          if (
            stateRuntime
            && (
              isScriptingCallbackRuntimeDisposed(stateRuntime)
              || stateRuntime.state.document !== options.document
            )
          ) {
            releaseCallbackResources();
            return undefined;
          }
          const invokeCallback = () => {
            callbackErrorReported = false;
            let returned = false;
            try {
              const result = normalizeBrythonHostValue(callback(...normalizeBrythonHostArguments(args)));
              returned = true;
              return result;
            } finally {
              // A sandboxed callback is synchronous, so a transaction it leaves open can never
              // finish later: keep it when the callback succeeded, discard it when it failed.
              if (!initialExecutionActive) {
                try {
                  scriptingDb?.settleUnfinishedTransaction(returned && !callbackErrorReported ? 'commit' : 'rollback');
                } catch (error) {
                  reportCallbackError(error instanceof Error ? error.message : String(error));
                }
              }
            }
          };
          if (initialExecutionActive || !stateRuntime) {
            const result = invokeCallback();
            runtime?.doc.rerender();
            return result;
          }
          const callbackCycle = beginScriptCycleExecution(
            stateRuntime,
            options.document,
            callbackIdentity
          );
          const previousRenderCycle = renderCycleExecution;
          renderCycleExecution = callbackCycle;
          try {
            return runWithStateRuntime(stateRuntime, () => {
              const result = invokeCallback();
              runtime?.doc.rerender();
              return result;
            });
          } finally {
            renderCycleExecution = previousRenderCycle;
            callbackCycle.complete();
          }
        };
      },
    }),
    exportRuleRecorder: options.exportRuleRecorder,
    onMutationFlushed: () => {
      if (!stateRuntime) {
        return;
      }
      runWithStateRuntime(stateRuntime, () => {
        notifyDocumentMayHaveChanged(`script:${options.changeReason ?? 'run'}`, 'script', { authoritative: true });
        void runPluginDocumentHooks('script-edit');
      });
    },
    beforeMutationRender: () => renderCycleExecution?.beforeMutationRender(),
    onCallbackError: reportCallbackError,
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
  scriptElement.textContent = buildPythonProgram(
    runtimeId,
    options.componentId,
    options.injectedGlobals ?? {},
    libraries,
    options.cacheDefinition ? getScriptingTraceLabel(options.componentId) : undefined,
  );

  try {
    return await new Promise((resolve) => {
      scripting.callbacks[runtimeId] = () => {
        initialExecutionActive = false;
        try {
          scriptingDb?.settleUnfinishedTransaction(scripting.errors[runtimeId] ? 'rollback' : 'commit');
        } catch (error) {
          scripting.errors[runtimeId] = error instanceof Error ? error.message : String(error);
        }
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
        if (hasPluginCallbacks && stateRuntime) {
          registerScriptingCallbackCleanup(stateRuntime, releaseCallbackResources);
        } else {
          releaseCallbackResources();
        }
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
          if (options.cacheDefinition) {
            executeCachedPythonProgram(
              scripting,
              getScriptingTraceLabel(options.componentId),
              runtimeId,
              scriptElement.textContent || '',
            );
          } else {
            runScript(
              scriptElement,
              scriptElement.textContent || '',
              `hvy_script_${runtimeId}`,
              `${window.location.href || 'http://localhost/hvy-plugin'}#hvy-script-${runtimeId}`,
              true
            );
          }
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
  } finally {
    cycleExecution?.complete();
  }
}
