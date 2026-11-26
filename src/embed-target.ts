import type { VisualDocument } from './types';
import type { VisualBlock } from './editor/types';
import { serializeBlockFragment, serializeSectionFragment } from './serialization';

export interface HvyTarget {
  sectionKey: string;
  blockId?: string;
}

export function exportTargetHvy(document: VisualDocument, target: HvyTarget): string {
  const section = document.sections.find((candidate) => candidate.key === target.sectionKey);
  if (!section) {
    throw new Error(`HVY section target was not found: ${target.sectionKey}`);
  }
  if (!target.blockId) {
    return serializeSectionFragment(section, document.meta);
  }
  const block = findOwnedBlock(section.blocks, target.blockId);
  if (!block) {
    throw new Error(`HVY component target was not found in section ${target.sectionKey}: ${target.blockId}`);
  }
  return serializeBlockFragment(block, document.meta);
}

function findOwnedBlock(blocks: VisualBlock[], blockId: string, seen = new Set<VisualBlock>()): VisualBlock | null {
  for (const block of blocks) {
    if (seen.has(block)) {
      continue;
    }
    seen.add(block);
    if (block.id === blockId) {
      return block;
    }
    const nested = findOwnedBlock([
      ...(block.schema.containerBlocks ?? []),
      ...(block.schema.componentListBlocks ?? []),
      ...(block.schema.gridItems ?? []).map((item) => item.block),
      ...(block.schema.expandableStubBlocks?.children ?? []),
      ...(block.schema.expandableContentBlocks?.children ?? []),
      ...(block.schema.encryptedBlock ? [block.schema.encryptedBlock] : []),
    ], blockId, seen);
    if (nested) {
      return nested;
    }
  }
  return null;
}
