import { syncSortValuesForDocument, syncSortValuesForListItem, syncSortValuesInsideBlock } from '../sort-values';
import { cliBlockMetadata } from './block-metadata-fields';
import { addTemplateMetadataFiles, getTemplateDirectories, templatePathSegment } from './template-directories';
import { parse as parseYaml } from 'yaml';
import { stringifyYamlUnfolded } from '../hvy/yaml-stringify';
import type { BlockSchema, BuiltinComponentName, GridItem, VisualBlock, VisualSection } from '../editor/types';
import type { JsonObject } from '../hvy/types';
import type { VisualDocument } from '../types';
import { getSectionId } from '../section-ops';
import { makeId } from '../utils';
import { FORM_PLUGIN_ID, getHostPlugin, SCRIPTING_PLUGIN_ID } from '../plugins/registry';
import { parseFormSpec, serializeFormSpec } from '../plugins/form-spec/form-spec';
import { getTableColumnProperties, getTableColumns, setTableColumns } from '../table-ops';
import { getHvyComponentHelpLines, getHvySectionHelpLines } from '../component-help';
import { getComponentDefsFromMeta, resolveBaseComponentFromMeta } from '../component-defs';
import { getHvyReferenceDocs } from './reference-library';
import { assertCssValueIsDeclarationString } from '../css-value-validation';
import { coerceGridColumns, coerceGridStackWidth } from '../grid-ops';
import { normalizeTextCaption } from '../caption';
import { isPdfPageMarginsInput } from '../pdf-page-settings';
import { isDocumentParagraphSpacing } from '../document-typography';
import { measurePhase } from '../perf-trace';
import { defaultBlockSchema, parseTableColumnProperties } from '../document-factory';
import { formatPluginVisualDescriptionForAgent, getPluginVisualDescription } from '../plugins/visual-description';
import { findCanonicalIdAliasSourcePath, iterateCanonicalIdAliases, iterateVirtualIdAliasRoots } from './virtual-id-aliases';
import { sanitizePathSegment, sectionDirectoryName, stableBlockDirectoryName, uniqueName } from './virtual-path-names';
import { HvyVirtualTreeEntries } from './virtual-tree-entries';

export interface HvyVirtualFile {
  kind: 'file';
  path: string;
  read: () => string;
  /** `addressedPath` is the path the write came through when that differs from `path`, such as an `/id` alias. */
  write?: (content: string, addressedPath?: string) => void;
  writable?: boolean;
}

export interface HvyVirtualDirectory {
  kind: 'dir';
  path: string;
  /** The section this directory shows, when it shows one. */
  section?: VisualSection;
  /** The component this directory shows, when it shows one. */
  block?: VisualBlock;
  /** Where components created in this directory go, when it holds an ordered list of components. */
  insert?: HvyVirtualBlockInsertionTarget;
  /** The component-list item whose sort and group values depend on this directory's contents, when there is one. */
  listItem?: VisualBlock;
}

export type HvyVirtualEntry = HvyVirtualFile | HvyVirtualDirectory;

export interface HvyVirtualFileSystem {
  entries: HvyVirtualTreeEntries;
}

export interface HvyVirtualPathNamingState {
  anonymousBlockNamesById?: Record<string, string>;
}

/** Where a directory listing puts its entries. */
export interface HvyVirtualEntrySink {
  get(path: string): HvyVirtualEntry | undefined;
  has(path: string): boolean;
  set(path: string, entry: HvyVirtualEntry): unknown;
  /** Adds an entry whose existence is only decided when its own path is looked up or its directory is listed. */
  defer(path: string, resolve: () => HvyVirtualEntry | undefined): unknown;
}

/** A document node whose directory is being listed, for files the caller attaches to nodes. */
export type HvyVirtualNodeFilesTarget =
  | { kind: 'document' }
  | { kind: 'section'; section: VisualSection; path: string }
  | { kind: 'block'; block: VisualBlock; path: string; listItem?: VisualBlock };

/** Adds the entries of one directory. Each subdirectory's own entries are added through `HvyVirtualListingContext.descend`. */
export type HvyVirtualDirectoryLister = (entries: HvyVirtualEntrySink) => void;

export interface HvyVirtualListingContext {
  document: VisualDocument;
  naming?: HvyVirtualPathNamingState;
  /**
   * Lists a subdirectory whose own directory entry the caller has already added.
   * A full build lists it immediately; the live tree lists it only when a path goes through it.
   */
  descend: (path: string, list: HvyVirtualDirectoryLister) => void;
  /**
   * Adds files the caller attaches to body nodes, such as the CLI session's raw HVY files.
   * Called after the node's own entries. Template content has none.
   */
  addNodeFiles?: (entries: HvyVirtualEntrySink, node: HvyVirtualNodeFilesTarget) => void;
  /** The innermost component-list item being listed. Its sort and group values depend on everything listed inside it. */
  listItem?: VisualBlock;
  /** Set for template content, whose list items are not document content and are not synced. */
  ignoresSortValues?: boolean;
}

/**
 * Recalculates the sort and group values a change at this point can affect: the list item that owns this point,
 * and the list items inside `changed` (a block that was just added or replaced).
 */
function syncSortValuesAfterChange(ctx: HvyVirtualListingContext, changed?: VisualBlock): void {
  if (ctx.ignoresSortValues) {
    return;
  }
  if (ctx.listItem) {
    syncSortValuesForListItem(ctx.document.meta, ctx.listItem);
  }
  if (changed) {
    syncSortValuesInsideBlock(ctx.document.meta, changed);
  }
}

export type HvyVirtualBlockInsertionTarget =
  | { kind: 'blocks'; insert: (block: VisualBlock, index?: number) => void }
  | { kind: 'grid'; insert: (block: VisualBlock, index?: number) => void };

/** A view of the live document: every lookup reads the document as it is now, so nothing needs rebuilding after an edit. */
export function createHvyVirtualFileSystem(
  document: VisualDocument,
  naming?: HvyVirtualPathNamingState,
  addNodeFiles?: HvyVirtualListingContext['addNodeFiles']
): HvyVirtualFileSystem {
  return {
    entries: new HvyVirtualTreeEntries({
      context: { document, naming, addNodeFiles },
      listRoot: listVirtualRoot,
      idAliases: () => iterateCanonicalIdAliases(document),
      findIdAliasSourcePath: (name) => findCanonicalIdAliasSourcePath(document, name),
    }),
  };
}

/** Lists `/`. The `/id` alias roots are not listed here: they are found by searching the document. */
export function listVirtualRoot(entries: HvyVirtualEntrySink, ctx: HvyVirtualListingContext): void {
  const { document } = ctx;
  const addDir = (path: string) => entries.set(path, { kind: 'dir', path });

  addDir('/');
  addDir('/body');
  addDir('/attachments');
  addDir('/docs');

  entries.set('/header.yaml', {
    kind: 'file',
    path: '/header.yaml',
    read: () => stringifyYamlUnfolded(omitTemplateDefinitions(document.meta)).trimEnd(),
    write: (content) => {
      const parsed = parseYaml(content);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('/header.yaml must contain a YAML object.');
      }
      const componentDefs = document.meta.component_defs;
      const sectionDefs = document.meta.section_defs;
      if ('component_defs' in parsed || 'section_defs' in parsed) throw new Error('Edit reusable definitions under /templates, not /header.yaml.');
      validateHeaderCssValues(parsed as JsonObject);
      document.meta = {
        ...(parsed as JsonObject),
        ...(componentDefs ? { component_defs: componentDefs } : {}),
        ...(sectionDefs ? { section_defs: sectionDefs } : {}),
      };
    },
  });

  ctx.descend('/body', (sink) => addSectionList(sink, ctx, document.sections, '/body'));
  addDir('/templates');
  ctx.descend('/templates', (sink) => addTemplateFiles(sink, ctx));
  ctx.descend('/docs', (sink) => addDocsDirectory(sink, document.meta));
  addDir('/id');
  ctx.descend('/attachments', (sink) => addAttachmentFiles(sink, document));
  ctx.addNodeFiles?.(entries, { kind: 'document' });
}

function addAttachmentFiles(entries: HvyVirtualEntrySink, document: VisualDocument): void {
  document.attachments.forEach((attachment, index) => {
    const filename = uniqueName(`${sanitizePathSegment(attachment.id) || `attachment-${index}`}.json`, entries, '/attachments');
    entries.set(`/attachments/${filename}`, {
      kind: 'file',
      path: `/attachments/${filename}`,
      read: () => `${JSON.stringify({ id: attachment.id, ...attachment.meta, length: attachment.bytes.length }, null, 2)}\n`,
    });
  });
}

function addTemplateFiles(entries: HvyVirtualEntrySink, ctx: HvyVirtualListingContext): void {
  const { document } = ctx;
  const roots = getTemplateDirectories(document);
  addTemplateMetadataFiles(entries, roots);
  for (const root of roots) {
    const entry = entries.get(`${root.path}/definition.json`);
    if (entry?.kind === 'file' && entry.write) {
      const write = entry.write;
      entry.write = (content) => { write(content); syncSortValuesForDocument(document); };
    }
  }
  for (const root of roots) {
    const commitWrites = (sink: HvyVirtualEntrySink) => sinkRunningAfterWrites(sink, root.commit);
    const templateCtx: HvyVirtualListingContext = {
      ...ctx,
      descend: (path, list) => ctx.descend(path, (sink) => list(commitWrites(sink))),
      addNodeFiles: undefined,
      ignoresSortValues: true,
    };
    if (root.block) addBlock(commitWrites(entries), templateCtx, root.block, root.contentPath);
    if (root.section) addSection(commitWrites(entries), templateCtx, root.section, root.contentPath);
  }
}

/** A sink whose file writes run `afterWrite` once they succeed. */
function sinkRunningAfterWrites(sink: HvyVirtualEntrySink, afterWrite: () => void): HvyVirtualEntrySink {
  const runAfterWrites = (entry: HvyVirtualEntry): HvyVirtualEntry => {
    if (entry.kind === 'file' && entry.write) {
      const write = entry.write;
      entry.write = (content, addressedPath) => { write(content, addressedPath); afterWrite(); };
    }
    if (entry.kind === 'dir' && entry.insert) {
      const target = entry.insert;
      entry.insert = { kind: target.kind, insert: (block, index) => { target.insert(block, index); afterWrite(); } };
    }
    return entry;
  };
  return {
    get: (path) => sink.get(path),
    has: (path) => sink.has(path),
    set: (path, entry) => sink.set(path, runAfterWrites(entry)),
    defer: (path, resolve) => sink.defer(path, () => {
      const entry = resolve();
      return entry && runAfterWrites(entry);
    }),
  };
}

function addDocsDirectory(entries: HvyVirtualEntrySink, meta: JsonObject): void {
  for (const doc of getHvyReferenceDocs()) {
    const filename = uniqueName(doc.filename, entries, '/docs');
    entries.set(`/docs/${filename}`, {
      kind: 'file',
      path: `/docs/${filename}`,
      read: () => `${doc.content.trimEnd()}\n`,
    });
  }
  for (const definition of getComponentDefsFromMeta(meta)) {
    if (!definition.name || definition.name === resolveBaseComponentFromMeta(definition.name, meta)) {
      continue;
    }
    const filename = uniqueName(`about-${sanitizePathSegment(definition.name)}.txt`, entries, '/docs');
    entries.set(`/docs/${filename}`, {
      kind: 'file',
      path: `/docs/${filename}`,
      read: () => formatComponentAbout(meta, definition.name),
    });
  }
}

function validateHeaderCssValues(meta: JsonObject): void {
  const sectionDefaults = meta.section_defaults;
  if (sectionDefaults && typeof sectionDefaults === 'object' && !Array.isArray(sectionDefaults) && typeof (sectionDefaults as JsonObject).css === 'string') {
    assertCssValueIsDeclarationString((sectionDefaults as JsonObject).css as string, 'section_defaults.css');
  }
  if (sectionDefaults && typeof sectionDefaults === 'object' && !Array.isArray(sectionDefaults)) {
    const contained = (sectionDefaults as JsonObject).contained;
    if (typeof contained !== 'undefined' && typeof contained !== 'boolean') {
      throw new Error('section_defaults.contained must be a boolean.');
    }
  }
  const componentDefaults = meta.component_defaults;
  if (componentDefaults && typeof componentDefaults === 'object' && !Array.isArray(componentDefaults)) {
    for (const [componentName, defaults] of Object.entries(componentDefaults)) {
      if (defaults && typeof defaults === 'object' && !Array.isArray(defaults) && typeof (defaults as JsonObject).css === 'string') {
        assertCssValueIsDeclarationString((defaults as JsonObject).css as string, `component_defaults.${componentName}.css`);
      }
    }
  }
  const textLineStyles = meta.text_line_styles;
  if (textLineStyles && typeof textLineStyles === 'object' && !Array.isArray(textLineStyles)) {
    for (const [styleName, style] of Object.entries(textLineStyles)) {
      if (style && typeof style === 'object' && !Array.isArray(style) && typeof (style as JsonObject).css === 'string') {
        assertCssValueIsDeclarationString((style as JsonObject).css as string, `text_line_styles.${styleName}.css`);
      }
    }
  }
  const headingStyles = meta.heading_styles;
  if (headingStyles && typeof headingStyles === 'object' && !Array.isArray(headingStyles)) {
    for (const [styleName, style] of Object.entries(headingStyles)) {
      if (style && typeof style === 'object' && !Array.isArray(style) && typeof (style as JsonObject).css === 'string') {
        assertCssValueIsDeclarationString((style as JsonObject).css as string, `heading_styles.${styleName}.css`);
      }
    }
  }
  const typography = meta.typography;
  if (typeof typography !== 'undefined') {
    if (!typography || typeof typography !== 'object' || Array.isArray(typography)) {
      throw new Error('typography must be an object with a paragraphSpacing CSS length.');
    }
    if (!isDocumentParagraphSpacing((typography as JsonObject).paragraphSpacing)) {
      throw new Error('typography.paragraphSpacing must be a non-negative CSS length such as "0.45rem".');
    }
  }
  const pdfPage = meta.pdf_page;
  if (pdfPage && typeof pdfPage === 'object' && !Array.isArray(pdfPage)) {
    const margins = (pdfPage as JsonObject).margins;
    if (typeof margins !== 'undefined' && !isPdfPageMarginsInput(margins)) {
      throw new Error('pdf_page.margins must be a length such as "0.75in" or "1cm", a [horizontal, vertical] array, or a [left, top, right, bottom] array of non-negative lengths.');
    }
    const debug = (pdfPage as JsonObject).debug;
    if (typeof debug !== 'undefined' && typeof debug !== 'boolean') {
      throw new Error('pdf_page.debug must be a boolean.');
    }
  }
}

export function findVirtualDirectory(document: VisualDocument, path: string, naming?: HvyVirtualPathNamingState): HvyVirtualDirectory | null {
  const entry = createHvyVirtualFileSystem(document, naming).entries.get(normalizeVirtualPath('/', path));
  return entry?.kind === 'dir' ? entry : null;
}

export function findBlockForVirtualDirectory(document: VisualDocument, path: string, naming?: HvyVirtualPathNamingState): VisualBlock | null {
  return findVirtualDirectory(document, path, naming)?.block ?? null;
}

export function findSectionForVirtualDirectory(document: VisualDocument, path: string, naming?: HvyVirtualPathNamingState): VisualSection | null {
  return findVirtualDirectory(document, path, naming)?.section ?? null;
}

export function findBlockInsertionTargetForVirtualDirectory(document: VisualDocument, path: string, naming?: HvyVirtualPathNamingState): HvyVirtualBlockInsertionTarget | null {
  return measurePhase('cli.fs.findBlockInsertionTargetForVirtualDirectory', { path }, () =>
    findVirtualDirectory(document, path, naming)?.insert ?? null
  );
}

export function findVirtualDirectoryForSection(document: VisualDocument, targetSection: VisualSection): string | null {
  for (const directory of createHvyVirtualFileSystem(document).entries.childDirectories('/body')) {
    if (directory.section === targetSection) {
      return directory.path;
    }
  }
  return null;
}

export function findVirtualDirectoryForBlock(document: VisualDocument, targetBlock: VisualBlock): string | null {
  let found: HvyBodyBlockAncestry | null = null;
  visitBodyBlocks(document, (block, ancestry) => {
    found = block === targetBlock ? ancestry() : null;
    return found !== null;
  });
  return found ? findVirtualDirectoryForAncestry(createHvyVirtualFileSystem(document), found) : null;
}

/** A body block with the section and blocks around it, outermost first, ending with the block itself. */
export interface HvyBodyBlockAncestry {
  section: VisualSection;
  blocks: VisualBlock[];
}

/**
 * Visits every body block in document order, following the same child lists the directories show, until `visit`
 * returns true. A plain walk over the blocks: nothing is listed. `ancestry` copies the current chain when called.
 */
export function visitBodyBlocks(document: VisualDocument, visit: (block: VisualBlock, ancestry: () => HvyBodyBlockAncestry) => boolean | void): void {
  const chain: VisualBlock[] = [];
  const visitList = (section: VisualSection, blocks: VisualBlock[]): boolean => {
    for (const block of blocks) {
      chain.push(block);
      const stop = visit(block, () => ({ section, blocks: [...chain] })) === true || visitList(section, childBlocksShownForBlock(document, block));
      chain.pop();
      if (stop) {
        return true;
      }
    }
    return false;
  };
  for (const section of document.sections) {
    if (!section.isGhost && visitList(section, section.blocks)) {
      return;
    }
  }
}

/** The path of a body block from its ancestry, listing only the directories along the way. */
export function findVirtualDirectoryForAncestry(fs: HvyVirtualFileSystem, ancestry: HvyBodyBlockAncestry): string | null {
  return fs.entries.descendThrough('/body', [ancestry.section, ...ancestry.blocks]);
}

/** The child blocks a component's directory shows, in the order its listing shows them. */
function childBlocksShownForBlock(document: VisualDocument, block: VisualBlock): VisualBlock[] {
  const schema = block.schema;
  const lists: VisualBlock[][] = [];
  if (schema.containerBlocks?.length) lists.push(schema.containerBlocks);
  if (schema.componentListBlocks?.length && getBlockBaseComponent(document.meta, block) === 'component-list') lists.push(schema.componentListBlocks);
  if (schema.expandableStubBlocks?.children.length) lists.push(schema.expandableStubBlocks.children);
  if (schema.expandableContentBlocks?.children.length) lists.push(schema.expandableContentBlocks.children);
  if (schema.gridItems?.length) lists.push(schema.gridItems.map((item) => item.block));
  return lists.length === 1 ? lists[0]! : lists.flat();
}

/**
 * Every directory that shows the block, in body or template content:
 * canonical paths first, then `/id` alias paths when requested.
 */
export function findVirtualDirectoriesForBlock(
  document: VisualDocument,
  targetBlock: VisualBlock,
  options: { naming?: HvyVirtualPathNamingState; includeIdAliases?: boolean } = {}
): string[] {
  const fs = createHvyVirtualFileSystem(document, options.naming);
  const pathsUnder = (root: string) => [...fs.entries.directoriesUnder(root)]
    .filter((directory) => directory.block === targetBlock)
    .map((directory) => directory.path);
  const bodyPaths = pathsUnder('/body');
  if (bodyPaths.length > 0) {
    if (!options.includeIdAliases) {
      return bodyPaths;
    }
    const aliasPaths: string[] = [];
    for (const [root, sourcePath] of iterateVirtualIdAliasRoots(iterateCanonicalIdAliases(document))) {
      for (const path of bodyPaths) {
        if (path === sourcePath || path.startsWith(`${sourcePath}/`)) {
          aliasPaths.push(`${root}${path.slice(sourcePath.length)}`);
        }
      }
    }
    return [...bodyPaths, ...aliasPaths];
  }
  for (const root of getTemplateDirectories(document)) {
    const paths = pathsUnder(root.contentPath);
    if (paths.length > 0) {
      return paths;
    }
  }
  return [];
}

export function buildVirtualDirectorySectionLookup(document: VisualDocument, naming?: HvyVirtualPathNamingState): Map<string, VisualSection> {
  const sections = new Map<string, VisualSection>();
  for (const directory of createHvyVirtualFileSystem(document, naming).entries.childDirectories('/body')) {
    if (directory.section) {
      sections.set(directory.path, directory.section);
    }
  }
  return sections;
}

export function buildVirtualDirectoryBlockLookup(document: VisualDocument, naming?: HvyVirtualPathNamingState): Map<string, VisualBlock> {
  const blocks = new Map<string, VisualBlock>();
  for (const directory of createHvyVirtualFileSystem(document, naming).entries.directoriesUnder('/body')) {
    if (directory.block) {
      blocks.set(directory.path, directory.block);
    }
  }
  return blocks;
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
  return fs.entries.listChildPaths(normalizeVirtualPath('/', path))
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

function addSection(entries: HvyVirtualEntrySink, ctx: HvyVirtualListingContext, section: VisualSection, sectionPath: string): void {
  entries.set(sectionPath, {
    kind: 'dir',
    path: sectionPath,
    section,
    insert: {
      kind: 'blocks',
      insert: (block, index = -1) => {
        insertBlock(section.blocks, block, index);
        syncSortValuesAfterChange(ctx, block);
      },
    },
  });
  ctx.descend(sectionPath, (sink) => listSection(sink, ctx, section, sectionPath));
}

function listSection(entries: HvyVirtualEntrySink, ctx: HvyVirtualListingContext, section: VisualSection, sectionPath: string): void {
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
  addBlockList(entries, ctx, section.blocks, sectionPath);
  ctx.addNodeFiles?.(entries, { kind: 'section', section, path: sectionPath });
}

function addSectionList(entries: HvyVirtualEntrySink, ctx: HvyVirtualListingContext, sections: VisualSection[], parentPath: string): void {
  const visibleSections = sections.filter((section) => !section.isGhost);
  const keys: string[] = [];
  visibleSections.forEach((section, index) => {
    const key = uniqueName(sectionDirectoryName(section, index), entries, parentPath);
    keys.push(key);
    addSection(entries, ctx, section, `${parentPath}/${key}`);
  });
  addOrderFile(entries, `${parentPath}/children-order.json`, keys, (nextKeys) =>
    reorderVisibleByKeys(sections, visibleSections, keys, nextKeys)
  );
}

/** `areListItems` marks the blocks as component-list items, each owning the sort and group values of its contents. */
function addBlockList(entries: HvyVirtualEntrySink, ctx: HvyVirtualListingContext, blocks: VisualBlock[], parentPath: string, areListItems = false): void {
  const keys: string[] = [];
  blocks.forEach((block, index) => {
    const key = stableBlockDirectoryName(block, index, entries, parentPath, ctx.naming);
    keys.push(key);
    addBlock(entries, areListItems ? { ...ctx, listItem: block } : ctx, block, `${parentPath}/${key}`);
  });
  addOrderFile(entries, `${parentPath}/children-order.json`, keys, (nextKeys) => {
    reorderByKeys(blocks, keys, nextKeys);
    syncSortValuesAfterChange(ctx);
  });
}

function addBlock(entries: HvyVirtualEntrySink, ctx: HvyVirtualListingContext, block: VisualBlock, blockPath: string): void {
  const isComponentList = getBlockBaseComponent(ctx.document.meta, block) === 'component-list';
  const insertListItem = (item: VisualBlock, index = -1) => {
    insertBlock(block.schema.componentListBlocks, item, index);
    syncSortValuesAfterChange({ ...ctx, listItem: item }, item);
  };
  entries.set(blockPath, {
    kind: 'dir',
    path: blockPath,
    block,
    ...(ctx.listItem ? { listItem: ctx.listItem } : {}),
    ...(isComponentList ? { insert: { kind: 'blocks', insert: insertListItem } } : {}),
  });
  ctx.descend(blockPath, (sink) => listBlock(sink, ctx, block, blockPath));
}

function listBlock(entries: HvyVirtualEntrySink, ctx: HvyVirtualListingContext, block: VisualBlock, blockPath: string): void {
  const { document } = ctx;
  const meta = document.meta;
  const blockEntries = new Map<string, HvyVirtualEntry>();
  const baseComponent = getBlockBaseComponent(meta, block);
  const componentFile = `${blockPath}/${sanitizePathSegment(block.schema.component) || 'component'}.json`;
  blockEntries.set(componentFile, {
    kind: 'file',
    path: componentFile,
    read: () => `${JSON.stringify(blockSchemaToCliJson(block.schema, meta), null, 2)}\n`,
    write: (content) => applyBlockSchemaJson(
      block.schema,
      componentNameFromPath(componentFile),
      baseComponent as BuiltinComponentName,
      parseJsonObject(content, componentFile)
    ),
  });
  const componentName = sanitizePathSegment(block.schema.component) || 'component';
  blockEntries.set(`${blockPath}/${componentName}.css`, {
    kind: 'file',
    path: `${blockPath}/${componentName}.css`,
    read: () => block.schema.css,
    write: (content) => {
      assertCssValueIsDeclarationString(content, `${blockPath}/${componentName}.css`);
      block.schema.css = content.trim();
    },
  });
  const bodyTextFile = `${blockPath}/${bodyFileNameForBlock(block, meta)}`;
  blockEntries.set(bodyTextFile, {
    kind: 'file',
    path: bodyTextFile,
    read: () => readBlockBodyText(block, meta),
    writable: baseComponent === 'table' ? false : undefined,
    write: (content) => {
      writeBlockBodyText(block, meta, content);
    },
  });
  blockEntries.set(`${blockPath}/about-${componentName}.txt`, {
    kind: 'file',
    path: `${blockPath}/about-${componentName}.txt`,
    read: () => formatComponentAbout(meta, block.schema.component),
  });
  addPluginDocumentationFile(blockEntries, block, blockPath);
  addPluginVisualDescriptionFile(blockEntries, document, block, blockPath);
  addTableDataFiles(blockEntries, meta, block, blockPath);
  addFormScriptFiles(blockEntries, block, blockPath);

  for (const [path, entry] of blockEntries) {
    if (entry.kind === 'file' && entry.write && !path.endsWith('.css')) {
      const write = entry.write;
      entry.write = (content) => {
        write(content);
        syncSortValuesAfterChange(ctx);
      };
    }
    entries.set(path, entry);
  }

  addNamedBlockChildren(entries, ctx, block.schema.containerBlocks ?? [], `${blockPath}/container`, baseComponent === 'container');
  if (baseComponent === 'component-list') {
    addBlockList(entries, ctx, block.schema.componentListBlocks ?? [], blockPath, true);
  }
  addNamedBlockChildren(entries, ctx, block.schema.expandableStubBlocks?.children ?? [], `${blockPath}/expandable-stub`, baseComponent === 'expandable');
  addNamedBlockChildren(entries, ctx, block.schema.expandableContentBlocks?.children ?? [], `${blockPath}/expandable-content`, baseComponent === 'expandable');
  addGridItems(entries, ctx, block.schema.gridItems ?? [], `${blockPath}/grid`, baseComponent === 'grid');
  ctx.addNodeFiles?.(entries, { kind: 'block', block, path: blockPath, ...(ctx.listItem ? { listItem: ctx.listItem } : {}) });
}

function addGridItems(entries: HvyVirtualEntrySink, ctx: HvyVirtualListingContext, gridItems: GridItem[], directoryPath: string, keepEmptyDirectory: boolean): void {
  if (gridItems.length === 0 && !keepEmptyDirectory) {
    return;
  }
  entries.set(directoryPath, {
    kind: 'dir',
    path: directoryPath,
    insert: {
      kind: 'grid',
      insert: (block, index = -1) => {
        insertGridItem(gridItems, block, index);
        syncSortValuesAfterChange(ctx, block);
      },
    },
  });
  ctx.descend(directoryPath, (sink) => {
    const keys: string[] = [];
    gridItems.forEach((item, index) => {
      const key = stableBlockDirectoryName(item.block, index, sink, directoryPath, ctx.naming);
      keys.push(key);
      addBlock(sink, ctx, item.block, `${directoryPath}/${key}`);
    });
    addOrderFile(sink, `${directoryPath}/children-order.json`, keys, (nextKeys) => {
      reorderByKeys(gridItems, keys, nextKeys);
      syncSortValuesAfterChange(ctx);
    });
  });
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

function addPluginVisualDescriptionFile(
  entries: Map<string, HvyVirtualEntry>,
  document: VisualDocument,
  block: VisualBlock,
  blockPath: string
): void {
  if (!getPluginVisualDescription(document, block)) {
    return;
  }
  const path = `${blockPath}/plugin.visual-description.txt`;
  entries.set(path, {
    kind: 'file',
    path,
    read: () => `${formatPluginVisualDescriptionForAgent(getPluginVisualDescription(document, block))}\n`,
  });
}

function addNamedBlockChildren(
  entries: HvyVirtualEntrySink,
  ctx: HvyVirtualListingContext,
  blocks: VisualBlock[],
  directoryPath: string,
  keepEmptyDirectory: boolean
): void {
  if (blocks.length === 0 && !keepEmptyDirectory) {
    return;
  }
  entries.set(directoryPath, {
    kind: 'dir',
    path: directoryPath,
    insert: {
      kind: 'blocks',
      insert: (block, index = -1) => {
        insertBlock(blocks, block, index);
        syncSortValuesAfterChange(ctx, block);
      },
    },
  });
  ctx.descend(directoryPath, (sink) => addBlockList(sink, ctx, blocks, directoryPath));
}

function addOrderFile(entries: HvyVirtualEntrySink, path: string, keys: string[], reorder: (nextKeys: string[]) => void): void {
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

function reorderVisibleByKeys<T>(items: T[], visibleItems: T[], currentKeys: string[], nextKeys: string[]): void {
  const reordered = [...visibleItems];
  reorderByKeys(reordered, currentKeys, nextKeys);
  let visibleIndex = 0;
  for (let index = 0; index < items.length; index += 1) {
    if (visibleItems.includes(items[index]!)) {
      items[index] = reordered[visibleIndex]!;
      visibleIndex += 1;
    }
  }
}

function insertBlock(blocks: VisualBlock[], block: VisualBlock, index: number): void {
  blocks.splice(resolveInsertIndex(index, blocks.length), 0, block);
}

function insertGridItem(gridItems: GridItem[], block: VisualBlock, index: number): void {
  const item = { id: makeId('griditem'), idGenerated: true, block };
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
    lock: section.lock,
    editorOnly: section.editorOnly,
    expanded: section.expanded,
    highlight: section.highlight,
    contained: section.contained,
    css: section.css,
    tags: section.tags,
    description: section.description,
    location: section.location,
    hideIfUnmodified: section.hideIfUnmodified === true,
    exclude_from_import: section.exclude_from_import === true,
    templateKey: section.templateKey ?? '',
  };
}

function formatSectionInfo(section: VisualSection): string {
  return [
    formatSectionAbout(section).trimEnd(),
    '',
    'This section',
    `id: ${getSectionId(section) || '(none)'}`,
    `name: ${section.title || '(untitled)'}`,
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
  if (typeof value.id === 'string') {
    section.customId = value.id;
    section.customIdGenerated = false;
  }
  if (typeof value.title === 'string') section.title = value.title;
  if (typeof value.lock === 'boolean') section.lock = value.lock;
  if (typeof value.editorOnly === 'boolean') section.editorOnly = value.editorOnly;
  if (typeof value.expanded === 'boolean') section.expanded = value.expanded;
  if (typeof value.highlight === 'boolean') section.highlight = value.highlight;
  if (typeof value.contained === 'boolean') section.contained = value.contained;
  if (typeof value.css === 'string') {
    assertCssValueIsDeclarationString(value.css, 'section.json css');
    section.css = value.css;
  }
  if (typeof value.tags === 'string') section.tags = validateTags(value.tags, 'section.json tags');
  if (typeof value.description === 'string') section.description = value.description;
  if (value.location === 'sidebar' || value.location === 'main') section.location = value.location;
  if (typeof value.hideIfUnmodified === 'boolean') section.hideIfUnmodified = value.hideIfUnmodified;
  if (typeof value.exclude_from_import === 'boolean') section.exclude_from_import = value.exclude_from_import;
}

function blockSchemaToCliJson(schema: BlockSchema, meta: JsonObject): JsonObject {
  return cliBlockMetadata(schema, resolveBaseComponentFromMeta(schema.component, meta) as BuiltinComponentName);
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
    `component template: ${definition.name}`,
    definition.baseType ? `base component: ${definition.baseType}` : '',
    'Edit this reusable definition under /templates/components. Use ls to discover its directory, then edit definition.json or the nested schema files.',
    `Definition metadata: /templates/components/${templatePathSegment(definition.name)}/definition.json`,
    `Definition contents: /templates/components/${templatePathSegment(definition.name)}/schema/`,
    definition.description ? `Description: ${definition.description}` : '',
    '',
    'Virtual directory mapping:',
    ...formatComponentDirectoryMapping(component, baseComponent),
    '',
    ...(helpLines.length > 0 ? helpLines : [`${component} component: no component documentation is registered yet.`]),
    '',
  ].filter((line, index, all) => line || all[index - 1] !== '');
  return `${lines.join('\n').trimEnd()}\n`;
}

function formatComponentDirectoryMapping(component: string, baseComponent: string): string[] {
  const configFile = `${component}.json`;
  const bodyFile = `${component}.txt`;
  const lines = [
    `- /${sanitizePathSegment(component) || 'component'} contains one ${component} component instance.`,
    `- ${configFile} is writable instance configuration for this component.`,
    `- ${component}.css is writable instance CSS mirrored from ${configFile}.`,
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
    lines.push('- tableColumnProperties.json is a writable sparse presentation map keyed by exact column name.');
  } else if (baseComponent === 'plugin') {
    lines.push('- plugin.txt is plugin-owned body text; plugin.json contains plugin id and config.');
  }
  return lines;
}

function applyBlockSchemaJson(
  schema: BlockSchema,
  component: string,
  baseComponent: BuiltinComponentName,
  value: JsonObject
): void {
  const defaults = defaultBlockSchema(component, baseComponent);
  for (const field of ['expandableStubCss', 'expandableContentCss'] as const) {
    if (baseComponent === 'expandable' && typeof value[field] === 'string') {
      assertCssValueIsDeclarationString(value[field], `${component}.json ${field}`);
    }
  }
  if (baseComponent === 'button' && typeof value.buttonCss === 'string') {
    assertCssValueIsDeclarationString(value.buttonCss, `${component}.json buttonCss`);
  }
  schema.component = component;
  Object.assign(schema, cliBlockMetadata(defaults, baseComponent));
  if (typeof value.id === 'string') schema.id = value.id;
  if (typeof value.css === 'string') {
    assertCssValueIsDeclarationString(value.css, `${component}.json css`);
    schema.css = value.css;
  }
  if (value.sortKeys && typeof value.sortKeys === 'object' && !Array.isArray(value.sortKeys)) {
    schema.sortKeys = parseSortKeys(value.sortKeys);
  }
  if (Array.isArray(value.derivedSortKeyNames)) {
    schema.derivedSortKeyNames = parseStringList(value.derivedSortKeyNames);
  }
  if (Array.isArray(value.derivedGroupKeyNames)) {
    schema.derivedGroupKeyNames = parseStringList(value.derivedGroupKeyNames);
  }
  if (value.groupKeys && typeof value.groupKeys === 'object' && !Array.isArray(value.groupKeys)) {
    schema.groupKeys = parseGroupKeys(value.groupKeys);
  }
  if (typeof value.editorOnly === 'boolean') schema.editorOnly = value.editorOnly;
  if (typeof value.visibleScript === 'string') schema.visibleScript = value.visibleScript;
  if (typeof value.lock === 'boolean') schema.lock = value.lock;
  if (value.align === 'left' || value.align === 'center' || value.align === 'right') schema.align = value.align;
  if (value.slot === 'left' || value.slot === 'center' || value.slot === 'right') schema.slot = value.slot;
  if (typeof value.tags === 'string') schema.tags = validateTags(value.tags, `${component}.json tags`);
  if (typeof value.description === 'string') schema.description = value.description;
  if (typeof value.hideIfYes === 'string') schema.hideIfYes = value.hideIfYes;
  if (typeof value.placeholder === 'string') schema.placeholder = value.placeholder;
  if (typeof value.fillIn === 'boolean') schema.fillIn = value.fillIn;
  if (baseComponent === 'text' && typeof value.showCopy === 'boolean') schema.showCopy = value.showCopy;
  if (baseComponent === 'code' && typeof value.codeLanguage === 'string') schema.codeLanguage = value.codeLanguage;
  if (baseComponent === 'button') {
    for (const field of ['buttonLabel', 'buttonVisibleScript', 'buttonSourceScript', 'buttonPrompt', 'buttonTargetScript', 'buttonPositionTargetId', 'buttonCss'] as const) {
      if (typeof value[field] === 'string') schema[field] = value[field];
    }
    if (value.buttonAction === 'ai-generate') schema.buttonAction = value.buttonAction;
    for (const field of ['buttonInputCharLimit', 'buttonOutputCharLimit'] as const) {
      if (typeof value[field] === 'number' && Number.isFinite(value[field]) && value[field] > 0) schema[field] = value[field];
    }
  }
  if (typeof value.containerTitle === 'string') schema.containerTitle = value.containerTitle;
  if (typeof value.containerExpanded === 'boolean') schema.containerExpanded = value.containerExpanded;
  if (typeof value.noSave === 'boolean') schema.noSave = value.noSave;
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
  if (typeof value.componentListGroupsExpanded === 'boolean') schema.componentListGroupsExpanded = value.componentListGroupsExpanded;
  if (typeof value.componentListGroupCollapsedPreviewRem === 'number' && Number.isFinite(value.componentListGroupCollapsedPreviewRem) && value.componentListGroupCollapsedPreviewRem > 0) {
    schema.componentListGroupCollapsedPreviewRem = value.componentListGroupCollapsedPreviewRem;
  }
  if (typeof value.gridColumns === 'number' || typeof value.gridColumns === 'string') {
    schema.gridColumns = coerceGridColumns(value.gridColumns);
  }
  if (typeof value.gridStackWidth === 'string') {
    schema.gridStackWidth = coerceGridStackWidth(value.gridStackWidth);
  }
  if (typeof value.xrefTitle === 'string') schema.xrefTitle = value.xrefTitle;
  if (typeof value.xrefDetail === 'string') schema.xrefDetail = value.xrefDetail;
  if (typeof value.xrefTarget === 'string') schema.xrefTarget = value.xrefTarget;
  if (typeof value.xrefTargetTagFilter === 'string') schema.xrefTargetTagFilter = value.xrefTargetTagFilter;
  if (Array.isArray(value.tableColumns)) setTableColumns(schema, parseStringList(value.tableColumns));
  if (typeof value.tableShowHeader === 'boolean') schema.tableShowHeader = value.tableShowHeader;
  if (Array.isArray(value.tableRows)) schema.tableRows = value.tableRows as unknown as BlockSchema['tableRows'];
  if (typeof value.imageFile === 'string') schema.imageFile = value.imageFile;
  if (typeof value.imageAlt === 'string') schema.imageAlt = value.imageAlt;
  if (typeof value.allowDocumentImageReuse === 'boolean') schema.allowDocumentImageReuse = value.allowDocumentImageReuse;
  if ('caption' in value) schema.caption = normalizeTextCaption(value.caption);
  if (Array.isArray(value.carouselImages)) schema.carouselImages = value.carouselImages
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const candidate = item as JsonObject;
      const imageFile = typeof candidate.imageFile === 'string' ? candidate.imageFile.trim() : '';
      if (!imageFile) return null;
      return {
        imageFile,
        imageAlt: typeof candidate.imageAlt === 'string' ? candidate.imageAlt : '',
        caption: typeof candidate.caption === 'string' ? candidate.caption : '',
      };
    })
    .filter((item): item is BlockSchema['carouselImages'][number] => item !== null);
  if (typeof value.carouselDurationMs === 'number' && Number.isFinite(value.carouselDurationMs) && value.carouselDurationMs > 0) {
    schema.carouselDurationMs = value.carouselDurationMs;
  }
  if (typeof value.carouselPauseOnHover === 'boolean') schema.carouselPauseOnHover = value.carouselPauseOnHover;
  if (typeof value.carouselShowControls === 'boolean') schema.carouselShowControls = value.carouselShowControls;
  if (typeof value.carouselShowIndicators === 'boolean') schema.carouselShowIndicators = value.carouselShowIndicators;
  if (typeof value.carouselShowFrame === 'boolean') schema.carouselShowFrame = value.carouselShowFrame;
  if (typeof value.plugin === 'string') schema.plugin = value.plugin;
  if (value.pluginConfig && typeof value.pluginConfig === 'object' && !Array.isArray(value.pluginConfig)) {
    schema.pluginConfig = value.pluginConfig as JsonObject;
  }
  if (value.pluginSortValues && typeof value.pluginSortValues === 'object' && !Array.isArray(value.pluginSortValues)) {
    schema.pluginSortValues = parseSortKeys(value.pluginSortValues);
  }
  if (value.pluginGroupValues && typeof value.pluginGroupValues === 'object' && !Array.isArray(value.pluginGroupValues)) {
    schema.pluginGroupValues = parseGroupKeys(value.pluginGroupValues);
  }
  if (baseComponent === 'expandable') {
    if (typeof value.expandableAlwaysShowStub === 'boolean') schema.expandableAlwaysShowStub = value.expandableAlwaysShowStub;
    if (typeof value.expandableExpanded === 'boolean') schema.expandableExpanded = value.expandableExpanded;
    if (value.expandablePresentation === 'inline' || value.expandablePresentation === 'modal') schema.expandablePresentation = value.expandablePresentation;
    if (typeof value.expandableStubCss === 'string') schema.expandableStubCss = value.expandableStubCss;
    if (typeof value.expandableContentCss === 'string') schema.expandableContentCss = value.expandableContentCss;
    if (typeof value.expandableStubDescription === 'string') schema.expandableStubDescription = value.expandableStubDescription;
    if (typeof value.expandableContentDescription === 'string') schema.expandableContentDescription = value.expandableContentDescription;
  }
}

function readBlockBodyText(block: VisualBlock, meta: JsonObject): string {
  const baseComponent = getBlockBaseComponent(meta, block);
  if (baseComponent === 'table') {
    return formatTableBodyText(block.schema);
  }
  if (baseComponent === 'xref-card') {
    return formatXrefCardBodyText(block.schema);
  }
  if (block.text) {
    return block.text;
  }
  return collectNestedTextBlocks(block).map((child) => child.text).join('\n');
}

function addTableDataFiles(entries: Map<string, HvyVirtualEntry>, meta: JsonObject, block: VisualBlock, blockPath: string): void {
  if (getBlockBaseComponent(meta, block) !== 'table') {
    return;
  }
  entries.set(`${blockPath}/tableColumns.json`, {
    kind: 'file',
    path: `${blockPath}/tableColumns.json`,
    read: () => `${JSON.stringify(getTableColumns(block.schema), null, 2)}\n`,
    write: (content) => {
      setTableColumns(block.schema, parseJsonStringArray(content, `${blockPath}/tableColumns.json`));
    },
  });
  entries.set(`${blockPath}/tableColumnProperties.json`, {
    kind: 'file',
    path: `${blockPath}/tableColumnProperties.json`,
    read: () => `${JSON.stringify(Object.fromEntries(
      [...new Set([
        ...getTableColumns(block.schema),
        ...Object.keys(block.schema.tableColumnProperties ?? {}),
      ])].map((column) => [column, getTableColumnProperties(block.schema, column)])
    ), null, 2)}\n`,
    write: (content) => {
      block.schema.tableColumnProperties = parseTableColumnProperties(
        parseJsonObject(content, `${blockPath}/tableColumnProperties.json`)
      );
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

function writeBlockBodyText(block: VisualBlock, meta: JsonObject, content: string): void {
  const baseComponent = getBlockBaseComponent(meta, block);
  if (baseComponent === 'table') {
    throw new Error(
      'table.txt is a read-only preview for static table components. Edit tableColumns.json, tableColumnProperties.json, and tableRows.json instead.'
    );
  }

  const nestedTextBlocks = collectNestedTextBlocks(block);
  if (baseComponent === 'component-list' && nestedTextBlocks.length === 0) {
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

function formatXrefCardBodyText(schema: BlockSchema): string {
  const title = schema.xrefTitle.trim();
  const detail = schema.xrefDetail.trim();
  const target = schema.xrefTarget.trim();
  if (!title && !detail && !target) {
    return '';
  }
  const label = [title, detail].filter(Boolean).join(' - ') || title || target;
  return target ? `${label} -> ${target}\n` : `${label}\n`;
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

function parseGroupKeys(value: object): BlockSchema['groupKeys'] {
  const groupKeys: BlockSchema['groupKeys'] = {};
  Object.entries(value).forEach(([key, raw]) => {
    if (typeof raw === 'string') {
      groupKeys[key] = raw;
    }
  });
  return groupKeys;
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

function getBlockBaseComponent(meta: JsonObject, block: VisualBlock): string {
  return resolveBaseComponentFromMeta(block.schema.component, meta);
}

function bodyFileNameForBlock(block: VisualBlock, meta: JsonObject): string {
  if (getBlockBaseComponent(meta, block) === 'plugin' && block.schema.plugin === SCRIPTING_PLUGIN_ID) {
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

function omitTemplateDefinitions(meta: JsonObject): JsonObject {
  const { component_defs: _componentDefs, section_defs: _sectionDefs, ...rest } = meta;
  return rest;
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


