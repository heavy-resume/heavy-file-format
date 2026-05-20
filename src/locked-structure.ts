import type { VisualBlock, VisualSection } from './editor/types';
import type { VisualDocument } from './types';
import { resolveBaseComponentFromMeta } from './component-defs';

export interface LockedStructureValidationError {
  path: string;
  message: string;
}

export function validateLockedSectionStructure(
  expected: VisualSection,
  received: VisualSection,
  documentMeta: VisualDocument['meta']
): LockedStructureValidationError[] {
  const errors: LockedStructureValidationError[] = [];
  validateSectionLocks(expected, received, documentMeta, errors, '/section');
  return errors;
}

function validateSectionLocks(
  expected: VisualSection,
  received: VisualSection,
  documentMeta: VisualDocument['meta'],
  errors: LockedStructureValidationError[],
  path: string
): void {
  if (expected.lock === true) {
    validateBlockArrayShape(expected.blocks, received.blocks, documentMeta, errors, `${path}/blocks`, 'Locked section direct blocks');
    validateSectionArrayShape(expected.children, received.children, errors, `${path}/sections`, 'Locked section child sections');
  }
  validateBlockArrayLocks(expected.blocks, received.blocks, documentMeta, errors, `${path}/blocks`);
  expected.children.forEach((child, index) => {
    const receivedChild = received.children[index];
    if (!receivedChild) {
      if (hasLockedSectionStructure(child)) {
        errors.push({
          path: `${path}/sections/${index}`,
          message: `Locked child section at ${path}/sections/${index} is missing.`,
        });
      }
      return;
    }
    validateSectionLocks(child, receivedChild, documentMeta, errors, `${path}/sections/${index}`);
  });
}

function validateBlockArrayLocks(
  expectedBlocks: VisualBlock[],
  receivedBlocks: VisualBlock[],
  documentMeta: VisualDocument['meta'],
  errors: LockedStructureValidationError[],
  path: string
): void {
  expectedBlocks.forEach((block, index) => {
    const received = receivedBlocks[index];
    if (!received) {
      if (hasLockedBlockStructure(block)) {
        errors.push({
          path: `${path}/${index}`,
          message: `Locked component structure at ${path}/${index} is missing.`,
        });
      }
      return;
    }
    validateBlockLocks(block, received, documentMeta, errors, `${path}/${index}`);
  });
}

function validateBlockLocks(
  expected: VisualBlock,
  received: VisualBlock,
  documentMeta: VisualDocument['meta'],
  errors: LockedStructureValidationError[],
  path: string
): void {
  if (expected.schema.lock === true) {
    validateBlockStructuralType(expected, received, documentMeta, errors, path, 'Locked component');
    validateLockedBlockChildren(expected, received, documentMeta, errors, path);
    return;
  }
  validateBlockArrayLocks(expected.schema.containerBlocks, received.schema.containerBlocks, documentMeta, errors, `${path}/containerBlocks`);
  validateBlockArrayLocks(expected.schema.componentListBlocks, received.schema.componentListBlocks, documentMeta, errors, `${path}/componentListBlocks`);
  validateGridItemLocks(expected, received, documentMeta, errors, `${path}/gridItems`);
  validateExpandablePartLocks(expected, received, 'stub', documentMeta, errors, `${path}/expandableStubBlocks`);
  validateExpandablePartLocks(expected, received, 'content', documentMeta, errors, `${path}/expandableContentBlocks`);
}

function validateLockedBlockChildren(
  expected: VisualBlock,
  received: VisualBlock,
  documentMeta: VisualDocument['meta'],
  errors: LockedStructureValidationError[],
  path: string
): void {
  validateBlockArrayShape(expected.schema.containerBlocks, received.schema.containerBlocks, documentMeta, errors, `${path}/containerBlocks`, 'Locked component container children');
  validateBlockArrayShape(expected.schema.componentListBlocks, received.schema.componentListBlocks, documentMeta, errors, `${path}/componentListBlocks`, 'Locked component list children');
  validateGridItemShape(expected, received, documentMeta, errors, `${path}/gridItems`);
  validateExpandablePartShape(expected, received, 'stub', documentMeta, errors, `${path}/expandableStubBlocks`);
  validateExpandablePartShape(expected, received, 'content', documentMeta, errors, `${path}/expandableContentBlocks`);
  validateTableShape(expected, received, errors, `${path}/tableColumns`);
}

function validateExpandablePartLocks(
  expected: VisualBlock,
  received: VisualBlock,
  part: 'stub' | 'content',
  documentMeta: VisualDocument['meta'],
  errors: LockedStructureValidationError[],
  path: string
): void {
  const expectedPart = part === 'stub' ? expected.schema.expandableStubBlocks : expected.schema.expandableContentBlocks;
  const receivedPart = part === 'stub' ? received.schema.expandableStubBlocks : received.schema.expandableContentBlocks;
  if (expectedPart.lock === true) {
    validateBlockArrayShape(expectedPart.children, receivedPart.children, documentMeta, errors, `${path}/children`, `Locked expandable ${part} pane`);
  }
  validateBlockArrayLocks(expectedPart.children, receivedPart.children, documentMeta, errors, `${path}/children`);
}

function validateBlockArrayShape(
  expectedBlocks: VisualBlock[],
  receivedBlocks: VisualBlock[],
  documentMeta: VisualDocument['meta'],
  errors: LockedStructureValidationError[],
  path: string,
  label: string
): void {
  if (expectedBlocks.length !== receivedBlocks.length) {
    errors.push({
      path,
      message: `${label} at ${path} cannot add or remove direct components; expected ${expectedBlocks.length}, received ${receivedBlocks.length}.`,
    });
    return;
  }
  expectedBlocks.forEach((expected, index) => {
    validateBlockStructuralType(expected, receivedBlocks[index]!, documentMeta, errors, `${path}/${index}`, label);
  });
}

function validateSectionArrayShape(
  expectedSections: VisualSection[],
  receivedSections: VisualSection[],
  errors: LockedStructureValidationError[],
  path: string,
  label: string
): void {
  if (expectedSections.length !== receivedSections.length) {
    errors.push({
      path,
      message: `${label} at ${path} cannot add or remove direct child sections; expected ${expectedSections.length}, received ${receivedSections.length}.`,
    });
  }
}

function validateGridItemShape(
  expected: VisualBlock,
  received: VisualBlock,
  documentMeta: VisualDocument['meta'],
  errors: LockedStructureValidationError[],
  path: string
): void {
  if (expected.schema.gridItems.length !== received.schema.gridItems.length) {
    errors.push({
      path,
      message: `Locked grid items at ${path} cannot add or remove cells; expected ${expected.schema.gridItems.length}, received ${received.schema.gridItems.length}.`,
    });
    return;
  }
  expected.schema.gridItems.forEach((item, index) => {
    validateBlockStructuralType(item.block, received.schema.gridItems[index]!.block, documentMeta, errors, `${path}/${index}/block`, 'Locked grid cell');
  });
}

function validateGridItemLocks(
  expected: VisualBlock,
  received: VisualBlock,
  documentMeta: VisualDocument['meta'],
  errors: LockedStructureValidationError[],
  path: string
): void {
  expected.schema.gridItems.forEach((item, index) => {
    const receivedItem = received.schema.gridItems[index];
    if (!receivedItem) {
      if (hasLockedBlockStructure(item.block)) {
        errors.push({
          path: `${path}/${index}`,
          message: `Locked grid cell structure at ${path}/${index} is missing.`,
        });
      }
      return;
    }
    validateBlockLocks(item.block, receivedItem.block, documentMeta, errors, `${path}/${index}/block`);
  });
}

function validateExpandablePartShape(
  expected: VisualBlock,
  received: VisualBlock,
  part: 'stub' | 'content',
  documentMeta: VisualDocument['meta'],
  errors: LockedStructureValidationError[],
  path: string
): void {
  const expectedPart = part === 'stub' ? expected.schema.expandableStubBlocks : expected.schema.expandableContentBlocks;
  const receivedPart = part === 'stub' ? received.schema.expandableStubBlocks : received.schema.expandableContentBlocks;
  validateBlockArrayShape(expectedPart.children, receivedPart.children, documentMeta, errors, `${path}/children`, `Locked expandable ${part} children`);
}

function validateTableShape(expected: VisualBlock, received: VisualBlock, errors: LockedStructureValidationError[], path: string): void {
  if (expected.schema.tableColumns.length !== received.schema.tableColumns.length) {
    errors.push({
      path,
      message: `Locked table columns at ${path} cannot add or remove columns; expected ${expected.schema.tableColumns.length}, received ${received.schema.tableColumns.length}.`,
    });
  }
}

function validateBlockStructuralType(
  expected: VisualBlock,
  received: VisualBlock,
  documentMeta: VisualDocument['meta'],
  errors: LockedStructureValidationError[],
  path: string,
  label: string
): void {
  const expectedType = getStructuralComponentType(expected, documentMeta);
  const receivedType = getStructuralComponentType(received, documentMeta);
  if (expectedType !== receivedType) {
    errors.push({
      path,
      message: `${label} at ${path} cannot change component type; expected ${expectedType}, received ${receivedType}.`,
    });
  }
}

function getStructuralComponentType(block: VisualBlock, documentMeta: VisualDocument['meta']): string {
  const component = block.schema.component.trim() || 'text';
  const base = resolveBaseComponentFromMeta(component, documentMeta);
  return component === base ? base : `${component}:${base}`;
}

function hasLockedSectionStructure(section: VisualSection): boolean {
  return section.lock === true || section.blocks.some(hasLockedBlockStructure) || section.children.some(hasLockedSectionStructure);
}

function hasLockedBlockStructure(block: VisualBlock): boolean {
  return block.schema.lock === true
    || block.schema.containerBlocks.some(hasLockedBlockStructure)
    || block.schema.componentListBlocks.some(hasLockedBlockStructure)
    || block.schema.gridItems.some((item) => hasLockedBlockStructure(item.block))
    || block.schema.expandableStubBlocks.lock === true
    || block.schema.expandableStubBlocks.children.some(hasLockedBlockStructure)
    || block.schema.expandableContentBlocks.lock === true
    || block.schema.expandableContentBlocks.children.some(hasLockedBlockStructure);
}
