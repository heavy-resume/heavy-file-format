import { createHvyAgentTools } from './agent-tools';
import { executeHvyCliCommand, getHvyCliPreferredCommandSummary } from './cli-core/commands';
import { walkHvyDocument } from './search/hvy-document-walk';
import type { HvyChatContextOptions, HvyEmbeddingProvider, VisualDocument } from './types';

export interface HvyWebMcpTool {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  annotations?: Record<string, boolean>;
  execute(input: Record<string, unknown>): unknown | Promise<unknown>;
}

export interface HvyWebMcpModelContext {
  registerTool(
    tool: HvyWebMcpTool,
    options?: { signal?: AbortSignal; exposedTo?: string[] }
  ): void | Promise<void>;
}

export interface HvyWebMcpToolContext {
  getDocument(): VisualDocument;
}

export interface HvyWebMcpOptions {
  /**
   * Replaces the default tools when an array is supplied. A callback can
   * return the defaults plus host tools, omit defaults, or replace a default
   * tool's execute function while retaining its public contract.
   */
  tools?: readonly HvyWebMcpTool[] | ((
    defaultTools: readonly HvyWebMcpTool[],
    context: HvyWebMcpToolContext
  ) => readonly HvyWebMcpTool[]);
  modelContext?: HvyWebMcpModelContext | null;
  exposedTo?: string[];
  onError?: (error: unknown) => void;
}

export interface HvyWebMcpDocumentToolsOptions {
  getDocument(): VisualDocument;
  embeddingProvider?: HvyEmbeddingProvider | null;
  chatContext?: HvyChatContextOptions | null;
  beforeMutation?: () => void;
  onMutation?: (mutation: HvyWebMcpMutation) => void;
}

export interface HvyWebMcpMutation {
  paths?: string[];
  refreshSectionPaths?: string[];
  requiresFullRefresh?: boolean;
}

export interface HvyWebMcpRegistration {
  registered: boolean;
  tools: readonly HvyWebMcpTool[];
  destroy(): void;
}

export function createHvyWebMcpDocumentTools(options: HvyWebMcpDocumentToolsOptions): HvyWebMcpTool[] {
  let activeDocument: VisualDocument | null = null;
  let activeAgentTools: ReturnType<typeof createHvyAgentTools> | null = null;
  const getAgentTools = (): ReturnType<typeof createHvyAgentTools> => {
    const document = options.getDocument();
    if (!activeAgentTools || activeDocument !== document) {
      activeDocument = document;
      activeAgentTools = createHvyAgentTools({
        document,
        embeddingProvider: options.embeddingProvider,
        chatContext: options.chatContext,
      });
    }
    return activeAgentTools;
  };
  return [
    {
      name: 'run_hvy_cli',
      description: `Inspect or modify the HVY document using a faux CLI interface. Supported ${getHvyCliPreferredCommandSummary().replace(/^Commands:/, 'commands:')}`,
      inputSchema: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'One HVY virtual CLI command.',
          },
        },
        required: ['command'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      execute: async (input) => {
        const command = requiredString(input, 'command', 'run_hvy_cli');
        options.beforeMutation?.();
        const agentTools = getAgentTools();
        const result = await executeHvyCliCommand(options.getDocument(), agentTools.getCliSession(), command);
        if (result.mutated) {
          options.onMutation?.({
            paths: result.mutatedPaths,
            refreshSectionPaths: result.refreshSectionPaths,
            requiresFullRefresh: result.requiresFullRefresh,
          });
        }
        return result;
      },
    },
    {
      name: 'search_hvy_document',
      description: 'Find ranked candidate sections or components related to a concept in the open HVY document.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Concept or content to find.' },
          limit: { type: 'integer', minimum: 1, maximum: 20 },
          cursor: { type: 'string', description: 'Continuation cursor returned by a previous search.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      execute: (input) => getAgentTools().search({
        query: requiredString(input, 'query', 'search_hvy_document'),
        ...(finiteInteger(input.limit) ? { limit: input.limit } : {}),
        ...(typeof input.cursor === 'string' && input.cursor ? { cursor: input.cursor } : {}),
      }),
    },
    {
      name: 'walk_hvy_document',
      description: 'Read the open HVY document exhaustively in document order. Continue with nextCursor until it is absent.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 20 },
          cursor: { type: 'string', description: 'Continuation cursor returned by the previous walk.' },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      execute: (input) => walkHvyDocument({
        document: options.getDocument(),
        ...(finiteInteger(input.limit) ? { limit: input.limit } : {}),
        ...(typeof input.cursor === 'string' && input.cursor ? { cursor: input.cursor } : {}),
      }),
    },
    {
      name: 'apply_hvy_patch',
      description: 'Change existing content in the open HVY document by describing the exact text to find and what should replace it. Use run_hvy_cli to find writable virtual file paths and read their current contents first.',
      inputSchema: {
        type: 'object',
        properties: {
          patch: {
            type: 'string',
            description: `A text replacement instruction in this exact format:
*** Begin Patch
*** Update File: /absolute/virtual/path
@@
 unchanged line kept for context
-exact old line to remove
+exact new line to insert
*** End Patch
Do not include line numbers: this patch format locates the change by searching the named virtual file for the exact sequence of unchanged and removed lines after @@. Every content line after @@ must begin with one marker character: a space keeps an existing line as matching context, - removes an existing line, and + inserts a new line. The unchanged and removed text must exactly match the current virtual file. Include enough unchanged lines around the edit so that the sequence occurs in exactly one location; the patch fails instead of guessing when there are zero or multiple matches. Add another @@ block for another change in the same file, or another Update File block for a different existing file. Only paths inside the open HVY document are accepted.`,
          },
        },
        required: ['patch'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      execute: (input) => {
        options.beforeMutation?.();
        const result = getAgentTools().applyPatch(requiredString(input, 'patch', 'apply_hvy_patch'));
        if (result.appliedFileCount > 0) {
          options.onMutation?.({
            paths: result.mutatedPaths,
            refreshSectionPaths: result.refreshSectionPaths,
            requiresFullRefresh: result.requiresFullRefresh,
          });
        }
        return result;
      },
    },
  ];
}

export function registerHvyWebMcpTools(
  options: HvyWebMcpOptions,
  documentTools: HvyWebMcpDocumentToolsOptions
): HvyWebMcpRegistration {
  const context: HvyWebMcpToolContext = { getDocument: documentTools.getDocument };
  const defaults = createHvyWebMcpDocumentTools(documentTools);
  const tools = typeof options.tools === 'function'
    ? [...options.tools(defaults, context)]
    : options.tools
      ? [...options.tools]
      : defaults;
  assertUniqueToolNames(tools);
  const modelContext = 'modelContext' in options ? options.modelContext : getDocumentModelContext();
  if (!modelContext) {
    return { registered: false, tools, destroy() { } };
  }
  const controller = new AbortController();
  const registrationOptions = {
    signal: controller.signal,
    ...(options.exposedTo ? { exposedTo: options.exposedTo } : {}),
  };
  for (const tool of tools) {
    Promise.resolve(modelContext.registerTool(tool, registrationOptions)).catch((error) => {
      if (!controller.signal.aborted) options.onError?.(error);
    });
  }
  return {
    registered: true,
    tools,
    destroy: () => controller.abort(),
  };
}

function getDocumentModelContext(): HvyWebMcpModelContext | null {
  if (typeof document === 'undefined') return null;
  const context = (document as Document & { modelContext?: HvyWebMcpModelContext }).modelContext;
  return context && typeof context.registerTool === 'function' ? context : null;
}

function assertUniqueToolNames(tools: readonly HvyWebMcpTool[]): void {
  const names = new Set<string>();
  for (const tool of tools) {
    if (!tool.name.trim()) throw new Error('WebMCP tool names must not be empty.');
    if (names.has(tool.name)) throw new Error(`Duplicate WebMCP tool name "${tool.name}".`);
    names.add(tool.name);
  }
}

function requiredString(input: Record<string, unknown>, key: string, toolName: string): string {
  const value = input[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${toolName} requires a non-empty ${key}.`);
  }
  return value;
}

function finiteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}
