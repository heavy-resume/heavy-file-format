import './target-text-comparison.css';
import type { VisualBlock } from '../editor/types';
import type { ReaderRenderer } from '../reader/render';
import { createReaderBlockElement } from '../reader/block-refresh';
import type { HvyTarget } from '../embed-target';
import type { PreparedTargetReplacement } from '../embed-target-edit';
import { diffTextGraphemes, segmentTextGraphemes } from './target-text-diff';

export interface HvyTargetTextComparisonOptions {
  target: HvyTarget & { blockId: string };
  proposedHvy: string;
  beforeRoot: HTMLElement;
  afterRoot: HTMLElement;
  /** Defaults to expanded so all expandable content participates in review. */
  expandableMode?: 'expanded' | 'configured' | 'collapsed';
}

export interface HvyTargetTextComparison {
  originalHvy: string;
  proposedHvy: string;
  destroy(): void;
}

interface TextUnit {
  value: string;
  node: Text | null;
  start: number;
  end: number;
}

export function renderPreparedTargetTextComparison(options: {
  prepared: PreparedTargetReplacement;
  readerRenderer: ReaderRenderer;
  themeSource: HTMLElement;
  beforeRoot: HTMLElement;
  afterRoot: HTMLElement;
  expandableMode?: HvyTargetTextComparisonOptions['expandableMode'];
}): HvyTargetTextComparison {
  const beforePreviewBlock = createComparisonBlock(options.prepared.originalBlock, options.expandableMode ?? 'expanded');
  const afterPreviewBlock = createComparisonBlock(options.prepared.proposedBlock, options.expandableMode ?? 'expanded');
  const beforeHost = createPreviewHost(options.beforeRoot.ownerDocument, options.themeSource, 'removed');
  const afterHost = createPreviewHost(options.afterRoot.ownerDocument, options.themeSource, 'added');
  options.beforeRoot.append(beforeHost.host);
  options.afterRoot.append(afterHost.host);

  const renderComparison = (): void => {
    const beforeBlock = createReaderBlockElement(
      options.beforeRoot.ownerDocument,
      options.readerRenderer,
      options.prepared.section,
      beforePreviewBlock,
      { ignoreReaderSessionState: true, suppressAiEditorDelegation: true, suppressEditingAffordances: true }
    );
    const afterBlock = createReaderBlockElement(
      options.afterRoot.ownerDocument,
      options.readerRenderer,
      options.prepared.section,
      afterPreviewBlock,
      { ignoreReaderSessionState: true, suppressAiEditorDelegation: true, suppressEditingAffordances: true }
    );
    if (!beforeBlock || !afterBlock) {
      throw new Error('The target component did not produce a visible preview.');
    }
    disablePreviewNavigation(beforeBlock);
    disablePreviewNavigation(afterBlock);
    beforeHost.surface.replaceChildren(beforeBlock);
    afterHost.surface.replaceChildren(afterBlock);
    decorateRenderedTextChanges(beforeBlock, afterBlock);
  };
  const handleBeforeClick = createExpandableClickHandler(beforeHost.host, beforePreviewBlock, renderComparison);
  const handleAfterClick = createExpandableClickHandler(afterHost.host, afterPreviewBlock, renderComparison);
  const blockBeforeNavigation = createDisabledNavigationHandler(beforeHost.host);
  const blockAfterNavigation = createDisabledNavigationHandler(afterHost.host);
  beforeHost.host.addEventListener('click', handleBeforeClick);
  afterHost.host.addEventListener('click', handleAfterClick);
  beforeHost.host.addEventListener('click', blockBeforeNavigation, true);
  afterHost.host.addEventListener('click', blockAfterNavigation, true);
  try {
    renderComparison();
  } catch (error) {
    beforeHost.host.removeEventListener('click', handleBeforeClick);
    afterHost.host.removeEventListener('click', handleAfterClick);
    beforeHost.host.removeEventListener('click', blockBeforeNavigation, true);
    afterHost.host.removeEventListener('click', blockAfterNavigation, true);
    beforeHost.host.remove();
    afterHost.host.remove();
    throw error;
  }

  return {
    originalHvy: options.prepared.originalHvy,
    proposedHvy: options.prepared.proposedHvy,
    destroy() {
      beforeHost.host.removeEventListener('click', handleBeforeClick);
      afterHost.host.removeEventListener('click', handleAfterClick);
      beforeHost.host.removeEventListener('click', blockBeforeNavigation, true);
      afterHost.host.removeEventListener('click', blockAfterNavigation, true);
      beforeHost.host.remove();
      afterHost.host.remove();
    },
  };
}

function createDisabledNavigationHandler(host: HTMLElement): (event: MouseEvent) => void {
  return (event) => {
    const target = event.target as Element | null;
    const link = target?.closest?.<HTMLElement>('[data-hvy-comparison-disabled-link="true"]');
    if (!link || !host.contains(link)) return;
    event.preventDefault();
    event.stopPropagation();
  };
}

function disablePreviewNavigation(root: HTMLElement): void {
  const selector = 'a, [data-hvy-link-kind="xref-card"]';
  const links = [
    ...(root.matches(selector) ? [root] : []),
    ...Array.from(root.querySelectorAll<HTMLElement>(selector)),
  ];
  links.forEach((link) => {
    link.removeAttribute('href');
    link.removeAttribute('target');
    link.setAttribute('aria-disabled', 'true');
    link.setAttribute('tabindex', '-1');
    link.dataset.hvyComparisonDisabledLink = 'true';
  });
}

function createExpandableClickHandler(
  host: HTMLElement,
  previewBlock: VisualBlock,
  renderComparison: () => void
): (event: MouseEvent) => void {
  return (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const expandable = target.closest<HTMLElement>('[data-reader-action="toggle-expandable"]');
    if (!expandable || !host.contains(expandable)) return;
    if (target.closest('a, button, input, select, textarea, [contenteditable="true"], [role="button"]')) return;
    const blockId = expandable.dataset.blockId;
    const block = blockId ? findOwnedBlock(previewBlock, blockId) : null;
    if (!block || block.schema.kind !== 'expandable') return;
    event.preventDefault();
    event.stopPropagation();
    block.schema.expandableExpanded = !block.schema.expandableExpanded;
    renderComparison();
  };
}

function createComparisonBlock(
  source: VisualBlock,
  expandableMode: NonNullable<HvyTargetTextComparisonOptions['expandableMode']>
): VisualBlock {
  const block = JSON.parse(JSON.stringify(source)) as VisualBlock;
  if (expandableMode === 'configured') return block;
  visitOwnedBlocks([block], (candidate) => {
    if (candidate.schema.kind === 'expandable') {
      candidate.schema.expandableExpanded = expandableMode === 'expanded';
    }
  });
  return block;
}

function visitOwnedBlocks(blocks: readonly VisualBlock[], visit: (block: VisualBlock) => void, seen = new Set<VisualBlock>()): void {
  blocks.forEach((block) => {
    if (seen.has(block)) return;
    seen.add(block);
    visit(block);
    visitOwnedBlocks([
      ...(block.schema.containerBlocks ?? []),
      ...(block.schema.componentListBlocks ?? []),
      ...(block.schema.gridItems ?? []).map((item) => item.block),
      ...(block.schema.expandableStubBlocks?.children ?? []),
      ...(block.schema.expandableContentBlocks?.children ?? []),
      ...(block.schema.encryptedBlock ? [block.schema.encryptedBlock] : []),
    ], visit, seen);
  });
}

function findOwnedBlock(root: VisualBlock, blockId: string): VisualBlock | null {
  let match: VisualBlock | null = null;
  visitOwnedBlocks([root], (block) => {
    if (!match && block.id === blockId) match = block;
  });
  return match;
}

function createPreviewHost(ownerDocument: Document, themeSource: HTMLElement, side: 'removed' | 'added'): {
  host: HTMLElement;
  surface: HTMLElement;
} {
  const host = ownerDocument.createElement('div');
  host.className = 'hvy-document hvy-target-text-comparison-preview';
  host.dataset.hvyComparisonSide = side;
  host.classList.toggle('theme-dark', themeSource.classList.contains('theme-dark'));
  host.classList.toggle('hvy-recolor-strikethrough', themeSource.classList.contains('hvy-recolor-strikethrough'));
  for (let index = 0; index < themeSource.style.length; index += 1) {
    const name = themeSource.style.item(index);
    if (name.startsWith('--hvy-')) host.style.setProperty(name, themeSource.style.getPropertyValue(name));
  }
  const surface = ownerDocument.createElement('div');
  surface.className = 'reader-document hvy-reader-surface hvy-surface hvy-target-text-comparison-surface';
  host.append(surface);
  return { host, surface };
}

function collectTextUnits(root: HTMLElement): TextUnit[] {
  const units: TextUnit[] = [];
  const visit = (node: Node): void => {
    if (node.nodeType === 3) {
      const textNode = node as Text;
      segmentTextGraphemes(textNode.data).forEach(({ segment, start, end }) => {
        units.push({ value: segment, node: textNode, start, end });
      });
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as HTMLElement;
    if (element.matches('script, style, [aria-hidden="true"], .text-copy-button')) return;
    if (element.tagName === 'BR') {
      units.push({ value: '\n', node: null, start: 0, end: 0 });
      return;
    }
    const boundary = isTextBoundary(element);
    if (boundary && units.length > 0 && units[units.length - 1]?.value !== '\n') {
      units.push({ value: '\n', node: null, start: 0, end: 0 });
    }
    element.childNodes.forEach(visit);
    if (boundary && units.length > 0 && units[units.length - 1]?.value !== '\n') {
      units.push({ value: '\n', node: null, start: 0, end: 0 });
    }
  };
  root.childNodes.forEach(visit);
  while (units[0]?.value === '\n') units.shift();
  while (units[units.length - 1]?.value === '\n') units.pop();
  return units;
}

function decorateRenderedTextChanges(beforeRoot: HTMLElement, afterRoot: HTMLElement): void {
  const beforeBlocks = findRenderedTextBlocks(beforeRoot);
  const afterBlocks = findRenderedTextBlocks(afterRoot);
  const pairs = pairRenderedTextBlocks(beforeBlocks, afterBlocks);
  pairs.forEach(({ before, after }) => {
    const beforeUnits = before ? collectTextUnits(before) : [];
    const afterUnits = after ? collectTextUnits(after) : [];
    const selection = diffTextGraphemes(
      beforeUnits.map((unit) => unit.value),
      afterUnits.map((unit) => unit.value)
    );
    markSelectedUnits(beforeUnits, selection.removed, 'del', 'hvy-target-text-diff-removed');
    markSelectedUnits(afterUnits, selection.added, 'ins', 'hvy-target-text-diff-added');
  });
}

function findRenderedTextBlocks(root: HTMLElement): HTMLElement[] {
  return [
    ...(root.classList.contains('reader-block-text') ? [root] : []),
    ...Array.from(root.querySelectorAll<HTMLElement>('.reader-block-text')),
  ];
}

function pairRenderedTextBlocks(
  beforeBlocks: readonly HTMLElement[],
  afterBlocks: readonly HTMLElement[]
): Array<{ before: HTMLElement | null; after: HTMLElement | null }> {
  const pairs: Array<{ before: HTMLElement | null; after: HTMLElement | null }> = [];
  const unmatchedBefore = new Set(beforeBlocks);
  const unmatchedAfter = new Set(afterBlocks);
  const matchBy = (readKey: (block: HTMLElement) => string): void => {
    const afterByKey = uniqueElementsByKey([...unmatchedAfter], readKey);
    uniqueElementsByKey([...unmatchedBefore], readKey).forEach((before, key) => {
      const after = afterByKey.get(key);
      if (!after) return;
      pairs.push({ before, after });
      unmatchedBefore.delete(before);
      unmatchedAfter.delete(after);
    });
  };
  matchBy((block) => block.dataset.componentId ?? '');
  matchBy((block) => block.dataset.blockId ?? '');

  const remainingBefore = [...unmatchedBefore];
  const remainingAfter = [...unmatchedAfter];
  const remainingCount = Math.max(remainingBefore.length, remainingAfter.length);
  for (let index = 0; index < remainingCount; index += 1) {
    pairs.push({ before: remainingBefore[index] ?? null, after: remainingAfter[index] ?? null });
  }
  return pairs;
}

function uniqueElementsByKey(
  elements: readonly HTMLElement[],
  readKey: (element: HTMLElement) => string
): Map<string, HTMLElement> {
  const candidates = new Map<string, HTMLElement | null>();
  elements.forEach((element) => {
    const key = readKey(element);
    if (!key) return;
    candidates.set(key, candidates.has(key) ? null : element);
  });
  return new Map([...candidates].filter((entry): entry is [string, HTMLElement] => entry[1] !== null));
}

function isTextBoundary(element: HTMLElement): boolean {
  return ['P', 'DIV', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(element.tagName);
}

function markSelectedUnits(
  units: readonly TextUnit[],
  selected: readonly boolean[],
  tagName: 'del' | 'ins',
  className: string
): void {
  const ranges: Array<{ node: Text; start: number; end: number }> = [];
  units.forEach((unit, index) => {
    if (!selected[index] || !unit.node) return;
    const previous = ranges[ranges.length - 1];
    if (previous?.node === unit.node && previous.end === unit.start) {
      previous.end = unit.end;
    } else {
      ranges.push({ node: unit.node, start: unit.start, end: unit.end });
    }
  });
  ranges.reverse().forEach(({ node, start, end }) => {
    const wrapper = node.ownerDocument.createElement(tagName);
    wrapper.className = className;
    const range = node.ownerDocument.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    range.surroundContents(wrapper);
  });
}
