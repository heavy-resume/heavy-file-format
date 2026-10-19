import type { VisualDocument } from '../types';
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
import { formatHvyRequestStructure } from './request-structure';
import { formatHvySearch } from './intent-search';
import { decodeCliText, executeHvyInsertCommand } from './hvy-insert-command';
import { resolveVirtualPath, type HvyVirtualFileSystem, type HvyVirtualPathNamingState } from './virtual-file-system';

export interface HvyDocumentCommandContext {
  document: VisualDocument;
  fs: HvyVirtualFileSystem;
  cwd: string;
  pathNaming?: HvyVirtualPathNamingState;
}

export interface HvyDocumentCommandResult {
  output: string;
  mutated: boolean;
  cwd?: string;
  mutatedPaths?: string[];
  refreshSectionPaths?: string[];
  requiresFullRefresh?: boolean;
}

export function executeHvyDocumentCommand(ctx: HvyDocumentCommandContext, args: string[]): HvyDocumentCommandResult {
  const [resource, action, ...rest] = args;
  if (resource === 'help') {
    return { output: hvyDocumentCommandHelp([action ?? '', ...rest].filter(Boolean).join(' ')), mutated: false };
  }
  if (resource === 'request_structure') {
    return { output: formatHvyRequestStructure(ctx.document, ctx.fs, resolveRequestStructureOptions(ctx, parseRequestStructureArgs([action ?? '', ...rest].filter(Boolean)))), mutated: false };
  }
  if (resource === 'search') {
    return { output: formatHvySearch(ctx.document, ctx.fs, decodeCliText(action ?? ''), parseSearchArgs(rest)), mutated: false };
  }
  if (resource === 'embeddings') {
    if (action !== 'build' || rest.length > 0) {
      return { output: hvyDocumentCommandHelp('embeddings'), mutated: false };
    }
    return {
      output: 'Embedding build is unavailable because no embedding provider is configured for this CLI session.',
      mutated: false,
    };
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
  throw new Error('hvy: expected request_structure, search, embeddings, cheatsheet, recipe, lint, insert, plugin, remove, prune-xref, preview, or help');
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
      formatCommandHelp('hvy help templates', 'Create and edit reusable definitions under /templates/components and /templates/sections. Document instances live under /body.'),
      formatCommandHelp('hvy insert INDEX COMPONENT PARENT_PATH [ID|--id ID] [--using-template JSON] [--return-order-on-creation] [--return-structure-on-creation] [--return-about-txt-on-creation]', 'Insert a blank builtin or custom component. Component templates with template variables require exact JSON values with --using-template. Component ids are optional; use --id only when you need a stable id. INDEX is zero-based and supports Python-style negative indexes; 0 is the front, -1 is the back.'),
      formatCommandHelp('hvy insert INDEX section PARENT_PATH ID TITLE', 'Create a blank section.'),
      formatCommandHelp('hvy insert INDEX section PARENT_PATH --from-template TEMPLATE_KEY [--using-template JSON]', 'Clone a section template from section_defs, such as blip-section. Section templates with variables require exact JSON values with --using-template.'),
      formatCommandHelp('hvy insert INDEX text PARENT_PATH [ID|--id ID]', 'Create a blank text component. Edit text.txt after creation.'),
      formatCommandHelp('hvy insert INDEX table PARENT_PATH [ID|--id ID]', 'Create a blank static table component. Edit tableColumns.json, tableColumnProperties.json, and tableRows.json after creation.'),
      formatCommandHelp('hvy remove PATH [--prune-xref]', 'Remove a section or component directory. Alias: hvy delete PATH.'),
      formatCommandHelp('hvy prune-xref TARGET_ID', 'Remove xref-card components pointing to TARGET_ID.'),
      formatCommandHelp('hvy preview PATH', 'Show the raw HVY preview for a component, capped at 100 lines.'),
      formatCommandHelp('hvy request_structure [COMPONENT_ID] [--collapse] [--describe]', 'Show the component directory map for the current document.'),
      formatCommandHelp('hvy search QUERY [--max N] [--json]', 'Search semantic section/component metadata, paths, roles, and previews for likely edit locations.'),
      formatCommandHelp('hvy embeddings build', 'Build or refresh the current document embedding index when an embedding provider is configured.'),
      formatCommandHelp('hvy cheatsheet [NAME]', 'List or show concise command examples from file-backed cheatsheets.'),
      formatCommandHelp('hvy recipe [NAME]', 'List or show file-backed HVY recipes for composed document patterns.'),
      formatCommandHelp('hvy lint [--fix]', 'Check the document for likely component issues. --fix repairs safe structural issues such as plugin id aliases.'),
      formatHvyCheatsheetList(),
      formatHvyRecipeList(),
      ...formatPluginQuickReference(),
      formatCommandHelp('Edit existing components', 'Use find to discover virtual files, cat to inspect them, and sed to update writable body/config files.'),
    ].join('\n'),
    templates: templateCommandHelp(),
    insert: [
      templateCommandHelp(),
      formatCommandHelp('hvy insert INDEX COMPONENT PARENT_PATH [ID|--id ID] [--using-template JSON] [--return-order-on-creation] [--return-structure-on-creation] [--return-about-txt-on-creation]', 'Insert a blank builtin or custom component to a section, component-list, grid, container, or expandable content path. Component templates with template variables require --using-template with exact JSON keys. Edit generated body/config files after creation. Component ids are optional; use --id only when you need a stable id. INDEX is zero-based and supports Python-style negative indexes; 0 is the front, -1 is the back.'),
      formatCommandHelp('hvy insert INDEX section PARENT_PATH ID TITLE', 'Add a blank section under /body or under another section.'),
      formatCommandHelp('hvy insert INDEX section PARENT_PATH --from-template TEMPLATE_KEY [--using-template JSON]', 'Clone a section template from section_defs. Templates with variables require --using-template with exact JSON keys. Non-repeatable templates can be inserted once.'),
      formatCommandHelp('hvy insert INDEX text PARENT_PATH [ID|--id ID]', 'Insert a blank text block.'),
      formatCommandHelp('hvy insert INDEX table PARENT_PATH [ID|--id ID]', 'Insert a blank static table block.'),
      formatCommandHelp('hvy insert INDEX plugin SECTION_PATH [ID|--id ID] PLUGIN_ID', 'Insert a blank raw plugin block by canonical plugin id, such as hvy.form or hvy.db-table.'),
      '',
      'Examples:',
      '  hvy insert 0 section /body a-section "A Section"',
      '  hvy insert -1 section /body --from-template blip-section',
      '  hvy insert -1 section /body --from-template widget-records --using-template \'{"section_title":"Widget Records","row_label":"Example Widget","row_summary":"Example summary","row_details":"Example details."}\'',
      '  cd /a-section',
      '  hvy insert 0 text . intro',
      '  hvy insert -1 container . a-container',
      '  hvy insert 0 container a-container nested-container',
      '  hvy insert -1 component-list . a-list',
      '  hvy insert -1 grid . a-grid',
      '  hvy insert -2 table . a-table',
    ].join('\n'),
    component: [
      formatCommandHelp('hvy insert INDEX COMPONENT PARENT_PATH [ID|--id ID] [--using-template JSON] [--return-order-on-creation] [--return-structure-on-creation] [--return-about-txt-on-creation]', 'Insert a blank builtin or custom component to a section, component-list, grid, container, or expandable content path. Component templates with template variables require --using-template with exact JSON keys. Edit generated body/config files after creation. Component ids are optional; use --id only when you need a stable id. INDEX is zero-based and supports Python-style negative indexes; 0 is the front, -1 is the back.'),
    ].join('\n'),
    section: [
      formatCommandHelp('hvy insert INDEX section PARENT_PATH ID TITLE', 'Add a blank section under /body or under another section. INDEX is zero-based and supports Python-style negative indexes; 0 is the front, -1 is the back.'),
      formatCommandHelp('hvy insert INDEX section PARENT_PATH --from-template TEMPLATE_KEY [--using-template JSON]', 'Clone a section template from section_defs. Lookup prefers exact key, then exact name. Templates with variables require exact JSON values. Non-repeatable templates can be inserted once.'),
    ].join('\n'),
    text: formatCommandHelp('hvy insert INDEX text PARENT_PATH [ID|--id ID]', 'Insert a blank text block. Edit text.txt after creation. INDEX is zero-based and supports Python-style negative indexes; 0 is the front, -1 is the back.'),
    table: formatCommandHelp('hvy insert INDEX table PARENT_PATH [ID|--id ID]', 'Insert a blank static table block. Edit tableColumns.json, tableColumnProperties.json, and tableRows.json after creation. INDEX is zero-based and supports Python-style negative indexes; 0 is the front, -1 is the back.'),
    request_structure: formatCommandHelp('hvy request_structure [COMPONENT_ID] [--collapse] [--describe]', 'Show the component directory map, optionally scoped to one component id. --collapse compacts anonymous leaf components. --describe includes non-empty descriptions.'),
    'search': formatCommandHelp('hvy search QUERY [--max N] [--json]', 'Search semantic section/component descriptions, ids, paths, roles, and previews for likely edit locations.'),
    embeddings: formatCommandHelp('hvy embeddings build', 'Build or refresh the current document embedding index when an embedding provider is configured.'),
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
      formatCommandHelp('hvy insert INDEX plugin SECTION_PATH [ID|--id ID] PLUGIN_ID', 'Create a blank raw plugin block by canonical plugin id, such as hvy.form or hvy.db-table. INDEX is zero-based and supports Python-style negative indexes; 0 is the front, -1 is the back.'),
    ].join('\n'),
    form: hvyDocumentCommandHelp('plugin form'),
    'db-table': hvyDocumentCommandHelp('plugin db-table'),
  };
  return help[normalizedTopic] ?? help[''];
}

function templateCommandHelp(): string {
  return [
    'Reusable definitions live under /templates/components/NAME and /templates/sections/KEY. Instances live under /body.',
    'Use ls for discovery; definition.json contains metadata without nested content. Component schema/ and section template/ reuse ordinary component/section files and nested editing commands.',
    'hvy insert INDEX COMPONENT /templates/components --id NAME',
    'hvy insert INDEX section /templates/sections --id NAME',
    'cp -r SOURCE_COMPONENT /templates/components/NEW_NAME',
    'cp -r SOURCE_SECTION /templates/sections/NEW_NAME',
    'hvy remove /templates/components/NAME (or /templates/sections/KEY)',
    'Each definition has flavors/. Insert a matching base component (or section) there with --id FLAVOR_NAME; inspect/edit/remove each flavor through its own directory.',
    'Names are required and unique. Paths percent-encode names; copy paths from ls. Identity fields name/key/baseType cannot be changed through definition.json.',
    'Edit children with hvy insert/remove, cp -r, mv, and children-order.json at their existing nested paths. Read the relevant file before editing it.',
    'Definition edits affect future instances; existing /body instances keep their contents. /header.yaml excludes and preserves both definition collections.',
    'For a complete workflow, run hvy cheatsheet reusable-component.',
  ].join('\n');
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
    `Use from Brython as: doc.tool.${normalized}(**tool_args)`,
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

function parseSearchArgs(args: string[]): { max?: number; json?: boolean } {
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
        throw new Error('hvy search: --max must be a positive number');
      }
      max = Math.floor(value);
      index += 1;
      continue;
    }
    if (arg.startsWith('--max=')) {
      const value = Number(arg.slice('--max='.length));
      if (!Number.isFinite(value) || value < 1) {
        throw new Error('hvy search: --max must be a positive number');
      }
      max = Math.floor(value);
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`hvy search: unsupported option ${arg}`);
    }
    throw new Error(`hvy search: unexpected argument ${arg}`);
  }
  return {
    ...(max ? { max } : {}),
    ...(json ? { json } : {}),
  };
}
