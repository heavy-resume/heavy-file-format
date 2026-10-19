// `hvy insert`: argument parsing, node creation, and the created-path report.
import { insertTemplateDefinition, commitTemplateDirectory } from './template-directories';
import { cloneReusableSection, defaultBlockSchema, getDefaultSectionContained, schemaFromUnknown } from '../document-factory';
import type { BlockSchema, GridItem, VisualBlock, VisualSection } from '../editor/types';
import { getComponentDefsFromMeta, isBuiltinComponentName, resolveBaseComponentFromMeta } from '../component-defs';
import type { JsonObject } from '../hvy/types';
import { DB_TABLE_PLUGIN_ID, FORM_PLUGIN_ID } from '../plugins/registry';
import { getSectionId } from '../section-ops';
import type { SectionDefinition, VisualDocument } from '../types';
import { makeId } from '../utils';
import {
  applyReusableSectionTemplateValues,
  applyReusableTemplateValues,
  extractReusableTemplateVariablesFromSectionDefinition,
  extractReusableTemplateVariablesFromDefinition,
  formatTemplateKeys,
  parseReusableTemplateJson,
  validateReusableTemplateValues,
} from '../reusable-template-values';
import { formatHvyRequestStructureForDirectory } from './request-structure';
import {
  buildHvyVirtualBlockSubtreeFileSystem,
  buildHvyVirtualFileSystem,
  findBlockForVirtualDirectory,
  findSectionForVirtualDirectory,
  findVirtualDirectoriesForBlock,
  findVirtualDirectoryForSection,
  findBlockInsertionTargetForVirtualDirectory,
  listDirectory,
  resolveVirtualPath,
  type HvyVirtualFileSystem,
  type HvyVirtualPathNamingState,
} from './virtual-file-system';
import type { HvyDocumentCommandContext, HvyDocumentCommandResult } from './hvy-document-commands';

type HvyInsertIndex = number;

export function executeHvyInsertCommand(ctx: HvyDocumentCommandContext, indexArg = '', kind = '', args: string[]): HvyDocumentCommandResult {
  const index = parseInsertIndex(indexArg);
  const parent = resolveVirtualPath(ctx.fs, ctx.cwd, args[0] ?? '');
  if (parent === '/templates/components' || parent === '/templates/sections' || parent.endsWith('/flavors')) {
    const rest = args.slice(1);
    const name = rest.length === 2 && rest[0] === '--id' ? rest[1] : rest.length === 1 ? rest[0] : '';
    if (!name || name.startsWith('--')) throw new Error('hvy insert: definitions require PARENT_PATH --id NAME (or positional NAME).');
    if (kind !== 'section' && !isKnownComponent(ctx.document, kind)) throw new Error(`Unknown component: ${kind}`);
    const node = kind === 'section' ? createSection('', name, ctx.document.meta) : createBlockFromSchema(schemaFromUnknown({ component: kind }, new WeakSet<object>(), ctx.document.meta), '');
    const path = insertTemplateDefinition(ctx.document, parent, name, index, node);
    return { output: path, mutated: true, cwd: path };
  }

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

/** Prefer a path under the parent the caller named, so `/id/...` parents keep reporting `/id/...` children. */
function requireCreatedBlockDirectory(ctx: HvyDocumentCommandContext, block: VisualBlock, resolvedParentPath: string): string {
  const parentPrefix = `${resolvedParentPath.replace(/\/$/, '')}/`;
  const paths = findVirtualDirectoriesForBlock(ctx.document, block, {
    naming: ctx.pathNaming,
    includeIdAliases: parentPrefix.startsWith('/id/'),
  });
  const path = paths.find((candidate) => candidate.startsWith(parentPrefix)) ?? paths[0];
  if (!path) {
    throw new Error(`hvy insert: created component "${block.schema.id}" has no virtual directory.`);
  }
  return path;
}

function requireCreatedSectionDirectory(ctx: HvyDocumentCommandContext, section: VisualSection): string {
  const path = findVirtualDirectoryForSection(ctx.document, section);
  if (!path) {
    throw new Error(`hvy insert: created section "${getSectionId(section)}" has no virtual directory.`);
  }
  return path;
}

function parseInsertIndex(indexArg: string): HvyInsertIndex {
  if (!/^-?\d+$/.test(indexArg)) {
    throw new Error('hvy insert: expected INDEX as the first argument. Use 0 for the front or Python-style negative indexes such as -1 for the back.');
  }
  return Number(indexArg);
}

function addSection(ctx: HvyDocumentCommandContext, args: string[], index: HvyInsertIndex = -1): HvyDocumentCommandResult {
  if (args.includes('--from-template')) {
    return addSectionFromTemplate(ctx, args, index);
  }
  const [parentPath = '', id = '', title = ''] = args;
  if (!parentPath || !id || !title) {
    throw new Error('hvy insert section: expected PARENT_PATH ID TITLE or PARENT_PATH --from-template TEMPLATE_KEY');
  }
  requireSectionRoot(ctx, parentPath);
  const section = createSection(id, decodeCliText(title), ctx.document.meta);
  insertChild(ctx.document.sections, section, index);
  const path = requireCreatedSectionDirectory(ctx, section);
  return { output: path, mutated: true, cwd: path };
}

function addSectionFromTemplate(ctx: HvyDocumentCommandContext, args: string[], index: HvyInsertIndex): HvyDocumentCommandResult {
  const [parentPath = '', ...rest] = args;
  if (!parentPath) {
    throw new Error('hvy insert section: expected PARENT_PATH --from-template TEMPLATE_KEY');
  }
  const templateKey = readOption(rest, '--from-template');
  if (templateKey === null) {
    throw new Error('hvy insert section: expected --from-template TEMPLATE_KEY');
  }
  if (!templateKey.trim()) {
    throw new Error('hvy insert section: --from-template requires a template key or name.');
  }
  const usingTemplateRaw = readOption(rest, '--using-template');
  const optionRest = rest.filter((arg, argIndex) => !['--from-template', '--using-template'].includes(arg) && !['--from-template', '--using-template'].includes(rest[argIndex - 1] ?? ''));
  if (optionRest.length > 0) {
    throw new Error(`hvy insert section: unsupported argument ${optionRest[0]}`);
  }
  if (rest.includes('--using-template') && usingTemplateRaw === '') {
    throw new Error('hvy insert section: --using-template requires a JSON object.');
  }
  const definition = findSectionDefinition(ctx.document, templateKey);
  if (!definition) {
    throw new Error(`hvy insert section: unknown section template "${templateKey}". Available templates: ${formatAvailableSectionTemplates(ctx.document)}`);
  }
  const variables = extractReusableTemplateVariablesFromSectionDefinition(definition);
  const templateValues = usingTemplateRaw === null ? null : parseReusableTemplateJson(usingTemplateRaw);
  if (templateValues && variables.length === 0) {
    throw new Error(`hvy insert section: section template "${getReusableSectionTemplateKey(definition)}" does not define template variables.`);
  }
  if (!templateValues && variables.length > 0) {
    throw new Error(`hvy insert section: section template "${getReusableSectionTemplateKey(definition)}" requires --using-template with expected keys: ${formatTemplateKeys(variables.map((variable) => variable.name))}`);
  }
  if (templateValues) {
    validateReusableTemplateValues(variables, templateValues);
  }
  const key = getReusableSectionTemplateKey(definition);
  if (definition.repeatable !== true && getUsedSectionTemplateKeys(ctx.document).has(key)) {
    throw new Error(`hvy insert section: section template "${key}" is non-repeatable and already used.`);
  }
  requireSectionRoot(ctx, parentPath);
  const section = cloneReusableSection(definition.template, ctx.document.meta);
  section.customId = definition.template.customId;
  section.customIdGenerated = definition.template.customIdGenerated;
  if (templateValues) {
    applyReusableSectionTemplateValues(section, templateValues, variables);
  }
  section.templateKey = key;
  insertChild(ctx.document.sections, section, index);
  const path = requireCreatedSectionDirectory(ctx, section);
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
  if (rest.includes('--using-template') && usingTemplateRaw === '') {
    throw new Error(`hvy insert ${component}: --using-template requires a JSON object.`);
  }
  const { id, extra } = parseInsertIdArguments(`hvy insert ${component}`, optionRest);
  if (extra.length > 0) {
    throw new Error(`hvy insert ${component}: creation does not accept inline content; create it blank, then edit generated body/config files.`);
  }
  return addComponentToPath(ctx, {
    parentPath,
    id,
    component,
    commandName: `hvy insert ${index} ${component}`,
    index,
    returnAboutTxtOnCreation,
    returnOrderOnCreation,
    returnStructureOnCreation,
    templateValues: usingTemplateRaw === null ? null : parseReusableTemplateJson(usingTemplateRaw),
  });
}

/**
 * Shared `[ID|--id ID] TRAILING...` parsing for insert commands. Unknown options are
 * rejected so a flag is never taken as a name. Without --id, a leading positional is
 * the id only when more than `trailingCount` positionals were given.
 */
function parseInsertIdArguments(commandName: string, args: string[], trailingCount = 0): { id: string; trailing: string[]; extra: string[] } {
  if (args.includes('--name')) {
    throw new Error(`${commandName}: use --id ID, not --name.`);
  }
  const unsupportedOption = args.find((arg) => isOptionArg(arg) && arg !== '--id');
  if (unsupportedOption) {
    throw new Error(`${commandName}: unsupported option ${unsupportedOption}; create it blank, then edit generated body/config files.`);
  }
  const explicitId = readOption(args, '--id');
  if (explicitId === '') {
    throw new Error(`${commandName}: --id requires a value.`);
  }
  const positionals = args.filter((arg, index) => !isOptionArg(arg) && !isOptionValue(args, index));
  if (explicitId !== null) {
    if (positionals.length > trailingCount) {
      throw new Error(`${commandName}: creation accepts either positional ID or --id ID, not both.`);
    }
    return { id: explicitId, trailing: positionals, extra: [] };
  }
  const idCount = positionals.length > trailingCount ? 1 : 0;
  return {
    id: idCount ? positionals[0]! : '',
    trailing: positionals.slice(idCount, idCount + trailingCount),
    extra: positionals.slice(idCount + trailingCount),
  };
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
  const block = createCliComponentBlock(ctx.document, params.component, id, !params.id, params.templateValues ?? null);
  const parentBlock = findBlockForVirtualDirectory(ctx.document, resolvedParentPath, ctx.pathNaming);
  const target = findBlockInsertionTargetForVirtualDirectory(ctx.document, resolvedParentPath, ctx.pathNaming)
    ?? findDirectBlockInsertionTarget(ctx, resolvedParentPath);
  if (!target) {
    throw new Error(`${params.commandName}: no component insertion target: ${params.parentPath}`);
  }
  target.insert(block, params.index ?? -1);
  commitTemplateDirectory(ctx.document, resolvedParentPath);
  const path = requireCreatedBlockDirectory(ctx, block, resolvedParentPath);
  return {
    output: formatCreatedComponentDirectory(ctx.document, path, block, resolvedParentPath, parentBlock, target.kind, {
      returnAboutTxtOnCreation: params.returnAboutTxtOnCreation,
      returnOrderOnCreation: params.returnOrderOnCreation,
      returnStructureOnCreation: params.returnStructureOnCreation,
    }, ctx.pathNaming),
    mutated: true,
    cwd: path,
    refreshSectionPaths: [resolvedParentPath],
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
  const parentBlock = findBlockForVirtualDirectory(ctx.document, resolvedParentPath, ctx.pathNaming);
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
  return { id: makeId('griditem'), idGenerated: true, block };
}

function formatCreatedComponentDirectory(
  document: VisualDocument,
  componentPath: string,
  createdBlock: VisualBlock | null,
  parentPath = '',
  parentBlock: VisualBlock | null = null,
  insertionKind?: 'blocks' | 'grid',
  options: {
    returnAboutTxtOnCreation?: boolean;
    returnOrderOnCreation?: boolean;
    returnStructureOnCreation?: boolean;
  } = {},
  pathNaming?: HvyVirtualPathNamingState
): string {
  const normalizedComponentPath = componentPath.startsWith('/')
    ? componentPath
    : `/body/${componentPath}`;
  const fs = createdBlock && !options.returnStructureOnCreation
    ? buildHvyVirtualBlockSubtreeFileSystem(document, createdBlock, normalizedComponentPath, pathNaming)
    : buildHvyVirtualFileSystem(document, pathNaming);
  const entry = fs.entries.get(normalizedComponentPath);
  if (!entry || entry.kind !== 'dir') {
    return componentPath;
  }
  const children = listDirectory(fs, normalizedComponentPath)
    .map((child) => `${child.kind === 'dir' ? 'dir ' : 'file'} ${child.path.split('/').pop() ?? child.path}`)
    .join('\n');
  const component = createdBlock ?? findBlockForVirtualDirectory(document, normalizedComponentPath, pathNaming);
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
    `Use about-${componentName}.txt to inspect this component template guidance again.`,
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
  const [sectionPath = '', ...rest] = args;
  const section = requireSection(ctx, sectionPath, 'hvy insert plugin');
  const { id, trailing: [plugin = ''], extra } = parseInsertIdArguments('hvy insert plugin', rest, 1);
  if (!id || !plugin) {
    throw new Error('hvy insert plugin: expected SECTION_PATH [ID|--id ID] PLUGIN_ID');
  }
  if (extra.length > 0) {
    throw new Error('hvy insert plugin: creation does not accept inline config or body; create it blank, then edit plugin.json and plugin.txt.');
  }
  const aliasError = formatRawPluginAliasError(plugin);
  if (aliasError) {
    throw new Error(aliasError);
  }
  const block = createPluginBlock(id, plugin, {}, '');
  insertChild(section.blocks, block, index);
  const resolvedSectionPath = resolveVirtualPath(ctx.fs, ctx.cwd, sectionPath);
  const path = requireCreatedBlockDirectory(ctx, block, resolvedSectionPath);
  return { output: formatCreatedComponentDirectory(ctx.document, path, block, resolvedSectionPath, null, 'blocks'), mutated: true, cwd: path };
}

function formatRawPluginAliasError(plugin: string): string {
  if (plugin === 'form') {
    return 'hvy insert plugin: "form" is a CLI command alias, not a stored plugin id. Use "hvy insert INDEX plugin form SECTION_PATH [ID|--id ID]" or plugin id "hvy.form".';
  }
  if (plugin === 'db-table') {
    return 'hvy insert plugin: "db-table" is a CLI command alias, not a stored plugin id. Use "hvy insert INDEX plugin db-table SECTION_PATH [ID|--id ID]" or plugin id "hvy.db-table".';
  }
  if (plugin === 'scripting') {
    return 'hvy insert plugin: "scripting" is a CLI command alias, not a stored plugin id. Use plugin id "hvy.scripting".';
  }
  return '';
}

function addFormPluginBlock(ctx: HvyDocumentCommandContext, args: string[], index: HvyInsertIndex = -1): HvyDocumentCommandResult {
  const [sectionPath = '', ...rest] = args;
  const section = requireSection(ctx, sectionPath, 'hvy insert plugin form');
  const { id, extra } = parseInsertIdArguments('hvy insert plugin form', rest);
  if (!id) {
    throw new Error('hvy insert plugin form: expected SECTION_PATH [ID|--id ID]');
  }
  if (extra.length > 0) {
    throw new Error('hvy insert plugin form: creation does not accept fields, scripts, or submit settings; create it blank, then edit plugin.txt and plugin.json.');
  }
  const block = createPluginBlock(id, FORM_PLUGIN_ID, {
    version: '0.1',
    showSubmit: false,
  }, 'fields: []');
  insertChild(section.blocks, block, index);
  const resolvedSectionPath = resolveVirtualPath(ctx.fs, ctx.cwd, sectionPath);
  const path = requireCreatedBlockDirectory(ctx, block, resolvedSectionPath);
  return { output: formatCreatedComponentDirectory(ctx.document, path, block, resolvedSectionPath, null, 'blocks'), mutated: true, cwd: path };
}

function addDbTablePluginBlock(ctx: HvyDocumentCommandContext, args: string[], index: HvyInsertIndex = -1): HvyDocumentCommandResult {
  const [sectionPath = '', ...rest] = args;
  const section = requireSection(ctx, sectionPath, 'hvy insert plugin db-table');
  const { id, extra } = parseInsertIdArguments('hvy insert plugin db-table', rest);
  if (!id) {
    throw new Error('hvy insert plugin db-table: expected SECTION_PATH [ID|--id ID]');
  }
  if (extra.length > 0) {
    throw new Error('hvy insert plugin db-table: creation does not accept table or query inline; create it blank, then edit plugin.json and plugin.txt.');
  }
  const block = createPluginBlock(id, DB_TABLE_PLUGIN_ID, { source: 'with-file', table: '', queryLimit: 10 }, '');
  insertChild(section.blocks, block, index);
  const resolvedSectionPath = resolveVirtualPath(ctx.fs, ctx.cwd, sectionPath);
  const path = requireCreatedBlockDirectory(ctx, block, resolvedSectionPath);
  return { output: formatCreatedComponentDirectory(ctx.document, path, block, resolvedSectionPath, null, 'blocks'), mutated: true, cwd: path };
}

function requireSectionRoot(ctx: HvyDocumentCommandContext, path: string): void {
  const resolved = resolveVirtualPath(ctx.fs, ctx.cwd, path);
  if (resolved !== '/' && resolved !== '/body') {
    throw new Error('hvy insert section: sections must be added at /body. Use a container to group components inside a section.');
  }
}

function requireSection(ctx: HvyDocumentCommandContext, path: string, command: string): VisualSection {
  const resolved = resolveVirtualPath(ctx.fs, ctx.cwd, path);
  const section = findSectionForVirtualDirectory(ctx.document, resolved, ctx.pathNaming);
  if (!section) {
    throw new Error(`${command}: no such section: ${path}`);
  }
  return section;
}


function createSection(id: string, title: string, documentMeta: JsonObject): VisualSection {
  return {
    key: makeId('section'),
    customId: id,
    contained: getDefaultSectionContained(documentMeta),
    lock: false,
    idEditorOpen: false,
    isGhost: false,
    title,
    expanded: true,
    highlight: false,
    editorOnly: false,
    css: '',
    tags: '',
    description: '',
    location: 'main',
    hideIfUnmodified: false,
    blocks: [],
  };
}

function getSectionDefinitionsFromDocument(document: VisualDocument): SectionDefinition[] {
  const definitions = document.meta.section_defs;
  return Array.isArray(definitions)
    ? definitions.filter((item): item is SectionDefinition => !!item && typeof item === 'object' && 'name' in item && 'template' in item)
    : [];
}

function findSectionDefinition(document: VisualDocument, keyOrName: string): SectionDefinition | null {
  const requested = keyOrName.trim();
  const definitions = getSectionDefinitionsFromDocument(document);
  return definitions.find((definition) => getReusableSectionTemplateKey(definition) === requested)
    ?? definitions.find((definition) => definition.name.trim() === requested)
    ?? null;
}

function getReusableSectionTemplateKey(definition: SectionDefinition): string {
  return definition.key?.trim() || definition.name.trim();
}

function getUsedSectionTemplateKeys(document: VisualDocument): Set<string> {
  const used = new Set<string>();
  const visit = (sections: VisualDocument['sections']): void => {
    for (const section of sections) {
      if (!section.isGhost && section.templateKey?.trim()) {
        used.add(section.templateKey.trim());
      }
    }
  };
  visit(document.sections);
  return used;
}

function formatAvailableSectionTemplates(document: VisualDocument): string {
  const names = getSectionDefinitionsFromDocument(document).map((definition) => getReusableSectionTemplateKey(definition));
  return names.join(', ') || '(none)';
}

function createCliComponentBlock(document: VisualDocument, component: string, id: string, idGenerated: boolean, templateValues: Record<string, string> | null = null): VisualBlock {
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
    ? cloneCliVisualBlock(definition.template, document.meta)
    : createBlockFromSchema(createCliComponentSchema(document, component), '');
  block.schema.component = component;
  block.schema.id = id;
  block.idGenerated = idGenerated;
  if (templateValues) {
    applyReusableTemplateValues(block, templateValues, variables);
    block.schema.component = component;
    block.schema.id = id;
    block.idGenerated = idGenerated;
  }
  return block;
}

function createCliComponentSchema(document: VisualDocument, component: string): BlockSchema {
  const definition = getComponentDefsFromMeta(document.meta).find((item) => item.name === component);
  if (definition?.schema) {
    return cloneCliBlockSchema(definition.schema, component, document.meta);
  }
  return schemaFromUnknown({ component }, new WeakSet<object>(), document.meta);
}

function createBlockFromSchema(schema: BlockSchema, text: string): VisualBlock {
  return {
    id: makeId('block'),
    text,
    schema,
    schemaMode: false,
  };
}

function cloneCliVisualBlock(block: VisualBlock, documentMeta?: JsonObject | null): VisualBlock {
  const schema = block.schema ?? defaultBlockSchema('text');
  return {
    id: makeId('block'),
    text: block.text ?? '',
    schema: cloneCliBlockSchema(schema, schema.component || 'text', documentMeta),
    schemaMode: false,
  };
}

function cloneCliBlockSchema(schema: BlockSchema, componentName = schema.component, documentMeta?: JsonObject | null): BlockSchema {
  const cloned = schemaFromUnknown({ ...(JSON.parse(JSON.stringify(schema)) as JsonObject), component: componentName }, new WeakSet<object>(), documentMeta);
  cloned.component = componentName;
  cloned.id = cloned.id ?? '';
  if (cloned.kind === 'container') {
    cloned.containerBlocks = (cloned.containerBlocks ?? []).filter(isVisualBlockLike).map((block) => cloneCliVisualBlock(block, documentMeta));
  }
  if (cloned.kind === 'component-list') {
    cloned.componentListBlocks = (cloned.componentListBlocks ?? []).filter(isVisualBlockLike).map((block) => cloneCliVisualBlock(block, documentMeta));
  }
  if (cloned.kind === 'grid') {
    cloned.gridItems = (cloned.gridItems ?? []).map((item) => ({
      ...item,
      id: item.id || makeId('griditem'),
      idGenerated: item.idGenerated === true || !item.id,
      block: item.block && isVisualBlockLike(item.block)
        ? cloneCliVisualBlock(item.block, documentMeta)
        : createBlockFromSchema(defaultBlockSchema('text'), ''),
    }));
  }
  if (cloned.kind === 'expandable') {
    cloned.expandableStubBlocks = {
      lock: cloned.expandableStubBlocks?.lock ?? false,
      children: (cloned.expandableStubBlocks?.children ?? []).filter(isVisualBlockLike).map((block) => cloneCliVisualBlock(block, documentMeta)),
    };
    cloned.expandableContentBlocks = {
      lock: cloned.expandableContentBlocks?.lock ?? false,
      children: (cloned.expandableContentBlocks?.children ?? []).filter(isVisualBlockLike).map((block) => cloneCliVisualBlock(block, documentMeta)),
    };
  }
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

export function decodeCliText(value: string): string {
  return value.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}
