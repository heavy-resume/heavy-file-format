import type { VisualBlock, VisualSection } from '../editor/types';
import type { VisualDocument } from '../types';
import { buildDescriptionRequest, generateDescription } from './provider';

export interface PopulateDescriptionsResult {
  updated: number;
}

export async function populateMissingDescriptions(document: VisualDocument, signal?: AbortSignal): Promise<PopulateDescriptionsResult> {
  let updated = 0;
  for (const section of document.sections) {
    updated += await populateSectionDescriptions(document, section, [], signal);
  }
  return { updated };
}

async function populateSectionDescriptions(
  document: VisualDocument,
  section: VisualSection,
  parentTrail: string[],
  signal?: AbortSignal
): Promise<number> {
  signal?.throwIfAborted();
  let updated = 0;
  const sectionLabel = section.title.trim() || section.customId.trim();
  const sectionTrail = sectionLabel ? [...parentTrail, sectionLabel] : parentTrail;
  if (!section.description.trim()) {
    section.description = await generateDescription(buildDescriptionRequest({
      document,
      section,
      kind: 'section',
      parentTrail,
      signal,
    }));
    updated += 1;
  }
  for (const block of section.blocks) {
    updated += await populateBlockDescriptions(document, section, block, sectionTrail, signal);
  }
  for (const child of section.children) {
    updated += await populateSectionDescriptions(document, child, sectionTrail, signal);
  }
  return updated;
}

async function populateBlockDescriptions(
  document: VisualDocument,
  section: VisualSection,
  block: VisualBlock,
  parentTrail: string[],
  signal?: AbortSignal
): Promise<number> {
  signal?.throwIfAborted();
  let updated = 0;
  if (!block.schema.description.trim()) {
    block.schema.description = await generateDescription(buildDescriptionRequest({
      document,
      section,
      block,
      kind: 'block',
      parentTrail,
      signal,
    }));
    updated += 1;
  }
  if (block.schema.component === 'expandable' && !block.schema.expandableStubDescription.trim()) {
    block.schema.expandableStubDescription = await generateDescription(buildDescriptionRequest({
      document,
      section,
      block,
      kind: 'expandable-stub',
      parentTrail,
      signal,
    }));
    updated += 1;
  }
  if (block.schema.component === 'expandable' && !block.schema.expandableContentDescription.trim()) {
    block.schema.expandableContentDescription = await generateDescription(buildDescriptionRequest({
      document,
      section,
      block,
      kind: 'expandable-content',
      parentTrail,
      signal,
    }));
    updated += 1;
  }
  const blockTrail = appendBlockTrail(parentTrail, block);
  for (const child of block.schema.containerBlocks) {
    updated += await populateBlockDescriptions(document, section, child, blockTrail, signal);
  }
  for (const child of block.schema.componentListBlocks) {
    updated += await populateBlockDescriptions(document, section, child, blockTrail, signal);
  }
  for (const child of block.schema.expandableStubBlocks.children) {
    updated += await populateBlockDescriptions(document, section, child, blockTrail, signal);
  }
  for (const child of block.schema.expandableContentBlocks.children) {
    updated += await populateBlockDescriptions(document, section, child, blockTrail, signal);
  }
  for (const item of block.schema.gridItems) {
    updated += await populateBlockDescriptions(document, section, item.block, blockTrail, signal);
  }
  return updated;
}

function appendBlockTrail(parentTrail: string[], block: VisualBlock): string[] {
  const label = block.schema.xrefTitle.trim()
    || block.schema.containerTitle.trim()
    || block.text.replace(/\s+/g, ' ').trim().slice(0, 80)
    || block.schema.imageAlt.trim();
  return label ? [...parentTrail, label] : parentTrail;
}
