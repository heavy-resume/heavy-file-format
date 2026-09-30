import type { VisualBlock, VisualSection } from './editor/types';
import type { VisualDocument } from './types';
import {
  deserializeDocumentWithDiagnostics,
  serializeBlockFragment,
  wrapHvyFragmentAsDocument,
} from './serialization';
import type { HvyTarget } from './embed-target';

export interface HvyTargetReplacementResult {
  previousHvy: string;
  replacementHvy: string;
}

export interface PreparedTargetReplacement {
  section: VisualSection;
  originalBlock: VisualBlock;
  proposedBlock: VisualBlock;
  originalHvy: string;
  proposedHvy: string;
}

export function prepareTargetReplacement(
  document: VisualDocument,
  target: HvyTarget & { blockId: string },
  proposedHvy: string
): PreparedTargetReplacement {
  const section = document.sections.find((candidate) => candidate.key === target.sectionKey);
  if (!section) {
    throw new Error(`HVY section target was not found: ${target.sectionKey}`);
  }
  const originalBlock = findOwnedBlock(section.blocks, target.blockId);
  if (!originalBlock) {
    throw new Error(`HVY component target was not found in section ${target.sectionKey}: ${target.blockId}`);
  }
  const parsed = deserializeDocumentWithDiagnostics(
    wrapHvyFragmentAsDocument(proposedHvy, {
      sectionId: 'target-proposal',
      title: 'Target proposal',
      meta: document.meta,
    }),
    '.hvy'
  );
  const proposedSection = parsed.document.sections[0];
  const proposedBlock = proposedSection?.blocks[0] ?? null;
  const errors = parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  if (!proposedBlock || parsed.document.sections.length !== 1 || proposedSection?.blocks.length !== 1 || errors.length > 0) {
    const details = errors.map((diagnostic) => diagnostic.message).join(' ');
    throw new Error(`Target replacement must be one valid HVY component.${details ? ` ${details}` : ''}`);
  }

  proposedBlock.id = originalBlock.id;
  if (originalBlock.schema.id.trim() && !proposedBlock.schema.id.trim()) {
    proposedBlock.schema.id = originalBlock.schema.id;
  }
  return {
    section,
    originalBlock,
    proposedBlock,
    originalHvy: serializeBlockFragment(originalBlock, document.meta),
    proposedHvy: serializeBlockFragment(proposedBlock, document.meta),
  };
}

export function applyPreparedTargetReplacement(prepared: PreparedTargetReplacement): HvyTargetReplacementResult {
  prepared.originalBlock.text = prepared.proposedBlock.text;
  prepared.originalBlock.schema = prepared.proposedBlock.schema;
  prepared.originalBlock.schemaMode = prepared.proposedBlock.schemaMode;
  return { previousHvy: prepared.originalHvy, replacementHvy: prepared.proposedHvy };
}

function findOwnedBlock(blocks: VisualBlock[], blockId: string, seen = new Set<VisualBlock>()): VisualBlock | null {
  for (const block of blocks) {
    if (seen.has(block)) continue;
    seen.add(block);
    if (block.id === blockId) return block;
    const nested = findOwnedBlock([
      ...(block.schema.containerBlocks ?? []),
      ...(block.schema.componentListBlocks ?? []),
      ...(block.schema.gridItems ?? []).map((item) => item.block),
      ...(block.schema.expandableStubBlocks?.children ?? []),
      ...(block.schema.expandableContentBlocks?.children ?? []),
      ...(block.schema.encryptedBlock ? [block.schema.encryptedBlock] : []),
    ], blockId, seen);
    if (nested) return nested;
  }
  return null;
}
