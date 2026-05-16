import type { VisualDocument } from '../types';
import {
  buildHvyVirtualFileSystem,
  findBlockForVirtualDirectory,
  findBlockInsertionTargetForVirtualDirectory,
  findSectionForVirtualDirectory,
  listDirectory,
  resolveVirtualPath,
  type HvyVirtualEntry,
  type HvyVirtualFile,
  type HvyVirtualPathNamingState,
} from './virtual-file-system';
import { executeHvyDocumentCommand, hvyDocumentCommandHelp } from './hvy-document-commands';
import { createScriptingDbRuntime, formatQueryResultTable, getDocumentDbTableObjectNames } from '../plugins/db-table';
import type { VisualBlock, VisualSection } from '../editor/types';
import { getSectionId } from '../section-ops';
import { getHvyCliPluginCommandRegistration } from './plugin-command-registry';
import { fixHvyCliLintIssues, formatHvyCliLintIssues, runHvyCliLinter } from './document-linter';
import { serializeBlockFragment } from '../serialization';
import { formatHvyRequestStructureForDirectory } from './request-structure';
import { cloneReusableBlock } from '../document-factory';
import { formatHvyComponentDescriptionHistory } from './component-description-history';
import { deserializeDocumentWithDiagnostics, serializeDocument, serializeSectionFragment } from '../serialization';
import { parseAiBlockEditResponse } from '../ai-component-edit-common';
import { resolveBaseComponentFromMeta } from '../component-defs';
import { removeTextFillInMarkers } from '../text-fill-in';

const SCRATCHPAD_SOFT_MAX_CHARS = 600;
const SCRATCHPAD_HARD_MAX_CHARS = 800;
const FIND_MAX_RESULTS = 100;
const CLI_OUTPUT_MAX_LINES = 200;
const COMPONENT_PREVIEW_MAX_LINES = 100;
const LS_COMPONENT_PREVIEW_MAX_CHARS = 40;
const RAW_HVY_MAX_CHARS = 4000;
const RAW_HVY_PREVIEW_MAX_LINES = 100;
const RAW_HVY_PREVIEW_WRAP_WIDTH = 400;

export interface HvyCliSession {
  cwd: string;
  scratchpadContent?: string;
  scratchpadEdited?: boolean;
  scratchpadCommandsSinceEdit?: string[];
  scratchpadTouchedThisCommand?: boolean;
  rawWipContent?: string;
  rawWipContentByPath?: Record<string, string>;
  rawSectionWipContentByPath?: Record<string, string>;
  virtualPathNaming?: HvyVirtualPathNamingState;
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
  pathNaming?: HvyVirtualPathNamingState;
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
  return { cwd: '/', scratchpadContent: defaultScratchpadContent(), virtualPathNaming: { anonymousBlockNamesById: {} } };
}

function buildSessionVirtualFileSystem(document: VisualDocument, session: HvyCliSession): ReturnType<typeof buildHvyVirtualFileSystem> {
  session.virtualPathNaming ??= { anonymousBlockNamesById: {} };
  session.virtualPathNaming.anonymousBlockNamesById ??= {};
  return buildHvyVirtualFileSystem(document, session.virtualPathNaming);
}

export function getHvyCliCommandSummary(): string {
  return helpFor('');
}

export function getHvyCliPreferredCommandSummary(): string {
  return 'Commands: hvy, nl, rg, find, sed, printf, echo, cat, ls, pwd, cd, cp, mv, rm, grep, sort, uniq, wc, tr, xargs, head, tail, true. Ask: ask QUESTION. Finish: done MESSAGE_TO_USER. Use man <command> for details.';
}

export async function executeHvyCliCommand(document: VisualDocument, session: HvyCliSession, input: string): Promise<HvyCliExecution> {
  session.scratchpadTouchedThisCommand = false;
  const expandedInput = expandShellSubstitutions(input, session.now ?? new Date());
  if (expandedInput.trim().startsWith('#')) {
    return { cwd: session.cwd, output: '', mutated: false };
  }
  const heredocs = parseCatHeredocWrites(expandedInput);
  if (heredocs) {
    const outputs: string[] = [];
    let mutated = false;
    let scratchpadTouched = false;
    for (const heredoc of heredocs) {
      const fs = buildSessionVirtualFileSystem(document, session);
      addSessionFiles(fs, document, session);
      const result = writeVirtualFile({ fs, cwd: session.cwd }, heredoc.path, heredoc.content, false, 'cat');
      enforceScratchpadHardCap(session);
      if (result.output) {
        outputs.push(result.output);
      }
      mutated = mutated || result.mutated;
      scratchpadTouched = scratchpadTouched || heredoc.path === 'scratchpad.txt' || heredoc.path === '/scratchpad.txt';
    }
    updateScratchpadCommandHistory(session, expandedInput);
    const output = truncateCliOutput(outputs.join('\n'));
    const result = { cwd: session.cwd, output, mutated };
    if (scratchpadTouched && isScratchpadTooLong(session)) {
      return { ...result, output: `${result.output}\n\n${buildScratchpadTooLongMessage(session.scratchpadContent ?? '')}` };
    }
    return result;
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
  const outputParts: string[] = [];

  for (let index = 0; index < pipelines.length; index += 1) {
    const pipeline = pipelines[index] ?? { operator: 'first' as const, commands: [], tokens: [] };
    if ((pipeline.operator === '&&' && previousStatus !== 0) || (pipeline.operator === '||' && previousStatus === 0)) {
      continue;
    }

    const fs = buildSessionVirtualFileSystem(document, session);
    addSessionFiles(fs, document, session);
    enforceScratchpadHardCap(session);
    lastProcess = await executeMiniShellPipeline({ document, fs, cwd: session.cwd, pathNaming: session.virtualPathNaming }, pipeline.commands);
    enforceScratchpadHardCap(session);
    session.cwd = lastProcess.cwd;
    mutated = mutated || lastProcess.mutated;
    scratchpadTouched = scratchpadTouched || pipeline.tokens.some((token) => token === 'scratchpad.txt' || token === '/scratchpad.txt');
    previousStatus = lastProcess.status;

    if (lastProcess.status === 0 && lastProcess.stdout) {
      outputParts.push(lastProcess.stdout);
    }

    if (lastProcess.status !== 0 && pipelines[index + 1]?.operator !== '||') {
      throw new Error(lastProcess.stderr || lastProcess.stdout || 'Command failed.');
    }
  }

  updateScratchpadCommandHistory(session, expandedInput);
  const rawOutput = outputParts.length > 0
    ? outputParts.join('\n')
    : lastProcess.status === 0 ? lastProcess.stdout : lastProcess.stderr || lastProcess.stdout;
  const output = truncateCliOutput(rawOutput, { preserveFindWarning: true });
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
  const session = createHvyCliSession();
  session.cwd = cwd;
  const fs = buildSessionVirtualFileSystem(document, session);
  addSessionFiles(fs, document, session);
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
  if (command === 'true') {
    return { cwd, output: '', mutated: false };
  }
  if (command === 'ask') {
    return { cwd, output: rest.join(' ').trim(), mutated: false };
  }
  if (command === 'done') {
    return { cwd, output: rest.join(' ').trim(), mutated: false };
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
  if (command === 'mv') {
    return { cwd, output: commandMv(ctx, rest), mutated: true };
  }
  if (command === 'echo') {
    const result = commandEcho(ctx, rest);
    return { cwd, output: result.output, mutated: result.mutated };
  }
  if (command === 'printf') {
    const result = commandPrintf(ctx, rest);
    return { cwd, output: result.output, mutated: result.mutated };
  }
  if (command === 'sed') {
    const result = commandSed(ctx, rest);
    return { cwd, output: result.output, mutated: result.mutated };
  }
  if (command === 'hvy') {
    if (rest[0] === 'lint') {
      throw new Error('doc.cli.run cannot run hvy lint because plugin lint checks may be async.');
    }
    if (rest[0] === 'plugin' && rest[1] === 'db-table' && isDbTableSqlAction(rest[2] ?? '')) {
      throw new Error('doc.cli.run cannot run db-table SQL commands. Use doc.db.query or doc.db.execute instead.');
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
    if (isHvyShellAliasCommand(rest[0] ?? '')) {
      return executeHvyShellAliasCommandSync(ctx, rest[0] ?? '', rest.slice(1));
    }
    const result = executeHvyDocumentCommand(ctx, rest);
    return { cwd: result.cwd ?? cwd, output: result.output, mutated: result.mutated };
  }
  throw new Error(`doc.cli.run does not support command "${command}".`);
}

export function writeHvyVirtualFileSync(document: VisualDocument, path: string, content: string, cwd = '/'): HvyCliExecution {
  if (/(^|\/)raw\.hvy$/i.test(path.trim())) {
    throw new Error('doc.cli.write does not write raw.hvy files. Use structured CLI commands and writable component files instead.');
  }
  const session = createHvyCliSession();
  session.cwd = cwd;
  const fs = buildSessionVirtualFileSystem(document, session);
  addSessionFiles(fs, document, session);
  const result = writeVirtualFile({ fs, cwd }, path, content, false, 'doc.cli.write');
  return { cwd, output: result.output, mutated: result.mutated };
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
  if (command === 'done') {
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
  if (command === 'mv') {
    return { cwd: ctx.cwd, output: commandMv(ctx, args), mutated: true };
  }
  if (command === 'echo') {
    const result = commandEcho(ctx, args);
    return { cwd: ctx.cwd, output: result.output, mutated: result.mutated };
  }
  if (command === 'printf') {
    const result = commandPrintf(ctx, args);
    return { cwd: ctx.cwd, output: result.output, mutated: result.mutated };
  }
  if (command === 'sed') {
    const result = commandSed(ctx, args);
    return { cwd: ctx.cwd, output: result.output, mutated: result.mutated };
  }
  if (command === 'hvy') {
    if (args[0] === 'lint') {
      if (args[1] === '--fix') {
        const fixed = fixHvyCliLintIssues(ctx.document);
        if (fixed.length === 0) {
          return { cwd: ctx.cwd, output: 'No lint fixes applied.', mutated: false };
        }
        return { cwd: ctx.cwd, output: ['Applied lint fixes:', ...fixed.map((line) => `- ${line}`)].join('\n'), mutated: true };
      }
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
    if (isHvyShellAliasCommand(args[0] ?? '')) {
      return runCommand(ctx, args[0] ?? '', args.slice(1));
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
    return { cwd: result.cwd ?? ctx.cwd, output: result.output, mutated: result.mutated };
  }
  throw new Error(`Unknown command "${command}". Try "help".`);
}

function isHvyShellAliasCommand(command: string): boolean {
  return new Set([
    'pwd',
    'true',
    'ask',
    'done',
    'cd',
    'ls',
    'cat',
    'head',
    'tail',
    'nl',
    'grep',
    'sort',
    'uniq',
    'wc',
    'tr',
    'find',
    'rg',
    'rm',
    'cp',
    'mv',
    'echo',
    'printf',
    'sed',
  ]).has(command);
}

function executeHvyShellAliasCommandSync(ctx: HvyCliCommandContext, command: string, args: string[]): HvyCliExecution {
  if (command === 'pwd') {
    return { cwd: ctx.cwd, output: ctx.cwd, mutated: false };
  }
  if (command === 'true') {
    return { cwd: ctx.cwd, output: '', mutated: false };
  }
  if (command === 'ask') {
    return { cwd: ctx.cwd, output: args.join(' ').trim(), mutated: false };
  }
  if (command === 'done') {
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
  if (command === 'rg') {
    return { cwd: ctx.cwd, output: commandRg(ctx, args), mutated: false };
  }
  if (command === 'grep') {
    return { cwd: ctx.cwd, output: commandGrep(ctx, args), mutated: false };
  }
  if (command === 'find') {
    return { cwd: ctx.cwd, output: commandFindWithoutExec(ctx, args), mutated: false };
  }
  if (command === 'rm') {
    return { cwd: ctx.cwd, output: commandRm(ctx, args), mutated: true };
  }
  if (command === 'cp') {
    return { cwd: ctx.cwd, output: commandCp(ctx, args), mutated: true };
  }
  if (command === 'mv') {
    return { cwd: ctx.cwd, output: commandMv(ctx, args), mutated: true };
  }
  if (command === 'sed') {
    const result = commandSed(ctx, args);
    return { cwd: ctx.cwd, output: result.output, mutated: result.mutated };
  }
  if (command === 'sort' || command === 'uniq' || command === 'wc' || command === 'tr') {
    return runTextCommand(ctx, command, args);
  }
  if (command === 'echo') {
    const result = commandEcho(ctx, args);
    return { cwd: ctx.cwd, output: result.output, mutated: result.mutated };
  }
  if (command === 'printf') {
    const result = commandPrintf(ctx, args);
    return { cwd: ctx.cwd, output: result.output, mutated: result.mutated };
  }
  throw new Error(`doc.cli.run does not support command "hvy ${command}".`);
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
  const rawTarget = args.find((arg) => !arg.startsWith('-')) ?? '.';
  const target = resolveVirtualPath(ctx.fs, ctx.cwd, rawTarget);
  if (hasGlobPattern(rawTarget)) {
    const matches = expandVirtualPathGlob(ctx.fs, target);
    if (matches.length === 0) {
      throw new Error(formatMissingPathMessage(ctx.fs, ctx.cwd, target, `ls: no such file or directory: ${target}`));
    }
    return withWarnings(matches.map((entry) => formatEntry(ctx.fs, entry)).join('\n'), warnings);
  }
  const entry = ctx.fs.entries.get(target);
  if (!entry) {
    throw new Error(formatMissingPathMessage(ctx.fs, ctx.cwd, target, `ls: no such file or directory: ${target}`));
  }
  if (entry.kind === 'file') {
    return withWarnings(formatEntry(ctx.fs, entry), warnings);
  }
  if (recursive) {
    const entries = [...ctx.fs.entries.values()]
      .filter((candidate) => candidate.path === target || candidate.path.startsWith(target === '/' ? '/' : `${target}/`))
      .map((candidate) => candidate.path);
    return withWarnings(entries.join('\n'), warnings);
  }
  const listing = [
    'type name [editable] | description | preview',
    listDirectory(ctx.fs, target).map((candidate) => formatEntry(ctx.fs, candidate)).join('\n'),
  ].filter((part) => part.trim().length > 0).join('\n');
  return withWarnings(
    [
      listing,
      formatLsTargetDescription(ctx, target),
    ].filter((part) => part.trim().length > 0).join('\n\n'),
    warnings
  );
}

function hasGlobPattern(path: string): boolean {
  return path.includes('*') || path.includes('?');
}

function expandVirtualPathGlob(fs: ReturnType<typeof buildHvyVirtualFileSystem>, normalizedPattern: string): HvyVirtualEntry[] {
  const regex = globToPathRegExp(normalizedPattern);
  return [...fs.entries.values()]
    .filter((entry) => regex.test(entry.path))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function globToPathRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
  return new RegExp(`^${escaped}$`);
}

function formatLsTargetDescription(ctx: HvyCliCommandContext, directoryPath: string): string {
  if (directoryPath === '/') {
    return '';
  }
  const context = formatHvyComponentDescriptionHistory(ctx.document, ctx.fs, ctx.cwd, directoryPath);
  if (context) {
    return context;
  }
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

function readJsonArrayFromVirtualPath(fs: ReturnType<typeof buildHvyVirtualFileSystem>, path: string): unknown[] {
  const entry = fs.entries.get(path);
  if (!entry || entry.kind !== 'file') {
    return [];
  }
  try {
    const value = JSON.parse(entry.read()) as unknown;
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function inferComponentNameForDirectory(fs: ReturnType<typeof buildHvyVirtualFileSystem>, directoryPath: string): string {
  const componentJsonFiles = listDirectory(fs, directoryPath)
    .filter((entry): entry is HvyVirtualFile => entry.kind === 'file')
    .map((entry) => entry.path.split('/').pop() ?? '')
    .filter((name) => name.endsWith('.json') && name !== 'section.json')
    .filter((name) => {
      const component = name.replace(/\.json$/i, '');
      return fs.entries.get(`${directoryPath}/${component}.txt`)?.kind === 'file' || fs.entries.get(`${directoryPath}/script.py`)?.kind === 'file';
    });
  if (componentJsonFiles.length !== 1) {
    return '';
  }
  return componentJsonFiles[0]?.replace(/\.json$/i, '') ?? '';
}

function addSessionFiles(fs: ReturnType<typeof buildHvyVirtualFileSystem>, document: VisualDocument, session: HvyCliSession): void {
  addSessionScratchpadFile(fs, session);
  addSessionRawHvyFiles(fs, document, session);
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

function addSessionRawHvyFiles(fs: ReturnType<typeof buildHvyVirtualFileSystem>, document: VisualDocument, session: HvyCliSession): void {
  addSessionRawDocumentFiles(fs, document, session);
  addSessionRawSectionFiles(fs, document, session);
  addSessionRawComponentFiles(fs, document, session);
}

function addSessionRawDocumentFiles(fs: ReturnType<typeof buildHvyVirtualFileSystem>, document: VisualDocument, session: HvyCliSession): void {
  const serialized = serializeDocument(document);
  if (serialized.length < RAW_HVY_MAX_CHARS) {
    fs.entries.set('/raw.hvy', {
      kind: 'file',
      path: '/raw.hvy',
      read: () => serializeDocument(document),
      write: (content) => {
        const result = deserializeDocumentWithDiagnostics(content, document.extension === '.md' ? '.hvy' : document.extension);
        const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
        if (errors.length > 0) {
          session.rawWipContent = content;
          throw new Error([
            '/raw.hvy did not parse; document was not changed.',
            '/raw.wip.hvy now contains the failed draft so you can inspect or repair it.',
            '',
            ...errors.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`),
          ].join('\n'));
        }
        const tagIssue = validateDocumentTagsForRaw(result.document);
        if (tagIssue) {
          session.rawWipContent = content;
          throw new Error(['/raw.hvy did not parse; document was not changed.', '/raw.wip.hvy now contains the failed draft so you can inspect or repair it.', '', tagIssue].join('\n'));
        }
        replaceDocumentContents(document, result.document);
        session.rawWipContent = undefined;
      },
    });
  } else {
    fs.entries.set('/raw-preview.hvy.txt', {
      kind: 'file',
      path: '/raw-preview.hvy.txt',
      read: () => formatRawHvyPreview(serialized),
    });
  }

  if (typeof session.rawWipContent === 'string') {
    fs.entries.set('/raw.wip.hvy', {
      kind: 'file',
      path: '/raw.wip.hvy',
      read: () => session.rawWipContent ?? '',
      write: (content) => {
        session.rawWipContent = content;
      },
    });
  }
}

function addSessionRawSectionFiles(fs: ReturnType<typeof buildHvyVirtualFileSystem>, document: VisualDocument, session: HvyCliSession): void {
  session.rawSectionWipContentByPath ??= {};
  for (const entry of [...fs.entries.values()]) {
    if (entry.kind !== 'dir' || !fs.entries.has(`${entry.path}/section.json`)) {
      continue;
    }
    const section = findSectionForVirtualDirectory(document, entry.path, session.virtualPathNaming);
    if (!section) {
      continue;
    }
    addRawSectionFilesForSection(fs, document, session, entry.path, section);
  }
}

function addRawSectionFilesForSection(
  fs: ReturnType<typeof buildHvyVirtualFileSystem>,
  document: VisualDocument,
  session: HvyCliSession,
  sectionPath: string,
  section: VisualSection
): void {
  const fragment = serializeSectionFragment(section, document.meta);
  if (fragment.length < RAW_HVY_MAX_CHARS) {
    fs.entries.set(`${sectionPath}/raw.hvy`, {
      kind: 'file',
      path: `${sectionPath}/raw.hvy`,
      read: () => serializeSectionFragment(section, document.meta),
      write: (content) => {
        const directiveIssue = validateRawSectionFragmentShape(content);
        if (directiveIssue) {
          failRawSectionWrite(session, sectionPath, content, [directiveIssue]);
        }
        const result = deserializeDocumentWithDiagnostics(content, document.extension === '.md' ? '.hvy' : document.extension);
        const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
        if (errors.length > 0 || result.document.sections.filter((candidate) => !candidate.isGhost).length !== 1) {
          failRawSectionWrite(
            session,
            sectionPath,
            content,
            [
              ...errors.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`),
              ...(result.document.sections.filter((candidate) => !candidate.isGhost).length !== 1
                ? ['error: raw section fragments must parse into exactly one section.']
                : []),
            ]
          );
        }
        const [nextSection] = result.document.sections.filter((candidate) => !candidate.isGhost);
        if (!nextSection) {
          failRawSectionWrite(session, sectionPath, content, ['error: raw section fragments must parse into exactly one section.']);
        }
        const tagIssue = validateSectionTagsForRaw(nextSection);
        if (tagIssue) {
          failRawSectionWrite(session, sectionPath, content, [tagIssue]);
        }
        replaceSectionContents(section, nextSection);
        delete session.rawSectionWipContentByPath?.[`${sectionPath}/raw.wip.hvy`];
      },
    });
  } else {
    fs.entries.set(`${sectionPath}/raw-preview.hvy.txt`, {
      kind: 'file',
      path: `${sectionPath}/raw-preview.hvy.txt`,
      read: () => formatRawHvyPreview(fragment),
    });
  }

  const wipPath = `${sectionPath}/raw.wip.hvy`;
  if (typeof session.rawSectionWipContentByPath?.[wipPath] === 'string') {
    fs.entries.set(wipPath, {
      kind: 'file',
      path: wipPath,
      read: () => session.rawSectionWipContentByPath?.[wipPath] ?? '',
      write: (content) => {
        session.rawSectionWipContentByPath ??= {};
        session.rawSectionWipContentByPath[wipPath] = content;
      },
    });
  }
}

function addSessionRawComponentFiles(fs: ReturnType<typeof buildHvyVirtualFileSystem>, document: VisualDocument, session: HvyCliSession): void {
  session.rawWipContentByPath ??= {};
  for (const entry of [...fs.entries.values()]) {
    if (entry.kind !== 'dir' || entry.path === '/' || entry.path === '/body' || entry.path === '/attachments') {
      continue;
    }
    const block = findBlockForVirtualDirectory(document, entry.path, session.virtualPathNaming);
    if (!block) {
      continue;
    }
    addRawComponentFilesForBlock(fs, document, session, entry.path, block);
  }
}

function addRawComponentFilesForBlock(
  fs: ReturnType<typeof buildHvyVirtualFileSystem>,
  document: VisualDocument,
  session: HvyCliSession,
  blockPath: string,
  block: VisualBlock
): void {
  const fragment = serializeBlockFragment(block, document.meta);
  if (fragment.length < RAW_HVY_MAX_CHARS) {
    fs.entries.set(`${blockPath}/raw.hvy`, {
      kind: 'file',
      path: `${blockPath}/raw.hvy`,
      read: () => serializeBlockFragment(block, document.meta),
      write: (content) => {
        const directiveIssue = validateRawComponentFragmentShape(content);
        if (directiveIssue) {
          failRawComponentWrite(session, blockPath, content, [directiveIssue]);
        }
        const parsed = parseAiBlockEditResponse(content, document.meta);
        if (parsed.hasErrors || !parsed.block) {
          failRawComponentWrite(
            session,
            blockPath,
            content,
            parsed.issues.map((issue) => `${issue.severity}: ${issue.message}${issue.hint ? ` ${issue.hint}` : ''}`)
          );
        }
        const tagIssue = validateBlockTagsForRaw(parsed.block);
        if (tagIssue) {
          failRawComponentWrite(session, blockPath, content, [tagIssue]);
        }
        preserveOmittedEmptyTextPlaceholders(block, parsed.block, serializeBlockFragment(block, document.meta), content);
        replaceBlockContents(block, parsed.block);
        delete session.rawWipContentByPath?.[`${blockPath}/raw.wip.hvy`];
      },
    });
  } else {
    fs.entries.set(`${blockPath}/raw-preview.hvy.txt`, {
      kind: 'file',
      path: `${blockPath}/raw-preview.hvy.txt`,
      read: () => formatRawHvyPreview(fragment),
    });
  }

  const wipPath = `${blockPath}/raw.wip.hvy`;
  if (typeof session.rawWipContentByPath?.[wipPath] === 'string') {
    fs.entries.set(wipPath, {
      kind: 'file',
      path: wipPath,
      read: () => session.rawWipContentByPath?.[wipPath] ?? '',
      write: (content) => {
        session.rawWipContentByPath ??= {};
        session.rawWipContentByPath[wipPath] = content;
      },
    });
  }
}

function validateRawComponentFragmentShape(content: string): string {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('<!--hvy:')) {
    return 'error: raw component fragments must start with an HVY component directive such as <!--hvy:text {}-->.';
  }
  const firstLine = trimmed.split(/\r?\n/, 1)[0] ?? '';
  if (!firstLine.includes('-->')) {
    return 'error: raw component directive comment is not closed with -->.';
  }
  const match = firstLine.match(/^<!--\s*hvy:([a-z][a-z0-9-]*)\s+([\s\S]*?)\s*-->\s*$/i);
  if (!match) {
    return 'error: raw component directive must look like <!--hvy:text {}--> with valid component name and JSON metadata.';
  }
  try {
    JSON.parse(match[2] ?? '');
  } catch {
    return 'error: raw component directive metadata is not valid JSON.';
  }
  return '';
}

function validateRawSectionFragmentShape(content: string): string {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('<!--hvy:')) {
    return 'error: raw section fragments must start with an HVY section directive such as <!--hvy: {"id":"section-id"}-->.';
  }
  const firstLine = trimmed.split(/\r?\n/, 1)[0] ?? '';
  const match = firstLine.match(/^<!--\s*hvy:\s+([\s\S]*?)\s*-->\s*$/i);
  if (!match) {
    return 'error: raw section directive must look like <!--hvy: {"id":"section-id"}--> with valid JSON metadata.';
  }
  try {
    JSON.parse(match[1] ?? '');
  } catch {
    return 'error: raw section directive metadata is not valid JSON.';
  }
  return '';
}

function failRawComponentWrite(session: HvyCliSession, blockPath: string, content: string, issues: string[]): never {
  session.rawWipContentByPath ??= {};
  session.rawWipContentByPath[`${blockPath}/raw.wip.hvy`] = content;
  throw new Error([
    `${blockPath}/raw.hvy did not parse; component was not changed.`,
    `${blockPath}/raw.wip.hvy now contains the failed draft so you can inspect or repair it.`,
    '',
    ...issues,
  ].join('\n'));
}

function failRawSectionWrite(session: HvyCliSession, sectionPath: string, content: string, issues: string[]): never {
  session.rawSectionWipContentByPath ??= {};
  session.rawSectionWipContentByPath[`${sectionPath}/raw.wip.hvy`] = content;
  throw new Error([
    `${sectionPath}/raw.hvy did not parse; section was not changed.`,
    `${sectionPath}/raw.wip.hvy now contains the failed draft so you can inspect or repair it.`,
    '',
    ...issues,
  ].join('\n'));
}

function validateDocumentTagsForRaw(document: VisualDocument): string {
  for (const section of document.sections) {
    const issue = validateSectionTagsForRaw(section);
    if (issue) {
      return issue;
    }
  }
  return '';
}

function validateSectionTagsForRaw(section: VisualSection): string {
  if (/[\[\]]/.test(section.tags)) {
    return 'error: section tags cannot contain [ or ]. Tags are displayed as tags=[...] by the CLI.';
  }
  for (const block of section.blocks) {
    const issue = validateBlockTagsForRaw(block);
    if (issue) {
      return issue;
    }
  }
  for (const child of section.children) {
    const issue = validateSectionTagsForRaw(child);
    if (issue) {
      return issue;
    }
  }
  return '';
}

function validateBlockTagsForRaw(block: VisualBlock): string {
  if (/[\[\]]/.test(block.schema.tags)) {
    return `error: ${block.schema.component} tags cannot contain [ or ]. Tags are displayed as tags=[...] by the CLI.`;
  }
  for (const childList of getNestedBlockLists(block)) {
    for (const child of childList) {
      const issue = validateBlockTagsForRaw(child);
      if (issue) {
        return issue;
      }
    }
  }
  return '';
}

function replaceDocumentContents(target: VisualDocument, source: VisualDocument): void {
  target.meta = source.meta;
  target.extension = source.extension;
  target.sections = source.sections;
  target.attachments = source.attachments;
}

function replaceSectionContents(target: VisualSection, source: VisualSection): void {
  const key = target.key;
  target.customId = source.customId;
  target.contained = source.contained;
  target.lock = source.lock;
  target.idEditorOpen = source.idEditorOpen;
  target.isGhost = source.isGhost;
  target.title = source.title;
  target.level = source.level;
  target.expanded = source.expanded;
  target.highlight = source.highlight;
  target.css = source.css;
  target.tags = source.tags;
  target.description = source.description;
  target.location = source.location;
  target.hideIfUnmodified = source.hideIfUnmodified;
  target.blocks = source.blocks;
  target.children = source.children;
  target.autoTail = source.autoTail;
  target.renderAfterBlockId = source.renderAfterBlockId;
  target.key = key;
}

function replaceBlockContents(target: VisualBlock, source: VisualBlock): void {
  target.id = source.id;
  target.text = source.text;
  target.schema = source.schema;
  target.schemaMode = source.schemaMode;
}

function preserveOmittedEmptyTextPlaceholders(
  previousBlock: VisualBlock,
  nextBlock: VisualBlock,
  previousRawFragment: string,
  nextRawFragment: string
): void {
  const previousTextBlocks = collectTextBlocks(previousBlock);
  const nextTextBlocks = collectTextBlocks(nextBlock);
  const previousRawTextDirectives = collectRawTextDirectivePlaceholderPresence(previousRawFragment);
  const nextRawTextDirectives = collectRawTextDirectivePlaceholderPresence(nextRawFragment);
  nextTextBlocks.forEach((nextTextBlock, index) => {
    const previousTextBlock = previousTextBlocks[index];
    const previousRawTextDirective = previousRawTextDirectives[index];
    const nextRawTextDirective = nextRawTextDirectives[index];
    if (
      !previousTextBlock ||
      nextRawTextDirective?.hasPlaceholder ||
      !previousTextBlock.schema.placeholder.trim() ||
      hasRawVisibleText(previousTextBlock.text) ||
      hasRawVisibleText(nextTextBlock.text)
    ) {
      return;
    }
    nextTextBlock.schema.placeholder = previousRawTextDirective?.placeholder ?? previousTextBlock.schema.placeholder;
  });
}

function hasRawVisibleText(text: string): boolean {
  return removeTextFillInMarkers(text).trim().length > 0;
}

function collectTextBlocks(block: VisualBlock): VisualBlock[] {
  const blocks = block.schema.component === 'text' ? [block] : [];
  for (const nestedBlocks of getNestedBlockLists(block)) {
    for (const nestedBlock of nestedBlocks) {
      blocks.push(...collectTextBlocks(nestedBlock));
    }
  }
  return blocks;
}

function collectRawTextDirectivePlaceholderPresence(rawFragment: string): Array<{ hasPlaceholder: boolean; placeholder?: string }> {
  const matches = rawFragment.matchAll(/<!--\s*hvy:text\s+([\s\S]*?)\s*-->/gi);
  return [...matches].map((match) => {
    try {
      const parsed = JSON.parse(match[1] ?? '{}') as unknown;
      const hasPlaceholder = !!parsed
        && typeof parsed === 'object'
        && !Array.isArray(parsed)
        && Object.prototype.hasOwnProperty.call(parsed, 'placeholder');
      const placeholder = hasPlaceholder && typeof (parsed as { placeholder?: unknown }).placeholder === 'string'
        ? (parsed as { placeholder: string }).placeholder
        : undefined;
      return { hasPlaceholder, placeholder };
    } catch {
      return { hasPlaceholder: false };
    }
  });
}

function formatRawHvyPreview(serialized: string): string {
  const wrappedLines = wrapRawHvyPreviewLines(serialized).split('\n');
  return wrappedLines.slice(0, RAW_HVY_PREVIEW_MAX_LINES).join('\n');
}

function wrapRawHvyPreviewLines(output: string): string {
  return output
    .split('\n')
    .flatMap((line) => splitRawHvyPreviewLine(line, RAW_HVY_PREVIEW_WRAP_WIDTH))
    .join('\n');
}

function splitRawHvyPreviewLine(line: string, maxWidth: number): string[] {
  if (line.length <= maxWidth) {
    return [line];
  }
  const chunks: string[] = [];
  for (let index = 0; index < line.length; index += maxWidth) {
    chunks.push(line.slice(index, index + maxWidth));
  }
  return chunks;
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
  return args.map((arg) => getReadableFile(ctx, arg).read()).join('\n');
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
  if (entry?.kind === 'dir') {
    return findComponentDirectoryAtOrAbove(ctx.fs, normalized);
  }
  const filePath = readablePath ?? resolveReadablePath(ctx.fs, ctx.cwd, path);
  const owningComponentDirectory = findComponentDirectoryAtOrAbove(ctx.fs, filePath.replace(/\/[^/]+$/, '') || '/');
  if (owningComponentDirectory) {
    return owningComponentDirectory;
  }
  const parent = filePath.replace(/\/[^/]+$/, '') || '/';
  const componentName = inferComponentNameForDirectory(ctx.fs, parent);
  const fileName = filePath.split('/').pop() ?? '';
  return componentName && fileName === `${componentName}.txt` ? parent : '';
}

function findComponentDirectoryAtOrAbove(fs: ReturnType<typeof buildHvyVirtualFileSystem>, path: string): string {
  let current = path;
  while (current && current !== '/' && current !== '/body' && current !== '/attachments') {
    if (fs.entries.get(current)?.kind === 'dir' && inferComponentNameForDirectory(fs, current)) {
      return current;
    }
    current = current.replace(/\/[^/]+$/, '') || '/';
  }
  return '';
}

function formatComponentRawPreview(ctx: HvyCliCommandContext, directoryPath: string): string {
  const block = findBlockForVirtualDirectory(ctx.document, directoryPath, ctx.pathNaming);
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
    if (!isSearchVisibleFile(entry.path, root)) {
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

function commandRm(ctx: HvyCliCommandContext, args: string[]): string {
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
      removeDocumentDirectory(ctx.document, resolved, ctx.pathNaming);
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
  const sourceBlock = findBlockForVirtualDirectory(ctx.document, sourcePath, ctx.pathNaming);
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
  const target = findBlockInsertionTargetForVirtualDirectory(ctx.document, parentPath, ctx.pathNaming);
  if (!target) {
    throw new Error(formatMissingPathMessage(ctx.fs, ctx.cwd, parentPath, `cp: no writable component container: ${parentPath}`, 'dir'));
  }
  const destinationId = finalPath.split('/').pop() ?? '';
  const clonedBlock = cloneReusableBlock(sourceBlock);
  clonedBlock.schema.id = destinationId;
  target.insert(clonedBlock);
  return `${sourcePath} -> ${finalPath}: copied`;
}

function commandMv(ctx: HvyCliCommandContext, args: string[]): string {
  if (args.length !== 2) {
    throw new Error('mv: expected SOURCE DEST');
  }
  const [source = '', destination = ''] = args;
  const sourcePath = resolveVirtualPath(ctx.fs, ctx.cwd, source);
  const sourceEntry = ctx.fs.entries.get(sourcePath);
  if (!sourceEntry) {
    throw new Error(formatMissingPathMessage(ctx.fs, ctx.cwd, source, `mv: no such file or directory: ${source}`, 'dir'));
  }
  if (sourceEntry.kind === 'file') {
    throw new Error(`mv: cannot move virtual file directly: ${sourcePath}`);
  }
  const sourceBlock = findBlockForVirtualDirectory(ctx.document, sourcePath, ctx.pathNaming);
  if (!sourceBlock) {
    throw new Error(`mv: can only move component directories: ${sourcePath}`);
  }
  const destinationPath = resolveVirtualPath(ctx.fs, ctx.cwd, destination);
  const destinationEntry = ctx.fs.entries.get(destinationPath);
  const finalPath = destinationEntry?.kind === 'dir'
    ? `${destinationPath}/${sourcePath.split('/').pop() ?? 'moved'}`
    : destinationPath;
  if (ctx.fs.entries.has(finalPath) && finalPath !== sourcePath) {
    throw new Error(`mv: destination already exists: ${finalPath}`);
  }
  const parentPath = finalPath.replace(/\/[^/]+$/, '') || '/';
  const target = findBlockInsertionTargetForVirtualDirectory(ctx.document, parentPath, ctx.pathNaming);
  if (!target) {
    throw new Error(formatMissingPathMessage(ctx.fs, ctx.cwd, parentPath, `mv: no writable component container: ${parentPath}`, 'dir'));
  }
  const removedBlock = removeDocumentBlockDirectory(ctx.document, sourcePath, ctx.pathNaming);
  const destinationId = finalPath.split('/').pop() ?? '';
  if (destinationId && destinationId !== sourcePath.split('/').pop()) {
    removedBlock.schema.id = destinationId;
  }
  target.insert(removedBlock);
  return `${sourcePath} -> ${finalPath}: moved`;
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
  return document.sections.reduce((total, section) => total + pruneXrefsFromSection(document, section, targetId), 0);
}

function pruneXrefsFromSection(document: VisualDocument, section: VisualSection, targetId: string): number {
  return pruneXrefsFromBlocks(document, section.blocks, targetId)
    + section.children.reduce((total, child) => total + pruneXrefsFromSection(document, child, targetId), 0);
}

function pruneXrefsFromBlocks(document: VisualDocument, blocks: VisualBlock[], targetId: string): number {
  let removed = 0;
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (!block) {
      continue;
    }
    if (resolveBaseComponentFromMeta(block.schema.component, document.meta) === 'xref-card' && block.schema.xrefTarget === targetId) {
      blocks.splice(index, 1);
      removed += 1;
      continue;
    }
    for (const nestedBlocks of getNestedBlockLists(block)) {
      removed += pruneXrefsFromBlocks(document, nestedBlocks, targetId);
    }
  }
  return removed;
}

function collectXrefVirtualPaths(document: VisualDocument, targetId: string): string[] {
  const fs = buildHvyVirtualFileSystem(document);
  return [...fs.entries.values()]
    .filter((entry): entry is HvyVirtualFile => entry.kind === 'file' && /\/[^/]+\.json$/.test(entry.path))
    .filter((entry) => !entry.path.startsWith('/id/'))
    .filter((entry) => {
      try {
        const value = JSON.parse(entry.read()) as { xrefTarget?: unknown };
        return value.xrefTarget === targetId;
      } catch {
        return false;
      }
    })
    .map((entry) => entry.path.replace(/\/[^/]+\.json$/, ''));
}

function removeDocumentDirectory(document: VisualDocument, path: string, pathNaming?: HvyVirtualPathNamingState): void {
  removeDocumentDirectoryInternal(document, path, pathNaming);
}

function removeDocumentBlockDirectory(document: VisualDocument, path: string, pathNaming?: HvyVirtualPathNamingState): VisualBlock {
  const block = findBlockForVirtualDirectory(document, path, pathNaming);
  if (!block) {
    throw new Error(`mv: can only move component directories: ${path}`);
  }
  const removed = removeDocumentDirectoryInternal(document, path, pathNaming);
  if (removed !== block) {
    throw new Error(`mv: could not remove component directory: ${path}`);
  }
  return block;
}

function removeDocumentDirectoryInternal(document: VisualDocument, path: string, pathNaming?: HvyVirtualPathNamingState): VisualBlock | VisualSection {
  if (path === '/' || path === '/body' || path === '/attachments') {
    throw new Error(`rm: refusing to remove protected directory: ${path}`);
  }
  if (!path.startsWith('/body/')) {
    throw new Error(`rm: can only remove document body directories: ${path}`);
  }
  const targetBlock = findBlockForVirtualDirectory(document, path, pathNaming);
  if (targetBlock && removeBlockReferenceFromSections(document.sections, targetBlock)) {
    return targetBlock;
  }
  const parts = path.split('/').filter(Boolean).slice(1);
  const removed = removeBodyPath(document.sections, parts);
  if (!removed) {
    throw new Error(`rm: cannot map virtual path to document node: ${path}`);
  }
  return removed;
}

function removeBlockReferenceFromSections(sections: VisualSection[], target: VisualBlock): VisualBlock | null {
  for (const section of sections) {
    const removed = removeBlockReferenceFromList(section.blocks, target);
    if (removed) {
      return removed;
    }
    const childRemoved = removeBlockReferenceFromSections(section.children, target);
    if (childRemoved) {
      return childRemoved;
    }
  }
  return null;
}

function removeBlockReferenceFromList(blocks: VisualBlock[], target: VisualBlock): VisualBlock | null {
  const index = blocks.indexOf(target);
  if (index >= 0) {
    return blocks.splice(index, 1)[0] ?? null;
  }
  for (const block of blocks) {
    const containerRemoved = removeBlockReferenceFromList(block.schema.containerBlocks ?? [], target);
    if (containerRemoved) {
      return containerRemoved;
    }
    const listRemoved = removeBlockReferenceFromList(block.schema.componentListBlocks ?? [], target);
    if (listRemoved) {
      return listRemoved;
    }
    const stubRemoved = removeBlockReferenceFromList(block.schema.expandableStubBlocks?.children ?? [], target);
    if (stubRemoved) {
      return stubRemoved;
    }
    const contentRemoved = removeBlockReferenceFromList(block.schema.expandableContentBlocks?.children ?? [], target);
    if (contentRemoved) {
      return contentRemoved;
    }
    const gridIndex = (block.schema.gridItems ?? []).findIndex((item) => item.block === target);
    if (gridIndex >= 0) {
      return block.schema.gridItems.splice(gridIndex, 1)[0]?.block ?? null;
    }
    for (const item of block.schema.gridItems ?? []) {
      const gridRemoved = removeBlockReferenceFromList([item.block], target);
      if (gridRemoved) {
        return gridRemoved;
      }
    }
  }
  return null;
}

function removeBodyPath(sections: VisualSection[], parts: string[]): VisualSection | VisualBlock | null {
  if (parts.length === 0) {
    return null;
  }
  const [head = '', ...tail] = parts;
  const sectionIndex = sections.findIndex((section) => pathSegmentForId(getSectionId(section)) === head);
  if (sectionIndex >= 0) {
    const section = sections[sectionIndex];
    if (!section) {
      return null;
    }
    if (tail.length === 0) {
      return sections.splice(sectionIndex, 1)[0] ?? null;
    }
    return removeFromSection(section, tail);
  }
  return null;
}

function removeFromSection(section: VisualSection, parts: string[]): VisualSection | VisualBlock | null {
  if (parts.length === 0) {
    return null;
  }
  const [head = '', ...tail] = parts;
  const childSectionIndex = section.children.findIndex((child) => pathSegmentForId(getSectionId(child)) === head);
  if (childSectionIndex >= 0) {
    const child = section.children[childSectionIndex];
    if (!child) {
      return null;
    }
    if (tail.length === 0) {
      return section.children.splice(childSectionIndex, 1)[0] ?? null;
    }
    return removeFromSection(child, tail);
  }
  return removeBlockPath(section.blocks, [head, ...tail]);
}

function removeBlockPath(blocks: VisualBlock[], parts: string[]): VisualBlock | null {
  const [head = '', ...tail] = parts;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block) {
      continue;
    }
    if (pathSegmentForId(block.schema.id) === head) {
      if (tail.length === 0) {
        return blocks.splice(index, 1)[0] ?? null;
      }
      return removeFromBlock(block, tail);
    }
    for (const nestedBlocks of getNestedBlockLists(block)) {
      const removed = removeBlockPath(nestedBlocks, parts);
      if (removed) {
        return removed;
      }
    }
  }
  return null;
}

function removeFromBlock(block: VisualBlock, parts: string[]): VisualBlock | null {
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
          return nestedBlocks.splice(index, 1)[0] ?? null;
        }
        return removeFromBlock(child, tail);
      }
    }
  }
  return null;
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
  const text = `${decodeEchoEscapes(args.slice(0, redirectIndex).join(' '))}\n`;
  return writeVirtualFile(ctx, path, text, operator === '>>', 'echo');
}

function commandPrintf(ctx: { fs: ReturnType<typeof buildHvyVirtualFileSystem>; cwd: string }, args: string[]): { output: string; mutated: boolean } {
  const redirectIndex = args.findIndex((arg) => arg === '>' || arg === '>>');
  const printArgs = redirectIndex < 0 ? args : args.slice(0, redirectIndex);
  const output = formatPrintfOutput(printArgs);
  if (redirectIndex < 0) {
    return { output, mutated: false };
  }
  const operator = args[redirectIndex] ?? '';
  const path = args[redirectIndex + 1] ?? '';
  if (!path) {
    throw new Error(`printf: ${operator} requires a file path`);
  }
  if (args.slice(redirectIndex + 2).length > 0) {
    throw new Error('printf: expected redirection at the end of the command');
  }
  return writeVirtualFile(ctx, path, output, operator === '>>', 'printf');
}

function formatPrintfOutput(args: string[]): string {
  if (args.length === 0) {
    return '';
  }
  const format = decodePrintfEscapes(args[0] ?? '');
  const values = args.slice(1);
  if (!printfFormatConsumesArguments(format)) {
    return format;
  }
  let output = '';
  let valueIndex = 0;
  do {
    const formatted = applyPrintfFormat(format, values, valueIndex);
    output += formatted.output;
    valueIndex = formatted.nextValueIndex;
  } while (valueIndex < values.length);
  return output;
}

function printfFormatConsumesArguments(format: string): boolean {
  for (let index = 0; index < format.length; index += 1) {
    if (format[index] !== '%') {
      continue;
    }
    const next = format[index + 1] ?? '';
    if (next && next !== '%') {
      return true;
    }
    index += 1;
  }
  return false;
}

function applyPrintfFormat(format: string, values: string[], startValueIndex: number): { output: string; nextValueIndex: number } {
  let output = '';
  let valueIndex = startValueIndex;
  for (let index = 0; index < format.length; index += 1) {
    const char = format[index] ?? '';
    if (char !== '%') {
      output += char;
      continue;
    }
    const specifier = format[index + 1] ?? '';
    if (!specifier) {
      output += '%';
      continue;
    }
    index += 1;
    if (specifier === '%') {
      output += '%';
      continue;
    }
    const value = values[valueIndex] ?? '';
    valueIndex += 1;
    if (specifier === 's') {
      output += value;
      continue;
    }
    if (specifier === 'b') {
      output += decodePrintfEscapes(value);
      continue;
    }
    if (specifier === 'd' || specifier === 'i') {
      output += String(Number.parseInt(value || '0', 10) || 0);
      continue;
    }
    output += `%${specifier}`;
  }
  return { output, nextValueIndex: valueIndex };
}

function decodeEchoEscapes(value: string): string {
  return value
    .replaceAll('\\n', '\n')
    .replaceAll('\\t', '\t')
    .replaceAll('\\\\', '\\');
}

function decodePrintfEscapes(value: string): string {
  return value
    .replaceAll('\\n', '\n')
    .replaceAll('\\t', '\t')
    .replaceAll('\\r', '\r')
    .replaceAll('\\\\', '\\');
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

function commandSed(ctx: { fs: ReturnType<typeof buildHvyVirtualFileSystem>; cwd: string }, args: string[]): { output: string; mutated: boolean } {
  const parsed = parseCliFlags(args, {
    command: 'sed',
    booleanShort: ['E', 'r', 'n'],
    prefixShort: ['i'],
  });
  const expression = parsed.positionals[0] ?? '';
  const paths = parsed.positionals.slice(1);
  if (paths.length === 0) {
    throw new Error('sed: expected sed -n START,ENDp FILE... or sed s/search/replace/[g] path');
  }
  if (parsed.flags.has('n')) {
    const outputs = paths.map((path) => applySedPrintFilter(getReadableFile(ctx, path).read(), ['-n', expression]));
    if (outputs.some((output) => output === null)) {
      throw new Error('sed: expected sed -n START,ENDp FILE... or sed s/search/replace/[g] path');
    }
    return { output: withWarnings(outputs.join('\n'), parsed.warnings), mutated: false };
  }
  return { output: withWarnings(paths
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
    .join('\n'), parsed.warnings), mutated: true };
}

function applySedEditExpression(input: string, expression: string): string {
  const parsed = parseSedExpression(expression);
  if (parsed.kind === 'append' || parsed.kind === 'insert' || parsed.kind === 'change') {
    return applySedAddressedTextCommand(input, parsed);
  }
  if ('lineNumber' in parsed && parsed.lineNumber != null) {
    const lines = input.split(/\r?\n/);
    const index = parsed.lineNumber - 1;
    if (index < 0 || index >= lines.length) {
      return input;
    }
    if (parsed.kind === 'substitute') {
      lines[index] = applySedSubstitution(lines[index] ?? '', parsed);
      return lines.join('\n');
    }
    if (parsed.kind === 'delete' && parsed.pattern == null) {
      lines.splice(index, 1);
      return lines.join('\n');
    }
    if (parsed.kind === 'delete') {
      const pattern = parsed.pattern ?? '';
      const regex = new RegExp(pattern, parsed.flags.toLowerCase().includes('i') ? 'i' : '');
      if (regex.test(lines[index] ?? '')) {
        lines.splice(index, 1);
      }
    }
    return lines.join('\n');
  }
  if (parsed.kind === 'substitute') {
    return applySedSubstitution(input, parsed);
  }
  if (parsed.kind === 'delete') {
    if (parsed.address) {
      return applySedAddressedDelete(input, parsed);
    }
    if (parsed.pattern == null) {
      throw new Error('sed: expected sed s/search/replace/[g] path or sed /pattern/d path');
    }
    const regex = new RegExp(parsed.pattern, parsed.flags.toLowerCase().includes('i') ? 'i' : '');
    return input
      .split(/\r?\n/)
      .filter((line) => !regex.test(line))
      .join('\n');
  }
  throw new Error('sed: expected sed s/search/replace/[g] path or sed /pattern/d path');
}

function applySedAddressedTextCommand(
  input: string,
  parsed: Extract<SedExpression, { kind: 'append' | 'insert' | 'change' }>
): string {
  const lines = input.split(/\r?\n/);
  const range = resolveSedAddressRange(lines, parsed.address, parsed.endAddress);
  if (!range) {
    return input;
  }
  const replacementLines = normalizeSedTextPayload(parsed.text).split('\n');
  if (parsed.kind === 'append') {
    lines.splice(range.end + 1, 0, ...replacementLines);
  } else if (parsed.kind === 'insert') {
    lines.splice(range.start, 0, ...replacementLines);
  } else {
    lines.splice(range.start, range.end - range.start + 1, ...replacementLines);
  }
  return lines.join('\n');
}

function applySedAddressedDelete(input: string, parsed: Extract<SedExpression, { kind: 'delete' }>): string {
  if (parsed.address?.kind === 'pattern' && !parsed.endAddress) {
    const regex = new RegExp(parsed.address.pattern, parsed.flags.toLowerCase().includes('i') ? 'i' : '');
    return input
      .split(/\r?\n/)
      .filter((line) => !regex.test(line))
      .join('\n');
  }
  const lines = input.split(/\r?\n/);
  const range = resolveSedAddressRange(lines, parsed.address, parsed.endAddress);
  if (!range) {
    return input;
  }
  lines.splice(range.start, range.end - range.start + 1);
  return lines.join('\n');
}

function applySedSubstitution(input: string, parsed: Extract<SedExpression, { kind: 'substitute' }>): string {
  return input.replace(
    new RegExp(parsed.pattern, `${parsed.flags.includes('g') ? 'g' : ''}${parsed.flags.toLowerCase().includes('i') ? 'i' : ''}`),
    normalizeSedReplacement(parsed.replacement)
  );
}

function normalizeSedReplacement(replacement: string): string {
  return replacement.replace(/\\([1-9])/g, '$$$1');
}

type SedExpression =
  | { kind: 'substitute'; pattern: string; replacement: string; flags: string; lineNumber?: number }
  | { kind: 'delete'; pattern?: string; flags: string; lineNumber?: number; address?: SedAddress; endAddress?: SedAddress }
  | { kind: 'append' | 'insert' | 'change'; address: SedAddress; endAddress?: SedAddress; text: string };

type SedAddress =
  | { kind: 'line'; lineNumber: number }
  | { kind: 'last' }
  | { kind: 'pattern'; pattern: string };

function parseSedExpression(expression: string): SedExpression {
  const addressed = parseAddressedSedExpression(expression);
  if (addressed) {
    return addressed;
  }
  const address = expression.match(/^(\d+)(.*)$/);
  if (address) {
    const lineNumber = Number.parseInt(address[1] ?? '', 10);
    const rest = address[2] ?? '';
    if (!Number.isFinite(lineNumber) || lineNumber < 1 || rest.length === 0) {
      throw new Error('sed: expected sed s/search/replace/[g] path or sed /pattern/d path');
    }
    if (rest.toLowerCase() === 'd') {
      return { kind: 'delete', flags: '', lineNumber };
    }
    const parsedRest = parseSedExpression(rest);
    if (parsedRest.kind === 'substitute') {
      return { ...parsedRest, lineNumber };
    }
    if (parsedRest.kind === 'delete') {
      return { ...parsedRest, lineNumber };
    }
    throw new Error('sed: expected sed s/search/replace/[g] path or sed /pattern/d path');
  }

  if (expression.startsWith('s') && expression.length >= 2) {
    const delimiter = expression[1] ?? '';
    const first = readDelimitedSegment(expression, 2, delimiter);
    const second = readDelimitedSegment(expression, first.nextIndex, delimiter);
    return {
      kind: 'substitute',
      pattern: first.value,
      replacement: second.value,
      flags: parseSedFlags(expression.slice(second.nextIndex), 'substitute'),
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
    flags: parseSedFlags(suffix.replace(/[dD]/g, ''), 'delete'),
  };
}

function parseAddressedSedExpression(expression: string): SedExpression | null {
  const first = readSedAddress(expression, 0);
  if (!first) {
    return null;
  }
  let index = first.nextIndex;
  let endAddress: SedAddress | undefined;
  if (expression[index] === ',') {
    const second = readSedAddress(expression, index + 1);
    if (!second) {
      throw new Error('sed: expected second address after comma');
    }
    endAddress = second.address;
    index = second.nextIndex;
  }
  const command = expression[index] ?? '';
  const rest = expression.slice(index + 1);
  if (command.toLowerCase() === 'd') {
    const flags = parseSedFlags(rest, 'delete');
    return { kind: 'delete', flags, address: first.address, ...(endAddress ? { endAddress } : {}) };
  }
  if (command === 'a' || command === 'i' || command === 'c') {
    return {
      kind: command === 'a' ? 'append' : command === 'i' ? 'insert' : 'change',
      address: first.address,
      ...(endAddress ? { endAddress } : {}),
      text: rest,
    };
  }
  return null;
}

function readSedAddress(expression: string, startIndex: number): { address: SedAddress; nextIndex: number } | null {
  const first = expression[startIndex] ?? '';
  if (first === '$') {
    return { address: { kind: 'last' }, nextIndex: startIndex + 1 };
  }
  const number = expression.slice(startIndex).match(/^\d+/);
  if (number) {
    return {
      address: { kind: 'line', lineNumber: Number.parseInt(number[0], 10) },
      nextIndex: startIndex + number[0].length,
    };
  }
  if (first && !/[A-Za-z0-9\\]/.test(first)) {
    const pattern = readDelimitedSegment(expression, startIndex + 1, first);
    return { address: { kind: 'pattern', pattern: pattern.value }, nextIndex: pattern.nextIndex };
  }
  return null;
}

function resolveSedAddressRange(
  lines: string[],
  startAddress?: SedAddress,
  endAddress?: SedAddress
): { start: number; end: number } | null {
  if (!startAddress) {
    return null;
  }
  const start = resolveSedAddressIndex(lines, startAddress, 0);
  if (start < 0) {
    return null;
  }
  const end = endAddress ? resolveSedAddressIndex(lines, endAddress, start) : start;
  if (end < 0) {
    return null;
  }
  return {
    start: Math.min(start, end),
    end: Math.max(start, end),
  };
}

function resolveSedAddressIndex(lines: string[], address: SedAddress, startIndex: number): number {
  if (address.kind === 'line') {
    const index = address.lineNumber - 1;
    return index >= 0 && index < lines.length ? index : -1;
  }
  if (address.kind === 'last') {
    return Math.max(0, lines.length - 1);
  }
  const regex = new RegExp(address.pattern);
  return lines.findIndex((line, index) => index >= startIndex && regex.test(line));
}

function normalizeSedTextPayload(text: string): string {
  const withoutLeadingSlash = text.startsWith('\\') ? text.slice(1) : text;
  return withoutLeadingSlash
    .replace(/^\r?\n/, '')
    .replaceAll('\\n', '\n')
    .replaceAll('\\t', '\t');
}

function parseSedFlags(flags: string, kind: SedExpression['kind']): string {
  const allowed = kind === 'substitute' ? /^[gIi]*$/ : /^[Ii]*$/;
  if (!allowed.test(flags)) {
    throw new Error(`sed: unsupported ${kind} flags "${flags}". Escape delimiter characters in the pattern/replacement or choose a delimiter not present in the expression.`);
  }
  return flags;
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
    .filter((entryPath) => {
      const filename = entryPath.split('/').pop() ?? '';
      return !filename.startsWith('about-') && filename !== 'section-info.txt';
    })
    .filter((entryPath) => entryPath.endsWith('.txt') || entryPath.endsWith('.py'));
  return directFiles.length === 1 ? directFiles[0] ?? null : null;
}

function parseCatHeredocWrites(input: string): Array<{ path: string; content: string }> | null {
  const normalized = input.replace(/\r\n?/g, '\n');
  let remaining = normalized.trimStart();
  if (!remaining.startsWith('cat ')) {
    return null;
  }
  const writes: Array<{ path: string; content: string }> = [];
  while (remaining.trim().length > 0) {
    remaining = remaining.trimStart();
    const firstLineEnd = remaining.indexOf('\n');
    if (firstLineEnd < 0) {
      return null;
    }
    const firstLine = remaining.slice(0, firstLineEnd).trim();
    const match = firstLine.match(/^cat\s*>\s*(\S+)\s*<<\s*['"]?([A-Za-z0-9_.-]+)['"]?$/);
    if (!match) {
      return writes.length > 0 ? null : null;
    }
    const path = match[1] ?? '';
    const marker = match[2] ?? '';
    const body = remaining.slice(firstLineEnd + 1);
    const lines = body.split('\n');
    const markerIndex = lines.findIndex((line) => line.trim() === marker);
    if (markerIndex < 0) {
      throw new Error(`cat: heredoc missing terminator ${marker}`);
    }
    writes.push({ path, content: `${lines.slice(0, markerIndex).join('\n')}\n` });
    remaining = lines.slice(markerIndex + 1).join('\n');
  }
  return writes.length > 0 ? writes : null;
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
          candidate.kind === 'file' &&
          (candidate.path === root || candidate.path.startsWith(root === '/' ? '/' : `${root}/`)) &&
          isSearchVisibleFile(candidate.path, root));
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

function isSearchVisibleFile(path: string, root: string): boolean {
  if (path.startsWith('/id/') && root !== '/id' && !root.startsWith('/id/')) {
    return false;
  }
  if (!isRawHvyFile(path)) {
    return true;
  }
  return root === path;
}

function isRawHvyFile(path: string): boolean {
  const filename = path.split('/').pop() ?? '';
  return filename === 'raw.hvy' || filename === 'raw-preview.hvy.txt' || filename === 'raw.wip.hvy';
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
      || (arg === '2' && normalizedArgs[index + 1] === '>' && normalizedArgs[index + 2] === '/dev/null')
    ) {
      if (
        arg === '2'
        && normalizedArgs[index + 1] === '>'
        && (normalizedArgs[index + 2] === '&1' || normalizedArgs[index + 2] === '/dev/null')
      ) {
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
  const redirect = parseStdoutRedirection(commandArgs);
  const [command = '', ...args] = redirect.commandArgs;
  if (!command) {
    return { cwd: ctx.cwd, stdout: '', stderr: '', status: 0, mutated: false };
  }
  try {
    if (redirect.targetPath) {
      assertStdoutRedirectionIsNotInputFile(ctx, command, args, redirect.targetPath);
    }
    const result = stdin === null
      ? await runCommand(ctx, command, args)
      : await runPipedCommand(ctx, command, args, stdin);
    if (!redirect.targetPath) {
      return { cwd: result.cwd, stdout: result.output, stderr: '', status: 0, mutated: result.mutated };
    }
    const writeResult = writeVirtualFile(
      { fs: ctx.fs, cwd: result.cwd },
      redirect.targetPath,
      command === 'echo' ? `${decodeEchoEscapes(result.output)}\n` : result.output,
      redirect.append,
      command
    );
    return { cwd: result.cwd, stdout: writeResult.output, stderr: '', status: 0, mutated: true };
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

function parseStdoutRedirection(commandArgs: string[]): { commandArgs: string[]; targetPath: string; append: boolean } {
  const redirectIndex = commandArgs.findIndex((arg) => arg === '>' || arg === '>>');
  if (redirectIndex < 0) {
    return { commandArgs, targetPath: '', append: false };
  }
  const operator = commandArgs[redirectIndex] ?? '';
  const targetPath = commandArgs[redirectIndex + 1] ?? '';
  if (!targetPath) {
    throw new Error(`${commandArgs[0] ?? 'command'}: ${operator} requires a file path`);
  }
  if (commandArgs.slice(redirectIndex + 2).length > 0) {
    throw new Error(`${commandArgs[0] ?? 'command'}: expected redirection at the end of the command`);
  }
  return {
    commandArgs: commandArgs.slice(0, redirectIndex),
    targetPath,
    append: operator === '>>',
  };
}

function assertStdoutRedirectionIsNotInputFile(
  ctx: HvyCliCommandContext,
  command: string,
  args: string[],
  targetPath: string
): void {
  const target = resolveReadablePath(ctx.fs, ctx.cwd, targetPath);
  if (!ctx.fs.entries.has(target)) {
    return;
  }
  const inputs = getCommandReadableInputPaths(command, args)
    .map((path) => resolveReadablePath(ctx.fs, ctx.cwd, path))
    .filter((path) => ctx.fs.entries.get(path)?.kind === 'file');
  if (inputs.includes(target)) {
    throw new Error(`${command}: cannot redirect output to the same file being read: ${target}`);
  }
}

function getCommandReadableInputPaths(command: string, args: string[]): string[] {
  if (command === 'cat') {
    return args;
  }
  if (command === 'nl') {
    return parseNlArgs(args).paths;
  }
  if (command === 'head' || command === 'tail') {
    return parseLineCount(args, 5).paths;
  }
  if (command === 'grep') {
    return parseGrepArgs(args).paths;
  }
  if (command === 'rg') {
    return [parseRgArgs(args).path];
  }
  if (command === 'sed') {
    const parsed = parseCliFlags(args, {
      command: 'sed',
      booleanShort: ['E', 'r', 'n'],
      prefixShort: ['i'],
    });
    return parsed.positionals.slice(1);
  }
  if (command === 'sort' || command === 'uniq' || command === 'wc') {
    return args.filter((arg) => !arg.startsWith('-'));
  }
  return [];
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
  if (command === 'printf') {
    return { cwd: ctx.cwd, output: formatPrintfOutput(args), mutated: false };
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
  const expression = args.find((arg) => /^\d*s(.)(.*?)\1(.*?)\1[gIig]*$/.test(arg));
  if (!expression) {
    return null;
  }
  const parsed = parseSedExpression(expression);
  return parsed.kind === 'substitute' ? applySedEditExpression(output, expression) : null;
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

function formatEntry(fs: ReturnType<typeof buildHvyVirtualFileSystem>, entry: HvyVirtualEntry): string {
  const tags = formatEntryTags(fs, entry);
  const description = formatEntryDescription(fs, entry);
  const suffix = `${tags}${description ? ` | ${description}` : ''}`;
  if (entry.kind === 'dir') {
    return `dir  ${entry.path.split('/').pop() || '/'}${suffix}`;
  }
  return `file ${entry.path.split('/').pop() || '/'} ${entry.write && entry.writable !== false ? '[w]' : '[ro]'}${suffix}`;
}

function formatEntryDescription(fs: ReturnType<typeof buildHvyVirtualFileSystem>, entry: HvyVirtualEntry): string {
  if (entry.kind === 'dir') {
    return formatDirectoryEntryDescription(fs, entry.path);
  }
  return formatFileEntryDescription(fs, entry.path);
}

function formatDirectoryEntryDescription(fs: ReturnType<typeof buildHvyVirtualFileSystem>, path: string): string {
  if (path === '/body') {
    return 'document body sections and components';
  }
  if (path === '/attachments') {
    return 'document attachment metadata files';
  }
  if (fs.entries.has(`${path}/section.json`)) {
    return isTopLevelSectionPath(path) ? 'section' : 'subsection';
  }
  const componentName = inferComponentNameForDirectory(fs, path);
  if (componentName) {
    return formatComponentDirectoryDescription(fs, path, componentName);
  }
  const name = path.split('/').pop() ?? '';
  if (name === 'expandable-stub') {
    return formatStructuralDirectoryDescription(fs, path, "expandable's stub");
  }
  if (name === 'expandable-content') {
    return formatStructuralDirectoryDescription(fs, path, "expandable's content");
  }
  if (name === 'container') {
    return formatStructuralDirectoryDescription(fs, path, 'container children');
  }
  if (name === 'grid') {
    return formatStructuralDirectoryDescription(fs, path, 'grid items');
  }
  return '';
}

function isTopLevelSectionPath(path: string): boolean {
  return path.startsWith('/body/') && !path.slice('/body/'.length).includes('/');
}

function formatComponentDirectoryDescription(fs: ReturnType<typeof buildHvyVirtualFileSystem>, path: string, componentName: string): string {
  const componentLabel = componentName === 'table' ? 'static table component' : `${componentName} component`;
  const preview = formatComponentPreview(fs, path, componentName);
  return preview ? `${componentLabel} | ${preview}` : componentLabel;
}

function formatStructuralDirectoryDescription(fs: ReturnType<typeof buildHvyVirtualFileSystem>, path: string, label: string): string {
  const preview = listDirectory(fs, path)
    .filter((entry) => entry.kind === 'dir')
    .map((entry) => {
      const componentName = inferComponentNameForDirectory(fs, entry.path);
      return componentName ? formatComponentPreview(fs, entry.path, componentName) : '';
    })
    .find((value) => value.length > 0);
  return preview ? `${label} | ${preview}` : label;
}

function formatTableDirectoryPreview(fs: ReturnType<typeof buildHvyVirtualFileSystem>, path: string): string {
  const table = readJsonFileFromVirtualPath(fs, `${path}/table.json`);
  const columns = readJsonArrayFromVirtualPath(fs, `${path}/tableColumns.json`).filter((value): value is string => typeof value === 'string');
  const rows = readJsonArrayFromVirtualPath(fs, `${path}/tableRows.json`)
    .map((row) => row && typeof row === 'object' && !Array.isArray(row) && Array.isArray((row as { cells?: unknown }).cells)
      ? (row as { cells: unknown[] }).cells.filter((cell): cell is string => typeof cell === 'string')
      : []
    );
  const firstNonEmptyRow = rows.find((row) => row.some((cell) => cell.trim().length > 0));
  const showHeader = table?.tableShowHeader !== false;

  // Static table directory previews follow what the reader emphasizes:
  // visible headers preview with the header, hidden-header tables preview
  // with the first non-empty row, and empty hidden-header tables fall back
  // to the header so the table shape is still legible in `ls`.
  if (showHeader || !firstNonEmptyRow) {
    return compactLsComponentPreview(columns.join(' '));
  }
  return compactLsComponentPreview(firstNonEmptyRow.join(' '));
}

function formatComponentPreview(fs: ReturnType<typeof buildHvyVirtualFileSystem>, path: string, componentName: string): string {
  return componentName === 'table'
    ? formatTableDirectoryPreview(fs, path)
    : formatComponentBodyPreview(fs, path, componentName);
}

function formatComponentBodyPreview(fs: ReturnType<typeof buildHvyVirtualFileSystem>, path: string, componentName: string): string {
  const bodyEntry = fs.entries.get(`${path}/${componentName}.txt`);
  if (bodyEntry?.kind !== 'file') {
    return '';
  }
  return compactLsComponentPreview(bodyEntry.read());
}

function compactLsComponentPreview(value: string, normalizeLine: (line: string) => string = (line) => line): string {
  const lines = value.split('\n').map((line) => normalizeLine(line).replace(/\s+/g, ' ').trim());
  const firstContentIndex = lines.findIndex((line) => line.length > 0);
  if (firstContentIndex < 0) {
    return '';
  }
  const firstContentLine = lines[firstContentIndex] ?? '';
  const hasMoreContent = lines.slice(firstContentIndex + 1).some((line) => line.length > 0);
  if (firstContentLine.length > LS_COMPONENT_PREVIEW_MAX_CHARS) {
    return `${firstContentLine.slice(0, LS_COMPONENT_PREVIEW_MAX_CHARS)}...`;
  }
  return hasMoreContent ? `${firstContentLine}...` : firstContentLine;
}

function formatFileEntryDescription(fs: ReturnType<typeof buildHvyVirtualFileSystem>, path: string): string {
  const filename = path.split('/').pop() ?? '';
  const directoryPath = path.replace(/\/[^/]+$/, '') || '/';
  if (path === '/header.yaml') {
    return 'document metadata YAML';
  }
  if (path === '/scratchpad.txt') {
    return 'ephemeral AI task notes; not serialized into the HVY document';
  }
  if (filename === 'raw.hvy') {
    return formatRawHvySubject(fs, directoryPath);
  }
  if (filename === 'raw-preview.hvy.txt') {
    return `first 100 prewrapped lines of ${formatRawHvySubject(fs, directoryPath)}; raw.hvy hidden because it is 4000+ characters`;
  }
  if (filename === 'raw.wip.hvy') {
    return 'failed raw.hvy draft preserved after a parse error';
  }
  if (filename === 'section.json') {
    return 'section metadata and display settings';
  }
  if (filename === 'section-info.txt') {
    return 'summary of this section and its metadata';
  }
  if (filename === 'about-section.txt') {
    return 'section documentation';
  }
  if (filename === 'children-order.json') {
    return formatChildrenOrderDescription(fs, directoryPath);
  }
  if (filename === 'tableColumns.json') {
    return 'static table column names as a JSON string array';
  }
  if (filename === 'tableRows.json') {
    return 'static table rows as a JSON array of row objects with cells arrays';
  }
  if (filename.startsWith('about-') && filename.endsWith('.txt')) {
    const docsEntry = fs.entries.get(path);
    if (docsEntry?.kind === 'file' && docsEntry.read().includes('component template:')) {
      return 'documentation for component template type and schema';
    }
    return 'documentation for component or plugin type and schema';
  }
  if (filename.endsWith('.py')) {
    return 'Python/Brython script source exposed from a scripting or form plugin';
  }
  const componentName = inferComponentNameForDirectory(fs, directoryPath);
  if (componentName && filename === `${componentName}.json`) {
    return `${componentName} component config`;
  }
  if (componentName && filename === `${componentName}.css`) {
    return `${componentName} component CSS mirrored from config`;
  }
  if (componentName && filename === `${componentName}.txt`) {
    const bodyEntry = fs.entries.get(path);
    if (componentName === 'table' || bodyEntry?.kind === 'file' && bodyEntry.writable === false) {
      return `${componentName} component body preview`;
    }
    return `${componentName} component body text`;
  }
  if (directoryPath === '/attachments' && filename.endsWith('.json')) {
    return 'attachment metadata summary';
  }
  return '';
}

function formatChildrenOrderDescription(fs: ReturnType<typeof buildHvyVirtualFileSystem>, directoryPath: string): string {
  const name = directoryPath.split('/').pop() ?? '';
  if (directoryPath === '/body') {
    return 'top-level section order';
  }
  if (name === 'expandable-stub') {
    return "order for components inside the expandable's stub";
  }
  if (name === 'expandable-content') {
    return "order for components inside the expandable's content";
  }
  if (name === 'container') {
    return 'order for components inside this container';
  }
  if (name === 'grid') {
    return 'grid item order';
  }
  const componentName = inferComponentNameForDirectory(fs, directoryPath);
  if (componentName === 'component-list') {
    return 'list item order';
  }
  if (fs.entries.has(`${directoryPath}/section.json`)) {
    return 'order for this section\'s subsections and components';
  }
  return 'child order';
}

function formatRawHvySubject(fs: ReturnType<typeof buildHvyVirtualFileSystem>, directoryPath: string): string {
  if (directoryPath === '/') {
    return 'raw HVY for this document';
  }
  if (fs.entries.has(`${directoryPath}/section.json`)) {
    return 'raw HVY for this section';
  }
  return 'raw HVY for this component';
}

function formatEntryTags(fs: ReturnType<typeof buildHvyVirtualFileSystem>, entry: HvyVirtualEntry): string {
  const tags = readEntryTags(fs, entry).split(',').map((tag) => tag.trim()).filter(Boolean);
  return tags.length > 0 ? ` tags=[${tags.join(', ')}]` : '';
}

function readEntryTags(fs: ReturnType<typeof buildHvyVirtualFileSystem>, entry: HvyVirtualEntry): string {
  if (entry.kind === 'dir') {
    const section = readJsonFileFromVirtualPath(fs, `${entry.path}/section.json`);
    if (typeof section?.tags === 'string') {
      return section.tags;
    }
    const componentName = inferComponentNameForDirectory(fs, entry.path);
    if (!componentName) {
      return '';
    }
    const component = readJsonFileFromVirtualPath(fs, `${entry.path}/${componentName}.json`);
    return typeof component?.tags === 'string' ? component.tags : '';
  }
  const filename = entry.path.split('/').pop() ?? '';
  if (!filename.endsWith('.json') || filename === 'section.json') {
    return '';
  }
  const component = readJsonFileFromVirtualPath(fs, entry.path);
  return typeof component?.tags === 'string' ? component.tags : '';
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
    '': 'Commands: cd, pwd, ls, cat, head, tail, nl, find, rg, grep, sort, uniq, wc, tr, xargs, cp, mv, rm, printf, echo, sed, true, hvy. Ask: ask QUESTION. Finish: done MESSAGE_TO_USER. Use man <command> for details.',
    cd: formatCommandHelp('cd PATH', 'Change the current virtual directory.'),
    pwd: formatCommandHelp('pwd', 'Print the current virtual directory.'),
    ls: formatCommandHelp('ls [PATH]', 'List files and directories. Files are marked [w] writable or [ro] read-only; stable entries include pipe-delimited descriptions.'),
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
    mv: formatCommandHelp('mv SOURCE DEST', 'Move a component directory to another writable component container or path. Moving to a new path renames the component id.'),
    rm: formatCommandHelp('rm -r|-rf PATH...', 'Remove section or component directories from the virtual document body. -f ignores missing paths. Alias: hvy remove PATH.'),
    printf: formatCommandHelp('printf FORMAT [ARG...] [> FILE|>> FILE]', 'Print formatted text without adding a newline, replace a writable file, or append to a writable file. Supports common escapes and %s, %b, %d, %i, and %%.'),
    echo: formatCommandHelp('echo TEXT [> FILE|>> FILE]', 'Print text, replace a writable file, or append to a writable file.'),
    sed: formatCommandHelp('sed -n START,ENDp FILE...\nsed [-i] [-E] s/search/replace/[gI] FILE...\nsed -i ADDRESS[,ADDRESS]c\\TEXT FILE\nsed -i ADDRESSa\\TEXT FILE\nsed -i ADDRESSi\\TEXT FILE', 'Print line ranges, replace text, delete addressed lines, or insert/append/change addressed text. ADDRESS can be a line number, $, or /pattern/.'),
    true: formatCommandHelp('true', 'Succeed without output. Useful in command chains such as COMMAND || true.'),
    ask: formatCommandHelp('ask QUESTION', 'Pause the AI CLI edit loop and ask the user for clarification.'),
    done: formatCommandHelp('done MESSAGE_TO_USER', 'Finish the AI CLI edit loop with the message to show the user.'),
    hvy: hvyDocumentCommandHelp(),
    'hvy insert': hvyDocumentCommandHelp('insert'),
    'hvy request_structure': hvyDocumentCommandHelp('request_structure'),
    'hvy search': hvyDocumentCommandHelp('search'),
    'hvy cheatsheet': hvyDocumentCommandHelp('cheatsheet'),
    'hvy recipe': hvyDocumentCommandHelp('recipe'),
    'hvy lint': formatCommandHelp('hvy lint [--fix]', 'Check the document for likely component issues. --fix repairs safe structural issues such as plugin id aliases.'),
    'hvy prune-xref': hvyDocumentCommandHelp('prune_xref'),
    plugin: hvyDocumentCommandHelp('plugin'),
    'hvy plugin': hvyDocumentCommandHelp('plugin'),
    'hvy plugin form': hvyDocumentCommandHelp('plugin form'),
    'hvy plugin db-table': hvyDocumentCommandHelp('plugin db-table'),
  };
  return help[normalizedTopic] ?? help[''];
}

function formatCommandHelp(command: string, description: string): string {
  return `${command}\n  ${description}`;
}
