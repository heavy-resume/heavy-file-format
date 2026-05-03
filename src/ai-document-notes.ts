import { requestProxyCompletion, traceAgentLoopEvent } from './chat/chat';
import { serializeDocument } from './serialization';
import type { ChatSettings, VisualDocument } from './types';
import { buildDocumentNoteFormatInstructions, buildDocumentNotePrompt } from './ai-document-edit-instructions';
import type { DocumentStructureSnapshot } from './ai-document-edit-types';
import { truncateMultiline } from './ai-document-loop-state';

export interface DocumentWalkChunks {
  text: string;
  chunkCount: number;
}

export async function requestAiDocumentNotes(params: {
  settings: ChatSettings;
  request: string;
  chunks: DocumentWalkChunks;
  onProgress?: (content: string) => void;
  traceRunId?: string;
  signal?: AbortSignal;
}): Promise<string> {
  params.onProgress?.('Reviewing document chunks and taking section notes.');
  const notes = await requestProxyCompletion({
    settings: params.settings,
    messages: [
      {
        id: crypto.randomUUID(),
        role: 'user',
        content: buildDocumentNotePrompt(params.request),
      },
    ],
    context: params.chunks.text,
    formatInstructions: buildDocumentNoteFormatInstructions(),
    mode: 'document-edit',
    debugLabel: 'ai-document-notes',
    traceRunId: params.traceRunId,
    signal: params.signal,
  });
  const trimmed = notes.trim();
  console.debug('[hvy:ai-document-edit] AI document notes', {
    chunks: params.chunks.chunkCount,
    notes: trimmed,
  });
  if (params.traceRunId) {
    traceAgentLoopEvent({
      runId: params.traceRunId,
      phase: 'document-edit',
      type: 'client_event',
      payload: {
        event: 'ai_document_notes',
        chunks: params.chunks.chunkCount,
        notes: trimmed,
      },
      signal: params.signal,
    });
  }
  return trimmed || 'No AI notes were returned.';
}

export function buildDocumentWalkChunks(document: VisualDocument, snapshot: DocumentStructureSnapshot): DocumentWalkChunks {
  const serializedLines = serializeDocument(document).split('\n');
  const bodyStartIndex = findSerializedBodyStartIndex(serializedLines);
  const bodyLines = serializedLines.slice(bodyStartIndex);
  const chunks: string[] = [];
  let currentSection = '(before first section)';
  let chunkStart = 0;
  for (let index = 0; index < bodyLines.length; index += 1) {
    const line = bodyLines[index] ?? '';
    if (/^\s*<!--hvy:(?:subsection\s*)?\s*\{/.test(line)) {
      if (index > chunkStart) {
        chunks.push(formatDocumentWalkChunk(bodyLines, chunkStart, index - 1, currentSection));
      }
      currentSection = findNextSectionTitle(bodyLines, index) ?? currentSection;
      chunkStart = index;
      continue;
    }
    if (index - chunkStart + 1 >= 100) {
      chunks.push(formatDocumentWalkChunk(bodyLines, chunkStart, index, currentSection));
      chunkStart = index + 1;
    }
  }
  if (chunkStart < bodyLines.length) {
    chunks.push(formatDocumentWalkChunk(bodyLines, chunkStart, bodyLines.length - 1, currentSection));
  }

  const text = [
    'Serialized document chunks for AI note-taking (section-by-section, up to 100 serialized lines per chunk):',
    ...chunks.slice(0, 80),
    ...(chunks.length > 80 ? [`... ${chunks.length - 80} more serialized chunks omitted.`] : []),
    '',
    'Reduced component/section index:',
    snapshot.summary,
  ].join('\n');
  return {
    text,
    chunkCount: chunks.length,
  };
}

export function logDocumentWalkChunks(chunks: DocumentWalkChunks, traceRunId: string | undefined, signal: AbortSignal | undefined): void {
  console.debug('[hvy:ai-document-edit] serialized document chunks', {
    chunks: chunks.chunkCount,
    context: chunks.text,
  });
  if (!traceRunId) {
    return;
  }
  traceAgentLoopEvent({
    runId: traceRunId,
    phase: 'document-edit',
    type: 'client_event',
    payload: {
      event: 'document_walk_chunks',
      chunks: chunks.chunkCount,
      context: chunks.text,
    },
    signal,
  });
}

function findSerializedBodyStartIndex(lines: string[]): number {
  if (lines[0] !== '---') {
    return 0;
  }
  const closingIndex = lines.findIndex((line, index) => index > 0 && line === '---');
  return closingIndex >= 0 ? closingIndex + 1 : 0;
}

function findNextSectionTitle(lines: string[], directiveIndex: number): string | null {
  for (let index = directiveIndex + 1; index < Math.min(lines.length, directiveIndex + 8); index += 1) {
    const match = (lines[index] ?? '').match(/^\s*#!+\s*(.+?)\s*$/);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

function formatDocumentWalkChunk(lines: string[], startIndex: number, endIndex: number, sectionTitle: string): string {
  const chunkLines = lines.slice(startIndex, endIndex + 1);
  const refs = extractWalkChunkRefs(chunkLines);
  const preview = chunkLines
    .map((line, index) => `${String(startIndex + index + 1).padStart(4, ' ')} | ${line}`)
    .join('\n');
  return [
    `Walk note: section="${sectionTitle}" lines=${startIndex + 1}-${endIndex + 1}${refs ? ` refs=${refs}` : ''}`,
    truncateMultiline(preview, 3000),
  ].join('\n');
}

function extractWalkChunkRefs(lines: string[]): string {
  const refs = new Set<string>();
  for (const line of lines) {
    const directiveMatch = line.match(/<!--hvy:[^>]*?(\{.*\})\s*-->/);
    if (!directiveMatch?.[1]) {
      continue;
    }
    try {
      const payload = JSON.parse(directiveMatch[1]) as Record<string, unknown>;
      if (typeof payload.id === 'string' && payload.id.trim()) {
        refs.add(payload.id.trim());
      }
      if (typeof payload.xrefTarget === 'string' && payload.xrefTarget.trim()) {
        refs.add(payload.xrefTarget.trim());
      }
    } catch {
      // Ignore malformed directive previews; parser diagnostics handle validity elsewhere.
    }
  }
  return [...refs].slice(0, 20).join(', ');
}
