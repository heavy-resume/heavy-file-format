import type { VisualBlock, VisualSection } from './editor/types';
import type { JsonObject } from './hvy/types';
import { getComponentDefsFromMeta, getSectionDefsFromMeta, resolveBaseComponentFromMeta } from './component-defs';
import { SCRIPTING_PLUGIN_ID } from './plugins/registry';
import { REUSABLE_SECTION_DEF_PREFIX, REUSABLE_SECTION_PREFIX, state } from './state';
import { sanitizeOptionalId } from './utils';

export function flattenSections(sections: VisualSection[]): VisualSection[] {
  return sections.slice();
}

export function findSectionByKey(sections: VisualSection[], sectionKey: string): VisualSection | null {
  for (const section of sections) {
    if (section.key === sectionKey) {
      return section;
    }
  }
  const templateSection = findReusableSectionTemplateByKey(sectionKey);
  if (templateSection) {
    return templateSection;
  }
  return null;
}

function findReusableSectionTemplateByKey(sectionKey: string): VisualSection | null {
  try {
    if (sectionKey.startsWith(REUSABLE_SECTION_PREFIX)) {
      const name = sectionKey.slice(REUSABLE_SECTION_PREFIX.length);
      const template = getComponentDefsFromMeta(state?.document?.meta).find((def) => def.name === name)?.template;
      if (!template) {
        return null;
      }
      return {
        key: sectionKey,
        customId: '',
        contained: false,
        editorOnly: false,
        lock: false,
        idEditorOpen: false,
        isGhost: false,
        title: name,

        expanded: true,
        highlight: false,
        css: '',
        tags: '',
        description: '',
        location: 'main',
        blocks: [template],
      };
    }
    const defs = getSectionDefsFromMeta(state?.document?.meta);
    if (sectionKey.startsWith(REUSABLE_SECTION_DEF_PREFIX)) {
      const name = sectionKey.slice(REUSABLE_SECTION_DEF_PREFIX.length);
      return defs.find((def) => def.name === name || def.key === name)?.template ?? null;
    }
    for (const def of defs) {
      if (def.template?.key === sectionKey) {
        return def.template;
      }
      const flavor = def.flavors?.find((candidate) => candidate.template?.key === sectionKey);
      if (flavor) {
        return flavor.template;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function findSectionContainer(
  sections: VisualSection[],
  sectionKey: string
): { container: VisualSection[]; index: number } | null {
  const index = sections.findIndex((section) => section.key === sectionKey);
  if (index >= 0) {
    return { container: sections, index };
  }

  return null;
}

export function moveScriptOnlySectionsAfterRegularSections(
  sections: VisualSection[],
  documentMeta: JsonObject | null
): boolean {
  return reorderScriptOnlySectionsInContainer(sections, documentMeta);
}

export function wouldMoveScriptOnlySectionsAfterRegularSections(
  sections: VisualSection[],
  documentMeta: JsonObject | null
): boolean {
  return wouldReorderScriptOnlySectionsInContainer(sections, documentMeta);
}

function reorderScriptOnlySectionsInContainer(sections: VisualSection[], documentMeta: JsonObject | null): boolean {
  const reordered = [
    ...sections.filter((section) => !isScriptOnlySection(section, documentMeta)),
    ...sections.filter((section) => isScriptOnlySection(section, documentMeta)),
  ];
  const changed = reordered.some((section, index) => section !== sections[index]);
  if (changed) {
    sections.splice(0, sections.length, ...reordered);
  }
  return changed;
}

function wouldReorderScriptOnlySectionsInContainer(sections: VisualSection[], documentMeta: JsonObject | null): boolean {
  let seenScriptOnly = false;
  for (const section of sections) {
    if (isScriptOnlySection(section, documentMeta)) {
      seenScriptOnly = true;
    } else if (seenScriptOnly) {
      return true;
    }
  }
  return false;
}

function isScriptOnlySection(section: VisualSection, documentMeta: JsonObject | null): boolean {
  return section.blocks.length > 0
    && section.blocks.every((block) => isScriptingBlock(block, documentMeta));
}

function isScriptingBlock(block: VisualBlock, documentMeta: JsonObject | null): boolean {
  return resolveBaseComponentFromMeta(block.schema.component, documentMeta) === 'plugin'
    && block.schema.plugin === SCRIPTING_PLUGIN_ID;
}

export function isHiddenEditorOnlySection(
  section: VisualSection,
  documentMeta: JsonObject | null,
  showAdvancedEditor: boolean
): boolean {
  return !showAdvancedEditor
    && section.editorOnly
    && sectionContainsHiddenEditorOnlyScriptingBlock(section, documentMeta);
}

function sectionContainsHiddenEditorOnlyScriptingBlock(section: VisualSection, documentMeta: JsonObject | null): boolean {
  return section.blocks.some((block) => blockContainsHiddenEditorOnlyScriptingBlock(block, documentMeta));
}

function blockContainsHiddenEditorOnlyScriptingBlock(block: VisualBlock, documentMeta: JsonObject | null): boolean {
  return isHiddenEditorOnlyScriptingBlock(block, documentMeta)
    || (block.schema.containerBlocks ?? []).some((child) => blockContainsHiddenEditorOnlyScriptingBlock(child, documentMeta))
    || (block.schema.componentListBlocks ?? []).some((child) => blockContainsHiddenEditorOnlyScriptingBlock(child, documentMeta))
    || (block.schema.gridItems ?? []).some((item) => blockContainsHiddenEditorOnlyScriptingBlock(item.block, documentMeta))
    || (block.schema.expandableStubBlocks?.children ?? []).some((child) => blockContainsHiddenEditorOnlyScriptingBlock(child, documentMeta))
    || (block.schema.expandableContentBlocks?.children ?? []).some((child) => blockContainsHiddenEditorOnlyScriptingBlock(child, documentMeta));
}

function isHiddenEditorOnlyScriptingBlock(block: VisualBlock, documentMeta: JsonObject | null): boolean {
  return block.schema.editorOnly
    && resolveBaseComponentFromMeta(block.schema.component, documentMeta) === 'plugin'
    && block.schema.plugin === SCRIPTING_PLUGIN_ID;
}

export function sectionContainsKey(section: VisualSection, sectionKey: string): boolean {
  return section.key === sectionKey;
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
  if (!draggedSection || !targetSection || sectionContainsKey(draggedSection, targetKey)) {
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

export function getSectionFilteredMoveAvailability(
  sections: VisualSection[],
  sectionKey: string,
  siblingFilter: (section: VisualSection, target: VisualSection) => boolean
): { canMoveUp: boolean; canMoveDown: boolean } {
  const location = findSectionContainer(sections, sectionKey);
  const target = location?.container[location.index] ?? null;
  if (!location || !target) {
    return { canMoveUp: false, canMoveDown: false };
  }
  const siblingIndexes = getFilteredSectionSiblingIndexes(location.container, target, siblingFilter);
  const visualSiblingIndex = siblingIndexes.indexOf(location.index);
  return {
    canMoveUp: visualSiblingIndex > 0,
    canMoveDown: visualSiblingIndex >= 0 && visualSiblingIndex < siblingIndexes.length - 1,
  };
}

export function moveSectionByFilteredOffset(
  sections: VisualSection[],
  sectionKey: string,
  offset: -1 | 1,
  siblingFilter: (section: VisualSection, target: VisualSection) => boolean
): boolean {
  const location = findSectionContainer(sections, sectionKey);
  const target = location?.container[location.index] ?? null;
  if (!location || !target) {
    return false;
  }
  const siblingIndexes = getFilteredSectionSiblingIndexes(location.container, target, siblingFilter);
  const visualSiblingIndex = siblingIndexes.indexOf(location.index);
  const targetContainerIndex = siblingIndexes[visualSiblingIndex + offset];
  if (visualSiblingIndex < 0 || targetContainerIndex === undefined) {
    return false;
  }
  const targetSection = location.container[targetContainerIndex];
  if (!targetSection) {
    return false;
  }
  return moveSectionRelative(sections, sectionKey, targetSection.key, offset < 0 ? 'before' : 'after');
}

function getFilteredSectionSiblingIndexes(
  container: VisualSection[],
  target: VisualSection,
  siblingFilter: (section: VisualSection, target: VisualSection) => boolean
): number[] {
  return container.flatMap((section, index) => siblingFilter(section, target) ? [index] : []);
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

export function replaceBlockById(
  sections: VisualSection[],
  sectionKey: string,
  blockId: string,
  replacement: VisualBlock
): boolean {
  const section = findSectionByKey(sections, sectionKey);
  return section ? replaceBlockInList(section.blocks, blockId, replacement, new Set<VisualBlock>()) : false;
}

function replaceBlockInList(
  blocks: VisualBlock[],
  blockId: string,
  replacement: VisualBlock,
  seen: Set<VisualBlock>
): boolean {
  const index = blocks.findIndex((block) => block.id === blockId);
  if (index >= 0) {
    blocks[index] = replacement;
    return true;
  }
  for (const block of blocks) {
    if (seen.has(block)) continue;
    seen.add(block);
    if (
      replaceBlockInList(block.schema.containerBlocks ?? [], blockId, replacement, seen)
      || replaceBlockInList(block.schema.componentListBlocks ?? [], blockId, replacement, seen)
      || replaceBlockInList(block.schema.expandableStubBlocks?.children ?? [], blockId, replacement, seen)
      || replaceBlockInList(block.schema.expandableContentBlocks?.children ?? [], blockId, replacement, seen)
    ) {
      return true;
    }
    for (const item of block.schema.gridItems ?? []) {
      if (item.block.id === blockId) {
        item.block = replacement;
        return true;
      }
      if (replaceBlockInList([item.block], blockId, replacement, seen)) {
        return true;
      }
    }
    if (block.schema.encryptedBlock?.id === blockId) {
      block.schema.encryptedBlock = replacement;
      return true;
    }
    if (block.schema.encryptedBlock && replaceBlockInList([block.schema.encryptedBlock], blockId, replacement, seen)) {
      return true;
    }
  }
  return false;
}

export function findBlockContainerInList(
  blocks: VisualBlock[],
  blockId: string,
  ownerBlockId: string | null,
  seen = new Set<VisualBlock>()
): { container: VisualBlock[]; index: number; ownerBlockId: string | null } | null {
  const index = blocks.findIndex((block) => block.id === blockId);
  if (index >= 0) {
    return { container: blocks, index, ownerBlockId };
  }
  for (const block of blocks) {
    if (seen.has(block)) {
      continue;
    }
    seen.add(block);
    const nested =
      findBlockContainerInList(block.schema.containerBlocks ?? [], blockId, block.id, seen) ??
      findBlockContainerInList(block.schema.componentListBlocks ?? [], blockId, block.id, seen) ??
      findBlockContainerInList((block.schema.gridItems ?? []).map((item) => item.block), blockId, block.id, seen) ??
      findBlockContainerInList(block.schema.expandableStubBlocks?.children ?? [], blockId, block.id, seen) ??
      findBlockContainerInList(block.schema.expandableContentBlocks?.children ?? [], blockId, block.id, seen) ??
      findBlockContainerInList(block.schema.encryptedBlock ? [block.schema.encryptedBlock] : [], blockId, block.id, seen);
    if (nested) {
      return nested;
    }
  }
  return null;
}

export function buildSectionRenderSequence(section: VisualSection): Array<{ kind: 'block'; block: VisualBlock }> {
  return section.blocks.map((block) => ({ kind: 'block', block }));
}

export type SectionInsertionBoundary =
  | { beforeKind: 'block'; beforeId: string }
  | { beforeKind: 'end'; beforeId: '' };

export function getSectionInsertionBoundary(section: VisualSection, index: number): SectionInsertionBoundary {
  const next = section.blocks[index];
  return next ? { beforeKind: 'block', beforeId: next.id } : { beforeKind: 'end', beforeId: '' };
}

export function insertBlockAtSectionInsertionBoundary(section: VisualSection, block: VisualBlock, boundary: SectionInsertionBoundary): boolean {
  const index = boundary.beforeKind === 'end' ? section.blocks.length : section.blocks.findIndex((item) => item.id === boundary.beforeId);
  if (index < 0) return false;
  section.blocks.splice(index, 0, block);
  return true;
}

export function removeBlockFromSectionRenderSequence(section: VisualSection, blockId: string): boolean {
  const index = section.blocks.findIndex((block) => block.id === blockId);
  if (index < 0) return false;
  section.blocks.splice(index, 1);
  return true;
}

export function moveBlockInVisualSequence(sections: VisualSection[], sectionKey: string, blockId: string, offset: -1 | 1): boolean {
  const section = findSectionByKey(sections, sectionKey);
  if (!section) return false;
  const index = section.blocks.findIndex((block) => block.id === blockId);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= section.blocks.length) return false;
  const [block] = section.blocks.splice(index, 1);
  section.blocks.splice(target, 0, block);
  return true;
}

export function removeSectionByKey(sections: VisualSection[], sectionKey: string): boolean {
  const index = sections.findIndex((section) => section.key === sectionKey);
  if (index >= 0) {
    sections.splice(index, 1);
    return true;
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

export function assignSectionTitleAndGeneratedId(sections: VisualSection[], section: VisualSection, nextTitle: string): void {
  const previousTitle = section.title;
  const currentId = section.customId.trim();
  const shouldRefreshId = currentId.length === 0 || isGeneratedSectionIdForTitle(currentId, previousTitle);
  section.title = nextTitle;
  if (!shouldRefreshId) {
    return;
  }
  section.customId = createUniqueSectionIdFromTitle(nextTitle, sections, section.key);
  section.customIdGenerated = section.customId.length > 0;
}

export function createUniqueSectionIdFromTitle(title: string, sections: VisualSection[], excludeSectionKey?: string): string {
  const base = createSectionIdFromTitle(title);
  if (!base) {
    return '';
  }
  const used = new Set(
    flattenSections(sections)
      .filter((section) => section.key !== excludeSectionKey)
      .map((section) => getSectionId(section).trim())
      .filter((id) => id.length > 0)
  );
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export function createSectionIdFromTitle(title: string): string {
  return isDefaultUntitledSectionTitle(title) ? '' : sanitizeOptionalId(title);
}

function isGeneratedSectionIdForTitle(id: string, title: string): boolean {
  const base = createSectionIdFromTitle(title);
  return base.length > 0 && (id === base || new RegExp(`^${escapeRegExp(base)}-\\d+$`).test(id));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isDefaultUntitledSectionTitle(title: string): boolean {
  return title.trim() === '' || title.trim() === 'Unnamed Section';
}

export function formatSectionTitle(title: string): string {
  return isDefaultUntitledSectionTitle(title) ? 'Unnamed Section' : title;
}

export function visitBlocks(sections: VisualSection[], visitor: (block: VisualBlock) => void): void {
  const seen = new Set<VisualBlock>();
  sections.forEach((section) => {
    visitBlocksInList(section.blocks, visitor, seen);
  });
}

export function visitBlocksInList(blocks: VisualBlock[], visitor: (block: VisualBlock) => void, seen = new Set<VisualBlock>()): void {
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
  });
}
