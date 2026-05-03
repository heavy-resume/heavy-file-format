import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { BlockSchema, VisualBlock, VisualSection } from '../editor/types';
import type { JsonObject } from '../hvy/types';
import type { VisualDocument } from '../types';
import { getSectionId } from '../section-ops';

export interface HvyVirtualFile {
  kind: 'file';
  path: string;
  read: () => string;
  write?: (content: string) => void;
}

export interface HvyVirtualDirectory {
  kind: 'dir';
  path: string;
}

export type HvyVirtualEntry = HvyVirtualFile | HvyVirtualDirectory;

export interface HvyVirtualFileSystem {
  entries: Map<string, HvyVirtualEntry>;
}

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
  blocks.forEach((block, index) => addBlock(entries, block, `${parentPath}/${uniqueName(blockDirectoryName(block, index), entries, parentPath)}`));
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
  entries.set(`${blockPath}/body.txt`, {
    kind: 'file',
    path: `${blockPath}/body.txt`,
    read: () => block.text,
    write: (content) => {
      block.text = content;
    },
  });

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

function sectionToCliJson(section: VisualSection): JsonObject {
  return {
    id: getSectionId(section),
    title: section.title,
    level: section.level,
    lock: section.lock,
    expanded: section.expanded,
    highlight: section.highlight,
    contained: section.contained,
    custom_css: section.customCss,
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
  if (typeof value.custom_css === 'string') section.customCss = value.custom_css;
  if (typeof value.tags === 'string') section.tags = value.tags;
  if (typeof value.description === 'string') section.description = value.description;
  if (value.location === 'sidebar' || value.location === 'main') section.location = value.location;
}

function blockSchemaToCliJson(schema: BlockSchema): JsonObject {
  const value: JsonObject = {
    id: schema.id,
    css: schema.customCss,
    lock: schema.lock,
    align: schema.align,
    slot: schema.slot,
    tags: schema.tags,
    description: schema.description,
    placeholder: schema.placeholder,
  };
  if (schema.component === 'code') value.codeLanguage = schema.codeLanguage;
  if (schema.component === 'xref-card') {
    value.xrefTitle = schema.xrefTitle;
    value.xrefDetail = schema.xrefDetail;
    value.xrefTarget = schema.xrefTarget;
  }
  if (schema.component === 'table') {
    value.tableColumns = schema.tableColumns;
    value.tableShowHeader = schema.tableShowHeader;
    value.tableRows = schema.tableRows as unknown as JsonObject[];
  }
  return value;
}

function applyBlockSchemaJson(schema: BlockSchema, component: string, value: JsonObject): void {
  schema.component = component;
  if (typeof value.id === 'string') schema.id = value.id;
  if (typeof value.css === 'string') schema.customCss = value.css;
  if (typeof value.lock === 'boolean') schema.lock = value.lock;
  if (value.align === 'left' || value.align === 'center' || value.align === 'right') schema.align = value.align;
  if (value.slot === 'left' || value.slot === 'center' || value.slot === 'right') schema.slot = value.slot;
  if (typeof value.tags === 'string') schema.tags = value.tags;
  if (typeof value.description === 'string') schema.description = value.description;
  if (typeof value.placeholder === 'string') schema.placeholder = value.placeholder;
  if (typeof value.codeLanguage === 'string') schema.codeLanguage = value.codeLanguage;
  if (typeof value.xrefTitle === 'string') schema.xrefTitle = value.xrefTitle;
  if (typeof value.xrefDetail === 'string') schema.xrefDetail = value.xrefDetail;
  if (typeof value.xrefTarget === 'string') schema.xrefTarget = value.xrefTarget;
  if (typeof value.tableColumns === 'string') schema.tableColumns = value.tableColumns;
  if (typeof value.tableShowHeader === 'boolean') schema.tableShowHeader = value.tableShowHeader;
  if (Array.isArray(value.tableRows)) schema.tableRows = value.tableRows as unknown as BlockSchema['tableRows'];
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
