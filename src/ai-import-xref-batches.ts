import { resolveBaseComponentFromMeta } from './component-defs';
import { createEmptySection } from './document-factory';
import type { VisualBlock, VisualSection } from './editor/types';
import { buildHvyVirtualFileSystem, findVirtualDirectoryForBlock, resolveVirtualPath } from './cli-core/virtual-file-system';
import { serializeSectionFragment } from './serialization';
import { formatSectionTitle, getSectionId } from './section-ops';
import type { VisualDocument } from './types';
import { getXrefTargetOptionsForDocument, type XrefTargetOption } from './xref-ops';

export interface ImportXrefTargetOption extends XrefTargetOption {
  path: string;
}

export interface ImportXrefListDescriptor {
  listId: string;
  block: VisualBlock;
  component: string;
  itemLabel: string;
  path: string;
  allowedTargets: ImportXrefTargetOption[];
  existingItems: Array<{ xrefTitle: string; xrefDetail: string; xrefTarget: string }>;
}

export interface ImportXrefBatch {
  debugName: string;
  sectionKey: string;
  sectionTitle: string;
  sectionId: string;
  sectionPath: string;
  contextHvy: string;
  lists: ImportXrefListDescriptor[];
}

interface FoundXrefList {
  block: VisualBlock;
  parentList: VisualBlock | null;
  parentItem: VisualBlock | null;
}

export function buildImportXrefBatches(document: VisualDocument, sectionKeys: string[]): ImportXrefBatch[] {
  const batches: ImportXrefBatch[] = [];
  for (const sectionKey of sectionKeys) {
    const section = findSectionByKeyLocal(document.sections, sectionKey);
    if (!section) {
      continue;
    }
    const found = collectXrefListsInSection(document, section);
    const sectionLevel = found.filter((item) => !item.parentList);
    if (sectionLevel.length > 0) {
      batches.push(createSectionXrefBatch(document, section, sectionLevel));
    }
    const nestedByParent = groupNestedXrefLists(found.filter((item) => item.parentList && item.parentItem));
    for (const group of nestedByParent) {
      for (let index = 0; index < group.items.length; index += 2) {
        batches.push(createParentListXrefBatch(document, section, group.parentList, group.items.slice(index, index + 2), index));
      }
    }
  }
  return batches.filter((batch) => batch.lists.length > 0);
}

export function buildImportXrefTargetInventory(document: VisualDocument, tagFilter = ''): ImportXrefTargetOption[] {
  const fs = buildHvyVirtualFileSystem(document);
  return getXrefTargetOptionsForDocument(document, tagFilter).map((option) => ({
    ...option,
    path: resolveTargetCliPath(fs, option.value),
  }));
}

function createSectionXrefBatch(document: VisualDocument, section: VisualSection, found: FoundXrefList[]): ImportXrefBatch {
  const sectionPath = resolveSectionCliPath(document, section);
  return {
    debugName: `${formatSectionTitle(section.title)} section`,
    sectionKey: section.key,
    sectionTitle: formatSectionTitle(section.title),
    sectionId: getSectionId(section),
    sectionPath,
    contextHvy: serializeSectionFragment(section, document.meta),
    lists: found.map((item, index) => createListDescriptor(document, item.block, index)),
  };
}

function createParentListXrefBatch(
  document: VisualDocument,
  section: VisualSection,
  parentList: VisualBlock,
  items: Array<{ parentItem: VisualBlock; xrefLists: VisualBlock[] }>,
  startIndex: number
): ImportXrefBatch {
  const sectionPath = resolveSectionCliPath(document, section);
  const sectionSlice = createEmptySection(section.level, '', false);
  sectionSlice.key = section.key;
  sectionSlice.customId = section.customId;
  sectionSlice.title = section.title;
  sectionSlice.contained = section.contained;
  sectionSlice.css = section.css;
  sectionSlice.tags = section.tags;
  sectionSlice.description = section.description;
  sectionSlice.location = section.location;
  sectionSlice.blocks = [{
    ...parentList,
    schema: {
      ...parentList.schema,
      componentListBlocks: items.map((item) => item.parentItem),
    },
  }];
  const xrefLists = items.flatMap((item) => item.xrefLists);
  return {
    debugName: `${formatSectionTitle(section.title)} ${parentList.schema.id || parentList.schema.component} items ${startIndex + 1}-${startIndex + items.length}`,
    sectionKey: section.key,
    sectionTitle: formatSectionTitle(section.title),
    sectionId: getSectionId(section),
    sectionPath,
    contextHvy: serializeSectionFragment(sectionSlice, document.meta),
    lists: xrefLists.map((list, index) => createListDescriptor(document, list, index)),
  };
}

function createListDescriptor(document: VisualDocument, block: VisualBlock, index: number): ImportXrefListDescriptor {
  const tagFilter = getXrefListTargetTagFilter(document, block);
  return {
    listId: `L${index + 1}`,
    block,
    component: block.schema.componentListComponent.trim() || 'xref-card',
    itemLabel: block.schema.componentListItemLabel.trim(),
    path: findVirtualDirectoryForBlock(document, block) ?? '',
    allowedTargets: buildImportXrefTargetInventory(document, tagFilter),
    existingItems: block.schema.componentListBlocks.map((item) => ({
      xrefTitle: item.schema.xrefTitle.trim(),
      xrefDetail: item.schema.xrefDetail.trim(),
      xrefTarget: item.schema.xrefTarget.trim(),
    })),
  };
}

function collectXrefListsInSection(document: VisualDocument, section: VisualSection): FoundXrefList[] {
  const found: FoundXrefList[] = [];
  const visit = (blocks: VisualBlock[], parentList: VisualBlock | null, parentItem: VisualBlock | null): void => {
    for (const block of blocks) {
      if (isComponentList(document, block) && isXrefComponentList(document, block)) {
        found.push({ block, parentList, parentItem });
      }
      const nextParentList = isComponentList(document, block) && !isXrefComponentList(document, block) ? block : parentList;
      if (isComponentList(document, block) && !isXrefComponentList(document, block)) {
        for (const item of block.schema.componentListBlocks) {
          visit([item], block, item);
        }
      } else {
        visit(block.schema.componentListBlocks ?? [], nextParentList, parentItem);
      }
      visit(block.schema.containerBlocks ?? [], nextParentList, parentItem);
      visit(block.schema.gridItems?.map((item) => item.block) ?? [], nextParentList, parentItem);
      visit(block.schema.expandableStubBlocks?.children ?? [], nextParentList, parentItem);
      visit(block.schema.expandableContentBlocks?.children ?? [], nextParentList, parentItem);
    }
  };
  visit(section.blocks, null, null);
  for (const child of section.children) {
    found.push(...collectXrefListsInSection(document, child));
  }
  return found;
}

function groupNestedXrefLists(found: FoundXrefList[]): Array<{ parentList: VisualBlock; items: Array<{ parentItem: VisualBlock; xrefLists: VisualBlock[] }> }> {
  const byParent = new Map<VisualBlock, Map<VisualBlock, VisualBlock[]>>();
  for (const item of found) {
    if (!item.parentList || !item.parentItem) {
      continue;
    }
    const byItem = byParent.get(item.parentList) ?? new Map<VisualBlock, VisualBlock[]>();
    const lists = byItem.get(item.parentItem) ?? [];
    lists.push(item.block);
    byItem.set(item.parentItem, lists);
    byParent.set(item.parentList, byItem);
  }
  return [...byParent.entries()].map(([parentList, byItem]) => ({
    parentList,
    items: parentList.schema.componentListBlocks
      .map((parentItem) => ({ parentItem, xrefLists: byItem.get(parentItem) ?? [] }))
      .filter((item) => item.xrefLists.length > 0),
  }));
}

function isComponentList(document: VisualDocument, block: VisualBlock): boolean {
  return resolveBaseComponentFromMeta(block.schema.component, document.meta) === 'component-list';
}

function isXrefComponentList(document: VisualDocument, block: VisualBlock): boolean {
  const component = block.schema.componentListComponent.trim();
  return component.length > 0 && resolveBaseComponentFromMeta(component, document.meta) === 'xref-card';
}

function getXrefListTargetTagFilter(document: VisualDocument, block: VisualBlock): string {
  const component = block.schema.componentListComponent.trim();
  const definition = Array.isArray(document.meta.component_defs)
    ? document.meta.component_defs.find((item) => item.name === component)
    : null;
  const schema = definition?.template?.schema ?? definition?.schema;
  const filter = schema && typeof schema === 'object' && !Array.isArray(schema)
    ? (schema as { xrefTargetTagFilter?: unknown }).xrefTargetTagFilter
    : '';
  return typeof filter === 'string' ? filter : '';
}

function resolveTargetCliPath(fs: ReturnType<typeof buildHvyVirtualFileSystem>, targetId: string): string {
  const aliasPath = `/id/${sanitizePathSegmentLocal(targetId)}`;
  return fs.entries.has(aliasPath) ? aliasPath : resolveVirtualPath(fs, '/', aliasPath);
}

function resolveSectionCliPath(document: VisualDocument, section: VisualSection): string {
  const id = getSectionId(section);
  const fs = buildHvyVirtualFileSystem(document);
  const aliasPath = `/id/${sanitizePathSegmentLocal(id)}`;
  return fs.entries.has(aliasPath) ? aliasPath : resolveVirtualPath(fs, '/', aliasPath);
}

function sanitizePathSegmentLocal(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function findSectionByKeyLocal(sections: VisualSection[], key: string): VisualSection | null {
  for (const section of sections) {
    if (section.key === key) {
      return section;
    }
    const child = findSectionByKeyLocal(section.children, key);
    if (child) {
      return child;
    }
  }
  return null;
}
