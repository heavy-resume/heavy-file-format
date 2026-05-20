import { serializeDocument } from './serialization';
import type { VisualDocument } from './types';
import {
  DEFAULT_VIEW_END_LINE,
  DEFAULT_VIEW_START_LINE,
  MAX_GREP_LINE_WIDTH,
  type ComponentPatchEdit,
  type NumberedLine,
} from './ai-document-edit-types';

export function formatNumberedFragment(fragment: string, startLine = DEFAULT_VIEW_START_LINE, endLine = DEFAULT_VIEW_END_LINE): string {
  const lines = fragment.split('\n');
  const range = clampLineRange(lines.length, startLine, endLine);
  return lines
    .slice(range.startLine - 1, range.endLine)
    .map((line, index) => `${String(range.startLine + index).padStart(3, ' ')} | ${line}`)
    .join('\n');
}

export function formatPatchContextFragment(fragment: string, edits: ComponentPatchEdit[], radius = 6): string {
  const lines = fragment.split('\n');
  if (lines.length <= 80) {
    return formatNumberedFragment(fragment, 1, lines.length);
  }
  const touched = edits.flatMap((edit) => {
    if (edit.op === 'replace' || edit.op === 'delete') {
      return [edit.start_line, edit.end_line];
    }
    return [edit.line];
  });
  const minLine = Math.max(1, Math.min(...touched) - radius);
  const maxLine = Math.min(lines.length, Math.max(...touched) + radius);
  return [
    ...(minLine > 1 ? ['...'] : []),
    formatNumberedFragment(fragment, minLine, maxLine),
    ...(maxLine < lines.length ? ['...'] : []),
  ].join('\n');
}

export function applyComponentPatchEdits(fragment: string, edits: ComponentPatchEdit[]): string {
  let lines = fragment.split('\n');
  for (const edit of edits) {
    if (edit.op === 'replace') {
      assertValidLineRange(lines, edit.start_line, edit.end_line, 'replace');
      lines.splice(
        edit.start_line - 1,
        edit.end_line - edit.start_line + 1,
        ...normalizeReplacementLines(lines.slice(edit.start_line - 1, edit.end_line), edit.text)
      );
      continue;
    }
    if (edit.op === 'delete') {
      assertValidLineRange(lines, edit.start_line, edit.end_line, 'delete');
      lines.splice(edit.start_line - 1, edit.end_line - edit.start_line + 1);
      continue;
    }
    if (edit.op === 'insert_before') {
      assertValidLineNumberForInsert(lines, edit.line, 'insert_before');
      lines.splice(edit.line - 1, 0, ...edit.text.split('\n'));
      continue;
    }
    assertValidLineNumberForInsert(lines, edit.line, 'insert_after');
    lines.splice(edit.line, 0, ...edit.text.split('\n'));
  }
  return lines.join('\n').trim();
}

function normalizeReplacementLines(originalLines: string[], replacementText: string): string[] {
  const replacementLines = replacementText.split('\n');
  if (replacementLines.length === 0 || originalLines.length === 0) {
    return replacementLines;
  }
  const originalIndent = originalLines[0]?.match(/^\s*/)?.[0] ?? '';
  if (!originalIndent) {
    return replacementLines;
  }
  const nonBlankReplacementLines = replacementLines.filter((line) => line.trim().length > 0);
  if (nonBlankReplacementLines.length === 0) {
    return replacementLines;
  }
  const replacementAlreadyIndented = nonBlankReplacementLines.some((line) => /^\s/.test(line));
  if (replacementAlreadyIndented) {
    return replacementLines;
  }
  return replacementLines.map((line) => (line.trim().length > 0 ? `${originalIndent}${line}` : line));
}

function assertValidLineRange(lines: string[], startLine: number, endLine: number, op: string): void {
  if (startLine < 1 || endLine < startLine || endLine > lines.length) {
    throw new Error(`${op} line range ${startLine}-${endLine} is out of bounds for a ${lines.length}-line component.`);
  }
}

function assertValidLineNumberForInsert(lines: string[], line: number, op: string): void {
  if (line < 1 || line > lines.length) {
    throw new Error(`${op} line ${line} is out of bounds for a ${lines.length}-line component.`);
  }
}

export function clampLineRange(totalLines: number, startLine = DEFAULT_VIEW_START_LINE, endLine = DEFAULT_VIEW_END_LINE): {
  startLine: number;
  endLine: number;
} {
  const safeTotal = Math.max(1, totalLines);
  const safeStart = Math.min(Math.max(1, startLine), safeTotal);
  const safeEnd = Math.min(Math.max(safeStart, endLine), safeTotal);
  return { startLine: safeStart, endLine: safeEnd };
}

export function buildDocumentNumberedLines(document: VisualDocument): NumberedLine[] {
  const physicalLines = serializeDocument(document).split('\n');
  const numberedLines: NumberedLine[] = [];
  let nextLineNumber = 1;
  let currentOwnerId: string | null = null;

  for (const physicalLine of physicalLines) {
    currentOwnerId = detectLineOwnerId(physicalLine, currentOwnerId);
    const wrappedLines = splitLongLine(physicalLine, MAX_GREP_LINE_WIDTH);
    for (const wrappedLine of wrappedLines) {
      numberedLines.push({
        lineNumber: nextLineNumber,
        text: wrappedLine,
        ownerId: currentOwnerId,
      });
      nextLineNumber += 1;
    }
  }

  return numberedLines;
}

function detectLineOwnerId(line: string, currentOwnerId: string | null): string | null {
  const directiveMatch = line.match(/^\s*<!--hvy:(?:([a-z][a-z0-9-]*(?::[a-z0-9-]+)*)\s*)?(\{.*\})\s*-->$/i);
  if (!directiveMatch) {
    return currentOwnerId;
  }

  try {
    const directivePath = directiveMatch[1] ?? '';
    const payloadRaw = directiveMatch[2] ?? '{}';
    const payload = JSON.parse(payloadRaw) as Record<string, unknown>;
    if (typeof payload.id === 'string' && payload.id.trim().length > 0) {
      return payload.id.trim();
    }
    if (directivePath === '' || directivePath === 'subsection') {
      return currentOwnerId;
    }
    return currentOwnerId;
  } catch {
    return currentOwnerId;
  }
}

function splitLongLine(line: string, maxWidth: number): string[] {
  if (line.length <= maxWidth) {
    return [line];
  }
  const chunks: string[] = [];
  for (let index = 0; index < line.length; index += maxWidth) {
    chunks.push(line.slice(index, index + maxWidth));
  }
  return chunks;
}

export function buildGrepRegex(query: string, explicitFlags?: string): RegExp {
  const slashRegexMatch = query.match(/^\/([\s\S]*)\/([dgimsuvy]*)$/);
  const source = slashRegexMatch ? slashRegexMatch[1] ?? '' : query;
  const flags = explicitFlags ?? (slashRegexMatch ? slashRegexMatch[2] : 'i') ?? 'i';

  try {
    return new RegExp(source, flags);
  } catch (error) {
    const details = error instanceof Error ? error.message : 'Unknown regex error.';
    throw new Error(`grep query must be a valid regex. ${details}`);
  }
}

export function buildToolRegex(query: string, explicitFlags: string | undefined, label: string): RegExp {
  try {
    return buildGrepRegex(query, explicitFlags);
  } catch (error) {
    const details = error instanceof Error ? error.message : 'Unknown regex error.';
    throw new Error(`${label} must be a valid regex. ${details}`);
  }
}

