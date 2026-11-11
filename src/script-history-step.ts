import { getActiveStateRuntime, state, type StateRuntime } from './state';
import type { VisualDocument } from './types';
import { closeDatabaseHistorySpan, isQueuedDatabaseHistoryCommandActive, openDatabaseHistorySpan } from './database-history-controller';
import { amendLastHistorySnapshot, ensureHistoryInitialized, recordScriptHistorySnapshot, snapshotStateMatchesLastHistoryEntry } from './history';
import { scheduleSessionStateSave } from './state-persistence';

// A user action can start a long chain of script runs, plugin callbacks, and database
// writes, separated by waits. They become one undo step: the step opens when that work
// starts and gathers every script and database change until five seconds after its first
// change, the next user action, or undo and redo. The step's history entry is written at
// its first change and moved forward by each later one, so closing a step records nothing
// and a user edit that closes it is never folded into it. Script work with no user action
// before it (load-time scripts) and the document hooks of a user edit fold into the entry
// they follow instead of adding one.
export const SCRIPT_HISTORY_STEP_WINDOW_MS = 5_000;

interface ScriptHistoryStep {
  document: VisualDocument;
  /** Fold changes into the newest entry instead of recording a new one. */
  amend: boolean;
  entryRecorded: boolean;
  databaseSpanOpen: boolean;
  firstChangeAt: number | null;
}

const openSteps = new WeakMap<StateRuntime, ScriptHistoryStep>();

/** Starts or joins the undo step for a script run. A run a user started always starts a step. */
export function beginScriptHistoryRun(options: { startedByUser?: boolean } = {}): void {
  if (state.isRestoring) return;
  if (!options.startedByUser && getJoinableStep()) return;
  openStepAfterClosing(!options.startedByUser && isBeforeFirstUndoStep());
}

/**
 * Starts or joins the undo step for a document hook run. When the newest entry holds the
 * state the hooks start from, the hooks' changes belong to that entry's step.
 */
export function beginReactiveScriptHistory(): void {
  if (state.isRestoring || state.reusableDefinitionEditModal || !Array.isArray(state.history) || getJoinableStep()) return;
  closeScriptHistoryStep();
  ensureHistoryInitialized();
  openStep(snapshotStateMatchesLastHistoryEntry());
}

/** Records a document change made by script work into its undo step. */
export function noteScriptHistoryChange(): void {
  if (state.isRestoring) return;
  // The change has already happened, so a step opened here starts from the newest entry.
  recordStepChange(getJoinableStep() ?? openStep(false));
}

/** Call before writing the live document's database, so the step can checkpoint it first. */
export function noteScriptHistoryDatabaseWrite(document: VisualDocument): void {
  if (state.isRestoring || isQueuedDatabaseHistoryCommandActive()) return;
  const step = getJoinableStep() ?? openStepAfterClosing(false);
  if (step.databaseSpanOpen) return;
  openDatabaseHistorySpan(document);
  step.databaseSpanOpen = true;
  // The span gave the database its after-write version, so the entry names it already.
  recordStepChange(step);
}

/** Ends the open step; its changes are already in its history entry. */
export function closeScriptHistoryStep(): void {
  const runtime = getActiveStateRuntime();
  if (!openSteps.has(runtime)) return;
  openSteps.delete(runtime);
  closeDatabaseHistorySpan();
}

function recordStepChange(step: ScriptHistoryStep): void {
  step.firstChangeAt ??= Date.now();
  if (step.amend || step.entryRecorded) {
    amendLastHistorySnapshot();
  } else {
    step.entryRecorded = recordScriptHistorySnapshot();
  }
  scheduleSessionStateSave(state);
}

function getJoinableStep(): ScriptHistoryStep | null {
  const step = openSteps.get(getActiveStateRuntime());
  if (!step) return null;
  // A replaced document has nothing for the step to join, and an expired step ends.
  if (step.document !== state.document
    || (step.firstChangeAt !== null && Date.now() - step.firstChangeAt >= SCRIPT_HISTORY_STEP_WINDOW_MS)) {
    closeScriptHistoryStep();
    return null;
  }
  return step;
}

// Changes made before this step and not yet recorded get an entry of their own first,
// so undoing the step returns to exactly the state it started from.
function openStepAfterClosing(amend: boolean): ScriptHistoryStep {
  closeScriptHistoryStep();
  if (!amend) recordScriptHistorySnapshot();
  return openStep(amend);
}

function openStep(amend: boolean): ScriptHistoryStep {
  ensureHistoryInitialized();
  const step: ScriptHistoryStep = { document: state.document, amend, entryRecorded: false, databaseSpanOpen: false, firstChangeAt: null };
  openSteps.set(getActiveStateRuntime(), step);
  return step;
}

function isBeforeFirstUndoStep(): boolean {
  return state.history.length <= 1 && state.future.length === 0;
}
