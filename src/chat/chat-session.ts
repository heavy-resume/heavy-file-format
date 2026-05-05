import { requestChatCompletion } from './chat';
import { hasDocumentDbTables } from '../plugins/db-table';
import { runQaToolLoop } from '../ai-qa';
import type { ChatMessage, ChatSettings, ChatTokenUsage, ChatWorkState, VisualDocument } from '../types';
import type { VisualSection } from '../editor/types';
import { deserializeDocumentWithDiagnostics, wrapHvyFragmentAsDocument } from '../serialization';
import { runChatCliEditLoop, type ChatCliSelectedComponentFocus } from '../chat-cli/chat-cli-edit-loop';

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
  if (isLikelyViewerChangeRequest(params.question)) {
    return {
      messages: [
        ...nextMessages,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: 'I can’t change the document from Viewer mode. Switch to AI mode or Editor mode to make changes.',
        },
      ],
      error: null,
    };
  }
  let reasoningSummary = '';
  let tokenUsage: ChatTokenUsage | null = null;

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
          onReasoningSummary: (summary) => {
            reasoningSummary = summary;
          },
          onTokenUsage: (usage) => {
            tokenUsage = usage;
          },
          signal: params.signal,
        });
    return {
      messages: [
        ...nextMessages,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: answer,
          ...(reasoningSummary ? { reasoning: reasoningSummary } : {}),
          ...(tokenUsage ? { tokenUsage } : {}),
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

function isLikelyViewerChangeRequest(question: string): boolean {
  const normalized = question.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (/^(how|what|why|where|when|who)\b/.test(normalized)) {
    return false;
  }
  return /\b(add|create|insert|edit|change|update|modify|remove|delete|replace|rename|move|reorder|finish|complete|implement|wire|wiring|rig|rigging)\b/.test(normalized)
    && /\b(document|resume|hvy|sections?|components?|tables?|forms?|skills?|tools?|text|title|header|this)\b/.test(normalized);
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
  selectedComponent?: ChatCliSelectedComponentFocus;
  onMutation?: (group?: string) => void;
  onProgress?: (message: ChatMessage) => void;
  signal?: AbortSignal;
}): Promise<ChatTurnResult> {
  const nextMessages = appendUserChatMessage(params.messages, params.request);
  const workMessageId = crypto.randomUUID();
  const workState: ChatWorkState = {
    status: 'running',
    details: [],
    reasoning: [],
  };
  const emitProgress = (message: ChatMessage): void => {
    if (message.content === 'Finished CLI edit loop.') {
      return;
    }
    const shouldRenderBefore = shouldRenderChatWorkProgress(workState, message);
    updateChatWorkState(workState, message);
    if (!shouldRenderBefore && workState.details.length === 0 && workState.reasoning.length === 0) {
      return;
    }
    params.onProgress?.({
      id: workMessageId,
      role: 'assistant',
      content: formatChatWorkMessageContent(workState),
      progress: true,
      ...(workState.tokenUsage ? { tokenUsage: workState.tokenUsage } : {}),
      work: cloneChatWorkState(workState),
    });
  };

  try {
    const result = await runChatCliEditLoop({
      settings: params.settings,
      document: params.document,
      request: params.request,
      priorMessages: params.messages,
      selectedComponent: params.selectedComponent,
      onMutation: params.onMutation,
      onProgress: (content) =>
        emitProgress({
          id: crypto.randomUUID(),
          role: 'assistant',
          content,
          progress: true,
        }),
      onReasoningSummary: (summary) =>
        emitProgress({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: 'Reasoning summary',
          reasoning: summary,
          progress: true,
        }),
      onTokenUsage: (usage) =>
        emitProgress({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: 'Token usage',
          tokenUsage: usage,
          progress: true,
        }),
      signal: params.signal,
    });
    return {
      messages: [
        ...nextMessages,
        {
          id: workMessageId,
          role: 'assistant',
          content: result.summary,
          work: {
            ...cloneChatWorkState(workState),
            status: 'done',
          },
          ...(result.tokenUsage ? { tokenUsage: result.tokenUsage } : {}),
        },
      ],
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CLI document edit failed.';
    return {
      messages: [
        ...nextMessages,
        {
          id: workMessageId,
          role: 'assistant',
          content: message,
          error: true,
          work: {
            ...cloneChatWorkState(workState),
            status: 'error',
          },
        },
      ],
      error: message,
    };
  }
}

function shouldRenderChatWorkProgress(work: ChatWorkState, message: ChatMessage): boolean {
  if (message.tokenUsage && !message.reasoning && message.content === 'Token usage') {
    return work.details.length > 0 || work.reasoning.length > 0;
  }
  return !!message.reasoning || !!message.content.trim() || work.details.length > 0 || work.reasoning.length > 0;
}

function updateChatWorkState(work: ChatWorkState, message: ChatMessage): void {
  if (message.reasoning) {
    work.reasoning.push(message.reasoning);
    return;
  }
  if (message.tokenUsage) {
    work.tokenUsage = message.tokenUsage;
    return;
  }
  const content = message.content.trim();
  if (!content) {
    return;
  }
  if (content.startsWith('$ ')) {
    work.lastCommand = content.replace(/^\$\s*/, '').trim();
    work.details.push(content);
    return;
  }
  work.details.push(content);
}

function formatChatWorkMessageContent(work: ChatWorkState): string {
  if (work.lastCommand) {
    return `$ ${work.lastCommand}`;
  }
  const latestDetail = work.details.at(-1);
  return latestDetail ?? 'Working...';
}

function cloneChatWorkState(work: ChatWorkState): ChatWorkState {
  return {
    status: work.status,
    ...(work.lastCommand ? { lastCommand: work.lastCommand } : {}),
    details: [...work.details],
    reasoning: [...work.reasoning],
    ...(work.tokenUsage ? { tokenUsage: work.tokenUsage } : {}),
  };
}
