import type { VisualBlock, VisualSection } from '../editor/types';
import type { VisualDocument } from '../types';
import { buildDescriptionRequest, generateDescription } from './provider';
import type { HvyDescriptionParentContext } from './types';

export interface PopulateDescriptionsResult {
  updated: number;
}

export async function populateMissingDescriptions(document: VisualDocument, signal?: AbortSignal): Promise<PopulateDescriptionsResult> {
  let updated = 0;
  for (const section of document.sections) {
    updated += await populateSectionDescriptions(document, section, [], [], signal);
  }
  return { updated };
}

async function populateSectionDescriptions(
  document: VisualDocument,
  section: VisualSection,
  parentTrail: string[],
  parentTree: HvyDescriptionParentContext[],
  signal?: AbortSignal
): Promise<number> {
  signal?.throwIfAborted();
  let updated = 0;
  const sectionLabel = section.title.trim() || section.customId.trim();
  const sectionTrail = sectionLabel ? [...parentTrail, sectionLabel] : parentTrail;
  let sectionTree = sectionLabel
    ? [...parentTree, { label: sectionLabel, ...(section.description.trim() ? { description: section.description.trim() } : {}) }]
    : parentTree;
  if (!section.description.trim()) {
    section.description = await generateDescription(buildDescriptionRequest({
      document,
      section,
      kind: 'section',
      parentTrail,
      parentTree,
      signal,
    }));
    updated += 1;
    sectionTree = sectionLabel
      ? [...parentTree, { label: sectionLabel, description: section.description.trim() }]
      : parentTree;
  }
  for (const block of section.blocks) {
    updated += await populateBlockDescriptions(document, section, block, sectionTrail, sectionTree, signal);
  }
  for (const child of section.children) {
    updated += await populateSectionDescriptions(document, child, sectionTrail, sectionTree, signal);
  }
  return updated;
}

async function populateBlockDescriptions(
  document: VisualDocument,
  section: VisualSection,
  block: VisualBlock,
  parentTrail: string[],
  parentTree: HvyDescriptionParentContext[],
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
      parentTree,
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
      parentTree,
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
      parentTree,
      signal,
    }));
    updated += 1;
  }
  const blockTrail = appendBlockTrail(parentTrail, block);
  const blockTree = appendBlockParentTree(parentTree, block);
  for (const child of block.schema.containerBlocks) {
    updated += await populateBlockDescriptions(document, section, child, blockTrail, blockTree, signal);
  }
  for (const child of block.schema.componentListBlocks) {
    updated += await populateBlockDescriptions(document, section, child, blockTrail, blockTree, signal);
  }
  for (const child of block.schema.expandableStubBlocks.children) {
    updated += await populateBlockDescriptions(document, section, child, blockTrail, blockTree, signal);
  }
  for (const child of block.schema.expandableContentBlocks.children) {
    updated += await populateBlockDescriptions(document, section, child, blockTrail, blockTree, signal);
  }
  for (const item of block.schema.gridItems) {
    updated += await populateBlockDescriptions(document, section, item.block, blockTrail, blockTree, signal);
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

function appendBlockParentTree(parentTree: HvyDescriptionParentContext[], block: VisualBlock): HvyDescriptionParentContext[] {
  const label = block.schema.xrefTitle.trim()
    || block.schema.containerTitle.trim()
    || block.text.replace(/\s+/g, ' ').trim().slice(0, 80)
    || block.schema.imageAlt.trim()
    || block.schema.description.trim()
    || block.schema.componentListItemLabel.trim()
    || block.schema.componentListComponent.trim()
    || block.schema.component.trim();
  const description = block.schema.description.trim();
  if (!label && !description) {
    return parentTree;
  }
  return [...parentTree, {
    label: label || 'Untitled parent',
    ...(description ? { description } : {}),
  }];
}
