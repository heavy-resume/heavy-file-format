import { defaultBlockSchema, schemaFromUnknown } from '../document-factory';
import type { BlockSchema, GridItem, VisualBlock, VisualSection } from '../editor/types';
import { getComponentDefsFromMeta, isBuiltinComponentName, resolveBaseComponentFromMeta } from '../component-defs';
import type { JsonObject } from '../hvy/types';
import { DB_TABLE_PLUGIN_ID, FORM_PLUGIN_ID } from '../plugins/registry';
import { getSectionId } from '../section-ops';
import type { VisualDocument } from '../types';
import { makeId } from '../utils';
import {
  applyReusableTemplateValues,
  extractReusableTemplateVariablesFromDefinition,
  formatTemplateKeys,
  parseReusableTemplateJson,
  validateReusableTemplateValues,
} from '../reusable-template-values';
import {
  getHvyCliPluginCommandRegistration,
  getHvyCliPluginCommandRegistrations,
  getHvyCliScriptingToolHelp,
  getHvyCliScriptingToolNames,
  type HvyCliHelpCommand,
} from './plugin-command-registry';
import {
  formatHvyCheatsheetList,
  formatHvyRecipeList,
  getHvyCheatsheet,
  getHvyCheatsheetNames,
  getHvyRecipe,
  getHvyRecipeNames,
} from './reference-library';
import { formatHvyRequestStructure, formatHvyRequestStructureForDirectory } from './request-structure';
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
  cwd?: string;
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
  if (resource === 'cheatsheet') {
    return { output: formatCheatsheet(action ?? ''), mutated: false };
  }
  if (resource === 'recipe') {
    return { output: formatRecipe(action ?? ''), mutated: false };
  }
  if (resource === 'insert') {
    return executeHvyInsertCommand(ctx, action, rest[0] ?? '', rest.slice(1));
  }
  if (resource === 'plugin' && action === 'scripting' && rest[0] === 'tool') {
    return { output: formatScriptingToolHelp(rest[1] ?? ''), mutated: false };
  }
  if (resource === 'plugin' && action && rest.length === 0 && getHvyCliPluginCommandRegistration(action)) {
    return { output: hvyDocumentCommandHelp(`plugin ${action}`), mutated: false };
  }
  throw new Error('hvy: expected request_structure, find-intent, cheatsheet, recipe, lint, insert, plugin, remove, prune-xref, preview, or help');
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
      formatCommandHelp('hvy insert INDEX COMPONENT PARENT_PATH [ID|--id ID] [--using-template JSON] [--return-order-on-creation] [--return-structure-on-creation] [--return-about-txt-on-creation]', 'Insert a blank builtin or custom component. Reusable components with template variables require exact JSON values with --using-template. Component ids are optional; use --id only when you need a stable id. INDEX is zero-based and supports Python-style negative indexes; 0 is the front, -1 is the back.'),
      formatCommandHelp('hvy insert INDEX section PARENT_PATH ID TITLE', 'Create a section.'),
      formatCommandHelp('hvy insert INDEX text PARENT_PATH [ID|--id ID]', 'Create a blank text component. Edit text.txt after creation.'),
      formatCommandHelp('hvy insert INDEX table PARENT_PATH [ID|--id ID]', 'Create a blank static table component. Edit tableColumns.json and tableRows.json after creation.'),
      formatCommandHelp('hvy remove PATH [--prune-xref]', 'Remove a section or component directory. Alias: hvy delete PATH.'),
      formatCommandHelp('hvy prune-xref TARGET_ID', 'Remove xref-card components pointing to TARGET_ID.'),
      formatCommandHelp('hvy preview PATH', 'Show the raw HVY preview for a component, capped at 100 lines.'),
      formatCommandHelp('hvy request_structure [COMPONENT_ID] [--collapse] [--describe]', 'Show the component directory map for the current document.'),
      formatCommandHelp('hvy find-intent QUERY [--max N] [--json]', 'Find likely edit locations for an intent.'),
      formatCommandHelp('hvy cheatsheet [NAME]', 'List or show concise command examples from file-backed cheatsheets.'),
      formatCommandHelp('hvy recipe [NAME]', 'List or show file-backed HVY recipes for composed document patterns.'),
      formatCommandHelp('hvy lint [--fix]', 'Check the document for likely component issues. --fix repairs safe structural issues such as plugin id aliases.'),
      formatHvyCheatsheetList(),
      formatHvyRecipeList(),
      ...formatPluginQuickReference(),
      formatCommandHelp('Edit existing components', 'Use find to discover virtual files, cat to inspect them, and sed to update writable body/config files.'),
    ].join('\n'),
    insert: [
      formatCommandHelp('hvy insert INDEX COMPONENT PARENT_PATH [ID|--id ID] [--using-template JSON] [--return-order-on-creation] [--return-structure-on-creation] [--return-about-txt-on-creation]', 'Insert a blank builtin or custom component to a section, component-list, grid, container, or expandable content path. Reusable components with template variables require --using-template with exact JSON keys. Edit generated body/config files after creation. Component ids are optional; use --id only when you need a stable id. INDEX is zero-based and supports Python-style negative indexes; 0 is the front, -1 is the back.'),
      formatCommandHelp('hvy insert INDEX section PARENT_PATH ID TITLE', 'Add a section under /body or under another section.'),
      formatCommandHelp('hvy insert INDEX text PARENT_PATH [ID|--id ID]', 'Insert a blank text block.'),
      formatCommandHelp('hvy insert INDEX table PARENT_PATH [ID|--id ID]', 'Insert a blank static table block.'),
      formatCommandHelp('hvy insert INDEX plugin SECTION_PATH ID PLUGIN_ID', 'Insert a blank raw plugin block by canonical plugin id, such as dev.heavy.form or dev.heavy.db-table.'),
      '',
      'Examples:',
      '  hvy insert 0 section /body a-section "A Section"',
      '  cd /a-section',
      '  hvy insert 0 text . intro',
      '  hvy insert -1 container . a-container',
      '  hvy insert 0 container a-container nested-container',
      '  hvy insert -1 component-list . a-list',
      '  hvy insert -1 grid . a-grid',
      '  hvy insert -2 table . a-table',
    ].join('\n'),
    component: [
      formatCommandHelp('hvy insert INDEX COMPONENT PARENT_PATH [ID|--id ID] [--using-template JSON] [--return-order-on-creation] [--return-structure-on-creation] [--return-about-txt-on-creation]', 'Insert a blank builtin or custom component to a section, component-list, grid, container, or expandable content path. Reusable components with template variables require --using-template with exact JSON keys. Edit generated body/config files after creation. Component ids are optional; use --id only when you need a stable id. INDEX is zero-based and supports Python-style negative indexes; 0 is the front, -1 is the back.'),
    ].join('\n'),
    section: formatCommandHelp('hvy insert INDEX section PARENT_PATH ID TITLE', 'Add a section under /body or under another section. INDEX is zero-based and supports Python-style negative indexes; 0 is the front, -1 is the back.'),
    text: formatCommandHelp('hvy insert INDEX text PARENT_PATH [ID|--id ID]', 'Insert a blank text block. Edit text.txt after creation. INDEX is zero-based and supports Python-style negative indexes; 0 is the front, -1 is the back.'),
    table: formatCommandHelp('hvy insert INDEX table PARENT_PATH [ID|--id ID]', 'Insert a blank static table block. Edit tableColumns.json and tableRows.json after creation. INDEX is zero-based and supports Python-style negative indexes; 0 is the front, -1 is the back.'),
    request_structure: formatCommandHelp('hvy request_structure [COMPONENT_ID] [--collapse] [--describe]', 'Show the component directory map, optionally scoped to one component id. --collapse compacts anonymous leaf components. --describe includes non-empty descriptions.'),
    'find-intent': formatCommandHelp('hvy find-intent QUERY [--max N] [--json]', 'Search semantic section/component descriptions, ids, paths, roles, and previews for likely edit locations.'),
    cheatsheet: [
      formatCommandHelp('hvy cheatsheet [NAME]', 'List available cheatsheets or show one by name. Cheatsheets are discovered from src/cli-core/cheatsheets/*.md.'),
      formatHvyCheatsheetList(),
    ].join('\n'),
    recipe: [
      formatCommandHelp('hvy recipe [NAME]', 'List available recipes or show one by name. Recipes are discovered from src/cli-core/recipes/*.hvy.'),
      formatHvyRecipeList(),
    ].join('\n'),
    preview: formatCommandHelp('hvy preview PATH', 'Show the raw HVY fragment for a component directory or component body file. Output is capped at 100 lines.'),
    lint: formatCommandHelp('hvy lint [--fix]', 'Check the document for broken xrefs, empty table rows, and plugin-defined issues. --fix repairs safe structural issues such as plugin id aliases.'),
    prune_xref: formatCommandHelp('hvy prune-xref TARGET_ID', 'Remove xref-card components whose xrefTarget equals TARGET_ID.'),
    plugin: [
      ...formatPluginQuickReference(),
      ...getHvyCliPluginCommandRegistrations().map((plugin) => formatCommandHelp(plugin.helpTopic, `Show ${plugin.name} plugin commands.`)),
      formatCommandHelp('hvy insert INDEX plugin SECTION_PATH ID PLUGIN_ID', 'Create a blank raw plugin block by canonical plugin id, such as dev.heavy.form or dev.heavy.db-table. INDEX is zero-based and supports Python-style negative indexes; 0 is the front, -1 is the back.'),
    ].join('\n'),
    form: hvyDocumentCommandHelp('plugin form'),
    'db-table': hvyDocumentCommandHelp('plugin db-table'),
  };
  return help[normalizedTopic] ?? help[''];
}

function formatCheatsheet(name: string): string {
  if (!name.trim()) {
    return formatHvyCheatsheetList();
  }
  const content = getHvyCheatsheet(name);
  if (!content) {
    return `Unknown cheatsheet "${name}". Available cheatsheets: ${getHvyCheatsheetNames().join(', ') || '(none)'}`;
  }
  return content;
}

function formatRecipe(name: string): string {
  if (!name.trim()) {
    return formatHvyRecipeList();
  }
  const content = getHvyRecipe(name);
  if (!content) {
    return `Unknown recipe "${name}". Available recipes: ${getHvyRecipeNames().join(', ') || '(none)'}`;
  }
  return content;
}

function formatCommandHelp(command: string, description: string): string {
  return `${command}\n  ${description}`;
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

type HvyInsertIndex = number;

function executeHvyInsertCommand(ctx: HvyDocumentCommandContext, indexArg = '', kind = '', args: string[]): HvyDocumentCommandResult {
  const index = parseInsertIndex(indexArg);
  if (kind === 'section') {
    return addSection(ctx, args, index);
  }
  if (kind === 'text') {
    return addComponentShortcut(ctx, kind, args, index);
  }
  if (kind === 'table') {
    return addComponentShortcut(ctx, kind, args, index);
  }
  if (kind === 'plugin') {
    const [pluginKind = '', ...rest] = args;
    if (pluginKind === 'form') {
      return addFormPluginBlock(ctx, rest, index);
    }
    if (pluginKind === 'db-table') {
      return addDbTablePluginBlock(ctx, rest, index);
    }
    return addPluginBlock(ctx, args, index);
  }
  if (isKnownComponent(ctx.document, kind)) {
    return addComponentShortcut(ctx, kind, args, index);
  }
  throw new Error('hvy insert: expected INDEX section, text, table, plugin, or a registered component name');
}

function parseInsertIndex(indexArg: string): HvyInsertIndex {
  if (!/^-?\d+$/.test(indexArg)) {
    throw new Error('hvy insert: expected INDEX as the first argument. Use 0 for the front or Python-style negative indexes such as -1 for the back.');
  }
  return Number(indexArg);
}

function addSection(ctx: HvyDocumentCommandContext, args: string[], index: HvyInsertIndex = -1): HvyDocumentCommandResult {
  const [parentPath = '', id = '', title = ''] = args;
  if (!parentPath || !id || !title) {
    throw new Error('hvy insert section: expected PARENT_PATH ID TITLE');
  }
  const parent = findSectionParent(ctx, parentPath);
  const section = createSection(id, decodeCliText(title), parent ? parent.level + 1 : 1);
  if (parent) {
    insertChild(parent.children, section, index);
  } else {
    insertChild(ctx.document.sections, section, index);
  }
  const resolvedParentPath = resolveVirtualPath(ctx.fs, ctx.cwd, parentPath);
  const path = resolvedParentPath === '/' || resolvedParentPath === '/body'
    ? `/body/${id}`
    : `${resolvedParentPath.replace(/\/$/, '')}/${id}`;
  return { output: path, mutated: true, cwd: path };
}

function addComponentShortcut(ctx: HvyDocumentCommandContext, component: string, args: string[], index: HvyInsertIndex = -1): HvyDocumentCommandResult {
  const [parentPath = '', ...rest] = args;
  const returnAboutTxtOnCreation = rest.includes('--return-about-txt-on-creation');
  const returnOrderOnCreation = rest.includes('--return-order-on-creation');
  const returnStructureOnCreation = rest.includes('--return-structure-on-creation');
  const usingTemplateRaw = readOption(rest, '--using-template');
  const optionRest = rest.filter((arg, argIndex) => ![
    '--return-about-txt-on-creation',
    '--return-order-on-creation',
    '--return-structure-on-creation',
  ].includes(arg) && arg !== '--using-template' && rest[argIndex - 1] !== '--using-template');
  if (readOption(optionRest, '--config') !== null) {
    throw new Error(`hvy insert ${component}: creation does not accept --config; create the component, inspect it, then edit the generated *.json files.`);
  }
  if (optionRest.includes('--name')) {
    throw new Error(`hvy insert ${component}: use --id ID, not --name.`);
  }
  if (rest.includes('--using-template') && usingTemplateRaw === '') {
    throw new Error(`hvy insert ${component}: --using-template requires a JSON object.`);
  }
  const unsupportedOption = optionRest.find((arg) => isOptionArg(arg) && arg !== '--id');
  if (unsupportedOption) {
    throw new Error(`hvy insert ${component}: unsupported option ${unsupportedOption}; create it blank, then edit generated body/config files.`);
  }
  if (optionRest.includes('--id') && !readOption(optionRest, '--id')) {
    throw new Error(`hvy insert ${component}: --id requires a value.`);
  }
  const explicitId = readOption(optionRest, '--id') ?? '';
  const positionals = optionRest.filter((arg, index) => !isOptionArg(arg) && !isOptionValue(optionRest, index));
  if (explicitId && positionals.length > 0) {
    throw new Error(`hvy insert ${component}: creation accepts either positional ID or --id ID, not both.`);
  }
  if (positionals.length > 1) {
    throw new Error(`hvy insert ${component}: creation does not accept inline content; create it blank, then edit generated body/config files.`);
  }
  return addComponentToPath(ctx, {
    parentPath,
    id: explicitId || positionals[0] || '',
    component,
    commandName: `hvy insert ${index} ${component}`,
    index,
    returnAboutTxtOnCreation,
    returnOrderOnCreation,
    returnStructureOnCreation,
    templateValues: usingTemplateRaw === null ? null : parseReusableTemplateJson(usingTemplateRaw),
  });
}

function addComponentToPath(ctx: HvyDocumentCommandContext, params: {
  parentPath: string;
  id: string;
  component: string;
  commandName: string;
  index?: HvyInsertIndex;
  returnAboutTxtOnCreation?: boolean;
  returnOrderOnCreation?: boolean;
  returnStructureOnCreation?: boolean;
  templateValues?: Record<string, string> | null;
}): HvyDocumentCommandResult {
  if (!params.parentPath || !params.component) {
    throw new Error(`${params.commandName}: expected PARENT_PATH [ID|--id ID]`);
  }
  if (!isKnownComponent(ctx.document, params.component)) {
    throw new Error(`${params.commandName}: unknown component "${params.component}"`);
  }
  const resolvedParentPath = resolveVirtualPath(ctx.fs, ctx.cwd, params.parentPath);
  const id = params.id || generateStableCliComponentId(ctx.fs, resolvedParentPath, params.component);
  const block = createCliComponentBlock(ctx.document, params.component, id, params.templateValues ?? null);
  const parentBlock = findBlockForVirtualDirectory(ctx.document, resolvedParentPath);
  const target = findBlockInsertionTargetForVirtualDirectory(ctx.document, resolvedParentPath)
    ?? findDirectBlockInsertionTarget(ctx, resolvedParentPath);
  if (!target) {
    throw new Error(`${params.commandName}: no component insertion target: ${params.parentPath}`);
  }
  target.insert(block, params.index ?? -1);
  const path = `${resolvedParentPath.replace(/\/$/, '')}/${id}`;
  return {
    output: formatCreatedComponentDirectory(ctx.document, path, resolvedParentPath, parentBlock, target.kind, {
      returnAboutTxtOnCreation: params.returnAboutTxtOnCreation,
      returnOrderOnCreation: params.returnOrderOnCreation,
      returnStructureOnCreation: params.returnStructureOnCreation,
    }),
    mutated: true,
    cwd: path,
  };
}

function generateStableCliComponentId(fs: HvyVirtualFileSystem, resolvedParentPath: string, component: string): string {
  const base = sanitizeCliIdSegment(component) || 'component';
  const parentPath = resolvedParentPath.replace(/\/$/, '');
  for (let index = 1; index < 10000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!fs.entries.has(`${parentPath}/${candidate}`)) {
      return candidate;
    }
  }
  return `${base}-${Date.now()}`;
}

function sanitizeCliIdSegment(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-');
}

function findDirectBlockInsertionTarget(
  ctx: HvyDocumentCommandContext,
  resolvedParentPath: string
): { kind: 'blocks' | 'grid'; insert: (block: VisualBlock, index?: HvyInsertIndex) => void } | null {
  const parentBlock = findBlockForVirtualDirectory(ctx.document, resolvedParentPath);
  if (!parentBlock) {
    return null;
  }
  const baseComponent = resolveBaseComponentFromMeta(parentBlock.schema.component, ctx.document.meta);
  if (baseComponent === 'component-list') {
    return { kind: 'blocks', insert: (block, index = -1) => insertChild(parentBlock.schema.componentListBlocks, block, index) };
  }
  if (baseComponent === 'container') {
    return { kind: 'blocks', insert: (block, index = -1) => insertChild(parentBlock.schema.containerBlocks, block, index) };
  }
  if (baseComponent === 'expandable') {
    return { kind: 'blocks', insert: (block, index = -1) => insertChild(parentBlock.schema.expandableContentBlocks.children, block, index) };
  }
  if (baseComponent === 'grid') {
    return { kind: 'grid', insert: (block, index = -1) => insertChild(parentBlock.schema.gridItems, createCliGridItem(block), index) };
  }
  return null;
}

function insertChild<T>(children: T[], child: T, index: HvyInsertIndex): void {
  const resolvedIndex = resolveInsertIndex(index, children.length);
  children.splice(resolvedIndex, 0, child);
}

function resolveInsertIndex(index: HvyInsertIndex, childCount: number): number {
  const resolvedIndex = index < 0 ? childCount + index + 1 : index;
  if (resolvedIndex < 0 || resolvedIndex > childCount) {
    throw new Error(`hvy insert: index ${index} is out of range for ${childCount} children. Use 0 for the front or Python-style negative indexes such as -1 for the back.`);
  }
  return resolvedIndex;
}

function createCliGridItem(block: VisualBlock): GridItem {
  return { id: makeId('griditem'), block };
}

function formatCreatedComponentDirectory(
  document: VisualDocument,
  componentPath: string,
  parentPath = '',
  parentBlock: VisualBlock | null = null,
  insertionKind?: 'blocks' | 'grid',
  options: {
    returnAboutTxtOnCreation?: boolean;
    returnOrderOnCreation?: boolean;
    returnStructureOnCreation?: boolean;
  } = {}
): string {
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
  const component = findBlockForVirtualDirectory(document, normalizedComponentPath);
  const componentName = component?.schema.component ?? '';
  const structureDisplay = componentName && options.returnStructureOnCreation
    ? formatCreatedComponentStructureDisplay(document, fs, normalizedComponentPath)
    : '';
  const aboutFileDisplay = componentName && !isBuiltinComponentName(componentName)
    ? formatCreatedCustomComponentAboutDisplay(fs, normalizedComponentPath, componentName, !!options.returnAboutTxtOnCreation)
    : '';
  const orderGuide = options.returnOrderOnCreation
    ? formatCreatedChildOrderGuide(document, parentPath, parentBlock, insertionKind)
    : '';
  return [
    `${normalizedComponentPath}: created`,
    ...(children ? ['files:', children] : []),
    ...(orderGuide ? ['', orderGuide] : []),
    ...(structureDisplay ? ['', structureDisplay] : []),
    ...(aboutFileDisplay ? ['', aboutFileDisplay] : []),
  ].join('\n');
}

function formatCreatedChildOrderGuide(
  document: VisualDocument,
  parentPath: string,
  parentBlock: VisualBlock | null,
  insertionKind?: 'blocks' | 'grid'
): string {
  if (!parentPath || (!parentBlock && insertionKind !== 'grid')) {
    return '';
  }
  const baseComponent = parentBlock ? resolveBaseComponentFromMeta(parentBlock.schema.component, document.meta) : '';
  if (insertionKind !== 'grid' && !['component-list', 'container'].includes(baseComponent)) {
    return '';
  }
  const orderPath = `${parentPath}/children-order.json`;
  const itemName = baseComponent === 'component-list' ? 'list item' : insertionKind === 'grid' ? 'grid item' : 'child';
  return [
    'order:',
    `  children-order.json controls ${itemName} order.`,
    `  Inspect or edit ${orderPath} when placement matters.`,
    `  Example: cat ${orderPath}`,
  ].join('\n');
}

function formatCreatedCustomComponentAboutDisplay(
  fs: HvyVirtualFileSystem,
  componentPath: string,
  componentName: string,
  returnAboutTxtOnCreation: boolean
): string {
  const aboutPath = `${componentPath}/about-${componentName}.txt`;
  const aboutFile = fs.entries.get(aboutPath);
  if (!aboutFile || aboutFile.kind !== 'file') {
    return '';
  }
  if (!returnAboutTxtOnCreation) {
    return '';
  }
  return [
    '### CREATED CUSTOM COMPONENT ###',
    `Successfully created custom component ${componentName}.`,
    `Use about-${componentName}.txt to inspect this reusable component guidance again.`,
    '### END CREATED CUSTOM COMPONENT ###',
    '### ABOUT CUSTOM COMPONENT ###',
    aboutFile.read().trimEnd(),
    '### END ABOUT CUSTOM COMPONENT ###',
  ].join('\n');
}

function formatCreatedComponentStructureDisplay(document: VisualDocument, fs: HvyVirtualFileSystem, componentPath: string): string {
  return [
    '### CREATED COMPONENT STRUCTURE ###',
    formatHvyRequestStructureForDirectory(document, fs, componentPath, { describe: true }),
    '### END CREATED COMPONENT STRUCTURE ###',
  ].join('\n');
}

function addPluginBlock(ctx: HvyDocumentCommandContext, args: string[], index: HvyInsertIndex = -1): HvyDocumentCommandResult {
  const [sectionPath = '', id = '', plugin = '', ...rest] = args;
  const section = requireSection(ctx, sectionPath, 'hvy plugin add');
  if (!plugin) {
    throw new Error('hvy plugin add: expected SECTION_PATH ID PLUGIN_ID');
  }
  if (rest.length > 0) {
    throw new Error('hvy plugin add: creation does not accept inline config or body; create it blank, then edit plugin.json and plugin.txt.');
  }
  const aliasError = formatRawPluginAliasError(plugin);
  if (aliasError) {
    throw new Error(aliasError);
  }
  insertChild(section.blocks, createPluginBlock(id, plugin, {}, ''), index);
  const path = `${resolveVirtualPath(ctx.fs, ctx.cwd, sectionPath).replace(/\/$/, '')}/${id}`;
  return { output: formatCreatedComponentDirectory(ctx.document, path, resolveVirtualPath(ctx.fs, ctx.cwd, sectionPath), null, 'blocks'), mutated: true, cwd: path };
}

function formatRawPluginAliasError(plugin: string): string {
  if (plugin === 'form') {
    return 'hvy plugin add: "form" is a CLI command alias, not a stored plugin id. Use "hvy insert INDEX plugin form SECTION_PATH ID" or plugin id "dev.heavy.form".';
  }
  if (plugin === 'db-table') {
    return 'hvy plugin add: "db-table" is a CLI command alias, not a stored plugin id. Use "hvy insert INDEX plugin db-table SECTION_PATH ID" or plugin id "dev.heavy.db-table".';
  }
  if (plugin === 'scripting') {
    return 'hvy plugin add: "scripting" is a CLI command alias, not a stored plugin id. Use plugin id "dev.heavy.scripting".';
  }
  return '';
}

function addFormPluginBlock(ctx: HvyDocumentCommandContext, args: string[], index: HvyInsertIndex = -1): HvyDocumentCommandResult {
  const [sectionPath = '', id = '', ...rest] = args;
  const section = requireSection(ctx, sectionPath, 'hvy insert plugin form');
  if (!id) {
    throw new Error('hvy insert plugin form: expected SECTION_PATH ID');
  }
  if (rest.length > 0) {
    throw new Error('hvy insert plugin form: creation does not accept fields, scripts, or submit settings; create it blank, then edit plugin.txt and plugin.json.');
  }
  insertChild(section.blocks, createPluginBlock(id, FORM_PLUGIN_ID, {
    version: '0.1',
    showSubmit: false,
  }, 'fields: []'), index);
  const path = `${resolveVirtualPath(ctx.fs, ctx.cwd, sectionPath).replace(/\/$/, '')}/${id}`;
  return { output: formatCreatedComponentDirectory(ctx.document, path, resolveVirtualPath(ctx.fs, ctx.cwd, sectionPath), null, 'blocks'), mutated: true, cwd: path };
}

function addDbTablePluginBlock(ctx: HvyDocumentCommandContext, args: string[], index: HvyInsertIndex = -1): HvyDocumentCommandResult {
  const [sectionPath = '', id = '', ...rest] = args;
  const section = requireSection(ctx, sectionPath, 'hvy insert plugin db-table');
  if (!id) {
    throw new Error('hvy insert plugin db-table: expected SECTION_PATH ID');
  }
  if (rest.length > 0) {
    throw new Error('hvy insert plugin db-table: creation does not accept table or query inline; create it blank, then edit plugin.json and plugin.txt.');
  }
  insertChild(
    section.blocks,
    createPluginBlock(id, DB_TABLE_PLUGIN_ID, { source: 'with-file', table: '', queryLimit: 10 }, ''),
    index
  );
  const path = `${resolveVirtualPath(ctx.fs, ctx.cwd, sectionPath).replace(/\/$/, '')}/${id}`;
  return { output: formatCreatedComponentDirectory(ctx.document, path, resolveVirtualPath(ctx.fs, ctx.cwd, sectionPath), null, 'blocks'), mutated: true, cwd: path };
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
      `hvy insert section: sections must be added at the root level or on top of an existing section. ${path} is a component, not a section.`
    );
  }
  return requireSection(ctx, path, 'hvy insert section');
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
    editorOnly: false,
    css: '',
    tags: '',
    description: '',
    location: 'main',
    blocks: [],
    children: [],
  };
}

function createCliComponentBlock(document: VisualDocument, component: string, id: string, templateValues: Record<string, string> | null = null): VisualBlock {
  const definition = getComponentDefsFromMeta(document.meta).find((item) => item.name === component);
  const variables = extractReusableTemplateVariablesFromDefinition(definition);
  if (!templateValues && variables.length > 0) {
    throw new Error(`hvy insert ${component}: template values required. Use --using-template with expected keys: ${formatTemplateKeys(variables.map((variable) => variable.name))}`);
  }
  if (templateValues) {
    if (variables.length === 0) {
      throw new Error(`hvy insert ${component}: --using-template requires template variables. Expected keys: ${formatTemplateKeys([])}`);
    }
    validateReusableTemplateValues(variables, templateValues);
  }
  const block = definition?.template
    ? cloneCliVisualBlock(definition.template)
    : createBlockFromSchema(createCliComponentSchema(document, component), '');
  block.schema.component = component;
  block.schema.id = id;
  if (templateValues) {
    applyReusableTemplateValues(block, templateValues);
    block.schema.component = component;
    block.schema.id = id;
  }
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
  const cloned = schemaFromUnknown(JSON.parse(JSON.stringify(schema)) as JsonObject);
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

function isKnownComponent(document: VisualDocument, component: string): boolean {
  return isBuiltinComponentName(component) || getComponentDefsFromMeta(document.meta).some((item) => item.name === component);
}

function readOption(args: string[], option: string): string | null {
  const index = args.indexOf(option);
  return index >= 0 ? args[index + 1] ?? '' : null;
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
