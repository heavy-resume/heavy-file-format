import type { VisualBlock, VisualSection } from './editor/types';
import { state } from './state';
import { getSectionId } from './section-ops';
import { resolveBaseComponent } from './component-defs';
import { createBlankDocument } from './document-factory';
import { getRenderApp } from './state';
import { clearChatConversation } from './chat/chat';
import { serializeDocument } from './serialization';
import { saveSessionState } from './state-persistence';
import { createDefaultSearchState } from './search/state';
import { restoreVirtualizedSection } from './section-virtualizer';
import type { VisualDocument } from './types';

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
  window.dispatchEvent(new CustomEvent('hvy:viewer-sidebar-open-changed'));
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

export function closeActiveSidebar(app: HTMLElement): boolean {
  if (state.currentView === 'editor') {
    if (!state.editorSidebarOpen) {
      return false;
    }
    setEditorSidebarOpen(app, false);
    return true;
  }
  if (!state.viewerSidebarOpen) {
    return false;
  }
  setSidebarOpen(app, false);
  return true;
}

export function navigateToSection(sectionId: string, app: HTMLElement): void {
  if (!sectionId) {
    return;
  }
  navigateToReaderTarget({ targetId: sectionId }, app);
}

export function navigateToReaderTarget(
  target: { targetId?: string; sectionKey?: string; blockId?: string; matchText?: string },
  app: HTMLElement
): void {
  const targetId = target.targetId?.trim() ?? '';
  if (!targetId && !target.sectionKey && !target.blockId) {
    return;
  }
  closeModal();

  let requiresFullRender = false;

  if (state.currentView === 'editor') {
    state.currentView = 'viewer';
    requiresFullRender = true;
  }

  if (targetId === 'readerNav' || targetId === 'navigation') {
    if (requiresFullRender) {
      state.viewerSidebarOpen = true;
      getRenderApp()();
    } else {
      setSidebarOpen(app, true);
    }
    return;
  }

  const sectionByIdRes = targetId ? expandSectionPathById(state.document.sections, targetId) : emptyExpandResult();
  const blockBySchemaRes = targetId ? expandBlockPathBySchemaId(state.document.sections, targetId) : emptyExpandResult();
  const sectionByKeyRes = target.sectionKey ? expandSectionPathByKey(state.document.sections, target.sectionKey) : emptyExpandResult();
  const blockByBlockIdRes = target.blockId
    ? expandBlockPathByBlockId(state.document.sections, target.blockId, target.sectionKey)
    : emptyExpandResult();

  const loc =
    sectionByIdRes.found ? sectionByIdRes.location
    : blockBySchemaRes.found ? blockBySchemaRes.location
    : blockByBlockIdRes.found ? blockByBlockIdRes.location
    : sectionByKeyRes.found ? sectionByKeyRes.location
    : null;
  const expandChanged = sectionByIdRes.changed || blockBySchemaRes.changed || sectionByKeyRes.changed || blockByBlockIdRes.changed;

  if (loc === 'sidebar' && !state.viewerSidebarOpen) {
    if (requiresFullRender) {
      state.viewerSidebarOpen = true;
    } else {
      setSidebarOpen(app, true);
    }
  } else if (loc === 'main' && state.viewerSidebarOpen) {
    if (requiresFullRender) {
      state.viewerSidebarOpen = false;
    } else {
      setSidebarOpen(app, false);
    }
  }

  // Only re-render when expand state actually changed to avoid rebuilding
  // the sidebar DOM mid-animation. For link navigation, prefer a full render so
  // the scroll target is resolved against the latest expanded layout.
  if (expandChanged || requiresFullRender) {
    getRenderApp()();
  }

  requestTargetHighlight(app, target, {
    sectionFound: sectionByIdRes.found || sectionByKeyRes.found,
    blockFound: blockBySchemaRes.found || blockByBlockIdRes.found,
    sectionKey:
      sectionByIdRes.sectionKey
      ?? blockBySchemaRes.sectionKey
      ?? blockByBlockIdRes.sectionKey
      ?? sectionByKeyRes.sectionKey
      ?? target.sectionKey,
  });
}

export function getReaderTargetIds(app: HTMLElement): string[] {
  return [...app.querySelectorAll<HTMLElement>('#readerDocument [id], #readerSidebarSections [id]')].map((element) => element.id);
}

function requestTargetHighlight(
  app: HTMLElement,
  target: { targetId?: string; sectionKey?: string; blockId?: string; matchText?: string },
  context: { sectionFound: boolean; blockFound: boolean; sectionKey?: string },
  attempt = 0
): void {
  const run = () => {
    if (context.sectionKey) {
      restoreVirtualizedSection(app, context.sectionKey);
    }
    const element = findReaderTargetElement(app, target);
    if (!element) {
      if (attempt < 3) {
        requestTargetHighlight(app, target, context, attempt + 1);
        return;
      }
      console.error('[hvy:navigation] Unable to find reader target for internal link.', {
        targetId: target.targetId ?? '',
        sectionKey: target.sectionKey ?? '',
        blockId: target.blockId ?? '',
        sectionFound: context.sectionFound,
        blockFound: context.blockFound,
        availableReaderIds: getReaderTargetIds(app),
      });
      return;
    }

    alignSidebarToResolvedTarget(app, element);
    const wantsSearchMarker = state.search.submittedQuery.trim().length > 0 && Boolean(target.matchText?.trim());
    const marker = findSearchMarkerInTarget(element, target.matchText);
    if (wantsSearchMarker && !marker && attempt < 8) {
      requestTargetHighlight(app, target, context, attempt + 1);
      return;
    }

    const scrollTarget = marker ?? element;
    element.classList.add('is-temp-highlighted');
    revealReaderAncestors(scrollTarget);
    scrollReaderTargetIntoView(scrollTarget);
    window.setTimeout(() => {
      element.classList.remove('is-temp-highlighted');
    }, 1400);
  };
  if (attempt === 0) {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(run);
    });
    return;
  }
  window.setTimeout(run, 60);
}

function alignSidebarToResolvedTarget(app: HTMLElement, element: HTMLElement): void {
  if (state.currentView !== 'viewer') {
    return;
  }
  if (element.closest('#readerSidebarSections')) {
    if (!state.viewerSidebarOpen) {
      setSidebarOpen(app, true);
    }
    return;
  }
  if (element.closest('#readerDocument') && state.viewerSidebarOpen) {
    setSidebarOpen(app, false);
  }
}

function scrollReaderTargetIntoView(target: HTMLElement): void {
  const scroll = () => {
    const container = findScrollableReaderAncestor(target);
    if (container) {
      const targetRect = target.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const containerCenter = containerRect.top + containerRect.height / 2;
      container.scrollTo({
        top: Math.max(0, container.scrollTop + targetRect.top - containerCenter),
        behavior: 'smooth',
      });
      return;
    }
    const targetRect = target.getBoundingClientRect();
    window.scrollTo({
      top: Math.max(0, window.scrollY + targetRect.top - window.innerHeight / 2),
      behavior: 'smooth',
    });
  };
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(scroll);
  });
}

function revealReaderAncestors(target: HTMLElement): void {
  let ancestor = target.parentElement;
  while (ancestor) {
    if (!ancestor.classList.contains('is-collapsed-preview')) {
      ancestor = ancestor.parentElement;
      continue;
    }
    const containerKey = ancestor.dataset.containerKey;
    if (containerKey) {
      state.readerContainerState[containerKey] = true;
    }
    const viewCollapseKey = ancestor.dataset.readerViewCollapseKey;
    if (viewCollapseKey) {
      state.readerContainerState[viewCollapseKey] = true;
    }
    ancestor.classList.remove('is-collapsed-preview');
    ancestor.classList.add('is-expanded');
    ancestor.setAttribute('aria-expanded', 'true');
    ancestor.querySelector<HTMLElement>('.reader-section-preview')?.classList.remove('reader-section-preview');
    ancestor.querySelectorAll<HTMLElement>('[aria-expanded="false"]').forEach((child) => {
      if (child.dataset.containerKey === containerKey || child.dataset.readerViewCollapseKey === viewCollapseKey) {
        child.setAttribute('aria-expanded', 'true');
      }
    });
    ancestor = ancestor.parentElement;
  }
}

function findScrollableReaderAncestor(target: HTMLElement): HTMLElement | null {
  let element = target.parentElement;
  while (element) {
    const style = window.getComputedStyle(element);
    const canScroll = /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight;
    if (canScroll) {
      return element;
    }
    element = element.parentElement;
  }
  return null;
}

function findReaderTargetElement(app: HTMLElement, target: { targetId?: string; sectionKey?: string; blockId?: string }): HTMLElement | null {
  const targetId = target.targetId?.trim() ?? '';
  const surfaces = getReaderSurfaces(app);
  if (target.sectionKey && target.blockId) {
    const blockSelector = `[data-section-key="${CSS.escape(target.sectionKey)}"][data-block-id="${CSS.escape(target.blockId)}"]`;
    const byBlock = surfaces.map((surface) => surface.querySelector<HTMLElement>(blockSelector)).find(Boolean) ?? null;
    if (byBlock) {
      return byBlock;
    }
  }
  if (targetId) {
    const idSelector = `#${CSS.escape(targetId)}`;
    const byId = surfaces.map((surface) => surface.querySelector<HTMLElement>(idSelector)).find(Boolean) ?? null;
    if (byId) {
      return byId;
    }
  }
  if (target.sectionKey) {
    const selector = `[data-section-key="${CSS.escape(target.sectionKey)}"]`;
    if (selector) {
      return surfaces.map((surface) => surface.querySelector<HTMLElement>(selector)).find(Boolean) ?? app.querySelector<HTMLElement>(selector);
    }
  }
  return null;
}

function getReaderSurfaces(app: HTMLElement): HTMLElement[] {
  return [
    app.querySelector<HTMLElement>('#readerDocument'),
    app.querySelector<HTMLElement>('#readerSidebarSections'),
    app.querySelector<HTMLElement>('#aiReaderDocument'),
    app.querySelector<HTMLElement>('#aiSidebarSections'),
  ].filter((surface): surface is HTMLElement => Boolean(surface));
}

function findSearchMarkerInTarget(element: HTMLElement, matchText?: string): HTMLElement | null {
  const markers = [...element.querySelectorAll<HTMLElement>('.search-match-marker')];
  if (markers.length === 0) {
    return null;
  }
  const normalized = matchText?.trim().toLocaleLowerCase();
  if (!normalized) {
    return markers[0] ?? null;
  }
  return markers.find((marker) => marker.textContent?.trim().toLocaleLowerCase() === normalized) ?? markers[0] ?? null;
}

interface ExpandResult {
  found: boolean;
  changed: boolean;
  location: VisualSection['location'] | null;
  sectionKey: string | null;
}

export function expandSectionPathById(sections: VisualSection[], sectionId: string): ExpandResult {
  for (const section of sections) {
    if (getSectionId(section) === sectionId) {
      const changed = !section.expanded;
      section.expanded = true;
      return { found: true, changed, location: section.location, sectionKey: section.key };
    }
    const childRes = expandSectionPathById(section.children, sectionId);
    if (childRes.found) {
      const changed = childRes.changed || !section.expanded;
      section.expanded = true;
      return { found: true, changed, location: childRes.location, sectionKey: childRes.sectionKey };
    }
  }
  return emptyExpandResult();
}

export function expandSectionPathByKey(sections: VisualSection[], sectionKey: string): ExpandResult {
  for (const section of sections) {
    if (section.key === sectionKey) {
      const changed = !section.expanded;
      section.expanded = true;
      return { found: true, changed, location: section.location, sectionKey: section.key };
    }
    const childRes = expandSectionPathByKey(section.children, sectionKey);
    if (childRes.found) {
      const changed = childRes.changed || !section.expanded;
      section.expanded = true;
      return { found: true, changed, location: childRes.location, sectionKey: childRes.sectionKey };
    }
  }
  return emptyExpandResult();
}

export function expandBlockPathBySchemaId(sections: VisualSection[], schemaId: string): ExpandResult {
  for (const section of sections) {
    const blockRes = expandBlockPathInList(section.blocks, schemaId, section.key);
    if (blockRes.found) {
      const changed = blockRes.changed || !section.expanded;
      section.expanded = true;
      return { found: true, changed, location: section.location, sectionKey: section.key };
    }
    const childRes = expandBlockPathBySchemaId(section.children, schemaId);
    if (childRes.found) {
      const changed = childRes.changed || !section.expanded;
      section.expanded = true;
      return { found: true, changed, location: childRes.location, sectionKey: childRes.sectionKey };
    }
  }
  return emptyExpandResult();
}

export function expandBlockPathByBlockId(sections: VisualSection[], blockId: string, sectionKey?: string): ExpandResult {
  for (const section of sections) {
    if (sectionKey && section.key !== sectionKey && !sectionContainsBlock(section, blockId)) {
      const childRes = expandBlockPathByBlockId(section.children, blockId, sectionKey);
      if (childRes.found) {
        const changed = childRes.changed || !section.expanded;
        section.expanded = true;
        return { found: true, changed, location: childRes.location, sectionKey: childRes.sectionKey };
      }
      continue;
    }
    const blockRes = expandBlockPathInList(section.blocks, blockId, section.key, 'block-id');
    if (blockRes.found) {
      const changed = blockRes.changed || !section.expanded;
      section.expanded = true;
      return { found: true, changed, location: section.location, sectionKey: section.key };
    }
    const childRes = expandBlockPathByBlockId(section.children, blockId, sectionKey);
    if (childRes.found) {
      const changed = childRes.changed || !section.expanded;
      section.expanded = true;
      return { found: true, changed, location: childRes.location, sectionKey: childRes.sectionKey };
    }
  }
  return emptyExpandResult();
}

function expandBlockPathInList(blocks: VisualBlock[], id: string, sectionKey: string, mode: 'schema-id' | 'block-id' = 'schema-id'): { found: boolean, changed: boolean } {
  for (const block of blocks) {
    const isTarget = mode === 'schema-id' ? block.schema.id === id : block.id === id;

    if (isTarget && resolveBaseComponent(block.schema.component) === 'expandable') {
      const key = `${sectionKey}:${block.id}`;
      const changed = state.readerExpandableState[key] !== true;
      state.readerExpandableState[key] = true;
      return { found: true, changed };
    }
    if (isTarget && resolveBaseComponent(block.schema.component) === 'container') {
      const key = `${sectionKey}:${block.id}`;
      const changed = state.readerContainerState[key] !== true;
      state.readerContainerState[key] = true;
      return { found: true, changed };
    }

    let nestedRes = expandBlockPathInList(block.schema.containerBlocks ?? [], id, sectionKey, mode);
    if (!nestedRes.found) nestedRes = expandBlockPathInList(block.schema.componentListBlocks ?? [], id, sectionKey, mode);
    if (!nestedRes.found && block.schema.gridItems) {
      nestedRes = expandBlockPathInList(block.schema.gridItems.map((item) => item.block), id, sectionKey, mode);
    }
    if (!nestedRes.found) nestedRes = expandBlockPathInList(block.schema.expandableStubBlocks?.children ?? [], id, sectionKey, mode);
    if (!nestedRes.found) nestedRes = expandBlockPathInList(block.schema.expandableContentBlocks?.children ?? [], id, sectionKey, mode);
    if (nestedRes.found) {
      let changed = nestedRes.changed;
      if (resolveBaseComponent(block.schema.component) === 'expandable') {
        const key = `${sectionKey}:${block.id}`;
        if (state.readerExpandableState[key] !== true) {
          state.readerExpandableState[key] = true;
          changed = true;
        }
      }
      if (resolveBaseComponent(block.schema.component) === 'container') {
        const key = `${sectionKey}:${block.id}`;
        if (state.readerContainerState[key] !== true) {
          state.readerContainerState[key] = true;
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

function sectionContainsBlock(section: VisualSection, blockId: string): boolean {
  return section.blocks.some((block) => findBlockInSectionById(block, blockId)) || section.children.some((child) => sectionContainsBlock(child, blockId));
}

function emptyExpandResult(): ExpandResult {
  return { found: false, changed: false, location: null, sectionKey: null };
}

export function closeModal(): void {
  const sqliteRowComponentModal = state.sqliteRowComponentModal;
  if (
    sqliteRowComponentModal
    && state.activeEditorBlock?.sectionKey === sqliteRowComponentModal.sectionKey
    && sqliteRowComponentModal.blocks.some((block) => findBlockInSectionById(block, state.activeEditorBlock?.blockId ?? ''))
  ) {
    state.activeEditorBlock = sqliteRowComponentModal.previousActiveEditorBlock;
  }
  state.modalSectionKey = null;
  state.newDocumentModalOpen = false;
  state.componentMetaModal = null;
  state.sqliteRowComponentModal = null;
  state.dbTableQueryModal = null;
  state.pdfExportPlanModal = null;
  state.reusableSaveModal = null;
  state.reusableTemplateModal = null;
  state.sectionTemplateFlavorModal = null;
  state.themeModalOpen = false;
}

export function closeModalIfTarget(sectionKey: string): void {
  if (state.modalSectionKey === sectionKey) {
    closeModal();
  }
  if (state.componentMetaModal?.sectionKey === sectionKey) {
    state.componentMetaModal = null;
  }
  if (state.sqliteRowComponentModal?.sectionKey === sectionKey) {
    closeModal();
  }
  if (state.dbTableQueryModal?.sectionKey === sectionKey) {
    closeModal();
  }
  if (state.reusableSaveModal?.sectionKey === sectionKey) {
    state.reusableSaveModal = null;
  }
  if (state.reusableTemplateModal?.target.sectionKey === sectionKey) {
    state.reusableTemplateModal = null;
  }
}

function findBlockInSectionById(block: import('./editor/types').VisualBlock, blockId: string): boolean {
  if (block.id === blockId) {
    return true;
  }
  return (
    (block.schema.containerBlocks ?? []).some((child) => findBlockInSectionById(child, blockId))
    || (block.schema.componentListBlocks ?? []).some((child) => findBlockInSectionById(child, blockId))
    || (block.schema.gridItems ?? []).some((item) => findBlockInSectionById(item.block, blockId))
    || (block.schema.expandableStubBlocks?.children ?? []).some((child) => findBlockInSectionById(child, blockId))
    || (block.schema.expandableContentBlocks?.children ?? []).some((child) => findBlockInSectionById(child, blockId))
  );
}

export function resetTransientUiState(): void {
  state.activeEditorBlock = null;
  state.aiEditorHostBlock = null;
  state.aiEditorHostSectionKey = null;
  state.componentPlacement = null;
  state.activeEditorSectionTitleKey = null;
  state.clearSectionTitleOnFocusKey = null;
  state.modalSectionKey = null;
  state.newDocumentModalOpen = false;
  state.reusableSaveModal = null;
  state.reusableTemplateModal = null;
  state.sectionTemplateFlavorModal = null;
  state.componentMetaModal = null;
  state.sqliteRowComponentModal = null;
  state.dbTableQueryModal = null;
  state.themeModalOpen = false;
  state.tempHighlights = new Set<string>();
  state.addComponentBySection = {};
  state.metaPanelOpen = false;
  state.selectedReusableComponentName = null;
  state.templateValues = {};
  state.gridAddComponentByBlock = {};
  state.readerExpandableState = {};
  state.readerContainerState = {};
  state.readerView = {};
  state.readerViewActivatedTargets = new Set<string>();
  state.search.abortController?.abort();
  state.search = createDefaultSearchState();
  state.componentListReaderViews = {};
  state.viewerSidebarHelpDismissed = false;
  state.editorSidebarHelpDismissed = false;
  state.lastHistoryGroup = null;
  state.lastHistoryAt = 0;
  state.pendingEditorCenterSectionKey = null;
  state.aiEdit = {
    sectionKey: null,
    blockId: null,
    draft: '',
    isSending: false,
    error: null,
    popupX: 0,
    popupY: 0,
    requestNonce: state.aiEdit.requestNonce + 1,
  };
  state.paneScroll = {
    editorTop: 0,
    editorSidebarTop: 0,
    viewerSidebarTop: 0,
    readerTop: 0,
    windowLeft: 0,
    windowTop: 0,
  };
}

export function resetToBlankDocument(extension: VisualDocument['extension'] = '.hvy'): void {
  const documentExtension = extension === '.phvy' || extension === '.thvy' ? extension : '.hvy';
  state.document = createBlankDocument(documentExtension);
  state.rawEditorText = serializeDocument(state.document);
  state.rawEditorError = null;
  state.rawEditorDiagnostics = [];
  state.filename = `untitled${documentExtension}`;
  state.selectedExample = 'blank';
  state.history = [];
  state.future = [];
  clearChatConversation(state.chat);
  resetTransientUiState();
  saveSessionState(state);
  getRenderApp()();
}
