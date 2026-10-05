import type { VisualBlock, VisualSection } from './editor/types';

export function visitBlocks(sections: VisualSection[], visitor: (block: VisualBlock) => void): void {
  const seen = new Set<VisualBlock>();
  sections.forEach((section) => {
    visitBlocksInList(section.blocks, visitor, seen);
  });
}

export function visitBlocksInList(
  blocks: VisualBlock[],
  visitor: (block: VisualBlock) => void,
  seen = new Set<VisualBlock>()
): void {
  blocks.forEach((block) => {
    if (seen.has(block)) {
      return;
    }
    seen.add(block);
    visitor(block);
    visitBlocksInList(block.schema.containerBlocks ?? [], visitor, seen);
    visitBlocksInList(block.schema.componentListBlocks ?? [], visitor, seen);
    visitBlocksInList((block.schema.gridItems ?? []).map((item) => item.block), visitor, seen);
    visitBlocksInList(block.schema.expandableStubBlocks?.children ?? [], visitor, seen);
    visitBlocksInList(block.schema.expandableContentBlocks?.children ?? [], visitor, seen);
    if (block.schema.kind === 'encrypted' && block.schema.encryptedBlock) {
      visitBlocksInList([block.schema.encryptedBlock], visitor, seen);
    }
  });
}
