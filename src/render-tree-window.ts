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
  // Nodes sharing a shape key (such as a component name) are expected to have similar heights, so the
  // median of measured siblings stands in for the estimate of unmeasured ones. Shaped nodes are measured
  // by footprint (their top to the next sibling's top).
  shapeKey?: string;
}

export interface RenderTreeWindowEntry<TItem extends object> {
  node: RenderTreeNode<TItem>;
  estimatedHeight: number;
  measured: boolean;
  offsetTop: number;
  shouldRender: boolean;
}

export interface RenderTreeItemSize {
  shapeKey?: string;
  height: number;
  measured: boolean;
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
      const measured = nodes.map((node) => measuredHeights.get(node.item));
      const shapeHeights = medianHeightsByShape(nodes.flatMap((node, index) => {
        const height = measured[index];
        return height === undefined ? [] : [{ shapeKey: node.shapeKey, height, measured: true }];
      }));
      const estimates = nodes.map((node, index) => {
        if (node.shapeKey === undefined) {
          return Math.max(node.minimumHeight, measured[index] ?? node.estimatedHeight);
        }
        // Shaped nodes are measured by footprint (including spacing), so measurements stand as they are and
        // the minimum only guards the rough estimate.
        return measured[index] ?? shapeHeights.get(node.shapeKey) ?? Math.max(node.minimumHeight, node.estimatedHeight);
      });
      const layoutColumns = Math.max(1, Math.floor(options?.layoutColumns ?? 1));
      const viewportHeight = Math.max(1, options?.viewportHeight ?? layout.defaultViewportHeight);
      const windowStart = Math.max(0, (options?.scrollTop ?? 0) - layout.overscanPx);
      const windowEnd = (options?.scrollTop ?? 0) + viewportHeight + layout.overscanPx;
      const shouldWindow = Boolean(options) && nodes.length >= layout.minimumItemCount;
      let offsetTop = options?.layoutOffsetTop ?? 0;

      return nodes.map((node, index) => {
        const estimatedHeight = estimates[index] ?? node.minimumHeight;
        const rowStartIndex = Math.floor(index / layoutColumns) * layoutColumns;
        const rowHeight = Math.max(...estimates.slice(rowStartIndex, rowStartIndex + layoutColumns));
        const entryOffsetTop = offsetTop;
        const offsetBottom = entryOffsetTop + rowHeight;
        const shouldRender = !shouldWindow
          || (offsetBottom >= windowStart && entryOffsetTop <= windowEnd)
          || Boolean(options?.forceNodeKeys?.has(node.key));
        if ((index + 1) % layoutColumns === 0 || index === nodes.length - 1) {
          offsetTop = offsetBottom;
        }
        return { node, estimatedHeight, measured: measured[index] !== undefined, offsetTop: entryOffsetTop, shouldRender };
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

// The median keeps one-off blocks from skewing the size assumed for every unmeasured block of the same shape.
export function medianHeightsByShape(sizes: Iterable<RenderTreeItemSize>): Map<string, number> {
  const heights = new Map<string, number[]>();
  for (const size of sizes) {
    if (!size.measured || size.shapeKey === undefined || !(size.height > 0)) {
      continue;
    }
    const shapeHeights = heights.get(size.shapeKey) ?? [];
    shapeHeights.push(size.height);
    heights.set(size.shapeKey, shapeHeights);
  }
  return new Map(Array.from(heights, ([shapeKey, shapeHeights]) => {
    const sorted = shapeHeights.sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
    return [shapeKey, median];
  }));
}

// Attributes for a placeholder that stands in for a run of unrendered nodes. The per-item sizes let the
// section virtualizer resize the placeholder in place once rendered siblings of the same shape are measured.
export function renderRenderTreeRangePlaceholderAttrs<TItem extends object>(
  entries: Array<RenderTreeWindowEntry<TItem>>,
  escapeAttr: (value: string) => string
): string {
  const blockIds = entries.map((entry) => entry.node.key).join(' ');
  const sizes: RenderTreeItemSize[] = entries.map((entry) => ({
    shapeKey: entry.node.shapeKey,
    height: entry.estimatedHeight,
    measured: entry.measured,
  }));
  const height = entries.reduce((total, entry) => total + entry.estimatedHeight, 0);
  return `data-block-ids="${escapeAttr(blockIds)}" data-hvy-virtual-item-sizes="${escapeAttr(JSON.stringify(sizes))}" style="min-height: ${Math.ceil(height)}px;"`;
}
