import type { VisualBlock, VisualSection } from './editor/types';

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
