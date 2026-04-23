import { requestChatCompletion } from './chat';
import type { ChatMessage, ChatSettings, VisualDocument } from './types';
import { requestAiDocumentEditTurn } from './ai-document-edit';

export interface ChatTurnResult {
  messages: ChatMessage[];
  error: string | null;
}

export function appendUserChatMessage(messages: ChatMessage[], question: string): ChatMessage[] {
  return [
    ...messages,
    {
      id: crypto.randomUUID(),
      role: 'user',
      content: question,
    },
  ];
}

export async function requestChatTurn(params: {
  settings: ChatSettings;
  document: VisualDocument;
  messages: ChatMessage[];
  question: string;
}): Promise<ChatTurnResult> {
  const nextMessages = appendUserChatMessage(params.messages, params.question);

  try {
    const answer = await requestChatCompletion({
      settings: params.settings,
      document: params.document,
      messages: nextMessages,
    });
    return {
      messages: [
        ...nextMessages,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: answer,
        },
      ],
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Chat request failed.';
    return {
      messages: [
        ...nextMessages,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: message,
          error: true,
        },
      ],
      error: message,
    };
  }
}

export async function requestDocumentEditChatTurn(params: {
  settings: ChatSettings;
  document: VisualDocument;
  messages: ChatMessage[];
  request: string;
  onMutation?: (group?: string) => void;
}): Promise<ChatTurnResult> {
  return requestAiDocumentEditTurn(params);
}
