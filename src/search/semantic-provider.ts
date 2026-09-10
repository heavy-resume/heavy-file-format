import { requestProxyCompletion } from '../chat/chat';
import { state } from '../state';
import type { HvySemanticFilterProvider } from './types';
import { traceSemanticFilterEvent } from './semantic-trace';

export { parseSemanticFilterResponse } from './semantic-response';

export const chatSemanticFilterProvider: HvySemanticFilterProvider = async (request) => {
  traceSemanticFilterEvent(request, 'semantic_filter_request', {
    prompt: request.prompt,
    documentTitle: request.documentTitle,
    windowIndex: request.windowIndex,
    windowCount: request.windowCount,
    windowLabel: request.windowLabel,
    candidateBudget: request.candidateBudget,
    candidates: request.candidates,
  });
  const messages: Parameters<typeof requestProxyCompletion>[0]['messages'] = [{
    id: 'semantic-filter',
    role: 'user',
    content: 'Select the relevant candidates now.',
  }];
  if (request.repair) {
    messages.push(
      {
        id: 'semantic-filter-invalid-response',
        role: 'assistant',
        content: request.repair.previousResponse,
      },
      {
        id: 'semantic-filter-repair',
        role: 'user',
        content: request.repair.instruction,
      },
    );
  }
  const output = await requestProxyCompletion({
    settings: state.chat.settings,
    messages,
    context: request.instructionPrompt,
    responseInstructions: [
      'Follow the semantic filter selection contract in the context exactly.',
      'Include the first-pass notes and review step requested by the context.',
      'End with one JSON array containing exactly the candidate IDs that survived review.',
    ].join('\n'),
    mode: 'qa',
    debugLabel: 'semantic-filter',
    traceRunId: request.traceRunId,
    signal: request.signal,
  });
  traceSemanticFilterEvent(request, 'semantic_filter_raw_response', {
    prompt: request.prompt,
    windowIndex: request.windowIndex,
    windowCount: request.windowCount,
    windowLabel: request.windowLabel,
    output,
  });
  return output;
};
