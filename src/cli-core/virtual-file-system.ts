import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { BlockSchema, GridItem, VisualBlock, VisualSection } from '../editor/types';
import type { JsonObject } from '../hvy/types';
import type { VisualDocument } from '../types';
import { getSectionId } from '../section-ops';
import { makeId } from '../utils';
import { FORM_PLUGIN_ID, getHostPlugin, SCRIPTING_PLUGIN_ID } from '../plugins/registry';
import { parseFormSpec, serializeFormSpec } from '../plugins/form';
import { getTableColumns } from '../table-ops';
import { getHvyComponentHelpLines, getHvySectionHelpLines } from '../component-help';
import { getComponentDefsFromMeta, resolveBaseComponentFromMeta } from '../component-defs';

export interface HvyVirtualFile {
  kind: 'file';
  path: string;
  read: () => string;
  write?: (content: string) => void;
  writable?: boolean;
}

export interface HvyVirtualDirectory {
  kind: 'dir';
  path: string;
}

export type HvyVirtualEntry = HvyVirtualFile | HvyVirtualDirectory;

export interface HvyVirtualFileSystem {
  entries: Map<string, HvyVirtualEntry>;
}

export type HvyVirtualBlockInsertionTarget =
  | { kind: 'blocks'; insert: (block: VisualBlock, index?: number) => void }
  | { kind: 'grid'; insert: (block: VisualBlock, index?: number) => void };

export function buildHvyVirtualFileSystem(document: VisualDocument): HvyVirtualFileSystem {
  const entries = new Map<string, HvyVirtualEntry>();
  const addDir = (path: string) => entries.set(path, { kind: 'dir', path });
  const addFile = (path: string, read: () => string, write?: (content: string) => void) =>
    entries.set(path, { kind: 'file', path, read, write });

  addDir('/');
  addDir('/body');
  addDir('/attachments');

  addFile(
    '/header.yaml',
    () => stringifyYaml(omitComponentDefs(document.meta)).trimEnd(),
    (content) => {
      const parsed = parseYaml(content);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('/header.yaml must contain a YAML object.');
      }
      const componentDefs = document.meta.component_defs;
      document.meta = {
        ...(parsed as JsonObject),
        ...(componentDefs ? { component_defs: componentDefs } : {}),
      };
    }
  );

  addSectionList(entries, document.meta, document.sections.filter((section) => !section.isGhost), '/body');

  document.attachments.forEach((attachment, index) => {
    const filename = uniqueName(`${sanitizePathSegment(attachment.id) || `attachment-${index}`}.json`, entries, '/attachments');
    addFile(`/attachments/${filename}`, () =>
      `${JSON.stringify({ id: attachment.id, ...attachment.meta, length: attachment.bytes.length }, null, 2)}\n`
    );
  });

  return { entries };
}

export function findBlockForVirtualDirectory(document: VisualDocument, path: string): VisualBlock | null {
  const normalized = normalizeVirtualPath('/', path);
  const entries = new Map<string, HvyVirtualEntry>();
  const blocks = new Map<string, VisualBlock>();
  entries.set('/', { kind: 'dir', path: '/' });
  entries.set('/body', { kind: 'dir', path: '/body' });
  document.sections
    .filter((section) => !section.isGhost)
    .forEach((section, index) => addSectionBlockLookup(entries, blocks, section, `/body/${uniqueName(sectionDirectoryName(section, index), entries, '/body')}`));
  return blocks.get(normalized) ?? null;
}

export function findSectionForVirtualDirectory(document: VisualDocument, path: string): VisualSection | null {
  const normalized = normalizeVirtualPath('/', path);
  const entries = new Map<string, HvyVirtualEntry>();
  const sections = new Map<string, VisualSection>();
  entries.set('/', { kind: 'dir', path: '/' });
  entries.set('/body', { kind: 'dir', path: '/body' });
  document.sections
    .filter((section) => !section.isGhost)
    .forEach((section, index) => addSectionLookup(entries, sections, section, `/body/${uniqueName(sectionDirectoryName(section, index), entries, '/body')}`));
  return sections.get(normalized) ?? null;
}

export function findVirtualDirectoryForBlock(document: VisualDocument, targetBlock: VisualBlock): string | null {
  const entries = new Map<string, HvyVirtualEntry>();
  const blocks = new Map<string, VisualBlock>();
  entries.set('/', { kind: 'dir', path: '/' });
  entries.set('/body', { kind: 'dir', path: '/body' });
  document.sections
    .filter((section) => !section.isGhost)
    .forEach((section, index) => addSectionBlockLookup(entries, blocks, section, `/body/${uniqueName(sectionDirectoryName(section, index), entries, '/body')}`));
  for (const [path, block] of blocks) {
    if (block === targetBlock) {
      return path;
    }
  }
  return null;
}

function addSectionLookup(
  entries: Map<string, HvyVirtualEntry>,
  lookup: Map<string, VisualSection>,
  section: VisualSection,
  sectionPath: string
): void {
  entries.set(sectionPath, { kind: 'dir', path: sectionPath });
  lookup.set(sectionPath, section);
  section.children
    .filter((child) => !child.isGhost)
    .forEach((child, index) => addSectionLookup(entries, lookup, child, `${sectionPath}/${uniqueName(sectionDirectoryName(child, index), entries, sectionPath)}`));
}

export function findBlockInsertionTargetForVirtualDirectory(document: VisualDocument, path: string): HvyVirtualBlockInsertionTarget | null {
  const normalized = normalizeVirtualPath('/', path);
  const entries = new Map<string, HvyVirtualEntry>();
  const targets = new Map<string, HvyVirtualBlockInsertionTarget>();
  entries.set('/', { kind: 'dir', path: '/' });
  entries.set('/body', { kind: 'dir', path: '/body' });
  targets.set('/body', { kind: 'blocks', insert: () => {} });
  document.sections
    .filter((section) => !section.isGhost)
    .forEach((section, index) => addSectionInsertionTargets(entries, targets, section, `/body/${uniqueName(sectionDirectoryName(section, index), entries, '/body')}`));
  return targets.get(normalized) ?? null;
}

export function normalizeVirtualPath(cwd: string, input = '.'): string {
  const raw = input.trim() || '.';
  const parts = (raw.startsWith('/') ? raw : `${cwd}/${raw}`).split('/');
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      normalized.pop();
      continue;
    }
    normalized.push(part);
  }
  return `/${normalized.join('/')}`;
}

export function listDirectory(fs: HvyVirtualFileSystem, path: string): HvyVirtualEntry[] {
  const normalized = normalizeVirtualPath('/', path);
  const prefix = normalized === '/' ? '/' : `${normalized}/`;
  const names = new Set<string>();
  for (const entryPath of fs.entries.keys()) {
    if (!entryPath.startsWith(prefix) || entryPath === normalized) {
      continue;
    }
    const tail = entryPath.slice(prefix.length);
    const [name] = tail.split('/');
    if (name) {
      names.add(`${prefix}${name}`.replace(/\/$/, ''));
    }
  }
  return [...names]
    .map((entryPath) => fs.entries.get(entryPath))
    .filter((entry): entry is HvyVirtualEntry => !!entry);
}

export function resolveVirtualPath(fs: HvyVirtualFileSystem, cwd: string, input = '.'): string {
  const normalized = normalizeVirtualPath(cwd, input);
  if (fs.entries.has(normalized)) {
    return normalized;
  }

  const trimmed = input.trim();
  if (!trimmed.startsWith('/') && cwd !== '/') {
    return normalized;
  }

  const bodyRelative = normalizeVirtualPath('/body', normalized.replace(/^\//, ''));
  if (fs.entries.has(bodyRelative)) {
    return bodyRelative;
  }

  return normalized;
}

function addSection(entries: Map<string, HvyVirtualEntry>, meta: JsonObject, section: VisualSection, sectionPath: string): void {
  entries.set(sectionPath, { kind: 'dir', path: sectionPath });
  entries.set(`${sectionPath}/section.json`, {
    kind: 'file',
    path: `${sectionPath}/section.json`,
    read: () => `${JSON.stringify(sectionToCliJson(section), null, 2)}\n`,
    write: (content) => applySectionJson(section, parseJsonObject(content, `${sectionPath}/section.json`)),
  });
  entries.set(`${sectionPath}/section-info.txt`, {
    kind: 'file',
    path: `${sectionPath}/section-info.txt`,
    read: () => formatSectionInfo(section),
  });
  entries.set(`${sectionPath}/about-section.txt`, {
    kind: 'file',
    path: `${sectionPath}/about-section.txt`,
    read: () => formatSectionAbout(section),
  });
  addBlockList(entries, meta, section.blocks, sectionPath);
  addSectionList(entries, meta, section.children.filter((child) => !child.isGhost), sectionPath);
}

function addSectionList(entries: Map<string, HvyVirtualEntry>, meta: JsonObject, sections: VisualSection[], parentPath: string): void {
  const keys: string[] = [];
  sections.forEach((section, index) => {
    const key = uniqueName(sectionDirectoryName(section, index), entries, parentPath);
    keys.push(key);
    addSection(entries, meta, section, `${parentPath}/${key}`);
  });
  addOrderFile(entries, `${parentPath}/children-order.json`, keys, (nextKeys) => reorderByKeys(sections, keys, nextKeys));
}

function addBlockList(entries: Map<string, HvyVirtualEntry>, meta: JsonObject, blocks: VisualBlock[], parentPath: string): void {
  const keys: string[] = [];
  blocks.forEach((block, index) => {
    const key = uniqueName(blockDirectoryName(block, index), entries, parentPath);
    keys.push(key);
    addBlock(entries, meta, block, `${parentPath}/${key}`);
  });
  addOrderFile(entries, `${parentPath}/children-order.json`, keys, (nextKeys) => reorderByKeys(blocks, keys, nextKeys));
}

function addBlock(entries: Map<string, HvyVirtualEntry>, meta: JsonObject, block: VisualBlock, blockPath: string): void {
  entries.set(blockPath, { kind: 'dir', path: blockPath });
  const componentFile = `${blockPath}/${sanitizePathSegment(block.schema.component) || 'component'}.json`;
  entries.set(componentFile, {
    kind: 'file',
    path: componentFile,
    read: () => `${JSON.stringify(blockSchemaToCliJson(block.schema), null, 2)}\n`,
    write: (content) => applyBlockSchemaJson(block.schema, componentNameFromPath(componentFile), parseJsonObject(content, componentFile)),
  });
  const bodyTextFile = `${blockPath}/${bodyFileNameForBlock(block)}`;
  entries.set(bodyTextFile, {
    kind: 'file',
    path: bodyTextFile,
    read: () => readBlockBodyText(block),
    writable: block.schema.component === 'table' ? false : undefined,
    write: (content) => {
      writeBlockBodyText(block, content);
    },
  });
  const componentName = sanitizePathSegment(block.schema.component) || 'component';
  entries.set(`${blockPath}/about-${componentName}.txt`, {
    kind: 'file',
    path: `${blockPath}/about-${componentName}.txt`,
    read: () => formatComponentAbout(meta, block.schema.component),
  });
  addPluginDocumentationFile(entries, block, blockPath);
  addTableDataFiles(entries, block, blockPath);
  addFormScriptFiles(entries, block, blockPath);

  addNamedBlockChildren(entries, meta, block.schema.containerBlocks ?? [], `${blockPath}/container`, block.schema.component === 'container');
  if (block.schema.component === 'component-list') {
    addBlockList(entries, meta, block.schema.componentListBlocks ?? [], blockPath);
  }
  addNamedBlockChildren(entries, meta, block.schema.expandableStubBlocks?.children ?? [], `${blockPath}/expandable-stub`, block.schema.component === 'expandable');
  addNamedBlockChildren(entries, meta, block.schema.expandableContentBlocks?.children ?? [], `${blockPath}/expandable-content`, block.schema.component === 'expandable');
  addGridItems(entries, meta, block.schema.gridItems ?? [], `${blockPath}/grid`, block.schema.component === 'grid');
}

function addGridItems(entries: Map<string, HvyVirtualEntry>, meta: JsonObject, gridItems: GridItem[], directoryPath: string, keepEmptyDirectory = false): void {
  if (gridItems.length === 0 && !keepEmptyDirectory) {
    return;
  }
  entries.set(directoryPath, { kind: 'dir', path: directoryPath });
  const keys: string[] = [];
  gridItems.forEach((item, index) => {
    const key = uniqueName(blockDirectoryName(item.block, index), entries, directoryPath);
    keys.push(key);
    addBlock(entries, meta, item.block, `${directoryPath}/${key}`);
  });
  addOrderFile(entries, `${directoryPath}/children-order.json`, keys, (nextKeys) => reorderByKeys(gridItems, keys, nextKeys));
}

function addPluginDocumentationFile(entries: Map<string, HvyVirtualEntry>, block: VisualBlock, blockPath: string): void {
  if (block.schema.component !== 'plugin' || !block.schema.plugin) {
    return;
  }
  const registration = getHostPlugin(block.schema.plugin);
  if (!registration?.documentation) {
    return;
  }
  const filename = sanitizePathSegment(registration.documentation.filename) || 'about-plugin-specific.txt';
  entries.set(`${blockPath}/${filename}`, {
    kind: 'file',
    path: `${blockPath}/${filename}`,
    read: () => `${registration.documentation?.text.trimEnd() ?? ''}\n`,
  });
}

function addNamedBlockChildren(entries: Map<string, HvyVirtualEntry>, meta: JsonObject, blocks: VisualBlock[], directoryPath: string, keepEmptyDirectory = false): void {
  if (blocks.length === 0 && !keepEmptyDirectory) {
    return;
  }
  entries.set(directoryPath, { kind: 'dir', path: directoryPath });
  addBlockList(entries, meta, blocks, directoryPath);
}

function addOrderFile(entries: Map<string, HvyVirtualEntry>, path: string, keys: string[], reorder: (nextKeys: string[]) => void): void {
  entries.set(path, {
    kind: 'file',
    path,
    read: () => `${JSON.stringify(keys, null, 2)}\n`,
    write: (content) => reorder(readOrderFileKeys(content, path, keys)),
  });
}

function readOrderFileKeys(content: string, path: string, currentKeys: string[]): string[] {
  const parsed = JSON.parse(content) as unknown;
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new Error(`${path} must be a JSON array of child directory names.`);
  }
  const nextKeys = parsed as string[];
  const duplicates = nextKeys.filter((key, index) => nextKeys.indexOf(key) !== index);
  if (duplicates.length > 0) {
    throw new Error(`${path} has duplicate child keys: ${[...new Set(duplicates)].join(', ')}`);
  }
  const expected = new Set(currentKeys);
  const actual = new Set(nextKeys);
  const missing = currentKeys.filter((key) => !actual.has(key));
  const unknown = nextKeys.filter((key) => !expected.has(key));
  if (missing.length > 0 || unknown.length > 0) {
    throw new Error([
      `${path} must contain exactly the current child directory names.`,
      ...(missing.length > 0 ? [`Missing: ${missing.join(', ')}`] : []),
      ...(unknown.length > 0 ? [`Unknown: ${unknown.join(', ')}`] : []),
      `Expected: ${currentKeys.join(', ') || '(none)'}`,
    ].join('\n'));
  }
  return nextKeys;
}

function reorderByKeys<T>(items: T[], currentKeys: string[], nextKeys: string[]): void {
  const byKey = new Map(currentKeys.map((key, index) => [key, items[index]]));
  items.splice(0, items.length, ...nextKeys.map((key) => byKey.get(key)).filter((item): item is T => item !== undefined));
}

function addSectionBlockLookup(
  entries: Map<string, HvyVirtualEntry>,
  lookup: Map<string, VisualBlock>,
  section: VisualSection,
  sectionPath: string
): void {
  entries.set(sectionPath, { kind: 'dir', path: sectionPath });
  addBlockListLookup(entries, lookup, section.blocks, sectionPath);
  section.children
    .filter((child) => !child.isGhost)
    .forEach((child, index) => addSectionBlockLookup(entries, lookup, child, `${sectionPath}/${uniqueName(sectionDirectoryName(child, index), entries, sectionPath)}`));
}

function addBlockListLookup(entries: Map<string, HvyVirtualEntry>, lookup: Map<string, VisualBlock>, blocks: VisualBlock[], parentPath: string): void {
  blocks.forEach((block, index) => {
    addBlockLookup(entries, lookup, block, `${parentPath}/${uniqueName(blockDirectoryName(block, index), entries, parentPath)}`);
  });
}

function addBlockLookup(entries: Map<string, HvyVirtualEntry>, lookup: Map<string, VisualBlock>, block: VisualBlock, blockPath: string): void {
  entries.set(blockPath, { kind: 'dir', path: blockPath });
  lookup.set(blockPath, block);
  addNamedBlockChildrenLookup(entries, lookup, block.schema.containerBlocks ?? [], `${blockPath}/container`);
  if (block.schema.component === 'component-list') {
    addBlockListLookup(entries, lookup, block.schema.componentListBlocks ?? [], blockPath);
  }
  addNamedBlockChildrenLookup(entries, lookup, block.schema.expandableStubBlocks?.children ?? [], `${blockPath}/expandable-stub`);
  addNamedBlockChildrenLookup(entries, lookup, block.schema.expandableContentBlocks?.children ?? [], `${blockPath}/expandable-content`);
  addNamedBlockChildrenLookup(entries, lookup, (block.schema.gridItems ?? []).map((item) => item.block), `${blockPath}/grid`);
}

function addNamedBlockChildrenLookup(entries: Map<string, HvyVirtualEntry>, lookup: Map<string, VisualBlock>, blocks: VisualBlock[], directoryPath: string): void {
  if (blocks.length === 0) {
    return;
  }
  entries.set(directoryPath, { kind: 'dir', path: directoryPath });
  addBlockListLookup(entries, lookup, blocks, directoryPath);
}

function addSectionInsertionTargets(
  entries: Map<string, HvyVirtualEntry>,
  targets: Map<string, HvyVirtualBlockInsertionTarget>,
  section: VisualSection,
  sectionPath: string
): void {
  entries.set(sectionPath, { kind: 'dir', path: sectionPath });
  targets.set(sectionPath, { kind: 'blocks', insert: (block, index = -1) => insertBlock(section.blocks, block, index) });
  addBlockListInsertionTargets(entries, targets, section.blocks, sectionPath);
  section.children
    .filter((child) => !child.isGhost)
    .forEach((child, index) => addSectionInsertionTargets(entries, targets, child, `${sectionPath}/${uniqueName(sectionDirectoryName(child, index), entries, sectionPath)}`));
}

function addBlockListInsertionTargets(
  entries: Map<string, HvyVirtualEntry>,
  targets: Map<string, HvyVirtualBlockInsertionTarget>,
  blocks: VisualBlock[],
  parentPath: string
): void {
  blocks.forEach((block, index) => {
    addBlockInsertionTargets(entries, targets, block, `${parentPath}/${uniqueName(blockDirectoryName(block, index), entries, parentPath)}`);
  });
}

function addBlockInsertionTargets(
  entries: Map<string, HvyVirtualEntry>,
  targets: Map<string, HvyVirtualBlockInsertionTarget>,
  block: VisualBlock,
  blockPath: string
): void {
  entries.set(blockPath, { kind: 'dir', path: blockPath });
  addNamedBlockChildrenInsertionTarget(entries, targets, block.schema.containerBlocks ?? [], `${blockPath}/container`, block.schema.component === 'container');
  if (block.schema.component === 'component-list') {
    targets.set(blockPath, { kind: 'blocks', insert: (newBlock, index = -1) => insertBlock(block.schema.componentListBlocks, newBlock, index) });
    addBlockListInsertionTargets(entries, targets, block.schema.componentListBlocks ?? [], blockPath);
  }
  addNamedBlockChildrenInsertionTarget(entries, targets, block.schema.expandableStubBlocks?.children ?? [], `${blockPath}/expandable-stub`, block.schema.component === 'expandable');
  addNamedBlockChildrenInsertionTarget(entries, targets, block.schema.expandableContentBlocks?.children ?? [], `${blockPath}/expandable-content`, block.schema.component === 'expandable');
  addGridInsertionTarget(entries, targets, block.schema.gridItems ?? [], `${blockPath}/grid`, block.schema.component === 'grid');
}

function addNamedBlockChildrenInsertionTarget(
  entries: Map<string, HvyVirtualEntry>,
  targets: Map<string, HvyVirtualBlockInsertionTarget>,
  blocks: VisualBlock[],
  directoryPath: string,
  keepEmptyDirectory = false
): void {
  if (blocks.length === 0 && !keepEmptyDirectory) {
    return;
  }
  entries.set(directoryPath, { kind: 'dir', path: directoryPath });
  targets.set(directoryPath, { kind: 'blocks', insert: (block, index = -1) => insertBlock(blocks, block, index) });
  addBlockListInsertionTargets(entries, targets, blocks, directoryPath);
}

function addGridInsertionTarget(
  entries: Map<string, HvyVirtualEntry>,
  targets: Map<string, HvyVirtualBlockInsertionTarget>,
  gridItems: GridItem[],
  directoryPath: string,
  keepEmptyDirectory = false
): void {
  if (gridItems.length === 0 && !keepEmptyDirectory) {
    return;
  }
  entries.set(directoryPath, { kind: 'dir', path: directoryPath });
  targets.set(directoryPath, { kind: 'grid', insert: (block, index = -1) => insertGridItem(gridItems, block, index) });
  addBlockListInsertionTargets(entries, targets, gridItems.map((item) => item.block), directoryPath);
}

function insertBlock(blocks: VisualBlock[], block: VisualBlock, index: number): void {
  blocks.splice(resolveInsertIndex(index, blocks.length), 0, block);
}

function insertGridItem(gridItems: GridItem[], block: VisualBlock, index: number): void {
  const item = { id: makeId('griditem'), block };
  gridItems.splice(resolveInsertIndex(index, gridItems.length), 0, item);
}

function resolveInsertIndex(index: number, childCount: number): number {
  const resolvedIndex = index < 0 ? childCount + index + 1 : index;
  if (resolvedIndex < 0 || resolvedIndex > childCount) {
    throw new Error(`hvy insert: index ${index} is out of range for ${childCount} children. Use 0 for the front or Python-style negative indexes such as -1 for the back.`);
  }
  return resolvedIndex;
}

function sectionToCliJson(section: VisualSection): JsonObject {
  return {
    id: getSectionId(section),
    title: section.title,
    level: section.level,
    lock: section.lock,
    expanded: section.expanded,
    highlight: section.highlight,
    contained: section.contained,
    css: section.css,
    tags: section.tags,
    description: section.description,
    location: section.location,
  };
}

function formatSectionInfo(section: VisualSection): string {
  return [
    formatSectionAbout(section).trimEnd(),
    '',
    'This section',
    `id: ${getSectionId(section) || '(none)'}`,
    `name: ${section.title || '(untitled)'}`,
    `section nesting level: ${section.level}`,
    ...(section.description?.trim() ? [`description: ${section.description.trim()}`] : []),
    ...(section.tags?.trim() ? [`tags: ${section.tags.trim()}`] : []),
    ...(section.location ? [`location: ${section.location}`] : []),
    '',
  ].join('\n');
}

function formatSectionAbout(section: VisualSection): string {
  const helpLines = getHvySectionHelpLines();
  return `${[
    ...(helpLines.length > 0 ? [helpLines[0] ?? ''] : ['# Sections #']),
    ...(section.description?.trim() ? ['', 'Section description:', section.description.trim()] : []),
    '',
    ...(helpLines.length > 1 ? helpLines.slice(1) : helpLines.length === 0 ? ['No section documentation is registered yet.'] : []),
    '',
  ].join('\n')}`;
}

function applySectionJson(section: VisualSection, value: JsonObject): void {
  if (typeof value.id === 'string') section.customId = value.id;
  if (typeof value.title === 'string') section.title = value.title;
  if (typeof value.level === 'number') section.level = Math.max(1, Math.min(6, Math.floor(value.level)));
  if (typeof value.lock === 'boolean') section.lock = value.lock;
  if (typeof value.expanded === 'boolean') section.expanded = value.expanded;
  if (typeof value.highlight === 'boolean') section.highlight = value.highlight;
  if (typeof value.contained === 'boolean') section.contained = value.contained;
  if (typeof value.css === 'string') section.css = value.css;
  if (typeof value.tags === 'string') section.tags = validateTags(value.tags, 'section.json tags');
  if (typeof value.description === 'string') section.description = value.description;
  if (value.location === 'sidebar' || value.location === 'main') section.location = value.location;
}

function blockSchemaToCliJson(schema: BlockSchema): JsonObject {
  const value: JsonObject = {
    id: schema.id,
    css: schema.css,
    lock: schema.lock,
    align: schema.align,
    slot: schema.slot,
    sortKeys: schema.sortKeys,
    tags: schema.tags,
    description: schema.description,
    placeholder: schema.placeholder,
    fillIn: schema.fillIn,
  };
  if (schema.component === 'container') {
    value.containerTitle = schema.containerTitle;
    value.containerExpanded = schema.containerExpanded;
    value.containerCollapsedPreviewRem = schema.containerCollapsedPreviewRem;
  }
  if (schema.component === 'component-list') {
    value.componentListComponent = schema.componentListComponent;
    value.componentListItemLabel = schema.componentListItemLabel;
    value.componentListDefaultSortKey = schema.componentListDefaultSortKey;
    value.componentListDefaultSortDirection = schema.componentListDefaultSortDirection;
    value.componentListDefaultGroupKey = schema.componentListDefaultGroupKey;
    value.componentListGroupCollapsedPreviewRem = schema.componentListGroupCollapsedPreviewRem;
  }
  if (schema.component === 'xref-card') {
    value.xrefTitle = schema.xrefTitle;
    value.xrefDetail = schema.xrefDetail;
    value.xrefTarget = schema.xrefTarget;
  }
  if (schema.component === 'table') {
    value.tableShowHeader = schema.tableShowHeader;
  }
  if (schema.component === 'plugin') {
    value.plugin = schema.plugin;
    value.pluginConfig = schema.pluginConfig;
  }
  return value;
}

function formatComponentAbout(meta: JsonObject, component: string): string {
  const definition = getComponentDefsFromMeta(meta).find((candidate) => candidate.name === component);
  const baseComponent = resolveBaseComponentFromMeta(component, meta);
  const helpLines = getHvyComponentHelpLines(baseComponent);
  const isReusableComponent = !!definition && definition.name !== baseComponent;
  if (!isReusableComponent) {
    return `${(helpLines.length > 0 ? helpLines : [`# ${component} Components #`, 'No component documentation is registered yet.']).join('\n').trimEnd()}\n`;
  }
  const lines = [
    `About ${component}`,
    `reusable component: ${definition.name}`,
    definition.baseType ? `base component: ${definition.baseType}` : '',
    'Edit this reusable component definition in /header.yaml under component_defs.',
    'Reusable definition YAML:',
    '```yaml',
    formatReusableDefinitionYaml(definition),
    '```',
    '',
    'Virtual directory mapping:',
    ...formatComponentDirectoryMapping(component, baseComponent),
    '',
    ...(helpLines.length > 0 ? helpLines : [`${component} component: no component documentation is registered yet.`]),
    '',
  ].filter((line, index, all) => line || all[index - 1] !== '');
  return `${lines.join('\n').trimEnd()}\n`;
}

function formatReusableDefinitionYaml(definition: NonNullable<ReturnType<typeof getComponentDefsFromMeta>[number]>): string {
  const value: JsonObject = {
    name: definition.name,
    baseType: definition.baseType,
  };
  if (definition.description) value.description = definition.description;
  if (definition.tags) value.tags = definition.tags;
  if (definition.schema) value.schema = definition.schema as unknown as JsonObject;
  return stringifyYaml([value]).trimEnd();
}

function formatComponentDirectoryMapping(component: string, baseComponent: string): string[] {
  const configFile = `${component}.json`;
  const bodyFile = `${component}.txt`;
  const lines = [
    `- /${sanitizePathSegment(component) || 'component'} contains one ${component} component instance.`,
    `- ${configFile} is writable instance configuration for this component.`,
    `- ${bodyFile} is the body/preview file for this component when the base type exposes text content.`,
  ];
  if (baseComponent === 'expandable') {
    lines.push('- expandable-stub/ contains the always-visible summary children.');
    lines.push('- expandable-content/ contains the revealed detail children.');
    lines.push("- expandable-stub/children-order.json reorders components inside the expandable's stub.");
    lines.push("- expandable-content/children-order.json reorders components inside the expandable's content.");
  } else if (baseComponent === 'container') {
    lines.push('- container/ contains the ordered child components.');
    lines.push('- container/children-order.json reorders container children.');
  } else if (baseComponent === 'component-list') {
    lines.push('- repeated child item components appear directly as sibling directories in this component-list directory.');
    lines.push('- children-order.json reorders list items.');
  } else if (baseComponent === 'grid') {
    lines.push('- grid/ contains the grid item components.');
    lines.push('- grid/children-order.json reorders grid items.');
  } else if (baseComponent === 'table') {
    lines.push('- tableColumns.json and tableRows.json are writable static table data files.');
  } else if (baseComponent === 'plugin') {
    lines.push('- plugin.txt is plugin-owned body text; plugin.json contains plugin id and config.');
  }
  return lines;
}

function applyBlockSchemaJson(schema: BlockSchema, component: string, value: JsonObject): void {
  schema.component = component;
  if (typeof value.id === 'string') schema.id = value.id;
  if (typeof value.css === 'string') schema.css = value.css;
  if (value.sortKeys && typeof value.sortKeys === 'object' && !Array.isArray(value.sortKeys)) {
    schema.sortKeys = parseSortKeys(value.sortKeys);
  }
  if (typeof value.lock === 'boolean') schema.lock = value.lock;
  if (value.align === 'left' || value.align === 'center' || value.align === 'right') schema.align = value.align;
  if (value.slot === 'left' || value.slot === 'center' || value.slot === 'right') schema.slot = value.slot;
  if (typeof value.tags === 'string') schema.tags = validateTags(value.tags, `${component}.json tags`);
  if (typeof value.description === 'string') schema.description = value.description;
  if (typeof value.placeholder === 'string') schema.placeholder = value.placeholder;
  if (typeof value.fillIn === 'boolean') schema.fillIn = value.fillIn;
  if (typeof value.containerTitle === 'string') schema.containerTitle = value.containerTitle;
  if (typeof value.containerExpanded === 'boolean') schema.containerExpanded = value.containerExpanded;
  if (typeof value.containerCollapsedPreviewRem === 'number' && Number.isFinite(value.containerCollapsedPreviewRem) && value.containerCollapsedPreviewRem > 0) {
    schema.containerCollapsedPreviewRem = value.containerCollapsedPreviewRem;
  }
  if (typeof value.componentListComponent === 'string') schema.componentListComponent = value.componentListComponent;
  if (typeof value.componentListItemLabel === 'string') schema.componentListItemLabel = value.componentListItemLabel;
  if (typeof value.componentListDefaultSortKey === 'string') schema.componentListDefaultSortKey = value.componentListDefaultSortKey;
  if (value.componentListDefaultSortDirection === 'asc' || value.componentListDefaultSortDirection === 'desc') {
    schema.componentListDefaultSortDirection = value.componentListDefaultSortDirection;
  }
  if (typeof value.componentListDefaultGroupKey === 'string') schema.componentListDefaultGroupKey = value.componentListDefaultGroupKey;
  if (typeof value.componentListGroupCollapsedPreviewRem === 'number' && Number.isFinite(value.componentListGroupCollapsedPreviewRem) && value.componentListGroupCollapsedPreviewRem > 0) {
    schema.componentListGroupCollapsedPreviewRem = value.componentListGroupCollapsedPreviewRem;
  }
  if (typeof value.xrefTitle === 'string') schema.xrefTitle = value.xrefTitle;
  if (typeof value.xrefDetail === 'string') schema.xrefDetail = value.xrefDetail;
  if (typeof value.xrefTarget === 'string') schema.xrefTarget = value.xrefTarget;
  if (Array.isArray(value.tableColumns)) schema.tableColumns = parseStringList(value.tableColumns);
  if (typeof value.tableShowHeader === 'boolean') schema.tableShowHeader = value.tableShowHeader;
  if (Array.isArray(value.tableRows)) schema.tableRows = value.tableRows as unknown as BlockSchema['tableRows'];
  if (typeof value.plugin === 'string') schema.plugin = value.plugin;
  if (value.pluginConfig && typeof value.pluginConfig === 'object' && !Array.isArray(value.pluginConfig)) {
    schema.pluginConfig = value.pluginConfig as JsonObject;
  }
}

function readBlockBodyText(block: VisualBlock): string {
  if (block.schema.component === 'table') {
    return formatTableBodyText(block.schema);
  }
  if (block.text) {
    return block.text;
  }
  return collectNestedTextBlocks(block).map((child) => child.text).join('\n');
}

function addTableDataFiles(entries: Map<string, HvyVirtualEntry>, block: VisualBlock, blockPath: string): void {
  if (block.schema.component !== 'table') {
    return;
  }
  entries.set(`${blockPath}/tableColumns.json`, {
    kind: 'file',
    path: `${blockPath}/tableColumns.json`,
    read: () => `${JSON.stringify(getTableColumns(block.schema), null, 2)}\n`,
    write: (content) => {
      block.schema.tableColumns = parseJsonStringArray(content, `${blockPath}/tableColumns.json`);
    },
  });
  entries.set(`${blockPath}/tableRows.json`, {
    kind: 'file',
    path: `${blockPath}/tableRows.json`,
    read: () => `${JSON.stringify(block.schema.tableRows, null, 2)}\n`,
    write: (content) => {
      block.schema.tableRows = parseJsonTableRows(content, `${blockPath}/tableRows.json`);
    },
  });
}

function writeBlockBodyText(block: VisualBlock, content: string): void {
  if (block.schema.component === 'table') {
    throw new Error(
      'table.txt is a read-only preview for static table components. Edit tableColumns.json and tableRows.json instead.'
    );
  }

  const nestedTextBlocks = collectNestedTextBlocks(block);
  if (block.schema.component === 'component-list' && nestedTextBlocks.length === 0) {
    throw new Error(
      'component-list.txt is a read-only preview until list items exist. component-list.json defines the item type and children-order.json controls item order.'
    );
  }

  if (block.text || nestedTextBlocks.length === 0) {
    block.text = content;
    return;
  }

  const lines = content.split('\n');
  if (lines.length !== nestedTextBlocks.length) {
    throw new Error(
      `Nested body edits must preserve one line per nested text block: expected ${nestedTextBlocks.length} line${nestedTextBlocks.length === 1 ? '' : 's'}, got ${lines.length}. Use hvy request_structure COMPONENT_ID --describe to find leaf files, then edit those leaf body/config files instead of replacing the aggregate body.`
    );
  }
  nestedTextBlocks.forEach((child, index) => {
    child.text = lines[index] ?? '';
  });
}

function formatTableBodyText(schema: BlockSchema): string {
  const columns = getTableColumns(schema);
  const rows = schema.tableRows.map((row) => row.cells);
  const lines = [columns, ...rows].map((cells) => cells.map((cell) => cell.trim()).join(' | '));
  return `${lines.join('\n')}\n`;
}

function parseJsonStringArray(content: string, filename: string): string[] {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error(`${filename} must be a JSON array of strings.`);
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${filename} must be a JSON array of strings.`);
  }
  return value;
}

function parseJsonTableRows(content: string, filename: string): BlockSchema['tableRows'] {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error(`${filename} must be a JSON array of row objects with cells arrays.`);
  }
  if (!Array.isArray(value)) {
    throw new Error(`${filename} must be a JSON array of row objects with cells arrays.`);
  }
  return value.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row) || !Array.isArray((row as JsonObject).cells)) {
      throw new Error(`${filename} row ${index + 1} must be an object with a cells array.`);
    }
    return { cells: parseStringList((row as JsonObject).cells as unknown[]) };
  });
}

function parseStringList(value: unknown[]): string[] {
  return value.map((item) => String(item ?? ''));
}

function parseSortKeys(value: object): BlockSchema['sortKeys'] {
  const sortKeys: BlockSchema['sortKeys'] = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'string') {
      sortKeys[key] = raw;
    } else if (typeof raw === 'number' && Number.isFinite(raw)) {
      sortKeys[key] = raw;
    }
  }
  return sortKeys;
}

function addFormScriptFiles(entries: Map<string, HvyVirtualEntry>, block: VisualBlock, blockPath: string): void {
  if (block.schema.component !== 'plugin' || block.schema.plugin !== FORM_PLUGIN_ID) {
    return;
  }
  const parsed = parseFormSpec(block.text, block.schema.pluginConfig);
  if (parsed.error) {
    return;
  }
  for (const scriptName of Object.keys(parsed.spec.scripts)) {
    const filename = uniqueName(`${sanitizePathSegment(scriptName) || 'script'}.py`, entries, blockPath);
    entries.set(`${blockPath}/${filename}`, {
      kind: 'file',
      path: `${blockPath}/${filename}`,
      read: () => parseFormSpec(block.text, block.schema.pluginConfig).spec.scripts[scriptName] ?? '',
      write: (content) => {
        const current = parseFormSpec(block.text, block.schema.pluginConfig);
        if (current.error) {
          throw new Error(`${blockPath}/plugin.txt has invalid form YAML; fix plugin.txt before editing ${filename}.`);
        }
        current.spec.scripts[scriptName] = content;
        block.text = serializeFormSpec(current.spec);
      },
    });
  }
}

function bodyFileNameForBlock(block: VisualBlock): string {
  if (block.schema.component === 'plugin' && block.schema.plugin === SCRIPTING_PLUGIN_ID) {
    return 'script.py';
  }
  return `${sanitizePathSegment(block.schema.component) || 'component'}.txt`;
}

function collectNestedTextBlocks(block: VisualBlock): VisualBlock[] {
  return [
    ...(block.schema.containerBlocks ?? []),
    ...(block.schema.componentListBlocks ?? []),
    ...(block.schema.expandableStubBlocks?.children ?? []),
    ...(block.schema.expandableContentBlocks?.children ?? []),
    ...(block.schema.gridItems ?? []).map((item) => item.block),
  ].flatMap((child) => (child.text ? [child] : collectNestedTextBlocks(child)));
}

function parseJsonObject(content: string, path: string): JsonObject {
  const parsed = JSON.parse(content) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON object.`);
  }
  return parsed as JsonObject;
}

function omitComponentDefs(meta: JsonObject): JsonObject {
  const { component_defs: _componentDefs, ...rest } = meta;
  return rest;
}

function sectionDirectoryName(section: VisualSection, index: number): string {
  return sanitizePathSegment(getSectionId(section)) || `section-${index}`;
}

function blockDirectoryName(block: VisualBlock, index: number): string {
  return sanitizePathSegment(block.schema.id) || `${sanitizePathSegment(block.schema.component) || 'component'}-${index}`;
}

function componentNameFromPath(path: string): string {
  const name = path.split('/').pop() ?? 'text.json';
  return name.replace(/\.json$/i, '') || 'text';
}

function validateTags(value: string, fieldName: string): string {
  if (/[\[\]]/.test(value)) {
    throw new Error(`${fieldName} cannot contain [ or ]. Tags are displayed as tags=[...] by the CLI.`);
  }
  return value;
}

function uniqueName(name: string, entries: Map<string, HvyVirtualEntry>, parentPath: string): string {
  let candidate = name;
  let suffix = 2;
  while (entries.has(`${parentPath}/${candidate}`)) {
    candidate = `${name}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function sanitizePathSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
