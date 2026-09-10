import type { VisualBlock, VisualSection } from '../editor/types';
import type { RenderTreeCollectionLayout, RenderTreeNode, RenderTreeWindowOptions } from '../render-tree-window';

export type ReaderRenderTreeItem = VisualSection | VisualBlock;
export type ReaderRenderTreeWindowOptions = RenderTreeWindowOptions;

export const READER_SECTION_TREE_LAYOUT: RenderTreeCollectionLayout = {
  minimumItemCount: 24,
  overscanPx: 2400,
  defaultViewportHeight: 800,
};

export const READER_BLOCK_TREE_LAYOUT: RenderTreeCollectionLayout = {
  minimumItemCount: 60,
  overscanPx: 1600,
  defaultViewportHeight: 800,
};

export function createReaderSectionRenderTreeNode(section: VisualSection): RenderTreeNode<ReaderRenderTreeItem> {
  return {
    key: section.key,
    kind: 'section',
    item: section,
    estimatedHeight: estimateReaderSectionHeight(section),
    minimumHeight: 96,
  };
}

export function createReaderBlockRenderTreeNode(block: VisualBlock): RenderTreeNode<ReaderRenderTreeItem> {
  return {
    key: block.id,
    kind: 'block',
    item: block,
    estimatedHeight: estimateReaderBlockHeight(block),
    minimumHeight: 48,
  };
}

function estimateReaderSectionHeight(section: VisualSection): number {
  return Math.max(
    96,
    44
      + section.blocks.reduce((total, block) => total + estimateReaderBlockHeight(block), 0)
      + section.children.reduce((total, child) => total + estimateReaderSectionHeight(child), 0)
  );
}

function estimateReaderBlockHeight(block: VisualBlock): number {
  const textLines = Math.max(1, Math.ceil((block.text?.length ?? 0) / 100));
  switch (block.schema.kind) {
    case 'image':
    case 'carousel':
      return 240;
    case 'table':
      return 64 + Math.max(1, block.schema.tableRows.length) * 32;
    case 'container':
      return 32 + block.schema.containerBlocks.reduce((total, child) => total + estimateReaderBlockHeight(child), 0);
    case 'component-list':
      return 32 + block.schema.componentListBlocks.reduce((total, child) => total + estimateReaderBlockHeight(child), 0);
    case 'grid': {
      const columns = Math.max(1, block.schema.gridColumns);
      const rowHeights: number[] = [];
      block.schema.gridItems.forEach((item, index) => {
        const row = Math.floor(index / columns);
        rowHeights[row] = Math.max(rowHeights[row] ?? 0, estimateReaderBlockHeight(item.block));
      });
      return 32 + rowHeights.reduce((total, height) => total + height, 0);
    }
    case 'expandable':
      return 44
        + block.schema.expandableStubBlocks.children.reduce((total, child) => total + estimateReaderBlockHeight(child), 0)
        + block.schema.expandableContentBlocks.children.reduce((total, child) => total + estimateReaderBlockHeight(child), 0);
    case 'plugin':
      return 180;
    default:
      return 28 + textLines * 20;
  }
}
