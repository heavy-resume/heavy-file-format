import { traceAgentLoopEvent } from '../chat/chat';
import type { HvySemanticFilterProvider } from './types';

export function traceSemanticFilterEvent(
  request: Pick<Parameters<HvySemanticFilterProvider>[0], 'traceRunId' | 'signal'>,
  stage: string,
  payload: Record<string, unknown>
): void {
  if (!request.traceRunId) {
    return;
  }
  traceAgentLoopEvent({
    runId: request.traceRunId,
    phase: 'qa',
    type: 'client_event',
    payload: {
      stage,
      ...payload,
    },
    signal: request.signal,
  });
}
