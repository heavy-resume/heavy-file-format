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
import type { VisualBlock, VisualSection } from '../editor/types';
import { getSectionId } from '../section-ops';
import { getHvyCliPluginCommandRegistration } from './plugin-command-registry';

const SCRATCHPAD_SOFT_MAX_CHARS = 600;
const SCRATCHPAD_HARD_MAX_CHARS = 800;
const FIND_MAX_RESULTS = 100;

export interface HvyCliSession {
  cwd: string;
  scratchpadContent?: string;
}

export interface HvyCliExecution {
  cwd: string;
  output: string;
  mutated: boolean;
}

type HvyCliCommandContext = {
  document: VisualDocument;
  fs: ReturnType<typeof buildHvyVirtualFileSystem>;
  cwd: string;
};

type HvyMiniShellPipeline = {
  operator: 'first' | '&&' | '||';
  commands: string[][];
  tokens: string[];
};

type HvyMiniShellProcess = {
  cwd: string;
  stdout: string;
  stderr: string;
  status: number;
  mutated: boolean;
};

export function createHvyCliSession(): HvyCliSession {
  return { cwd: '/', scratchpadContent: defaultScratchpadContent() };
}

export function getHvyCliCommandSummary(): string {
  return helpFor('');
}

export async function executeHvyCliCommand(document: VisualDocument, session: HvyCliSession, input: string): Promise<HvyCliExecution> {
  const args = tokenizeCommand(input);
  if (args.length === 0) {
    return { cwd: session.cwd, output: '', mutated: false };
  }

  const pipelines = parseMiniShell(args);
  let lastProcess: HvyMiniShellProcess = { cwd: session.cwd, stdout: '', stderr: '', status: 0, mutated: false };
  let mutated = false;
  let scratchpadTouched = false;
  let previousStatus = 0;

  for (let index = 0; index < pipelines.length; index += 1) {
    const pipeline = pipelines[index] ?? { operator: 'first' as const, commands: [], tokens: [] };
    if ((pipeline.operator === '&&' && previousStatus !== 0) || (pipeline.operator === '||' && previousStatus === 0)) {
      continue;
    }

    const fs = buildHvyVirtualFileSystem(document);
    addSessionScratchpadFile(fs, session);
    enforceScratchpadHardCap(session);
    lastProcess = await executeMiniShellPipeline({ document, fs, cwd: session.cwd }, pipeline.commands);
    enforceScratchpadHardCap(session);
    session.cwd = lastProcess.cwd;
    mutated = mutated || lastProcess.mutated;
    scratchpadTouched = scratchpadTouched || pipeline.tokens.some((token) => token === 'scratchpad.txt' || token === '/scratchpad.txt');
    previousStatus = lastProcess.status;

    if (lastProcess.status !== 0 && pipelines[index + 1]?.operator !== '||') {
      throw new Error(lastProcess.stderr || lastProcess.stdout || 'Command failed.');
    }
  }

  const result = { cwd: session.cwd, output: lastProcess.status === 0 ? lastProcess.stdout : lastProcess.stderr || lastProcess.stdout, mutated };
  if (scratchpadTouched && isScratchpadTooLong(session)) {
    return { ...result, output: `${result.output}\n\n${buildScratchpadTooLongMessage(session.scratchpadContent ?? '')}` };
  }
  return result;
}

async function runCommand(ctx: HvyCliCommandContext, command: string, args: string[]): Promise<HvyCliExecution> {
  if (args.includes('--help') || command === 'help' || command === 'man') {
    const topic = command === 'help' || command === 'man' ? args.join(' ') : command;
    return { cwd: ctx.cwd, output: helpFor(topic), mutated: false };
  }

  if (command === 'pwd') {
    return { cwd: ctx.cwd, output: ctx.cwd, mutated: false };
  }
  if (command === 'true') {
    return { cwd: ctx.cwd, output: '', mutated: false };
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
  if (command === 'grep' || command === 'sort' || command === 'uniq' || command === 'wc') {
    return runTextCommand(ctx, command, args);
  }
  if (command === 'find') {
    return commandFind(ctx, args);
  }
  if (command === 'rg') {
    return { cwd: ctx.cwd, output: commandRg(ctx, args), mutated: false };
  }
  if (command === 'rm') {
    return { cwd: ctx.cwd, output: commandRm(ctx, args), mutated: true };
  }
  if (command === 'echo') {
    const result = commandEcho(ctx, args);
    return { cwd: ctx.cwd, output: result.output, mutated: result.mutated };
  }
  if (command === 'sed') {
    return { cwd: ctx.cwd, output: commandSed(ctx, args), mutated: true };
  }
  if (command === 'hvy') {
    if (args[0] === 'read') {
      return { cwd: ctx.cwd, output: commandCat(ctx, args.slice(1)), mutated: false };
    }
    if (args[0] === 'remove' || args[0] === 'delete') {
      return { cwd: ctx.cwd, output: commandRm(ctx, ['-r', ...args.slice(1)]), mutated: true };
    }
    if (args[0] === 'plugin' && !args[1]) {
      return { cwd: ctx.cwd, output: helpFor('hvy plugin'), mutated: false };
    }
    if (args[0] === 'plugin' && args[1] === 'form' && !args[2]) {
      return { cwd: ctx.cwd, output: helpFor('hvy plugin form'), mutated: false };
    }
    if (args[0] === 'plugin' && args[1] === 'db-table' && !args[2]) {
      return { cwd: ctx.cwd, output: helpFor('hvy plugin db-table'), mutated: false };
    }
    if (args[0] === 'plugin' && args[1] && !args[2] && getHvyCliPluginCommandRegistration(args[1])) {
      return { cwd: ctx.cwd, output: helpFor(`hvy plugin ${args[1]}`), mutated: false };
    }
    if (args[0] === 'plugin' && args[1] === 'db-table' && isDbTableSqlAction(args[2] ?? '')) {
      const result = await commandDbTable(ctx.document, args.slice(2));
      return { cwd: ctx.cwd, output: result.output, mutated: result.mutated };
    }
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
  const recursive = args.some((arg) => arg === '-R' || arg === '--recursive');
  const warnings = warnUnknownOptions('ls', args, ['-R', '--recursive']);
  const target = resolveVirtualPath(ctx.fs, ctx.cwd, args.find((arg) => !arg.startsWith('-')) ?? '.');
  const entry = ctx.fs.entries.get(target);
  if (!entry) {
    throw new Error(`ls: no such file or directory: ${target}`);
  }
  if (entry.kind === 'file') {
    return withWarnings(formatEntry(entry), warnings);
  }
  if (recursive) {
    const entries = [...ctx.fs.entries.values()]
      .filter((candidate) => candidate.path === target || candidate.path.startsWith(target === '/' ? '/' : `${target}/`))
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((candidate) => candidate.path);
    return withWarnings(entries.join('\n'), warnings);
  }
  return withWarnings(listDirectory(ctx.fs, target).map(formatEntry).join('\n'), warnings);
}

function addSessionScratchpadFile(fs: ReturnType<typeof buildHvyVirtualFileSystem>, session: HvyCliSession): void {
  session.scratchpadContent ??= defaultScratchpadContent();
  fs.entries.set('/scratchpad.txt', {
    kind: 'file',
    path: '/scratchpad.txt',
    read: () => session.scratchpadContent ?? defaultScratchpadContent(),
    write: (content) => {
      session.scratchpadContent = content;
    },
  });
}

function defaultScratchpadContent(): string {
  return 'No notes yet. Edit /scratchpad.txt to change me. Keep track of your progress.\n';
}

function enforceScratchpadHardCap(session: HvyCliSession): void {
  if ((session.scratchpadContent ?? '').length > SCRATCHPAD_HARD_MAX_CHARS) {
    session.scratchpadContent = (session.scratchpadContent ?? '').slice(0, SCRATCHPAD_HARD_MAX_CHARS);
  }
}

function isScratchpadTooLong(session: HvyCliSession): boolean {
  return (session.scratchpadContent ?? '').length > SCRATCHPAD_SOFT_MAX_CHARS;
}

function buildScratchpadTooLongMessage(scratchpad: string): string {
  return [
    `scratchpad.txt is ${scratchpad.length} characters, which is over the ${SCRATCHPAD_SOFT_MAX_CHARS} character working limit.`,
    'Rewrite scratchpad.txt shorter before adding more notes.',
    '',
    'scratchpad.txt:',
    scratchpad,
  ].join('\n');
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

async function commandFind(ctx: HvyCliCommandContext, args: string[]): Promise<HvyCliExecution> {
  const parsed = parseFindArgs(args);
  const root = resolveVirtualPath(ctx.fs, ctx.cwd, parsed.path);
  const regex = parsed.namePattern ? globToRegExp(parsed.namePattern) : null;
  const rootDepth = depthForPath(root);
  const matches = [...ctx.fs.entries.values()]
    .filter((entry) => entry.path === root || entry.path.startsWith(root === '/' ? '/' : `${root}/`))
    .filter((entry) => !parsed.type || entry.kind === parsed.type)
    .filter((entry) => parsed.maxDepth === null || depthForPath(entry.path) - rootDepth <= parsed.maxDepth)
    .filter((entry) => !regex || regex.test(entry.path.split('/').pop() ?? ''))
    .map((entry) => entry.path)
    .sort();
  const warnings = matches.length > FIND_MAX_RESULTS && !parsed.exec
    ? [...parsed.warnings, `Warning: find output truncated to ${FIND_MAX_RESULTS} of ${matches.length} results.`]
    : parsed.warnings;
  if (!parsed.exec) {
    return { cwd: ctx.cwd, output: withWarnings(matches.slice(0, FIND_MAX_RESULTS).join('\n'), warnings), mutated: false };
  }

  const commandOutputs: string[] = [];
  let mutated = false;
  const runs = parsed.exec.terminator === '+'
    ? [expandFindExecCommand(parsed.exec.command, matches)]
    : matches.map((match) => expandFindExecCommand(parsed.exec?.command ?? [], [match]));
  for (const runArgs of runs) {
    const [command = '', ...commandRest] = runArgs;
    if (!command) {
      throw new Error('find: -exec expected command');
    }
    const result = await runCommand(ctx, command, commandRest);
    mutated = mutated || result.mutated;
    ctx.cwd = result.cwd;
    if (result.output) {
      commandOutputs.push(result.output);
    }
  }
  return { cwd: ctx.cwd, output: withWarnings(commandOutputs.join('\n'), warnings), mutated };
}

function commandRg(ctx: { fs: ReturnType<typeof buildHvyVirtualFileSystem>; cwd: string }, args: string[]): string {
  const parsed = parseRgArgs(args);
  if (!parsed.pattern) {
    throw new Error('rg: missing search pattern');
  }
  const root = resolveVirtualPath(ctx.fs, ctx.cwd, parsed.path);
  const regex = new RegExp(normalizeRgPattern(parsed.pattern), parsed.ignoreCase ? 'i' : '');
  const includeRegexes = parsed.includeGlobs.map(globToRegExp);
  const lines: string[] = [];
  const matchingFiles = new Set<string>();
  for (const entry of [...ctx.fs.entries.values()].sort((left, right) => left.path.localeCompare(right.path))) {
    if (entry.kind !== 'file' || !(entry.path === root || entry.path.startsWith(root === '/' ? '/' : `${root}/`))) {
      continue;
    }
    if (includeRegexes.length > 0 && !includeRegexes.some((regex) => regex.test(entry.path.split('/').pop() ?? ''))) {
      continue;
    }
    entry.read().split('\n').forEach((line, index) => {
      if (regex.test(line)) {
        matchingFiles.add(entry.path);
        lines.push(`${entry.path}:${index + 1}:${line}`);
      }
    });
  }
  return withWarnings((parsed.filesWithMatches ? [...matchingFiles] : lines).join('\n'), parsed.warnings);
}

function commandRm(ctx: { document: VisualDocument; fs: ReturnType<typeof buildHvyVirtualFileSystem>; cwd: string }, args: string[]): string {
  const recursive = args.some((arg) => arg === '-r' || arg === '-R' || arg === '--recursive');
  const targets = args.filter((arg) => !arg.startsWith('-'));
  if (targets.length === 0) {
    throw new Error('rm: missing operand');
  }
  return targets
    .map((target) => {
      const resolved = resolveVirtualPath(ctx.fs, ctx.cwd, target);
      const entry = ctx.fs.entries.get(resolved);
      if (!entry) {
        throw new Error(`rm: no such file or directory: ${target}`);
      }
      if (entry.kind === 'file') {
        throw new Error(`rm: cannot remove virtual file directly: ${resolved}`);
      }
      if (!recursive) {
        throw new Error(`rm: ${resolved} is a directory; use -r`);
      }
      removeDocumentDirectory(ctx.document, resolved);
      return `${resolved}: removed`;
    })
    .join('\n');
}

function removeDocumentDirectory(document: VisualDocument, path: string): void {
  if (path === '/' || path === '/body' || path === '/attachments') {
    throw new Error(`rm: refusing to remove protected directory: ${path}`);
  }
  if (!path.startsWith('/body/')) {
    throw new Error(`rm: can only remove document body directories: ${path}`);
  }
  const parts = path.split('/').filter(Boolean).slice(1);
  if (!removeBodyPath(document.sections, parts)) {
    throw new Error(`rm: cannot map virtual path to document node: ${path}`);
  }
}

function removeBodyPath(sections: VisualSection[], parts: string[]): boolean {
  if (parts.length === 0) {
    return false;
  }
  const [head = '', ...tail] = parts;
  const sectionIndex = sections.findIndex((section) => pathSegmentForId(getSectionId(section)) === head);
  if (sectionIndex >= 0) {
    const section = sections[sectionIndex];
    if (!section) {
      return false;
    }
    if (tail.length === 0) {
      sections.splice(sectionIndex, 1);
      return true;
    }
    return removeFromSection(section, tail);
  }
  return false;
}

function removeFromSection(section: VisualSection, parts: string[]): boolean {
  if (parts.length === 0) {
    return false;
  }
  const [head = '', ...tail] = parts;
  const childSectionIndex = section.children.findIndex((child) => pathSegmentForId(getSectionId(child)) === head);
  if (childSectionIndex >= 0) {
    const child = section.children[childSectionIndex];
    if (!child) {
      return false;
    }
    if (tail.length === 0) {
      section.children.splice(childSectionIndex, 1);
      return true;
    }
    return removeFromSection(child, tail);
  }
  const blockRemoved = removeBlockPath(section.blocks, [head, ...tail]);
  if (blockRemoved) {
    return true;
  }
  return false;
}

function removeBlockPath(blocks: VisualBlock[], parts: string[]): boolean {
  const [head = '', ...tail] = parts;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block) {
      continue;
    }
    if (pathSegmentForId(block.schema.id) === head) {
      if (tail.length === 0) {
        blocks.splice(index, 1);
        return true;
      }
      return removeFromBlock(block, tail);
    }
    for (const nestedBlocks of getNestedBlockLists(block)) {
      if (removeBlockPath(nestedBlocks, parts)) {
        return true;
      }
    }
  }
  return false;
}

function removeFromBlock(block: VisualBlock, parts: string[]): boolean {
  const [head = '', ...tail] = parts;
  const nestedLists = getNestedBlockLists(block);
  for (const nestedBlocks of nestedLists) {
    for (let index = 0; index < nestedBlocks.length; index += 1) {
      const child = nestedBlocks[index];
      if (!child) {
        continue;
      }
      if (pathSegmentForId(child.schema.id) === head) {
        if (tail.length === 0) {
          nestedBlocks.splice(index, 1);
          return true;
        }
        return removeFromBlock(child, tail);
      }
    }
  }
  return false;
}

function getNestedBlockLists(block: VisualBlock): VisualBlock[][] {
  return [
    block.schema.containerBlocks ?? [],
    block.schema.componentListBlocks ?? [],
    block.schema.expandableStubBlocks?.children ?? [],
    block.schema.expandableContentBlocks?.children ?? [],
    (block.schema.gridItems ?? []).map((item) => item.block),
  ];
}

function pathSegmentForId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function commandEcho(ctx: { fs: ReturnType<typeof buildHvyVirtualFileSystem>; cwd: string }, args: string[]): { output: string; mutated: boolean } {
  const redirectIndex = args.findIndex((arg) => arg === '>' || arg === '>>');
  if (redirectIndex < 0) {
    return { output: args.join(' '), mutated: false };
  }
  const operator = args[redirectIndex] ?? '';
  const path = args[redirectIndex + 1] ?? '';
  if (!path) {
    throw new Error(`echo: ${operator} requires a file path`);
  }
  if (args.slice(redirectIndex + 2).length > 0) {
    throw new Error('echo: expected redirection at the end of the command');
  }
  const file = getReadableFile(ctx, path);
  if (!file.write) {
    throw new Error(`echo: file is read-only: ${file.path}`);
  }
  const text = `${args.slice(0, redirectIndex).join(' ')}\n`;
  file.write(operator === '>>' ? `${file.read()}${text}` : text);
  return { output: `${file.path}: ${operator === '>>' ? 'appended' : 'written'}`, mutated: true };
}

function commandSed(ctx: { fs: ReturnType<typeof buildHvyVirtualFileSystem>; cwd: string }, args: string[]): string {
  const warnings = warnUnknownOptions('sed', args.filter((arg) => arg.startsWith('-')), ['-i', '-E', '-r']);
  const positional = args.filter((arg) => arg !== '-i' && arg !== '-E' && arg !== '-r' && !warnings.includes(`Warning: sed ignored unsupported option ${arg}`));
  const expression = positional[0] ?? '';
  const paths = positional.slice(1);
  const match = expression.match(/^s(.)(.*?)\1(.*?)\1([gIi]*)$/);
  if (!match || paths.length === 0) {
    throw new Error('sed: expected sed s/search/replace/[g] path');
  }
  const flags = `${match[4]?.toLowerCase().includes('g') ? 'g' : ''}${match[4]?.toLowerCase().includes('i') ? 'i' : ''}`;
  const regex = new RegExp(match[2] ?? '', flags);
  return withWarnings(paths
    .map((path) => {
      const file = getReadableFile(ctx, path);
      if (!file.write) {
        throw new Error(`sed: file is read-only: ${file.path}`);
      }
      const before = file.read();
      const after = before.replace(regex, match[3] ?? '');
      file.write(after);
      const changed = before === after ? 0 : 1;
      return `${file.path}: ${changed ? 'updated' : 'no matches'}`;
    })
    .join('\n'), warnings);
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
  exec: { command: string[]; terminator: '+' | ';' } | null;
  warnings: string[];
} {
  const warnings: string[] = [];
  let path = '.';
  let namePattern = '';
  let type: 'file' | 'dir' | null = null;
  let maxDepth: number | null = null;
  let exec: { command: string[]; terminator: '+' | ';' } | null = null;

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
    if (arg === '-exec') {
      const command: string[] = [];
      let terminator: '+' | ';' | null = null;
      for (let execIndex = index + 1; execIndex < args.length; execIndex += 1) {
        const execArg = args[execIndex] ?? '';
        if (execArg === '+' || execArg === ';' || execArg === '\\;') {
          terminator = execArg === '+' ? '+' : ';';
          index = execIndex;
          break;
        }
        command.push(execArg);
      }
      if (!terminator) {
        throw new Error('find: -exec expected terminating + or ;');
      }
      exec = { command, terminator };
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

  return { path, namePattern, type, maxDepth, exec, warnings };
}

function expandFindExecCommand(command: string[], paths: string[]): string[] {
  return command.some((arg) => arg === '{}')
    ? command.flatMap((arg) => (arg === '{}' ? paths : [arg]))
    : [...command, ...paths];
}

function parseRgArgs(args: string[]): {
  pattern: string;
  path: string;
  ignoreCase: boolean;
  filesWithMatches: boolean;
  includeGlobs: string[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const positional: string[] = [];
  const includeGlobs: string[] = [];
  let ignoreCase = false;
  let filesWithMatches = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg === '--ignore-case') {
      ignoreCase = true;
      continue;
    }
    if (arg === '--line-number') {
      continue;
    }
    if (arg === '--files-with-matches' || arg === '--list-files') {
      filesWithMatches = true;
      continue;
    }
    if (arg === '--include') {
      const glob = args[index + 1] ?? '';
      if (glob) {
        includeGlobs.push(glob);
        index += 1;
      } else {
        warnings.push('Warning: rg --include expects a glob');
      }
      continue;
    }
    if (arg.startsWith('--include=')) {
      const glob = arg.slice('--include='.length);
      if (glob) {
        includeGlobs.push(glob);
      } else {
        warnings.push('Warning: rg --include expects a glob');
      }
      continue;
    }
    if (/^-[A-Za-z]+$/.test(arg)) {
      for (const flag of arg.slice(1)) {
        if (flag === 'i') {
          ignoreCase = true;
        } else if (flag === 'n') {
          // Line numbers are always included for matched lines.
        } else if (flag === 'l') {
          filesWithMatches = true;
        } else if (flag === 'r' || flag === 'R' || flag === 'S') {
          // Virtual rg searches recursively by default.
          // Smart-case is unnecessary because searches are case-sensitive unless -i is present.
        } else {
          warnings.push(`Warning: rg ignored unsupported option -${flag}`);
        }
      }
      continue;
    }
    if (arg.startsWith('-')) {
      warnings.push(`Warning: rg ignored unsupported option ${arg}`);
      continue;
    }
    positional.push(arg);
  }

  return {
    pattern: positional[0] ?? '',
    path: positional[1] ?? '.',
    ignoreCase,
    filesWithMatches,
    includeGlobs,
    warnings,
  };
}

function normalizeRgPattern(pattern: string): string {
  return pattern.replaceAll('\\|', '|');
}

function parseMiniShell(args: string[]): HvyMiniShellPipeline[] {
  const pipelines: HvyMiniShellPipeline[] = [];
  let current: string[] = [];
  let operator: 'first' | '&&' | '||' = 'first';
  for (const arg of args) {
    if (arg === '&&' || arg === '||') {
      if (current.length > 0) {
        pipelines.push({ operator, commands: splitPipeline(current), tokens: current });
        current = [];
      }
      operator = arg;
      continue;
    }
    current.push(arg);
  }
  if (current.length > 0) {
    pipelines.push({ operator, commands: splitPipeline(current), tokens: current });
  }
  return pipelines;
}

function splitPipeline(args: string[]): string[][] {
  return splitOnToken(args, '|');
}

function splitOnToken(args: string[], token: string): string[][] {
  const groups: string[][] = [];
  let current: string[] = [];
  for (const arg of args) {
    if (arg === token) {
      if (current.length > 0) {
        groups.push(current);
        current = [];
      }
      continue;
    }
    current.push(arg);
  }
  if (current.length > 0) {
    groups.push(current);
  }
  return groups;
}

async function executeMiniShellPipeline(ctx: HvyCliCommandContext, commands: string[][]): Promise<HvyMiniShellProcess> {
  let stdout = '';
  let stderr = '';
  let mutated = false;
  let status = 0;
  for (let index = 0; index < commands.length; index += 1) {
    const result = await runMiniShellApplication(ctx, commands[index] ?? [], index === 0 ? null : stdout);
    stdout = result.stdout;
    stderr = result.stderr;
    status = result.status;
    mutated = mutated || result.mutated;
    ctx.cwd = result.cwd;
    if (status !== 0) {
      break;
    }
  }
  return { cwd: ctx.cwd, stdout, stderr, status, mutated };
}

async function runMiniShellApplication(ctx: HvyCliCommandContext, commandArgs: string[], stdin: string | null): Promise<HvyMiniShellProcess> {
  const [command = '', ...args] = commandArgs;
  if (!command) {
    return { cwd: ctx.cwd, stdout: '', stderr: '', status: 0, mutated: false };
  }
  try {
    const result = stdin === null
      ? await runCommand(ctx, command, args)
      : await runPipedCommand(ctx, command, args, stdin);
    return { cwd: result.cwd, stdout: result.output, stderr: '', status: 0, mutated: result.mutated };
  } catch (error) {
    return {
      cwd: ctx.cwd,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      status: 1,
      mutated: false,
    };
  }
}

async function runPipedCommand(ctx: HvyCliCommandContext, command: string, args: string[], stdin: string): Promise<HvyCliExecution> {
  if (command === 'cat') {
    return { cwd: ctx.cwd, output: stdin, mutated: false };
  }
  if (command === 'nl') {
    return { cwd: ctx.cwd, output: stdin
      .split('\n')
      .map((line, index) => `${String(index + 1).padStart(6, ' ')}\t${line}`)
      .join('\n'), mutated: false };
  }
  if (command === 'head' || command === 'tail') {
    const count = parseLineCountArg(args, 10);
    const lines = stdin.split('\n');
    return { cwd: ctx.cwd, output: (command === 'head' ? lines.slice(0, count) : lines.slice(Math.max(0, lines.length - count))).join('\n'), mutated: false };
  }
  if (command === 'grep' || command === 'rg') {
    return { cwd: ctx.cwd, output: applyGrepFilter(stdin, args), mutated: false };
  }
  if (command === 'sed') {
    const sliced = applySedPrintFilter(stdin, args);
    if (sliced !== null) {
      return { cwd: ctx.cwd, output: sliced, mutated: false };
    }
    const replaced = applySedReplaceFilter(stdin, args);
    if (replaced !== null) {
      return { cwd: ctx.cwd, output: replaced, mutated: false };
    }
    throw new Error('sed: expected sed -n START,ENDp or sed s/search/replace/[g]');
  }
  if (command === 'sort' || command === 'uniq' || command === 'wc') {
    return { ...applyTextCommand(stdin, command, args), cwd: ctx.cwd };
  }
  if (command === 'xargs') {
    return applyXargsStage(ctx, stdin, args);
  }
  throw new Error(`Unknown command "${command}". Try "help".`);
}

function runTextCommand(ctx: HvyCliCommandContext, command: string, args: string[]): HvyCliExecution {
  const positional = args.filter((arg) => !arg.startsWith('-'));
  const fileArgs = command === 'grep' ? positional.slice(1) : positional;
  const input = fileArgs.length > 0
    ? fileArgs.map((path) => getReadableFile(ctx, path).read()).join('\n')
    : '';
  return { ...applyTextCommand(input, command, args), cwd: ctx.cwd };
}

function applyTextCommand(output: string, command: string, args: string[]): HvyCliExecution {
  if (command === 'grep') {
    return { cwd: '/', output: applyGrepFilter(output, args), mutated: false };
  }
  if (command === 'sort') {
    return { cwd: '/', output: output.split('\n').sort().join('\n'), mutated: false };
  }
  if (command === 'uniq') {
    return { cwd: '/', output: output
      .split('\n')
      .filter((line, index, lines) => index === 0 || line !== lines[index - 1])
      .join('\n'), mutated: false };
  }
  if (command === 'wc') {
    if (!args.includes('-l')) {
      throw new Error('wc: expected -l');
    }
    return { cwd: '/', output: String(output.length === 0 ? 0 : output.split('\n').length), mutated: false };
  }
  throw new Error(`Unknown command "${command}". Try "help".`);
}

function applyGrepFilter(output: string, args: string[]): string {
  let ignoreCase = false;
  let invert = false;
  const positional: string[] = [];
  for (const arg of args) {
    if (/^-[A-Za-z]+$/.test(arg)) {
      for (const flag of arg.slice(1)) {
        if (flag === 'i') ignoreCase = true;
        if (flag === 'v') invert = true;
      }
      continue;
    }
    positional.push(arg);
  }
  const pattern = positional[0] ?? '';
  if (!pattern) {
    return withWarnings(output, [`Warning: ${args[0] ?? 'grep'} filter missing pattern`]);
  }
  const regex = new RegExp(normalizeRgPattern(pattern), ignoreCase ? 'i' : '');
  return output
    .split('\n')
    .filter((line) => regex.test(line) !== invert)
    .join('\n');
}

async function applyXargsStage(ctx: HvyCliCommandContext, output: string, args: string[]): Promise<HvyCliExecution> {
  const inputItems = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const parsed = parseXargsArgs(args);
  if (inputItems.length === 0 && parsed.noRunIfEmpty) {
    return { cwd: ctx.cwd, output: '', mutated: false };
  }
  if (parsed.command.length === 0) {
    throw new Error('xargs: expected command');
  }

  const commandOutputs: string[] = [];
  let mutated = false;
  const runs = parsed.replacement
    ? inputItems.map((item) => parsed.command.map((arg) => arg.replaceAll(parsed.replacement ?? '{}', item)))
    : [parsed.command.concat(inputItems)];

  for (const runArgs of runs) {
    const [command = '', ...commandRest] = runArgs;
    const result = await runCommand(ctx, command, commandRest);
    ctx.cwd = result.cwd;
    mutated = mutated || result.mutated;
    if (result.output.length > 0) {
      commandOutputs.push(result.output);
    }
  }

  return { cwd: ctx.cwd, output: commandOutputs.join('\n'), mutated };
}

function parseXargsArgs(args: string[]): { noRunIfEmpty: boolean; replacement: string | null; command: string[] } {
  let noRunIfEmpty = false;
  let replacement: string | null = null;
  const command: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg === '-r' || arg === '--no-run-if-empty') {
      noRunIfEmpty = true;
      continue;
    }
    if (arg === '-I') {
      replacement = args[index + 1] ?? '{}';
      index += 1;
      continue;
    }
    command.push(arg);
  }
  return { noRunIfEmpty, replacement, command };
}

function applySedPrintFilter(output: string, args: string[]): string | null {
  const expression = args.find((arg) => /^\d+,\d+p$/.test(arg));
  if (!expression || !args.includes('-n')) {
    return null;
  }
  const [rawStart = '', rawEnd = ''] = expression.replace(/p$/, '').split(',');
  const start = Number.parseInt(rawStart, 10);
  const end = Number.parseInt(rawEnd, 10);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }
  return output.split('\n').slice(Math.max(0, start - 1), Math.max(start, end)).join('\n');
}

function applySedReplaceFilter(output: string, args: string[]): string | null {
  const expression = args.find((arg) => /^s(.)(.*?)\1(.*?)\1[gIig]*$/.test(arg));
  const match = expression?.match(/^s(.)(.*?)\1(.*?)\1([gIig]*)$/);
  if (!match) {
    return null;
  }
  const flags = `${match[4]?.toLowerCase().includes('g') ? 'g' : ''}${match[4]?.toLowerCase().includes('i') ? 'i' : ''}`;
  return output.replace(new RegExp(match[2] ?? '', flags), match[3] ?? '');
}

function parseLineCountArg(args: string[], fallback: number): number {
  const explicitNIndex = args.indexOf('-n');
  const raw = explicitNIndex >= 0 ? args[explicitNIndex + 1] : args.find((arg) => /^-\d+$/.test(arg))?.slice(1);
  const count = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(count) ? Math.max(1, Math.min(100, count)) : fallback;
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

export function tokenizeCommand(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] ?? '';
    if (!quote && input.slice(index, index + 2) === '&&') {
      if (current) {
        tokens.push(current);
        current = '';
      }
      tokens.push('&&');
      index += 1;
      continue;
    }
    if (!quote && input.slice(index, index + 2) === '||') {
      if (current) {
        tokens.push(current);
        current = '';
      }
      tokens.push('||');
      index += 1;
      continue;
    }
    if (!quote && input.slice(index, index + 2) === '>>') {
      if (current) {
        tokens.push(current);
        current = '';
      }
      tokens.push('>>');
      index += 1;
      continue;
    }
    if (!quote && (char === '|' || char === '>')) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      tokens.push(char);
      continue;
    }
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
  const normalizedTopic = topic.trim();
  if (normalizedTopic.startsWith('hvy plugin ')) {
    const pluginTopic = normalizedTopic.slice('hvy '.length);
    const pluginName = pluginTopic.slice('plugin '.length).split(/\s+/, 1)[0] ?? '';
    if (getHvyCliPluginCommandRegistration(pluginName)) {
      return hvyDocumentCommandHelp(pluginTopic);
    }
  }

  const help: Record<string, string> = {
    '': 'Commands: cd, pwd, ls, cat, head, tail, nl, find, rg, grep, sort, uniq, wc, xargs, rm, echo, sed, true, hvy. Finish: done SUMMARY. Use man <command> for details.',
    cd: formatCommandHelp('cd PATH', 'Change the current virtual directory.'),
    pwd: formatCommandHelp('pwd', 'Print the current virtual directory.'),
    ls: formatCommandHelp('ls [PATH]', 'List files and directories.'),
    cat: formatCommandHelp('cat FILE...', 'Print file contents.'),
    head: formatCommandHelp('head [-n COUNT] FILE', 'Print the first lines of a file. COUNT maxes at 100.'),
    tail: formatCommandHelp('tail [-n COUNT] FILE', 'Print the last lines of a file. COUNT maxes at 100.'),
    nl: formatCommandHelp('nl FILE', 'Print file contents with line numbers.'),
    find: formatCommandHelp('find [PATH] [-name GLOB] [-type f|d] [-maxdepth N] [-print] [-exec COMMAND {} +]', 'List up to 100 virtual paths below PATH, or run a supported command against matches with -exec.'),
    rg: formatCommandHelp('rg [-i] [-n] [-l] [--include GLOB] PATTERN [PATH]', 'Search readable virtual files. Line numbers are shown by default; -l prints matching file paths.'),
    grep: formatCommandHelp('grep [-i] [-v] PATTERN [FILE...]', 'Filter text by pattern, or search the provided files.'),
    sort: formatCommandHelp('sort [FILE...]', 'Sort lines.'),
    uniq: formatCommandHelp('uniq [FILE...]', 'Remove adjacent duplicate lines.'),
    wc: formatCommandHelp('wc -l [FILE...]', 'Count lines.'),
    xargs: formatCommandHelp('COMMAND | xargs [-r] [-I TOKEN] COMMAND ARG...', 'Run a supported CLI command with piped non-empty lines appended, or once per line with -I replacement.'),
    rm: formatCommandHelp('rm -r PATH...', 'Remove section or component directories from the virtual document body. Alias: hvy remove PATH.'),
    echo: formatCommandHelp('echo TEXT [> FILE|>> FILE]', 'Print text, replace a writable file, or append to a writable file.'),
    sed: formatCommandHelp('sed [-i] [-E] s/search/replace/[gI] FILE...', 'Update writable virtual files with a search/replace.'),
    true: formatCommandHelp('true', 'Succeed without output. Useful in command chains such as COMMAND || true.'),
    done: formatCommandHelp('done SUMMARY', 'Finish the AI CLI edit loop with a short summary.'),
    hvy: hvyDocumentCommandHelp(),
    section: hvyDocumentCommandHelp('section'),
    text: hvyDocumentCommandHelp('text'),
    table: hvyDocumentCommandHelp('table'),
    plugin: hvyDocumentCommandHelp('plugin'),
    'hvy plugin': hvyDocumentCommandHelp('plugin'),
    'hvy plugin form': hvyDocumentCommandHelp('plugin form'),
    'hvy plugin db-table': hvyDocumentCommandHelp('plugin db-table'),
    form: `${hvyDocumentCommandHelp('plugin form')}\nLegacy alias: form add ...`,
    'db-table': `${hvyDocumentCommandHelp('plugin db-table')}\nLegacy aliases: db-table show/query/exec/tables/schema ...`,
  };
  return help[normalizedTopic] ?? help[''];
}

function formatCommandHelp(command: string, description: string): string {
  return `${command}\n  ${description}`;
}
