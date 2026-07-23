import { createHvyCliSession, type HvyCliSession } from './cli-core/commands';
import {
  searchHvyDocumentForAgent,
  type HvyAgentSearchResult,
} from './search/hvy-document-search';
import {
  applyHvyPatch,
  type ApplyHvyPatchResult,
} from './chat-cli/hvy-patch';
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
  signal?: AbortSignal;
}

export interface HvyAgentTools {
  search(request: HvyAgentSearchRequest): Promise<HvyAgentSearchResult>;
  applyPatch(patch: string): ApplyHvyPatchResult;
  getCliSession(): HvyCliSession;
}

export function createHvyAgentTools(options: HvyAgentToolsOptions): HvyAgentTools {
  const cliSession = options.cliSession ?? createHvyCliSession();
  return {
    search: (request) => searchHvyDocumentForAgent({
      document: options.document,
      query: request.query,
      ...(request.limit !== undefined ? { limit: request.limit } : {}),
      ...(request.cursor ? { cursor: request.cursor } : {}),
      ...(options.embeddingProvider ? { embeddingProvider: options.embeddingProvider } : {}),
      ...(options.chatContext ? { chatContext: options.chatContext } : {}),
      ...(request.signal ? { signal: request.signal } : {}),
    }),
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
