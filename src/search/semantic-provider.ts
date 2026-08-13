import { requestProxyCompletion } from '../chat/chat';
import { state } from '../state';
import type { HvySemanticFilterProvider } from './types';
import { traceSemanticFilterEvent } from './semantic-trace';
import { parseSemanticFilterResponse } from './semantic-response';

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
  const output = await requestProxyCompletion({
    settings: state.chat.settings,
    messages: [{
      id: 'semantic-filter',
      role: 'user',
      content: 'Select the relevant candidates now.',
    }],
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
  try {
    const matches = parseSemanticFilterResponse(output, new Set(request.candidates.map((candidate) => candidate.candidateId)));
    traceSemanticFilterEvent(request, 'semantic_filter_parsed_matches', {
      prompt: request.prompt,
      windowIndex: request.windowIndex,
      windowCount: request.windowCount,
      windowLabel: request.windowLabel,
      matches,
    });
    return matches;
  } catch (error) {
    traceSemanticFilterEvent(request, 'semantic_filter_parse_error', {
      prompt: request.prompt,
      windowIndex: request.windowIndex,
      windowCount: request.windowCount,
      windowLabel: request.windowLabel,
      output,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};
