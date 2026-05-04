import { requestProxyCompletion } from '../chat/chat';
import { formatHvyCliLintDiff, type HvyCliLintIssue, runHvyCliLinter } from '../cli-core/document-linter';
import type { ChatMessage, ChatSettings, ChatTokenUsage, VisualDocument } from '../types';
import { buildChatCliComponentHints } from './chat-cli-component-hints';
import { createChatCliTraceRunId, writeChatCliCommandTrace, writeChatCliUserQueryTrace } from './chat-cli-dev-trace';
import { createChatCliInterface } from './chat-cli-interface';
import { buildChatCliPersistentInstructions } from './chat-cli-instructions';

const CHAT_CLI_MAX_STEPS = 30;
const CHAT_CLI_MAX_CONSECUTIVE_COMMAND_ERRORS = 3;
const CHAT_CLI_MESSAGE_HISTORY_MAX_CHARS = 6000;
const CHAT_CLI_MESSAGE_HISTORY_MIN_MESSAGES = 10;
const CHAT_CLI_PRIOR_MESSAGE_LIMIT = 10;
const CHAT_CLI_MODEL_OUTPUT_MAX_LINES = 100;
const CHAT_CLI_MODEL_OUTPUT_MAX_LINE_WIDTH = 400;
const CHAT_CLI_COMMAND_NAMES = new Set(['cd', 'pwd', 'ls', 'cat', 'head', 'tail', 'nl', 'find', 'rg', 'grep', 'sort', 'uniq', 'wc', 'tr', 'xargs', 'cp', 'rm', 'echo', 'sed', 'true', 'hvy', 'db-table', 'form', 'ask']);

export interface ChatCliEditTurnResult {
  summary: string;
  tokenUsage?: ChatTokenUsage;
}

export async function runChatCliEditLoop(params: {
  settings: ChatSettings;
  document: VisualDocument;
  request: string;
  priorMessages?: ChatMessage[];
  onMutation?: (group?: string) => void;
  onProgress?: (content: string) => void;
  onReasoningSummary?: (summary: string) => void;
  onTokenUsage?: (usage: ChatTokenUsage) => void;
  signal?: AbortSignal;
}): Promise<ChatCliEditTurnResult> {
  const cli = createChatCliInterface(params.document);
  const traceRunId = createChatCliTraceRunId();
  await writeChatCliUserQueryTrace(traceRunId, params.request, params.signal);
  const initialRootListing = await cli.run('ls /');
  await writeChatCliCommandTrace(traceRunId, initialRootListing.command, initialRootListing.output, params.signal);
  const initialHvyHelp = await cli.run('hvy --help');
  await writeChatCliCommandTrace(traceRunId, initialHvyHelp.command, initialHvyHelp.output, params.signal);
  const initialStructure = await cli.run('hvy request_structure --collapse');
  await writeChatCliCommandTrace(traceRunId, initialStructure.command, initialStructure.output, params.signal);
  let lintIssues = await runHvyCliLinter(params.document);
  const initialLint = await cli.run('hvy lint');
  await writeChatCliCommandTrace(traceRunId, initialLint.command, initialLint.output, params.signal);
  const initialIntent = await cli.run(`hvy find-intent ${quoteChatCliShellArg(params.request)} --max 5`);
  await writeChatCliCommandTrace(traceRunId, initialIntent.command, initialIntent.output, params.signal);
  const priorConversation = selectChatCliPriorMessages(params.priorMessages ?? []);
  const initialOutputs = [initialRootListing, initialHvyHelp, initialStructure, initialLint, initialIntent];
  let conversation: ChatMessage[] = [
    ...priorConversation,
    {
      id: crypto.randomUUID(),
      role: 'user',
      content: params.request,
    },
    ...formatInitialChatCliCommandMessages(initialOutputs, cli.snapshot()),
  ];
  let consecutiveCommandErrors = 0;
  let latestTokenUsage: ChatTokenUsage | null = null;
  let urgency = 0;

  for (let step = 0; step < CHAT_CLI_MAX_STEPS; step += 1) {
    throwIfAborted(params.signal);
    if (step > 0) {
      conversation = compactChatCliConversation(conversation);
    }
    const response = await requestProxyCompletion({
      settings: params.settings,
      messages: conversation,
      context: buildChatCliLoopContext(cli.snapshot(), params.request, params.priorMessages ?? [], priorConversation, urgency),
      formatInstructions: buildChatCliLoopFormatInstructions(),
      mode: 'document-edit',
      debugLabel: `chat-cli-edit:${step + 1}`,
      traceRunId,
      onReasoningSummary: params.onReasoningSummary,
      onTokenUsage: (usage) => {
        latestTokenUsage = usage;
        params.onTokenUsage?.(usage);
      },
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
      return {
        summary: action.summary || `Finished after ${step + 1} step${step === 0 ? '' : 's'}.`,
        ...(latestTokenUsage ? { tokenUsage: latestTokenUsage } : {}),
      };
    }
    if (action.kind === 'ask') {
      return { summary: action.question, ...(latestTokenUsage ? { tokenUsage: latestTokenUsage } : {}) };
    }

    const commandOutputs: Array<{ command: string; output: string }> = [];
    const commandHints: string[] = [];
    const commands = action.commands;
    const outputLineBudget = Math.max(1, Math.floor(CHAT_CLI_MODEL_OUTPUT_MAX_LINES / commands.length));
    let stopAfterCommandError: Error | null = null;
    let mutated = false;
    let traceOutput = '';
    for (let commandIndex = 0; commandIndex < commands.length; commandIndex += 1) {
      const command = commands[commandIndex] ?? '';
      params.onProgress?.(commands.length > 1 ? `$ [${commandIndex + 1}/${commands.length}] ${command}` : `$ ${command}`);
      let result: Awaited<ReturnType<typeof cli.run>>;
      try {
        result = await cli.run(command);
        consecutiveCommandErrors = 0;
        const commandMutatedDocument = result.mutated && !isSessionOnlyCommand(command);
        urgency = updateChatCliUrgency(urgency, commandMutatedDocument);
        mutated = mutated || commandMutatedDocument;
      } catch (error) {
        const output = error instanceof Error ? error.message : String(error);
        consecutiveCommandErrors += 1;
        if (consecutiveCommandErrors >= CHAT_CLI_MAX_CONSECUTIVE_COMMAND_ERRORS) {
          stopAfterCommandError = new Error(`Stopped after ${CHAT_CLI_MAX_CONSECUTIVE_COMMAND_ERRORS} failed CLI commands. Last error: ${output}`);
        }
        result = { command, cwd: cli.session.cwd, output, mutated: false };
      }
      traceOutput = result.output;
      commandOutputs.push({
        command,
        output: formatOutputForModel(result.output, outputLineBudget),
      });
      const hints = buildChatCliComponentHints({
        document: params.document,
        cwd: result.cwd,
        command,
        output: result.output,
      });
      if (hints.trim()) {
        commandHints.push(hints);
      }
      if (stopAfterCommandError) {
        break;
      }
    }
    const modelMessage = formatCommandResultForModel({
      output: formatBatchCommandOutput(commandOutputs),
      lintDiff: await updateLintDiff(params.document, (nextIssues) => {
        const diff = formatHvyCliLintDiff(lintIssues, nextIssues);
        lintIssues = nextIssues;
        return diff;
      }),
      hints: formatBatchHints(commandHints),
      scratchpad: formatScratchpadForModel(cli.snapshot()),
      urgency: formatChatCliUrgency(urgency),
    });
    await writeChatCliCommandTrace(
      traceRunId,
      commands.length === 1 ? commands[0] ?? '' : commands.join('\n'),
      commands.length === 1 ? traceOutput : formatBatchCommandOutput(commandOutputs),
      params.signal,
      modelMessage
    );
    if (stopAfterCommandError) {
      throw stopAfterCommandError;
    }
    if (mutated) {
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

  return {
    summary: `Stopped after ${CHAT_CLI_MAX_STEPS} CLI command steps. Send another request to continue.`,
    ...(latestTokenUsage ? { tokenUsage: latestTokenUsage } : {}),
  };
}

function buildChatCliLoopContext(
  snapshot: ReturnType<ReturnType<typeof createChatCliInterface>['snapshot']>,
  request: string,
  priorMessages: ChatMessage[],
  priorConversation: ChatMessage[],
  urgency: number
): string {
  const taskContext = resolveChatCliTaskContext(request, priorMessages);
  const omittedMessageCount = priorMessages.filter((message) => !message.progress).length - priorConversation.length;
  return [
    'Task goal:',
    taskContext.goal,
    ...(omittedMessageCount > 0 ? ['', `Earlier chat omitted: ${omittedMessageCount} message${omittedMessageCount === 1 ? '' : 's'}.`] : []),
    '',
    `Current directory: ${snapshot.cwd}`,
    '',
    'scratchpad.txt:',
    formatScratchpadForModel(snapshot),
    '',
    'urgency:',
    formatChatCliUrgency(urgency),
    '',
    'Valid commands:',
    snapshot.commandSummary,
    '',
    'Persistent instructions:',
    buildChatCliPersistentInstructions(),
  ].join('\n');
}

function formatInitialChatCliCommandMessages(
  outputs: Array<{ command: string; output: string }>,
  snapshot: ReturnType<ReturnType<typeof createChatCliInterface>['snapshot']>
): ChatMessage[] {
  return outputs.flatMap((output, index) => [
    {
      id: crypto.randomUUID(),
      role: 'assistant' as const,
      content: formatChatCliCommandForModel(output.command),
    },
    {
      id: crypto.randomUUID(),
      role: 'user' as const,
      content: index === outputs.length - 1
        ? formatCommandResultForModel({
            output: output.output,
            hints: '',
            scratchpad: formatScratchpadForModel(snapshot),
            urgency: formatChatCliUrgency(0),
          })
        : formatCommandResultForModel(output.output),
    },
  ]);
}

function formatChatCliCommandForModel(command: string): string {
  return `\`\`\`shell\n${command}\n\`\`\``;
}

function quoteChatCliShellArg(value: string): string {
  return `"${value.replace(/["\\]/g, (match) => `\\${match}`)}"`;
}

function selectChatCliPriorMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .filter((message) => !message.progress)
    .slice(-CHAT_CLI_PRIOR_MESSAGE_LIMIT)
    .map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      ...(message.error ? { error: message.error } : {}),
    }));
}

function resolveChatCliTaskContext(request: string, priorMessages: ChatMessage[]): { goal: string } {
  const messages = priorMessages.filter((message) => !message.progress);
  const lastMessage = messages.at(-1);
  if (!lastMessage || lastMessage.role !== 'assistant' || !isClarificationQuestion(lastMessage.content)) {
    return { goal: request };
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
      return { goal: candidate.content.trim() };
    }
  }

  return { goal: request };
}

function isClarificationQuestion(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.endsWith('?') || /^(?:should|do|does|did|would|could|can|which|what|where|when|who|how)\b/i.test(trimmed);
}

function buildChatCliLoopFormatInstructions(): string {
  return [
    'Return terminal command(s) as plain text, or fenced in ```shell. Multiple ```shell blocks are allowed and run in order.',
    'To finish, return only: done Short summary of what changed.',
    'To ask for clarification, return: ask Question for the user.',
    'Do not include done with commands. Run commands, inspect the result, then finish in a later response.',
    'Do not return prose or markdown explanations.',
  ].join('\n');
}

function parseChatCliAction(response: string): { kind: 'command'; commands: string[] } | { kind: 'done'; summary: string } | { kind: 'ask'; question: string } | { kind: 'invalid'; message: string } {
  const fencedCommands = extractFencedShellCommands(response);
  if (fencedCommands.kind === 'invalid') {
    return { kind: 'invalid', message: fencedCommands.message };
  }
  if (fencedCommands.commands.length > 0) {
    return { kind: 'command', commands: fencedCommands.commands };
  }
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
    return { kind: 'invalid', message: 'Expected terminal command(s), `ask Question`, or `done Short summary`. Do not return prose.' };
  }
  return { kind: 'command', commands: [command] };
}

function extractFencedShellCommands(response: string): { kind: 'ok'; commands: string[] } | { kind: 'invalid'; message: string } {
  const trimmed = response.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  const fenceRegex = /```(?:shell|bash|sh)?[ \t]*\n?([\s\S]*?)\s*```/gi;
  const commands: string[] = [];
  let lastIndex = 0;
  let outside = '';
  for (const match of trimmed.matchAll(fenceRegex)) {
    outside += trimmed.slice(lastIndex, match.index);
    lastIndex = (match.index ?? 0) + match[0].length;
    commands.push(...splitShellBlockCommands(match[1] ?? ''));
  }
  outside += trimmed.slice(lastIndex);
  if (commands.length === 0) {
    return { kind: 'ok', commands };
  }
  const outsideCommand = normalizeCommandResponse(outside);
  const hasTrailingDone = /^(done|finish|finished)\b/i.test(outsideCommand);
  if (outside.trim() && !hasTrailingDone) {
    return { kind: 'invalid', message: 'Expected only terminal command fences, `ask Question`, or `done Short summary`. Do not add prose around command fences.' };
  }
  return { kind: 'ok', commands };
}

function splitShellBlockCommands(source: string): string[] {
  const commands: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaping = false;
  let heredocMarker: string | null = null;
  for (const line of source.replace(/\r\n?/g, '\n').split('\n')) {
    const trimmedLine = line.trim();
    if (!quote && !heredocMarker && !current.trim() && (!trimmedLine || trimmedLine.startsWith('#'))) {
      continue;
    }
    current = current ? `${current}\n${line}` : line;
    if (heredocMarker) {
      if (trimmedLine === heredocMarker) {
        commands.push(current.trim());
        current = '';
        heredocMarker = null;
      }
      continue;
    }
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index] ?? '';
      if (escaping) {
        escaping = false;
        continue;
      }
      if (char === '\\') {
        escaping = true;
        continue;
      }
      if ((char === '"' || char === "'") && (!quote || quote === char)) {
        quote = quote ? null : char;
      }
    }
    if (!quote) {
      const heredoc = line.match(/<<\s*['"]?([A-Za-z0-9_.-]+)['"]?\s*$/);
      if (heredoc) {
        heredocMarker = heredoc[1] ?? null;
        continue;
      }
    }
    if (!quote && current.trim()) {
      commands.push(current.trim());
      current = '';
    }
  }
  if (quote) {
    commands.push(current.trim());
    return commands;
  }
  if (current.trim()) {
    commands.push(current.trim());
  }
  return commands;
}

function normalizeCommandResponse(response: string): string {
  const withoutControlChars = response.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  const fenced = withoutControlChars.match(/^```(?:shell|bash|sh)?[ \t]*\n?([\s\S]*?)\s*```$/i);
  const unfenced = fenced ? fenced[1]?.trim() ?? '' : withoutControlChars;
  const inlineCode = unfenced.match(/^`([^`]+)`$/);
  const commandText = inlineCode ? inlineCode[1]?.trim() ?? '' : unfenced;
  return commandText.trim();
}

function formatCommandResultForModel(result: string | { output: string; lintDiff?: string; hints?: string; scratchpad?: string; urgency?: string }): string {
  if (typeof result === 'string') {
    return result.trimEnd() || '(no output)';
  }
  return [
    'result',
    result.output.trimEnd() || '(no output)',
    ...('lintDiff' in result && result.lintDiff?.trim()
      ? ['', result.lintDiff.trimEnd()]
      : []),
    'hints',
    result.hints?.trimEnd() || '(none)',
    '',
    '### BEGIN /scratchpad.txt  ###',
    result.scratchpad?.trimEnd() || '(empty)',
    '### END /scratchpad.txt ###',
    '### BEGIN your urgency ###',
    result.urgency?.trimEnd() || formatChatCliUrgency(0),
    '### END your urgency ###',
    'Multiple ```shell blocks are allowed and run as a batch. Remember to take notes as you go!',
    'What is your next command?',
  ].join('\n');
}

function updateChatCliUrgency(current: number, mutatedDocument: boolean): number {
  return Math.max(0, current + 1 - (mutatedDocument ? 3 : 0));
}

function formatChatCliUrgency(score: number): string {
  return `score=${score}\n${getChatCliUrgencyMessage(score)}`;
}

function getChatCliUrgencyMessage(score: number): string {
  if (score < 2) {
    return 'prioritize planning and understanding';
  }
  if (score <= 4) {
    return 'consider making your next change soon';
  }
  return 'stop poking around and make changes';
}

function formatBatchCommandOutput(outputs: Array<{ command: string; output: string }>): string {
  if (outputs.length === 1) {
    return outputs[0]?.output ?? '';
  }
  return outputs
    .map((result) => [`> ${result.command}`, result.output.trimEnd() || '(no output)'].join('\n'))
    .join('\n\n');
}

function formatBatchHints(hints: string[]): string {
  const seen = new Set<string>();
  const uniqueHints: string[] = [];
  for (const hint of hints) {
    const trimmed = hint.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    uniqueHints.push(trimmed);
  }
  return uniqueHints.join('\n\n');
}

function formatOutputForModel(output: string, maxLines: number): string {
  const wrappedLines = wrapLongOutputLines(output).split('\n');
  if (wrappedLines.length <= maxLines) {
    return wrappedLines.join('\n');
  }
  const hiddenCount = wrappedLines.length - maxLines;
  return [
    ...wrappedLines.slice(0, maxLines),
    `Warning: output truncated to ${maxLines} of ${wrappedLines.length} wrapped lines (${hiddenCount} lines hidden). Narrow the command with rg, find -name, head, or a more specific path.`,
  ].join('\n');
}

function wrapLongOutputLines(output: string): string {
  return output
    .split('\n')
    .flatMap((line) => splitLongOutputLine(line, CHAT_CLI_MODEL_OUTPUT_MAX_LINE_WIDTH))
    .join('\n');
}

function splitLongOutputLine(line: string, maxWidth: number): string[] {
  if (line.length <= maxWidth) {
    return [line];
  }
  const chunks: string[] = [];
  for (let index = 0; index < line.length; index += maxWidth) {
    chunks.push(line.slice(index, index + maxWidth));
  }
  return chunks;
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
