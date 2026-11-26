import type { VisualBlock, VisualSection } from '../editor/types';
import type { VisualDocument } from '../types';
import { resolveBaseComponentFromMeta } from '../component-defs';
import { getSectionId } from '../section-ops';
import { sanitizePathSegment } from './virtual-path-names';

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

/** The `/body/...` path of a node, given the section and blocks leading to it, outermost first. */
export type HvyVirtualNodePath = (nodes: Array<VisualSection | VisualBlock>) => string | null;

/** An `/id` alias whose source path is only worked out when asked for. */
interface IdAliasCandidate {
  id: string;
  sourcePath: () => string | null;
}

/** The nodes leading to the one being visited, kept as a chain so a candidate can capture it without copying. */
interface NodeChain {
  node: VisualSection | VisualBlock;
  parent: NodeChain | null;
}

/** Every `/id` alias in document order. Source paths come from `pathOf`, so they match the directory listing. */
export function iterateCanonicalIdAliases(document: VisualDocument, pathOf: HvyVirtualNodePath): HvyVirtualIdAlias[] {
  const aliases: HvyVirtualIdAlias[] = [];
  visitIdAliasCandidates(document, pathOf, (candidate) => {
    const sourcePath = candidate.sourcePath();
    if (sourcePath !== null) {
      aliases.push({ id: candidate.id, sourcePath });
    }
    return false;
  });
  return aliases;
}

/**
 * The canonical path an `/id/<name>` root points at, found by searching the document in order.
 * Only the matching node's path is worked out. A name without a `-<number>` suffix belongs to the first node
 * with that id; a suffixed name can also be a repeated id's numbered root, so those follow the numbering.
 */
export function findCanonicalIdAliasSourcePath(document: VisualDocument, name: string, pathOf: HvyVirtualNodePath): string | null {
  let match: IdAliasCandidate | null = null;
  if (!/-\d+$/.test(name)) {
    visitIdAliasCandidates(document, pathOf, (candidate) => {
      match = candidate.id === name ? candidate : null;
      return match !== null;
    });
  } else {
    const roots = new Set<string>();
    visitIdAliasCandidates(document, pathOf, (candidate) => {
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

/**
 * Calls `visit` for each `/id` alias in document order until it returns true, following the same child lists the
 * directories show. Returns whether it stopped early.
 */
function visitIdAliasCandidates(document: VisualDocument, pathOf: HvyVirtualNodePath, visit: (candidate: IdAliasCandidate) => boolean): boolean {
  const pathOfChain = (chain: NodeChain) => () => {
    const nodes: Array<VisualSection | VisualBlock> = [];
    for (let current: NodeChain | null = chain; current; current = current.parent) {
      nodes.unshift(current.node);
    }
    return pathOf(nodes);
  };
  const offer = (id: string, sourcePath: () => string | null): boolean => {
    if (!id) {
      return false;
    }
    const normalized = sanitizePathSegment(id);
    return normalized ? visit({ id: normalized, sourcePath }) : false;
  };
  const visitNested = (block: VisualBlock, chain: NodeChain): boolean => {
    const schema = block.schema;
    if (schema.containerBlocks?.length && visitList(schema.containerBlocks, chain)) return true;
    if (schema.componentListBlocks?.length && resolveBaseComponentFromMeta(block.schema.component, document.meta) === 'component-list' && visitList(schema.componentListBlocks, chain)) return true;
    if (schema.expandableStubBlocks?.children.length && visitList(schema.expandableStubBlocks.children, chain)) return true;
    if (schema.expandableContentBlocks?.children.length && visitList(schema.expandableContentBlocks.children, chain)) return true;
    for (const item of schema.gridItems ?? []) {
      const itemChain = { node: item.block, parent: chain };
      const itemPath = pathOfChain(itemChain);
      if (offer(item.id, itemPath)) return true;
      if (sanitizePathSegment(item.block.schema.id) !== sanitizePathSegment(item.id) && offer(item.block.schema.id, itemPath)) return true;
      if (visitNested(item.block, itemChain)) return true;
    }
    return false;
  };
  const visitList = (blocks: VisualBlock[], parent: NodeChain): boolean => {
    for (const block of blocks) {
      const chain = { node: block, parent };
      if (offer(block.schema.id, pathOfChain(chain)) || visitNested(block, chain)) return true;
    }
    return false;
  };
  for (const section of document.sections) {
    if (section.isGhost) {
      continue;
    }
    const chain = { node: section, parent: null };
    if (offer(getSectionId(section), pathOfChain(chain)) || visitList(section.blocks, chain)) return true;
  }
  return false;
}
