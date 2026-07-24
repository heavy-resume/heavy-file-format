import { buildSemanticRetrievalChunks } from './semantic-candidates';
import type { VisualDocument } from '../types';

const DEFAULT_WALK_LIMIT = 8;
const MAX_WALK_LIMIT = 20;
const WALK_ITEM_CHARS = 2_000;
const WALK_CURSOR_PREFIX = 'hvy-walk:';

export interface HvyDocumentWalkItem {
  path: string;
  kind: 'section' | 'component';
  type: string;
  label: string;
  context?: string;
  content: string;
  chunk?: {
    index: number;
    count: number;
  };
}

export interface HvyDocumentWalkResult {
  items: HvyDocumentWalkItem[];
  reviewedThrough: number;
  totalItems: number;
  nextCursor?: string;
}

export function walkHvyDocument(options: {
  document: VisualDocument;
  limit?: number;
  cursor?: string;
}): HvyDocumentWalkResult {
  const limit = Math.max(1, Math.min(MAX_WALK_LIMIT, Math.floor(options.limit ?? DEFAULT_WALK_LIMIT)));
  const offset = parseWalkCursor(options.cursor);
  const chunks = buildSemanticRetrievalChunks(options.document, {
    targetChunkChars: WALK_ITEM_CHARS,
    overlapChars: 0,
    preserveLeafTargets: true,
  })
    .filter((chunk) => Boolean(chunk.targetPath?.trim()))
    .sort((left, right) => left.documentOrder - right.documentOrder);
  if (offset > chunks.length) {
    throw new Error('HVY walk cursor is beyond the end of the document.');
  }
  const selected = chunks.slice(offset, offset + limit);
  const reviewedThrough = offset + selected.length;
  return {
    items: selected.map((chunk): HvyDocumentWalkItem => ({
      path: chunk.targetPath?.trim() ?? '',
      kind: chunk.targetKind === 'section' ? 'section' : 'component',
      type: chunk.targetKind === 'section' ? 'section' : chunk.componentType || 'component',
      label: chunk.label,
      ...(chunk.contextLabel?.trim() ? { context: chunk.contextLabel.trim() } : {}),
      content: chunk.summary,
      ...(chunk.windowChunk
        ? { chunk: { index: chunk.windowChunk.index + 1, count: chunk.windowChunk.count } }
        : {}),
    })),
    reviewedThrough,
    totalItems: chunks.length,
    ...(reviewedThrough < chunks.length ? { nextCursor: formatWalkCursor(reviewedThrough) } : {}),
  };
}

function parseWalkCursor(cursor: string | undefined): number {
  if (!cursor) {
    return 0;
  }
  const match = cursor.match(/^hvy-walk:(\d+)$/);
  if (!match) {
    throw new Error('Invalid HVY walk cursor.');
  }
  return Number(match[1]);
}

function formatWalkCursor(offset: number): string {
  return `${WALK_CURSOR_PREFIX}${offset}`;
}
