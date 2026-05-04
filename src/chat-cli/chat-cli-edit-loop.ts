import { requestProxyCompletion } from '../chat/chat';
import type { ChatMessage, ChatSettings, VisualDocument } from '../types';
import { createChatCliTraceRunId, writeChatCliCommandTrace, writeChatCliUserQueryTrace } from './chat-cli-dev-trace';
import { createChatCliInterface } from './chat-cli-interface';

const CHAT_CLI_MAX_STEPS = 30;
const CHAT_CLI_MAX_CONSECUTIVE_COMMAND_ERRORS = 3;
const CHAT_CLI_MESSAGE_HISTORY_MAX_CHARS = 500;
const CHAT_CLI_MESSAGE_HISTORY_MIN_MESSAGES = 5;

export interface ChatCliEditTurnResult {
  summary: string;
}

export async function runChatCliEditLoop(params: {
  settings: ChatSettings;
  document: VisualDocument;
  request: string;
  onMutation?: (group?: string) => void;
  onProgress?: (content: string) => void;
  signal?: AbortSignal;
}): Promise<ChatCliEditTurnResult> {
  const cli = createChatCliInterface(params.document);
  const traceRunId = createChatCliTraceRunId();
  await writeChatCliUserQueryTrace(traceRunId, params.request, params.signal);
  let conversation: ChatMessage[] = [
    {
      id: crypto.randomUUID(),
      role: 'user',
      content: params.request,
    },
  ];
  let consecutiveCommandErrors = 0;

  for (let step = 0; step < CHAT_CLI_MAX_STEPS; step += 1) {
    throwIfAborted(params.signal);
    conversation = compactChatCliConversation(conversation);
    const response = await requestProxyCompletion({
      settings: params.settings,
      messages: conversation,
      context: buildChatCliLoopContext(cli.snapshot(), params.request),
      formatInstructions: buildChatCliLoopFormatInstructions(),
      mode: 'document-edit',
      debugLabel: `chat-cli-edit:${step + 1}`,
      traceRunId,
      signal: params.signal,
    });
    const action = parseChatCliAction(response);
    if (action.kind === 'done') {
      params.onProgress?.('Finished CLI edit loop.');
      return { summary: action.summary || `Finished after ${step + 1} step${step === 0 ? '' : 's'}.` };
    }

    params.onProgress?.(`$ ${action.command}`);
    let result: Awaited<ReturnType<typeof cli.run>>;
    let commandFailed = false;
    try {
      result = await cli.run(action.command);
      consecutiveCommandErrors = 0;
    } catch (error) {
      const output = error instanceof Error ? error.message : String(error);
      await writeChatCliCommandTrace(traceRunId, action.command, output, params.signal);
      consecutiveCommandErrors += 1;
      if (consecutiveCommandErrors >= CHAT_CLI_MAX_CONSECUTIVE_COMMAND_ERRORS) {
        throw new Error(`Stopped after ${CHAT_CLI_MAX_CONSECUTIVE_COMMAND_ERRORS} failed CLI commands. Last error: ${output}`);
      }
      result = { command: action.command, cwd: cli.session.cwd, output, mutated: false };
      commandFailed = true;
    }
    if (!commandFailed) {
      await writeChatCliCommandTrace(traceRunId, action.command, result.output, params.signal);
    }
    if (result.mutated && !isSessionOnlyCommand(action.command)) {
      params.onMutation?.('chat-cli');
    }
    conversation = [
      ...conversation,
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: response,
      },
      {
        id: crypto.randomUUID(),
        role: 'user',
        content: formatCommandResultForModel(result.output),
      },
    ];
  }

  return { summary: `Stopped after ${CHAT_CLI_MAX_STEPS} CLI command steps. Send another request to continue.` };
}

function buildChatCliLoopContext(snapshot: ReturnType<ReturnType<typeof createChatCliInterface>['snapshot']>, request: string): string {
  return [
    'Task goal:',
    request,
    '',
    'Valid commands:',
    snapshot.commandSummary,
    '',
    'Persistent instructions:',
    snapshot.persistentInstructions,
    '',
    `Current directory: ${snapshot.cwd}`,
    '',
    'scratchpad.txt:',
    snapshot.scratchpad.trimEnd(),
  ].join('\n');
}

function buildChatCliLoopFormatInstructions(): string {
  return [
    'Return exactly one terminal command as plain text, or fenced in ```shell.',
    'To finish, return: done Short summary of what changed.',
    'Do not return prose, markdown explanations, or more than one command.',
  ].join('\n');
}

function parseChatCliAction(response: string): { kind: 'command'; command: string } | { kind: 'done'; summary: string } {
  const cleaned = normalizeCommandResponse(response);
  if (/^(done|finish|finished)\b/i.test(cleaned)) {
    return { kind: 'done', summary: cleaned.replace(/^(done|finish|finished)[:\s-]*/i, '').trim() };
  }
  const command = cleaned.replace(/^(?:[\w./~-]+)?\s*\$\s*/, '').trim();
  if (!command) {
    throw new Error('CLI edit response did not include a command or done summary.');
  }
  return { kind: 'command', command };
}

function normalizeCommandResponse(response: string): string {
  const withoutControlChars = response.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  const fenced = withoutControlChars.match(/^```(?:shell|bash|sh)?[ \t]*\n?([\s\S]*?)\s*```$/i);
  const unfenced = fenced ? fenced[1]?.trim() ?? '' : withoutControlChars;
  const inlineCode = unfenced.match(/^`([^`]+)`$/);
  const commandText = inlineCode ? inlineCode[1]?.trim() ?? '' : unfenced;
  return commandText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? '';
}

function formatCommandResultForModel(output: string): string {
  return output.trimEnd() || '(no output)';
}

function compactChatCliConversation(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length <= CHAT_CLI_MESSAGE_HISTORY_MIN_MESSAGES || countMessageChars(messages) <= CHAT_CLI_MESSAGE_HISTORY_MAX_CHARS) {
    return messages;
  }
  let startIndex = Math.max(0, messages.length - CHAT_CLI_MESSAGE_HISTORY_MIN_MESSAGES);
  while (startIndex > 0 && countMessageChars(messages.slice(startIndex)) < CHAT_CLI_MESSAGE_HISTORY_MAX_CHARS) {
    startIndex -= 1;
  }
  return truncateConversationMessages(messages.slice(startIndex), CHAT_CLI_MESSAGE_HISTORY_MAX_CHARS);
}

function countMessageChars(messages: ChatMessage[]): number {
  return messages.reduce((total, message) => total + message.content.length, 0);
}

function truncateConversationMessages(messages: ChatMessage[], maxChars: number): ChatMessage[] {
  let remainingOverage = countMessageChars(messages) - maxChars;
  if (remainingOverage <= 0) {
    return messages;
  }
  return messages.map((message) => {
    if (remainingOverage <= 0 || message.content.length <= 80) {
      return message;
    }
    const marker = '\n... truncated ...';
    const removable = Math.min(remainingOverage, message.content.length - 80);
    remainingOverage -= removable;
    return {
      ...message,
      content: `${message.content.slice(0, message.content.length - removable - marker.length).trimEnd()}${marker}`,
    };
  });
}

function isSessionOnlyCommand(command: string): boolean {
  return /\bscratchpad\.txt\b/.test(command);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
}
