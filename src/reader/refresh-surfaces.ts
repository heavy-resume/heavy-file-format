import type { ReaderRenderer } from './render';
import type { VisualSection } from '../editor/types';
import { elapsedMs, nowMs } from '../perf-trace';

export interface ReaderSurfaceRefreshResult {
  warningsMs: number;
  navMs: number;
  sidebarRenderMs: number;
  sidebarDomMs: number;
  sidebarPostMs: number;
  readerRenderMs: number;
  readerDomMs: number;
  readerPostMs: number;
  readerMs: number;
  refreshedSidebar: boolean;
  refreshedReader: boolean;
}

export interface ReaderSurfaceRefreshOptions {
  root: ParentNode;
  readerRenderer: ReaderRenderer;
  sections: VisualSection[];
  refreshNavigation?: boolean;
  refreshReader?: boolean;
  refreshSidebar?: boolean;
  capturePluginFocus?: () => void;
  reconcilePluginMounts?: (root: HTMLElement) => void;
  runButtonVisibilityScripts?: (root: HTMLElement) => void | Promise<void>;
}

export function refreshReaderSurfaces(options: ReaderSurfaceRefreshOptions): ReaderSurfaceRefreshResult {
  const refreshSidebar = options.refreshSidebar !== false;
  const refreshReader = options.refreshReader !== false;
  const warnings = options.root.querySelector<HTMLDivElement>('#readerWarnings');
  const nav = options.refreshNavigation
    ? options.root.querySelector<HTMLDivElement>('#readerNav')
    : null;
  const sidebarSections = refreshSidebar
    ? options.root.querySelector<HTMLDivElement>('#readerSidebarSections') ??
      options.root.querySelector<HTMLDivElement>('#aiSidebarSections')
    : null;
  const reader = refreshReader
    ? options.root.querySelector<HTMLDivElement>('#readerDocument') ??
      options.root.querySelector<HTMLDivElement>('#aiReaderDocument')
    : null;

  let warningsMs = 0;
  let navMs = 0;
  let sidebarRenderMs = 0;
  let sidebarDomMs = 0;
  let sidebarPostMs = 0;
  let readerRenderMs = 0;
  let readerDomMs = 0;
  let readerPostMs = 0;
  let readerMs = 0;

  if (warnings) {
    const stepStartedAt = nowMs();
    warnings.innerHTML = options.readerRenderer.renderWarnings();
    warningsMs = performance.now() - stepStartedAt;
  }
  if (nav) {
    const stepStartedAt = nowMs();
    nav.innerHTML = options.readerRenderer.renderNavigation(options.sections);
    navMs = performance.now() - stepStartedAt;
  }
  if (sidebarSections) {
    const stepStartedAt = nowMs();
    const scrollTop = sidebarSections.scrollTop;
    const scrollLeft = sidebarSections.scrollLeft;
    const previousVisibility = captureVisibilityStates(sidebarSections);
    options.capturePluginFocus?.();
    let phaseStartedAt = nowMs();
    const sidebarHtml = options.readerRenderer.renderSidebarSections(options.sections);
    sidebarRenderMs = elapsedMs(phaseStartedAt);
    phaseStartedAt = nowMs();
    sidebarSections.innerHTML = sidebarHtml;
    sidebarSections.scrollTop = scrollTop;
    sidebarSections.scrollLeft = scrollLeft;
    restoreVisibilityStates(sidebarSections, previousVisibility);
    sidebarDomMs = elapsedMs(phaseStartedAt);
    phaseStartedAt = nowMs();
    options.reconcilePluginMounts?.(sidebarSections);
    void options.runButtonVisibilityScripts?.(sidebarSections);
    sidebarPostMs = elapsedMs(phaseStartedAt);
    readerMs += performance.now() - stepStartedAt;
  }
  if (reader) {
    const stepStartedAt = nowMs();
    const scrollTop = reader.scrollTop;
    const scrollLeft = reader.scrollLeft;
    const previousVisibility = captureVisibilityStates(reader);
    options.capturePluginFocus?.();
    let phaseStartedAt = nowMs();
    const readerHtml = options.readerRenderer.renderReaderSections(options.sections);
    readerRenderMs = elapsedMs(phaseStartedAt);
    phaseStartedAt = nowMs();
    reader.innerHTML = readerHtml;
    reader.scrollTop = scrollTop;
    reader.scrollLeft = scrollLeft;
    restoreVisibilityStates(reader, previousVisibility);
    readerDomMs = elapsedMs(phaseStartedAt);
    phaseStartedAt = nowMs();
    options.reconcilePluginMounts?.(reader);
    void options.runButtonVisibilityScripts?.(reader);
    readerPostMs = elapsedMs(phaseStartedAt);
    readerMs = performance.now() - stepStartedAt;
  }

  return {
    warningsMs,
    navMs,
    sidebarRenderMs,
    sidebarDomMs,
    sidebarPostMs,
    readerRenderMs,
    readerDomMs,
    readerPostMs,
    readerMs,
    refreshedSidebar: Boolean(sidebarSections),
    refreshedReader: Boolean(reader),
  };
}

export function captureVisibilityStates(root: ParentNode): Map<string, string> {
  const states = new Map<string, string>();
  root.querySelectorAll<HTMLElement>('[data-hvy-dynamic-visibility="true"], [data-hvy-button="true"]').forEach((element) => {
    const key = getVisibilityStateKey(element);
    const value = element.dataset.visibleState;
    if (key && value) {
      states.set(key, value);
    }
  });
  return states;
}

export function restoreVisibilityStates(root: ParentNode, states: Map<string, string>): void {
  if (states.size === 0) {
    return;
  }
  root.querySelectorAll<HTMLElement>('[data-hvy-dynamic-visibility="true"], [data-hvy-button="true"]').forEach((element) => {
    const key = getVisibilityStateKey(element);
    const value = key ? states.get(key) : undefined;
    if (value) {
      element.dataset.visibleState = value;
    }
  });
}

function getVisibilityStateKey(element: HTMLElement): string {
  const sectionKey = element.dataset.sectionKey ?? '';
  const blockId = element.dataset.blockId ?? '';
  const componentId = element.dataset.componentId ?? '';
  if (!sectionKey || !blockId) {
    return '';
  }
  const kind = element.dataset.hvyButton === 'true' ? 'button' : 'block';
  return `${kind}:${sectionKey}:${blockId}:${componentId}`;
}
