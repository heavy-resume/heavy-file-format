import type { ReaderRenderer } from './render';
import type { VisualSection } from '../editor/types';

export interface ReaderSurfaceRefreshResult {
  warningsMs: number;
  navMs: number;
  readerMs: number;
  refreshedSidebar: boolean;
  refreshedReader: boolean;
}

export interface ReaderSurfaceRefreshOptions {
  root: ParentNode;
  readerRenderer: ReaderRenderer;
  sections: VisualSection[];
  refreshNavigation?: boolean;
  capturePluginFocus?: () => void;
  reconcilePluginMounts?: (root: HTMLElement) => void;
  runButtonVisibilityScripts?: (root: HTMLElement) => void | Promise<void>;
}

export function refreshReaderSurfaces(options: ReaderSurfaceRefreshOptions): ReaderSurfaceRefreshResult {
  const warnings = options.root.querySelector<HTMLDivElement>('#readerWarnings');
  const nav = options.refreshNavigation
    ? options.root.querySelector<HTMLDivElement>('#readerNav')
    : null;
  const sidebarSections =
    options.root.querySelector<HTMLDivElement>('#readerSidebarSections') ??
    options.root.querySelector<HTMLDivElement>('#aiSidebarSections');
  const reader =
    options.root.querySelector<HTMLDivElement>('#readerDocument') ??
    options.root.querySelector<HTMLDivElement>('#aiReaderDocument');

  let warningsMs = 0;
  let navMs = 0;
  let readerMs = 0;

  if (warnings) {
    const stepStartedAt = performance.now();
    warnings.innerHTML = options.readerRenderer.renderWarnings();
    warningsMs = performance.now() - stepStartedAt;
  }
  if (nav) {
    const stepStartedAt = performance.now();
    nav.innerHTML = options.readerRenderer.renderNavigation(options.sections);
    navMs = performance.now() - stepStartedAt;
  }
  if (sidebarSections) {
    sidebarSections.innerHTML = options.readerRenderer.renderSidebarSections(options.sections);
  }
  if (reader) {
    const stepStartedAt = performance.now();
    options.capturePluginFocus?.();
    reader.innerHTML = options.readerRenderer.renderReaderSections(options.sections);
    options.reconcilePluginMounts?.(reader);
    void options.runButtonVisibilityScripts?.(reader);
    readerMs = performance.now() - stepStartedAt;
  }

  return {
    warningsMs,
    navMs,
    readerMs,
    refreshedSidebar: Boolean(sidebarSections),
    refreshedReader: Boolean(reader),
  };
}
