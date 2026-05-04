import { requestProxyCompletion } from '../chat/chat';
import { formatHvyCliLintDiff, type HvyCliLintIssue, runHvyCliLinter } from '../cli-core/document-linter';
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
const CHAT_CLI_COMMAND_NAMES = new Set(['cd', 'pwd', 'ls', 'cat', 'head', 'tail', 'nl', 'find', 'rg', 'grep', 'sort', 'uniq', 'wc', 'tr', 'xargs', 'rm', 'echo', 'sed', 'true', 'hvy', 'db-table', 'form', 'ask']);

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
  onReasoningSummary?: (summary: string) => void;
  signal?: AbortSignal;
}): Promise<ChatCliEditTurnResult> {
  const cli = createChatCliInterface(params.document);
  const traceRunId = createChatCliTraceRunId();
  await writeChatCliUserQueryTrace(traceRunId, params.request, params.signal);
  const initialRootListing = await cli.run('ls /');
  await writeChatCliCommandTrace(traceRunId, initialRootListing.command, initialRootListing.output, params.signal);
  const initialStructure = await cli.run('hvy request_structure --collapse');
  await writeChatCliCommandTrace(traceRunId, initialStructure.command, initialStructure.output, params.signal);
  let lintIssues = await runHvyCliLinter(params.document);
  const initialLint = await cli.run('hvy lint');
  await writeChatCliCommandTrace(traceRunId, initialLint.command, initialLint.output, params.signal);
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
      context: buildChatCliLoopContext(cli.snapshot(), params.request, params.priorMessages ?? [], [initialRootListing, initialStructure, initialLint]),
      formatInstructions: buildChatCliLoopFormatInstructions(),
      mode: 'document-edit',
      debugLabel: `chat-cli-edit:${step + 1}`,
      traceRunId,
      onReasoningSummary: params.onReasoningSummary,
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
    if (action.kind === 'ask') {
      return { summary: action.question };
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
      lintDiff: await updateLintDiff(params.document, (nextIssues) => {
        const diff = formatHvyCliLintDiff(lintIssues, nextIssues);
        lintIssues = nextIssues;
        return diff;
      }),
      hints: buildChatCliComponentHints({
        document: params.document,
        cwd: result.cwd,
        command: action.command,
        output: result.output,
      }),
      scratchpad: formatScratchpadForModel(cli.snapshot()),
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
  initialOutputs: Array<{ command: string; output: string }>
): string {
  const taskContext = resolveChatCliTaskContext(request, priorMessages);
  const recentChatContext = formatRecentChatContext(priorMessages);
  return [
    'Task goal:',
    taskContext.goal,
    ...(taskContext.latestReply ? ['', 'Latest user reply:', taskContext.latestReply] : []),
    ...(recentChatContext ? ['', 'Recent chat context:', recentChatContext] : []),
    '',
    'Valid commands:',
    snapshot.commandSummary,
    '',
    'Persistent instructions:',
    buildChatCliPersistentInstructions(),
    '',
    'Initial terminal output:',
    ...initialOutputs.flatMap((output) => [`> ${output.command}`, formatCommandResultForModel(output.output), '']),
    '',
    `Current directory: ${snapshot.cwd}`,
    '',
    'scratchpad.txt:',
    formatScratchpadForModel(snapshot),
  ].join('\n');
}

function resolveChatCliTaskContext(request: string, priorMessages: ChatMessage[]): { goal: string; latestReply: string | null } {
  const messages = priorMessages.filter((message) => !message.progress);
  const lastMessage = messages.at(-1);
  if (!lastMessage || lastMessage.role !== 'assistant' || !isClarificationQuestion(lastMessage.content)) {
    return { goal: request, latestReply: null };
  }

  let firstQuestionIndex = messages.length - 1;
  while (
    firstQuestionIndex >= 2 &&
    messages[firstQuestionIndex - 1]?.role === 'user' &&
    messages[firstQuestionIndex - 2]?.role === 'assistant' &&
    isClarificationQuestion(messages[firstQuestionIndex - 2]?.content ?? '')
  ) {
    firstQuestionIndex -= 2;
  }

  for (let index = firstQuestionIndex - 1; index >= 0; index -= 1) {
    const candidate = messages[index];
    if (candidate?.role === 'user' && candidate.content.trim()) {
      return { goal: candidate.content.trim(), latestReply: request };
    }
  }

  return { goal: request, latestReply: null };
}

function isClarificationQuestion(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.endsWith('?') || /^(?:should|do|does|did|would|could|can|which|what|where|when|who|how)\b/i.test(trimmed);
}

function buildChatCliLoopFormatInstructions(): string {
  return [
    'Return exactly one terminal command as plain text, or fenced in ```shell.',
    'To finish, return: done Short summary of what changed.',
    'To ask for clarification, return: ask Question for the user.',
    'Do not return prose, markdown explanations, or more than one command.',
  ].join('\n');
}

function parseChatCliAction(response: string): { kind: 'command'; command: string } | { kind: 'done'; summary: string } | { kind: 'ask'; question: string } | { kind: 'invalid'; message: string } {
  const cleaned = normalizeCommandResponse(response);
  const command = cleaned.replace(/^(?:[\w./~-]+)?\s*\$\s*/, '').trim();
  if (/^(done|finish|finished)\b/i.test(command)) {
    return { kind: 'done', summary: command.replace(/^(done|finish|finished)[:\s-]*/i, '').trim() };
  }
  if (/^ask\b/i.test(command)) {
    const question = command.replace(/^ask[:\s-]*/i, '').trim();
    return question
      ? { kind: 'ask', question }
      : { kind: 'invalid', message: 'Expected `ask Question for the user`.' };
  }
  if (!command || command.startsWith('```') || isLikelyProseResponse(command)) {
    return { kind: 'invalid', message: 'Expected exactly one terminal command, `ask Question`, or `done Short summary`. Do not return prose or markdown fences.' };
  }
  return { kind: 'command', command };
}

function normalizeCommandResponse(response: string): string {
  const withoutControlChars = response.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  const fenced = withoutControlChars.match(/^```(?:shell|bash|sh)?[ \t]*\n?([\s\S]*?)\s*```$/i);
  const unfenced = fenced ? fenced[1]?.trim() ?? '' : withoutControlChars;
  const inlineCode = unfenced.match(/^`([^`]+)`$/);
  const commandText = inlineCode ? inlineCode[1]?.trim() ?? '' : unfenced;
  return commandText.trim();
}

function formatCommandResultForModel(result: string | { output: string; lintDiff?: string; hints?: string; scratchpad?: string }): string {
  if (typeof result === 'string') {
    return result.trimEnd() || '(no output)';
  }
  return [
    'result',
    result.output.trimEnd() || '(no output)',
    ...('lintDiff' in result && result.lintDiff?.trim()
      ? ['', result.lintDiff.trimEnd()]
      : []),
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

function formatScratchpadForModel(snapshot: Pick<ReturnType<ReturnType<typeof createChatCliInterface>['snapshot']>, 'scratchpad' | 'scratchpadEdited' | 'scratchpadCommandsSinceEdit'>): string {
  const commands = snapshot.scratchpadCommandsSinceEdit;
  const ageLine = snapshot.scratchpadEdited
    ? `last edited ${commands.length} command${commands.length === 1 ? '' : 's'} ago`
    : 'last edited never';
  const recentCommandLines = snapshot.scratchpadEdited && commands.length > 0 && commands.length <= 3
    ? ['', 'commands since last edit:', ...commands.map((command) => `> ${command}`)]
    : [];
  return [
    ageLine,
    ...recentCommandLines,
    '',
    snapshot.scratchpad.trimEnd() || '(empty)',
  ].join('\n');
}

async function updateLintDiff(document: VisualDocument, update: (issues: HvyCliLintIssue[]) => string): Promise<string> {
  return update(await runHvyCliLinter(document));
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
