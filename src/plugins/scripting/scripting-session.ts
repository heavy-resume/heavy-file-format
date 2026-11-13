import { getActiveStateRuntime } from '../../state';
import type { VisualDocument } from '../../types';

// Ephemeral state for one open document: the `session` global in scripts and
// `session` on plugin contexts. It is never serialized, never part of the dirty
// check, and never in undo history, so undo and redo leave it as it is.

export type ScriptingSessionValue = null | boolean | number | string | ScriptingSessionValue[] | { [key: string]: ScriptingSessionValue };

/** JSON values only. Values are copied on the way in and out, so changing a value read from the store changes nothing until it is set again. */
export interface ScriptingSessionState {
  get(key: string): ScriptingSessionValue | undefined;
  set(key: string, value: unknown): void;
  has(key: string): boolean;
  remove(key: string): void;
  keys(): string[];
  clear(): void;
}

export interface ScriptingSession {
  readonly id: string;
  readonly startTimeMs: number;
  readonly state: ScriptingSessionState;
}

// Keyed by the owner of the open document: its AppState in the app, or the
// document itself for runs without one. Undo replaces `state.document`, so the
// document object cannot own the session in the app.
const sessions = new WeakMap<object, ScriptingSession>();

export function getDocumentScriptingSession(document: VisualDocument): ScriptingSession {
  const owner = getSessionOwner(document);
  let session = sessions.get(owner);
  if (!session) {
    session = createScriptingSession();
    sessions.set(owner, session);
  }
  return session;
}

/** Ends the owner's session; the next use starts a new one. Call when a different document is loaded. */
export function endScriptingSession(owner: object): void {
  sessions.delete(owner);
}

function getSessionOwner(document: VisualDocument): object {
  try {
    const runtime = getActiveStateRuntime();
    return runtime.state.document === document ? runtime.state : document;
  } catch {
    // Standalone scripting tests and pre-bootstrap runs do not have an active state runtime.
    return document;
  }
}

function createScriptingSession(): ScriptingSession {
  const values = new Map<string, ScriptingSessionValue>();
  return {
    id: crypto.randomUUID(),
    startTimeMs: Date.now(),
    state: {
      get: (key) => {
        const value = values.get(String(key));
        return value === undefined ? undefined : copySessionValue(value, String(key));
      },
      set: (key, value) => {
        values.set(String(key), copySessionValue(value, String(key)));
      },
      has: (key) => values.has(String(key)),
      remove: (key) => {
        values.delete(String(key));
      },
      keys: () => [...values.keys()],
      clear: () => values.clear(),
    },
  };
}

function copySessionValue(value: unknown, path: string): ScriptingSessionValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`session.state["${path}"] must be a finite number.`);
    return value;
  }
  if (Array.isArray(value)) return value.map((entry, index) => copySessionValue(entry, `${path}/${index}`));
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const copy: { [key: string]: ScriptingSessionValue } = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      copy[key] = copySessionValue(entry, `${path}/${key}`);
    }
    return copy;
  }
  throw new TypeError(`session.state["${path}"] must be a JSON value, got ${value === undefined ? 'undefined' : typeof value}.`);
}
