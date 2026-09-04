import { createHvyCliSession, type HvyCliSession } from './cli-core/commands';
import {
  searchHvyDocumentForAgent,
  type HvyAgentSearchResult,
} from './search/hvy-document-search';
import {
  applyHvyPatch,
  type ApplyHvyPatchResult,
} from './chat-cli/hvy-patch';
import {
  prepareEmbeddingChatContext,
  type HvyEmbeddingCacheBuildStats,
} from './chat/embedding-context';
import type {
  HvyChatContextOptions,
  HvyEmbeddingProvider,
  VisualDocument,
} from './types';

export interface HvyAgentToolsOptions {
  document: VisualDocument;
  embeddingProvider?: HvyEmbeddingProvider | null;
  chatContext?: HvyChatContextOptions | null;
  cliSession?: HvyCliSession;
}

export interface HvyAgentSearchRequest {
  query: string;
  limit?: number;
  cursor?: string;
  semantic?: boolean;
  signal?: AbortSignal;
}

export interface HvyAgentTools {
  search(request: HvyAgentSearchRequest): Promise<HvyAgentSearchResult>;
  buildEmbeddings(signal?: AbortSignal): Promise<HvyEmbeddingCacheBuildStats>;
  applyPatch(patch: string): ApplyHvyPatchResult;
  getCliSession(): HvyCliSession;
}

export function createHvyAgentTools(options: HvyAgentToolsOptions): HvyAgentTools {
  const cliSession = options.cliSession ?? createHvyCliSession();
  const buildEmbeddings = (signal?: AbortSignal): Promise<HvyEmbeddingCacheBuildStats> =>
    prepareEmbeddingChatContext(
      options.document,
      options.chatContext ?? {},
      options.embeddingProvider ?? null,
      signal
    );
  if (options.embeddingProvider) {
    cliSession.buildHvyEmbeddings = async () => `${JSON.stringify(await buildEmbeddings(), null, 2)}\n`;
  }
  return {
    search: (request) => searchHvyDocumentForAgent({
      document: options.document,
      query: request.query,
      ...(request.limit !== undefined ? { limit: request.limit } : {}),
      ...(request.cursor ? { cursor: request.cursor } : {}),
      ...(request.semantic !== undefined ? { semantic: request.semantic } : {}),
      ...(options.embeddingProvider ? { embeddingProvider: options.embeddingProvider } : {}),
      ...(options.chatContext ? { chatContext: options.chatContext } : {}),
      ...(request.signal ? { signal: request.signal } : {}),
    }),
    buildEmbeddings,
    applyPatch: (patch) => applyHvyPatch(options.document, cliSession, patch),
    getCliSession: () => cliSession,
  };
}

export { searchHvyDocumentForAgent, applyHvyPatch };
export type {
  HvyAgentSearchCandidate,
  HvyAgentSearchMode,
  HvyAgentSearchResult,
} from './search/hvy-document-search';
export type {
  ApplyHvyPatchFileResult,
  ApplyHvyPatchResult,
} from './chat-cli/hvy-patch';
export type { HvyCliSession } from './cli-core/commands';
