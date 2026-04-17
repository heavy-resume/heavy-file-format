import type { VisualBlock, VisualSection } from './editor/types';
import { state, getRefreshReaderPanels } from './state';
import { getSectionId, flattenSections } from './section-ops';
import { resolveBaseComponent } from './component-defs';
import { createBlankDocument } from './document-factory';
import { getRenderApp } from './state';

/**
 * Directly update the sidebar open/closed state on the DOM without a full re-render,
 * so CSS transitions play. Also keeps `state.viewerSidebarOpen` in sync.
 */
export function setSidebarOpen(app: HTMLElement, open: boolean): void {
  state.viewerSidebarOpen = open;
  const shell = app.querySelector<HTMLElement>('.viewer-shell');
  if (!shell) {
    return;
  }
  shell.classList.toggle('is-sidebar-open', open);
  shell.classList.toggle('is-sidebar-closed', !open);
  const tab = shell.querySelector<HTMLButtonElement>('.viewer-sidebar-tab');
  if (tab) {
    tab.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
}

export function navigateToSection(sectionId: string, app: HTMLElement): void {
  if (!sectionId) {
    return;
  }
  closeModal();
  const sectionFound = expandSectionPathById(state.document.sections, sectionId);
  const blockFound = expandBlockPathBySchemaId(state.document.sections, sectionId);

  // Auto-open the sidebar when the target lives there. Never auto-close —
  // the sidebar is closed only via the toggle button or backdrop.
  const targetSection = flattenSections(state.document.sections).find(
    (s) => !s.isGhost && getSectionId(s) === sectionId
  );
  if (targetSection?.location === 'sidebar' && !state.viewerSidebarOpen) {
    setSidebarOpen(app, true);
  }

  // Only re-render when expand state actually changed to avoid rebuilding
  // the sidebar DOM mid-animation.
  if (sectionFound || blockFound) {
    getRefreshReaderPanels()();
  }

  // Apply and remove the highlight directly on the DOM element — no re-render needed.
  window.requestAnimationFrame(() => {
    const target = app.querySelector<HTMLElement>(`#${CSS.escape(sectionId)}`);
    if (!target) {
      console.error('[hvy:navigation] Unable to find reader target for internal link.', {
        targetId: sectionId,
        sectionFound,
        blockFound,
        availableReaderIds: getReaderTargetIds(app),
      });
      return;
    }

    target.classList.add('is-temp-highlighted');
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => {
      target.classList.remove('is-temp-highlighted');
    }, 1400);
  });
}

export function getReaderTargetIds(app: HTMLElement): string[] {
  return [...app.querySelectorAll<HTMLElement>('#readerDocument [id], #readerSidebarSections [id]')].map((element) => element.id);
}

export function expandSectionPathById(sections: VisualSection[], sectionId: string): boolean {
  for (const section of sections) {
    if (getSectionId(section) === sectionId) {
      section.expanded = true;
      return true;
    }
    if (expandSectionPathById(section.children, sectionId)) {
      section.expanded = true;
      return true;
    }
  }
  return false;
}

export function expandBlockPathBySchemaId(sections: VisualSection[], schemaId: string): boolean {
  for (const section of sections) {
    if (expandBlockPathInList(section.blocks, schemaId)) {
      section.expanded = true;
      return true;
    }
    if (expandBlockPathBySchemaId(section.children, schemaId)) {
      section.expanded = true;
      return true;
    }
  }
  return false;
}

function expandBlockPathInList(blocks: VisualBlock[], schemaId: string): boolean {
  for (const block of blocks) {
    const isTarget = block.schema.id === schemaId;
    if (isTarget && resolveBaseComponent(block.schema.component) === 'expandable') {
      block.schema.expandableExpanded = true;
      return true;
    }
    const nestedFound =
      expandBlockPathInList(block.schema.containerBlocks ?? [], schemaId)
      || expandBlockPathInList(block.schema.componentListBlocks ?? [], schemaId)
      || expandBlockPathInList((block.schema.gridItems ?? []).map((item) => item.block), schemaId)
      || expandBlockPathInList(block.schema.expandableStubBlocks ?? [], schemaId)
      || expandBlockPathInList(block.schema.expandableContentBlocks ?? [], schemaId)
      || (block.schema.tableRows ?? []).some((row) => expandBlockPathInList(row.detailsBlocks ?? [], schemaId));
    if (nestedFound) {
      if (resolveBaseComponent(block.schema.component) === 'expandable') {
        block.schema.expandableExpanded = true;
      }
      return true;
    }
    if (isTarget) {
      return true;
    }
  }
  return false;
}

export function closeModal(): void {
  state.modalSectionKey = null;
  state.componentMetaModal = null;
  state.reusableSaveModal = null;
}

export function closeModalIfTarget(sectionKey: string): void {
  if (state.modalSectionKey === sectionKey) {
    closeModal();
  }
  if (state.componentMetaModal?.sectionKey === sectionKey) {
    state.componentMetaModal = null;
  }
  if (state.reusableSaveModal?.sectionKey === sectionKey) {
    state.reusableSaveModal = null;
  }
}

export function resetTransientUiState(): void {
  state.activeEditorBlock = null;
  state.activeEditorSectionTitleKey = null;
  state.clearSectionTitleOnFocusKey = null;
  state.modalSectionKey = null;
  state.reusableSaveModal = null;
  state.componentMetaModal = null;
  state.tempHighlights = new Set<string>();
  state.addComponentBySection = {};
  state.metaPanelOpen = false;
  state.selectedReusableComponentName = null;
  state.templateValues = {};
  state.gridAddComponentByBlock = {};
  state.lastHistoryGroup = null;
  state.lastHistoryAt = 0;
  state.pendingEditorCenterSectionKey = null;
  state.paneScroll = {
    editorTop: 0,
    readerTop: 0,
    windowTop: 0,
  };
}

export function resetToBlankDocument(): void {
  state.document = createBlankDocument();
  state.filename = 'untitled.hvy';
  state.history = [];
  state.future = [];
  resetTransientUiState();
  getRenderApp()();
}
