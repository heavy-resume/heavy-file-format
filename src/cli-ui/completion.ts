import { buildHvyVirtualFileSystem, listDirectory, resolveVirtualPath } from '../cli-core/virtual-file-system';
import type { HvyCliSessionState, VisualDocument } from '../types';

const CLI_COMMAND_COMPLETIONS = [
  'hvy',
  'nl',
  'rg',
  'find',
  'sed',
  'echo',
  'cat',
  'ls',
  'pwd',
  'cd',
  'cp',
  'rm',
  'grep',
  'sort',
  'uniq',
  'wc',
  'tr',
  'xargs',
  'head',
  'tail',
  'true',
  'ask',
  'done',
  'help',
  'man',
];

export function completeCliInput(params: {
  document: VisualDocument;
  session: HvyCliSessionState;
  value: string;
  selectionStart: number;
  selectionEnd: number;
}): { value: string; selectionStart: number; selectionEnd: number } | null {
  if (params.selectionStart !== params.selectionEnd) {
    return null;
  }
  const beforeCursor = params.value.slice(0, params.selectionStart);
  const tokenStart = Math.max(beforeCursor.search(/\S+$/), 0);
  const token = beforeCursor.slice(tokenStart);
  const tokenIndex = beforeCursor.slice(0, tokenStart).trim().length === 0
    ? 0
    : beforeCursor.slice(0, tokenStart).trim().split(/\s+/).length;
  const completion = tokenIndex === 0
    ? completeFromCandidates(token, CLI_COMMAND_COMPLETIONS)
    : completePathToken(params.document, params.session, token);
  if (!completion || completion === token) {
    return null;
  }
  const nextValue = `${params.value.slice(0, tokenStart)}${completion}${params.value.slice(params.selectionStart)}`;
  const nextCursor = tokenStart + completion.length;
  return { value: nextValue, selectionStart: nextCursor, selectionEnd: nextCursor };
}

function completePathToken(document: VisualDocument, session: HvyCliSessionState, token: string): string | null {
  const fs = buildHvyVirtualFileSystem(document, session.virtualPathNaming);
  const slashIndex = token.lastIndexOf('/');
  const directoryToken = slashIndex >= 0 ? token.slice(0, slashIndex + 1) : '';
  const basenamePrefix = slashIndex >= 0 ? token.slice(slashIndex + 1) : token;
  const directoryPath = resolveVirtualPath(fs, session.cwd || '/', directoryToken || '.');
  const directory = fs.entries.get(directoryPath);
  if (directory?.kind !== 'dir') {
    return null;
  }
  const matches = listDirectory(fs, directoryPath)
    .map((entry) => `${entry.path.split('/').pop() ?? ''}${entry.kind === 'dir' ? '/' : ''}`)
    .filter((name) => name.startsWith(basenamePrefix));
  const completedName = completeFromCandidates(basenamePrefix, matches);
  return completedName ? `${directoryToken}${completedName}` : null;
}

function completeFromCandidates(prefix: string, candidates: string[]): string | null {
  const matches = candidates.filter((candidate) => candidate.startsWith(prefix));
  if (matches.length === 0) {
    return null;
  }
  if (matches.length === 1) {
    return matches[0] ?? null;
  }
  const common = commonPrefix(matches);
  return common.length > prefix.length ? common : null;
}

function commonPrefix(values: string[]): string {
  const [first = '', ...rest] = values;
  let end = first.length;
  for (const value of rest) {
    while (end > 0 && !value.startsWith(first.slice(0, end))) {
      end -= 1;
    }
  }
  return first.slice(0, end);
}
