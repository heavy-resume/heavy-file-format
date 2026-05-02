import { requestChatCompletion } from './chat';
import { hasDocumentDbTables } from '../plugins/db-table';
import { runQaToolLoop } from '../ai-qa';
import type { ChatMessage, ChatSettings, VisualDocument } from '../types';
import type { VisualSection } from '../editor/types';
import { requestAiDocumentEditTurn } from '../ai-document-edit';
import { deserializeDocumentWithDiagnostics, wrapHvyFragmentAsDocument } from '../serialization';

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
  signal?: AbortSignal;
}): Promise<ChatTurnResult> {
  const nextMessages = appendUserChatMessage(params.messages, params.question);

  try {
    const answer = hasDocumentDbTables(params.document)
      ? await runQaToolLoop({
          settings: params.settings,
          document: params.document,
          messages: nextMessages,
          question: params.question,
          signal: params.signal,
        })
      : await requestChatCompletion({
          settings: params.settings,
          document: params.document,
          messages: nextMessages,
          signal: params.signal,
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

export type CopyChatMessageResult =
  | { ok: true; section: VisualSection }
  | { ok: false; error: string };

export function copyChatMessageToHvySection(params: {
  messages: ChatMessage[];
  messageId: string;
  sectionIdSeed?: string;
  title?: string;
}): CopyChatMessageResult {
  const message = params.messages.find((candidate) => candidate.id === params.messageId);
  if (!message) {
    return { ok: false, error: 'Message not found.' };
  }
  if (message.role !== 'assistant' || message.error) {
    return { ok: false, error: 'Only successful assistant messages can be copied.' };
  }
  if (!message.content.trim()) {
    return { ok: false, error: 'Message has no content to copy.' };
  }

  const wrapped = wrapHvyFragmentAsDocument(message.content, {
    sectionId: params.sectionIdSeed?.trim() || `ai-response-${Date.now().toString(36)}`,
    title: params.title?.trim() || 'AI response',
  });
  let parsed: ReturnType<typeof deserializeDocumentWithDiagnostics>;
  try {
    parsed = deserializeDocumentWithDiagnostics(wrapped, '.hvy');
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed to parse response as HVY.' };
  }
  const errors = parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  if (errors.length > 0) {
    return { ok: false, error: 'Could not parse AI response as HVY.' };
  }
  const section = parsed.document.sections[0];
  if (!section || parsed.document.sections.length !== 1) {
    return { ok: false, error: 'AI response must wrap into a single HVY section.' };
  }
  return { ok: true, section };
}

export async function requestDocumentEditChatTurn(params: {
  settings: ChatSettings;
  document: VisualDocument;
  messages: ChatMessage[];
  request: string;
  onMutation?: (group?: string) => void;
  onProgress?: (message: ChatMessage) => void;
  signal?: AbortSignal;
}): Promise<ChatTurnResult> {
  return requestAiDocumentEditTurn(params);
}
