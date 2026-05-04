import type { VisualDocument } from '../types';
import {
  buildHvyVirtualFileSystem,
  listDirectory,
  resolveVirtualPath,
  type HvyVirtualEntry,
  type HvyVirtualFile,
} from './virtual-file-system';
import { executeHvyDocumentCommand, hvyDocumentCommandHelp } from './hvy-document-commands';
import { createScriptingDbRuntime, formatQueryResultTable, getDocumentDbTableObjectNames } from '../plugins/db-table';

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

export function getHvyCliCommandSummary(): string {
  return helpFor('');
}

export async function executeHvyCliCommand(document: VisualDocument, session: HvyCliSession, input: string): Promise<HvyCliExecution> {
  const args = tokenizeCommand(input);
  if (args.length === 0) {
    return { cwd: session.cwd, output: '', mutated: false };
  }

  const command = args[0] ?? '';
  const fs = buildHvyVirtualFileSystem(document);
  const ctx = { document, fs, cwd: session.cwd };
  const result = await runCommand(ctx, command, args.slice(1));
  session.cwd = result.cwd;
  return result;
}

async function runCommand(ctx: { document: VisualDocument; fs: ReturnType<typeof buildHvyVirtualFileSystem>; cwd: string }, command: string, args: string[]): Promise<HvyCliExecution> {
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
  if (command === 'db-table' && isDbTableSqlAction(args[0] ?? '')) {
    const result = await commandDbTable(ctx.document, args);
    return { cwd: ctx.cwd, output: result.output, mutated: result.mutated };
  }
  if (command === 'form' || command === 'db-table') {
    const result = executeHvyDocumentCommand(ctx, [command, ...args]);
    return { cwd: ctx.cwd, output: result.output, mutated: result.mutated };
  }
  throw new Error(`Unknown command "${command}". Try "help".`);
}

function isDbTableSqlAction(action: string): boolean {
  return action === 'query' || action === 'exec' || action === 'tables' || action === 'schema';
}

async function commandDbTable(document: VisualDocument, args: string[]): Promise<{ output: string; mutated: boolean }> {
  const [action = '', ...rest] = args;
  if (action === 'tables') {
    const names = await getDocumentDbTableObjectNames(document);
    return { output: names.length > 0 ? names.join('\n') : '(no SQLite tables or views)', mutated: false };
  }
  if (action === 'query') {
    const sql = rest.join(' ').trim();
    if (!sql) {
      throw new Error('db-table query: expected SQL');
    }
    const runtime = await createScriptingDbRuntime(document);
    try {
      const rows = runtime.api.query(sql);
      const columns = collectQueryColumns(rows);
      return {
        output: [
          `Executed query: ${sql}`,
          `Returned rows: ${rows.length}`,
          '',
          columns.length === 0 ? '(no rows)' : formatQueryResultTable(columns, rows.map((row) => columns.map((column) => stringifyCliSqlValue(row[column])))),
        ].join('\n'),
        mutated: false,
      };
    } finally {
      runtime.dispose();
    }
  }
  if (action === 'exec') {
    const sql = rest.join(' ').trim();
    if (!sql) {
      throw new Error('db-table exec: expected SQL');
    }
    let mutated = false;
    const runtime = await createScriptingDbRuntime(document, () => {
      mutated = true;
    });
    try {
      return { output: runtime.api.execute(sql), mutated };
    } finally {
      runtime.dispose();
    }
  }
  if (action === 'schema') {
    const name = rest.join(' ').trim();
    const runtime = await createScriptingDbRuntime(document);
    try {
      if (!name) {
        const rows = runtime.api.query(
          "SELECT type, name, sql FROM sqlite_schema WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name"
        );
        return { output: formatSqlRows(rows, '(no SQLite tables or views)'), mutated: false };
      }
      const rows = runtime.api.query(`PRAGMA table_info(${quoteIdentifier(name)})`);
      return { output: formatSqlRows(rows, `No schema rows for ${name}`), mutated: false };
    } finally {
      runtime.dispose();
    }
  }
  throw new Error('db-table: expected show, query, exec, tables, or schema');
}

function commandLs(ctx: { fs: ReturnType<typeof buildHvyVirtualFileSystem>; cwd: string }, args: string[]): string {
  const warnings = warnUnknownOptions('ls', args, []);
  const target = resolveVirtualPath(ctx.fs, ctx.cwd, args.find((arg) => !arg.startsWith('-')) ?? '.');
  const entry = ctx.fs.entries.get(target);
  if (!entry) {
    throw new Error(`ls: no such file or directory: ${target}`);
  }
  if (entry.kind === 'file') {
    return withWarnings(formatEntry(entry), warnings);
  }
  return withWarnings(listDirectory(ctx.fs, target).map(formatEntry).join('\n'), warnings);
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
  const parsed = parseFindArgs(args);
  const root = resolveVirtualPath(ctx.fs, ctx.cwd, parsed.path);
  const regex = parsed.namePattern ? globToRegExp(parsed.namePattern) : null;
  const rootDepth = depthForPath(root);
  const output = [...ctx.fs.entries.values()]
    .filter((entry) => entry.path === root || entry.path.startsWith(root === '/' ? '/' : `${root}/`))
    .filter((entry) => !parsed.type || entry.kind === parsed.type)
    .filter((entry) => parsed.maxDepth === null || depthForPath(entry.path) - rootDepth <= parsed.maxDepth)
    .filter((entry) => !regex || regex.test(entry.path.split('/').pop() ?? ''))
    .map((entry) => entry.path)
    .sort()
    .join('\n');
  return withWarnings(output, parsed.warnings);
}

function commandRg(ctx: { fs: ReturnType<typeof buildHvyVirtualFileSystem>; cwd: string }, args: string[]): string {
  const warnings = warnUnknownOptions('rg', args, ['-i']);
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
  return withWarnings(lines.join('\n'), warnings);
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

function parseFindArgs(args: string[]): {
  path: string;
  namePattern: string;
  type: 'file' | 'dir' | null;
  maxDepth: number | null;
  warnings: string[];
} {
  const warnings: string[] = [];
  let path = '.';
  let namePattern = '';
  let type: 'file' | 'dir' | null = null;
  let maxDepth: number | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg === '-name') {
      namePattern = args[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '-type') {
      const rawType = args[index + 1] ?? '';
      if (rawType === 'f') {
        type = 'file';
      } else if (rawType === 'd') {
        type = 'dir';
      } else {
        throw new Error('find: -type expects f or d');
      }
      index += 1;
      continue;
    }
    if (arg === '-maxdepth') {
      const rawDepth = Number.parseInt(args[index + 1] ?? '', 10);
      if (!Number.isFinite(rawDepth) || rawDepth < 0) {
        throw new Error('find: -maxdepth expects a non-negative number');
      }
      maxDepth = rawDepth;
      index += 1;
      continue;
    }
    if (arg === '-print') {
      continue;
    }
    if (arg.startsWith('-')) {
      warnings.push(`Warning: find ignored unsupported option ${arg}`);
      continue;
    }
    if (path === '.') {
      path = arg;
    } else {
      warnings.push(`Warning: find ignored extra path ${arg}`);
    }
  }

  return { path, namePattern, type, maxDepth, warnings };
}

function warnUnknownOptions(command: string, args: string[], allowedOptions: string[]): string[] {
  return args
    .filter((arg) => arg.startsWith('-') && !allowedOptions.includes(arg))
    .map((arg) => `Warning: ${command} ignored unsupported option ${arg}`);
}

function withWarnings(output: string, warnings: string[]): string {
  return [...warnings, output].filter((line) => line.length > 0).join('\n');
}

function depthForPath(path: string): number {
  return path.split('/').filter(Boolean).length;
}

function collectQueryColumns(rows: Array<Record<string, unknown>>): string[] {
  const columns = new Set<string>();
  rows.forEach((row) => Object.keys(row).forEach((column) => columns.add(column)));
  return [...columns];
}

function formatSqlRows(rows: Array<Record<string, unknown>>, emptyMessage: string): string {
  const columns = collectQueryColumns(rows);
  return columns.length === 0
    ? emptyMessage
    : formatQueryResultTable(columns, rows.map((row) => columns.map((column) => stringifyCliSqlValue(row[column]))));
}

function stringifyCliSqlValue(value: unknown): string {
  if (value == null) {
    return '';
  }
  if (value instanceof Uint8Array) {
    return `<${value.byteLength} bytes>`;
  }
  return String(value);
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function formatEntry(entry: HvyVirtualEntry): string {
  return `${entry.kind === 'dir' ? 'dir ' : 'file'} ${entry.path.split('/').pop() || '/'}`;
}

function tokenizeCommand(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] ?? '';
    if (char === '\\' && index + 1 < input.length) {
      const next = input[index + 1] ?? '';
      if (next === '\\' || next === quote || (!quote && /\s/.test(next))) {
        current += next;
        index += 1;
      } else {
        current += char;
      }
      continue;
    }
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? null : char;
      continue;
    }
    if (!quote && /\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (quote) {
    throw new Error('Unclosed quote in command.');
  }
  if (current) {
    tokens.push(current);
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
    find: 'find [PATH] [-name GLOB] [-type f|d] [-maxdepth N] [-print]\nList virtual paths below PATH.',
    rg: 'rg [-i] PATTERN [PATH]\nSearch readable virtual files.',
    sed: 'sed s/search/replace/[g] FILE\nUpdate a writable virtual file with a search/replace.',
    hvy: hvyDocumentCommandHelp(),
    section: hvyDocumentCommandHelp('section'),
    text: hvyDocumentCommandHelp('text'),
    table: hvyDocumentCommandHelp('table'),
    plugin: hvyDocumentCommandHelp('plugin'),
    form: hvyDocumentCommandHelp('form'),
    'db-table': [
      hvyDocumentCommandHelp('db-table'),
      'db-table query [SELECT/WITH SQL]',
      'db-table exec [CREATE / INSERT / UPDATE / DELETE / DROP SQL]',
      'db-table tables',
      'db-table schema [TABLE_OR_VIEW]',
    ].join('\n'),
  };
  return help[topic] ?? help[''];
}
