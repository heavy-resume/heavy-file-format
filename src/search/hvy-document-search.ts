import { searchHvyDocumentByEmbedding } from '../chat/embedding-context';
import { buildHvyVirtualFileSystem } from '../cli-core/virtual-file-system';
import { searchHvyIntent } from '../cli-core/intent-search';
import { buildSemanticFilterCandidates } from './semantic-candidates';
import type {
  HvyChatContextOptions,
  HvyEmbeddingProvider,
  VisualDocument,
} from '../types';

export type HvyAgentSearchMode = 'embeddings' | 'lexical_fallback';

export interface HvyAgentSearchCandidate {
  path: string;
  kind: 'section' | 'component' | 'section-template' | 'doc';
  type: string;
  label: string;
  context?: string;
  excerpt: string;
}

export interface HvyAgentSearchResult {
  mode: HvyAgentSearchMode;
  query: string;
  results: HvyAgentSearchCandidate[];
  nextCursor?: string;
  fallbackReason?: string;
}

export async function searchHvyDocumentForAgent(options: {
  document: VisualDocument;
  query: string;
  limit?: number;
  cursor?: string;
  semantic?: boolean;
  embeddingProvider?: HvyEmbeddingProvider | null;
  chatContext?: HvyChatContextOptions | null;
  signal?: AbortSignal;
}): Promise<HvyAgentSearchResult> {
  const query = options.query.trim();
  const limit = Math.max(1, Math.min(20, Math.floor(options.limit ?? 5)));
  const offset = parseCursor(options.cursor);
  if (!query) {
    return { mode: getPreferredMode(options), query, results: [] };
  }
  if (getPreferredMode(options) === 'embeddings' && options.embeddingProvider) {
    try {
      const results = await searchHvyDocumentByEmbedding({
        document: options.document,
        query,
        embeddingProvider: options.embeddingProvider,
        buildMissingDocumentEmbeddings: false,
        maxResults: limit + 1,
        offset,
        ...(options.chatContext ? { chatContext: options.chatContext } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      });
      const candidates = results.flatMap((result): HvyAgentSearchCandidate[] => {
        const path = result.targetPath?.trim();
        if (!path) {
          return [];
        }
        return [{
          path,
          kind: result.targetKind === 'section' ? 'section' : 'component',
          type: result.targetKind === 'section' ? 'section' : result.sourceFile || 'component',
          label: result.label,
          ...(result.contextLabel?.trim() ? { context: result.contextLabel.trim() } : {}),
          excerpt: result.preview.trim(),
        }];
      });
      return {
        mode: 'embeddings',
        query,
        results: candidates.slice(0, limit),
        ...(candidates.length > limit ? { nextCursor: formatCursor(offset + limit) } : {}),
      };
    } catch (error) {
      if (options.signal?.aborted) {
        throw error;
      }
      return lexicalFallback(options.document, query, limit, offset, error instanceof Error ? error.message : String(error));
    }
  }
  return lexicalFallback(options.document, query, limit, offset);
}

function getPreferredMode(options: {
  semantic?: boolean;
  embeddingProvider?: HvyEmbeddingProvider | null;
  chatContext?: HvyChatContextOptions | null;
}): HvyAgentSearchMode {
  if (options.semantic !== undefined) {
    return options.semantic && options.embeddingProvider ? 'embeddings' : 'lexical_fallback';
  }
  return options.embeddingProvider && options.chatContext?.mode === 'embedding-retrieval'
    ? 'embeddings'
    : 'lexical_fallback';
}

function lexicalFallback(
  document: VisualDocument,
  query: string,
  limit: number,
  offset: number,
  fallbackReason?: string
): HvyAgentSearchResult {
  const semanticCandidatesByPath = new Map(
    buildSemanticFilterCandidates(document)
      .filter((candidate) => candidate.targetPath)
      .map((candidate) => [candidate.targetPath!, candidate])
  );
  const candidates = searchHvyIntent(
    document,
    buildHvyVirtualFileSystem(document),
    query,
    Math.min(20, offset + limit + 1)
  );
  return {
    mode: 'lexical_fallback',
    query,
    results: candidates.slice(offset, offset + limit)
      .map((result): HvyAgentSearchCandidate => {
        const semanticCandidate = semanticCandidatesByPath.get(result.path);
        return {
          path: result.path,
          kind: result.kind,
          type: result.type,
          label: semanticCandidate?.label || result.id,
          ...(semanticCandidate?.contextLabel?.trim() ? { context: semanticCandidate.contextLabel.trim() } : {}),
          excerpt: semanticCandidate?.summary.trim()
            || result.visualDescription?.trim()
            || result.description?.trim()
            || result.reason,
        };
      }),
    ...(candidates.length > offset + limit ? { nextCursor: formatCursor(offset + limit) } : {}),
    ...(fallbackReason ? { fallbackReason } : {}),
  };
}

function parseCursor(cursor: string | undefined): number {
  if (!cursor) {
    return 0;
  }
  const match = cursor.match(/^hvy-search:(\d+)$/);
  if (!match) {
    throw new Error('Invalid HVY search cursor.');
  }
  return Number(match[1]);
}

function formatCursor(offset: number): string {
  return `hvy-search:${offset}`;
}
