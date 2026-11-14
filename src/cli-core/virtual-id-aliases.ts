import type { VisualBlock } from '../editor/types';
import type { VisualDocument } from '../types';
import { resolveBaseComponentFromMeta } from '../component-defs';
import { getSectionId } from '../section-ops';
import { blockDirectoryName, nthUniqueName, sanitizePathSegment, sectionDirectoryName } from './virtual-path-names';

/** `/id/<id>` names a component or section by its id. Each root points at the canonical `/body/...` path. */
export interface HvyVirtualIdAlias {
  id: string;
  sourcePath: string;
}

/** Yields `[root, sourcePath]` as each alias root is named, so a search can stop at the root it needs. */
export function* iterateVirtualIdAliasRoots(aliases: Iterable<HvyVirtualIdAlias>): Generator<[string, string]> {
  const roots = new Set<string>();
  for (const alias of aliases) {
    let candidate = alias.id;
    let suffix = 2;
    while (roots.has(`/id/${candidate}`)) {
      candidate = `${alias.id}-${suffix}`;
      suffix += 1;
    }
    roots.add(`/id/${candidate}`);
    yield [`/id/${candidate}`, alias.sourcePath];
  }
}

/** An `/id` alias whose source path is only worked out when asked for. */
interface IdAliasCandidate {
  id: string;
  sourcePath: () => string;
}

/** Every `/id` alias in document order. */
export function iterateCanonicalIdAliases(document: VisualDocument): HvyVirtualIdAlias[] {
  const aliases: HvyVirtualIdAlias[] = [];
  visitIdAliasCandidates(document, (candidate) => {
    aliases.push({ id: candidate.id, sourcePath: candidate.sourcePath() });
    return false;
  });
  return aliases;
}

/**
 * The canonical path an `/id/<name>` root points at, found by searching the document in order.
 * Only the matching node's path is worked out. A name without a `-<number>` suffix belongs to the first node
 * with that id; a suffixed name can also be a repeated id's numbered root, so those follow the numbering.
 */
export function findCanonicalIdAliasSourcePath(document: VisualDocument, name: string): string | null {
  let match: IdAliasCandidate | null = null;
  if (!/-\d+$/.test(name)) {
    visitIdAliasCandidates(document, (candidate) => {
      match = candidate.id === name ? candidate : null;
      return match !== null;
    });
  } else {
    const roots = new Set<string>();
    visitIdAliasCandidates(document, (candidate) => {
      let root = candidate.id;
      for (let suffix = 2; roots.has(root); suffix += 1) {
        root = `${candidate.id}-${suffix}`;
      }
      roots.add(root);
      match = root === name ? candidate : null;
      return match !== null;
    });
  }
  return (match as IdAliasCandidate | null)?.sourcePath() ?? null;
}

/** Calls `visit` for each `/id` alias in document order until it returns true. Returns whether it stopped early. */
function visitIdAliasCandidates(document: VisualDocument, visit: (candidate: IdAliasCandidate) => boolean): boolean {
  const offer = (id: string, sourcePath: () => string): boolean => {
    if (!id) {
      return false;
    }
    const normalized = sanitizePathSegment(id);
    return normalized ? visit({ id: normalized, sourcePath }) : false;
  };
  const visitNested = (block: VisualBlock, blockPath: () => string): boolean => {
    const schema = block.schema;
    if (schema.containerBlocks?.length && visitList(schema.containerBlocks, () => `${blockPath()}/container`)) return true;
    if (schema.componentListBlocks?.length && resolveBaseComponentFromMeta(block.schema.component, document.meta) === 'component-list' && visitList(schema.componentListBlocks, blockPath)) return true;
    if (schema.expandableStubBlocks?.children.length && visitList(schema.expandableStubBlocks.children, () => `${blockPath()}/expandable-stub`)) return true;
    if (schema.expandableContentBlocks?.children.length && visitList(schema.expandableContentBlocks.children, () => `${blockPath()}/expandable-content`)) return true;
    const gridItems = schema.gridItems ?? [];
    for (let index = 0; index < gridItems.length; index += 1) {
      const item = gridItems[index]!;
      const itemPath = once(() => `${blockPath()}/grid/${nthUniqueName(gridItems.map((gridItem) => gridItem.block), index, blockDirectoryName)}`);
      if (offer(item.id, itemPath)) return true;
      if (sanitizePathSegment(item.block.schema.id) !== sanitizePathSegment(item.id) && offer(item.block.schema.id, itemPath)) return true;
      if (visitNested(item.block, itemPath)) return true;
    }
    return false;
  };
  const visitList = (blocks: VisualBlock[], parentPath: () => string): boolean => {
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index]!;
      const blockPath = once(() => `${parentPath()}/${nthUniqueName(blocks, index, blockDirectoryName)}`);
      if (offer(block.schema.id, blockPath) || visitNested(block, blockPath)) return true;
    }
    return false;
  };
  const sections = document.sections.filter((section) => !section.isGhost);
  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index]!;
    const sectionPath = once(() => `/body/${nthUniqueName(sections, index, sectionDirectoryName)}`);
    if (offer(getSectionId(section), sectionPath) || visitList(section.blocks, sectionPath)) return true;
  }
  return false;
}

function once<T>(compute: () => T): () => T {
  let result: { value: T } | null = null;
  return () => {
    result ??= { value: compute() };
    return result.value;
  };
}
