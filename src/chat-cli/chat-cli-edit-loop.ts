import { requestProxyCompletion } from '../chat/chat';
import type { ChatMessage, ChatSettings, VisualDocument } from '../types';
import { buildChatCliComponentHints } from './chat-cli-component-hints';
import { createChatCliTraceRunId, writeChatCliCommandTrace, writeChatCliUserQueryTrace } from './chat-cli-dev-trace';
import { createChatCliInterface } from './chat-cli-interface';
import { buildChatCliPersistentInstructions } from './chat-cli-instructions';

const CHAT_CLI_MAX_STEPS = 30;
const CHAT_CLI_MAX_CONSECUTIVE_COMMAND_ERRORS = 3;
const CHAT_CLI_MESSAGE_HISTORY_MAX_CHARS = 500;
const CHAT_CLI_MESSAGE_HISTORY_MIN_MESSAGES = 5;
const CHAT_CLI_RECENT_CHAT_CONTEXT_MAX_CHARS = 700;
const CHAT_CLI_COMMAND_NAMES = new Set(['cd', 'pwd', 'ls', 'cat', 'head', 'tail', 'nl', 'find', 'rg', 'rm', 'echo', 'sed', 'xargs', 'true', 'hvy', 'db-table', 'form']);

export interface ChatCliEditTurnResult {
  summary: string;
}

export async function runChatCliEditLoop(params: {
  settings: ChatSettings;
  document: VisualDocument;
  request: string;
  priorMessages?: ChatMessage[];
  onMutation?: (group?: string) => void;
  onProgress?: (content: string) => void;
  signal?: AbortSignal;
}): Promise<ChatCliEditTurnResult> {
  const cli = createChatCliInterface(params.document);
  const traceRunId = createChatCliTraceRunId();
  await writeChatCliUserQueryTrace(traceRunId, params.request, params.signal);
  const initialRootListing = await cli.run('ls /');
  await writeChatCliCommandTrace(traceRunId, initialRootListing.command, initialRootListing.output, params.signal);
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
      context: buildChatCliLoopContext(cli.snapshot(), params.request, params.priorMessages ?? [], initialRootListing),
      formatInstructions: buildChatCliLoopFormatInstructions(),
      mode: 'document-edit',
      debugLabel: `chat-cli-edit:${step + 1}`,
      traceRunId,
      signal: params.signal,
    });
    const action = parseChatCliAction(response);
    if (action.kind === 'invalid') {
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
          content: action.message,
        },
      ];
      continue;
    }
    if (action.kind === 'done') {
      params.onProgress?.('Finished CLI edit loop.');
      return { summary: action.summary || `Finished after ${step + 1} step${step === 0 ? '' : 's'}.` };
    }

    params.onProgress?.(`$ ${action.command}`);
    let result: Awaited<ReturnType<typeof cli.run>>;
    let stopAfterCommandError: Error | null = null;
    try {
      result = await cli.run(action.command);
      consecutiveCommandErrors = 0;
    } catch (error) {
      const output = error instanceof Error ? error.message : String(error);
      consecutiveCommandErrors += 1;
      if (consecutiveCommandErrors >= CHAT_CLI_MAX_CONSECUTIVE_COMMAND_ERRORS) {
        stopAfterCommandError = new Error(`Stopped after ${CHAT_CLI_MAX_CONSECUTIVE_COMMAND_ERRORS} failed CLI commands. Last error: ${output}`);
      }
      result = { command: action.command, cwd: cli.session.cwd, output, mutated: false };
    }
    const modelMessage = formatCommandResultForModel({
      output: result.output,
      hints: buildChatCliComponentHints({
        document: params.document,
        cwd: result.cwd,
        command: action.command,
      }),
      scratchpad: cli.snapshot().scratchpad,
    });
    await writeChatCliCommandTrace(traceRunId, action.command, result.output, params.signal, modelMessage);
    if (stopAfterCommandError) {
      throw stopAfterCommandError;
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
        content: modelMessage,
      },
    ];
  }

  return { summary: `Stopped after ${CHAT_CLI_MAX_STEPS} CLI command steps. Send another request to continue.` };
}

function buildChatCliLoopContext(
  snapshot: ReturnType<ReturnType<typeof createChatCliInterface>['snapshot']>,
  request: string,
  priorMessages: ChatMessage[],
  initialRootListing: { command: string; output: string }
): string {
  const recentChatContext = formatRecentChatContext(priorMessages);
  return [
    'Task goal:',
    request,
    ...(recentChatContext ? ['', 'Recent chat context:', recentChatContext] : []),
    '',
    'Valid commands:',
    snapshot.commandSummary,
    '',
    'Persistent instructions:',
    buildChatCliPersistentInstructions(),
    '',
    'Initial terminal output:',
    `> ${initialRootListing.command}`,
    formatCommandResultForModel(initialRootListing.output),
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

function parseChatCliAction(response: string): { kind: 'command'; command: string } | { kind: 'done'; summary: string } | { kind: 'invalid'; message: string } {
  const cleaned = normalizeCommandResponse(response);
  const command = cleaned.replace(/^(?:[\w./~-]+)?\s*\$\s*/, '').trim();
  if (/^(done|finish|finished)\b/i.test(command)) {
    return { kind: 'done', summary: command.replace(/^(done|finish|finished)[:\s-]*/i, '').trim() };
  }
  if (!command || command.startsWith('```') || isLikelyProseResponse(command)) {
    return { kind: 'invalid', message: 'Expected exactly one terminal command, or `done Short summary`. Do not return prose or markdown fences.' };
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

function formatCommandResultForModel(result: string | { output: string; hints?: string; scratchpad?: string }): string {
  if (typeof result === 'string') {
    return result.trimEnd() || '(no output)';
  }
  return [
    'result',
    result.output.trimEnd() || '(no output)',
    '',
    'What is your next command?',
    '',
    'hints',
    result.hints?.trimEnd() || '(none)',
    '',
    'scratchpad.txt',
    result.scratchpad?.trimEnd() || '(empty)',
  ].join('\n');
}

function formatRecentChatContext(messages: ChatMessage[]): string {
  const context = messages
    .filter((message) => !message.progress)
    .slice(-4)
    .map((message) => `${message.role}: ${message.content.trim()}`)
    .join('\n')
    .trim();
  return context.length <= CHAT_CLI_RECENT_CHAT_CONTEXT_MAX_CHARS
    ? context
    : `${context.slice(context.length - CHAT_CLI_RECENT_CHAT_CONTEXT_MAX_CHARS).trimStart()}`;
}

function isLikelyProseResponse(value: string): boolean {
  const firstWord = value.split(/\s+/, 1)[0]?.replace(/^\$\s*/, '') ?? '';
  return value.includes(' ') && !CHAT_CLI_COMMAND_NAMES.has(firstWord);
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
