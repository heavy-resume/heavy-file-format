export interface RenderTreeWindowOptions {
  scrollTop: number;
  viewportHeight?: number;
  forceNodeKeys?: ReadonlySet<string>;
  layoutOffsetTop?: number;
  layoutColumns?: number;
}

export interface RenderTreeNode<TItem extends object> {
  key: string;
  kind: 'section' | 'block';
  item: TItem;
  estimatedHeight: number;
  minimumHeight: number;
}

export interface RenderTreeWindowEntry<TItem extends object> {
  node: RenderTreeNode<TItem>;
  estimatedHeight: number;
  offsetTop: number;
  shouldRender: boolean;
}

export interface RenderTreeCollectionLayout {
  minimumItemCount: number;
  overscanPx: number;
  defaultViewportHeight: number;
}

export interface RenderTreeHeightLedger {
  plan<TItem extends object>(
    nodes: Array<RenderTreeNode<TItem>>,
    options: RenderTreeWindowOptions | undefined,
    layout: RenderTreeCollectionLayout
  ): Array<RenderTreeWindowEntry<TItem>>;
  record(node: RenderTreeNode<object>, height: number): void;
}

export function createRenderTreeHeightLedger(): RenderTreeHeightLedger {
  const measuredHeights = new WeakMap<object, number>();

  return {
    plan(nodes, options, layout) {
      const estimates = nodes.map((node) => Math.max(
        node.minimumHeight,
        measuredHeights.get(node.item) ?? node.estimatedHeight
      ));
      const layoutColumns = Math.max(1, Math.floor(options?.layoutColumns ?? 1));
      const viewportHeight = Math.max(1, options?.viewportHeight ?? layout.defaultViewportHeight);
      const windowStart = Math.max(0, (options?.scrollTop ?? 0) - layout.overscanPx);
      const windowEnd = (options?.scrollTop ?? 0) + viewportHeight + layout.overscanPx;
      const shouldWindow = Boolean(options) && nodes.length >= layout.minimumItemCount;
      let offsetTop = options?.layoutOffsetTop ?? 0;

      return nodes.map((node, index) => {
        const estimatedHeight = estimates[index] ?? node.minimumHeight;
        const rowStartIndex = Math.floor(index / layoutColumns) * layoutColumns;
        const rowHeight = Math.max(node.minimumHeight, ...estimates.slice(rowStartIndex, rowStartIndex + layoutColumns));
        const entryOffsetTop = offsetTop;
        const offsetBottom = entryOffsetTop + rowHeight;
        const shouldRender = !shouldWindow
          || (offsetBottom >= windowStart && entryOffsetTop <= windowEnd)
          || Boolean(options?.forceNodeKeys?.has(node.key));
        if ((index + 1) % layoutColumns === 0 || index === nodes.length - 1) {
          offsetTop = offsetBottom;
        }
        return { node, estimatedHeight, offsetTop: entryOffsetTop, shouldRender };
      });
    },
    record(node, height) {
      if (Number.isFinite(height) && height > 0) {
        measuredHeights.set(node.item, Math.max(1, height));
      }
    },
  };
}

export function createChildRenderTreeWindowOptions(
  options: RenderTreeWindowOptions | undefined,
  offsetTop: number,
  inset = 0
): RenderTreeWindowOptions | undefined {
  return options ? {
    ...options,
    layoutOffsetTop: offsetTop + inset,
    layoutColumns: 1,
  } : undefined;
}
