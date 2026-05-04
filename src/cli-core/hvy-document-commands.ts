import { stringify as stringifyYaml } from 'yaml';

import { defaultBlockSchema } from '../document-factory';
import type { BlockSchema, VisualBlock, VisualSection } from '../editor/types';
import type { JsonObject } from '../hvy/types';
import { DB_TABLE_PLUGIN_ID, FORM_PLUGIN_ID } from '../plugins/registry';
import { getSectionId } from '../section-ops';
import type { VisualDocument } from '../types';
import { makeId } from '../utils';
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
  throw new Error('hvy: expected section add, text add, table add, plugin add, form add, or db-table show');
}

export function hvyDocumentCommandHelp(topic = ''): string {
  const help: Record<string, string> = {
    '': [
      'hvy section add PARENT_PATH ID TITLE',
      'hvy text add SECTION_PATH ID TEXT',
      'hvy table add SECTION_PATH ID COLUMNS [--row CSV]...',
      'hvy plugin add SECTION_PATH ID PLUGIN_ID [--config JSON] [--body TEXT]',
      'form add SECTION_PATH ID SUBMIT_LABEL FIELD... [--script NAME SOURCE] [--submit NAME]',
      'db-table show SECTION_PATH ID TABLE [QUERY]',
    ].join('\n'),
    section: 'hvy section add PARENT_PATH ID TITLE\nAdd a section under /body or under another section.',
    text: 'hvy text add SECTION_PATH ID TEXT\nAppend a text block to a section.',
    table: 'hvy table add SECTION_PATH ID COLUMNS [--row CSV]...\nAppend a table block. Columns and rows use comma-separated text.',
    plugin: 'hvy plugin add SECTION_PATH ID PLUGIN_ID [--config JSON] [--body TEXT]\nAppend a plugin block. Use \\n escapes inside BODY for multiline plugin text.',
    form: 'form add SECTION_PATH ID SUBMIT_LABEL FIELD... [--script NAME SOURCE] [--submit NAME]\nAppend a Form plugin. FIELD uses name:Label:type[:required][:option A|option B].',
    'db-table': 'db-table show SECTION_PATH ID TABLE [QUERY]\nShow a SQLite table/view with an optional SQL query. Alias: db-table add.',
  };
  return help[topic] ?? help[''];
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
    throw new Error('form add: expected SECTION_PATH ID SUBMIT_LABEL FIELD...');
  }
  const scripts = Object.fromEntries(readRepeatedOptionPairs(rest, '--script').map(([name, source]) => [name, decodeCliText(source)]));
  const body = stringifyYaml({
    fields: fieldSpecs.map(parseFormFieldSpec),
    ...(Object.keys(scripts).length > 0 ? { scripts } : {}),
    ...(readOption(rest, '--submit') ? { submitScript: readOption(rest, '--submit') } : {}),
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
