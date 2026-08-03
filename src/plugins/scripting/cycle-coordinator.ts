import type { StateRuntime } from '../../state';
import type { VisualDocument } from '../../types';

export const SCRIPT_CYCLE_RENDER_BUDGET = 25;
export const SCRIPT_REPEAT_LIMIT = 10;
export const SCRIPT_WATCHDOG_WINDOW_MS = 2_000;

const MAX_INVOCATION_HISTORY = 128;
const MAX_RENDER_HISTORY = 64;
const MAX_PATTERN_LENGTH = 8;
const PATTERN_REPETITIONS = 3;

interface ScriptInvocationRecord {
  id: number;
  identity: string;
  startedAt: number;
  completedAt: number | null;
  mutationRenderCount: number;
}

interface ScriptRenderRecord {
  identity: string;
  at: number;
}

interface ScriptDocumentWatchdog {
  invocations: ScriptInvocationRecord[];
  mutationRenders: ScriptRenderRecord[];
}

interface ScriptCycleChain {
  document: VisualDocument;
  mutationRenderCount: number;
  pendingExecutions: number;
  settleTimer: ReturnType<typeof setTimeout> | null;
}

interface ScriptCycleCoordinator {
  activeChain: ScriptCycleChain | null;
  nextInvocationId: number;
  watchdogsByDocument: WeakMap<VisualDocument, ScriptDocumentWatchdog>;
}

export interface ScriptCycleExecution {
  beforeMutationRender(): void;
  complete(): void;
}

const coordinatorsByRuntime = new WeakMap<StateRuntime, ScriptCycleCoordinator>();

function getCoordinator(runtime: StateRuntime): ScriptCycleCoordinator {
  let coordinator = coordinatorsByRuntime.get(runtime);
  if (!coordinator) {
    coordinator = {
      activeChain: null,
      nextInvocationId: 0,
      watchdogsByDocument: new WeakMap(),
    };
    coordinatorsByRuntime.set(runtime, coordinator);
  }
  return coordinator;
}

function getWatchdog(coordinator: ScriptCycleCoordinator, document: VisualDocument): ScriptDocumentWatchdog {
  let watchdog = coordinator.watchdogsByDocument.get(document);
  if (!watchdog) {
    watchdog = { invocations: [], mutationRenders: [] };
    coordinator.watchdogsByDocument.set(document, watchdog);
  }
  return watchdog;
}

function sourceFingerprint(source: string): string {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function createScriptInvocationIdentity(componentId: string, source: string): string {
  return `${componentId.trim() || 'hvy-script'}@${sourceFingerprint(source)}`;
}

function formatCycleError(identity: string, detail: string): string {
  return `Script-driven render cycle stopped at "${identity}": ${detail}.`;
}

function findRepeatedPattern(identities: string[]): string[] | null {
  const maxLength = Math.min(MAX_PATTERN_LENGTH, Math.floor(identities.length / PATTERN_REPETITIONS));
  for (let length = 2; length <= maxLength; length += 1) {
    const pattern = identities.slice(-length);
    if (new Set(pattern).size < 2) continue;
    let repeats = true;
    for (let repetition = 2; repetition <= PATTERN_REPETITIONS; repetition += 1) {
      const start = identities.length - length * repetition;
      if (start < 0 || !pattern.every((identity, index) => identities[start + index] === identity)) {
        repeats = false;
        break;
      }
    }
    if (repeats) return pattern;
  }
  return null;
}

function assertWatchdogAllowsRender(
  watchdog: ScriptDocumentWatchdog,
  identity: string,
  now: number
): void {
  watchdog.mutationRenders = watchdog.mutationRenders.filter(
    (record) => now - record.at <= SCRIPT_WATCHDOG_WINDOW_MS
  );
  const prospective = [...watchdog.mutationRenders, { identity, at: now }];
  const sameIdentityCount = prospective.filter((record) => record.identity === identity).length;
  if (sameIdentityCount >= SCRIPT_REPEAT_LIMIT) {
    throw new Error(formatCycleError(
      identity,
      `the same script requested ${sameIdentityCount} mutation renders within ${SCRIPT_WATCHDOG_WINDOW_MS} ms`
    ));
  }
  const repeatedPattern = findRepeatedPattern(prospective.map((record) => record.identity));
  if (repeatedPattern) {
    throw new Error(formatCycleError(
      identity,
      `the mutation-render pattern ${repeatedPattern.join(' -> ')} repeated ${PATTERN_REPETITIONS} times`
    ));
  }
  if (prospective.length > SCRIPT_CYCLE_RENDER_BUDGET) {
    throw new Error(formatCycleError(
      identity,
      `more than ${SCRIPT_CYCLE_RENDER_BUDGET} mutation renders occurred within ${SCRIPT_WATCHDOG_WINDOW_MS} ms`
    ));
  }
  watchdog.mutationRenders = prospective.slice(-MAX_RENDER_HISTORY);
}

export function beginScriptCycleExecution(
  runtime: StateRuntime,
  document: VisualDocument,
  identity: string
): ScriptCycleExecution {
  const coordinator = getCoordinator(runtime);
  const watchdog = getWatchdog(coordinator, document);
  const invocation: ScriptInvocationRecord = {
    id: ++coordinator.nextInvocationId,
    identity,
    startedAt: Date.now(),
    completedAt: null,
    mutationRenderCount: 0,
  };
  watchdog.invocations.push(invocation);
  if (watchdog.invocations.length > MAX_INVOCATION_HISTORY) {
    watchdog.invocations.splice(0, watchdog.invocations.length - MAX_INVOCATION_HISTORY);
  }

  let chain = coordinator.activeChain?.document === document ? coordinator.activeChain : null;
  if (chain?.settleTimer) {
    clearTimeout(chain.settleTimer);
    chain.settleTimer = null;
  }
  if (chain) chain.pendingExecutions += 1;

  let completed = false;
  return {
    beforeMutationRender: () => {
      if (!chain) {
        chain = coordinator.activeChain?.document === document ? coordinator.activeChain : null;
        if (chain?.settleTimer) {
          clearTimeout(chain.settleTimer);
          chain.settleTimer = null;
        }
        if (chain) {
          chain.pendingExecutions += 1;
        } else {
          chain = {
            document,
            mutationRenderCount: 0,
            pendingExecutions: 1,
            settleTimer: null,
          };
          coordinator.activeChain = chain;
        }
      }
      if (chain.mutationRenderCount >= SCRIPT_CYCLE_RENDER_BUDGET) {
        throw new Error(formatCycleError(
          identity,
          `the causal chain reached ${SCRIPT_CYCLE_RENDER_BUDGET} mutation renders`
        ));
      }
      assertWatchdogAllowsRender(watchdog, identity, Date.now());
      chain.mutationRenderCount += 1;
      invocation.mutationRenderCount += 1;
    },
    complete: () => {
      if (completed) return;
      completed = true;
      invocation.completedAt = Date.now();
      if (!chain) return;
      chain.pendingExecutions = Math.max(0, chain.pendingExecutions - 1);
      if (chain.pendingExecutions !== 0 || chain.settleTimer) return;
      const settlingChain = chain;
      chain.settleTimer = setTimeout(() => {
        if (coordinator.activeChain === settlingChain && settlingChain.pendingExecutions === 0) {
          coordinator.activeChain = null;
        }
        settlingChain.settleTimer = null;
      }, 0);
    },
  };
}
