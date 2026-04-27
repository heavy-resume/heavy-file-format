import type { AppState } from './types';

export const HISTORY_GROUP_WINDOW_MS = 1200;
export const REUSABLE_SECTION_PREFIX = '__reusable__:';
export const REUSABLE_SECTION_DEF_PREFIX = 'section-def:';

export let pendingLinkRange: Range | null = null;
export let pendingLinkEditable: HTMLElement | null = null;
export let pendingLinkAnchor: HTMLAnchorElement | null = null;
export let draggedSectionKey: string | null = null;
export let draggedTableItem: { kind: 'row' | 'column'; sectionKey: string; blockId: string; index: number } | null = null;
export let shortcutsBound = false;
export let appEventsBound = false;
export let renderCount = 0;
export let inputEventCount = 0;
export let refreshReaderCount = 0;
export let syncReusableCount = 0;
export let historySnapshotCount = 0;
export let recordHistoryCount = 0;

export function setPendingLinkRange(r: Range | null): void { pendingLinkRange = r; }
export function setPendingLinkEditable(e: HTMLElement | null): void { pendingLinkEditable = e; }
export function setPendingLinkAnchor(a: HTMLAnchorElement | null): void { pendingLinkAnchor = a; }
export function setDraggedSectionKey(k: string | null): void { draggedSectionKey = k; }
export function setDraggedTableItem(d: typeof draggedTableItem): void { draggedTableItem = d; }
export function setShortcutsBound(v: boolean): void { shortcutsBound = v; }
export function setAppEventsBound(v: boolean): void { appEventsBound = v; }
export function incrementRenderCount(): number { return ++renderCount; }
export function incrementInputEventCount(): number { return ++inputEventCount; }
export function incrementRefreshReaderCount(): number { return ++refreshReaderCount; }
export function incrementSyncReusableCount(): number { return ++syncReusableCount; }
export function incrementHistorySnapshotCount(): number { return ++historySnapshotCount; }
export function incrementRecordHistoryCount(): number { return ++recordHistoryCount; }

// Late-bound callbacks to avoid circular imports
let _renderApp: () => void = () => { throw new Error('renderApp not initialized'); };
let _refreshReaderPanels: () => void = () => { throw new Error('refreshReaderPanels not initialized'); };
let _refreshModalPreview: () => void = () => { throw new Error('refreshModalPreview not initialized'); };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _componentRenderHelpers: any = null;

export function getRenderApp(): () => void { return _renderApp; }
export function getRefreshReaderPanels(): () => void { return _refreshReaderPanels; }
export function getRefreshModalPreview(): () => void { return _refreshModalPreview; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getCachedComponentRenderHelpers(): any {
  if (_componentRenderHelpers === null) {
    throw new Error('componentRenderHelpers not initialized');
  }
  return _componentRenderHelpers;
}

let _readerRenderer: any = null;
export function getReaderRenderer(): any {
  if (_readerRenderer === null) {
    throw new Error('readerRenderer not initialized');
  }
  return _readerRenderer;
}

export function initCallbacks(callbacks: {
  renderApp: () => void;
  refreshReaderPanels: () => void;
  refreshModalPreview: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  componentRenderHelpers: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readerRenderer: any;
}): void {
  _renderApp = callbacks.renderApp;
  _refreshReaderPanels = callbacks.refreshReaderPanels;
  _refreshModalPreview = callbacks.refreshModalPreview;
  _componentRenderHelpers = callbacks.componentRenderHelpers;
  _readerRenderer = callbacks.readerRenderer;
}

// state is initialized lazily by main.ts after createDefaultDocument is available
export let state: AppState;

export function initState(initial: AppState): void {
  state = initial;
}
