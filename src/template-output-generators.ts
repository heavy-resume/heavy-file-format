import { requestProxyCompletion } from './chat/chat';
import type { ChatMessage, ChatSettings } from './types';
import type { HvyOutputGeneratorResponse } from './plugins/types';

export interface ResolveOutputGeneratorResponseParams {
  response: HvyOutputGeneratorResponse;
  settings: ChatSettings;
  signal?: AbortSignal;
  requestCompletion?: typeof requestProxyCompletion;
}

export async function resolveOutputGeneratorResponse(params: ResolveOutputGeneratorResponseParams): Promise<string> {
  const answer = cleanGeneratedText(params.response.answer);
  const prompt = cleanGeneratedText(params.response.prompt);
  if (prompt) {
    try {
      if (params.response.inputCharLimit && prompt.length > params.response.inputCharLimit) {
        throw new Error(`Generator prompt exceeds ${params.response.inputCharLimit} characters.`);
      }
      const completion = await (params.requestCompletion ?? requestProxyCompletion)({
        settings: params.settings,
        messages: [createPromptMessage('Generate the requested template field text.')],
        context: prompt,
        responseInstructions: params.response.responseInstructions?.trim() || 'Return only the generated text. Do not include Markdown fences, explanations, or labels.',
        mode: 'qa',
        debugLabel: 'template-output-generator',
        signal: params.signal,
      });
      const output = cleanGeneratedText(completion);
      if (params.response.outputCharLimit && output.length > params.response.outputCharLimit) {
        throw new Error(`Generator output exceeds ${params.response.outputCharLimit} characters.`);
      }
      if (output) {
        return output;
      }
    } catch (error) {
      if (!answer) {
        throw error;
      }
    }
  }
  if (answer) {
    if (params.response.outputCharLimit && answer.length > params.response.outputCharLimit) {
      throw new Error(`Generator output exceeds ${params.response.outputCharLimit} characters.`);
    }
    return answer;
  }
  throw new Error('Generator returned no text.');
}

function createPromptMessage(prompt: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: prompt,
  };
}

function cleanGeneratedText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
