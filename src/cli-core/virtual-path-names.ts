import type { VisualBlock, VisualSection } from '../editor/types';
import { getSectionId } from '../section-ops';
import type { HvyVirtualEntrySink, HvyVirtualPathNamingState } from './virtual-file-system';

/** How the CLI names section and component directories. Shared by the directory listings and the `/id` search. */

export function sectionDirectoryName(section: VisualSection, index: number): string {
  return sanitizePathSegment(getSectionId(section)) || `section-${index}`;
}

export function blockDirectoryName(block: VisualBlock, index: number): string {
  return sanitizePathSegment(block.schema.id) || `${sanitizePathSegment(block.schema.component) || 'component'}-${index}`;
}

export function stableBlockDirectoryName(
  block: VisualBlock,
  index: number,
  entries: Pick<HvyVirtualEntrySink, 'has'>,
  parentPath: string,
  naming?: HvyVirtualPathNamingState
): string {
  if (sanitizePathSegment(block.schema.id)) {
    return uniqueName(blockDirectoryName(block, index), entries, parentPath);
  }
  const names = naming?.anonymousBlockNamesById;
  const existing = names?.[block.id];
  if (existing && !entries.has(`${parentPath}/${existing}`)) {
    return existing;
  }
  const key = uniqueName(blockDirectoryName(block, index), entries, parentPath);
  if (names) {
    names[block.id] = key;
  }
  return key;
}

export function uniqueName(name: string, entries: Pick<HvyVirtualEntrySink, 'has'>, parentPath: string): string {
  let candidate = name;
  let suffix = 2;
  while (entries.has(`${parentPath}/${candidate}`)) {
    candidate = `${name}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export function sanitizePathSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The name the item at `index` gets when siblings are named in order and repeated names get `-2`, `-3`, ... */
export function nthUniqueName<T>(items: T[], index: number, nameOf: (item: T, index: number) => string): string {
  const names = new Set<string>();
  let name = '';
  for (let current = 0; current <= index; current += 1) {
    const base = nameOf(items[current]!, current);
    name = base;
    for (let suffix = 2; names.has(name); suffix += 1) {
      name = `${base}-${suffix}`;
    }
    names.add(name);
  }
  return name;
}
