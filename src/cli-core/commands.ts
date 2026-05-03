import type { VisualDocument } from '../types';
import {
  buildHvyVirtualFileSystem,
  listDirectory,
  resolveVirtualPath,
  type HvyVirtualEntry,
  type HvyVirtualFile,
} from './virtual-file-system';
import { executeHvyDocumentCommand, hvyDocumentCommandHelp } from './hvy-document-commands';

export interface HvyCliSession {
  cwd: string;
}

export interface HvyCliExecution {
  cwd: string;
  output: string;
  mutated: boolean;
}

export function createHvyCliSession(): HvyCliSession {
  return { cwd: '/' };
}

export function executeHvyCliCommand(document: VisualDocument, session: HvyCliSession, input: string): HvyCliExecution {
  const args = tokenizeCommand(input);
  if (args.length === 0) {
    return { cwd: session.cwd, output: '', mutated: false };
  }

  const command = args[0] ?? '';
  const fs = buildHvyVirtualFileSystem(document);
  const ctx = { document, fs, cwd: session.cwd };
  const result = runCommand(ctx, command, args.slice(1));
  session.cwd = result.cwd;
  return result;
}

function runCommand(ctx: { document: VisualDocument; fs: ReturnType<typeof buildHvyVirtualFileSystem>; cwd: string }, command: string, args: string[]): HvyCliExecution {
  if (args.includes('--help') || command === 'help' || command === 'man') {
    const topic = command === 'help' || command === 'man' ? args[0] : command;
    return { cwd: ctx.cwd, output: helpFor(topic), mutated: false };
  }

  if (command === 'pwd') {
    return { cwd: ctx.cwd, output: ctx.cwd, mutated: false };
  }
  if (command === 'cd') {
    const next = resolveVirtualPath(ctx.fs, ctx.cwd, args[0] ?? '/');
    const entry = ctx.fs.entries.get(next);
    if (!entry || entry.kind !== 'dir') {
      throw new Error(`cd: no such directory: ${args[0] ?? '/'}`);
    }
    return { cwd: next, output: next, mutated: false };
  }
  if (command === 'ls') {
    return { cwd: ctx.cwd, output: commandLs(ctx, args), mutated: false };
  }
  if (command === 'cat') {
    return { cwd: ctx.cwd, output: commandCat(ctx, args), mutated: false };
  }
  if (command === 'head' || command === 'tail') {
    return { cwd: ctx.cwd, output: commandHeadTail(ctx, args, command), mutated: false };
  }
  if (command === 'nl') {
    return { cwd: ctx.cwd, output: commandNl(ctx, args), mutated: false };
  }
  if (command === 'find') {
    return { cwd: ctx.cwd, output: commandFind(ctx, args), mutated: false };
  }
  if (command === 'rg') {
    return { cwd: ctx.cwd, output: commandRg(ctx, args), mutated: false };
  }
  if (command === 'sed') {
    return { cwd: ctx.cwd, output: commandSed(ctx, args), mutated: true };
  }
  if (command === 'hvy') {
    const result = executeHvyDocumentCommand(ctx, args);
    return { cwd: ctx.cwd, output: result.output, mutated: result.mutated };
  }
  if (command === 'form' || command === 'db-table') {
    const result = executeHvyDocumentCommand(ctx, [command, ...args]);
    return { cwd: ctx.cwd, output: result.output, mutated: result.mutated };
  }
  throw new Error(`Unknown command "${command}". Try "help".`);
}

function commandLs(ctx: { fs: ReturnType<typeof buildHvyVirtualFileSystem>; cwd: string }, args: string[]): string {
  const target = resolveVirtualPath(ctx.fs, ctx.cwd, args.find((arg) => !arg.startsWith('-')) ?? '.');
  const entry = ctx.fs.entries.get(target);
  if (!entry) {
    throw new Error(`ls: no such file or directory: ${target}`);
  }
  if (entry.kind === 'file') {
    return formatEntry(entry);
  }
  return listDirectory(ctx.fs, target).map(formatEntry).join('\n');
}

function commandCat(ctx: { fs: ReturnType<typeof buildHvyVirtualFileSystem>; cwd: string }, args: string[]): string {
  if (args.length === 0) {
    throw new Error('cat: missing file operand');
  }
  return args.map((arg) => getReadableFile(ctx, arg).read()).join('\n');
}

function commandHeadTail(ctx: { fs: ReturnType<typeof buildHvyVirtualFileSystem>; cwd: string }, args: string[], command: 'head' | 'tail'): string {
  const { count, paths } = parseLineCount(args, 5);
  if (paths.length === 0) {
    throw new Error(`${command}: missing file operand`);
  }
  return paths
    .map((path) => {
      const lines = getReadableFile(ctx, path).read().split('\n');
      return (command === 'head' ? lines.slice(0, count) : lines.slice(Math.max(0, lines.length - count))).join('\n');
    })
    .join('\n');
}

function commandNl(ctx: { fs: ReturnType<typeof buildHvyVirtualFileSystem>; cwd: string }, args: string[]): string {
  if (args.length === 0) {
    throw new Error('nl: missing file operand');
  }
  return args
    .map((path) =>
      getReadableFile(ctx, path)
        .read()
        .split('\n')
        .map((line, index) => `${String(index + 1).padStart(6, ' ')}\t${line}`)
        .join('\n')
    )
    .join('\n');
}

function commandFind(ctx: { fs: ReturnType<typeof buildHvyVirtualFileSystem>; cwd: string }, args: string[]): string {
  const root = resolveVirtualPath(ctx.fs, ctx.cwd, args.find((arg) => !arg.startsWith('-')) ?? '.');
  const nameIndex = args.indexOf('-name');
  const namePattern = nameIndex >= 0 ? args[nameIndex + 1] : '';
  const regex = namePattern ? globToRegExp(namePattern) : null;
  return [...ctx.fs.entries.values()]
    .filter((entry) => entry.path === root || entry.path.startsWith(root === '/' ? '/' : `${root}/`))
    .filter((entry) => !regex || regex.test(entry.path.split('/').pop() ?? ''))
    .map((entry) => entry.path)
    .sort()
    .join('\n');
}

function commandRg(ctx: { fs: ReturnType<typeof buildHvyVirtualFileSystem>; cwd: string }, args: string[]): string {
  const pattern = args.find((arg) => !arg.startsWith('-'));
  if (!pattern) {
    throw new Error('rg: missing search pattern');
  }
  const rootArg = args.slice(args.indexOf(pattern) + 1).find((arg) => !arg.startsWith('-')) ?? '.';
  const root = resolveVirtualPath(ctx.fs, ctx.cwd, rootArg);
  const regex = new RegExp(pattern, args.includes('-i') ? 'i' : '');
  const lines: string[] = [];
  for (const entry of [...ctx.fs.entries.values()].sort((left, right) => left.path.localeCompare(right.path))) {
    if (entry.kind !== 'file' || !(entry.path === root || entry.path.startsWith(root === '/' ? '/' : `${root}/`))) {
      continue;
    }
    entry.read().split('\n').forEach((line, index) => {
      if (regex.test(line)) {
        lines.push(`${entry.path}:${index + 1}:${line}`);
      }
    });
  }
  return lines.join('\n');
}

function commandSed(ctx: { fs: ReturnType<typeof buildHvyVirtualFileSystem>; cwd: string }, args: string[]): string {
  const expression = args[0] ?? '';
  const path = args[1] ?? '';
  const match = expression.match(/^s(.)(.*?)\1(.*?)\1([g]*)$/);
  if (!match || !path) {
    throw new Error('sed: expected sed s/search/replace/[g] path');
  }
  const file = getReadableFile(ctx, path);
  if (!file.write) {
    throw new Error(`sed: file is read-only: ${file.path}`);
  }
  const regex = new RegExp(match[2] ?? '', match[4]?.includes('g') ? 'g' : '');
  const before = file.read();
  const after = before.replace(regex, match[3] ?? '');
  file.write(after);
  const changed = before === after ? 0 : 1;
  return `${file.path}: ${changed ? 'updated' : 'no matches'}`;
}

function getReadableFile(ctx: { fs: ReturnType<typeof buildHvyVirtualFileSystem>; cwd: string }, path: string): HvyVirtualFile {
  const normalized = resolveVirtualPath(ctx.fs, ctx.cwd, path);
  const entry = ctx.fs.entries.get(normalized);
  if (!entry) {
    throw new Error(`No such file: ${normalized}`);
  }
  if (entry.kind !== 'file') {
    throw new Error(`Is a directory: ${normalized}`);
  }
  return entry;
}

function parseLineCount(args: string[], fallback: number): { count: number; paths: string[] } {
  const nIndex = args.indexOf('-n');
  const rawCount = nIndex >= 0 ? Number.parseInt(args[nIndex + 1] ?? '', 10) : fallback;
  const count = Number.isFinite(rawCount) ? Math.max(1, Math.min(100, rawCount)) : fallback;
  const paths = args.filter((_arg, index) => index !== nIndex && index !== nIndex + 1);
  return { count, paths };
}

function formatEntry(entry: HvyVirtualEntry): string {
  return `${entry.kind === 'dir' ? 'dir ' : 'file'} ${entry.path.split('/').pop() || '/'}`;
}

function tokenizeCommand(input: string): string[] {
  const tokens: string[] = [];
  const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null = regex.exec(input);
  while (match) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? '');
    match = regex.exec(input);
  }
  return tokens;
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

function helpFor(topic = ''): string {
  const help: Record<string, string> = {
    '': 'Commands: cd, pwd, ls, cat, head, tail, nl, find, rg, sed, hvy, form, db-table. Use man <command> for details.',
    cd: 'cd PATH\nChange the current virtual directory.',
    pwd: 'pwd\nPrint the current virtual directory.',
    ls: 'ls [PATH]\nList files and directories.',
    cat: 'cat FILE...\nPrint file contents.',
    head: 'head [-n COUNT] FILE\nPrint the first lines of a file. COUNT maxes at 100.',
    tail: 'tail [-n COUNT] FILE\nPrint the last lines of a file. COUNT maxes at 100.',
    nl: 'nl FILE\nPrint file contents with line numbers.',
    find: 'find [PATH] [-name GLOB]\nList virtual paths below PATH.',
    rg: 'rg [-i] PATTERN [PATH]\nSearch readable virtual files.',
    sed: 'sed s/search/replace/[g] FILE\nUpdate a writable virtual file with a search/replace.',
    hvy: hvyDocumentCommandHelp(),
    section: hvyDocumentCommandHelp('section'),
    text: hvyDocumentCommandHelp('text'),
    table: hvyDocumentCommandHelp('table'),
    plugin: hvyDocumentCommandHelp('plugin'),
    form: hvyDocumentCommandHelp('form'),
    'db-table': hvyDocumentCommandHelp('db-table'),
  };
  return help[topic] ?? help[''];
}
