import { HVY_AI_RESPONSE_FORMAT_INSTRUCTIONS, buildChatDocumentContext, requestProxyToolTurn } from './chat';
import { appendProviderToolResultsToState, type ProviderToolDefinition, type ProviderToolResult } from './provider-tools';
import { getDocumentAiContext } from '../document-ai-context';
import { createHvyCliSession, executeHvyCliCommand } from '../cli-core/commands';
import { searchHvyDocumentForAgent } from '../search/hvy-document-search';
import { walkHvyDocument } from '../search/hvy-document-walk';
import type {
  ChatMessage,
  ChatSettings,
  ChatTokenUsage,
  HvyChatContextOptions,
  HvyChatContextPreparationCallback,
  HvyChatContextProvider,
  HvyEmbeddingProvider,
  VisualDocument,
} from '../types';

const VIEWER_AGENT_MAX_STEPS = 12;
const loadDbTableRuntime = () => import('../plugins/db-table');

export interface ViewerAgentResult {
  answer: string;
  reasoningSummary?: string;
  tokenUsage?: ChatTokenUsage;
}

export async function runViewerAgent(params: {
  settings: ChatSettings;
  document: VisualDocument;
  messages: ChatMessage[];
  question: string;
  chatContext?: HvyChatContextOptions | null;
  chatContextProvider?: HvyChatContextProvider | null;
  embeddingProvider?: HvyEmbeddingProvider | null;
  onContextPreparation?: HvyChatContextPreparationCallback;
  signal?: AbortSignal;
}): Promise<ViewerAgentResult> {
  const context = await buildViewerAgentContext(params);
  const systemInstructions = buildViewerAgentInstructions(params.chatContext?.mode ?? 'full-document');
  const tools = buildViewerAgentToolDefinitions();
  let toolState;
  let reasoningSummary = '';
  let tokenUsage: ChatTokenUsage | undefined;

  for (let step = 0; step < VIEWER_AGENT_MAX_STEPS; step += 1) {
    const turn = await requestProxyToolTurn({
      settings: params.settings,
      messages: params.messages,
      context,
      systemInstructions,
      mode: 'qa',
      debugLabel: `viewer-agent:${step + 1}`,
      tools,
      ...(toolState ? { toolState } : {}),
      onReasoningSummary: (summary) => {
        reasoningSummary = summary;
      },
      onTokenUsage: (usage) => {
        tokenUsage = usage;
      },
      maxContextChars: params.chatContext?.maxContextChars,
      signal: params.signal,
    });

    if (turn.toolCalls.length === 0) {
      const answer = turn.output.trim();
      if (!answer) {
        throw new Error('Viewer agent returned neither an answer nor a tool call.');
      }
      return { answer, ...(reasoningSummary ? { reasoningSummary } : {}), ...(tokenUsage ? { tokenUsage } : {}) };
    }

    const answerCall = turn.toolCalls.find((call) => call.name === 'answer_user');
    if (answerCall) {
      const answer = getStringArg(answerCall.arguments, 'answer').trim();
      if (!answer) {
        throw new Error('answer_user requires a non-empty answer.');
      }
      return { answer, ...(reasoningSummary ? { reasoningSummary } : {}), ...(tokenUsage ? { tokenUsage } : {}) };
    }

    const results: ProviderToolResult[] = [];
    for (const call of turn.toolCalls) {
      try {
        results.push({ callId: call.id, output: await executeViewerTool(call.name, call.arguments, params) });
      } catch (error) {
        results.push({
          callId: call.id,
          output: error instanceof Error ? error.message : String(error),
          isError: true,
        });
      }
    }
    toolState = appendProviderToolResultsToState(turn.toolState, turn, results);
  }

  throw new Error(`Viewer agent stopped after ${VIEWER_AGENT_MAX_STEPS} steps without answering.`);
}

async function buildViewerAgentContext(params: {
  settings: ChatSettings;
  document: VisualDocument;
  messages: ChatMessage[];
  question: string;
  chatContext?: HvyChatContextOptions | null;
  chatContextProvider?: HvyChatContextProvider | null;
  onContextPreparation?: HvyChatContextPreparationCallback;
  signal?: AbortSignal;
}): Promise<string> {
  const mode = params.chatContext?.mode ?? 'full-document';
  if (params.chatContextProvider) {
    await params.onContextPreparation?.({ phase: 'preparing-context', cached: false });
    const supplied = await params.chatContextProvider.buildContext({
      document: params.document,
      question: params.question,
      messages: params.messages,
      maxContextChars: params.chatContext?.maxContextChars ?? params.settings?.maxContextChars ?? 60_000,
      mode: 'qa',
      ...(params.signal ? { signal: params.signal } : {}),
    });
    await params.onContextPreparation?.({ phase: 'context-ready', cached: false });
    return supplied.context;
  }
  if (mode === 'full-document') {
    return buildChatDocumentContext(params.document);
  }
  const documentAiContext = getDocumentAiContext(params.document);
  return [
    `Viewer document access mode: ${mode}.`,
    'Document content is available through the read-only search, walk, preview, and database tools.',
    ...(documentAiContext ? ['', 'Document context:', documentAiContext] : []),
  ].join('\n');
}

function buildViewerAgentInstructions(mode: HvyChatContextOptions['mode']): string {
  return [
    'You are a read-only Viewer agent chatting with the user about the current HVY document.',
    'Continue naturally from the supplied conversation. Resolve follow-up references from earlier user and assistant messages.',
    'Answer directly when the supplied evidence is sufficient.',
    mode === 'full-document'
      ? 'The request context contains the complete document, but tools remain available for targeted or exhaustive verification.'
      : 'Document content is not automatically inserted. Use search_hvy_document when semantic candidate retrieval can answer the question.',
    'Use walk_hvy_document for exhaustive requests such as finding errors or reviewing all/every occurrence. Continue every nextCursor until absent; search results do not prove completeness.',
    'Use inspect_hvy_path after a search result or conversation identifies a specific path that needs closer inspection.',
    'Use query_db_table for live database rows. It accepts read-only SELECT or WITH queries only.',
    'Never claim to change the document. No mutation capability is available in Viewer mode.',
    'Return a normal answer directly, or call answer_user when finishing after tool use.',
    '',
    HVY_AI_RESPONSE_FORMAT_INSTRUCTIONS,
  ].join('\n');
}

export function buildViewerAgentToolDefinitions(): ProviderToolDefinition[] {
  return [
    {
      name: 'search_hvy_document',
      description: 'Find ranked document paths using embeddings when configured, with lexical fallback. Results are candidates, not exhaustive proof.',
      strict: true,
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Concept or content to find.' },
          limit: { type: ['number', 'null'], description: 'Maximum results from 1 through 20, or null for the default.' },
          cursor: { type: ['string', 'null'], description: 'Continuation cursor, or null for the first page.' },
        },
        required: ['query', 'limit', 'cursor'],
        additionalProperties: false,
      },
    },
    {
      name: 'walk_hvy_document',
      description: 'Read visible document content exhaustively in document order. Follow nextCursor until absent.',
      strict: true,
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: ['number', 'null'], description: 'Maximum items from 1 through 20, or null for the default.' },
          cursor: { type: ['string', 'null'], description: 'Previous nextCursor, or null to start.' },
        },
        required: ['limit', 'cursor'],
        additionalProperties: false,
      },
    },
    {
      name: 'inspect_hvy_path',
      description: 'Preview one known HVY section or component path. This is read-only.',
      strict: true,
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Absolute HVY virtual path returned by search or walk.' } },
        required: ['path'],
        additionalProperties: false,
      },
    },
    {
      name: 'query_db_table',
      description: 'Read rows from an attached SQLite table/view using a table name or a read-only SELECT/WITH query.',
      strict: true,
      inputSchema: {
        type: 'object',
        properties: {
          table_name: { type: ['string', 'null'], description: 'Known table/view name, or null.' },
          query: { type: ['string', 'null'], description: 'Read-only SELECT/WITH query, or null.' },
          limit: { type: ['number', 'null'], description: 'Maximum rows, or null for the default.' },
        },
        required: ['table_name', 'query', 'limit'],
        additionalProperties: false,
      },
    },
    {
      name: 'answer_user',
      description: 'Return the final user-facing answer after tool-assisted inspection.',
      strict: true,
      inputSchema: {
        type: 'object',
        properties: { answer: { type: 'string', description: 'Final answer following the HVY response formatting rules.' } },
        required: ['answer'],
        additionalProperties: false,
      },
    },
  ];
}

async function executeViewerTool(
  name: string,
  args: Record<string, unknown>,
  params: {
    document: VisualDocument;
    chatContext?: HvyChatContextOptions | null;
    embeddingProvider?: HvyEmbeddingProvider | null;
    signal?: AbortSignal;
  }
): Promise<string> {
  if (name === 'search_hvy_document') {
    const query = getStringArg(args, 'query').trim();
    if (!query) throw new Error('search_hvy_document requires a non-empty query.');
    return JSON.stringify(await searchHvyDocumentForAgent({
      document: params.document,
      query,
      ...(getOptionalNumberArg(args, 'limit') !== undefined ? { limit: getOptionalNumberArg(args, 'limit') } : {}),
      ...(getStringArg(args, 'cursor').trim() ? { cursor: getStringArg(args, 'cursor').trim() } : {}),
      ...(params.chatContext ? { chatContext: params.chatContext } : {}),
      ...(params.embeddingProvider ? { embeddingProvider: params.embeddingProvider } : {}),
      ...(params.signal ? { signal: params.signal } : {}),
    }));
  }
  if (name === 'walk_hvy_document') {
    return JSON.stringify(walkHvyDocument({
      document: params.document,
      ...(getOptionalNumberArg(args, 'limit') !== undefined ? { limit: getOptionalNumberArg(args, 'limit') } : {}),
      ...(getStringArg(args, 'cursor').trim() ? { cursor: getStringArg(args, 'cursor').trim() } : {}),
    }));
  }
  if (name === 'inspect_hvy_path') {
    const path = getStringArg(args, 'path').trim();
    if (!path.startsWith('/')) throw new Error('inspect_hvy_path requires an absolute HVY path.');
    const result = await executeHvyCliCommand(params.document, createHvyCliSession(), `hvy preview ${quoteCliArg(path)}`);
    if (result.mutated) throw new Error('Viewer inspection unexpectedly attempted to mutate the document.');
    return result.output;
  }
  if (name === 'query_db_table') {
    const query = getStringArg(args, 'query').trim();
    assertReadOnlySql(query);
    const { executeDbTableQueryTool } = await loadDbTableRuntime();
    return executeDbTableQueryTool(params.document, {
      ...(getStringArg(args, 'table_name').trim() ? { tableName: getStringArg(args, 'table_name').trim() } : {}),
      ...(query ? { query } : {}),
      ...(getOptionalNumberArg(args, 'limit') !== undefined ? { limit: getOptionalNumberArg(args, 'limit') } : {}),
    });
  }
  throw new Error(`Unknown Viewer tool: ${name}`);
}

function assertReadOnlySql(query: string): void {
  if (!query) return;
  const leadingToken = query.replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/u, '').match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? '';
  if (leadingToken !== 'SELECT' && leadingToken !== 'WITH') {
    throw new Error('query_db_table only accepts read-only SELECT or WITH statements in Viewer mode.');
  }
}

function getStringArg(args: Record<string, unknown>, key: string): string {
  return typeof args[key] === 'string' ? args[key] : '';
}

function getOptionalNumberArg(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : undefined;
}

function quoteCliArg(value: string): string {
  return `"${value.replace(/["\\]/g, (match) => `\\${match}`)}"`;
}
