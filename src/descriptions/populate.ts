import type { VisualBlock, VisualSection } from '../editor/types';
import { hasContainerBorderCss } from '../editor/components/container/container-css';
import type { VisualDocument } from '../types';
import { buildDescriptionRequest, generateDescription } from './provider';
import type { HvyDescriptionParentContext } from './types';

export interface PopulateDescriptionsResult {
  updated: number;
  total: number;
  completed: number;
  skippedLeaves: number;
  lastGenerated: string;
}

export interface PopulateDescriptionsProgress {
  completed: number;
  total: number;
  current: string;
  updated: number;
  skippedLeaves: number;
  lastGenerated: string;
}

export interface PopulateDescriptionsOptions {
  signal?: AbortSignal;
  onProgress?: (progress: PopulateDescriptionsProgress) => void;
}

interface PopulateDescriptionsRunState {
  total: number;
  completed: number;
  updated: number;
  skippedLeaves: number;
  lastGenerated: string;
  onProgress?: (progress: PopulateDescriptionsProgress) => void;
}

export async function populateMissingDescriptions(
  document: VisualDocument,
  signalOrOptions?: AbortSignal | PopulateDescriptionsOptions
): Promise<PopulateDescriptionsResult> {
  const options = isAbortSignal(signalOrOptions) ? { signal: signalOrOptions } : signalOrOptions ?? {};
  const run: PopulateDescriptionsRunState = {
    total: countMissingDescriptionTargets(document),
    completed: 0,
    updated: 0,
    skippedLeaves: countMissingLeafDescriptions(document),
    lastGenerated: '',
    onProgress: options.onProgress,
  };
  reportProgress(run, 'Preparing descriptions...');
  await processInBatches(document.sections, (section) => populateSectionDescriptions(document, section, [], [], run, options.signal), options.signal);
  return {
    updated: run.updated,
    total: run.total,
    completed: run.completed,
    skippedLeaves: run.skippedLeaves,
    lastGenerated: run.lastGenerated,
  };
}

async function populateSectionDescriptions(
  document: VisualDocument,
  section: VisualSection,
  parentTrail: string[],
  parentTree: HvyDescriptionParentContext[],
  run: PopulateDescriptionsRunState,
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
    reportProgress(run, `Section: ${section.title.trim() || section.customId.trim() || 'Untitled section'}`);
    section.description = await generateDescription(buildDescriptionRequest({
      document,
      section,
      kind: 'section',
      parentTrail,
      parentTree,
      signal,
    }));
    completeProgressStep(run, section.description);
    updated += 1;
    sectionTree = sectionLabel
      ? [...parentTree, { label: sectionLabel, description: section.description.trim() }]
      : parentTree;
  }
  updated += await processInBatches(section.blocks, (block) => populateBlockDescriptions(document, section, block, sectionTrail, sectionTree, run, signal), signal);
  updated += await processInBatches(section.children, (child) => populateSectionDescriptions(document, child, sectionTrail, sectionTree, run, signal), signal);
  return updated;
}

async function populateBlockDescriptions(
  document: VisualDocument,
  section: VisualSection,
  block: VisualBlock,
  parentTrail: string[],
  parentTree: HvyDescriptionParentContext[],
  run: PopulateDescriptionsRunState,
  signal?: AbortSignal
): Promise<number> {
  signal?.throwIfAborted();
  let updated = 0;
  const shouldPopulateBlock = isStructuralDescriptionBlock(block);
  if (shouldPopulateBlock && !block.schema.description.trim()) {
    reportProgress(run, `Component: ${getBlockLocationLabel(block) || block.schema.component || 'component'}`);
    block.schema.description = await generateDescription(buildDescriptionRequest({
      document,
      section,
      block,
      kind: 'block',
      parentTrail,
      parentTree,
      signal,
    }));
    completeProgressStep(run, block.schema.description);
    updated += 1;
  }
  if (shouldPopulateBlock && block.schema.component === 'expandable' && !block.schema.expandableStubDescription.trim()) {
    reportProgress(run, `Stub: ${getBlockLocationLabel(block) || block.schema.component || 'expandable'}`);
    block.schema.expandableStubDescription = await generateDescription(buildDescriptionRequest({
      document,
      section,
      block,
      kind: 'expandable-stub',
      parentTrail,
      parentTree,
      signal,
    }));
    completeProgressStep(run, block.schema.expandableStubDescription);
    updated += 1;
  }
  if (shouldPopulateBlock && block.schema.component === 'expandable' && !block.schema.expandableContentDescription.trim()) {
    reportProgress(run, `Expanded: ${getBlockLocationLabel(block) || block.schema.component || 'expandable'}`);
    block.schema.expandableContentDescription = await generateDescription(buildDescriptionRequest({
      document,
      section,
      block,
      kind: 'expandable-content',
      parentTrail,
      parentTree,
      signal,
    }));
    completeProgressStep(run, block.schema.expandableContentDescription);
    updated += 1;
  }
  const blockTrail = appendBlockTrail(parentTrail, block);
  const blockTree = appendBlockParentTree(parentTree, block);
  updated += await processInBatches(block.schema.containerBlocks ?? [], (child) => populateBlockDescriptions(document, section, child, blockTrail, blockTree, run, signal), signal);
  updated += await processInBatches(block.schema.componentListBlocks ?? [], (child) => populateBlockDescriptions(document, section, child, blockTrail, blockTree, run, signal), signal);
  updated += await processInBatches(block.schema.expandableStubBlocks?.children ?? [], (child) => populateBlockDescriptions(document, section, child, blockTrail, blockTree, run, signal), signal);
  updated += await processInBatches(block.schema.expandableContentBlocks?.children ?? [], (child) => populateBlockDescriptions(document, section, child, blockTrail, blockTree, run, signal), signal);
  updated += await processInBatches((block.schema.gridItems ?? []).map((item) => item.block), (child) => populateBlockDescriptions(document, section, child, blockTrail, blockTree, run, signal), signal);
  return updated;
}

async function processInBatches<T>(items: T[], worker: (item: T) => Promise<number>, signal?: AbortSignal): Promise<number> {
  let updated = 0;
  for (let index = 0; index < items.length; index += 4) {
    signal?.throwIfAborted();
    const results = await Promise.all(items.slice(index, index + 4).map((item) => worker(item)));
    updated += results.reduce((sum, value) => sum + value, 0);
  }
  return updated;
}

function countMissingDescriptionTargets(document: VisualDocument): number {
  return document.sections.reduce((total, section) => total + countSectionTargets(section), 0);
}

function countSectionTargets(section: VisualSection): number {
  const sectionTarget = section.description.trim() ? 0 : 1;
  return sectionTarget
    + section.blocks.reduce((total, block) => total + countBlockTargets(block), 0)
    + section.children.reduce((total, child) => total + countSectionTargets(child), 0);
}

function countBlockTargets(block: VisualBlock): number {
  const blockTargets = isStructuralDescriptionBlock(block)
    ? (block.schema.description.trim() ? 0 : 1)
      + (block.schema.component === 'expandable' && !block.schema.expandableStubDescription.trim() ? 1 : 0)
      + (block.schema.component === 'expandable' && !block.schema.expandableContentDescription.trim() ? 1 : 0)
    : 0;
  return blockTargets
    + (block.schema.containerBlocks ?? []).reduce((total, child) => total + countBlockTargets(child), 0)
    + (block.schema.componentListBlocks ?? []).reduce((total, child) => total + countBlockTargets(child), 0)
    + (block.schema.expandableStubBlocks?.children ?? []).reduce((total, child) => total + countBlockTargets(child), 0)
    + (block.schema.expandableContentBlocks?.children ?? []).reduce((total, child) => total + countBlockTargets(child), 0)
    + (block.schema.gridItems ?? []).reduce((total, item) => total + countBlockTargets(item.block), 0);
}

function countMissingLeafDescriptions(document: VisualDocument): number {
  return document.sections.reduce((total, section) =>
    total + section.blocks.reduce((blockTotal, block) => blockTotal + countLeafBlockDescriptions(block), 0)
      + section.children.reduce((childTotal, child) => childTotal + countMissingLeafDescriptions({ ...document, sections: [child] }), 0)
  , 0);
}

function countLeafBlockDescriptions(block: VisualBlock): number {
  const leafDescription = !isStructuralDescriptionBlock(block) && !block.schema.description.trim() ? 1 : 0;
  return leafDescription
    + (block.schema.containerBlocks ?? []).reduce((total, child) => total + countLeafBlockDescriptions(child), 0)
    + (block.schema.componentListBlocks ?? []).reduce((total, child) => total + countLeafBlockDescriptions(child), 0)
    + (block.schema.expandableStubBlocks?.children ?? []).reduce((total, child) => total + countLeafBlockDescriptions(child), 0)
    + (block.schema.expandableContentBlocks?.children ?? []).reduce((total, child) => total + countLeafBlockDescriptions(child), 0)
    + (block.schema.gridItems ?? []).reduce((total, item) => total + countLeafBlockDescriptions(item.block), 0);
}

function isStructuralDescriptionBlock(block: VisualBlock): boolean {
  if (block.schema.component === 'grid') {
    return false;
  }
  if (block.schema.component === 'container') {
    return hasPlainContainerDescriptionTarget(block);
  }
  return block.schema.component === 'component-list'
    || block.schema.component === 'expandable'
    || (block.schema.containerBlocks ?? []).length > 0
    || (block.schema.componentListBlocks ?? []).length > 0
    || (block.schema.expandableStubBlocks?.children ?? []).length > 0
    || (block.schema.expandableContentBlocks?.children ?? []).length > 0;
}

function hasPlainContainerDescriptionTarget(block: VisualBlock): boolean {
  return (block.schema.containerTitle ?? '').trim().length > 0 || hasContainerBorderCss(block.schema.css);
}

function reportProgress(run: PopulateDescriptionsRunState, current: string): void {
  run.onProgress?.({
    completed: run.completed,
    total: run.total,
    current,
    updated: run.updated,
    skippedLeaves: run.skippedLeaves,
    lastGenerated: run.lastGenerated,
  });
}

function completeProgressStep(run: PopulateDescriptionsRunState, generated: string): void {
  run.completed += 1;
  run.updated += 1;
  run.lastGenerated = generated;
  reportProgress(run, '');
}

function isAbortSignal(value: AbortSignal | PopulateDescriptionsOptions | undefined): value is AbortSignal {
  return Boolean(value && typeof (value as AbortSignal).throwIfAborted === 'function');
}

function appendBlockTrail(parentTrail: string[], block: VisualBlock): string[] {
  const label = getBlockLocationLabel(block);
  return label ? [...parentTrail, label] : parentTrail;
}

function appendBlockParentTree(parentTree: HvyDescriptionParentContext[], block: VisualBlock): HvyDescriptionParentContext[] {
  const label = getBlockLocationLabel(block)
    || block.schema.description.trim()
    || (block.schema.componentListItemLabel ?? '').trim()
    || (block.schema.componentListComponent ?? '').trim()
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

function getBlockLocationLabel(block: VisualBlock): string {
  return block.schema.xrefTitle.trim()
    || (block.schema.containerTitle ?? '').trim()
    || firstLine(block.text)
    || (block.schema.imageAlt ?? '').trim()
    || getTableRowLabel(block)
    || getNestedHeadingLabel(block, new Set([block]));
}

function getTableRowLabel(block: VisualBlock): string {
  if (block.schema.component !== 'table') {
    return '';
  }
  return firstLine(block.schema.tableRows?.[0]?.cells.join(' ') ?? '');
}

function getNestedHeadingLabel(block: VisualBlock, seen = new Set<VisualBlock>()): string {
  const nestedBlocks = [
    ...(block.schema.expandableContentBlocks?.children ?? []),
    ...(block.schema.expandableStubBlocks?.children ?? []),
    ...(block.schema.containerBlocks ?? []),
    ...(block.schema.componentListBlocks ?? []),
    ...(block.schema.gridItems ?? []).map((item) => item.block),
  ];
  for (const child of nestedBlocks) {
    if (seen.has(child)) {
      continue;
    }
    seen.add(child);
    const direct = firstHeadingLine(child.text);
    if (direct) {
      return direct;
    }
    const nested = getNestedHeadingLabel(child, seen);
    if (nested) {
      return nested;
    }
    const table = getTableRowLabel(child);
    if (table) {
      return table;
    }
  }
  return '';
}

function firstHeadingLine(value: string): string {
  const heading = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^#{1,6}\s+/.test(line));
  return heading ? firstLine(heading.replace(/^#{1,6}\s+/, '')) : '';
}

function firstLine(value: string): string {
  const line = value.replace(/\s+/g, ' ').trim();
  return line.length > 80 ? `${line.slice(0, 79).trim()}...` : line;
}
