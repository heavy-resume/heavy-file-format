import { DEFAULT_OPENAI_COMPACTION_MODEL, requestProxyCompletion } from '../chat/chat';
import {
  collectHvyCliDiagnostics,
  formatHvyCliDiagnosticIssueLine,
  type HvyCliDiagnosticIssue,
} from '../cli-core/document-diagnostics';
import type { ChatMessage, ChatSettings, ChatTokenUsage, VisualDocument } from '../types';
import { getDocumentAiContext } from '../document-ai-context';
import { buildHvyVirtualFileSystem } from '../cli-core/virtual-file-system';
import { formatHvyComponentDescriptionHistory } from '../cli-core/component-description-history';
import { buildChatCliComponentHints } from './chat-cli-component-hints';
import { createChatCliTraceRunId, writeChatCliCommandTrace, writeChatCliUserQueryTrace } from './chat-cli-dev-trace';
import { createChatCliInterface } from './chat-cli-interface';
import { buildChatCliPersistentInstructions } from './chat-cli-instructions';
import type { HvyCliSession } from '../cli-core/commands';

const CHAT_CLI_MAX_STEPS = 30;
const CHAT_CLI_MAX_CONSECUTIVE_COMMAND_ERRORS = 3;
const CHAT_CLI_MESSAGE_HISTORY_HIGH_WATER_TOKENS = 10_000;
const CHAT_CLI_MESSAGE_HISTORY_TARGET_CHARS = 24_000;
const CHAT_CLI_MESSAGE_HISTORY_FALLBACK_HIGH_WATER_CHARS = 40_000;
const CHAT_CLI_PRIOR_MESSAGE_LIMIT = 10;
const CHAT_CLI_MODEL_OUTPUT_MAX_LINES = 200;
const CHAT_CLI_MODEL_OUTPUT_MAX_LINE_WIDTH = 400;
const CHAT_CLI_RECOMMENDED_BATCH_COMMANDS = 4;
const CHAT_CLI_BATCH_GUIDANCE = `Use one command per \`\`\`shell block and at most ${CHAT_CLI_RECOMMENDED_BATCH_COMMANDS} \`\`\`shell blocks per response.`;
const CHAT_CLI_COMMAND_NAMES = new Set(['cd', 'pwd', 'ls', 'cat', 'head', 'tail', 'nl', 'find', 'rg', 'grep', 'sort', 'uniq', 'wc', 'tr', 'xargs', 'cp', 'rm', 'echo', 'sed', 'true', 'hvy', 'db-table', 'form', 'ask']);
const introducedDiagnosticsByDocument = new WeakMap<VisualDocument, Map<string, HvyCliDiagnosticIssue>>();

export interface ChatCliEditTurnResult {
  summary: string;
  tokenUsage?: ChatTokenUsage;
  asked?: boolean;
}

export interface ChatCliInitialTurnRequest {
  messages: ChatMessage[];
  context: string;
  systemInstructions: string;
  traceRunId: string;
}

export interface ChatCliSimTurnState extends ChatCliInitialTurnRequest {
  request: string;
  settings?: ChatSettings;
  priorMessages: ChatMessage[];
  priorConversation: ChatMessage[];
  session: HvyCliSession;
  diagnostics: HvyCliDiagnosticIssue[];
  urgency: number;
  selectedComponent?: ChatCliSelectedComponentFocus;
}

export interface ChatCliSimAdvanceResult extends ChatCliSimTurnState {
  commandResultMessage: string;
  mutated: boolean;
  batchHadSuccess?: boolean;
  batchHadError?: boolean;
  lastFailedCommand?: string;
  lastCommandError?: string;
  terminalSummary?: string;
  askedQuestion?: string;
}

export interface ChatCliSelectedComponentFocus {
  path: string;
  sectionTitle: string;
  component: string;
  baseComponent: string;
  schemaId: string;
  guidance?: string;
}

export async function runChatCliEditLoop(params: {
  settings: ChatSettings;
  document: VisualDocument;
  request: string;
  priorMessages?: ChatMessage[];
  selectedComponent?: ChatCliSelectedComponentFocus;
  onMutation?: (group?: string) => void;
  onProgress?: (content: string) => void;
  onReasoningSummary?: (summary: string) => void;
  onTokenUsage?: (usage: ChatTokenUsage) => void;
  signal?: AbortSignal;
}): Promise<ChatCliEditTurnResult> {
  const traceRunId = createChatCliTraceRunId();
  await writeChatCliUserQueryTrace(traceRunId, params.request, params.signal);
  const initial = await buildChatCliInitialTurnRequest({ ...params, traceRunId, writeTrace: true });
  let turnState: ChatCliSimTurnState = {
    messages: initial.messages,
    context: initial.context,
    systemInstructions: initial.systemInstructions,
    traceRunId,
    request: params.request,
    settings: params.settings,
    priorMessages: params.priorMessages ?? [],
    priorConversation: initial.priorConversation,
    session: initial.cli.session,
    diagnostics: initial.diagnostics,
    urgency: 0,
    ...(params.selectedComponent ? { selectedComponent: params.selectedComponent } : {}),
  };
  if ((params.priorMessages ?? []).some((message) => message.role === 'assistant' && message.work)) {
    recordIntroducedDiagnostics(params.document, [], turnState.diagnostics);
  }
  syncIntroducedDiagnostics(params.document, turnState.diagnostics);
  let consecutiveCommandErrors = 0;
  let latestTokenUsage: ChatTokenUsage | null = null;
  let latestInputTokens: number | undefined;

  for (let step = 0; step < CHAT_CLI_MAX_STEPS; step += 1) {
    throwIfAborted(params.signal);
    const response = await requestProxyCompletion({
      settings: params.settings,
      messages: turnState.messages,
      context: turnState.context,
      responseInstructions: '',
      systemInstructions: turnState.systemInstructions,
      mode: 'document-edit',
      debugLabel: `chat-cli-edit:${step + 1}`,
      traceRunId,
      onReasoningSummary: params.onReasoningSummary,
      onTokenUsage: (usage) => {
        latestTokenUsage = usage;
        latestInputTokens = usage.inputTokens;
        params.onTokenUsage?.(usage);
      },
      signal: params.signal,
    });
    const advanced = await advanceChatCliTurnState({
      settings: params.settings,
      document: params.document,
      state: turnState,
      assistantOutput: response,
      signal: params.signal,
      onProgress: params.onProgress,
      traceRunId,
      writeTrace: true,
      lastInputTokens: latestInputTokens,
    });
    turnState = advanced;
    if (advanced.commandResultMessage) {
      if (advanced.batchHadSuccess) {
        consecutiveCommandErrors = 0;
      } else if (advanced.batchHadError) {
        consecutiveCommandErrors += 1;
        if (consecutiveCommandErrors >= CHAT_CLI_MAX_CONSECUTIVE_COMMAND_ERRORS) {
          throw new ChatCliCommandFailureError({
            request: params.request,
            command: advanced.lastFailedCommand ?? '',
            error: advanced.lastCommandError ?? '',
            scratchpad: formatScratchpadForModel(createChatCliInterface(params.document, turnState.session).snapshot()),
          });
        }
      }
      if (advanced.mutated) {
        params.onMutation?.('chat-cli');
      }
    }
    if (!advanced.terminalSummary && !advanced.askedQuestion) {
      continue;
    }
    if (advanced.terminalSummary) {
      params.onProgress?.('Finished CLI edit loop.');
      return {
        summary: advanced.terminalSummary || `Finished after ${step + 1} step${step === 0 ? '' : 's'}.`,
        ...(latestTokenUsage ? { tokenUsage: latestTokenUsage } : {}),
      };
    }
    if (advanced.askedQuestion) {
      return { summary: advanced.askedQuestion, asked: true, ...(latestTokenUsage ? { tokenUsage: latestTokenUsage } : {}) };
    }
  }

  return {
    summary: `Stopped after ${CHAT_CLI_MAX_STEPS} CLI command steps. Send another request to continue.`,
    ...(latestTokenUsage ? { tokenUsage: latestTokenUsage } : {}),
  };
}

export async function buildChatCliInitialProxyTurnRequest(params: {
  document: VisualDocument;
  request: string;
  priorMessages?: ChatMessage[];
  selectedComponent?: ChatCliSelectedComponentFocus;
  signal?: AbortSignal;
}): Promise<ChatCliInitialTurnRequest> {
  const traceRunId = createChatCliTraceRunId();
  const initial = await buildChatCliInitialTurnRequest({ ...params, traceRunId, writeTrace: false });
  return {
    messages: initial.messages,
    context: initial.context,
    systemInstructions: initial.systemInstructions,
    traceRunId,
  };
}

export async function buildChatCliInitialSimTurnState(params: {
  settings?: ChatSettings;
  document: VisualDocument;
  request: string;
  priorMessages?: ChatMessage[];
  selectedComponent?: ChatCliSelectedComponentFocus;
  signal?: AbortSignal;
}): Promise<ChatCliSimTurnState> {
  const traceRunId = createChatCliTraceRunId();
  const initial = await buildChatCliInitialTurnRequest({ ...params, traceRunId, writeTrace: false });
  return {
    messages: initial.messages,
    context: initial.context,
    systemInstructions: initial.systemInstructions,
    traceRunId,
    request: params.request,
    ...(params.settings ? { settings: params.settings } : {}),
    priorMessages: params.priorMessages ?? [],
    priorConversation: initial.priorConversation,
    session: initial.cli.session,
    diagnostics: initial.diagnostics,
    urgency: 0,
    ...(params.selectedComponent ? { selectedComponent: params.selectedComponent } : {}),
  };
}

export async function advanceChatCliSimTurnState(params: {
  settings?: ChatSettings;
  document: VisualDocument;
  state: ChatCliSimTurnState;
  assistantOutput: string;
  signal?: AbortSignal;
}): Promise<ChatCliSimAdvanceResult> {
  return advanceChatCliTurnState(params);
}

async function advanceChatCliTurnState(params: {
  settings?: ChatSettings;
  document: VisualDocument;
  state: ChatCliSimTurnState;
  assistantOutput: string;
  signal?: AbortSignal;
  onProgress?: (content: string) => void;
  traceRunId?: string;
  writeTrace?: boolean;
  lastInputTokens?: number;
}): Promise<ChatCliSimAdvanceResult> {
  throwIfAborted(params.signal);
  const action = parseChatCliAction(params.assistantOutput);
  if (action.kind === 'invalid') {
    const messages = [
      ...params.state.messages,
      {
        id: crypto.randomUUID(),
        role: 'user' as const,
        content: action.message,
      },
    ];
    return buildSimAdvanceResult(params, messages, action.message, false, params.state.urgency, params.state.diagnostics);
  }
  if (action.kind === 'done') {
    const diagnostics = await collectHvyCliDiagnostics(params.document);
    recordIntroducedDiagnostics(params.document, params.state.diagnostics, diagnostics);
    syncIntroducedDiagnostics(params.document, diagnostics);
    const introducedIssues = getIntroducedDiagnostics(params.document);
    if (introducedIssues.length > 0) {
      const message = formatIntroducedLintIssuesPrompt(introducedIssues);
      return buildSimAdvanceResult(
        params,
        [
          ...params.state.messages,
          {
            id: crypto.randomUUID(),
            role: 'user' as const,
            content: message,
          },
        ],
        message,
        false,
        params.state.urgency,
        params.state.diagnostics
      );
    }
    return {
      ...params.state,
      terminalSummary: action.summary,
      commandResultMessage: `done ${action.summary}`,
      mutated: false,
    };
  }
  if (action.kind === 'ask') {
    return {
      ...params.state,
      askedQuestion: action.question,
      commandResultMessage: `ask ${action.question}`,
      mutated: false,
    };
  }

  const cli = createChatCliInterface(params.document, params.state.session);
  const commands = action.commands;
  const executableCommands = commands.length > CHAT_CLI_RECOMMENDED_BATCH_COMMANDS
    ? commands.slice(0, CHAT_CLI_RECOMMENDED_BATCH_COMMANDS)
    : commands;
  const skippedCommandCount = commands.length - executableCommands.length;
  if (action.notes.trim()) {
    params.onProgress?.(`Notes\n${action.notes.trim()}`);
  }
  const outputLineBudget = Math.max(1, Math.floor(CHAT_CLI_MODEL_OUTPUT_MAX_LINES / Math.max(executableCommands.length, 1)));
  const commandOutputs: Array<{ command: string; output: string }> = [];
  const commandHints: string[] = [];
  let mutated = false;
  let batchHadSuccess = false;
  let batchHadError = false;
  let lastFailedCommand = '';
  let lastCommandError = '';
  let traceOutput = '';
  for (let commandIndex = 0; commandIndex < executableCommands.length; commandIndex += 1) {
    const command = executableCommands[commandIndex] ?? '';
    params.onProgress?.(executableCommands.length > 1 ? `$ [${commandIndex + 1}/${executableCommands.length}] ${command}` : `$ ${command}`);
    let result: Awaited<ReturnType<typeof cli.run>>;
    try {
      result = await cli.run(command);
      batchHadSuccess = true;
      mutated = mutated || (result.mutated && !isSessionOnlyCommand(command));
    } catch (error) {
      batchHadError = true;
      lastFailedCommand = command;
      lastCommandError = error instanceof Error ? error.message : String(error);
      result = {
        command,
        cwd: cli.session.cwd,
        output: lastCommandError,
        mutated: false,
      };
    }
    traceOutput = result.output;
    commandOutputs.push({ command, output: formatOutputForModel(result.output, outputLineBudget) });
    if (!isComponentCreationCommand(command)) {
      const hints = buildChatCliComponentHints({
        document: params.document,
        cwd: result.cwd,
        command,
        output: result.output,
      });
      if (hints.trim()) {
        commandHints.push(hints);
      }
    }
  }
  const urgency = batchHadSuccess ? updateChatCliUrgency(params.state.urgency, mutated) : params.state.urgency;
  const commandResultMessage = formatCommandResultForModel({
    output: formatBatchCommandOutput(commandOutputs),
    skippedCommandCount,
    hints: formatBatchHints(commandHints),
    scratchpad: formatScratchpadForModel(cli.snapshot()),
    urgency: formatChatCliUrgency(urgency),
    cwd: cli.snapshot().cwd,
  });
  const messages = [
    ...params.state.messages,
    {
      id: crypto.randomUUID(),
      role: 'user' as const,
      content: commandResultMessage,
    },
  ];
  if (params.writeTrace && params.traceRunId) {
    await writeChatCliCommandTrace(
      params.traceRunId,
      executableCommands.length === 1 ? executableCommands[0] ?? '' : executableCommands.join('\n'),
      executableCommands.length === 1 ? traceOutput : formatBatchCommandOutput(commandOutputs),
      params.signal,
      commandResultMessage
    );
  }
  const compactedMessages = await compactChatCliConversation({
    messages,
    settings: params.settings ?? params.state.settings,
    request: params.state.request,
    lastInputTokens: params.lastInputTokens,
    signal: params.signal,
    traceRunId: params.traceRunId,
  });
  return {
    ...buildSimAdvanceResult(params, compactedMessages, commandResultMessage, mutated, urgency, params.state.diagnostics),
    batchHadSuccess,
    batchHadError,
    lastFailedCommand,
    lastCommandError,
  };
}

function buildSimAdvanceResult(
  params: {
    document: VisualDocument;
    state: ChatCliSimTurnState;
    assistantOutput: string;
    signal?: AbortSignal;
  },
  messages: ChatMessage[],
  commandResultMessage: string,
  mutated: boolean,
  urgency: number,
  diagnostics: HvyCliDiagnosticIssue[]
): ChatCliSimAdvanceResult {
  const cli = createChatCliInterface(params.document, params.state.session);
  const {
    terminalSummary: _terminalSummary,
    askedQuestion: _askedQuestion,
    batchHadSuccess: _batchHadSuccess,
    batchHadError: _batchHadError,
    lastFailedCommand: _lastFailedCommand,
    lastCommandError: _lastCommandError,
    commandResultMessage: _commandResultMessage,
    mutated: _mutated,
    ...baseState
  } = params.state as ChatCliSimAdvanceResult;
  return {
    ...baseState,
    messages,
    context: buildChatCliLoopContext(
      cli.snapshot(),
      params.document,
      params.state.request,
      params.state.priorMessages,
      params.state.priorConversation,
      params.state.selectedComponent
    ),
    systemInstructions: buildChatCliLoopSystemInstructions(cli.snapshot().commandSummary),
    diagnostics,
    urgency,
    commandResultMessage,
    mutated,
  };
}

async function buildChatCliInitialTurnRequest(params: {
  document: VisualDocument;
  request: string;
  priorMessages?: ChatMessage[];
  selectedComponent?: ChatCliSelectedComponentFocus;
  signal?: AbortSignal;
  traceRunId: string;
  writeTrace: boolean;
}): Promise<ChatCliInitialTurnRequest & {
  cli: ReturnType<typeof createChatCliInterface>;
  diagnostics: HvyCliDiagnosticIssue[];
  priorConversation: ChatMessage[];
}> {
  const cli = createChatCliInterface(params.document);
  if (params.selectedComponent?.path) {
    cli.session.cwd = selectInitialCwdForSelectedComponent(
      buildHvyVirtualFileSystem(params.document),
      params.selectedComponent.path,
      params.request
    );
  }
  const runInitialCommand = async (explanation: string, command: string) => {
    const output = await cli.run(command);
    if (params.writeTrace) {
      await writeChatCliCommandTrace(params.traceRunId, output.command, output.output, params.signal);
    }
    return { ...output, explanation };
  };
  const initialRootListing = await runInitialCommand(
    'I am getting the root structure of this HVY document like it is a file system. If I am ls-ing a component, this explains what it is.',
    'ls /'
  );
  const initialHvyHelp = await runInitialCommand(
    'I am checking the HVY CLI help to see how to create new components, learn how plugins work, etc.',
    'hvy --help'
  );
  const initialStructure = await runInitialCommand(
    'I am getting the component structure so I can identify sections, reusable component types, and likely edit surfaces.',
    'hvy request_structure --collapse'
  );
  const diagnostics = await collectHvyCliDiagnostics(params.document);
  const initialIntent = await runInitialCommand(
    'I am searching for the most likely locations related to the user request so I can avoid blind grep-and-edit behavior.',
    `hvy find-intent ${quoteChatCliShellArg(params.request)} --max 5`
  );
  const initialSelectedPreview = params.selectedComponent?.path
    ? await runInitialCommand(
        'I am previewing the selected component because the request started from a specific place in the document.',
        `hvy preview ${quoteChatCliShellArg(params.selectedComponent.path)}`
      )
    : null;
  const priorConversation = selectChatCliPriorMessages(params.priorMessages ?? []);
  const initialOutputs = [
    initialRootListing,
    initialHvyHelp,
    initialStructure,
    initialIntent,
    ...(initialSelectedPreview ? [initialSelectedPreview] : []),
  ];
  const messages: ChatMessage[] = [
    ...priorConversation,
    {
      id: crypto.randomUUID(),
      role: 'user',
      content: params.request,
    },
    ...formatInitialChatCliCommandMessages(initialOutputs, cli.snapshot()),
  ];
  const context = buildChatCliLoopContext(
    cli.snapshot(),
    params.document,
    params.request,
    params.priorMessages ?? [],
    priorConversation,
    params.selectedComponent
  );
  return {
    cli,
    diagnostics,
    priorConversation,
    messages,
    context,
    systemInstructions: buildChatCliLoopSystemInstructions(cli.snapshot().commandSummary),
    traceRunId: params.traceRunId,
  };
}

function buildChatCliLoopContext(
  snapshot: ReturnType<ReturnType<typeof createChatCliInterface>['snapshot']>,
  document: VisualDocument,
  request: string,
  priorMessages: ChatMessage[],
  priorConversation: ChatMessage[],
  selectedComponent?: ChatCliSelectedComponentFocus
): string {
  const omittedMessageCount = priorMessages.filter((message) => !message.progress).length - priorConversation.length;
  const documentAiContext = getDocumentAiContext(document);
  const cwdComponentContext = formatHvyComponentDescriptionHistory(document, buildHvyVirtualFileSystem(document), snapshot.cwd);
  return [
    'Current request:',
    request,
    ...(documentAiContext ? ['', 'Document context:', documentAiContext] : []),
    ...(omittedMessageCount > 0 ? ['', `Earlier chat omitted: ${omittedMessageCount} message${omittedMessageCount === 1 ? '' : 's'}.`] : []),
    ...(selectedComponent ? ['', 'Selected component focus:', formatSelectedComponentFocus(selectedComponent, request)] : []),
    ...(cwdComponentContext ? ['', cwdComponentContext] : []),
  ].join('\n');
}

function formatSelectedComponentFocus(focus: ChatCliSelectedComponentFocus, request: string): string {
  const parentPath = getParentVirtualPath(focus.path);
  return [
    `Path: ${focus.path}`,
    `Parent path: ${parentPath}`,
    `Section: ${focus.sectionTitle}`,
    `Component: ${focus.component}`,
    `Base component: ${focus.baseComponent}`,
    `Schema ID: ${focus.schemaId || '(none)'}`,
    ...(focus.guidance?.trim() ? ['Component guidance:', focus.guidance.trim()] : []),
    'You are currently in the directory representing the component to change, or possibly next to or near the component to change, or an example of a component you would add.',
    isAddLikeSelectedComponentRequest(request)
      ? 'This request appears to add a new item. Do not overwrite the selected component. Inspect the parent path and add a sibling or nearby child in the appropriate container.'
      : 'Prefer editing this component only when the request is asking to change, remove, or refine the selected component itself.',
  ].join('\n');
}

function selectInitialCwdForSelectedComponent(
  fs: ReturnType<typeof buildHvyVirtualFileSystem>,
  selectedPath: string,
  request: string
): string {
  if (!isAddLikeSelectedComponentRequest(request)) {
    return selectedPath;
  }
  const componentListParent = nearestComponentListParent(fs, selectedPath);
  return componentListParent || selectedPath;
}

function nearestComponentListParent(fs: ReturnType<typeof buildHvyVirtualFileSystem>, selectedPath: string): string {
  let current = selectedPath.replace(/\/+$/, '');
  while (current.startsWith('/body/')) {
    const entry = fs.entries.get(`${current}/component-list.json`);
    if (entry?.kind === 'file') {
      return current;
    }
    const parent = getParentVirtualPath(current);
    current = parent;
  }
  return '';
}

function getParentVirtualPath(path: string): string {
  const normalized = path.replace(/\/+$/, '');
  const index = normalized.lastIndexOf('/');
  if (index <= 0) {
    return '/';
  }
  return normalized.slice(0, index);
}

function isAddLikeSelectedComponentRequest(request: string): boolean {
  return /\b(add|create|insert|append|new|another|additional)\b/i.test(request)
    && !/\b(replace|rewrite|rename|change this|update this|modify this|remove this|delete this)\b/i.test(request);
}

function formatInitialChatCliCommandMessages(
  outputs: Array<{ command: string; output: string; explanation?: string }>,
  snapshot: ReturnType<ReturnType<typeof createChatCliInterface>['snapshot']>
): ChatMessage[] {
  return outputs.flatMap((output, index) => [
    {
      id: crypto.randomUUID(),
      role: 'assistant' as const,
      content: formatChatCliCommandForModel(output.command, output.explanation),
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
            cwd: snapshot.cwd,
          })
        : formatCommandResultForModel(output.output),
    },
  ]);
}

function formatChatCliCommandForModel(command: string, explanation?: string): string {
  return [
    ...(explanation?.trim() ? [explanation.trim(), ''] : []),
    `\`\`\`shell\n${command}\n\`\`\``,
  ].join('\n');
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

class ChatCliCommandFailureError extends Error {
  constructor(params: {
    request: string;
    command: string;
    error: string;
    scratchpad: string;
  }) {
    super([
      `Stopped after ${CHAT_CLI_MAX_CONSECUTIVE_COMMAND_ERRORS} failed CLI commands.`,
      '',
      'Current request:',
      params.request,
      '',
      'Last failed command:',
      params.command,
      '',
      'Last error:',
      params.error,
      '',
      'Scratchpad at failure:',
      params.scratchpad,
      '',
      'Continue from the chat history and current document state. If the next step is unclear, ask a clarifying question.',
    ].join('\n'));
  }
}

function buildChatCliLoopFormatInstructions(): string {
  return [
    'When continuing, return concise notes plus terminal command(s).',
    'For continuing responses, write exactly one note block at the top with these three short lines: What you are doing, Why you are doing it, What you are unsure of.',
    'Do not repeat the What / Why / Unsure notes before each command. One response gets one note block total.',
    `Wrap each command in its own \`\`\`shell fence. Multiple \`\`\`shell blocks are allowed and run in order. ${CHAT_CLI_BATCH_GUIDANCE}`,
    'Text outside ```shell fences is shown as progress notes for debugging. It is not a substitute for commands.',
    'To finish, run `done MESSAGE_TO_USER` as the only command in the response.',
    'To ask for requirements, NOT CLI clarification from the non-technical user, run `ask QUESTION` as the only command in the response.',
    'Do not include done with edit/inspection commands. Run commands, inspect the result, then finish in a later response.',
  ].join('\n');
}

function buildChatCliLoopSystemInstructions(commandSummary: string): string {
  return [
    buildChatCliPersistentInstructions(),
    '',
    'Valid commands (in order of preference):',
    commandSummary,
    '',
    'Response instructions:',
    buildChatCliLoopFormatInstructions(),
  ].join('\n');
}

function parseChatCliAction(response: string): { kind: 'command'; commands: string[]; notes: string } | { kind: 'done'; summary: string } | { kind: 'ask'; question: string } | { kind: 'invalid'; message: string } {
  const fencedCommands = extractFencedShellCommands(response);
  if (fencedCommands.kind === 'invalid') {
    return { kind: 'invalid', message: fencedCommands.message };
  }
  if (fencedCommands.commands.length > 0) {
    const terminalCommandsToEvaluate = fencedCommands.commands.slice(0, CHAT_CLI_RECOMMENDED_BATCH_COMMANDS);
    const terminal = parseTerminalChatCliCommand(terminalCommandsToEvaluate);
    if (terminal) {
      return terminal;
    }
    return { kind: 'command', commands: fencedCommands.commands, notes: fencedCommands.notes };
  }
  const cleaned = normalizeCommandResponse(response);
  const command = cleaned.replace(/^(?:[\w./~-]+)?\s*\$\s*/, '').trim();
  const terminalLine = parseTerminalChatCliLine(command) ?? parseTerminalChatCliLine(lastNonEmptyLine(command));
  if (terminalLine) {
    return terminalLine;
  }
  if (/^(done|finish|finished)\b/i.test(command)) {
    return { kind: 'done', summary: command.replace(/^(done|finish|finished)[:\s-]*/i, '').trim() };
  }
  if (/^ask\b/i.test(command)) {
    const question = command.replace(/^ask[:\s-]*/i, '').trim();
    if (/^question for the user[.?]?$/i.test(question)) {
      return { kind: 'invalid', message: 'Replace the ask placeholder with the actual question, or run a command. Do not return `ask Question for the user` literally.' };
    }
    return question
      ? { kind: 'ask', question }
      : { kind: 'invalid', message: 'Expected `ask Question for the user`.' };
  }
  if (!command || command.startsWith('```') || isLikelyProseResponse(command)) {
    return { kind: 'invalid', message: 'Expected concise notes plus fenced ```shell commands, `ask QUESTION`, or `done MESSAGE_TO_USER`. Notes alone are not enough.' };
  }
  return { kind: 'command', commands: [command], notes: '' };
}

function parseTerminalChatCliCommand(commands: string[]): { kind: 'done'; summary: string } | { kind: 'ask'; question: string } | { kind: 'invalid'; message: string } | null {
  const terminalCommands = commands
    .map((command) => parseTerminalChatCliLine(command))
    .filter((command): command is { kind: 'done'; summary: string } | { kind: 'ask'; question: string } | { kind: 'invalid'; message: string } => !!command);
  if (terminalCommands.length === 0) {
    return null;
  }
  if (commands.length > 1) {
    return { kind: 'invalid', message: 'Run `done MESSAGE_TO_USER` or `ask QUESTION` as the only command in the response.' };
  }
  return terminalCommands[0] ?? null;
}

function parseTerminalChatCliLine(command: string): { kind: 'done'; summary: string } | { kind: 'ask'; question: string } | { kind: 'invalid'; message: string } | null {
  const line = command.trim();
  if (/^(done|finish|finished)\b/i.test(line)) {
    const summary = line.replace(/^(done|finish|finished)[:\s-]*/i, '').trim();
    return summary
      ? { kind: 'done', summary }
      : { kind: 'invalid', message: 'Expected `done MESSAGE_TO_USER`.' };
  }
  if (/^ask\b/i.test(line)) {
    const question = line.replace(/^ask[:\s-]*/i, '').trim();
    if (/^question for the user[.?]?$/i.test(question)) {
      return { kind: 'invalid', message: 'Replace the ask placeholder with the actual question, or run a command. Do not return `ask Question for the user` literally.' };
    }
    return question
      ? { kind: 'ask', question }
      : { kind: 'invalid', message: 'Expected `ask QUESTION`.' };
  }
  return null;
}

function lastNonEmptyLine(value: string): string {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1) ?? '';
}

function extractFencedShellCommands(response: string): { kind: 'ok'; commands: string[]; notes: string } | { kind: 'invalid'; message: string } {
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
  const uniqueCommands = dedupeChatCliCommands(commands);
  if (uniqueCommands.length === 0) {
    return { kind: 'ok', commands, notes: '' };
  }
  const outsideCommand = normalizeCommandResponse(outside);
  const hasTrailingDone = /^(done|finish|finished)\b/i.test(outsideCommand);
  return { kind: 'ok', commands: uniqueCommands, notes: hasTrailingDone ? '' : normalizeAssistantNotes(outside) };
}

function dedupeChatCliCommands(commands: string[]): string[] {
  const seen = new Set<string>();
  return commands.filter((command) => {
    const normalized = command.trim().replace(/\r\n?/g, '\n');
    if (seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
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

function normalizeAssistantNotes(notes: string): string {
  return notes
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .trim();
}

function formatCommandResultForModel(result: string | { output: string; skippedCommandCount?: number; hints?: string; scratchpad?: string; urgency?: string; cwd?: string }): string {
  if (typeof result === 'string') {
    return formatCommandResultSection(result);
  }
  return [
    `Current directory: ${result.cwd || '/'}`,
    formatCommandResultOutput(result.output),
    ...(result.skippedCommandCount && result.skippedCommandCount > 0 ? [formatSkippedCommandNotice(result.skippedCommandCount)] : []),
    '### OPTIONAL CONTEXT (NOT REQUIRED ACTIONS) ###',
    result.hints?.trimEnd() || '(none)',
    '### END OPTIONAL CONTEXT ###',
    '### BEGIN /scratchpad.txt  ###',
    result.scratchpad?.trimEnd() || '(empty)',
    '### END /scratchpad.txt ###',
    '### BEGIN your urgency ###',
    result.urgency?.trimEnd() || formatChatCliUrgency(0),
    '### END your urgency ###',
    `Command guidance: ${CHAT_CLI_BATCH_GUIDANCE}`,
    formatNextResponseInstruction(),
  ].join('\n');
}

function formatSkippedCommandNotice(skippedCommandCount: number): string {
  if (skippedCommandCount <= 0) {
    return '';
  }
  return [
    '### COMMANDS NOT RUN ###',
    `${skippedCommandCount} command${skippedCommandCount === 1 ? '' : 's'} not run because this response exceeded the ${CHAT_CLI_RECOMMENDED_BATCH_COMMANDS}-command batch limit.`,
    'Only the CMD results above came from commands that actually ran.',
    '### END COMMANDS NOT RUN ###',
  ].join('\n');
}

function formatCommandResultOutput(output: string): string {
  return output.trimStart().startsWith('CMD: ') && output.includes('### CMD RESULT ###')
    ? output.trimEnd()
    : formatCommandResultSection(output);
}

function formatCommandResultSection(output: string): string {
  return [
    '### CMD RESULT ###',
    output.trimEnd() || '(no output)',
    '### END CMD RESULT ###',
  ].join('\n');
}

function updateChatCliUrgency(current: number, mutatedDocument: boolean): number {
  return Math.max(0, current + 1 - (mutatedDocument ? 3 : 0));
}

function formatChatCliUrgency(score: number): string {
  return `score=${score}\n${getChatCliUrgencyMessage(score)}`;
}

function getChatCliUrgencyMessage(score: number): string {
  if (score < 3) {
    return 'prioritize planning and understanding';
  }
  if (score <= 5) {
    return 'consider making your next change soon';
  }
  return 'stop poking around and make changes';
}

function formatNextResponseInstruction(): string {
  return 'Next response: Write one concise What / Why / Unsure note block followed by shell command(s), or run ask QUESTION, or run done MESSAGE_TO_USER.';
}

function formatBatchCommandOutput(outputs: Array<{ command: string; output: string }>): string {
  return outputs
    .map((result) => [`CMD: ${result.command}`, formatCommandResultSection(result.output)].join('\n'))
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
  if (/\s/.test(line.slice(0, maxWidth + 1))) {
    return [line];
  }
  const chunks: string[] = [];
  for (let index = 0; index < line.length; index += maxWidth) {
    chunks.push(line.slice(index, index + maxWidth));
  }
  return chunks;
}

function isComponentCreationCommand(command: string): boolean {
  return /^\s*hvy\s+insert\b/.test(command);
}

function formatScratchpadForModel(snapshot: Pick<ReturnType<ReturnType<typeof createChatCliInterface>['snapshot']>, 'scratchpad' | 'scratchpadEdited' | 'scratchpadCommandsSinceEdit'>): string {
  const commands = snapshot.scratchpadCommandsSinceEdit;
  const ageLine = snapshot.scratchpadEdited
    ? `last edited ${commands.length} command${commands.length === 1 ? '' : 's'} ago`
    : 'last edited never';
  const recentCommandLines = snapshot.scratchpadEdited && commands.length > 0 && commands.length <= 3
    ? ['', 'commands since last edit:', ...commands.map((command) => `CMD: ${command}`)]
    : [];
  return [
    ageLine,
    ...recentCommandLines,
    '',
    snapshot.scratchpad.trimEnd() || '(empty)',
  ].join('\n');
}

function getIntroducedDiagnostics(document: VisualDocument): HvyCliDiagnosticIssue[] {
  return [...(introducedDiagnosticsByDocument.get(document)?.values() ?? [])];
}

function recordIntroducedDiagnostics(document: VisualDocument, previousIssues: HvyCliDiagnosticIssue[], nextIssues: HvyCliDiagnosticIssue[]): void {
  const previousKeys = new Set(previousIssues.map((issue) => issue.key));
  const introduced = getIntroducedDiagnosticMap(document);
  for (const issue of nextIssues) {
    if (!previousKeys.has(issue.key)) {
      introduced.set(issue.key, issue);
    }
  }
}

function syncIntroducedDiagnostics(document: VisualDocument, currentIssues: HvyCliDiagnosticIssue[]): void {
  const currentByKey = new Map(currentIssues.map((issue) => [issue.key, issue]));
  const introduced = getIntroducedDiagnosticMap(document);
  for (const key of [...introduced.keys()]) {
    const current = currentByKey.get(key);
    if (current) {
      introduced.set(key, current);
    } else {
      introduced.delete(key);
    }
  }
}

function getIntroducedDiagnosticMap(document: VisualDocument): Map<string, HvyCliDiagnosticIssue> {
  const existing = introducedDiagnosticsByDocument.get(document);
  if (existing) {
    return existing;
  }
  const created = new Map<string, HvyCliDiagnosticIssue>();
  introducedDiagnosticsByDocument.set(document, created);
  return created;
}

function formatIntroducedDiagnosticsForModel(issues: HvyCliDiagnosticIssue[]): string {
  if (issues.length === 0) {
    return '(none)';
  }
  return [
    'These diagnostics were introduced by your changes and remain unresolved. Fix them before finishing:',
    ...issues.map(formatHvyCliDiagnosticIssueLine),
  ].join('\n');
}

function formatIntroducedLintIssuesPrompt(issues: HvyCliDiagnosticIssue[]): string {
  return [
    '### BLOCKED ###',
    'You cannot finish yet.',
    '### END BLOCKED ###',
    '### UNRESOLVED DIAGNOSTICS INTRODUCED BY YOUR CHANGES ###',
    formatIntroducedDiagnosticsForModel(issues),
    '### END UNRESOLVED DIAGNOSTICS INTRODUCED BY YOUR CHANGES ###',
    'Next response: Write concise What you are doing / Why you are doing it / What you are unsure of notes, then run commands to fix clear diagnostics and run hvy lint to verify them, or explain intentional warnings with done MESSAGE_TO_USER.',
  ].join('\n');
}


function isLikelyProseResponse(value: string): boolean {
  const firstWord = value.split(/\s+/, 1)[0]?.replace(/^\$\s*/, '') ?? '';
  return value.includes(' ') && !CHAT_CLI_COMMAND_NAMES.has(firstWord);
}

async function compactChatCliConversation(params: {
  messages: ChatMessage[];
  settings?: ChatSettings;
  request: string;
  lastInputTokens?: number;
  signal?: AbortSignal;
  traceRunId?: string;
}): Promise<ChatMessage[]> {
  const shouldCompact = typeof params.lastInputTokens === 'number'
    ? params.lastInputTokens >= CHAT_CLI_MESSAGE_HISTORY_HIGH_WATER_TOKENS
    : countMessageChars(params.messages) > CHAT_CLI_MESSAGE_HISTORY_FALLBACK_HIGH_WATER_CHARS;
  if (!shouldCompact) {
    return params.messages;
  }
  const retained: ChatMessage[] = [];
  let totalChars = 0;
  for (let index = params.messages.length - 1; index >= 0; index -= 1) {
    const message = params.messages[index];
    if (!message) {
      continue;
    }
    if (retained.length > 0 && totalChars + message.content.length > CHAT_CLI_MESSAGE_HISTORY_TARGET_CHARS) {
      break;
    }
    retained.unshift(message);
    totalChars += message.content.length;
  }
  const retainedIds = new Set(retained.map((message) => message.id));
  const compactedAway = params.messages.filter((message) => !retainedIds.has(message.id));
  if (compactedAway.length === 0) {
    return params.messages;
  }
  const summary = await summarizeCompactedChatCliMessages({
    settings: params.settings,
    request: params.request,
    messages: compactedAway,
    signal: params.signal,
    traceRunId: params.traceRunId,
  });
  return [
    {
      id: crypto.randomUUID(),
      role: 'user',
      content: [
        '### COMPACTED PRIOR CLI HISTORY ###',
        summary.trim() || fallbackCompactedChatCliSummary(params.request, compactedAway),
        '### END COMPACTED PRIOR CLI HISTORY ###',
      ].join('\n'),
    },
    ...retained,
  ];
}

async function summarizeCompactedChatCliMessages(params: {
  settings?: ChatSettings;
  request: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
  traceRunId?: string;
}): Promise<string> {
  const compactionModel = params.settings?.compactionModel?.trim() || DEFAULT_OPENAI_COMPACTION_MODEL;
  const compactionProvider = params.settings?.compactionProvider ?? 'openai';
  try {
    return await requestProxyCompletion({
      settings: {
        provider: compactionProvider,
        model: compactionModel,
        compactionProvider,
        compactionModel,
      },
      messages: [
        {
          id: crypto.randomUUID(),
          role: 'user',
          content: [
            'Summarize this compacted HVY CLI document-edit history for the next model turn.',
            'Preserve the user goal, completed edits, relevant paths/components, validation results, unresolved errors, current plan, and anything the next turn must not redo.',
            'Write one concise factual message. Do not invent progress.',
            '',
            `Current request:\n${params.request}`,
            '',
            'Compacted chronological messages:',
            formatMessagesForCompactionSummary(params.messages),
          ].join('\n'),
        },
      ],
      context: '',
      responseInstructions: 'Return only the compacted summary text.',
      systemInstructions: [
        'You compact HVY CLI agent history for a later AI model turn.',
        'Be concise, chronological, and factual.',
        'Summarize goal and progress; keep actionable errors and pending work.',
      ].join('\n'),
      mode: 'qa',
      debugLabel: 'chat-cli-compaction',
      traceRunId: params.traceRunId,
      signal: params.signal,
    });
  } catch {
    return fallbackCompactedChatCliSummary(params.request, params.messages);
  }
}

function formatMessagesForCompactionSummary(messages: ChatMessage[]): string {
  return messages
    .map((message, index) => {
      const header = `${index + 1}. ${message.role}${message.error ? ' error' : ''}`;
      return `${header}\n${message.content}`;
    })
    .join('\n\n');
}

function fallbackCompactedChatCliSummary(request: string, messages: ChatMessage[]): string {
  return [
    `Current request: ${request}`,
    `Compacted ${messages.length} older CLI message${messages.length === 1 ? '' : 's'}.`,
    'The detailed older command history was removed to keep the model context small.',
  ].join('\n');
}

function countMessageChars(messages: ChatMessage[]): number {
  return messages.reduce((total, message) => total + message.content.length, 0);
}

function isSessionOnlyCommand(command: string): boolean {
  return /\bscratchpad\.txt\b/.test(command);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
}
