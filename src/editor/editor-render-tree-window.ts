import type { VisualBlock, VisualSection } from './types';
import type { RenderTreeCollectionLayout, RenderTreeNode, RenderTreeWindowOptions } from '../render-tree-window';

export type EditorRenderTreeItem = VisualSection | VisualBlock;
export type EditorRenderTreeWindowOptions = RenderTreeWindowOptions;

export const EDITOR_SECTION_TREE_LAYOUT: RenderTreeCollectionLayout = {
  minimumItemCount: 24,
  overscanPx: 2400,
  defaultViewportHeight: 800,
};

export const EDITOR_BLOCK_TREE_LAYOUT: RenderTreeCollectionLayout = {
  minimumItemCount: 60,
  overscanPx: 1600,
  defaultViewportHeight: 800,
};

export function createEditorSectionRenderTreeNode(section: VisualSection): RenderTreeNode<EditorRenderTreeItem> {
  return {
    key: section.key,
    kind: 'section',
    item: section,
    estimatedHeight: estimateEditorSectionHeight(section),
    minimumHeight: 160,
  };
}

export function createEditorBlockRenderTreeNode(block: VisualBlock): RenderTreeNode<EditorRenderTreeItem> {
  return {
    key: block.id,
    kind: 'block',
    item: block,
    estimatedHeight: estimateEditorBlockHeight(block),
    minimumHeight: 56,
  };
}

function estimateEditorSectionHeight(section: VisualSection): number {
  return Math.max(
    160,
    86
      + section.blocks.reduce((total, block) => total + estimateEditorBlockHeight(block), 0)
      + section.children.reduce((total, child) => total + estimateEditorSectionHeight(child), 0)
  );
}

function estimateEditorBlockHeight(block: VisualBlock): number {
  const textLines = Math.max(1, Math.ceil((block.text?.length ?? 0) / 90));
  switch (block.schema.kind) {
    case 'image':
    case 'carousel':
      return 280;
    case 'table':
      return 96 + Math.max(1, block.schema.tableRows.length) * 38;
    case 'container':
      return 76 + block.schema.containerBlocks.reduce((total, child) => total + estimateEditorBlockHeight(child), 0);
    case 'component-list':
      return 76 + block.schema.componentListBlocks.reduce((total, child) => total + estimateEditorBlockHeight(child), 0);
    case 'grid': {
      const columns = Math.max(1, block.schema.gridColumns);
      const rowHeights: number[] = [];
      block.schema.gridItems.forEach((item, index) => {
        const row = Math.floor(index / columns);
        rowHeights[row] = Math.max(rowHeights[row] ?? 0, estimateEditorBlockHeight(item.block));
      });
      return 76 + rowHeights.reduce((total, height) => total + height, 0);
    }
    case 'expandable':
      return 92
        + block.schema.expandableStubBlocks.children.reduce((total, child) => total + estimateEditorBlockHeight(child), 0)
        + block.schema.expandableContentBlocks.children.reduce((total, child) => total + estimateEditorBlockHeight(child), 0);
    case 'plugin':
      return 220;
    default:
      return 58 + textLines * 24;
  }
}
