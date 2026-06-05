import type { VisualBlock, VisualSection } from './editor/types';

export function isSectionHiddenByTemplateMarker(section: VisualSection): boolean {
  return section.hideIfUnmodified === true;
}

export function isBlockHiddenByTemplateMarker(block: VisualBlock): boolean {
  return block.schema.hideIfYes.trim().toLowerCase() === 'yes';
}

export function filterTemplateVisibleSections(sections: VisualSection[]): VisualSection[] {
  return sections
    .filter((section) => !isSectionHiddenByTemplateMarker(section))
    .map((section) => ({
      ...section,
      blocks: filterTemplateVisibleBlocks(section.blocks),
      children: filterTemplateVisibleSections(section.children),
    }));
}

function filterTemplateVisibleBlocks(blocks: VisualBlock[]): VisualBlock[] {
  return blocks
    .filter((block) => !isBlockHiddenByTemplateMarker(block))
    .map((block) => ({
      ...block,
      schema: filterTemplateVisibleBlockSchema(block),
    }));
}

function filterTemplateVisibleBlockSchema(block: VisualBlock): VisualBlock['schema'] {
  const schema = { ...block.schema };
  if (schema.containerBlocks) {
    schema.containerBlocks = filterTemplateVisibleBlocks(schema.containerBlocks);
  }
  if (schema.componentListBlocks) {
    schema.componentListBlocks = filterTemplateVisibleBlocks(schema.componentListBlocks);
  }
  if (schema.gridItems) {
    schema.gridItems = schema.gridItems
      .filter((item) => !isBlockHiddenByTemplateMarker(item.block))
      .map((item) => ({ ...item, block: { ...item.block, schema: filterTemplateVisibleBlockSchema(item.block) } }));
  }
  if (schema.expandableStubBlocks) {
    schema.expandableStubBlocks = {
      ...schema.expandableStubBlocks,
      children: filterTemplateVisibleBlocks(schema.expandableStubBlocks.children),
    };
  }
  if (schema.expandableContentBlocks) {
    schema.expandableContentBlocks = {
      ...schema.expandableContentBlocks,
      children: filterTemplateVisibleBlocks(schema.expandableContentBlocks.children),
    };
  }
  return schema;
}

export function clearHideIfUnmodifiedForSectionPath(sections: VisualSection[], sectionKey: string): boolean {
  const path = findSectionPath(sections, sectionKey);
  if (!path) {
    return false;
  }
  return clearHideIfUnmodifiedForSections(path);
}

export function clearHideIfUnmodifiedForSections(sections: VisualSection[]): boolean {
  let changed = false;
  for (const section of sections) {
    if (section.hideIfUnmodified === true) {
      section.hideIfUnmodified = false;
      changed = true;
    }
    if (!section.expanded) {
      section.expanded = true;
      changed = true;
    }
  }
  return changed;
}

export function findSectionPath(sections: VisualSection[], sectionKey: string, ancestors: VisualSection[] = []): VisualSection[] | null {
  for (const section of sections) {
    const path = [...ancestors, section];
    if (section.key === sectionKey) {
      return path;
    }
    const childPath = findSectionPath(section.children, sectionKey, path);
    if (childPath) {
      return childPath;
    }
  }
  return null;
}
