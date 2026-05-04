import { stringify as stringifyYaml } from 'yaml';

import { defaultBlockSchema } from '../document-factory';
import type { BlockSchema, VisualBlock, VisualSection } from '../editor/types';
import type { JsonObject } from '../hvy/types';
import { DB_TABLE_PLUGIN_ID, FORM_PLUGIN_ID } from '../plugins/registry';
import { getSectionId } from '../section-ops';
import type { VisualDocument } from '../types';
import { makeId } from '../utils';
import {
  getHvyCliPluginCommandRegistration,
  getHvyCliPluginCommandRegistrations,
  getHvyCliScriptingToolHelp,
  getHvyCliScriptingToolNames,
  type HvyCliHelpCommand,
} from './plugin-command-registry';
import { formatHvyRequestStructure } from './request-structure';
import { resolveVirtualPath, type HvyVirtualFileSystem } from './virtual-file-system';

export interface HvyDocumentCommandContext {
  document: VisualDocument;
  fs: HvyVirtualFileSystem;
  cwd: string;
}

export interface HvyDocumentCommandResult {
  output: string;
  mutated: boolean;
}

export function executeHvyDocumentCommand(ctx: HvyDocumentCommandContext, args: string[]): HvyDocumentCommandResult {
  const [resource, action, ...rest] = args;
  if (resource === 'request_structure') {
    if (action || rest.length > 0) {
      throw new Error('hvy request_structure takes no arguments');
    }
    return { output: formatHvyRequestStructure(ctx.document, ctx.fs), mutated: false };
  }
  if (resource === 'add') {
    return executeHvyAddCommand(ctx, action, rest);
  }
  if (resource === 'plugin' && action === 'form' && rest[0] === 'add') {
    return addFormPluginBlock(ctx, rest.slice(1));
  }
  if (resource === 'plugin' && action === 'db-table' && (rest[0] === 'show' || rest[0] === 'add')) {
    return addDbTablePluginBlock(ctx, rest.slice(1));
  }
  if (resource === 'plugin' && action === 'scripting' && rest[0] === 'tool') {
    return { output: formatScriptingToolHelp(rest[1] ?? ''), mutated: false };
  }
  if (resource === 'plugin' && action && rest.length === 0 && getHvyCliPluginCommandRegistration(action)) {
    return { output: hvyDocumentCommandHelp(`plugin ${action}`), mutated: false };
  }
  if (resource === 'section' && action === 'add') {
    return addSection(ctx, rest);
  }
  if (resource === 'text' && action === 'add') {
    return addTextBlock(ctx, rest);
  }
  if (resource === 'table' && action === 'add') {
    return addTableBlock(ctx, rest);
  }
  if (resource === 'plugin' && action === 'add') {
    return addPluginBlock(ctx, rest);
  }
  if (resource === 'form' && action === 'add') {
    return addFormPluginBlock(ctx, rest);
  }
  if (resource === 'db-table' && (action === 'show' || action === 'add')) {
    return addDbTablePluginBlock(ctx, rest);
  }
  throw new Error('hvy: expected request_structure, add, plugin, section add, text add, table add, form add, or db-table show');
}

export function hvyDocumentCommandHelp(topic = ''): string {
  const normalizedTopic = topic.trim();
  if (normalizedTopic.startsWith('plugin scripting tool')) {
    return formatScriptingToolHelp(normalizedTopic.slice('plugin scripting tool'.length).trim());
  }
  const registeredPluginName = normalizedTopic.startsWith('plugin ')
    ? normalizedTopic.slice('plugin '.length).split(/\s+/, 1)[0] ?? ''
    : '';
  const registeredPluginTopic = registeredPluginName
    ? getHvyCliPluginCommandRegistration(registeredPluginName)
    : null;
  if (registeredPluginTopic) {
    return formatRegisteredPluginHelp(registeredPluginTopic);
  }

  const help: Record<string, string> = {
    '': [
      formatCommandHelp('hvy add section PARENT_PATH ID TITLE', 'Create a section.'),
      formatCommandHelp('hvy add text SECTION_PATH ID TEXT', 'Create a text component.'),
      formatCommandHelp('hvy add table SECTION_PATH ID COLUMNS [--row CSV]...', 'Create a table component.'),
      formatCommandHelp('hvy remove PATH', 'Remove a section or component directory. Alias: hvy delete PATH.'),
      formatCommandHelp('hvy request_structure', 'Show the full component directory map for the current document.'),
      ...formatPluginQuickReference(),
      formatCommandHelp('Edit existing components', 'Use find to discover virtual files, cat to inspect them, and sed to update writable body/config files.'),
    ].join('\n'),
    section: formatCommandHelp('hvy add section PARENT_PATH ID TITLE', 'Add a section under /body or under another section. Alias: hvy section add.'),
    text: formatCommandHelp('hvy add text SECTION_PATH ID TEXT', 'Append a text block to a section. Alias: hvy text add.'),
    table: formatCommandHelp('hvy add table SECTION_PATH ID COLUMNS [--row CSV]...', 'Append a table block. Columns and rows use comma-separated text. Alias: hvy table add.'),
    request_structure: formatCommandHelp('hvy request_structure', 'Show the full component directory map. Takes no arguments.'),
    plugin: [
      ...formatPluginQuickReference(),
      ...getHvyCliPluginCommandRegistrations().map((plugin) => formatCommandHelp(plugin.helpTopic, `Show ${plugin.name} plugin commands.`)),
      formatCommandHelp('hvy add plugin SECTION_PATH ID PLUGIN_ID [--config JSON] [--body TEXT]', 'Create a raw plugin block by plugin id.'),
    ].join('\n'),
    form: formatLegacyPluginAliasHelp('form', 'form add'),
    'db-table': formatLegacyPluginAliasHelp('db-table', 'db-table'),
  };
  return help[normalizedTopic] ?? help[''];
}

function formatCommandHelp(command: string, description: string): string {
  return `${command}\n  ${description}`;
}

function formatLegacyPluginAliasHelp(pluginName: string, legacyPrefix: string): string {
  const plugin = getHvyCliPluginCommandRegistration(pluginName);
  if (!plugin) {
    return '';
  }
  const commands = [...plugin.addCommands, ...plugin.operationCommands, ...(plugin.helpCommands ?? [])]
    .map((entry) => ({
      command: entry.command
        .replace(/^hvy add plugin form\b/, 'form add')
        .replace(/^hvy add plugin db-table\b/, 'db-table show')
        .replace(/^hvy plugin db-table\b/, legacyPrefix),
      description: entry.description,
    }));
  return commands.map((entry) => formatCommandHelp(entry.command, entry.description)).join('\n');
}

function formatRegisteredPluginHelp(plugin: {
  helpTopic: string;
  componentHints: string[];
  addCommands: HvyCliHelpCommand[];
  operationCommands: HvyCliHelpCommand[];
  helpCommands?: HvyCliHelpCommand[];
}): string {
  const commands = [...plugin.addCommands, ...plugin.operationCommands, ...(plugin.helpCommands ?? [])];
  return [
    ...(commands.length > 0 ? commands.map((entry) => formatCommandHelp(entry.command, entry.description)) : [
      formatCommandHelp(plugin.helpTopic, 'Show plugin-specific help.'),
    ]),
    ...(plugin.componentHints.length > 0 ? ['', 'Hints:', ...plugin.componentHints.map((hint) => `  ${hint}`)] : []),
  ].join('\n');
}

function formatScriptingToolHelp(toolName: string): string {
  const normalized = toolName.trim();
  if (!normalized) {
    return [
      formatCommandHelp('hvy plugin scripting tool TOOL_NAME', 'Show doc.tool call shape for one scripting tool.'),
      `Available tools: ${getHvyCliScriptingToolNames().join(', ')}`,
    ].join('\n');
  }
  const help = getHvyCliScriptingToolHelp(normalized);
  if (!help) {
    return `Unknown scripting tool "${normalized}". Available tools: ${getHvyCliScriptingToolNames().join(', ')}`;
  }
  return [
    formatCommandHelp(`hvy plugin scripting tool ${normalized}`, `Show doc.tool help for ${normalized}.`),
    '',
    `Use from Brython as: doc.tool("${normalized}", args_dict)`,
    '',
    help,
  ].join('\n');
}

function formatPluginQuickReference(): string[] {
  return getHvyCliPluginCommandRegistrations().flatMap((plugin) => formatPluginRegisteredHelp(plugin));
}

function formatPluginRegisteredHelp(plugin: { addCommands: HvyCliHelpCommand[]; operationCommands: HvyCliHelpCommand[] }): string[] {
  return [...plugin.addCommands, ...plugin.operationCommands].map((entry) => formatCommandHelp(entry.command, entry.description));
}

function executeHvyAddCommand(ctx: HvyDocumentCommandContext, kind = '', args: string[]): HvyDocumentCommandResult {
  if (kind === 'section') {
    return addSection(ctx, args);
  }
  if (kind === 'text') {
    return addTextBlock(ctx, args);
  }
  if (kind === 'table') {
    return addTableBlock(ctx, args);
  }
  if (kind === 'plugin') {
    const [pluginKind = '', ...rest] = args;
    if (pluginKind === 'form') {
      return addFormPluginBlock(ctx, rest);
    }
    if (pluginKind === 'db-table') {
      return addDbTablePluginBlock(ctx, rest);
    }
    return addPluginBlock(ctx, args);
  }
  throw new Error('hvy add: expected section, text, table, or plugin');
}

function addSection(ctx: HvyDocumentCommandContext, args: string[]): HvyDocumentCommandResult {
  const [parentPath = '', id = '', title = ''] = args;
  if (!parentPath || !id || !title) {
    throw new Error('hvy section add: expected PARENT_PATH ID TITLE');
  }
  const parent = findSectionParent(ctx, parentPath);
  const section = createSection(id, decodeCliText(title), parent ? parent.level + 1 : 1);
  if (parent) {
    parent.children.push(section);
  } else {
    ctx.document.sections.push(section);
  }
  return { output: `/body/${id}`, mutated: true };
}

function addTextBlock(ctx: HvyDocumentCommandContext, args: string[]): HvyDocumentCommandResult {
  const [sectionPath = '', id = '', text = ''] = args;
  const section = requireSection(ctx, sectionPath, 'hvy text add');
  section.blocks.push(createBlock('text', id, decodeCliText(text)));
  return { output: `${sectionPath.replace(/\/$/, '')}/${id}`, mutated: true };
}

function addTableBlock(ctx: HvyDocumentCommandContext, args: string[]): HvyDocumentCommandResult {
  const [sectionPath = '', id = '', columns = '', ...rest] = args;
  const section = requireSection(ctx, sectionPath, 'hvy table add');
  const rows = readRepeatedOption(rest, '--row').map((row) => ({ cells: splitCsvText(decodeCliText(row)) }));
  const schema = createSchema('table', id);
  schema.tableColumns = decodeCliText(columns);
  schema.tableRows = rows;
  section.blocks.push(createBlockFromSchema(schema, ''));
  return { output: `${sectionPath.replace(/\/$/, '')}/${id}`, mutated: true };
}

function addPluginBlock(ctx: HvyDocumentCommandContext, args: string[]): HvyDocumentCommandResult {
  const [sectionPath = '', id = '', plugin = '', ...rest] = args;
  const section = requireSection(ctx, sectionPath, 'hvy plugin add');
  if (!plugin) {
    throw new Error('hvy plugin add: expected SECTION_PATH ID PLUGIN_ID');
  }
  const config = readOption(rest, '--config');
  section.blocks.push(createPluginBlock(id, plugin, config ? parseJsonObject(config, 'hvy plugin add --config') : {}, decodeCliText(readOption(rest, '--body') ?? '')));
  return { output: `${sectionPath.replace(/\/$/, '')}/${id}`, mutated: true };
}

function addFormPluginBlock(ctx: HvyDocumentCommandContext, args: string[]): HvyDocumentCommandResult {
  const [sectionPath = '', id = '', submitLabel = '', ...rest] = args;
  const section = requireSection(ctx, sectionPath, 'form add');
  const fieldSpecs = rest.filter((arg, index) => !isOptionArg(arg) && !isOptionValue(rest, index));
  if (!id || !submitLabel || fieldSpecs.length === 0) {
    throw new Error('form add: expected SECTION_PATH ID SUBMIT_BUTTON_LABEL FIELD...');
  }
  const scripts = Object.fromEntries(readRepeatedOptionPairs(rest, '--script').map(([name, source]) => [name, decodeCliText(source)]));
  const submitScript = readOption(rest, '--on-submit-script') ?? readOption(rest, '--submit');
  const body = stringifyYaml({
    fields: fieldSpecs.map(parseFormFieldSpec),
    ...(Object.keys(scripts).length > 0 ? { scripts } : {}),
    ...(submitScript ? { submitScript } : {}),
    submitLabel: decodeCliText(submitLabel),
  }).trimEnd();
  section.blocks.push(createPluginBlock(id, FORM_PLUGIN_ID, { version: '0.1' }, body));
  return { output: `${sectionPath.replace(/\/$/, '')}/${id}`, mutated: true };
}

function addDbTablePluginBlock(ctx: HvyDocumentCommandContext, args: string[]): HvyDocumentCommandResult {
  const [sectionPath = '', id = '', table = '', query = ''] = args;
  const section = requireSection(ctx, sectionPath, 'db-table show');
  if (!id || !table) {
    throw new Error('db-table show: expected SECTION_PATH ID TABLE [QUERY]');
  }
  section.blocks.push(
    createPluginBlock(id, DB_TABLE_PLUGIN_ID, { source: 'with-file', table: decodeCliText(table), queryLimit: 10 }, decodeCliText(query))
  );
  return { output: `${sectionPath.replace(/\/$/, '')}/${id}`, mutated: true };
}

function findSectionParent(ctx: HvyDocumentCommandContext, path: string): VisualSection | null {
  const resolved = resolveVirtualPath(ctx.fs, ctx.cwd, path);
  if (resolved === '/body') {
    return null;
  }
  return requireSection(ctx, path, 'hvy section add');
}

function requireSection(ctx: HvyDocumentCommandContext, path: string, command: string): VisualSection {
  const resolved = resolveVirtualPath(ctx.fs, ctx.cwd, path);
  const sectionId = resolved.split('/').filter(Boolean).pop() ?? '';
  const section = findSectionById(ctx.document.sections, sectionId);
  if (!section) {
    throw new Error(`${command}: no such section: ${path}`);
  }
  return section;
}

function findSectionById(sections: VisualSection[], id: string): VisualSection | null {
  for (const section of sections) {
    if (getSectionId(section) === id) {
      return section;
    }
    const child = findSectionById(section.children, id);
    if (child) {
      return child;
    }
  }
  return null;
}

function createSection(id: string, title: string, level: number): VisualSection {
  return {
    key: makeId('section'),
    customId: id,
    contained: true,
    lock: false,
    idEditorOpen: false,
    isGhost: false,
    title,
    level,
    expanded: true,
    highlight: false,
    customCss: '',
    tags: '',
    description: '',
    location: 'main',
    blocks: [],
    children: [],
  };
}

function createBlock(component: string, id: string, text: string): VisualBlock {
  return createBlockFromSchema(createSchema(component, id), text);
}

function createBlockFromSchema(schema: BlockSchema, text: string): VisualBlock {
  return {
    id: makeId('block'),
    text,
    schema,
    schemaMode: false,
  };
}

function createPluginBlock(id: string, plugin: string, pluginConfig: JsonObject, text: string): VisualBlock {
  const schema = createSchema('plugin', id);
  schema.plugin = plugin;
  schema.pluginConfig = pluginConfig;
  return createBlockFromSchema(schema, text);
}

function createSchema(component: string, id: string): BlockSchema {
  return {
    ...defaultBlockSchema(component),
    component,
    id,
  };
}

function readOption(args: string[], option: string): string | null {
  const index = args.indexOf(option);
  return index >= 0 ? args[index + 1] ?? '' : null;
}

function readRepeatedOption(args: string[], option: string): string[] {
  return args.flatMap((arg, index) => (arg === option ? [args[index + 1] ?? ''] : []));
}

function readRepeatedOptionPairs(args: string[], option: string): Array<[string, string]> {
  return args.flatMap((arg, index) => (arg === option ? [[args[index + 1] ?? '', args[index + 2] ?? ''] as [string, string]] : []));
}

function isOptionArg(value: string): boolean {
  return value.startsWith('--');
}

function isOptionValue(args: string[], index: number): boolean {
  return args[index - 1]?.startsWith('--') === true || args[index - 2] === '--script';
}

function decodeCliText(value: string): string {
  return value.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function splitCsvText(value: string): string[] {
  return value.split(',').map((cell) => cell.trim());
}

function parseFormFieldSpec(spec: string): JsonObject {
  const [name = '', label = '', type = 'text', ...rest] = decodeCliText(spec).split(':');
  const field: JsonObject = {
    name,
    label: label || name,
    type: type || 'text',
  };
  if (rest.includes('required')) {
    field.required = true;
  }
  const optionPart = rest.find((part) => part.includes('|'));
  if (optionPart) {
    field.options = optionPart.split('|').map((option) => option.trim()).filter((option) => option.length > 0);
  }
  return field;
}

function parseJsonObject(content: string, label: string): JsonObject {
  const parsed = JSON.parse(content) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as JsonObject;
}
