import { getActiveStateRuntime, runWithStateRuntime, type StateRuntime } from '../../../state';
import type { VisualDocument } from '../../../types';

const INPUT_QUIET_MS = 150;
const MAX_INPUT_WAIT_MS = 500;

interface PendingVisibility {
  document: VisualDocument;
  firstInputAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

interface VisibilitySchedule {
  pending: PendingVisibility | null;
  running: boolean;
}

const schedules = new WeakMap<StateRuntime, WeakMap<ParentNode, VisibilitySchedule>>();

function getSchedule(root: ParentNode): VisibilitySchedule {
  const runtime = getActiveStateRuntime();
  let roots = schedules.get(runtime);
  if (!roots) {
    roots = new WeakMap();
    schedules.set(runtime, roots);
  }
  let schedule = roots.get(root);
  if (!schedule) {
    schedule = { pending: null, running: false };
    roots.set(root, schedule);
  }
  return schedule;
}

/** An immediate render already evaluates visibility against the current document. */
export function cancelScheduledButtonVisibility(root: ParentNode): void {
  const schedule = getSchedule(root);
  // Inputs arriving during an async pass still need a subsequent evaluation.
  if (schedule.running) return;
  if (schedule.pending?.timer) clearTimeout(schedule.pending.timer);
  schedule.pending = null;
}

/** Coalesce input bursts, but keep visibility live during continuous typing. */
export function scheduleButtonVisibilityScripts(root: ParentNode): void {
  const runtime = getActiveStateRuntime();
  const schedule = getSchedule(root);
  if (schedule.pending?.document !== runtime.state.document) {
    cancelScheduledButtonVisibility(root);
    schedule.pending = { document: runtime.state.document, firstInputAt: performance.now(), timer: null };
  }
  armTimer();

  function armTimer(): void {
    const pending = schedule.pending;
    if (!pending) return;
    if (pending.timer) clearTimeout(pending.timer);
    if (schedule.running) return;
    const delay = Math.max(0, Math.min(INPUT_QUIET_MS, MAX_INPUT_WAIT_MS - (performance.now() - pending.firstInputAt)));
    pending.timer = setTimeout(() => { void flush(); }, delay);
  }

  async function flush(): Promise<void> {
    const pending = schedule.pending;
    schedule.pending = null;
    if (!pending || pending.document !== runtime.state.document || !root.isConnected) return;
    schedule.running = true;
    try {
      const { runButtonVisibilityScripts } = await import('./button-actions');
      if (pending.document !== runtime.state.document || !root.isConnected) return;
      await runWithStateRuntime(runtime, () => runButtonVisibilityScripts(root));
    } finally {
      schedule.running = false;
      armTimer();
    }
  }
}
