import {
  createHvyCliSession,
  executeHvyCliCommand,
  getHvyCliPreferredCommandSummary,
  type HvyCliExecution,
  type HvyCliSession,
} from '../cli-core/commands';
import type { HvyChatContextOptions, HvyEmbeddingProvider, VisualDocument } from '../types';
import { searchHvyDocumentForAgent } from '../search/hvy-document-search';

export interface ChatCliCommandResult extends HvyCliExecution {
  command: string;
}

export interface ChatCliSnapshot {
  cwd: string;
  commandSummary: string;
  scratchpad: string;
  scratchpadEdited: boolean;
  scratchpadCommandsSinceEdit: string[];
}

export interface ChatCliInterface {
  readonly session: HvyCliSession;
  run(command: string): Promise<ChatCliCommandResult>;
  snapshot(): ChatCliSnapshot;
}

export function createChatCliInterface(
  document: VisualDocument,
  session: HvyCliSession = createHvyCliSession(),
  searchOptions: {
    chatContext?: HvyChatContextOptions | null;
    embeddingProvider?: HvyEmbeddingProvider | null;
    signal?: AbortSignal;
  } = {}
): ChatCliInterface {
  session.searchHvyDocument = async (args) => {
    const parsed = parseHvySearchArgs(args);
    const result = await searchHvyDocumentForAgent({
      document,
      query: parsed.query,
      limit: parsed.limit,
      ...(parsed.cursor ? { cursor: parsed.cursor } : {}),
      ...(searchOptions.chatContext ? { chatContext: searchOptions.chatContext } : {}),
      ...(searchOptions.embeddingProvider ? { embeddingProvider: searchOptions.embeddingProvider } : {}),
      ...(searchOptions.signal ? { signal: searchOptions.signal } : {}),
    });
    return parsed.json ? `${JSON.stringify(result, null, 2)}\n` : formatHvyAgentSearch(result);
  };
  return {
    session,
    async run(command: string): Promise<ChatCliCommandResult> {
      const result = await executeHvyCliCommand(document, session, command);
      return { command, ...result };
    },
    snapshot(): ChatCliSnapshot {
      return {
        cwd: session.cwd,
        commandSummary: getHvyCliPreferredCommandSummary(),
        scratchpad: session.scratchpadContent ?? '',
        scratchpadEdited: session.scratchpadEdited ?? false,
        scratchpadCommandsSinceEdit: session.scratchpadCommandsSinceEdit ?? [],
      };
    },
  };
}

function parseHvySearchArgs(args: string[]): { query: string; limit: number; cursor?: string; json: boolean } {
  const query = args[0]?.trim() ?? '';
  let limit = 5;
  let cursor: string | undefined;
  let json = false;
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--max') {
      const value = Number(args[index + 1] ?? '');
      if (!Number.isFinite(value) || value < 1) {
        throw new Error('hvy search: --max must be a positive number');
      }
      limit = Math.floor(value);
      index += 1;
      continue;
    }
    if (arg.startsWith('--max=')) {
      const value = Number(arg.slice('--max='.length));
      if (!Number.isFinite(value) || value < 1) {
        throw new Error('hvy search: --max must be a positive number');
      }
      limit = Math.floor(value);
      continue;
    }
    if (arg === '--cursor') {
      cursor = args[index + 1]?.trim();
      if (!cursor) {
        throw new Error('hvy search: --cursor requires a value');
      }
      index += 1;
      continue;
    }
    if (arg.startsWith('--cursor=')) {
      cursor = arg.slice('--cursor='.length).trim();
      if (!cursor) {
        throw new Error('hvy search: --cursor requires a value');
      }
      continue;
    }
    throw new Error(`hvy search: unsupported option ${arg}`);
  }
  if (!query) {
    throw new Error('hvy search: expected a non-empty query');
  }
  return { query, limit, ...(cursor ? { cursor } : {}), json };
}

function formatHvyAgentSearch(result: Awaited<ReturnType<typeof searchHvyDocumentForAgent>>): string {
  const lines = [
    `Search mode: ${result.mode}`,
    ...(result.fallbackReason ? [`Fallback reason: ${result.fallbackReason}`] : []),
    `Search results for: "${result.query}":`,
  ];
  if (result.results.length === 0) {
    lines.push('No results.');
  } else {
    for (const [index, candidate] of result.results.entries()) {
      lines.push(`${index + 1}. ${candidate.path} kind=${candidate.kind} type=${candidate.type}`);
      if (candidate.excerpt) {
        lines.push(`   excerpt: ${candidate.excerpt}`);
      }
    }
  }
  return lines.join('\n');
}
