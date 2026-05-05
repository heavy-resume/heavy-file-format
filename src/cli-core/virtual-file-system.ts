import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { BlockSchema, GridItem, VisualBlock, VisualSection } from '../editor/types';
import type { JsonObject } from '../hvy/types';
import type { VisualDocument } from '../types';
import { getSectionId } from '../section-ops';
import { makeId } from '../utils';
import { FORM_PLUGIN_ID, SCRIPTING_PLUGIN_ID } from '../plugins/registry';
import { parseFormSpec, serializeFormSpec } from '../plugins/form';
import { splitColumns } from '../table-ops';

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
  | { kind: 'blocks'; insert: (block: VisualBlock) => void }
  | { kind: 'grid'; insert: (block: VisualBlock) => void };

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

  document.sections
    .filter((section) => !section.isGhost)
    .forEach((section, index) => addSection(entries, section, `/body/${uniqueName(sectionDirectoryName(section, index), entries, '/body')}`));

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
    .filter((entry): entry is HvyVirtualEntry => !!entry)
    .sort((left, right) => left.path.localeCompare(right.path));
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

function addSection(entries: Map<string, HvyVirtualEntry>, section: VisualSection, sectionPath: string): void {
  entries.set(sectionPath, { kind: 'dir', path: sectionPath });
  entries.set(`${sectionPath}/section.json`, {
    kind: 'file',
    path: `${sectionPath}/section.json`,
    read: () => `${JSON.stringify(sectionToCliJson(section), null, 2)}\n`,
    write: (content) => applySectionJson(section, parseJsonObject(content, `${sectionPath}/section.json`)),
  });
  addBlockList(entries, section.blocks, sectionPath);
  section.children
    .filter((child) => !child.isGhost)
    .forEach((child, index) => addSection(entries, child, `${sectionPath}/${uniqueName(sectionDirectoryName(child, index), entries, sectionPath)}`));
}

function addBlockList(entries: Map<string, HvyVirtualEntry>, blocks: VisualBlock[], parentPath: string): void {
  blocks.forEach((block, index) => {
    addBlock(entries, block, `${parentPath}/${uniqueName(blockDirectoryName(block, index), entries, parentPath)}`);
    if (block.schema.component === 'component-list' && block.schema.componentListBlocks?.length) {
      addBlockList(entries, block.schema.componentListBlocks, parentPath);
    }
  });
}

function addBlock(entries: Map<string, HvyVirtualEntry>, block: VisualBlock, blockPath: string): void {
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
  addTableDataFiles(entries, block, blockPath);
  addFormScriptFiles(entries, block, blockPath);

  addNamedBlockChildren(entries, block.schema.containerBlocks ?? [], `${blockPath}/container`);
  addNamedBlockChildren(entries, block.schema.componentListBlocks ?? [], `${blockPath}/component-list`);
  addNamedBlockChildren(entries, block.schema.expandableStubBlocks?.children ?? [], `${blockPath}/expandable-stub`);
  addNamedBlockChildren(entries, block.schema.expandableContentBlocks?.children ?? [], `${blockPath}/expandable-content`);
  addNamedBlockChildren(entries, (block.schema.gridItems ?? []).map((item) => item.block), `${blockPath}/grid`);
}

function addNamedBlockChildren(entries: Map<string, HvyVirtualEntry>, blocks: VisualBlock[], directoryPath: string): void {
  if (blocks.length === 0) {
    return;
  }
  entries.set(directoryPath, { kind: 'dir', path: directoryPath });
  addBlockList(entries, blocks, directoryPath);
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
    if (block.schema.component === 'component-list' && block.schema.componentListBlocks?.length) {
      addBlockListLookup(entries, lookup, block.schema.componentListBlocks, parentPath);
    }
  });
}

function addBlockLookup(entries: Map<string, HvyVirtualEntry>, lookup: Map<string, VisualBlock>, block: VisualBlock, blockPath: string): void {
  entries.set(blockPath, { kind: 'dir', path: blockPath });
  lookup.set(blockPath, block);
  addNamedBlockChildrenLookup(entries, lookup, block.schema.containerBlocks ?? [], `${blockPath}/container`);
  addNamedBlockChildrenLookup(entries, lookup, block.schema.componentListBlocks ?? [], `${blockPath}/component-list`);
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
  targets.set(sectionPath, { kind: 'blocks', insert: (block) => section.blocks.push(block) });
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
    if (block.schema.component === 'component-list' && block.schema.componentListBlocks?.length) {
      addBlockListInsertionTargets(entries, targets, block.schema.componentListBlocks, parentPath);
    }
  });
}

function addBlockInsertionTargets(
  entries: Map<string, HvyVirtualEntry>,
  targets: Map<string, HvyVirtualBlockInsertionTarget>,
  block: VisualBlock,
  blockPath: string
): void {
  entries.set(blockPath, { kind: 'dir', path: blockPath });
  addNamedBlockChildrenInsertionTarget(entries, targets, block.schema.containerBlocks ?? [], `${blockPath}/container`);
  addNamedBlockChildrenInsertionTarget(entries, targets, block.schema.componentListBlocks ?? [], `${blockPath}/component-list`);
  addNamedBlockChildrenInsertionTarget(entries, targets, block.schema.expandableStubBlocks?.children ?? [], `${blockPath}/expandable-stub`);
  addNamedBlockChildrenInsertionTarget(entries, targets, block.schema.expandableContentBlocks?.children ?? [], `${blockPath}/expandable-content`);
  addGridInsertionTarget(entries, targets, block.schema.gridItems ?? [], `${blockPath}/grid`);
}

function addNamedBlockChildrenInsertionTarget(
  entries: Map<string, HvyVirtualEntry>,
  targets: Map<string, HvyVirtualBlockInsertionTarget>,
  blocks: VisualBlock[],
  directoryPath: string
): void {
  if (blocks.length === 0) {
    return;
  }
  entries.set(directoryPath, { kind: 'dir', path: directoryPath });
  targets.set(directoryPath, { kind: 'blocks', insert: (block) => blocks.push(block) });
  addBlockListInsertionTargets(entries, targets, blocks, directoryPath);
}

function addGridInsertionTarget(
  entries: Map<string, HvyVirtualEntry>,
  targets: Map<string, HvyVirtualBlockInsertionTarget>,
  gridItems: GridItem[],
  directoryPath: string
): void {
  if (gridItems.length === 0) {
    return;
  }
  entries.set(directoryPath, { kind: 'dir', path: directoryPath });
  targets.set(directoryPath, { kind: 'grid', insert: (block) => gridItems.push({ id: makeId('griditem'), block }) });
  addBlockListInsertionTargets(entries, targets, gridItems.map((item) => item.block), directoryPath);
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

function applySectionJson(section: VisualSection, value: JsonObject): void {
  if (typeof value.id === 'string') section.customId = value.id;
  if (typeof value.title === 'string') section.title = value.title;
  if (typeof value.level === 'number') section.level = Math.max(1, Math.min(6, Math.floor(value.level)));
  if (typeof value.lock === 'boolean') section.lock = value.lock;
  if (typeof value.expanded === 'boolean') section.expanded = value.expanded;
  if (typeof value.highlight === 'boolean') section.highlight = value.highlight;
  if (typeof value.contained === 'boolean') section.contained = value.contained;
  if (typeof value.css === 'string') section.css = value.css;
  if (typeof value.tags === 'string') section.tags = value.tags;
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
    tags: schema.tags,
    description: schema.description,
    placeholder: schema.placeholder,
  };
  if (schema.component === 'code') value.codeLanguage = schema.codeLanguage;
  if (schema.component === 'component-list') {
    value.componentListComponent = schema.componentListComponent;
    value.componentListItemLabel = schema.componentListItemLabel;
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

function applyBlockSchemaJson(schema: BlockSchema, component: string, value: JsonObject): void {
  schema.component = component;
  if (typeof value.id === 'string') schema.id = value.id;
  if (typeof value.css === 'string') schema.css = value.css;
  if (typeof value.lock === 'boolean') schema.lock = value.lock;
  if (value.align === 'left' || value.align === 'center' || value.align === 'right') schema.align = value.align;
  if (value.slot === 'left' || value.slot === 'center' || value.slot === 'right') schema.slot = value.slot;
  if (typeof value.tags === 'string') schema.tags = value.tags;
  if (typeof value.description === 'string') schema.description = value.description;
  if (typeof value.placeholder === 'string') schema.placeholder = value.placeholder;
  if (typeof value.componentListComponent === 'string') schema.componentListComponent = value.componentListComponent;
  if (typeof value.componentListItemLabel === 'string') schema.componentListItemLabel = value.componentListItemLabel;
  if (typeof value.codeLanguage === 'string') schema.codeLanguage = value.codeLanguage;
  if (typeof value.xrefTitle === 'string') schema.xrefTitle = value.xrefTitle;
  if (typeof value.xrefDetail === 'string') schema.xrefDetail = value.xrefDetail;
  if (typeof value.xrefTarget === 'string') schema.xrefTarget = value.xrefTarget;
  if (typeof value.tableColumns === 'string') schema.tableColumns = value.tableColumns;
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
    read: () => `${JSON.stringify(splitColumns(block.schema.tableColumns), null, 2)}\n`,
    write: (content) => {
      block.schema.tableColumns = parseJsonStringArray(content, `${blockPath}/tableColumns.json`).join(', ');
    },
  });
  entries.set(`${blockPath}/tableRows.json`, {
    kind: 'file',
    path: `${blockPath}/tableRows.json`,
    read: () => `${JSON.stringify(block.schema.tableRows.map((row) => row.cells), null, 2)}\n`,
    write: (content) => {
      block.schema.tableRows = parseJsonTableRows(content, `${blockPath}/tableRows.json`);
    },
  });
}

function writeBlockBodyText(block: VisualBlock, content: string): void {
  if (block.schema.component === 'table') {
    throw new Error(
      'table.txt is a read-only preview for static table components. Edit tableColumns.json and tableRows.json instead, or use hvy add table to create a replacement table.'
    );
  }

  const nestedTextBlocks = collectNestedTextBlocks(block);
  if (block.schema.component === 'component-list' && nestedTextBlocks.length === 0) {
    throw new Error(
      'component-list.txt is a read-only preview until list items exist. Use hvy add ITEM_TYPE PATH/component-list --id NEW_ID to create a list item, then edit that item\'s leaf body/config files.'
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
  const columns = splitColumns(schema.tableColumns);
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
    throw new Error(`${filename} must be a JSON array of string arrays.`);
  }
  if (!Array.isArray(value)) {
    throw new Error(`${filename} must be a JSON array of string arrays.`);
  }
  return value.map((row, index) => {
    if (!Array.isArray(row) || row.some((cell) => typeof cell !== 'string')) {
      throw new Error(`${filename} row ${index + 1} must be a JSON array of strings.`);
    }
    return { cells: row };
  });
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
