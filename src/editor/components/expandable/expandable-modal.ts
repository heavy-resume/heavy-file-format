import type { ComponentRenderHelpers, TextPlaceholderDefinition } from '../../component-helpers';
import type { VisualBlock, VisualSection } from '../../types';
import { sanitizeInlineCss } from '../../../css-sanitizer';
import { EXPANDABLE_CHEVRON_PLACEHOLDER } from '../../../expandable-chevron';
import { closeIcon } from '../../../icons';
import { findBlockByIds } from '../../../block-ops';
import { captureVisibilityStates, restoreVisibilityStates } from '../../../reader/refresh-surfaces';
import { getActiveStateRuntime, getRefreshReaderPanels, runWithStateRuntime, state } from '../../../state';

export const EXPANDABLE_MODAL_HOST_ID = 'readerExpandableModals';
const CLOSE_ACTION = 'close-expandable-modal';
const CLOSE_ANIMATION_MS = 140;

function renderCloseIconSpan(): string {
  return `<span class="hvy-expandable-close" aria-hidden="true">${closeIcon()}</span>`;
}

// The inline form is a plain icon: clicks fall through to the content pane, which already collapses.
export const EXPANDABLE_CLOSE_PLACEHOLDER: TextPlaceholderDefinition = {
  name: 'expandable-close',
  label: 'Expandable close',
  title: 'Insert expandable close',
  render: renderCloseIconSpan,
};

const EXPANDABLE_MODAL_CLOSE_PLACEHOLDER: TextPlaceholderDefinition = {
  ...EXPANDABLE_CLOSE_PLACEHOLDER,
  render: (editable) => editable
    ? renderCloseIconSpan()
    : `<button type="button" class="hvy-expandable-close" data-reader-action="${CLOSE_ACTION}" aria-label="Close">${closeIcon()}</button>`,
};

function getModalKey(sectionKey: string, blockId: string): string {
  return `${sectionKey}:${blockId}`;
}

export function renderExpandableModalHost(innerHtml: string): string {
  return `<div id="${EXPANDABLE_MODAL_HOST_ID}" class="expandable-modal-host hvy-reader-surface">${innerHtml}</div>`;
}

export function renderExpandableModal(section: VisualSection, block: VisualBlock, helpers: ComponentRenderHelpers): string {
  const contentHtml = helpers.renderReaderBlocks(section, block.schema.expandableContentBlocks.children, {
    textPlaceholders: [EXPANDABLE_MODAL_CLOSE_PLACEHOLDER],
    omitTextPlaceholderNames: [EXPANDABLE_CHEVRON_PLACEHOLDER.name],
  });
  const paneStyle = helpers.escapeAttr(sanitizeInlineCss(block.schema.expandableContentCss));
  const label = helpers.escapeAttr(block.schema.expandableContentDescription.trim() || 'Expanded content');
  return `<div class="expandable-modal-root" data-expandable-modal-key="${helpers.escapeAttr(getModalKey(section.key, block.id))}">
    <div class="expandable-modal-backdrop" data-reader-action="${CLOSE_ACTION}"></div>
    <div class="expandable-modal-panel" role="dialog" aria-modal="true" aria-label="${label}" tabindex="-1">
      <button type="button" class="expandable-modal-close" data-reader-action="${CLOSE_ACTION}" aria-label="Close">${closeIcon()}</button>
      <div class="expandable-modal-body">
        <div class="expand-content" style="${paneStyle}">${contentHtml}</div>
      </div>
    </div>
  </div>`;
}

export function openExpandableModal(sectionKey: string, block: VisualBlock): boolean {
  // A true session state means an automatic reveal already expanded this inline.
  if (block.schema.expandablePresentation !== 'modal' || state.readerExpandableState[getModalKey(sectionKey, block.id)] === true) {
    return false;
  }
  if (!state.readerExpandableModals.some((entry) => entry.sectionKey === sectionKey && entry.blockId === block.id)) {
    state.readerExpandableModals.push({ sectionKey, blockId: block.id });
  }
  getRefreshReaderPanels()({ surface: 'expandable-modals' });
  return true;
}

export function closeTopExpandableModal(app: HTMLElement): boolean {
  if (state.readerExpandableModals.length === 0) {
    return false;
  }
  state.readerExpandableModals.pop();
  const runtime = getActiveStateRuntime();
  const refresh = (): void => runWithStateRuntime(runtime, () => getRefreshReaderPanels()({ surface: 'expandable-modals' }));
  const openRoots = app.querySelectorAll<HTMLElement>(`#${EXPANDABLE_MODAL_HOST_ID} > .expandable-modal-root:not(.is-closing)`);
  const closingRoot = openRoots[openRoots.length - 1];
  if (!closingRoot) {
    refresh();
    return true;
  }
  closingRoot.classList.add('is-closing');
  window.setTimeout(refresh, CLOSE_ANIMATION_MS);
  return true;
}

export function handleExpandableModalCloseClick(app: HTMLElement, event: Event, nearestReaderAction: HTMLElement | null): boolean {
  if (nearestReaderAction?.dataset.readerAction !== CLOSE_ACTION) {
    return false;
  }
  event.stopPropagation();
  closeTopExpandableModal(app);
  return true;
}

export function keepFocusInExpandableModal(event: KeyboardEvent): void {
  if (event.key !== 'Tab') {
    return;
  }
  const host = event.currentTarget as HTMLElement;
  const roots = host.querySelectorAll<HTMLElement>('.expandable-modal-root');
  const panel = roots[roots.length - 1]?.querySelector<HTMLElement>('.expandable-modal-panel');
  if (!panel) {
    return;
  }
  const controls = Array.from(panel.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]'))
    .filter((element) => element.getClientRects().length > 0);
  const first = controls[0];
  const last = controls[controls.length - 1];
  const active = host.ownerDocument.activeElement;
  if (!first || !last) {
    return;
  }
  if (event.shiftKey && (active === first || active === panel)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

export interface ExpandableModalSyncOptions {
  root: ParentNode;
  renderModals: () => string;
  capturePluginFocus: () => void;
  afterRender: (host: HTMLElement) => void;
}

export function syncExpandableModals(options: ExpandableModalSyncOptions): void {
  const host = options.root.querySelector<HTMLElement>(`#${EXPANDABLE_MODAL_HOST_ID}`);
  if (!host) {
    return;
  }
  state.readerExpandableModals = state.readerExpandableModals.filter((entry) => findBlockByIds(entry.sectionKey, entry.blockId));
  if (state.readerExpandableModals.length === 0 && host.childElementCount === 0) {
    return;
  }
  const scrollTops = new Map(Array.from(host.querySelectorAll<HTMLElement>('.expandable-modal-root')).map((root) => [
    root.dataset.expandableModalKey,
    root.querySelector<HTMLElement>('.expandable-modal-body')?.scrollTop ?? 0,
  ]));
  const previousVisibility = captureVisibilityStates(host);
  options.capturePluginFocus();
  host.innerHTML = options.renderModals();
  restoreVisibilityStates(host, previousVisibility);
  options.afterRender(host);
  const roots = Array.from(host.querySelectorAll<HTMLElement>('.expandable-modal-root'));
  roots.forEach((root) => {
    const scrollTop = scrollTops.get(root.dataset.expandableModalKey);
    if (scrollTop === undefined) {
      return;
    }
    // Re-rendering an already open modal must not replay its entrance or lose its place.
    root.classList.add('is-settled');
    const body = root.querySelector<HTMLElement>('.expandable-modal-body');
    if (body) {
      body.scrollTop = scrollTop;
    }
  });
  // Navigation can open a modal while someone is still typing in a field such as search.
  if (!host.contains(host.ownerDocument.activeElement) && !host.ownerDocument.activeElement?.matches('input, textarea, select, [contenteditable="true"]')) {
    roots[roots.length - 1]?.querySelector<HTMLElement>('.expandable-modal-panel')?.focus({ preventScroll: true });
  }
}
