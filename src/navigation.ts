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

export function setEditorSidebarOpen(app: HTMLElement, open: boolean): void {
  state.editorSidebarOpen = open;
  const shell = app.querySelector<HTMLElement>('.editor-shell');
  if (!shell) {
    return;
  }
  shell.classList.toggle('is-sidebar-open', open);
  shell.classList.toggle('is-sidebar-closed', !open);
  const tab = shell.querySelector<HTMLButtonElement>('.editor-sidebar-tab');
  if (tab) {
    tab.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
}

export function navigateToSection(sectionId: string, app: HTMLElement): void {
  if (!sectionId) {
    return;
  }
  closeModal();

  if (sectionId === 'readerNav' || sectionId === 'navigation') {
    setSidebarOpen(app, true);
    return;
  }

  const sectionRes = expandSectionPathById(state.document.sections, sectionId);
  const blockRes = expandBlockPathBySchemaId(state.document.sections, sectionId);

  const loc = sectionRes.found ? sectionRes.location : (blockRes.found ? blockRes.location : null);
  const expandChanged = sectionRes.changed || blockRes.changed;

  if (loc === 'sidebar' && !state.viewerSidebarOpen) {
    setSidebarOpen(app, true);
  } else if (loc === 'main' && state.viewerSidebarOpen) {
    setSidebarOpen(app, false);
  }

  // Only re-render when expand state actually changed to avoid rebuilding
  // the sidebar DOM mid-animation.
  if (expandChanged) {
    getRefreshReaderPanels()();
  }

  // Apply and remove the highlight directly on the DOM element — no re-render needed.
  window.requestAnimationFrame(() => {
    const target = app.querySelector<HTMLElement>(`#${CSS.escape(sectionId)}`);
    if (!target) {
      console.error('[hvy:navigation] Unable to find reader target for internal link.', {
        targetId: sectionId,
        sectionFound: sectionRes.found,
        blockFound: blockRes.found,
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

interface ExpandResult {
  found: boolean;
  changed: boolean;
  location: VisualSection['location'] | null;
}

export function expandSectionPathById(sections: VisualSection[], sectionId: string): ExpandResult {
  for (const section of sections) {
    if (getSectionId(section) === sectionId) {
      const changed = !section.expanded;
      section.expanded = true;
      return { found: true, changed, location: section.location };
    }
    const childRes = expandSectionPathById(section.children, sectionId);
    if (childRes.found) {
      const changed = childRes.changed || !section.expanded;
      section.expanded = true;
      return { found: true, changed, location: childRes.location };
    }
  }
  return { found: false, changed: false, location: null };
}

export function expandBlockPathBySchemaId(sections: VisualSection[], schemaId: string): ExpandResult {
  for (const section of sections) {
    const blockRes = expandBlockPathInList(section.blocks, schemaId);
    if (blockRes.found) {
      const changed = blockRes.changed || !section.expanded;
      section.expanded = true;
      return { found: true, changed, location: section.location };
    }
    const childRes = expandBlockPathBySchemaId(section.children, schemaId);
    if (childRes.found) {
      const changed = childRes.changed || !section.expanded;
      section.expanded = true;
      return { found: true, changed, location: childRes.location };
    }
  }
  return { found: false, changed: false, location: null };
}

function expandBlockPathInList(blocks: VisualBlock[], schemaId: string): { found: boolean, changed: boolean } {
  for (const block of blocks) {
    const isTarget = block.schema.id === schemaId;

    if (isTarget && resolveBaseComponent(block.schema.component) === 'expandable') {
      const changed = !block.schema.expandableExpanded;
      block.schema.expandableExpanded = true;
      return { found: true, changed };
    }

    let nestedRes = expandBlockPathInList(block.schema.containerBlocks ?? [], schemaId);
    if (!nestedRes.found) nestedRes = expandBlockPathInList(block.schema.componentListBlocks ?? [], schemaId);
    if (!nestedRes.found && block.schema.gridItems) {
      nestedRes = expandBlockPathInList(block.schema.gridItems.map((item) => item.block), schemaId);
    }
    if (!nestedRes.found) nestedRes = expandBlockPathInList(block.schema.expandableStubBlocks?.children ?? [], schemaId);
    if (!nestedRes.found) nestedRes = expandBlockPathInList(block.schema.expandableContentBlocks?.children ?? [], schemaId);
    if (!nestedRes.found && block.schema.tableRows) {
      for (const row of block.schema.tableRows) {
        nestedRes = expandBlockPathInList(row.detailsBlocks ?? [], schemaId);
        if (nestedRes.found) break;
      }
    }

    if (nestedRes.found) {
      let changed = nestedRes.changed;
      if (resolveBaseComponent(block.schema.component) === 'expandable') {
        if (!block.schema.expandableExpanded) {
          block.schema.expandableExpanded = true;
          changed = true;
        }
      }
      return { found: true, changed };
    }

    if (isTarget) {
      return { found: true, changed: false };
    }
  }
  return { found: false, changed: false };
}

export function closeModal(): void {
  state.modalSectionKey = null;
  state.componentMetaModal = null;
  state.reusableSaveModal = null;
  state.themeModalOpen = false;
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
  state.themeModalOpen = false;
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
    editorSidebarTop: 0,
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
