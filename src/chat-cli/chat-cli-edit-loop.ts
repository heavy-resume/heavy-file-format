import { DEFAULT_OPENAI_COMPACTION_MODEL, requestProxyCompletion, requestProxyToolTurn, type ProxyToolTurn } from '../chat/chat';
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
import { createChatCliTraceRunId, writeChatCliCommandTrace, writeChatCliFailedCommandTrace, writeChatCliUserQueryTrace } from './chat-cli-dev-trace';
import { createChatCliInterface } from './chat-cli-interface';
import { buildChatCliPersistentInstructions } from './chat-cli-instructions';
import { getHvyCliPreferredCommandSummary, type HvyCliSession } from '../cli-core/commands';
import {
  appendProviderToolResultsToState,
  buildInitialProviderToolState,
  type ProviderToolCall,
  type ProviderToolDefinition,
  type ProviderToolResult,
  type ProviderToolTurn,
  type ProviderToolState,
} from '../chat/provider-tools';

const CHAT_CLI_MAX_STEPS = 30;
const CHAT_CLI_MAX_CONSECUTIVE_COMMAND_ERRORS = 3;
const CHAT_CLI_MESSAGE_HISTORY_HIGH_WATER_TOKENS = 12_000;
const CHAT_CLI_MESSAGE_HISTORY_TARGET_CHARS = 24_000;
const CHAT_CLI_MESSAGE_HISTORY_FALLBACK_HIGH_WATER_CHARS = 40_000;
const CHAT_CLI_PRIOR_MESSAGE_LIMIT = 10;
const CHAT_CLI_MODEL_OUTPUT_MAX_LINES = 200;
const CHAT_CLI_MODEL_OUTPUT_MAX_LINE_WIDTH = 400;
const CHAT_CLI_RECOMMENDED_BATCH_COMMANDS = 4;
const CHAT_CLI_BATCH_GUIDANCE = `Use one command per \`\`\`shell block and at most ${CHAT_CLI_RECOMMENDED_BATCH_COMMANDS} \`\`\`shell blocks per response.`;
const CHAT_CLI_COMMAND_NAMES = new Set(['cd', 'pwd', 'ls', 'cat', 'head', 'tail', 'nl', 'find', 'rg', 'grep', 'sort', 'uniq', 'wc', 'tr', 'xargs', 'cp', 'mv', 'rm', 'echo', 'sed', 'true', 'hvy', 'db-table', 'form', 'ask']);
const CHAT_CLI_NATIVE_TOOL_COMMAND_NAMES = getHvyCliPreferredCommandSummary()
  .replace(/^Commands:\s*/, '')
  .replace(/\.\s*Ask:.*$/, '');
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
  toolState?: ProviderToolState;
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
  toolState?: ProviderToolState;
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
  toolTurn?: ProxyToolTurn;
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
    ...(initial.toolState ? { toolState: initial.toolState } : {}),
    ...(params.selectedComponent ? { selectedComponent: params.selectedComponent } : {}),
  };
  if ((params.priorMessages ?? []).some((message) => message.role === 'assistant' && message.work)) {
    recordIntroducedDiagnostics(params.document, [], turnState.diagnostics);
  }
  syncIntroducedDiagnostics(params.document, turnState.diagnostics);
  let consecutiveCommandErrors = 0;
  let latestTokenUsage: ChatTokenUsage | null = null;

  for (let step = 0; step < CHAT_CLI_MAX_STEPS; step += 1) {
    throwIfAborted(params.signal);
    let currentInputTokens: number | undefined;
    const nativeTurn = await requestProxyToolTurn({
      settings: params.settings,
      messages: turnState.messages,
      context: turnState.context,
      systemInstructions: turnState.systemInstructions,
      mode: 'document-edit',
      debugLabel: `chat-cli-edit:${step + 1}`,
      traceRunId,
      tools: buildChatCliNativeToolDefinitions(),
      ...(turnState.toolState ? { toolState: turnState.toolState } : {}),
      onReasoningSummary: params.onReasoningSummary,
      onTokenUsage: (usage) => {
        latestTokenUsage = usage;
        currentInputTokens = usage.inputTokens;
        params.onTokenUsage?.(usage);
      },
      signal: params.signal,
    });
    const advanced = nativeTurn.toolCalls.length > 0
      ? await advanceChatCliNativeToolTurnState({
          settings: params.settings,
          document: params.document,
          state: turnState,
          turn: nativeTurn,
          signal: params.signal,
          onProgress: params.onProgress,
          traceRunId,
          writeTrace: true,
          lastInputTokens: currentInputTokens,
        })
      : await advanceChatCliTurnState({
      settings: params.settings,
      document: params.document,
      state: turnState,
      assistantOutput: nativeTurn.output,
      signal: params.signal,
      onProgress: params.onProgress,
      traceRunId,
      writeTrace: true,
      lastInputTokens: currentInputTokens,
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
    ...(initial.toolState ? { toolState: initial.toolState } : {}),
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
    ...(initial.toolState ? { toolState: initial.toolState } : {}),
    ...(params.selectedComponent ? { selectedComponent: params.selectedComponent } : {}),
  };
}

export async function advanceChatCliSimTurnState(params: {
  settings?: ChatSettings;
  document: VisualDocument;
  state: ChatCliSimTurnState;
  assistantOutput: string;
  toolTurn?: ProxyToolTurn;
  signal?: AbortSignal;
}): Promise<ChatCliSimAdvanceResult> {
  return params.toolTurn
    ? advanceChatCliNativeToolTurnState({ ...params, turn: params.toolTurn })
    : advanceChatCliTurnState(params);
}

async function advanceChatCliNativeToolTurnState(params: {
  settings?: ChatSettings;
  document: VisualDocument;
  state: ChatCliSimTurnState;
  turn: ProxyToolTurn;
  signal?: AbortSignal;
  onProgress?: (content: string) => void;
  traceRunId?: string;
  writeTrace?: boolean;
  lastInputTokens?: number;
}): Promise<ChatCliSimAdvanceResult> {
  throwIfAborted(params.signal);
  const cli = createChatCliInterface(params.document, params.state.session);
  const results: ProviderToolResult[] = [];
  const commandOutputs: Array<{ command: string; output: string }> = [];
  let mutated = false;
  let batchHadSuccess = false;
  let batchHadError = false;
  let lastFailedCommand = '';
  let lastCommandError = '';
  let terminalSummary = '';
  let askedQuestion = '';

  for (const call of params.turn.toolCalls) {
    if (call.name === 'finish_task') {
      terminalSummary = getStringToolArg(call, 'summary');
      results.push({ callId: call.id, output: JSON.stringify({ ok: true }) });
      continue;
    }
    if (call.name === 'ask_user') {
      askedQuestion = getStringToolArg(call, 'question');
      results.push({ callId: call.id, output: JSON.stringify({ ok: true }) });
      continue;
    }
    if (call.name !== 'run_hvy_cli') {
      const output = JSON.stringify({
        stdout: '',
        stderr: `Unknown tool: ${call.name}`,
        exit_code: 1,
        cwd: cli.snapshot().cwd,
        mutated: false,
      });
      results.push({ callId: call.id, output, isError: true });
      batchHadError = true;
      lastFailedCommand = call.name;
      lastCommandError = `Unknown tool: ${call.name}`;
      continue;
    }

    const command = getStringToolArg(call, 'command').trim();
    params.onProgress?.(`$ ${command}`);
    let stdout = '';
    let stderr = '';
    let exitCode = 0;
    let commandMutated = false;
    try {
      if (!command) {
        throw new Error('run_hvy_cli requires a non-empty command.');
      }
      if (/^\s*done(?:\s|$)/.test(command)) {
        throw new Error('Native tool mode uses finish_task({ summary }), not run_hvy_cli with done.');
      }
      if (/^\s*ask(?:\s|$)/.test(command)) {
        throw new Error('Native tool mode uses ask_user({ question }), not run_hvy_cli with ask.');
      }
      const execution = await cli.run(command);
      stdout = execution.output;
      commandMutated = execution.mutated && !isSessionOnlyCommand(command);
      mutated = mutated || commandMutated;
      batchHadSuccess = true;
      commandOutputs.push({ command, output: formatOutputForModel(stdout, CHAT_CLI_MODEL_OUTPUT_MAX_LINES) });
      if (params.writeTrace && params.traceRunId) {
        await writeChatCliCommandTrace(params.traceRunId, command, stdout, params.signal);
      }
    } catch (error) {
      stderr = error instanceof Error ? error.message : String(error);
      exitCode = 1;
      batchHadError = true;
      lastFailedCommand = command;
      lastCommandError = stderr;
      commandOutputs.push({ command, output: stderr });
      if (params.writeTrace && params.traceRunId) {
        await writeChatCliCommandTrace(params.traceRunId, command, stderr, params.signal);
        await writeChatCliFailedCommandTrace(params.traceRunId, command, stderr, params.signal);
      }
    }
    results.push({
      callId: call.id,
      output: JSON.stringify({
        stdout,
        stderr,
        exit_code: exitCode,
        cwd: cli.snapshot().cwd,
        mutated: commandMutated,
      }),
      ...(exitCode === 0 ? {} : { isError: true }),
    });
  }

  if (terminalSummary) {
    const diagnostics = await collectHvyCliDiagnostics(params.document);
    recordIntroducedDiagnostics(params.document, params.state.diagnostics, diagnostics);
    syncIntroducedDiagnostics(params.document, diagnostics);
    const introducedIssues = getIntroducedDiagnostics(params.document);
    if (introducedIssues.length > 0) {
      const message = formatIntroducedLintIssuesPrompt(introducedIssues);
      const toolState = await compactChatCliToolState({
        toolState: appendProviderToolResultsToState(params.turn.toolState, params.turn, [
          ...results.filter((result) => result.callId !== params.turn.toolCalls.find((call) => call.name === 'finish_task')?.id),
          {
            callId: params.turn.toolCalls.find((call) => call.name === 'finish_task')?.id ?? '',
            output: JSON.stringify({ ok: false, stderr: message }),
            isError: true,
          },
        ]),
        settings: params.settings ?? params.state.settings,
        request: params.state.request,
        lastInputTokens: params.lastInputTokens,
        signal: params.signal,
        traceRunId: params.traceRunId,
      });
      return {
        ...buildSimAdvanceResult({ ...params, assistantOutput: params.turn.output }, params.state.messages, message, false, params.state.urgency, diagnostics),
        toolTurn: params.turn,
        toolState,
      };
    }
    return {
      ...params.state,
      terminalSummary,
      commandResultMessage: `finish_task ${terminalSummary}`,
      mutated: false,
      toolTurn: params.turn,
      toolState: appendProviderToolResultsToState(params.turn.toolState, params.turn, results),
    };
  }
  if (askedQuestion) {
    return {
      ...params.state,
      askedQuestion,
      commandResultMessage: `ask_user ${askedQuestion}`,
      mutated: false,
      toolTurn: params.turn,
      toolState: appendProviderToolResultsToState(params.turn.toolState, params.turn, results),
    };
  }

  const urgency = batchHadSuccess ? updateChatCliUrgency(params.state.urgency, mutated) : params.state.urgency;
  const commandResultMessage = formatToolCommandResultDisplay(formatBatchCommandOutput(commandOutputs), cli.snapshot().cwd);
  const messages = params.state.messages;

  const toolState = await compactChatCliToolState({
    toolState: appendProviderToolResultsToState(params.turn.toolState, params.turn, results),
    settings: params.settings ?? params.state.settings,
    request: params.state.request,
    lastInputTokens: params.lastInputTokens,
    signal: params.signal,
    traceRunId: params.traceRunId,
  });

  return {
    ...buildSimAdvanceResult({ ...params, assistantOutput: params.turn.output }, messages, commandResultMessage, mutated, urgency, params.state.diagnostics),
    batchHadSuccess,
    batchHadError,
    lastFailedCommand,
    lastCommandError,
    toolTurn: params.turn,
    toolState,
  };
}

function getStringToolArg(call: ProviderToolCall, key: string): string {
  const value = call.arguments[key];
  return typeof value === 'string' ? value : '';
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
      if (params.writeTrace && params.traceRunId) {
        await writeChatCliFailedCommandTrace(params.traceRunId, command, lastCommandError, params.signal);
      }
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
    toolState: _toolState,
    toolTurn: _toolTurn,
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
  settings?: ChatSettings;
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
  toolState?: ProviderToolState;
}> {
  const cli = createChatCliInterface(params.document);
  if (params.selectedComponent?.path) {
    cli.session.cwd = params.selectedComponent.path;
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
  const initialSearch = await runInitialCommand(
    'I am searching for the most likely locations related to the user request so I can avoid blind grep-and-edit behavior.',
    `hvy search ${quoteChatCliShellArg(params.request)} --max 5`
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
    initialSearch,
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
  const systemInstructions = buildChatCliLoopSystemInstructions(cli.snapshot().commandSummary);
  const provider = params.settings?.provider ?? 'openai';
  const toolState = buildInitialChatCliToolState({
    provider,
    model: params.settings?.model ?? '',
    messages: [
      ...priorConversation,
      {
        id: crypto.randomUUID(),
        role: 'user',
        content: params.request,
      },
    ],
    context,
    systemInstructions,
    initialOutputs,
  });
  return {
    cli,
    diagnostics,
    priorConversation,
    messages,
    context,
    systemInstructions,
    toolState,
    traceRunId: params.traceRunId,
  };
}

function buildInitialChatCliToolState(params: {
  provider: ChatSettings['provider'];
  model: string;
  messages: ChatMessage[];
  context: string;
  systemInstructions: string;
  initialOutputs: Array<{ command: string; output: string }>;
}): ProviderToolState {
  let state = buildInitialProviderToolState({
    provider: params.provider,
    model: params.model,
    mode: 'document-edit',
    messages: [
      {
        role: 'system',
        content: params.systemInstructions,
      },
      ...params.messages,
    ],
    context: params.context,
    tools: buildChatCliNativeToolDefinitions(),
  });
  for (let index = 0; index < params.initialOutputs.length; index += 1) {
    const output = params.initialOutputs[index];
    if (!output) {
      continue;
    }
    const callId = `startup_call_${index + 1}`;
    const turn = buildSyntheticChatCliToolTurn(params.provider, callId, output.command);
    state = appendProviderToolResultsToState(state, turn, [{
      callId,
      output: JSON.stringify({
        stdout: output.output,
        stderr: '',
        exit_code: 0,
        cwd: '/',
        mutated: false,
      }),
    }]);
  }
  return state;
}

function buildSyntheticChatCliToolTurn(provider: ChatSettings['provider'], callId: string, command: string): ProviderToolTurn {
  if (provider === 'anthropic') {
    return {
      output: '',
      reasoningSummary: '',
      toolCalls: [{ id: callId, name: 'run_hvy_cli', arguments: { command } }],
      nativeMessages: [{
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: callId,
          name: 'run_hvy_cli',
          input: { command },
        }],
      }],
    };
  }
  if (provider === 'qwen') {
    return {
      output: '',
      reasoningSummary: '',
      toolCalls: [{ id: callId, name: 'run_hvy_cli', arguments: { command } }],
      nativeMessages: [{
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: callId,
          type: 'function',
          function: {
            name: 'run_hvy_cli',
            arguments: JSON.stringify({ command }),
          },
        }],
      }],
    };
  }
  return {
    output: '',
    reasoningSummary: '',
    toolCalls: [{ id: callId, name: 'run_hvy_cli', arguments: { command } }],
    nativeMessages: [{
      type: 'function_call',
      call_id: callId,
      name: 'run_hvy_cli',
      arguments: JSON.stringify({ command }),
    }],
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
    'The current directory starts at the selected component. Use the selected path, parent path, previews, and request_structure output to decide whether the request should edit this component, add nested content, or add a sibling nearby.',
  ].join('\n');
}

function getParentVirtualPath(path: string): string {
  const normalized = path.replace(/\/+$/, '');
  const index = normalized.lastIndexOf('/');
  if (index <= 0) {
    return '/';
  }
  return normalized.slice(0, index);
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
    'Use the provided tools instead of writing terminal commands as text.',
    'Use run_hvy_cli for HVY virtual CLI commands.',
    `Call run_hvy_cli at most ${CHAT_CLI_RECOMMENDED_BATCH_COMMANDS} times per response.`,
    'Use finish_task for the final user-facing completion summary after validating the edit.',
    'Use ask_user only for user requirement questions, not CLI syntax questions.',
    'Do not call run_hvy_cli with done or ask; those are text-mode fallback commands, not native-tool commands.',
    'Do not write completion summaries to /scratchpad.txt.',
  ].join('\n');
}

function buildChatCliLoopSystemInstructions(commandSummary: string): string {
  return [
    buildChatCliPersistentInstructions(),
    '',
    'Valid commands (in order of preference):',
    formatNativeToolCommandSummary(commandSummary),
    '',
    'Response instructions:',
    buildChatCliLoopFormatInstructions(),
  ].join('\n');
}

function formatNativeToolCommandSummary(commandSummary: string): string {
  return commandSummary
    .replace(/ Ask: ask QUESTION\./, ' Ask: use ask_user tool.')
    .replace(/ Finish: done MESSAGE_TO_USER\./, ' Finish: use finish_task tool.');
}

export function buildChatCliNativeToolDefinitions(): ProviderToolDefinition[] {
  return [
    {
      name: 'run_hvy_cli',
      description: `Run exactly one command in the limited HVY virtual CLI. This is not the host OS shell. Valid command names: ${CHAT_CLI_NATIVE_TOOL_COMMAND_NAMES}. Use ask_user and finish_task instead of ask or done.`,
      strict: true,
      inputSchema: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: `One HVY virtual CLI command with no markdown fence. Start with one of: ${CHAT_CLI_NATIVE_TOOL_COMMAND_NAMES}. Do not use an unlisted command.`,
          },
        },
        required: ['command'],
        additionalProperties: false,
      },
    },
    {
      name: 'finish_task',
      description: 'Finish the user request after validating the edits. Use only when no more commands are needed.',
      strict: true,
      inputSchema: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: 'Short user-facing summary of what changed.',
          },
        },
        required: ['summary'],
        additionalProperties: false,
      },
    },
    {
      name: 'ask_user',
      description: 'Ask the user for a requirement choice. Do not use this for CLI syntax questions.',
      strict: true,
      inputSchema: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'The actual question for the user.',
          },
        },
        required: ['question'],
        additionalProperties: false,
      },
    },
  ];
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

function formatToolCommandResultDisplay(output: string, cwd: string): string {
  return [
    `Current directory: ${cwd || '/'}`,
    formatCommandResultOutput(output),
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
      context: 'Compacting older HVY CLI document-edit messages for the next model turn.',
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

async function compactChatCliToolState(params: {
  toolState: ProviderToolState;
  settings?: ChatSettings;
  request: string;
  lastInputTokens?: number;
  signal?: AbortSignal;
  traceRunId?: string;
}): Promise<ProviderToolState> {
  const shouldCompact = typeof params.lastInputTokens === 'number'
    ? params.lastInputTokens >= CHAT_CLI_MESSAGE_HISTORY_HIGH_WATER_TOKENS
    : countProviderToolStateChars(params.toolState) > CHAT_CLI_MESSAGE_HISTORY_FALLBACK_HIGH_WATER_CHARS;
  if (!shouldCompact || !providerToolStateHasToolHistory(params.toolState)) {
    return params.toolState;
  }
  const summary = await summarizeCompactedChatCliToolState({
    settings: params.settings,
    request: params.request,
    toolState: params.toolState,
    signal: params.signal,
    traceRunId: params.traceRunId,
  });
  return rebuildCompactedProviderToolState(params.toolState, [
    '### COMPACTED PRIOR CLI TOOL HISTORY ###',
    summary.trim() || fallbackCompactedChatCliToolStateSummary(params.request, params.toolState),
    '### END COMPACTED PRIOR CLI TOOL HISTORY ###',
  ].join('\n'));
}

async function summarizeCompactedChatCliToolState(params: {
  settings?: ChatSettings;
  request: string;
  toolState: ProviderToolState;
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
            'Summarize this compacted HVY CLI native-tool document-edit history for the next model turn.',
            'Preserve the user goal, completed edits, relevant paths/components, validation results, unresolved errors, current plan, and anything the next turn must not redo.',
            'Write one concise factual message. Do not invent progress.',
            '',
            `Current request:\n${params.request}`,
            '',
            'Compacted provider tool state:',
            formatProviderToolStateForCompactionSummary(params.toolState),
          ].join('\n'),
        },
      ],
      context: 'Compacting older HVY CLI native-tool messages for the next model turn.',
      responseInstructions: 'Return only the compacted summary text.',
      systemInstructions: [
        'You compact HVY CLI native-tool agent history for a later AI model turn.',
        'Be concise, chronological, and factual.',
        'Summarize goal and progress; keep actionable errors and pending work.',
      ].join('\n'),
      mode: 'qa',
      debugLabel: 'chat-cli-tool-compaction',
      traceRunId: params.traceRunId,
      signal: params.signal,
    });
  } catch {
    return fallbackCompactedChatCliToolStateSummary(params.request, params.toolState);
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
  const recent = messages
    .slice(-4)
    .map((message, index) => {
      const label = `${index + 1}. ${message.role}${message.error ? ' error' : ''}`;
      return `${label}\n${compactFallbackMessageContent(message.content)}`;
    })
    .join('\n\n');
  return [
    `Current request: ${request}`,
    `Compacted ${messages.length} older CLI message${messages.length === 1 ? '' : 's'}.`,
    'Automatic summary failed, so this deterministic tail preserves recent compacted context.',
    recent ? `Recent compacted tail:\n${recent}` : '',
  ].join('\n');
}

function fallbackCompactedChatCliToolStateSummary(request: string, toolState: ProviderToolState): string {
  const formatted = formatProviderToolStateForCompactionSummary(toolState);
  const tail = compactFallbackMessageContent(formatted).split('\n').slice(-40).join('\n');
  return [
    `Current request: ${request}`,
    'Compacted older native tool history.',
    'Automatic summary failed, so this deterministic tail preserves recent compacted tool context.',
    tail ? `Recent compacted native-tool tail:\n${tail}` : '',
  ].join('\n');
}

function rebuildCompactedProviderToolState(toolState: ProviderToolState, summary: string): ProviderToolState {
  if (toolState.provider === 'openai') {
    return {
      provider: 'openai',
      input: [
        ...collectOpenAiPinnedToolStateItems(toolState.input),
        {
          role: 'user',
          content: [{ type: 'input_text', text: summary }],
        },
      ],
    };
  }
  if (toolState.provider === 'anthropic') {
    return {
      provider: 'anthropic',
      system: toolState.system,
      messages: [
        ...collectAnthropicPinnedToolStateMessages(toolState.messages),
        { role: 'user', content: summary },
      ],
    };
  }
  return {
    provider: 'qwen',
    messages: [
      ...collectQwenPinnedToolStateMessages(toolState.messages),
      { role: 'user', content: summary },
    ],
  };
}

function collectOpenAiPinnedToolStateItems(input: unknown[]): unknown[] {
  const firstToolIndex = input.findIndex((item) => isRecord(item) && typeof item.type === 'string');
  return firstToolIndex === -1 ? input : input.slice(0, firstToolIndex);
}

function collectAnthropicPinnedToolStateMessages(messages: unknown[]): unknown[] {
  const firstToolIndex = messages.findIndex((message) => {
    if (!isRecord(message)) {
      return false;
    }
    const content = message.content;
    return Array.isArray(content) && content.some((item) => isRecord(item) && (item.type === 'tool_use' || item.type === 'tool_result'));
  });
  return firstToolIndex === -1 ? messages : messages.slice(0, firstToolIndex);
}

function collectQwenPinnedToolStateMessages(messages: unknown[]): unknown[] {
  const firstToolIndex = messages.findIndex((message) => isRecord(message) && (message.role === 'tool' || Array.isArray(message.tool_calls)));
  return firstToolIndex === -1 ? messages : messages.slice(0, firstToolIndex);
}

function providerToolStateHasToolHistory(toolState: ProviderToolState): boolean {
  if (toolState.provider === 'openai') {
    return toolState.input.some((item) => isRecord(item) && typeof item.type === 'string');
  }
  if (toolState.provider === 'anthropic') {
    return toolState.messages.some((message) => {
      if (!isRecord(message) || !Array.isArray(message.content)) {
        return false;
      }
      return message.content.some((item) => isRecord(item) && (item.type === 'tool_use' || item.type === 'tool_result'));
    });
  }
  return toolState.messages.some((message) => isRecord(message) && (message.role === 'tool' || Array.isArray(message.tool_calls)));
}

function countProviderToolStateChars(toolState: ProviderToolState): number {
  return JSON.stringify(toolState).length;
}

function formatProviderToolStateForCompactionSummary(toolState: ProviderToolState): string {
  const payload = toolState.provider === 'openai'
    ? toolState.input
    : toolState.messages;
  return JSON.stringify(payload, null, 2);
}

function compactFallbackMessageContent(content: string): string {
  const lines = content
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  const selected = lines.length > 28 ? lines.slice(-28) : lines;
  const text = selected.join('\n');
  const maxChars = 1400;
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars).trimEnd()}\n[older compacted message content omitted]`;
}

function countMessageChars(messages: ChatMessage[]): number {
  return messages.reduce((total, message) => total + message.content.length, 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isSessionOnlyCommand(command: string): boolean {
  return /\bscratchpad\.txt\b/.test(command);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
}
