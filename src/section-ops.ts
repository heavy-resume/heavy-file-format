import type { VisualBlock, VisualSection } from './editor/types';
import { createEmptySection } from './document-factory';

export function flattenSections(sections: VisualSection[]): VisualSection[] {
  const output: VisualSection[] = [];
  const walk = (nodes: VisualSection[]): void => {
    nodes.forEach((node) => {
      output.push(node);
      walk(node.children);
    });
  };
  walk(sections);
  return output;
}

export function findSectionByKey(sections: VisualSection[], sectionKey: string): VisualSection | null {
  for (const section of sections) {
    if (section.key === sectionKey) {
      return section;
    }
    const nested = findSectionByKey(section.children, sectionKey);
    if (nested) {
      return nested;
    }
  }
  return null;
}

export function findSectionContainer(
  sections: VisualSection[],
  sectionKey: string,
  parent: VisualSection | null = null
): { container: VisualSection[]; index: number; parent: VisualSection | null } | null {
  const index = sections.findIndex((section) => section.key === sectionKey);
  if (index >= 0) {
    return { container: sections, index, parent };
  }

  for (const section of sections) {
    const nested = findSectionContainer(section.children, sectionKey, section);
    if (nested) {
      return nested;
    }
  }

  return null;
}

export function sectionContainsKey(section: VisualSection, sectionKey: string): boolean {
  if (section.key === sectionKey) {
    return true;
  }
  return section.children.some((child) => sectionContainsKey(child, sectionKey));
}

export function moveSectionRelative(
  sections: VisualSection[],
  draggedKey: string,
  targetKey: string,
  position: 'before' | 'after'
): boolean {
  if (draggedKey === targetKey) {
    return false;
  }

  const draggedLocation = findSectionContainer(sections, draggedKey);
  const targetLocation = findSectionContainer(sections, targetKey);
  if (!draggedLocation || !targetLocation) {
    return false;
  }

  const draggedSection = draggedLocation.container[draggedLocation.index];
  const targetSection = targetLocation.container[targetLocation.index];
  if (!draggedSection || !targetSection || draggedSection.level !== targetSection.level || sectionContainsKey(draggedSection, targetKey)) {
    return false;
  }

  draggedLocation.container.splice(draggedLocation.index, 1);
  const nextTargetLocation = findSectionContainer(sections, targetKey);
  if (!nextTargetLocation) {
    draggedLocation.container.splice(draggedLocation.index, 0, draggedSection);
    return false;
  }

  const insertIndex = position === 'before' ? nextTargetLocation.index : nextTargetLocation.index + 1;
  nextTargetLocation.container.splice(insertIndex, 0, draggedSection);
  return true;
}

export function moveSectionByOffset(sections: VisualSection[], sectionKey: string, offset: -1 | 1): boolean {
  const location = findSectionContainer(sections, sectionKey);
  if (!location) {
    return false;
  }
  const targetIndex = location.index + offset;
  if (targetIndex < 0 || targetIndex >= location.container.length) {
    return false;
  }
  const [movedSection] = location.container.splice(location.index, 1);
  if (!movedSection) {
    return false;
  }
  location.container.splice(targetIndex, 0, movedSection);
  return true;
}

export function moveSectionToSiblingIndex(sections: VisualSection[], sectionKey: string, newPositionIndexFrom0: number): boolean {
  const location = findSectionContainer(sections, sectionKey);
  if (!location || newPositionIndexFrom0 < 0 || newPositionIndexFrom0 >= location.container.length) {
    return false;
  }
  const [movedSection] = location.container.splice(location.index, 1);
  if (!movedSection) {
    return false;
  }
  const insertIndex = Math.min(newPositionIndexFrom0, location.container.length);
  location.container.splice(insertIndex, 0, movedSection);
  return true;
}

export function findBlockContainerById(
  sections: VisualSection[],
  sectionKey: string,
  blockId: string
): { container: VisualBlock[]; index: number; ownerBlockId: string | null } | null {
  const section = findSectionByKey(sections, sectionKey);
  if (!section) {
    return null;
  }
  return findBlockContainerInList(section.blocks, blockId, null);
}

export function findBlockContainerInList(
  blocks: VisualBlock[],
  blockId: string,
  ownerBlockId: string | null
): { container: VisualBlock[]; index: number; ownerBlockId: string | null } | null {
  const index = blocks.findIndex((block) => block.id === blockId);
  if (index >= 0) {
    return { container: blocks, index, ownerBlockId };
  }
  for (const block of blocks) {
    const nested =
      findBlockContainerInList(block.schema.containerBlocks ?? [], blockId, block.id) ??
      findBlockContainerInList(block.schema.componentListBlocks ?? [], blockId, block.id) ??
      findBlockContainerInList((block.schema.gridItems ?? []).map((item) => item.block), blockId, block.id) ??
      findBlockContainerInList(block.schema.expandableStubBlocks?.children ?? [], blockId, block.id) ??
      findBlockContainerInList(block.schema.expandableContentBlocks?.children ?? [], blockId, block.id);
    if (nested) {
      return nested;
    }
  }
  return null;
}

/**
 * Wrap a section-level block in a new subsection inserted in-place: blocks
 * preceding the wrapped block stay in the section's blocks list, blocks following
 * are placed in an auto-generated trailing subsection so visual order is preserved,
 * and the wrapped block is moved into a fresh subsection inserted at the front of
 * the section's children. Returns the new subsection containing the wrapped block,
 * or null on failure.
 */
export function makeBlockSubsection(
  sections: VisualSection[],
  sectionKey: string,
  blockId: string
): VisualSection | null {
  const section = findSectionByKey(sections, sectionKey);
  if (!section) {
    return null;
  }
  const blockIndex = section.blocks.findIndex((b) => b.id === blockId);
  if (blockIndex < 0) {
    return null;
  }
  const [moved] = section.blocks.splice(blockIndex, 1);
  if (!moved) {
    return null;
  }
  const blocksAfter = section.blocks.splice(blockIndex);
  const subLevel = Math.min(section.level + 1, 6);
  const anchor = blockIndex > 0 ? section.blocks[blockIndex - 1].id : '';

  const newSub = createEmptySection(subLevel, '', false);
  newSub.blocks = [moved];
  newSub.location = section.location;
  newSub.renderAfterBlockId = anchor;

  const inserts: VisualSection[] = [newSub];
  if (blocksAfter.length > 0) {
    const tailSub = createEmptySection(subLevel, '', false);
    tailSub.blocks = blocksAfter;
    tailSub.location = section.location;
    tailSub.autoTail = true;
    tailSub.renderAfterBlockId = anchor;
    inserts.push(tailSub);
  }
  section.children.unshift(...inserts);
  return newSub;
}

/**
 * Build an interleaved render sequence for a section. Subsections with
 * `renderAfterBlockId === ''` come before the first block; those anchored to a
 * specific block id render right after that block (in their order in `children`);
 * unanchored subsections render at the end (legacy behavior).
 */
export function buildSectionRenderSequence(
  section: VisualSection
): Array<{ kind: 'block'; block: VisualBlock } | { kind: 'child'; child: VisualSection }> {
  const items: Array<{ kind: 'block'; block: VisualBlock } | { kind: 'child'; child: VisualSection }> = [];
  const childrenAt = (anchor: string | null): VisualSection[] => {
    return section.children.filter((c) => {
      if (anchor === null) return c.renderAfterBlockId == null;
      return c.renderAfterBlockId === anchor;
    });
  };
  childrenAt('').forEach((child) => items.push({ kind: 'child', child }));
  for (const block of section.blocks) {
    items.push({ kind: 'block', block });
    childrenAt(block.id).forEach((child) => items.push({ kind: 'child', child }));
  }
  childrenAt(null).forEach((child) => items.push({ kind: 'child', child }));
  return items;
}

/** Move a section-level block up or down in the visual sequence, swapping with
 * adjacent subsections by repositioning their `renderAfterBlockId` anchor. */
export function moveBlockInVisualSequence(
  sections: VisualSection[],
  sectionKey: string,
  blockId: string,
  offset: -1 | 1
): boolean {
  const section = findSectionByKey(sections, sectionKey);
  if (!section) {
    return false;
  }
  const sequence = buildSectionRenderSequence(section);
  const myIndex = sequence.findIndex((item) => item.kind === 'block' && item.block.id === blockId);
  if (myIndex < 0) {
    return false;
  }
  const targetIndex = myIndex + offset;
  if (targetIndex < 0 || targetIndex >= sequence.length) {
    return false;
  }
  const target = sequence[targetIndex];
  if (target.kind === 'block') {
    const fromIdx = section.blocks.findIndex((b) => b.id === blockId);
    const toIdx = section.blocks.findIndex((b) => b.id === target.block.id);
    if (fromIdx < 0 || toIdx < 0) {
      return false;
    }
    const [removed] = section.blocks.splice(fromIdx, 1);
    section.blocks.splice(toIdx, 0, removed);
    // Re-anchor any children that were anchored to the swapped block ids so
    // their visual position relative to the shifting blocks is preserved.
    return true;
  }
  // Swap with an adjacent subsection by repositioning its anchor.
  const child = target.child;
  if (offset === 1) {
    // Block moves down past subsection: subsection now renders before this block.
    // New anchor: whatever rendered before the block before our move.
    const myBlockIdx = section.blocks.findIndex((b) => b.id === blockId);
    child.renderAfterBlockId = myBlockIdx > 0 ? section.blocks[myBlockIdx - 1].id : '';
  } else {
    // Block moves up past subsection: subsection now renders after this block.
    child.renderAfterBlockId = blockId;
  }
  return true;
}

/**
 * Remove a subsection, merging its blocks into the parent's blocks and its child
 * sections into the parent's children at the position the subsection occupied.
 * If the next sibling is an auto-generated trailing subsection (created by
 * `makeBlockSubsection` to hold blocks following the wrapped one), it is folded
 * back as well so the parent's block sequence is restored symmetrically.
 * Returns true on success; false if the section is not a subsection.
 */
export function removeSubsection(sections: VisualSection[], sectionKey: string): boolean {
  const location = findSectionContainer(sections, sectionKey);
  if (!location || !location.parent) {
    return false;
  }
  const sub = location.container[location.index];
  const parent = location.parent;
  const reLevel = (s: VisualSection, level: number): void => {
    s.level = Math.min(level, 6);
    s.children.forEach((c) => reLevel(c, level + 1));
  };

  const anchor = sub.renderAfterBlockId;
  const insertAt = (() => {
    if (anchor == null) return parent.blocks.length;
    if (anchor === '') return 0;
    const idx = parent.blocks.findIndex((b) => b.id === anchor);
    return idx >= 0 ? idx + 1 : parent.blocks.length;
  })();
  parent.blocks.splice(insertAt, 0, ...sub.blocks);
  sub.children.forEach((c) => reLevel(c, parent.level + 1));
  location.container.splice(location.index, 1, ...sub.children);

  const tailIndex = location.index + sub.children.length;
  const tail = location.container[tailIndex];
  if (tail && tail.autoTail && tail.children.length === 0) {
    const tailAnchor = tail.renderAfterBlockId;
    let tailInsertAt: number;
    if (tailAnchor == null) {
      tailInsertAt = parent.blocks.length;
    } else if (tailAnchor === '') {
      tailInsertAt = insertAt + sub.blocks.length;
    } else if (tailAnchor === anchor) {
      tailInsertAt = insertAt + sub.blocks.length;
    } else {
      const idx = parent.blocks.findIndex((b) => b.id === tailAnchor);
      tailInsertAt = idx >= 0 ? idx + 1 : parent.blocks.length;
    }
    parent.blocks.splice(tailInsertAt, 0, ...tail.blocks);
    location.container.splice(tailIndex, 1);
  }
  return true;
}

export function removeSectionByKey(sections: VisualSection[], sectionKey: string): boolean {
  const index = sections.findIndex((section) => section.key === sectionKey);
  if (index >= 0) {
    sections.splice(index, 1);
    return true;
  }

  for (const section of sections) {
    if (removeSectionByKey(section.children, sectionKey)) {
      return true;
    }
  }

  return false;
}

export function findDuplicateSectionIds(sections: VisualSection[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();

  flattenSections(sections).forEach((section) => {
    const id = getSectionId(section);
    if (seen.has(id)) {
      dupes.add(id);
    }
    seen.add(id);
  });

  return [...dupes];
}

export function getSectionId(section: VisualSection): string {
  return section.customId.trim().length > 0 ? section.customId.trim() : section.key;
}

export function isDefaultUntitledSectionTitle(title: string): boolean {
  return title.trim() === '' || title.trim() === 'Unnamed Section';
}

export function formatSectionTitle(title: string): string {
  return isDefaultUntitledSectionTitle(title) ? 'Unnamed Section' : title;
}

export function visitBlocks(sections: VisualSection[], visitor: (block: VisualBlock) => void): void {
  sections.forEach((section) => {
    visitBlocksInList(section.blocks, visitor);
    visitBlocks(section.children, visitor);
  });
}

export function visitBlocksInList(blocks: VisualBlock[], visitor: (block: VisualBlock) => void): void {
  blocks.forEach((block) => {
    visitor(block);
    visitBlocksInList(block.schema.containerBlocks ?? [], visitor);
    visitBlocksInList(block.schema.componentListBlocks ?? [], visitor);
    visitBlocksInList((block.schema.gridItems ?? []).map((item) => item.block), visitor);
    visitBlocksInList(block.schema.expandableStubBlocks?.children ?? [], visitor);
    visitBlocksInList(block.schema.expandableContentBlocks?.children ?? [], visitor);
  });
}
