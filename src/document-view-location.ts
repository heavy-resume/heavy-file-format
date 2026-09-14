import { getActiveStateRuntime, runWithStateRuntime, state } from './state';
import { restoreVirtualizedBlock, restoreVirtualizedSection } from './section-virtualizer';
import { openExpandableEditorPanelsToBlock } from './block-ops';

interface DocumentViewLocation {
  sectionKey: string;
  blockId?: string;
  viewportFraction: number;
  blockFraction: number;
}

/** Capture document identity and relative position, not offsets from a different layout. */
export function captureReaderViewLocation(root: HTMLElement): DocumentViewLocation | null {
  const scroller = root.querySelector<HTMLElement>('.viewer-shell .reader-document');
  if (!scroller || !scroller.clientHeight) return null;
  const viewport = scroller.getBoundingClientRect();
  const candidates = Array.from(scroller.querySelectorAll<HTMLElement>(
    '[data-hvy-virtual-item="reader-block"], [data-hvy-virtual-section="reader"], [data-hvy-virtual-kind="reader"]'
  )).map((element) => ({ element, rect: element.getBoundingClientRect() }))
    .filter(({ rect }) => rect.height > 0 && rect.width > 0 && rect.bottom > viewport.top && rect.top < viewport.bottom);
  // Prefer the innermost visible component over its section or enclosing container.
  const leaves = candidates.filter(({ element }) => !candidates.some((other) =>
    other.element !== element && element.contains(other.element)));
  leaves.sort((a, b) => Math.max(viewport.top, a.rect.top) - Math.max(viewport.top, b.rect.top));
  const visible = leaves[0];
  if (!visible?.element.dataset.sectionKey) return null;
  return {
    sectionKey: visible.element.dataset.sectionKey,
    blockId: visible.element.dataset.blockId,
    viewportFraction: Math.max(0, visible.rect.top - viewport.top) / scroller.clientHeight,
    blockFraction: Math.max(0, viewport.top - visible.rect.top) / visible.rect.height,
  };
}

export function prepareEditorViewLocation(location: DocumentViewLocation | null): void {
  if (location?.blockId) openExpandableEditorPanelsToBlock(location.sectionKey, location.blockId);
}

/** Restore the same content after editor layout and its deferred scroll restoration. */
export function restoreEditorViewLocation(root: HTMLElement, location: DocumentViewLocation | null): void {
  if (!location) return;
  const scroller = root.querySelector<HTMLElement>('.editor-shell .editor-tree');
  if (!scroller) return;
  const runtime = getActiveStateRuntime();
  const restore = () => runWithStateRuntime(runtime, () => {
    if (!scroller.isConnected || root.querySelector('.editor-shell .editor-tree') !== scroller) return;
    restoreVirtualizedSection(root, location.sectionKey);
    if (location.blockId) restoreVirtualizedBlock(root, location.sectionKey, location.blockId);
    const sectionKey = CSS.escape(location.sectionKey);
    const blockId = location.blockId ? CSS.escape(location.blockId) : null;
    const target = (blockId ? scroller.querySelector<HTMLElement>(
      `[data-section-key="${sectionKey}"][data-block-id="${blockId}"]`
    ) : null) ?? scroller.querySelector<HTMLElement>(`[data-editor-section="${sectionKey}"]`);
    if (!target) return;
    const rect = target.getBoundingClientRect();
    scroller.scrollTop += rect.top - scroller.getBoundingClientRect().top
      + rect.height * location.blockFraction - scroller.clientHeight * location.viewportFraction;
    // Render restoration retains this object for its deferred animation-frame work.
    state.paneScroll.editorTop = scroller.scrollTop;
  });
  restore();
  window.requestAnimationFrame(() => {
    restore();
    window.requestAnimationFrame(restore);
  });
}
