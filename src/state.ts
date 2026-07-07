import type { AppState } from './types';

export type ReaderPanelRefreshSurface = 'all' | 'reader' | 'sidebar';
export interface ReaderPanelRefreshOptions {
  runVisibilityScripts?: boolean;
  surface?: ReaderPanelRefreshSurface;
}

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
type RuntimeCallbacks = {
  renderApp: () => void;
  refreshReaderPanels: (options?: ReaderPanelRefreshOptions) => void;
  refreshReaderSection: (root: ParentNode, sectionKey: string, options?: { runVisibilityScripts?: boolean }) => boolean;
  refreshReaderBlock: (root: ParentNode, sectionKey: string, blockId: string, options?: { runVisibilityScripts?: boolean }) => boolean;
  refreshModalPreview: () => void;
  observeLinks: (root: ParentNode) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  componentRenderHelpers: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readerRenderer: any;
};

export interface StateRuntime {
  state: AppState;
  callbacks: RuntimeCallbacks;
}

function createUninitializedCallbacks(): RuntimeCallbacks {
  return {
    renderApp: () => { throw new Error('renderApp not initialized'); },
    refreshReaderPanels: () => { throw new Error('refreshReaderPanels not initialized'); },
    refreshReaderSection: () => false,
    refreshReaderBlock: () => false,
    refreshModalPreview: () => { throw new Error('refreshModalPreview not initialized'); },
    observeLinks: () => {},
    componentRenderHelpers: null,
    readerRenderer: null,
  };
}

let _renderApp: () => void = () => { throw new Error('renderApp not initialized'); };
let _refreshReaderPanels: (options?: ReaderPanelRefreshOptions) => void = () => { throw new Error('refreshReaderPanels not initialized'); };
let _refreshReaderSection: (root: ParentNode, sectionKey: string, options?: { runVisibilityScripts?: boolean }) => boolean = () => false;
let _refreshReaderBlock: (root: ParentNode, sectionKey: string, blockId: string, options?: { runVisibilityScripts?: boolean }) => boolean = () => false;
let _refreshModalPreview: () => void = () => { throw new Error('refreshModalPreview not initialized'); };
let _observeLinks: (root: ParentNode) => void = () => {};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _componentRenderHelpers: any = null;

export function getRenderApp(): () => void { return _renderApp; }
export function getRefreshReaderPanels(): (options?: ReaderPanelRefreshOptions) => void { return _refreshReaderPanels; }
export function getRefreshReaderSection(): (root: ParentNode, sectionKey: string, options?: { runVisibilityScripts?: boolean }) => boolean { return _refreshReaderSection; }
export function getRefreshReaderBlock(): (root: ParentNode, sectionKey: string, blockId: string, options?: { runVisibilityScripts?: boolean }) => boolean { return _refreshReaderBlock; }
export function getRefreshModalPreview(): () => void { return _refreshModalPreview; }
export function getObserveLinks(): (root: ParentNode) => void { return _observeLinks; }
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
  refreshReaderPanels: (options?: ReaderPanelRefreshOptions) => void;
  refreshReaderSection?: (root: ParentNode, sectionKey: string, options?: { runVisibilityScripts?: boolean }) => boolean;
  refreshReaderBlock?: (root: ParentNode, sectionKey: string, blockId: string, options?: { runVisibilityScripts?: boolean }) => boolean;
  refreshModalPreview: () => void;
  observeLinks?: (root: ParentNode) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  componentRenderHelpers: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readerRenderer: any;
}): void {
  if (!activeRuntime) {
    activeRuntime = {
      state,
      callbacks: createUninitializedCallbacks(),
    };
  }
  activeRuntime.callbacks = {
    ...callbacks,
    refreshReaderSection: callbacks.refreshReaderSection ?? (() => false),
    refreshReaderBlock: callbacks.refreshReaderBlock ?? (() => false),
    observeLinks: callbacks.observeLinks ?? (() => {}),
  };
  activateStateRuntime(activeRuntime);
}

// state is initialized lazily by main.ts after createDefaultDocument is available
export let state: AppState;
let activeRuntime: StateRuntime | null = null;

export function initState(initial: AppState): void {
  if (!activeRuntime) {
    activeRuntime = {
      state: initial,
      callbacks: createUninitializedCallbacks(),
    };
  } else {
    activeRuntime.state = initial;
  }
  activateStateRuntime(activeRuntime);
}

export function createStateRuntime(initial: AppState): StateRuntime {
  return {
    state: initial,
    callbacks: createUninitializedCallbacks(),
  };
}

export function getActiveStateRuntime(): StateRuntime {
  if (!activeRuntime) {
    throw new Error('state runtime not initialized');
  }
  return activeRuntime;
}

export function activateStateRuntime(runtime: StateRuntime): void {
  activeRuntime = runtime;
  state = runtime.state;
  _renderApp = runtime.callbacks.renderApp;
  _refreshReaderPanels = runtime.callbacks.refreshReaderPanels;
  _refreshReaderSection = runtime.callbacks.refreshReaderSection;
  _refreshReaderBlock = runtime.callbacks.refreshReaderBlock;
  _refreshModalPreview = runtime.callbacks.refreshModalPreview;
  _observeLinks = runtime.callbacks.observeLinks;
  _componentRenderHelpers = runtime.callbacks.componentRenderHelpers;
  _readerRenderer = runtime.callbacks.readerRenderer;
}

export function runWithStateRuntime<T>(runtime: StateRuntime, action: () => T): T {
  const previous = activeRuntime;
  activateStateRuntime(runtime);
  try {
    return action();
  } finally {
    if (previous && previous !== runtime) {
      activateStateRuntime(previous);
    }
  }
}

export async function runWithStateRuntimeAsync<T>(runtime: StateRuntime, action: () => Promise<T>): Promise<T> {
  const previous = activeRuntime;
  activateStateRuntime(runtime);
  try {
    return await action();
  } finally {
    if (previous && previous !== runtime) {
      activateStateRuntime(previous);
    }
  }
}
