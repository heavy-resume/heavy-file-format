import type { VisualDocument } from '../types';
import {
  buildHvyVirtualFileSystem,
  findBlockForVirtualDirectory,
  findBlockInsertionTargetForVirtualDirectory,
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
import { formatHvyCliLintIssues, runHvyCliLinter } from './document-linter';
import { isBuiltinComponentName } from '../component-defs';
import { serializeBlockFragment } from '../serialization';
import { formatHvyRequestStructureForDirectory } from './request-structure';
import { cloneReusableBlock } from '../document-factory';

const SCRATCHPAD_SOFT_MAX_CHARS = 600;
const SCRATCHPAD_HARD_MAX_CHARS = 800;
const FIND_MAX_RESULTS = 100;
const CLI_OUTPUT_MAX_LINES = 100;
const COMPONENT_PREVIEW_MAX_LINES = 25;

export interface HvyCliSession {
  cwd: string;
  scratchpadContent?: string;
  scratchpadEdited?: boolean;
  scratchpadCommandsSinceEdit?: string[];
  scratchpadTouchedThisCommand?: boolean;
  now?: Date;
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
  session.scratchpadTouchedThisCommand = false;
  const expandedInput = expandShellSubstitutions(input, session.now ?? new Date());
  if (expandedInput.trim().startsWith('#')) {
    return { cwd: session.cwd, output: '', mutated: false };
  }
  const heredoc = parseCatHeredocWrite(expandedInput);
  if (heredoc) {
    const fs = buildHvyVirtualFileSystem(document);
    addSessionScratchpadFile(fs, session);
    const result = writeVirtualFile({ fs, cwd: session.cwd }, heredoc.path, heredoc.content, false, 'cat');
    enforceScratchpadHardCap(session);
    updateScratchpadCommandHistory(session, expandedInput);
    return { cwd: session.cwd, output: result.output, mutated: result.mutated };
  }
  const args = tokenizeCommand(expandedInput);
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

  updateScratchpadCommandHistory(session, expandedInput);
  const output = truncateCliOutput(lastProcess.status === 0 ? lastProcess.stdout : lastProcess.stderr || lastProcess.stdout, { preserveFindWarning: true });
  const result = { cwd: session.cwd, output, mutated };
  if (scratchpadTouched && isScratchpadTooLong(session)) {
    return { ...result, output: `${result.output}\n\n${buildScratchpadTooLongMessage(session.scratchpadContent ?? '')}` };
  }
  return result;
}

export function executeHvyCliCommandSync(document: VisualDocument, input: string, cwd = '/'): HvyCliExecution {
  const expandedInput = expandShellSubstitutions(input, new Date());
  const args = tokenizeCommand(expandedInput);
  if (args.length === 0) {
    return { cwd, output: '', mutated: false };
  }
  if (args.some((arg) => ['|', '&&', '||', ';', '>', '>>', '<'].includes(arg))) {
    throw new Error('doc.cli.run supports one command at a time without pipes, command chaining, or redirection.');
  }
  const [command = '', ...rest] = args;
  const fs = buildHvyVirtualFileSystem(document);
  const ctx: HvyCliCommandContext = { document, fs, cwd };
  if (command === 'help' || command === 'man') {
    return { cwd, output: helpFor(rest.join(' ')), mutated: false };
  }
  if (rest.includes('--help')) {
    return { cwd, output: helpFor(command), mutated: false };
  }
  if (command === 'pwd') {
    return { cwd, output: cwd, mutated: false };
  }
  if (command === 'ls') {
    return { cwd, output: commandLs(ctx, rest), mutated: false };
  }
  if (command === 'cat') {
    return { cwd, output: commandCat(ctx, rest), mutated: false };
  }
  if (command === 'head' || command === 'tail') {
    return { cwd, output: commandHeadTail(ctx, rest, command), mutated: false };
  }
  if (command === 'nl') {
    return { cwd, output: commandNl(ctx, rest), mutated: false };
  }
  if (command === 'rg') {
    return { cwd, output: commandRg(ctx, rest), mutated: false };
  }
  if (command === 'grep') {
    return { cwd, output: commandGrep(ctx, rest), mutated: false };
  }
  if (command === 'find') {
    return { cwd, output: commandFindWithoutExec(ctx, rest), mutated: false };
  }
  if (command === 'rm') {
    return { cwd, output: commandRm(ctx, rest), mutated: true };
  }
  if (command === 'cp') {
    return { cwd, output: commandCp(ctx, rest), mutated: true };
  }
  if (command === 'sed') {
    return { cwd, output: commandSed(ctx, rest), mutated: true };
  }
  if (command === 'hvy') {
    if (rest[0] === 'lint') {
      throw new Error('doc.cli.run cannot run hvy lint because plugin lint checks may be async.');
    }
    if (rest[0] === 'plugin' && rest[1] === 'db-table' && isDbTableSqlAction(rest[2] ?? '')) {
      throw new Error('doc.cli.run cannot run db-table SQL commands. Use doc.db.query or doc.db.execute instead.');
    }
    if (rest[0] === 'add-component') {
      const [component = '', ...componentRest] = rest.slice(1);
      const result = executeHvyDocumentCommand(ctx, ['add', component, ...componentRest]);
      return { cwd, output: result.output, mutated: result.mutated };
    }
    if (rest[0] === 'prune-xref') {
      return { cwd, output: commandPruneXref(document, rest.slice(1)), mutated: true };
    }
    if (rest[0] === 'read') {
      return { cwd, output: commandCat(ctx, rest.slice(1)), mutated: false };
    }
    if (rest[0] === 'preview') {
      return { cwd, output: commandHvyPreview(ctx, rest.slice(1)), mutated: false };
    }
    if (rest[0] === 'remove' || rest[0] === 'delete') {
      return { cwd, output: commandRm(ctx, ['-r', ...rest.slice(1)]), mutated: true };
    }
    const result = executeHvyDocumentCommand(ctx, rest);
    return { cwd, output: result.output, mutated: result.mutated };
  }
  throw new Error(`doc.cli.run does not support command "${command}".`);
}

function truncateCliOutput(output: string, options: { preserveFindWarning?: boolean } = {}): string {
  if (!output) {
    return output;
  }
  const lines = output.split('\n');
  if (lines.length <= CLI_OUTPUT_MAX_LINES) {
    return output;
  }
  const hiddenCount = lines.length - CLI_OUTPUT_MAX_LINES;
  if (options.preserveFindWarning && /^Warning: find output truncated/.test(lines[0] ?? '')) {
    return [
      lines[0],
      ...lines.slice(1, CLI_OUTPUT_MAX_LINES + 1),
      `Warning: output truncated to ${CLI_OUTPUT_MAX_LINES} of ${lines.length - 1} result lines (${Math.max(0, hiddenCount - 1)} lines hidden). Narrow the command with rg, find -name, head, or a more specific path.`,
    ].join('\n');
  }
  return [
    ...lines.slice(0, CLI_OUTPUT_MAX_LINES),
    `Warning: output truncated to ${CLI_OUTPUT_MAX_LINES} of ${lines.length} lines (${hiddenCount} lines hidden). Narrow the command with rg, find -name, head, or a more specific path.`,
  ].join('\n');
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
  if (command === 'ask') {
    return { cwd: ctx.cwd, output: args.join(' ').trim(), mutated: false };
  }
  if (command === 'cd') {
    const next = resolveVirtualPath(ctx.fs, ctx.cwd, args[0] ?? '/');
    const entry = ctx.fs.entries.get(next);
    if (!entry || entry.kind !== 'dir') {
      throw new Error(formatMissingPathMessage(ctx.fs, ctx.cwd, args[0] ?? '/', `cd: no such directory: ${args[0] ?? '/'}`, 'dir'));
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
  if (command === 'grep') {
    return { cwd: ctx.cwd, output: commandGrep(ctx, args), mutated: false };
  }
  if (command === 'sort' || command === 'uniq' || command === 'wc' || command === 'tr') {
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
  if (command === 'cp') {
    return { cwd: ctx.cwd, output: commandCp(ctx, args), mutated: true };
  }
  if (command === 'echo') {
    const result = commandEcho(ctx, args);
    return { cwd: ctx.cwd, output: result.output, mutated: result.mutated };
  }
  if (command === 'sed') {
    return { cwd: ctx.cwd, output: commandSed(ctx, args), mutated: true };
  }
  if (command === 'hvy') {
    if (args[0] === 'add-component') {
      const [component = '', ...rest] = args.slice(1);
      const result = executeHvyDocumentCommand(ctx, ['add', component, ...rest]);
      return { cwd: ctx.cwd, output: result.output, mutated: result.mutated };
    }
    if (args[0] === 'lint') {
      return { cwd: ctx.cwd, output: formatHvyCliLintIssues(await runHvyCliLinter(ctx.document)), mutated: false };
    }
    if (args[0] === 'prune-xref') {
      return { cwd: ctx.cwd, output: commandPruneXref(ctx.document, args.slice(1)), mutated: true };
    }
    if (args[0] === 'read') {
      return { cwd: ctx.cwd, output: commandCat(ctx, args.slice(1)), mutated: false };
    }
    if (args[0] === 'preview') {
      return { cwd: ctx.cwd, output: commandHvyPreview(ctx, args.slice(1)), mutated: false };
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

function commandLs(ctx: HvyCliCommandContext, args: string[]): string {
  const recursive = args.some((arg) => arg === '-R' || arg === '--recursive');
  const warnings = warnUnknownOptions('ls', args, ['-R', '--recursive']);
  const target = resolveVirtualPath(ctx.fs, ctx.cwd, args.find((arg) => !arg.startsWith('-')) ?? '.');
  const entry = ctx.fs.entries.get(target);
  if (!entry) {
    throw new Error(formatMissingPathMessage(ctx.fs, ctx.cwd, target, `ls: no such file or directory: ${target}`));
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
  return withWarnings(
    [
      listDirectory(ctx.fs, target).map(formatEntry).join('\n'),
      formatLsTargetDescription(ctx, target),
    ].filter((part) => part.trim().length > 0).join('\n\n'),
    warnings
  );
}

function formatLsTargetDescription(ctx: HvyCliCommandContext, directoryPath: string): string {
  const section = readJsonFileFromVirtualPath(ctx.fs, `${directoryPath}/section.json`);
  if (section) {
    return formatMetadataDescription('Section metadata:', section);
  }
  const componentName = inferComponentNameForDirectory(ctx.fs, directoryPath);
  if (!componentName) {
    return '';
  }
  const component = readJsonFileFromVirtualPath(ctx.fs, `${directoryPath}/${componentName}.json`);
  return component ? formatMetadataDescription('Component metadata:', component) : '';
}

function formatMetadataDescription(label: string, value: Record<string, unknown>): string {
  const description = typeof value.description === 'string' ? value.description.trim() : '';
  if (!description) {
    return '';
  }
  const id = typeof value.id === 'string' && value.id.trim() ? value.id.trim() : '';
  return [label, ...(id ? [`  id: ${id}`] : []), `  description: ${description.replace(/\s+/g, ' ')}`].join('\n');
}

function readJsonFileFromVirtualPath(fs: ReturnType<typeof buildHvyVirtualFileSystem>, path: string): Record<string, unknown> | null {
  const entry = fs.entries.get(path);
  if (!entry || entry.kind !== 'file') {
    return null;
  }
  try {
    const value = JSON.parse(entry.read()) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function inferComponentNameForDirectory(fs: ReturnType<typeof buildHvyVirtualFileSystem>, directoryPath: string): string {
  const componentJsonFiles = listDirectory(fs, directoryPath)
    .filter((entry): entry is HvyVirtualFile => entry.kind === 'file')
    .map((entry) => entry.path.split('/').pop() ?? '')
    .filter((name) => name.endsWith('.json') && name !== 'section.json');
  if (componentJsonFiles.length !== 1) {
    return '';
  }
  return componentJsonFiles[0]?.replace(/\.json$/i, '') ?? '';
}

function addSessionScratchpadFile(fs: ReturnType<typeof buildHvyVirtualFileSystem>, session: HvyCliSession): void {
  session.scratchpadContent ??= defaultScratchpadContent();
  session.scratchpadCommandsSinceEdit ??= [];
  fs.entries.set('/scratchpad.txt', {
    kind: 'file',
    path: '/scratchpad.txt',
    read: () => session.scratchpadContent ?? defaultScratchpadContent(),
    write: (content) => {
      session.scratchpadContent = content;
      session.scratchpadEdited = true;
      session.scratchpadTouchedThisCommand = true;
    },
  });
}

function updateScratchpadCommandHistory(session: HvyCliSession, input: string): void {
  if (session.scratchpadTouchedThisCommand) {
    session.scratchpadCommandsSinceEdit = [];
    return;
  }
  session.scratchpadCommandsSinceEdit = [...(session.scratchpadCommandsSinceEdit ?? []), input].slice(-4);
}

function defaultScratchpadContent(): string {
  return 'You havent written your plan yet.\n';
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

function commandCat(ctx: HvyCliCommandContext, args: string[]): string {
  if (args.length === 0) {
    throw new Error('cat: missing file operand');
  }
  return args.map((arg) => formatCatReadableOutput(ctx, arg)).join('\n');
}

function formatCatReadableOutput(ctx: HvyCliCommandContext, path: string): string {
  const file = getReadableFile(ctx, path);
  const componentDirectory = componentDirectoryForReadableTarget(ctx, path, file.path);
  const componentName = componentDirectory ? inferComponentNameForDirectory(ctx.fs, componentDirectory) : '';
  if (!componentDirectory || !componentName || isBuiltinComponentName(componentName)) {
    return file.read();
  }
  return [
    file.read(),
    formatLsTargetDescription(ctx, componentDirectory),
  ].filter((part) => part.trim().length > 0).join('\n\n');
}

function commandHvyPreview(ctx: HvyCliCommandContext, args: string[]): string {
  if (args.length !== 1) {
    throw new Error('hvy preview: expected PATH');
  }
  const componentDirectory = componentDirectoryForReadableTarget(ctx, args[0] ?? '');
  if (!componentDirectory) {
    throw new Error(formatMissingPathMessage(ctx.fs, ctx.cwd, args[0] ?? '', `hvy preview: no component found at ${args[0] ?? ''}`, 'dir'));
  }
  return formatComponentRawPreview(ctx, componentDirectory);
}

function componentDirectoryForReadableTarget(ctx: HvyCliCommandContext, path: string, readablePath?: string): string {
  const normalized = resolveVirtualPath(ctx.fs, ctx.cwd, path);
  const entry = ctx.fs.entries.get(normalized);
  if (entry?.kind === 'dir' && inferComponentNameForDirectory(ctx.fs, normalized)) {
    return normalized;
  }
  const filePath = readablePath ?? resolveReadablePath(ctx.fs, ctx.cwd, path);
  const parent = filePath.replace(/\/[^/]+$/, '') || '/';
  const componentName = inferComponentNameForDirectory(ctx.fs, parent);
  const fileName = filePath.split('/').pop() ?? '';
  return componentName && fileName === `${componentName}.txt` ? parent : '';
}

function formatComponentRawPreview(ctx: HvyCliCommandContext, directoryPath: string): string {
  const block = findBlockForVirtualDirectory(ctx.document, directoryPath);
  if (!block) {
    return '';
  }
  const fragment = serializeBlockFragment(block, ctx.document.meta);
  const lines = fragment.split('\n');
  if (lines.length > COMPONENT_PREVIEW_MAX_LINES) {
    const componentId = block.schema.id.trim();
    const command = componentId
      ? `hvy request_structure ${componentId} --describe`
      : `hvy request_structure ${directoryPath} --describe`;
    const structureLines = formatHvyRequestStructureForDirectory(ctx.document, ctx.fs, directoryPath, { describe: true }).split('\n');
    return [
      `Preview command: ${command}`,
      `Component preview switched to request_structure because raw HVY is ${lines.length} lines.`,
      ...structureLines.slice(0, COMPONENT_PREVIEW_MAX_LINES),
      ...(structureLines.length > COMPONENT_PREVIEW_MAX_LINES ? [`... ${structureLines.length - COMPONENT_PREVIEW_MAX_LINES} more lines`] : []),
    ].join('\n');
  }
  return [
    `Preview command: hvy preview ${directoryPath}`,
    `Component preview (raw HVY, first ${COMPONENT_PREVIEW_MAX_LINES} lines):`,
    ...lines,
  ].join('\n');
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
  const parsed = parseNlArgs(args);
  if (parsed.paths.length === 0) {
    throw new Error('nl: missing file operand');
  }
  return parsed.paths
    .map((path) =>
      getReadableFile(ctx, path)
        .read()
        .split('\n')
        .map((line, index) => `${String(index + 1).padStart(parsed.width, ' ')}${parsed.separator}${line}`)
        .join('\n')
    )
    .join('\n');
}

function parseNlArgs(args: string[]): { paths: string[]; width: number; separator: string } {
  const paths: string[] = [];
  let width = 6;
  let separator = '\t';
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg === '-ba' || arg === '-bt' || arg === '-bn' || arg === '-b' || arg === '-n') {
      if (arg === '-b' || arg === '-n') {
        index += 1;
      }
      continue;
    }
    if (arg === '-w') {
      width = Math.max(1, Number.parseInt(args[index + 1] ?? '6', 10) || 6);
      index += 1;
      continue;
    }
    if (/^-w\d+$/.test(arg)) {
      width = Math.max(1, Number.parseInt(arg.slice(2), 10) || 6);
      continue;
    }
    if (arg === '-s') {
      separator = args[index + 1] ?? separator;
      index += 1;
      continue;
    }
    if (arg.startsWith('-s')) {
      separator = arg.slice(2);
      continue;
    }
    if (arg.startsWith('-')) {
      continue;
    }
    paths.push(arg);
  }
  return { paths, width, separator };
}

async function commandFind(ctx: HvyCliCommandContext, args: string[]): Promise<HvyCliExecution> {
  const parsed = parseFindArgs(args);
  const { matches, warnings } = collectFindMatches(ctx, parsed);
  if (!parsed.exec) {
    return { cwd: ctx.cwd, output: withWarningsFirst(matches.slice(0, FIND_MAX_RESULTS).join('\n'), warnings), mutated: false };
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

function commandFindWithoutExec(ctx: HvyCliCommandContext, args: string[]): string {
  const parsed = parseFindArgs(args);
  if (parsed.exec) {
    throw new Error('doc.cli.run find does not support -exec.');
  }
  const { matches, warnings } = collectFindMatches(ctx, parsed);
  return withWarningsFirst(matches.slice(0, FIND_MAX_RESULTS).join('\n'), warnings);
}

function collectFindMatches(ctx: HvyCliCommandContext, parsed: ReturnType<typeof parseFindArgs>): { matches: string[]; warnings: string[] } {
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
  return {
    matches,
    warnings: matches.length > FIND_MAX_RESULTS && !parsed.exec
      ? [...parsed.warnings, `Warning: find output truncated to ${FIND_MAX_RESULTS} of ${matches.length} results.`]
      : parsed.warnings,
  };
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
  const parsed = parseCliFlags(args, {
    command: 'rm',
    booleanShort: ['r', 'R', 'f'],
    booleanLong: ['recursive', 'force', 'prune-xref'],
  });
  const recursive = parsed.flags.has('r') || parsed.flags.has('R') || parsed.flags.has('recursive');
  const force = parsed.flags.has('f') || parsed.flags.has('force');
  const targets = parsed.positionals;
  if (targets.length === 0) {
    throw new Error('rm: missing operand');
  }
  return withWarnings(targets
    .map((target) => {
      const resolved = resolveVirtualPath(ctx.fs, ctx.cwd, target);
      const entry = ctx.fs.entries.get(resolved);
      if (!entry) {
        if (force) {
          return '';
        }
        throw new Error(formatMissingPathMessage(ctx.fs, ctx.cwd, target, `rm: no such file or directory: ${target}`, 'dir'));
      }
      if (entry.kind === 'file') {
        throw new Error(`rm: cannot remove virtual file directly: ${resolved}`);
      }
      if (!recursive) {
        throw new Error(`rm: ${resolved} is a directory; use -r`);
      }
      removeDocumentDirectory(ctx.document, resolved);
      const targetId = resolved.split('/').filter(Boolean).at(-1) ?? '';
      const xrefHint = pruneXrefHint(ctx.document, targetId, parsed.flags.has('prune-xref'));
      return [`${resolved}: removed`, xrefHint].filter(Boolean).join('\n');
    })
    .filter((line) => line.length > 0)
    .join('\n'), parsed.warnings);
}

function commandCp(ctx: HvyCliCommandContext, args: string[]): string {
  const parsed = parseCliFlags(args, {
    command: 'cp',
    booleanShort: ['r', 'R'],
    booleanLong: ['recursive'],
  });
  const recursive = parsed.flags.has('r') || parsed.flags.has('R') || parsed.flags.has('recursive');
  if (parsed.positionals.length !== 2) {
    throw new Error('cp: expected SOURCE DEST');
  }
  const [source = '', destination = ''] = parsed.positionals;
  const sourcePath = resolveVirtualPath(ctx.fs, ctx.cwd, source);
  const sourceEntry = ctx.fs.entries.get(sourcePath);
  if (!sourceEntry) {
    throw new Error(formatMissingPathMessage(ctx.fs, ctx.cwd, source, `cp: no such file or directory: ${source}`, source.endsWith('/') ? 'dir' : undefined));
  }
  if (sourceEntry.kind === 'file') {
    return withWarnings(copyVirtualFile(ctx, sourcePath, destination), parsed.warnings);
  }
  if (!recursive) {
    throw new Error(`cp: ${sourcePath} is a directory; use -r`);
  }
  return withWarnings(copyVirtualComponentDirectory(ctx, sourcePath, destination), parsed.warnings);
}

function copyVirtualFile(ctx: HvyCliCommandContext, sourcePath: string, destination: string): string {
  const sourceFile = getReadableFile(ctx, sourcePath);
  const destinationPath = resolveVirtualPath(ctx.fs, ctx.cwd, destination);
  const destinationEntry = ctx.fs.entries.get(destinationPath);
  if (destinationEntry?.kind === 'dir') {
    throw new Error('cp: copying files into virtual directories is not supported; copy to an existing writable file');
  }
  const destinationFile = getReadableFile(ctx, destination);
  if (!destinationFile.write) {
    throw new Error(`cp: file is read-only: ${destinationFile.path}`);
  }
  destinationFile.write(sourceFile.read());
  return `${sourceFile.path} -> ${destinationFile.path}: copied`;
}

function copyVirtualComponentDirectory(ctx: HvyCliCommandContext, sourcePath: string, destination: string): string {
  const sourceBlock = findBlockForVirtualDirectory(ctx.document, sourcePath);
  if (!sourceBlock) {
    throw new Error(`cp: can only copy component directories: ${sourcePath}`);
  }
  const destinationPath = resolveVirtualPath(ctx.fs, ctx.cwd, destination);
  const destinationEntry = ctx.fs.entries.get(destinationPath);
  const finalPath = destinationEntry?.kind === 'dir'
    ? `${destinationPath}/${sourcePath.split('/').pop() ?? 'copy'}`
    : destinationPath;
  if (ctx.fs.entries.has(finalPath)) {
    throw new Error(`cp: destination already exists: ${finalPath}`);
  }
  const parentPath = finalPath.replace(/\/[^/]+$/, '') || '/';
  const target = findBlockInsertionTargetForVirtualDirectory(ctx.document, parentPath);
  if (!target) {
    throw new Error(formatMissingPathMessage(ctx.fs, ctx.cwd, parentPath, `cp: no writable component container: ${parentPath}`, 'dir'));
  }
  const destinationId = finalPath.split('/').pop() ?? '';
  const clonedBlock = cloneReusableBlock(sourceBlock);
  clonedBlock.schema.id = destinationId;
  target.insert(clonedBlock);
  return `${sourcePath} -> ${finalPath}: copied`;
}

function commandPruneXref(document: VisualDocument, args: string[]): string {
  const targetId = args.join(' ').trim();
  if (!targetId) {
    throw new Error('hvy prune-xref: expected TARGET_ID');
  }
  const removedPaths = collectXrefVirtualPaths(document, targetId);
  const removedCount = pruneXrefs(document, targetId);
  return removedCount > 0
    ? [`Removed ${removedCount} xref-card${removedCount === 1 ? '' : 's'} pointing to ${targetId}.`, ...removedPaths.map((path) => `  ${path}`)].join('\n')
    : `No xref-cards point to ${targetId}.`;
}

function pruneXrefHint(document: VisualDocument, targetId: string, prune: boolean): string {
  if (!targetId) {
    return '';
  }
  if (prune) {
    const removedPaths = collectXrefVirtualPaths(document, targetId);
    const removedCount = pruneXrefs(document, targetId);
    return removedCount > 0
      ? [`Pruned ${removedCount} xref-card${removedCount === 1 ? '' : 's'} pointing to ${targetId}:`, ...removedPaths.map((path) => `  ${path}`)].join('\n')
      : '';
  }
  const refs = collectXrefVirtualPaths(document, targetId);
  return refs.length > 0
    ? [`Hint: ${refs.length} xref-card${refs.length === 1 ? '' : 's'} still point to ${targetId}. Run: hvy prune-xref ${targetId}`, ...refs.slice(0, 5).map((path) => `  ${path}`), ...(refs.length > 5 ? [`  ... ${refs.length - 5} more`] : [])].join('\n')
    : '';
}

function pruneXrefs(document: VisualDocument, targetId: string): number {
  return document.sections.reduce((total, section) => total + pruneXrefsFromSection(section, targetId), 0);
}

function pruneXrefsFromSection(section: VisualSection, targetId: string): number {
  return pruneXrefsFromBlocks(section.blocks, targetId)
    + section.children.reduce((total, child) => total + pruneXrefsFromSection(child, targetId), 0);
}

function pruneXrefsFromBlocks(blocks: VisualBlock[], targetId: string): number {
  let removed = 0;
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (!block) {
      continue;
    }
    if (block.schema.component === 'xref-card' && block.schema.xrefTarget === targetId) {
      blocks.splice(index, 1);
      removed += 1;
      continue;
    }
    for (const nestedBlocks of getNestedBlockLists(block)) {
      removed += pruneXrefsFromBlocks(nestedBlocks, targetId);
    }
  }
  return removed;
}

function collectXrefVirtualPaths(document: VisualDocument, targetId: string): string[] {
  const fs = buildHvyVirtualFileSystem(document);
  return [...fs.entries.values()]
    .filter((entry): entry is HvyVirtualFile => entry.kind === 'file' && entry.path.endsWith('/xref-card.json'))
    .filter((entry) => {
      try {
        const value = JSON.parse(entry.read()) as { xrefTarget?: unknown };
        return value.xrefTarget === targetId;
      } catch {
        return false;
      }
    })
    .map((entry) => entry.path.replace(/\/xref-card\.json$/, ''));
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
  const text = `${args.slice(0, redirectIndex).join(' ')}\n`;
  return writeVirtualFile(ctx, path, text, operator === '>>', 'echo');
}

function writeVirtualFile(
  ctx: { fs: ReturnType<typeof buildHvyVirtualFileSystem>; cwd: string },
  path: string,
  content: string,
  append: boolean,
  command: string
): { output: string; mutated: boolean } {
  const file = getReadableFile(ctx, path);
  if (!file.write) {
    throw new Error(`${command}: file is read-only: ${file.path}`);
  }
  file.write(append ? `${file.read()}${content}` : content);
  return { output: `${file.path}: ${append ? 'appended' : 'written'}`, mutated: true };
}

function commandSed(ctx: { fs: ReturnType<typeof buildHvyVirtualFileSystem>; cwd: string }, args: string[]): string {
  const parsed = parseCliFlags(args, {
    command: 'sed',
    booleanShort: ['E', 'r', 'n'],
    prefixShort: ['i'],
  });
  const expression = parsed.positionals[0] ?? '';
  const paths = parsed.positionals.slice(1);
  if (paths.length === 0) {
    throw new Error('sed: expected sed s/search/replace/[g] path');
  }
  return withWarnings(paths
    .map((path) => {
      const file = getReadableFile(ctx, path);
      if (!file.write) {
        throw new Error(`sed: file is read-only: ${file.path}`);
      }
      const before = file.read();
      const after = applySedEditExpression(before, expression);
      file.write(after);
      const changed = before === after ? 0 : 1;
      return `${file.path}: ${changed ? 'updated' : 'no matches'}`;
    })
    .join('\n'), parsed.warnings);
}

function applySedEditExpression(input: string, expression: string): string {
  const parsed = parseSedExpression(expression);
  if (parsed.kind === 'substitute') {
    return input.replace(
      new RegExp(parsed.pattern, `${parsed.flags.includes('g') ? 'g' : ''}${parsed.flags.toLowerCase().includes('i') ? 'i' : ''}`),
      normalizeSedReplacement(parsed.replacement)
    );
  }
  if (parsed.kind === 'delete') {
    const regex = new RegExp(parsed.pattern, parsed.flags.toLowerCase().includes('i') ? 'i' : '');
    return input
      .split(/\r?\n/)
      .filter((line) => !regex.test(line))
      .join('\n');
  }
  throw new Error('sed: expected sed s/search/replace/[g] path or sed /pattern/d path');
}

function normalizeSedReplacement(replacement: string): string {
  return replacement.replace(/\\([1-9])/g, '$$$1');
}

type SedExpression =
  | { kind: 'substitute'; pattern: string; replacement: string; flags: string }
  | { kind: 'delete'; pattern: string; flags: string };

function parseSedExpression(expression: string): SedExpression {
  if (expression.startsWith('s') && expression.length >= 2) {
    const delimiter = expression[1] ?? '';
    const first = readDelimitedSegment(expression, 2, delimiter);
    const second = readDelimitedSegment(expression, first.nextIndex, delimiter);
    return {
      kind: 'substitute',
      pattern: first.value,
      replacement: second.value,
      flags: expression.slice(second.nextIndex),
    };
  }

  const delimiter = expression[0] ?? '';
  if (!delimiter || /[A-Za-z0-9\\]/.test(delimiter)) {
    throw new Error('sed: expected sed s/search/replace/[g] path or sed /pattern/d path');
  }
  const pattern = readDelimitedSegment(expression, 1, delimiter);
  const suffix = expression.slice(pattern.nextIndex);
  if (!suffix.toLowerCase().includes('d')) {
    throw new Error('sed: expected sed s/search/replace/[g] path or sed /pattern/d path');
  }
  return {
    kind: 'delete',
    pattern: pattern.value,
    flags: suffix.replace(/[dD]/g, ''),
  };
}

function readDelimitedSegment(value: string, startIndex: number, delimiter: string): { value: string; nextIndex: number } {
  let result = '';
  for (let index = startIndex; index < value.length; index += 1) {
    const char = value[index] ?? '';
    if (char === '\\' && index + 1 < value.length) {
      const next = value[index + 1] ?? '';
      result += next === delimiter ? next : `${char}${next}`;
      index += 1;
      continue;
    }
    if (char === delimiter) {
      return { value: result, nextIndex: index + 1 };
    }
    result += char;
  }
  throw new Error('sed: unterminated expression');
}

function getReadableFile(ctx: { fs: ReturnType<typeof buildHvyVirtualFileSystem>; cwd: string }, path: string): HvyVirtualFile {
  const normalized = resolveReadablePath(ctx.fs, ctx.cwd, path);
  const entry = ctx.fs.entries.get(normalized);
  if (!entry) {
    throw new Error(formatMissingPathMessage(ctx.fs, ctx.cwd, path, `No such file: ${normalized}`, 'file'));
  }
  if (entry.kind !== 'file') {
    throw new Error(`Is a directory: ${normalized}`);
  }
  return entry;
}

function resolveReadablePath(fs: ReturnType<typeof buildHvyVirtualFileSystem>, cwd: string, path: string): string {
  const normalized = resolveVirtualPath(fs, cwd, path);
  const entry = fs.entries.get(normalized);
  if (entry?.kind === 'file') {
    return normalized;
  }
  if (entry?.kind === 'dir') {
    const componentBody = readableBodyFileForDirectory(fs, normalized);
    if (componentBody) {
      return componentBody;
    }
  }
  if (normalized.endsWith('.txt')) {
    const withoutExtension = normalized.slice(0, -'.txt'.length);
    const directoryEntry = fs.entries.get(withoutExtension);
    if (directoryEntry?.kind === 'dir') {
      const componentBody = readableBodyFileForDirectory(fs, withoutExtension);
      if (componentBody) {
        return componentBody;
      }
    }
  }
  return normalized;
}

function readableBodyFileForDirectory(fs: ReturnType<typeof buildHvyVirtualFileSystem>, directory: string): string | null {
  const directFiles = listDirectory(fs, directory)
    .filter((entry): entry is HvyVirtualFile => entry.kind === 'file')
    .map((entry) => entry.path)
    .filter((entryPath) => entryPath.endsWith('.txt'));
  return directFiles.length === 1 ? directFiles[0] ?? null : null;
}

function parseCatHeredocWrite(input: string): { path: string; content: string } | null {
  const normalized = input.replace(/\r\n?/g, '\n');
  const firstLineEnd = normalized.indexOf('\n');
  if (firstLineEnd < 0) {
    return null;
  }
  const firstLine = normalized.slice(0, firstLineEnd).trim();
  const match = firstLine.match(/^cat\s*>\s*(\S+)\s*<<\s*['"]?([A-Za-z0-9_.-]+)['"]?$/);
  if (!match) {
    return null;
  }
  const path = match[1] ?? '';
  const marker = match[2] ?? '';
  const body = normalized.slice(firstLineEnd + 1);
  const lines = body.split('\n');
  const markerIndex = lines.findIndex((line) => line.trim() === marker);
  if (markerIndex < 0) {
    throw new Error(`cat: heredoc missing terminator ${marker}`);
  }
  return { path, content: `${lines.slice(0, markerIndex).join('\n')}\n` };
}

function expandShellSubstitutions(input: string, now: Date): string {
  let result = '';
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] ?? '';
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? null : char;
      result += char;
      continue;
    }
    if (quote !== "'" && input.slice(index, index + 2) === '$(') {
      const end = findCommandSubstitutionEnd(input, index + 2);
      if (end < 0) {
        throw new Error('Unclosed command substitution.');
      }
      result += evaluateCommandSubstitution(input.slice(index + 2, end), now);
      index = end;
      continue;
    }
    result += char;
  }
  return result;
}

function findCommandSubstitutionEnd(input: string, startIndex: number): number {
  let quote: '"' | "'" | null = null;
  for (let index = startIndex; index < input.length; index += 1) {
    const char = input[index] ?? '';
    if (char === '\\') {
      index += 1;
      continue;
    }
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? null : char;
      continue;
    }
    if (!quote && char === ')') {
      return index;
    }
  }
  return -1;
}

function evaluateCommandSubstitution(commandText: string, now: Date): string {
  const args = tokenizeCommand(commandText.replace(/\\"/g, '"'));
  const [command = '', ...rest] = args;
  if (command !== 'date') {
    throw new Error(`Unsupported command substitution "$(${commandText})". Supported: $(date), $(date -u), $(date +FORMAT), $(date -u +FORMAT).`);
  }
  return formatCliDate(now, rest);
}

function formatCliDate(now: Date, args: string[]): string {
  const useUtc = args.includes('-u') || args.includes('--utc');
  const format = args.find((arg) => arg.startsWith('+')) ?? '+%a %b %d %H:%M:%S %Z %Y';
  return formatDateWithPattern(now, format.slice(1), useUtc);
}

function formatDateWithPattern(date: Date, pattern: string, utc: boolean): string {
  const part = (method: 'FullYear' | 'Month' | 'Date' | 'Hours' | 'Minutes' | 'Seconds') => {
    const prefix = utc ? 'getUTC' : 'get';
    return (date[`${prefix}${method}` as keyof Date] as () => number).call(date);
  };
  const replacements: Record<string, string> = {
    Y: String(part('FullYear')).padStart(4, '0'),
    m: String(part('Month') + 1).padStart(2, '0'),
    d: String(part('Date')).padStart(2, '0'),
    H: String(part('Hours')).padStart(2, '0'),
    M: String(part('Minutes')).padStart(2, '0'),
    S: String(part('Seconds')).padStart(2, '0'),
    Z: utc ? 'UTC' : 'local',
  };
  return pattern.replace(/%([YmdHMSZ%])/g, (_match, token: string) => token === '%' ? '%' : replacements[token] ?? `%${token}`);
}

function formatMissingPathMessage(
  fs: ReturnType<typeof buildHvyVirtualFileSystem>,
  cwd: string,
  rawPath: string,
  message: string,
  kind?: HvyVirtualEntry['kind']
): string {
  const suggestions = suggestVirtualPaths(fs, cwd, rawPath, kind);
  if (suggestions.length === 0) {
    return message;
  }
  return [
    message,
    'Did you mean?',
    ...suggestions.map((suggestion) => `  ${suggestion}`),
  ].join('\n');
}

function suggestVirtualPaths(
  fs: ReturnType<typeof buildHvyVirtualFileSystem>,
  cwd: string,
  rawPath: string,
  kind?: HvyVirtualEntry['kind']
): string[] {
  const normalized = resolveVirtualPath(fs, cwd, rawPath);
  const closestParent = closestExistingParent(fs, normalized);
  const basename = normalized.split('/').filter(Boolean).at(-1) ?? '';
  const candidates = [...fs.entries.values()]
    .filter((entry) => !kind || entry.kind === kind)
    .filter((entry) => entry.path !== '/' && entry.path !== '/body' && entry.path !== '/attachments')
    .map((entry) => ({ entry, score: scorePathSuggestion(normalized, basename, entry.path) }))
    .sort((left, right) => left.score - right.score || left.entry.path.localeCompare(right.entry.path))
    .slice(0, 3)
    .map((candidate) => candidate.entry.path);
  const suggestions = [
    ...(closestParent && closestParent !== normalized ? [`Closest existing parent: ${closestParent}`] : []),
    ...candidates,
  ];
  return [...new Set(suggestions)].slice(0, 4);
}

function closestExistingParent(fs: ReturnType<typeof buildHvyVirtualFileSystem>, path: string): string {
  const parts = path.split('/').filter(Boolean);
  while (parts.length > 0) {
    const candidate = `/${parts.join('/')}`;
    if (fs.entries.has(candidate)) {
      return candidate;
    }
    parts.pop();
  }
  return '/';
}

function scorePathSuggestion(targetPath: string, targetBasename: string, candidatePath: string): number {
  const candidateBasename = candidatePath.split('/').filter(Boolean).at(-1) ?? '';
  const sharedPrefix = commonPrefixLength(targetPath.split('/'), candidatePath.split('/'));
  const basenamePenalty = levenshteinDistance(targetBasename, candidateBasename);
  const pathPenalty = levenshteinDistance(targetPath, candidatePath);
  const containsBonus = targetBasename && candidatePath.includes(targetBasename) ? 20 : 0;
  return pathPenalty + basenamePenalty * 3 - sharedPrefix * 8 - containsBonus;
}

function commonPrefixLength(left: string[], right: string[]): number {
  let index = 0;
  while (left[index] && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

function levenshteinDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_value, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0] ?? 0;
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex] ?? 0;
      const replace = diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      previous[rightIndex] = Math.min(
        above + 1,
        (previous[rightIndex - 1] ?? 0) + 1,
        replace
      );
      diagonal = above;
    }
  }
  return previous[right.length] ?? 0;
}

function parseLineCount(args: string[], fallback: number): { count: number; paths: string[] } {
  const nIndex = args.indexOf('-n');
  const rawCount = nIndex >= 0 ? Number.parseInt(args[nIndex + 1] ?? '', 10) : fallback;
  const count = Number.isFinite(rawCount) ? Math.max(1, Math.min(100, rawCount)) : fallback;
  const paths = args.filter((_arg, index) => index !== nIndex && index !== nIndex + 1);
  return { count, paths };
}

type CliFlagSpec = {
  command: string;
  booleanShort?: string[];
  booleanLong?: string[];
  valueShort?: string[];
  valueLong?: string[];
  prefixShort?: string[];
};

type ParsedCliFlags = {
  flags: Set<string>;
  values: Map<string, string[]>;
  positionals: string[];
  warnings: string[];
};

function parseCliFlags(args: string[], spec: CliFlagSpec): ParsedCliFlags {
  const booleanShort = new Set(spec.booleanShort ?? []);
  const booleanLong = new Set(spec.booleanLong ?? []);
  const valueShort = new Set(spec.valueShort ?? []);
  const valueLong = new Set(spec.valueLong ?? []);
  const prefixShort = new Set(spec.prefixShort ?? []);
  const flags = new Set<string>();
  const values = new Map<string, string[]>();
  const positionals: string[] = [];
  const warnings: string[] = [];
  let parsingFlags = true;

  const addValue = (name: string, value: string) => {
    values.set(name, [...(values.get(name) ?? []), value]);
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (!parsingFlags || arg === '-' || !arg.startsWith('-')) {
      positionals.push(arg);
      continue;
    }
    if (arg === '--') {
      parsingFlags = false;
      continue;
    }
    if (arg.startsWith('--')) {
      const raw = arg.slice(2);
      const equalsIndex = raw.indexOf('=');
      const name = equalsIndex >= 0 ? raw.slice(0, equalsIndex) : raw;
      if (booleanLong.has(name)) {
        flags.add(name);
        continue;
      }
      if (valueLong.has(name)) {
        const value = equalsIndex >= 0 ? raw.slice(equalsIndex + 1) : args[index + 1];
        if (value === undefined || (equalsIndex < 0 && value.startsWith('-'))) {
          throw new Error(`${spec.command}: --${name} expects a value`);
        }
        addValue(name, value);
        if (equalsIndex < 0) {
          index += 1;
        }
        continue;
      }
      warnings.push(`Warning: ${spec.command} ignored unsupported option --${name}`);
      continue;
    }

    const cluster = arg.slice(1);
    for (let clusterIndex = 0; clusterIndex < cluster.length; clusterIndex += 1) {
      const name = cluster[clusterIndex] ?? '';
      const rest = cluster.slice(clusterIndex + 1);
      if (booleanShort.has(name)) {
        flags.add(name);
        continue;
      }
      if (prefixShort.has(name)) {
        flags.add(name);
        if (rest.length > 0) {
          addValue(name, rest);
        }
        break;
      }
      if (valueShort.has(name)) {
        const value = rest.length > 0 ? rest : args[index + 1];
        if (value === undefined || (rest.length === 0 && value.startsWith('-'))) {
          throw new Error(`${spec.command}: -${name} expects a value`);
        }
        addValue(name, value);
        if (rest.length === 0) {
          index += 1;
        }
        break;
      }
      warnings.push(`Warning: ${spec.command} ignored unsupported option -${name}`);
    }
  }

  return { flags, values, positionals, warnings };
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
  const parsed = parseCliFlags(args, {
    command: 'rg',
    booleanShort: ['i', 'n', 'l', 'r', 'R', 'S'],
    booleanLong: ['ignore-case', 'line-number', 'hidden', 'no-messages', 'no-ignore', 'files-with-matches', 'list-files'],
    valueLong: ['include'],
  });

  return {
    pattern: parsed.positionals[0] ?? '',
    path: parsed.positionals[1] ?? '.',
    ignoreCase: parsed.flags.has('i') || parsed.flags.has('ignore-case'),
    filesWithMatches: parsed.flags.has('l') || parsed.flags.has('files-with-matches') || parsed.flags.has('list-files'),
    includeGlobs: parsed.values.get('include') ?? [],
    warnings: parsed.warnings,
  };
}

function normalizeRgPattern(pattern: string): string {
  return pattern.replaceAll('\\|', '|');
}

function commandGrep(ctx: HvyCliCommandContext, args: string[]): string {
  const parsed = parseGrepArgs(args);
  if (!parsed.pattern) {
    throw new Error('grep: missing search pattern');
  }
  const regex = new RegExp(normalizeRgPattern(parsed.pattern), parsed.ignoreCase ? 'i' : '');
  const lines: string[] = [];
  const matchingFiles = new Set<string>();
  const roots = parsed.paths.length > 0 ? parsed.paths : ['.'];
  for (const rawRoot of roots) {
    const root = resolveVirtualPath(ctx.fs, ctx.cwd, rawRoot);
    const entry = ctx.fs.entries.get(root);
    if (!entry) {
      throw new Error(formatMissingPathMessage(ctx.fs, ctx.cwd, rawRoot, `grep: no such file or directory: ${root}`));
    }
    const candidates: HvyVirtualFile[] = entry.kind === 'file'
      ? [entry]
      : [...ctx.fs.entries.values()]
        .filter((candidate): candidate is HvyVirtualFile =>
          candidate.kind === 'file' && (candidate.path === root || candidate.path.startsWith(root === '/' ? '/' : `${root}/`)));
    for (const candidate of candidates.sort((left, right) => left.path.localeCompare(right.path))) {
      candidate.read().split('\n').forEach((line, index) => {
        const matched = regex.test(line);
        if (matched !== parsed.invert) {
          matchingFiles.add(candidate.path);
          if (!parsed.filesWithMatches) {
            lines.push(`${candidate.path}:${index + 1}:${line}`);
          }
        }
      });
    }
  }
  return withWarnings((parsed.filesWithMatches ? [...matchingFiles] : lines).join('\n'), parsed.warnings);
}

function parseGrepArgs(args: string[]): {
  pattern: string;
  paths: string[];
  ignoreCase: boolean;
  invert: boolean;
  filesWithMatches: boolean;
  warnings: string[];
} {
  const parsed = parseCliFlags(args, {
    command: 'grep',
    booleanShort: ['i', 'v', 'l', 'R', 'r', 'I'],
  });
  return {
    pattern: parsed.positionals[0] ?? '',
    paths: parsed.positionals.slice(1),
    ignoreCase: parsed.flags.has('i'),
    invert: parsed.flags.has('v'),
    filesWithMatches: parsed.flags.has('l'),
    warnings: parsed.warnings,
  };
}

function parseMiniShell(args: string[]): HvyMiniShellPipeline[] {
  const normalizedArgs = normalizeMiniShellArgs(args);
  const pipelines: HvyMiniShellPipeline[] = [];
  let current: string[] = [];
  let operator: 'first' | '&&' | '||' = 'first';
  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index] ?? '';
    if (
      arg === '2>/dev/null'
      || arg === '2>&1'
      || arg === '2>'
      || arg === '/dev/null'
      || (arg === '2' && normalizedArgs[index + 1] === '>' && normalizedArgs[index + 2] === '&1')
    ) {
      if (arg === '2' && normalizedArgs[index + 1] === '>' && normalizedArgs[index + 2] === '&1') {
        index += 2;
      }
      continue;
    }
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

function normalizeMiniShellArgs(args: string[]): string[] {
  const normalized: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '||' && args[index + 1] === 'true' && args[index + 2] === '|') {
      normalized.push('|');
      index += 2;
      continue;
    }
    normalized.push(args[index] ?? '');
  }
  return normalized;
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
  if (command === 'sort' || command === 'uniq' || command === 'wc' || command === 'tr') {
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
  if (command === 'tr') {
    const from = decodeTrCharacters(args[0] ?? '');
    const to = decodeTrCharacters(args[1] ?? '');
    if (!from) {
      throw new Error('tr: expected SET1 SET2');
    }
    return { cwd: '/', output: inputTranslate(output, from, to), mutated: false };
  }
  throw new Error(`Unknown command "${command}". Try "help".`);
}

function inputTranslate(input: string, from: string, to: string): string {
  return [...input].map((char) => {
    const index = from.indexOf(char);
    return index < 0 ? char : to[Math.min(index, Math.max(0, to.length - 1))] ?? '';
  }).join('');
}

function decodeTrCharacters(value: string): string {
  return value
    .replaceAll('\\n', '\n')
    .replaceAll('\\t', '\t')
    .replaceAll('\\0', '\0');
}

function applyGrepFilter(output: string, args: string[]): string {
  const parsed = parseCliFlags(args, {
    command: 'grep',
    booleanShort: ['i', 'v'],
  });
  const pattern = parsed.positionals[0] ?? '';
  if (!pattern) {
    return withWarnings(output, [`Warning: grep filter missing pattern`, ...parsed.warnings]);
  }
  const regex = new RegExp(normalizeRgPattern(pattern), parsed.flags.has('i') ? 'i' : '');
  return withWarnings(output
    .split('\n')
    .filter((line) => regex.test(line) !== parsed.flags.has('v'))
    .join('\n'), parsed.warnings);
}

async function applyXargsStage(ctx: HvyCliCommandContext, output: string, args: string[]): Promise<HvyCliExecution> {
  const parsed = parseXargsArgs(args);
  const inputItems = output
    .split(parsed.nullInput ? '\0' : /\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
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

function parseXargsArgs(args: string[]): { noRunIfEmpty: boolean; nullInput: boolean; replacement: string | null; command: string[] } {
  const parsed = parseCliFlags(args, {
    command: 'xargs',
    booleanShort: ['r', '0'],
    booleanLong: ['no-run-if-empty', 'null'],
    valueShort: ['I'],
  });
  return {
    noRunIfEmpty: parsed.flags.has('r') || parsed.flags.has('no-run-if-empty'),
    nullInput: parsed.flags.has('0') || parsed.flags.has('null'),
    replacement: parsed.values.get('I')?.[0] ?? null,
    command: parsed.positionals,
  };
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
  return [output, ...warnings].filter((line) => line.length > 0).join('\n');
}

function withWarningsFirst(output: string, warnings: string[]): string {
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
    '': 'Commands: cd, pwd, ls, cat, head, tail, nl, find, rg, grep, sort, uniq, wc, tr, xargs, cp, rm, echo, sed, true, hvy. Ask: ask QUESTION. Finish: done SUMMARY. Use man <command> for details.',
    cd: formatCommandHelp('cd PATH', 'Change the current virtual directory.'),
    pwd: formatCommandHelp('pwd', 'Print the current virtual directory.'),
    ls: formatCommandHelp('ls [PATH]', 'List files and directories.'),
    cat: formatCommandHelp('cat FILE...', 'Print file contents.'),
    head: formatCommandHelp('head [-n COUNT] FILE', 'Print the first lines of a file. COUNT maxes at 100.'),
    tail: formatCommandHelp('tail [-n COUNT] FILE', 'Print the last lines of a file. COUNT maxes at 100.'),
    nl: formatCommandHelp('nl [-ba] FILE', 'Print file contents with line numbers. Common numbering flags such as -ba are accepted.'),
    find: formatCommandHelp('find [PATH] [-name GLOB] [-type f|d] [-maxdepth N] [-print] [-exec COMMAND {} +]', 'List up to 100 virtual paths below PATH, or run a supported command against matches with -exec.'),
    rg: formatCommandHelp('rg [-i] [-n] [-l] [--include GLOB] PATTERN [PATH]', 'Search readable virtual files. Line numbers are shown by default; -l prints matching file paths.'),
    grep: formatCommandHelp('grep [-R] [-I] [-i] [-v] [-l] PATTERN [FILE|DIR...]', 'Filter text by pattern, or search the provided files/directories.'),
    sort: formatCommandHelp('sort [FILE...]', 'Sort lines.'),
    uniq: formatCommandHelp('uniq [FILE...]', 'Remove adjacent duplicate lines.'),
    wc: formatCommandHelp('wc -l [FILE...]', 'Count lines.'),
    tr: formatCommandHelp('tr SET1 SET2', 'Translate characters from stdin, including escaped \\n, \\t, and \\0.'),
    xargs: formatCommandHelp('COMMAND | xargs [-0] [-r] [-I TOKEN] COMMAND ARG...', 'Run a supported CLI command with piped items appended, or once per item with -I replacement.'),
    cp: formatCommandHelp('cp [-r] SOURCE DEST', 'Copy a writable file into an existing writable file, or copy a component directory with -r. Component copies get the destination path id.'),
    rm: formatCommandHelp('rm -r|-rf PATH...', 'Remove section or component directories from the virtual document body. -f ignores missing paths. Alias: hvy remove PATH.'),
    echo: formatCommandHelp('echo TEXT [> FILE|>> FILE]', 'Print text, replace a writable file, or append to a writable file.'),
    sed: formatCommandHelp('sed [-i] [-E] s/search/replace/[gI] FILE...', 'Update writable virtual files with a search/replace.'),
    true: formatCommandHelp('true', 'Succeed without output. Useful in command chains such as COMMAND || true.'),
    ask: formatCommandHelp('ask QUESTION', 'Pause the AI CLI edit loop and ask the user for clarification.'),
    done: formatCommandHelp('done SUMMARY', 'Finish the AI CLI edit loop with a short summary.'),
    hvy: hvyDocumentCommandHelp(),
    'hvy add': hvyDocumentCommandHelp('add'),
    'hvy add component': hvyDocumentCommandHelp('component'),
    'hvy request_structure': hvyDocumentCommandHelp('request_structure'),
    'hvy find-intent': hvyDocumentCommandHelp('find-intent'),
    'hvy cheatsheet': hvyDocumentCommandHelp('cheatsheet'),
    'hvy recipe': hvyDocumentCommandHelp('recipe'),
    'hvy lint': formatCommandHelp('hvy lint', 'Check the document for likely component issues.'),
    'hvy prune-xref': hvyDocumentCommandHelp('prune_xref'),
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
