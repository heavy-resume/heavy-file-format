import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  beginScriptCycleExecution,
  createScriptInvocationIdentity,
  SCRIPT_CYCLE_RENDER_BUDGET,
  SCRIPT_REPEAT_LIMIT,
  SCRIPT_WATCHDOG_WINDOW_MS,
} from '../src/plugins/scripting/cycle-coordinator';
import type { StateRuntime } from '../src/state';
import type { VisualDocument } from '../src/types';

function createRuntime(): StateRuntime {
  return {} as StateRuntime;
}

function createDocument(): VisualDocument {
  return {} as VisualDocument;
}

function mutationRender(runtime: StateRuntime, document: VisualDocument, identity: string): void {
  const execution = beginScriptCycleExecution(runtime, document, identity);
  execution.beforeMutationRender();
  execution.complete();
}

afterEach(() => vi.useRealTimers());

describe('sandbox script cycle coordinator', () => {
  test('expected result: repeated non-mutating scripts never consume the render budget', () => {
    vi.useFakeTimers();
    const runtime = createRuntime();
    const document = createDocument();
    for (let index = 0; index < 100; index += 1) {
      beginScriptCycleExecution(runtime, document, `visibility-${index}`).complete();
    }

    expect(() => mutationRender(runtime, document, 'mutating-script')).not.toThrow();
  });

  test('expected result: the same mutating script is stopped when it repeats rapidly', () => {
    vi.useFakeTimers();
    const runtime = createRuntime();
    const document = createDocument();
    for (let index = 1; index < SCRIPT_REPEAT_LIMIT; index += 1) {
      mutationRender(runtime, document, 'repeating-script');
    }

    expect(() => mutationRender(runtime, document, 'repeating-script')).toThrow(
      new RegExp(`same script requested ${SCRIPT_REPEAT_LIMIT} mutation renders`)
    );
  });

  test('expected result: an alternating multi-component render loop is detected', () => {
    vi.useFakeTimers();
    const runtime = createRuntime();
    const document = createDocument();
    for (const identity of ['component-a', 'component-b', 'component-a', 'component-b', 'component-a']) {
      mutationRender(runtime, document, identity);
    }

    expect(() => mutationRender(runtime, document, 'component-b')).toThrow(/component-a -> component-b/);
  });

  test('expected result: an irregular causal chain stops at the render budget', () => {
    vi.useFakeTimers();
    const runtime = createRuntime();
    const document = createDocument();
    for (let index = 0; index < SCRIPT_CYCLE_RENDER_BUDGET; index += 1) {
      mutationRender(runtime, document, `component-${index}`);
    }

    expect(() => mutationRender(runtime, document, 'offending-component')).toThrow(/causal chain reached/);
  });

  test('expected result: rolling repetition suspicion expires after a quiet interval', () => {
    vi.useFakeTimers();
    const runtime = createRuntime();
    const document = createDocument();
    for (let index = 1; index < SCRIPT_REPEAT_LIMIT; index += 1) {
      mutationRender(runtime, document, 'later-safe-script');
    }
    vi.advanceTimersByTime(SCRIPT_WATCHDOG_WINDOW_MS + 1);

    expect(() => mutationRender(runtime, document, 'later-safe-script')).not.toThrow();
  });

  test('expected result: document and state runtimes have isolated watchdog histories', () => {
    vi.useFakeTimers();
    const runtime = createRuntime();
    const document = createDocument();
    for (let index = 1; index < SCRIPT_REPEAT_LIMIT; index += 1) {
      mutationRender(runtime, document, 'shared-identity');
    }

    expect(() => mutationRender(runtime, createDocument(), 'shared-identity')).not.toThrow();
    expect(() => mutationRender(createRuntime(), document, 'shared-identity')).not.toThrow();
  });

  test('expected result: invocation identity distinguishes source revisions', () => {
    expect(createScriptInvocationIdentity('component', 'return True')).not.toBe(
      createScriptInvocationIdentity('component', 'return False')
    );
    expect(createScriptInvocationIdentity('component', 'return True')).toBe(
      createScriptInvocationIdentity('component', 'return True')
    );
  });
});
