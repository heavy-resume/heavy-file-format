import type { JsonObject } from '../../hvy/types';
import type { VisualDocument } from '../../types';
import { getAttachment, removeAttachment, setAttachment } from '../../attachments';
import { executeDocumentEditToolByName } from '../../ai-document-edit';
import { state, getRefreshReaderPanels, getRenderApp } from '../../state';

// JS-side `doc` runtime exposed to the user's Python script. Every method is
// synchronous from Python's point of view; mutations on the visual document
// trigger a re-render once the script run finishes.
//
// Loose typing on purpose: the only stable contract here is "tool name + args
// dict". Changes to the AI tool surface flow through automatically.

export interface ScriptingRuntimeStats {
  toolCalls: number;
  linesExecuted: number;
}

export interface ScriptingRuntime {
  doc: ScriptingDocApi;
  stats: ScriptingRuntimeStats;
  step(): void;
  setLineBudget(maxLines: number): void;
}

interface ScriptingDocApi {
  tool: (name: string, args?: Record<string, unknown>) => string;
  header: ScriptingHeaderApi;
  attachments: ScriptingAttachmentsApi;
  form: ScriptingFormApi;
  rerender: () => void;
}

interface ScriptingHeaderApi {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  remove(key: string): void;
  keys(): string[];
}

interface ScriptingAttachmentsApi {
  list(): string[];
  read(id: string): Uint8Array | null;
  write(id: string, bytes: Uint8Array | ArrayBuffer | number[], meta?: JsonObject): void;
  remove(id: string): void;
}

export interface ScriptingFormOption {
  label: string;
  value: string;
}

export interface ScriptingFormApi {
  get_value(name: string): unknown;
  set_value(name: string, value: unknown): void;
  get_values(): Record<string, unknown>;
  set_options(name: string, options: ScriptingFormOption[]): void;
  get_options(name: string): ScriptingFormOption[];
  set_error(name: string, message: string): void;
  clear_error(name: string): void;
}

export interface ScriptingRuntimeOptions {
  maxLines?: number;
  document: VisualDocument;
  form?: ScriptingFormApi;
}

function createUnavailableFormApi(): ScriptingFormApi {
  const fail = () => {
    throw new Error('doc.form is only available while running a form plugin script.');
  };
  return {
    get_value: fail,
    set_value: fail,
    get_values: fail,
    set_options: fail,
    get_options: fail,
    set_error: fail,
    clear_error: fail,
  };
}

export function createScriptingRuntime(options: ScriptingRuntimeOptions): ScriptingRuntime {
  const stats: ScriptingRuntimeStats = { toolCalls: 0, linesExecuted: 0 };
  let lineBudget = options.maxLines ?? 100_000;
  let mutated = false;

  const onMutation = () => {
    mutated = true;
  };

  const flushIfMutated = () => {
    if (!mutated) return;
    mutated = false;
    try {
      getRefreshReaderPanels()();
    } catch {
      // Reader panel may not be initialized yet (during pre-first-render execution).
    }
    try {
      getRenderApp()();
    } catch {
      // renderApp may not be ready yet during the very first load.
    }
  };

  const doc: ScriptingDocApi = {
    tool: (name, args) => {
      stats.toolCalls += 1;
      const result = executeDocumentEditToolByName(name, args ?? {}, options.document, onMutation);
      return result;
    },
    header: {
      get: (key) => options.document.meta[key],
      set: (key, value) => {
        (options.document.meta as Record<string, unknown>)[key] = value as never;
        mutated = true;
      },
      remove: (key) => {
        if (key in options.document.meta) {
          delete (options.document.meta as Record<string, unknown>)[key];
          mutated = true;
        }
      },
      keys: () => Object.keys(options.document.meta),
    },
    attachments: {
      list: () => options.document.attachments.map((entry) => entry.id),
      read: (id) => {
        const attachment = getAttachment(options.document, id);
        return attachment ? Uint8Array.from(attachment.bytes) : null;
      },
      write: (id, bytes, meta) => {
        const previous = getAttachment(options.document, id);
        const normalized =
          bytes instanceof Uint8Array
            ? Uint8Array.from(bytes)
            : bytes instanceof ArrayBuffer
              ? new Uint8Array(bytes)
              : Uint8Array.from(bytes as number[]);
        setAttachment(
          options.document,
          id,
          { ...(previous?.meta ?? {}), ...(meta ?? {}) },
          normalized
        );
        mutated = true;
      },
      remove: (id) => {
        if (getAttachment(options.document, id)) {
          removeAttachment(options.document, id);
          mutated = true;
        }
      },
    },
    form: options.form ?? createUnavailableFormApi(),
    rerender: flushIfMutated,
  };

  // Bind only when state is initialized to avoid throwing during tests that
  // don't construct a full app.
  if (state && state.document === options.document) {
    // doc already references state.document via the closure.
  }

  return {
    doc,
    stats,
    step: () => {
      stats.linesExecuted += 1;
      if (stats.linesExecuted > lineBudget) {
        throw new Error(
          `Scripting plugin exceeded its line budget (${lineBudget}). Add fewer steps or raise the budget.`
        );
      }
    },
    setLineBudget: (maxLines: number) => {
      lineBudget = Math.max(1, Math.floor(maxLines));
    },
  };
}
