import { resolveBaseComponentFromMeta } from '../component-defs';
import type { VisualBlock, VisualSection } from '../editor/types';
import type { VisualDocument } from '../types';
import type { HvyCliLintIssue } from './lint-types';

export function runHvyDocumentBlockLinter(document: VisualDocument): HvyCliLintIssue[] {
  const issues: HvyCliLintIssue[] = [];
  const blockPaths = collectBlockPaths(document);
  for (const block of blockPaths.keys()) {
    const baseComponent = resolveBaseComponentFromMeta(block.schema.component, document.meta);
    if (baseComponent !== 'expandable') {
      continue;
    }
    const contentChildren = block.schema.expandableContentBlocks.children ?? [];
    if (
      contentChildren.length > 0
      && contentChildren.every((child) => resolveBaseComponentFromMeta(child.schema.component, document.meta) === 'expandable')
    ) {
      const path = blockPaths.get(block) ?? `/id/${block.schema.id || block.id}`;
      issues.push({
        key: `${path}:expandable-content-only-nested-expandables`,
        path,
        component: block.schema.component,
        message: 'expandable content contains only nested expandables. Use sibling expandables or a component-list instead of an empty wrapper expandable.',
      });
    }
  }
  return issues;
}

function collectBlockPaths(document: VisualDocument): Map<VisualBlock, string> {
  const paths = new Map<VisualBlock, string>();
  const visitSection = (section: VisualSection, parentPath: string) => {
    if (section.isGhost) {
      return;
    }
    const sectionPath = `${parentPath}/${section.customId || section.key}`;
    section.blocks.forEach((block) => visitBlock(block, sectionPath, paths));
    section.children.forEach((child) => visitSection(child, sectionPath));
  };
  document.sections.forEach((section) => visitSection(section, '/body'));
  return paths;
}

function visitBlock(block: VisualBlock, parentPath: string, paths: Map<VisualBlock, string>): void {
  const path = `${parentPath}/${block.schema.id || block.id}`;
  paths.set(block, path);
  block.schema.containerBlocks?.forEach((child) => visitBlock(child, path, paths));
  block.schema.componentListBlocks?.forEach((child) => visitBlock(child, path, paths));
  block.schema.gridItems?.forEach((item) => visitBlock(item.block, path, paths));
  block.schema.expandableStubBlocks?.children?.forEach((child) => visitBlock(child, path, paths));
  block.schema.expandableContentBlocks?.children?.forEach((child) => visitBlock(child, path, paths));
}
