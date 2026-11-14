import type { VisualBlock, VisualSection } from '../editor/types';
import { iterateVirtualIdAliasRoots, type HvyVirtualIdAlias } from './virtual-id-aliases';
import type {
  HvyVirtualDirectory,
  HvyVirtualDirectoryLister,
  HvyVirtualEntry,
  HvyVirtualEntrySink,
  HvyVirtualListingContext,
} from './virtual-file-system';

/** An entry whose existence is only decided when its own path is looked up or its directory is listed. */
interface DeferredEntry {
  resolve: () => HvyVirtualEntry | undefined;
  resolved?: { entry: HvyVirtualEntry | undefined };
}

interface DirectoryListing {
  entries: Map<string, HvyVirtualEntry | DeferredEntry>;
  subdirectories: Map<string, HvyVirtualDirectoryLister>;
  /** Paths added through `addNodeFiles`, which are listed after session files placed before them. */
  nodeFilePaths: Set<string>;
  /** Each directory's children among the listed paths, built the first time one is needed. */
  childrenByDirectory?: Map<string, { documentPaths: string[]; nodeFilePaths: string[] }>;
}

/** Where a session file is listed relative to the files the caller attaches to the directory's node. */
export type HvyVirtualSessionFilePlacement = 'before-node-files' | 'after-node-files';

export interface HvyVirtualTreeSource {
  /** The listing context minus `descend`, which the tree owns. */
  context: Omit<HvyVirtualListingContext, 'descend'>;
  listRoot: (entries: HvyVirtualEntrySink, ctx: HvyVirtualListingContext) => void;
  /** Every `/id` alias in document order. */
  idAliases: () => Iterable<HvyVirtualIdAlias>;
  /** The canonical path the `/id/<name>` root points at, or null when there is none. */
  findIdAliasSourcePath: (name: string) => string | null;
}

const emptyListing: DirectoryListing = { entries: new Map(), subdirectories: new Map(), nodeFilePaths: new Set() };

/**
 * The CLI's paths, read from the live document on every lookup. A lookup lists only the directories on its
 * path, so nothing is copied from the document and nothing needs rebuilding after an edit.
 * Entries added with `set` (session files such as the scratchpad) sit on top of the document's entries.
 */
export class HvyVirtualTreeEntries {
  private readonly sessionEntries = new Map<string, HvyVirtualEntry>();
  private readonly sessionPathsBeforeNodeFiles = new Set<string>();
  private recording: Pick<DirectoryListing, 'subdirectories' | 'nodeFilePaths'> | null = null;
  private readonly ctx: HvyVirtualListingContext;

  constructor(private readonly source: HvyVirtualTreeSource) {
    const { addNodeFiles } = source.context;
    this.ctx = {
      ...source.context,
      descend: (path, list) => {
        this.recording?.subdirectories.set(path, list);
      },
      addNodeFiles: addNodeFiles && ((entries, node) => {
        const recordNodeFile = (path: string) => this.recording?.nodeFilePaths.add(path);
        addNodeFiles({
          get: (path) => entries.get(path),
          has: (path) => entries.has(path),
          set: (path, entry) => (recordNodeFile(path), entries.set(path, entry)),
          defer: (path, resolve) => (recordNodeFile(path), entries.defer(path, resolve)),
        }, node);
      }),
    };
  }

  get(path: string): HvyVirtualEntry | undefined {
    const sessionEntry = this.sessionEntries.get(path);
    if (sessionEntry) {
      return sessionEntry;
    }
    const sourcePath = this.resolveIdAliasSourcePath(path);
    if (sourcePath === null) {
      return this.getDocumentEntry(path);
    }
    const source = this.sessionEntries.get(sourcePath) ?? this.getDocumentEntry(sourcePath);
    if (source) {
      return entryAtPath(source, path);
    }
    // An alias root is listed even when its source path cannot be resolved.
    return path.indexOf('/', '/id/'.length) < 0 ? { kind: 'dir', path } : undefined;
  }

  has(path: string): boolean {
    return this.get(path) !== undefined;
  }

  /** Adds a session file. Within its directory it is listed after the document's entries, on the given side of the node's attached files. */
  set(path: string, entry: HvyVirtualEntry, placement: HvyVirtualSessionFilePlacement = 'after-node-files'): this {
    this.sessionEntries.set(path, entry);
    if (placement === 'before-node-files') {
      this.sessionPathsBeforeNodeFiles.add(path);
    } else {
      this.sessionPathsBeforeNodeFiles.delete(path);
    }
    return this;
  }

  delete(path: string): boolean {
    this.sessionPathsBeforeNodeFiles.delete(path);
    return this.sessionEntries.delete(path);
  }

  /** Maps an `/id/<id>/...` path onto the canonical path its alias points at, or null when it is not an alias path. */
  resolveIdAliasSourcePath(path: string): string | null {
    if (!path.startsWith('/id/')) {
      return null;
    }
    const rootEnd = path.indexOf('/', '/id/'.length);
    const root = rootEnd < 0 ? path : path.slice(0, rootEnd);
    const sourcePath = this.source.findIdAliasSourcePath(root.slice('/id/'.length));
    return sourcePath === null ? null : `${sourcePath}${path.slice(root.length)}`;
  }

  /** Paths of the direct children of a directory. */
  listChildPaths(directoryPath: string): string[] {
    if (directoryPath === '/id') {
      return [...new Set([
        ...[...this.idAliasRoots()].map(([root]) => root),
        ...directChildPaths(this.sessionEntries.keys(), '/id'),
      ])];
    }
    const sourcePath = this.resolveIdAliasSourcePath(directoryPath) ?? directoryPath;
    return this.orderedChildPaths(this.listingInside(sourcePath), sourcePath, directoryPath);
  }

  /**
   * Children of the directory shown at `displayDirectory`, whose document entries are listed in `inside` at
   * `sourceDirectory` (the same path except under an `/id` alias). Order: the document's entries, session files
   * placed before node files, the node's attached files, then the other session files.
   */
  private orderedChildPaths(inside: DirectoryListing, sourceDirectory: string, displayDirectory: string): string[] {
    const toDisplay = (path: string) => `${displayDirectory}${path.slice(sourceDirectory.length)}`;
    const listedChildren = listedChildPaths(inside, sourceDirectory);
    const sessionChildPaths = (beforeNodeFiles: boolean) => {
      const paths = [...this.sessionEntries.keys()].filter((path) => this.sessionPathsBeforeNodeFiles.has(path) === beforeNodeFiles);
      return [
        ...directChildPaths(paths, sourceDirectory).map(toDisplay),
        ...(displayDirectory === sourceDirectory ? [] : directChildPaths(paths, displayDirectory)),
      ];
    };
    return [...new Set([
      ...listedChildren.documentPaths.map(toDisplay),
      ...sessionChildPaths(true),
      ...listedChildren.nodeFilePaths.map(toDisplay),
      ...sessionChildPaths(false),
    ])];
  }

  /** Every entry, walking the tree in listing order. Each directory is listed once. */
  entries(): Generator<[string, HvyVirtualEntry]> {
    return this.entriesUnder('/');
  }

  /**
   * The document's directories at and below `directoryPath`, in listing order, without files or session entries.
   * Cheaper than `entriesUnder` for finding which directory shows a section or component.
   */
  *directoriesUnder(directoryPath: string): Generator<HvyVirtualDirectory> {
    const sourcePath = this.resolveIdAliasSourcePath(directoryPath) ?? directoryPath;
    const containing = this.listingContaining(sourcePath);
    const entry = listedEntry(containing, sourcePath);
    if (entry?.kind !== 'dir') {
      return;
    }
    yield entryAtPath(entry, directoryPath) as HvyVirtualDirectory;
    const lister = containing.subdirectories.get(sourcePath);
    yield* this.walkDirectories(lister ? this.listing(lister) : containing, sourcePath, directoryPath);
  }

  /** The document's directories directly inside `directoryPath`, in listing order, without session entries. */
  *childDirectories(directoryPath: string): Generator<HvyVirtualDirectory> {
    const sourcePath = this.resolveIdAliasSourcePath(directoryPath) ?? directoryPath;
    const prefix = sourcePath === '/' ? '/' : `${sourcePath}/`;
    for (const [path, value] of this.listingInside(sourcePath).entries) {
      if ('kind' in value && value.kind === 'dir' && path.startsWith(prefix) && path.indexOf('/', prefix.length) < 0) {
        yield entryAtPath(value, `${directoryPath}${path.slice(sourcePath.length)}`) as HvyVirtualDirectory;
      }
    }
  }

  /**
   * The directory directly inside `directoryPath` that shows `block`, looking through slot directories such as
   * `container/` and `grid/` that hold a component's children. Lists only those directories.
   */
  childDirectoryShowing(directoryPath: string, block: VisualBlock): HvyVirtualDirectory | null {
    const sourcePath = this.resolveIdAliasSourcePath(directoryPath) ?? directoryPath;
    const found = this.findChildShowing(this.listingInside(sourcePath), sourcePath, block);
    return found ? entryAtPath(found.directory, `${directoryPath}${found.directory.path.slice(sourcePath.length)}`) as HvyVirtualDirectory : null;
  }

  /**
   * Follows `nodes` down from `directoryPath`, each one shown by a directory inside the previous one (or inside one
   * of its slot directories). Each directory on the way is listed once. Returns null when a node is not found.
   */
  descendThrough(directoryPath: string, nodes: Array<VisualSection | VisualBlock>): string | null {
    let path = directoryPath;
    let inside = this.listingInside(directoryPath);
    for (const node of nodes) {
      const found = this.findChildShowing(inside, path, node);
      if (!found) {
        return null;
      }
      path = found.directory.path;
      inside = found.inside;
    }
    return path;
  }

  /** A directory shown in `listing` directly inside `directoryPath`, or inside one of its slot directories, that shows `node`. */
  private findChildShowing(
    listing: DirectoryListing,
    directoryPath: string,
    node: VisualSection | VisualBlock
  ): { directory: HvyVirtualDirectory; inside: DirectoryListing } | null {
    const prefix = directoryPath === '/' ? '/' : `${directoryPath}/`;
    const slots: string[] = [];
    for (const [path, value] of listing.entries) {
      if (!('kind' in value) || value.kind !== 'dir' || !path.startsWith(prefix) || path.indexOf('/', prefix.length) >= 0) {
        continue;
      }
      if (value.block === node || value.section === node) {
        return { directory: value, inside: this.listingFor(listing, path) };
      }
      if (!value.block && !value.section) {
        slots.push(path);
      }
    }
    for (const slotPath of slots) {
      const found = this.findChildShowing(this.listingFor(listing, slotPath), slotPath, node);
      if (found) {
        return found;
      }
    }
    return null;
  }

  /** The listing of the entries inside `path`, given the listing that contains `path`. */
  private listingFor(containing: DirectoryListing, path: string): DirectoryListing {
    const lister = containing.subdirectories.get(path);
    return lister ? this.listing(lister) : containing;
  }

  private *walkDirectories(listing: DirectoryListing, sourceRoot: string, displayRoot: string): Generator<HvyVirtualDirectory> {
    const prefix = sourceRoot === '/' ? '/' : `${sourceRoot}/`;
    for (const [path, value] of listing.entries) {
      if (!('kind' in value) || value.kind !== 'dir' || !path.startsWith(prefix)) {
        continue;
      }
      yield entryAtPath(value, `${displayRoot}${path.slice(sourceRoot.length)}`) as HvyVirtualDirectory;
      const lister = listing.subdirectories.get(path);
      if (lister) {
        yield* this.walkDirectories(this.listing(lister), sourceRoot, displayRoot);
      }
    }
  }

  /** The entry at `directoryPath` and everything below it, in listing order. Each directory is listed once. */
  *entriesUnder(directoryPath: string): Generator<[string, HvyVirtualEntry]> {
    const entry = this.get(directoryPath);
    if (!entry) {
      return;
    }
    yield [directoryPath, entry];
    const sourcePath = this.resolveIdAliasSourcePath(directoryPath) ?? directoryPath;
    yield* this.walkChildren(sourcePath, this.listingInside(sourcePath), sourcePath, directoryPath);
  }

  *keys(): Generator<string> {
    for (const [path] of this.entries()) {
      yield path;
    }
  }

  *values(): Generator<HvyVirtualEntry> {
    for (const [, entry] of this.entries()) {
      yield entry;
    }
  }

  [Symbol.iterator](): Generator<[string, HvyVirtualEntry]> {
    return this.entries();
  }

  forEach(callback: (entry: HvyVirtualEntry, path: string) => void): void {
    for (const [path, entry] of this.entries()) {
      callback(entry, path);
    }
  }

  /**
   * Yields the descendants of `sourceDirectory`, whose entries are inside `inside`. Under an `/id` alias the
   * entries are shown at `displayRoot` in place of `sourceRoot`; elsewhere both roots are the same.
   */
  private *walkChildren(
    sourceDirectory: string,
    inside: DirectoryListing,
    sourceRoot: string,
    displayRoot: string
  ): Generator<[string, HvyVirtualEntry]> {
    const toDisplay = (path: string) => `${displayRoot}${path.slice(sourceRoot.length)}`;
    const toSource = (path: string) => `${sourceRoot}${path.slice(displayRoot.length)}`;
    const displayDirectory = toDisplay(sourceDirectory);
    if (displayDirectory === '/id') {
      yield* this.walkIdAliases();
      return;
    }
    for (const displayPath of this.orderedChildPaths(inside, sourceDirectory, displayDirectory)) {
      const sourcePath = toSource(displayPath);
      const source = this.sessionEntries.get(sourcePath) ?? listedEntry(inside, sourcePath);
      const entry = this.sessionEntries.get(displayPath) ?? (source && entryAtPath(source, displayPath));
      if (entry) {
        yield [displayPath, entry];
      }
      if (entry?.kind === 'file') {
        continue;
      }
      const lister = inside.subdirectories.get(sourcePath);
      yield* this.walkChildren(sourcePath, lister ? this.listing(lister) : inside, sourceRoot, displayRoot);
    }
  }

  private *walkIdAliases(): Generator<[string, HvyVirtualEntry]> {
    const roots = new Map(this.idAliasRoots());
    for (const [root, sourcePath] of roots) {
      const source = this.sessionEntries.get(sourcePath) ?? this.getDocumentEntry(sourcePath);
      yield [root, this.sessionEntries.get(root) ?? (source ? entryAtPath(source, root) : { kind: 'dir', path: root })];
      yield* this.walkChildren(sourcePath, this.listingInside(sourcePath), sourcePath, root);
    }
    for (const childPath of directChildPaths(this.sessionEntries.keys(), '/id')) {
      if (roots.has(childPath)) {
        continue;
      }
      const entry = this.sessionEntries.get(childPath);
      if (entry) {
        yield [childPath, entry];
      }
      yield* this.walkChildren(childPath, emptyListing, '/', '/');
    }
  }

  private idAliasRoots(): Generator<[string, string]> {
    return iterateVirtualIdAliasRoots(this.source.idAliases());
  }

  private getDocumentEntry(path: string): HvyVirtualEntry | undefined {
    return listedEntry(this.listingContaining(path), path);
  }

  private rootListing(): DirectoryListing {
    return this.listing((sink) => this.source.listRoot(sink, this.ctx));
  }

  /** Runs one directory's lister, recording its subdirectories without listing them. */
  private listing(list: HvyVirtualDirectoryLister): DirectoryListing {
    const listing: DirectoryListing = { entries: new Map(), subdirectories: new Map(), nodeFilePaths: new Set() };
    const { entries } = listing;
    const previous = this.recording;
    this.recording = listing;
    try {
      list({
        get: (path) => listedEntry(listing, path),
        has: (path) => entries.has(path),
        set: (path, entry) => entries.set(path, entry),
        defer: (path, resolve) => entries.set(path, { resolve }),
      });
    } finally {
      this.recording = previous;
    }
    return listing;
  }

  /** The listing that adds the entry for `path` itself. */
  private listingContaining(path: string): DirectoryListing {
    let current = this.rootListing();
    for (;;) {
      let next: string | null = null;
      for (const subdirectory of current.subdirectories.keys()) {
        if (path.startsWith(`${subdirectory}/`) && (next === null || subdirectory.length > next.length)) {
          next = subdirectory;
        }
      }
      if (next === null) {
        return current;
      }
      current = this.listing(current.subdirectories.get(next)!);
    }
  }

  /** The listing that adds the entries inside the directory at `path`. */
  private listingInside(path: string): DirectoryListing {
    const containing = this.listingContaining(path);
    const lister = containing.subdirectories.get(path);
    return lister ? this.listing(lister) : containing;
  }
}

function listedEntry(listing: DirectoryListing, path: string): HvyVirtualEntry | undefined {
  const value = listing.entries.get(path);
  if (!value || 'kind' in value) {
    return value;
  }
  value.resolved ??= { entry: value.resolve() };
  return value.resolved.entry;
}

/** The direct children of `directoryPath` in a listing, split into the document's entries and the node's attached files. */
function listedChildPaths(listing: DirectoryListing, directoryPath: string): { documentPaths: string[]; nodeFilePaths: string[] } {
  if (!listing.childrenByDirectory) {
    const childrenByDirectory = new Map<string, { documentPaths: string[]; nodeFilePaths: string[] }>();
    const seen = new Set<string>();
    for (const path of listedPaths(listing)) {
      // Directories implied by deeper paths count as children too, in the order they are first seen.
      for (let childPath = path; childPath.length > 1 && !seen.has(childPath);) {
        seen.add(childPath);
        const parentPath = childPath.slice(0, childPath.lastIndexOf('/')) || '/';
        let children = childrenByDirectory.get(parentPath);
        if (!children) {
          children = { documentPaths: [], nodeFilePaths: [] };
          childrenByDirectory.set(parentPath, children);
        }
        (listing.nodeFilePaths.has(childPath) ? children.nodeFilePaths : children.documentPaths).push(childPath);
        childPath = parentPath;
      }
    }
    listing.childrenByDirectory = childrenByDirectory;
  }
  return listing.childrenByDirectory.get(directoryPath) ?? { documentPaths: [], nodeFilePaths: [] };
}

/** Paths a listing adds, leaving out deferred entries that turn out not to exist. */
function* listedPaths(listing: DirectoryListing): Generator<string> {
  for (const path of listing.entries.keys()) {
    if (listedEntry(listing, path)) {
      yield path;
    }
  }
}

/** The entry `source` shown at another path, such as an `/id` alias; writes report the path they came through. */
function entryAtPath(source: HvyVirtualEntry, path: string): HvyVirtualEntry {
  if (source.path === path) {
    return source;
  }
  if (source.kind === 'file' && source.write) {
    const sourceWrite = source.write;
    return { ...source, path, write: (content: string) => sourceWrite(content, path) };
  }
  return { ...source, path };
}

/** Direct children of `directoryPath` among `paths`, in first-seen order, including directories implied by deeper paths. */
function directChildPaths(paths: Iterable<string>, directoryPath: string): string[] {
  const prefix = directoryPath === '/' ? '/' : `${directoryPath}/`;
  const childPaths = new Set<string>();
  for (const path of paths) {
    if (!path.startsWith(prefix) || path === directoryPath) {
      continue;
    }
    const slash = path.indexOf('/', prefix.length);
    childPaths.add(slash < 0 ? path : path.slice(0, slash));
  }
  return [...childPaths];
}
