import type { HvyVirtualEntry } from './virtual-file-system';

export interface HvyVirtualIdAlias {
  id: string;
  sourcePath: string;
}

/** Names each `/id/<id>` alias root in document order, suffixing repeated ids (`-2`, `-3`, ...). */
export function assignVirtualIdAliasRoots(aliases: readonly HvyVirtualIdAlias[]): Map<string, string> {
  const sourcePathsByRoot = new Map<string, string>();
  for (const alias of aliases) {
    let candidate = alias.id;
    let suffix = 2;
    while (sourcePathsByRoot.has(`/id/${candidate}`)) {
      candidate = `${alias.id}-${suffix}`;
      suffix += 1;
    }
    sourcePathsByRoot.set(`/id/${candidate}`, alias.sourcePath);
  }
  return sourcePathsByRoot;
}

/** Maps an `/id/<id>/...` path onto the canonical path its alias root points at, or null when it is not an alias path. */
export function resolveVirtualIdAliasSourcePath(sourcePathsByRoot: ReadonlyMap<string, string>, path: string): string | null {
  if (!path.startsWith('/id/')) {
    return null;
  }
  const rootEnd = path.indexOf('/', '/id/'.length);
  const root = rootEnd < 0 ? path : path.slice(0, rootEnd);
  const sourcePath = sourcePathsByRoot.get(root);
  return sourcePath === undefined ? null : `${sourcePath}${path.slice(root.length)}`;
}

export function enumerateVirtualPathAncestors(path: string): string[] {
  const ancestors: string[] = [];
  let current = path;
  while (current && current !== '/') {
    ancestors.push(current);
    const next = current.replace(/\/[^/]+$/, '') || '/';
    if (next === current) {
      break;
    }
    current = next;
  }
  return ancestors;
}

/**
 * Virtual file system entries where `/id/<id>/...` behaves like a symlink to the canonical directory.
 * Stored entries are canonical paths plus the alias roots; `get` / `has` resolve alias paths on demand.
 * Entries stored at an alias path (session files, writes) take precedence over the resolved entry.
 * Iteration walks the tree in listing order, so it depends on the document rather than on build history.
 */
export class HvyVirtualEntryMap extends Map<string, HvyVirtualEntry> {
  private idAliasSourcePathsByRoot = new Map<string, string>();
  private resolvedIdAliasEntries = new Map<string, { source: HvyVirtualEntry; entry: HvyVirtualEntry }>();
  // Direct children per directory in first-seen order, including directories only implied by deeper paths.
  private storedChildPathsByParent: Map<string, Set<string>> | null = null;

  setIdAliasRoots(sourcePathsByRoot: Map<string, string>): void {
    this.idAliasSourcePathsByRoot = sourcePathsByRoot;
    for (const root of sourcePathsByRoot.keys()) {
      super.set(root, { kind: 'dir', path: root });
    }
    this.resolvedIdAliasEntries.clear();
  }

  resolveIdAliasSourcePath(path: string): string | null {
    return resolveVirtualIdAliasSourcePath(this.idAliasSourcePathsByRoot, path);
  }

  /** Paths of the direct children of a directory, without producing alias copies for the rest of the tree. */
  listChildPaths(directoryPath: string): string[] {
    const childPaths = new Set<string>();
    const sourcePath = this.resolveIdAliasSourcePath(directoryPath);
    if (sourcePath !== null && sourcePath !== directoryPath) {
      for (const childPath of this.listStoredChildPaths(sourcePath)) {
        childPaths.add(`${directoryPath}${childPath.slice(sourcePath.length)}`);
      }
    }
    for (const childPath of this.listStoredChildPaths(directoryPath)) {
      childPaths.add(childPath);
    }
    return [...childPaths];
  }

  getIdAliasRoots(): ReadonlyMap<string, string> {
    return this.idAliasSourcePathsByRoot;
  }

  /**
   * Replaces every stored entry at or under `rootPath` with `replacement`, keeping the subtree where the old
   * entries sat so sibling listing order matches a fresh build. Returns false when nothing was stored there.
   */
  replaceSubtree(rootPath: string, replacement: ReadonlyMap<string, HvyVirtualEntry>): boolean {
    const prefix = rootPath === '/' ? '/' : `${rootPath}/`;
    const isInSubtree = (path: string) => path === rootPath || path.startsWith(prefix);
    const nextEntries: Array<[string, HvyVirtualEntry]> = [];
    let replaced = false;
    for (const [path, entry] of super.entries()) {
      if (!isInSubtree(path)) {
        nextEntries.push([path, entry]);
      } else if (!replaced) {
        replaced = true;
        nextEntries.push(...replacement);
      }
    }
    if (!replaced) {
      return false;
    }
    super.clear();
    for (const [path, entry] of nextEntries) {
      super.set(path, entry);
    }
    this.storedChildPathsByParent = null;
    return true;
  }

  override get(path: string): HvyVirtualEntry | undefined {
    return super.get(path) ?? this.getIdAliasEntry(path);
  }

  override has(path: string): boolean {
    return super.has(path) || this.getIdAliasEntry(path) !== undefined;
  }

  override set(path: string, entry: HvyVirtualEntry): this {
    super.set(path, entry);
    if (this.storedChildPathsByParent) {
      indexVirtualChildPath(this.storedChildPathsByParent, path);
    }
    return this;
  }

  override delete(path: string): boolean {
    this.storedChildPathsByParent = null;
    return super.delete(path);
  }

  override clear(): void {
    super.clear();
    this.resolvedIdAliasEntries.clear();
    this.storedChildPathsByParent = null;
  }

  override *entries(): MapIterator<[string, HvyVirtualEntry]> {
    const pending = ['/'];
    while (pending.length > 0) {
      const path = pending.pop()!;
      const entry = this.get(path);
      if (entry) {
        yield [path, entry];
      }
      pending.push(...this.listChildPaths(path).reverse());
    }
  }

  override *keys(): MapIterator<string> {
    for (const [path] of this.entries()) {
      yield path;
    }
  }

  override *values(): MapIterator<HvyVirtualEntry> {
    for (const [, entry] of this.entries()) {
      yield entry;
    }
  }

  override [Symbol.iterator](): MapIterator<[string, HvyVirtualEntry]> {
    return this.entries();
  }

  override forEach(callback: (entry: HvyVirtualEntry, path: string, map: Map<string, HvyVirtualEntry>) => void, thisArg?: unknown): void {
    for (const [path, entry] of this.entries()) {
      callback.call(thisArg, entry, path, this);
    }
  }

  private listStoredChildPaths(directoryPath: string): Iterable<string> {
    if (!this.storedChildPathsByParent) {
      this.storedChildPathsByParent = new Map();
      for (const path of super.keys()) {
        indexVirtualChildPath(this.storedChildPathsByParent, path);
      }
    }
    return this.storedChildPathsByParent.get(directoryPath) ?? [];
  }

  private getIdAliasEntry(path: string): HvyVirtualEntry | undefined {
    const sourcePath = this.resolveIdAliasSourcePath(path);
    if (sourcePath === null) {
      return undefined;
    }
    const source = super.get(sourcePath);
    if (!source) {
      return undefined;
    }
    const resolved = this.resolvedIdAliasEntries.get(path);
    if (resolved?.source === source) {
      return resolved.entry;
    }
    const sourceWrite = source.kind === 'file' ? source.write : undefined;
    const entry: HvyVirtualEntry = sourceWrite
      ? { ...source, path, write: (content: string) => sourceWrite(content, path) }
      : { ...source, path };
    this.resolvedIdAliasEntries.set(path, { source, entry });
    return entry;
  }

}

function indexVirtualChildPath(childPathsByParent: Map<string, Set<string>>, path: string): void {
  let childPath = path;
  while (childPath.length > 1) {
    const parentPath = childPath.slice(0, childPath.lastIndexOf('/')) || '/';
    let childPaths = childPathsByParent.get(parentPath);
    if (!childPaths) {
      childPaths = new Set();
      childPathsByParent.set(parentPath, childPaths);
    }
    if (childPaths.has(childPath)) {
      return;
    }
    childPaths.add(childPath);
    childPath = parentPath;
  }
}
