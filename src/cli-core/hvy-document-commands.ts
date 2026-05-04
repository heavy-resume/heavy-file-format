import { stringify as stringifyYaml } from 'yaml';

import { defaultBlockSchema } from '../document-factory';
import type { BlockSchema, GridItem, VisualBlock, VisualSection } from '../editor/types';
import { getComponentDefsFromMeta, isBuiltinComponentName, resolveBaseComponentFromMeta } from '../component-defs';
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
import { formatHvyFindIntent } from './intent-search';
import {
  buildHvyVirtualFileSystem,
  findBlockForVirtualDirectory,
  findBlockInsertionTargetForVirtualDirectory,
  listDirectory,
  resolveVirtualPath,
  type HvyVirtualFileSystem,
} from './virtual-file-system';

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
  if (resource === 'help') {
    return { output: hvyDocumentCommandHelp([action ?? '', ...rest].filter(Boolean).join(' ')), mutated: false };
  }
  if (resource === 'request_structure') {
    return { output: formatHvyRequestStructure(ctx.document, ctx.fs, resolveRequestStructureOptions(ctx, parseRequestStructureArgs([action ?? '', ...rest].filter(Boolean)))), mutated: false };
  }
  if (resource === 'find-intent') {
    return { output: formatHvyFindIntent(ctx.document, ctx.fs, decodeCliText(action ?? ''), parseFindIntentArgs(rest)), mutated: false };
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
  throw new Error('hvy: expected request_structure, find-intent, lint, add, plugin, section add, text add, table add, form add, or db-table show');
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
      formatCommandHelp('hvy add component PARENT_PATH ID COMPONENT [TEXT] [--config JSON]', 'Create a builtin or custom component.'),
      formatCommandHelp('hvy add COMPONENT PARENT_PATH --id ID [TEXT] [--config JSON]', 'Shortcut for builtin/custom component creation.'),
      formatCommandHelp('hvy add text SECTION_PATH ID TEXT', 'Create a text component.'),
      formatCommandHelp('hvy add table SECTION_PATH ID COLUMNS [--row CSV]...', 'Create a table component.'),
      formatCommandHelp('hvy remove PATH [--prune-xref]', 'Remove a section or component directory. Alias: hvy delete PATH.'),
      formatCommandHelp('hvy prune-xref TARGET_ID', 'Remove xref-card components pointing to TARGET_ID.'),
      formatCommandHelp('hvy preview PATH', 'Show the raw HVY preview for a component, capped at 25 lines.'),
      formatCommandHelp('hvy request_structure [COMPONENT_ID] [--collapse] [--describe]', 'Show the component directory map for the current document.'),
      formatCommandHelp('hvy find-intent QUERY [--max N] [--json]', 'Find likely edit locations for an intent.'),
      formatCommandHelp('hvy lint', 'Check the document for likely component issues.'),
      ...formatPluginQuickReference(),
      formatCommandHelp('Edit existing components', 'Use find to discover virtual files, cat to inspect them, and sed to update writable body/config files.'),
    ].join('\n'),
    add: [
      formatCommandHelp('hvy add section PARENT_PATH ID TITLE', 'Create a section under /body or under another section.'),
      formatCommandHelp('hvy add component PARENT_PATH ID COMPONENT [TEXT] [--config JSON]', 'Append a builtin or custom component to a section, component-list, grid, container, or expandable content path.'),
      formatCommandHelp('hvy add COMPONENT PARENT_PATH --id ID [TEXT] [--config JSON]', 'Shortcut where COMPONENT is text, xref-card, skill-record, or another registered component type.'),
      formatCommandHelp('hvy add text SECTION_PATH ID TEXT', 'Create a text component in a section.'),
      formatCommandHelp('hvy add table SECTION_PATH ID COLUMNS [--row CSV]...', 'Create a static table component in a section.'),
      formatCommandHelp('hvy add plugin SECTION_PATH ID PLUGIN_ID [--config JSON] [--body TEXT]', 'Create a raw plugin block by plugin id.'),
    ].join('\n'),
    component: formatCommandHelp('hvy add component PARENT_PATH ID COMPONENT [TEXT] [--config JSON]', 'Append a builtin or custom component to a section, component-list, grid, container, or expandable content path.'),
    section: formatCommandHelp('hvy add section PARENT_PATH ID TITLE', 'Add a section under /body or under another section. Alias: hvy section add.'),
    text: formatCommandHelp('hvy add text SECTION_PATH ID TEXT', 'Append a text block to a section. Alias: hvy text add.'),
    table: formatCommandHelp('hvy add table SECTION_PATH ID COLUMNS [--row CSV]...', 'Append a table block. Columns and rows use comma-separated text. Alias: hvy table add.'),
    request_structure: formatCommandHelp('hvy request_structure [COMPONENT_ID] [--collapse] [--describe]', 'Show the component directory map, optionally scoped to one component id. --collapse compacts anonymous leaf components. --describe includes non-empty descriptions.'),
    'find-intent': formatCommandHelp('hvy find-intent QUERY [--max N] [--json]', 'Search semantic section/component descriptions, ids, paths, roles, and previews for likely edit locations.'),
    preview: formatCommandHelp('hvy preview PATH', 'Show the raw HVY fragment for a component directory or component body file. Output is capped at 25 lines.'),
    lint: formatCommandHelp('hvy lint', 'Check the document for empty text, broken xrefs, empty table rows, and plugin-defined issues.'),
    prune_xref: formatCommandHelp('hvy prune-xref TARGET_ID', 'Remove xref-card components whose xrefTarget equals TARGET_ID.'),
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

function parseRequestStructureArgs(args: string[]): { componentId?: string; collapse?: boolean; describe?: boolean } {
  let componentId = '';
  let collapse = false;
  let describe = false;
  for (const arg of args) {
    if (arg === '--collapse') {
      collapse = true;
      continue;
    }
    if (arg === '--describe') {
      describe = true;
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`hvy request_structure: unsupported option ${arg}`);
    }
    if (componentId) {
      throw new Error('hvy request_structure: expected at most one component id');
    }
    componentId = arg;
  }
  return {
    ...(componentId ? { componentId } : {}),
    ...(collapse ? { collapse } : {}),
    ...(describe ? { describe } : {}),
  };
}

function resolveRequestStructureOptions(
  ctx: HvyDocumentCommandContext,
  options: { componentId?: string; collapse?: boolean; describe?: boolean }
): { componentId?: string; componentPath?: string; collapse?: boolean; describe?: boolean } {
  const ref = options.componentId ?? '';
  if (!ref) {
    return options;
  }
  const resolved = resolveVirtualPath(ctx.fs, ctx.cwd, ref);
  if (ctx.fs.entries.get(resolved)?.kind === 'dir') {
    return {
      ...options,
      componentId: undefined,
      componentPath: resolved,
    };
  }
  if (ctx.fs.entries.get(resolved)?.kind === 'file') {
    return {
      ...options,
      componentId: undefined,
      componentPath: resolved.replace(/\/[^/]+$/, ''),
    };
  }
  return options;
}

function parseFindIntentArgs(args: string[]): { max?: number; json?: boolean } {
  let max: number | undefined;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--max') {
      const value = Number(args[index + 1] ?? '');
      if (!Number.isFinite(value) || value < 1) {
        throw new Error('hvy find-intent: --max must be a positive number');
      }
      max = Math.floor(value);
      index += 1;
      continue;
    }
    if (arg.startsWith('--max=')) {
      const value = Number(arg.slice('--max='.length));
      if (!Number.isFinite(value) || value < 1) {
        throw new Error('hvy find-intent: --max must be a positive number');
      }
      max = Math.floor(value);
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`hvy find-intent: unsupported option ${arg}`);
    }
    throw new Error(`hvy find-intent: unexpected argument ${arg}`);
  }
  return {
    ...(max ? { max } : {}),
    ...(json ? { json } : {}),
  };
}

function executeHvyAddCommand(ctx: HvyDocumentCommandContext, kind = '', args: string[]): HvyDocumentCommandResult {
  if (kind === 'section') {
    return addSection(ctx, args);
  }
  if (kind === 'component') {
    return addComponentBlock(ctx, args);
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
  if (isKnownComponent(ctx.document, kind)) {
    return addComponentShortcut(ctx, kind, args);
  }
  throw new Error('hvy add: expected section, component, text, table, plugin, or a registered component name');
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
  return { output: formatCreatedComponentDirectory(ctx.document, `${sectionPath.replace(/\/$/, '')}/${id}`), mutated: true };
}

function addTableBlock(ctx: HvyDocumentCommandContext, args: string[]): HvyDocumentCommandResult {
  const [sectionPath = '', id = '', columns = '', ...rest] = args;
  const section = requireSection(ctx, sectionPath, 'hvy table add');
  const rows = readRepeatedOption(rest, '--row').map((row) => ({ cells: splitCsvText(decodeCliText(row)) }));
  const schema = createSchema('table', id);
  schema.tableColumns = decodeCliText(columns);
  schema.tableRows = rows;
  section.blocks.push(createBlockFromSchema(schema, ''));
  return { output: formatCreatedComponentDirectory(ctx.document, `${sectionPath.replace(/\/$/, '')}/${id}`), mutated: true };
}

function addComponentShortcut(ctx: HvyDocumentCommandContext, component: string, args: string[]): HvyDocumentCommandResult {
  const [parentPath = '', ...rest] = args;
  const id = readOption(rest, '--id') ?? readOption(rest, '--name') ?? '';
  const text = rest.find((arg, index) => !isOptionArg(arg) && !isOptionValue(rest, index)) ?? '';
  const config = readOption(rest, '--config');
  return addComponentToPath(ctx, {
    parentPath,
    id,
    component,
    text,
    config: config ? parseJsonObject(config, 'hvy add COMPONENT --config') : {},
    commandName: `hvy add ${component}`,
  });
}

function addComponentBlock(ctx: HvyDocumentCommandContext, args: string[]): HvyDocumentCommandResult {
  const [parentPath = '', id = '', component = '', text = '', ...rest] = args;
  const config = readOption(rest, '--config');
  return addComponentToPath(ctx, {
    parentPath,
    id,
    component,
    text,
    config: config ? parseJsonObject(config, 'hvy add component --config') : {},
    commandName: 'hvy add component',
  });
}

function addComponentToPath(ctx: HvyDocumentCommandContext, params: {
  parentPath: string;
  id: string;
  component: string;
  text: string;
  config: JsonObject;
  commandName: string;
}): HvyDocumentCommandResult {
  if (!params.parentPath || !params.id || !params.component) {
    throw new Error(`${params.commandName}: expected PARENT_PATH ID COMPONENT`);
  }
  if (!isKnownComponent(ctx.document, params.component)) {
    throw new Error(`${params.commandName}: unknown component "${params.component}"`);
  }
  const resolvedParentPath = resolveVirtualPath(ctx.fs, ctx.cwd, params.parentPath);
  const block = createCliComponentBlock(ctx.document, params.component, params.id, decodeCliText(params.text), params.config);
  const target = findBlockInsertionTargetForVirtualDirectory(ctx.document, resolvedParentPath)
    ?? findDirectBlockInsertionTarget(ctx, resolvedParentPath);
  if (!target) {
    throw new Error(`${params.commandName}: no component insertion target: ${params.parentPath}`);
  }
  target.insert(block);
  return { output: formatCreatedComponentDirectory(ctx.document, `${resolvedParentPath.replace(/\/$/, '')}/${params.id}`), mutated: true };
}

function findDirectBlockInsertionTarget(
  ctx: HvyDocumentCommandContext,
  resolvedParentPath: string
): { insert: (block: VisualBlock) => void } | null {
  const parentBlock = findBlockForVirtualDirectory(ctx.document, resolvedParentPath);
  if (!parentBlock) {
    return null;
  }
  const baseComponent = resolveBaseComponentFromMeta(parentBlock.schema.component, ctx.document.meta);
  if (baseComponent === 'component-list') {
    return { insert: (block) => parentBlock.schema.componentListBlocks.push(block) };
  }
  if (baseComponent === 'container') {
    return { insert: (block) => parentBlock.schema.containerBlocks.push(block) };
  }
  if (baseComponent === 'expandable') {
    return { insert: (block) => parentBlock.schema.expandableContentBlocks.children.push(block) };
  }
  if (baseComponent === 'grid') {
    return { insert: (block) => parentBlock.schema.gridItems.push(createCliGridItem(block)) };
  }
  return null;
}

function createCliGridItem(block: VisualBlock): GridItem {
  return { id: makeId('griditem'), block };
}

function formatCreatedComponentDirectory(document: VisualDocument, componentPath: string): string {
  const fs = buildHvyVirtualFileSystem(document);
  const normalizedComponentPath = fs.entries.has(componentPath)
    ? componentPath
    : componentPath.startsWith('/body/')
    ? componentPath
    : `/body${componentPath.startsWith('/') ? componentPath : `/${componentPath}`}`;
  const entry = fs.entries.get(normalizedComponentPath);
  if (!entry || entry.kind !== 'dir') {
    return componentPath;
  }
  const children = listDirectory(fs, normalizedComponentPath)
    .map((child) => `${child.kind === 'dir' ? 'dir ' : 'file'} ${child.path.split('/').pop() ?? child.path}`)
    .join('\n');
  return [
    `${normalizedComponentPath}: created`,
    ...(children ? ['files:', children] : []),
  ].join('\n');
}

function addPluginBlock(ctx: HvyDocumentCommandContext, args: string[]): HvyDocumentCommandResult {
  const [sectionPath = '', id = '', plugin = '', ...rest] = args;
  const section = requireSection(ctx, sectionPath, 'hvy plugin add');
  if (!plugin) {
    throw new Error('hvy plugin add: expected SECTION_PATH ID PLUGIN_ID');
  }
  const config = readOption(rest, '--config');
  section.blocks.push(createPluginBlock(id, plugin, config ? parseJsonObject(config, 'hvy plugin add --config') : {}, decodeCliText(readOption(rest, '--body') ?? '')));
  return { output: formatCreatedComponentDirectory(ctx.document, `${sectionPath.replace(/\/$/, '')}/${id}`), mutated: true };
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
  return { output: formatCreatedComponentDirectory(ctx.document, `${sectionPath.replace(/\/$/, '')}/${id}`), mutated: true };
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
  return { output: formatCreatedComponentDirectory(ctx.document, `${sectionPath.replace(/\/$/, '')}/${id}`), mutated: true };
}

function findSectionParent(ctx: HvyDocumentCommandContext, path: string): VisualSection | null {
  const resolved = resolveVirtualPath(ctx.fs, ctx.cwd, path);
  if (resolved === '/' || resolved === '/body') {
    return null;
  }
  const section = findSectionByResolvedPath(ctx.document.sections, resolved);
  if (section) {
    return section;
  }
  const componentPath = findNearestComponentPath(ctx, resolved);
  if (componentPath) {
    throw new Error(
      `hvy section add: sections must be added at the root level or on top of an existing section. ${path} is a component, not a section.`
    );
  }
  return requireSection(ctx, path, 'hvy section add');
}

function requireSection(ctx: HvyDocumentCommandContext, path: string, command: string): VisualSection {
  const resolved = resolveVirtualPath(ctx.fs, ctx.cwd, path);
  const section = findSectionByResolvedPath(ctx.document.sections, resolved);
  if (!section) {
    throw new Error(`${command}: no such section: ${path}`);
  }
  return section;
}

function findSectionByResolvedPath(sections: VisualSection[], resolvedPath: string): VisualSection | null {
  return findSectionById(sections, resolvedPath.split('/').filter(Boolean).pop() ?? '');
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

function findNearestComponentPath(ctx: HvyDocumentCommandContext, resolvedPath: string): string {
  let candidate = resolvedPath;
  while (candidate !== '/' && candidate !== '/body') {
    if (findBlockForVirtualDirectory(ctx.document, candidate)) {
      return candidate;
    }
    candidate = candidate.split('/').slice(0, -1).join('/') || '/';
  }
  return '';
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
    css: '',
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

function createCliComponentBlock(document: VisualDocument, component: string, id: string, text: string, config: JsonObject): VisualBlock {
  const definition = getComponentDefsFromMeta(document.meta).find((item) => item.name === component);
  const block = definition?.template
    ? cloneCliVisualBlock(definition.template)
    : createBlockFromSchema(createCliComponentSchema(document, component), '');
  block.schema.component = component;
  block.schema.id = id;
  applyCliBlockConfig(block.schema, config);
  applyCliComponentText(block, text, document.meta);
  return block;
}

function createCliComponentSchema(document: VisualDocument, component: string): BlockSchema {
  const definition = getComponentDefsFromMeta(document.meta).find((item) => item.name === component);
  if (definition?.schema) {
    return cloneCliBlockSchema(definition.schema, component);
  }
  const baseComponent = resolveBaseComponentFromMeta(component, document.meta);
  return {
    ...defaultBlockSchema(baseComponent),
    component,
  };
}

function createBlockFromSchema(schema: BlockSchema, text: string): VisualBlock {
  return {
    id: makeId('block'),
    text,
    schema,
    schemaMode: false,
  };
}

function cloneCliVisualBlock(block: VisualBlock): VisualBlock {
  const schema = block.schema ?? defaultBlockSchema('text');
  return {
    id: makeId('block'),
    text: block.text ?? '',
    schema: cloneCliBlockSchema(schema, schema.component || 'text'),
    schemaMode: false,
  };
}

function cloneCliBlockSchema(schema: BlockSchema, componentName = schema.component): BlockSchema {
  const raw = JSON.parse(JSON.stringify(schema)) as Partial<BlockSchema>;
  const cloned = {
    ...defaultBlockSchema(raw.component || componentName || 'text'),
    ...raw,
  } as BlockSchema;
  cloned.component = componentName;
  cloned.id = cloned.id ?? '';
  cloned.containerBlocks = (cloned.containerBlocks ?? []).filter(isVisualBlockLike).map(cloneCliVisualBlock);
  cloned.componentListBlocks = (cloned.componentListBlocks ?? []).filter(isVisualBlockLike).map(cloneCliVisualBlock);
  cloned.gridItems = (cloned.gridItems ?? []).map((item) => ({
    ...item,
    id: item.id || makeId('griditem'),
    block: item.block && isVisualBlockLike(item.block) ? cloneCliVisualBlock(item.block) : createBlockFromSchema(defaultBlockSchema('text'), ''),
  }));
  cloned.expandableStubBlocks = {
    lock: cloned.expandableStubBlocks?.lock ?? false,
    children: (cloned.expandableStubBlocks?.children ?? []).filter(isVisualBlockLike).map(cloneCliVisualBlock),
  };
  cloned.expandableContentBlocks = {
    lock: cloned.expandableContentBlocks?.lock ?? false,
    children: (cloned.expandableContentBlocks?.children ?? []).filter(isVisualBlockLike).map(cloneCliVisualBlock),
  };
  return cloned;
}

function isVisualBlockLike(value: unknown): value is VisualBlock {
  return !!value && typeof value === 'object' && 'schema' in value;
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

function applyCliComponentText(block: VisualBlock, text: string, meta: Record<string, unknown>): void {
  if (!text) {
    return;
  }
  const baseComponent = resolveBaseComponentFromMeta(block.schema.component, meta);
  if (baseComponent === 'expandable') {
    const firstStub = block.schema.expandableStubBlocks.children[0];
    if (firstStub) {
      firstStub.text = text;
      return;
    }
    block.schema.expandableStub = text;
    return;
  }
  if (baseComponent === 'xref-card') {
    block.schema.xrefTitle = text;
    return;
  }
  block.text = text;
}

function applyCliBlockConfig(schema: BlockSchema, config: JsonObject): void {
  for (const [key, value] of Object.entries(config)) {
    if (key === 'css' && typeof value === 'string') {
      schema.css = value;
      continue;
    }
    if (key === 'lock' && typeof value === 'boolean') {
      schema.lock = value;
      continue;
    }
    if (key in schema) {
      (schema as unknown as Record<string, unknown>)[key] = value;
    }
  }
}

function isKnownComponent(document: VisualDocument, component: string): boolean {
  return isBuiltinComponentName(component) || getComponentDefsFromMeta(document.meta).some((item) => item.name === component);
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
