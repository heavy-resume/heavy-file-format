import {
  getHvyCliSessionVirtualFileSystem,
  writeHvyCliSessionVirtualFile,
  type HvyCliSession,
} from '../cli-core/commands';
import { resolveVirtualPath } from '../cli-core/virtual-file-system';
import type { VisualDocument } from '../types';

interface ParsedHvyPatchFile {
  path: string;
  hunks: ParsedHvyPatchHunk[];
}

interface ParsedHvyPatchHunk {
  lines: Array<{ kind: 'context' | 'remove' | 'add'; text: string }>;
}

export type ApplyHvyPatchFileResult =
  | { status: 'applied'; path: string; hunkCount: number }
  | { status: 'failed'; path: string; error: string; currentContext?: string };

export interface ApplyHvyPatchResult {
  appliedFileCount: number;
  failedFileCount: number;
  files: ApplyHvyPatchFileResult[];
  mutatedPaths?: string[];
  refreshSectionPaths?: string[];
  requiresFullRefresh?: boolean;
}

export function applyHvyPatch(
  document: VisualDocument,
  session: HvyCliSession,
  patch: string
): ApplyHvyPatchResult {
  const files = parseHvyPatch(patch);
  const results: ApplyHvyPatchFileResult[] = [];
  let mutatedPaths: string[] | undefined;
  let refreshSectionPaths: string[] | undefined;
  let requiresFullRefresh = false;

  for (const filePatch of files) {
    let current = '';
    try {
      const fs = getHvyCliSessionVirtualFileSystem(document, session);
      const resolved = resolveVirtualPath(fs, session.cwd, filePatch.path);
      const entry = fs.entries.get(resolved);
      if (!entry || entry.kind !== 'file') {
        throw new Error(`No such file: ${resolved}`);
      }
      if (!entry.write) {
        throw new Error(`File is read-only: ${resolved}`);
      }
      current = entry.read();
      let next = current;
      for (const [hunkIndex, hunk] of filePatch.hunks.entries()) {
        next = applyExactHunk(next, hunk, hunkIndex + 1);
      }
      const write = writeHvyCliSessionVirtualFile(document, session, resolved, next);
      mutatedPaths = mergePaths(mutatedPaths, write.mutatedPaths);
      refreshSectionPaths = mergePaths(refreshSectionPaths, write.refreshSectionPaths);
      requiresFullRefresh ||= Boolean(write.requiresFullRefresh || (!write.mutatedPaths?.length && !write.refreshSectionPaths?.length));
      results.push({ status: 'applied', path: resolved, hunkCount: filePatch.hunks.length });
    } catch (error) {
      results.push({
        status: 'failed',
        path: filePatch.path,
        error: error instanceof Error ? error.message : String(error),
        ...(current ? { currentContext: excerpt(current) } : {}),
      });
    }
  }

  const appliedFileCount = results.filter((result) => result.status === 'applied').length;
  return {
    appliedFileCount,
    failedFileCount: results.length - appliedFileCount,
    files: results,
    mutatedPaths,
    refreshSectionPaths,
    requiresFullRefresh,
  };
}

function parseHvyPatch(patch: string): ParsedHvyPatchFile[] {
  const lines = patch.replace(/\r\n?/g, '\n').split('\n');
  if (lines[0] !== '*** Begin Patch' || lines.at(-1) !== '*** End Patch') {
    throw new Error('Patch must start with "*** Begin Patch" and end with "*** End Patch".');
  }
  const files: ParsedHvyPatchFile[] = [];
  let file: ParsedHvyPatchFile | null = null;
  let hunk: ParsedHvyPatchHunk | null = null;
  for (let index = 1; index < lines.length - 1; index += 1) {
    const line = lines[index] ?? '';
    if (line.startsWith('*** Update File: ')) {
      const path = line.slice('*** Update File: '.length).trim();
      if (!path.startsWith('/')) {
        throw new Error(`Patch target must be an absolute virtual path: ${path || '(empty)'}`);
      }
      file = { path, hunks: [] };
      files.push(file);
      hunk = null;
      continue;
    }
    if (line === '@@') {
      if (!file) {
        throw new Error('Patch hunk appears before an Update File directive.');
      }
      hunk = { lines: [] };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) {
      throw new Error(`Unsupported patch directive or misplaced line: ${line}`);
    }
    const prefix = line[0];
    if (prefix !== ' ' && prefix !== '-' && prefix !== '+') {
      throw new Error(`Patch hunk line must start with space, "-", or "+": ${line}`);
    }
    hunk.lines.push({
      kind: prefix === ' ' ? 'context' : prefix === '-' ? 'remove' : 'add',
      text: line.slice(1),
    });
  }
  if (files.length === 0) {
    throw new Error('Patch contains no Update File directives.');
  }
  for (const filePatch of files) {
    if (filePatch.hunks.length === 0 || filePatch.hunks.some((candidate) => candidate.lines.length === 0)) {
      throw new Error(`Patch target has no complete hunks: ${filePatch.path}`);
    }
  }
  return files;
}

function applyExactHunk(content: string, hunk: ParsedHvyPatchHunk, hunkNumber: number): string {
  const hadTrailingNewline = content.endsWith('\n');
  const lines = content.split('\n');
  if (hadTrailingNewline) {
    lines.pop();
  }
  const before = hunk.lines.filter((line) => line.kind !== 'add').map((line) => line.text);
  const after = hunk.lines.filter((line) => line.kind !== 'remove').map((line) => line.text);
  if (before.length === 0) {
    throw new Error(`Hunk ${hunkNumber} has no context or removed lines.`);
  }
  const matches: number[] = [];
  for (let index = 0; index <= lines.length - before.length; index += 1) {
    if (before.every((line, offset) => lines[index + offset] === line)) {
      matches.push(index);
    }
  }
  if (matches.length === 0) {
    throw new Error(`Hunk ${hunkNumber} did not match the current file.`);
  }
  if (matches.length > 1) {
    throw new Error(`Hunk ${hunkNumber} matched ${matches.length} locations; add more context.`);
  }
  lines.splice(matches[0]!, before.length, ...after);
  return `${lines.join('\n')}${hadTrailingNewline ? '\n' : ''}`;
}

function mergePaths(left: string[] | undefined, right: string[] | undefined): string[] | undefined {
  const merged = [...new Set([...(left ?? []), ...(right ?? [])])];
  return merged.length ? merged : undefined;
}

function excerpt(content: string): string {
  const lines = content.split(/\r?\n/).slice(0, 12);
  const value = lines.join('\n');
  return value.length <= 1_200 ? value : `${value.slice(0, 1_197)}...`;
}
