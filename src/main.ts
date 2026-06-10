import './default-theme.css';
import './host-overrides.css';
import './style.css';
import './state-tracker.css';
import 'highlight.js/styles/github.css';
import bundledExampleHvyUrl from '../examples/example.hvy?url';
import bundledResumeViews from '../examples/resume-views.json';

import { createEditorRenderer, type EditorRenderer } from './editor/render';
import { createReaderRenderer, type ReaderRenderer } from './reader/render';
import { getTemplateFields, renderTemplatePanel } from './editor/template';
import { renderCliView } from './cli-ui/render';

import { state, initState, initCallbacks, incrementRenderCount, incrementRefreshReaderCount } from './state';
import type { AppState, ReaderViewFilter } from './types';
import { escapeAttr, escapeHtml } from './utils';
import { applyTheme, getThemeConfig, initColorModeSync, setThemeRoot } from './theme';
import { flattenSections, findSectionByKey, findDuplicateSectionIds, getSectionId, formatSectionTitle, isDefaultUntitledSectionTitle, buildSectionRenderSequence } from './section-ops';
import { renderComponentOptions, renderReusableSectionOptions, getComponentDefs, getSectionDefs, isBuiltinComponent } from './component-defs';
import { renderOption } from './utils';
import { resolveBaseComponent } from './component-defs';
import { ensureContainerBlocks, ensureComponentListBlocks, ensureExpandableBlocks, ensureGridItems } from './document-factory';
import { isActiveEditorSectionTitle, isActiveEditorBlock, getComponentRenderHelpers, findBlockByIds } from './block-ops';
import { commitHistorySnapshot } from './history';
import { centerPendingEditorSection, focusPendingSectionTitleEditor, scrollPendingEditorActivation, scrollPendingEditorDeactivation } from './scroll';
import { bindUi } from './bind-ui';
import { deserializeDocumentBytes, serializeDocument } from './serialization';
import { createDefaultChatState, renderChatPanel } from './chat/chat';
import { renderAiEditPopover, renderAiModeHint } from './ai-mode-ui';
import { loadSessionState, saveSessionState } from './state-persistence';
import { setHostPlugins } from './plugins/registry';
import { reconcilePluginMounts, capturePluginFocus } from './plugins/mount';
import { resetPluginDocumentHookState, runPluginDocumentHooks } from './plugins/hooks';
import { builtInPlugins } from 'virtual:hvy-built-in-plugins';
import { resumeOutputGeneratorsPlugin } from './plugins/resume-output-generators';
import { isPdfAllowedComponent, isPdfDocument } from './pdf-document-capabilities';
import { renderPdfDocumentViewerThemeStyle } from './pdf-document-theme';
import { runButtonVisibilityScripts } from './editor/components/button/button-actions';
import { centerSearchResultLenses, renderCollapsedSearchBar, renderSearchLauncher, renderSearchModal } from './search/render';
import { createDefaultSearchState } from './search/state';
import { applySearchFilter, submitSearch } from './search/actions';
import { chatSemanticFilterProvider } from './search/semantic-provider';
import { setReferenceAppConfig } from './reference-config';
import { loadPaletteOverrideId } from './palettes/palette-preferences';
import { captureRenderScroll, restoreRenderScroll } from './render-scroll';
import { refreshReaderSurfaces } from './reader/refresh-surfaces';
import { initializeCarouselReaders } from './editor/components/carousel/carousel';
import { virtualizeRenderedSections } from './section-virtualizer';
import { renderNewDocumentModal } from './new-document-modal';

const appRoot = document.querySelector<HTMLDivElement>('#app');
if (!appRoot) {
  throw new Error('App container not found.');
}
const app = appRoot;
app.classList.add('hvy-document');
setThemeRoot(app);
setReferenceAppConfig({
  semanticFilterProvider: window.HVY_REFERENCE_CONFIG?.semanticFilterProvider ?? chatSemanticFilterProvider,
});
const READER_HIGHLIGHT_GLOW_MS = 6000;
const DOCUMENT_MENU_ITEMS: Array<{ id: string; label: string; selectedExample: AppState['selectedExample'] }> = [
  { id: 'guideBtn', label: 'Guide', selectedExample: 'guide' },
  { id: 'defaultExampleBtn', label: 'Default Example', selectedExample: 'default' },
  { id: 'crmExampleBtn', label: 'CRM Example', selectedExample: 'crm' },
  { id: 'studyToolsExampleBtn', label: 'Study Tools Example', selectedExample: 'study-tools' },
  { id: 'resumeTemplateBtn', label: 'Resume Template', selectedExample: 'resume-template' },
  { id: 'resumeExampleBtn', label: 'Resume Example', selectedExample: 'resume-example' },
  { id: 'importReferenceBtn', label: 'Import Reference', selectedExample: 'import-reference' },
  { id: 'scriptingHelpBtn', label: 'Scripting Help', selectedExample: 'scripting-help' },
];
let readerHighlightGlowObserver: IntersectionObserver | null = null;
let readerHighlightGlowSignature = '';
let readerHighlightGlowSeenTargets = new Set<string>();
window.addEventListener('hvy:viewer-sidebar-open-changed', () => {
  window.requestAnimationFrame(() => scheduleReaderHighlightGlow(app));
});

app.innerHTML = '<main class="layout reference-layout hvy-embed-layout"><section class="pane full-pane"><p>Loading editor...</p></section></main>';

async function createDefaultDocument() {
  const response = await fetch(bundledExampleHvyUrl);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return deserializeDocumentBytes(bytes, '.hvy');
}

function createInitialState(document: ReturnType<typeof deserializeDocumentBytes>): AppState {
  return {
    document,
    filename: 'example.hvy',
    selectedExample: 'default',
    currentView: 'editor',
    editorMode: 'basic',
    responsivePreview: 'full',
    chat: createDefaultChatState(),
    aiModeTipDismissed: false,
    search: createDefaultSearchState(),
    metaFilter: {
      query: '',
      mode: 'semantic',
      isRunning: false,
      status: null,
      error: null,
      resultCount: null,
    },
    contextMenu: null,
    aiEdit: {
      sectionKey: null,
      blockId: null,
      draft: '',
      isSending: false,
      error: null,
      popupX: 0,
      popupY: 0,
      requestNonce: 0,
    },
    paneScroll: {
      fullPaneTop: 0,
      editorTop: 0,
      editorSidebarTop: 0,
      viewerSidebarTop: 0,
      readerTop: 0,
      windowLeft: 0,
      windowTop: 0,
    },
    showAdvancedEditor: false,
    rawEditorText: serializeDocument(document),
    rawEditorError: null,
    rawEditorDiagnostics: [],
    cliDraft: '',
    cliSession: { cwd: '/' },
    cliHistory: [],
    activeEditorBlock: null,
    activeTextEditorMode: null,
    aiEditorHostBlock: null,
    aiEditorHostSectionKey: null,
    activeEditorBlockPath: [],
    activeEditorBlockSnapshot: null,
    activeEditorBlockSnapshots: [],
    activeEditorNewBlockIds: new Set<string>(),
    activeEditorBlockReturnScroll: null,
    pendingPaneScrollRestore: null,
    componentPlacement: null,
    pendingEditorDeactivation: null,
    pendingEditorActivation: null,
    activeEditorSectionTitleKey: null,
    clearSectionTitleOnFocusKey: null,
    modalSectionKey: null,
    captionTextModal: null,
    newDocumentModalOpen: false,
    reusableSaveModal: null,
    reusableTemplateModal: null,
    reusableDefinitionEditModal: null,
    sectionTemplateFlavorModal: null,
    tempHighlights: new Set<string>(),
    addComponentBySection: {},
    metaPanelOpen: false,
    openTemplateDefinitionKeys: [],
    openTextLineStyleName: null,
    paragraphStyleRecentNames: [],
    descriptionPopulate: { isRunning: false, status: null, completed: 0, total: 0, current: '', skippedLeaves: 0, lastGenerated: '' },
    selectedReusableComponentName: null,
    templateValues: {},
    history: [],
    future: [],
    isRestoring: false,
    componentMetaModal: null,
    sqliteRowComponentModal: null,
    dbTableQueryModal: null,
    pdfExportPlanModal: null,
    pdfTemplateImportModal: null,
    themeModalOpen: false,
    themeModalMode: 'full',
    paletteOverrideId: loadPaletteOverrideId(),
    gridAddComponentByBlock: {},
    expandableEditorPanels: {},
    readerExpandableState: {},
    readerContainerState: {},
    readerView: {},
    readerViewActivatedTargets: new Set<string>(),
    componentListReaderViews: {},
    viewerSidebarOpen: false,
    editorSidebarOpen: false,
    viewerSidebarHelpDismissed: false,
    editorSidebarHelpDismissed: false,
    lastHistoryGroup: null,
    lastHistoryAt: 0,
    pendingEditorCenterSectionKey: null,
    imageAttachmentReductionStatus: null,
    transientNotice: null,
  };
}

function applySessionState(initial: AppState, savedSession: ReturnType<typeof loadSessionState>): AppState {
  if (!savedSession) {
    return initial;
  }
  const document = savedSession.document ?? initial.document;
  return {
    ...initial,
    document,
    filename: savedSession.filename,
    selectedExample: savedSession.selectedExample,
    currentView: savedSession.currentView,
    editorMode: savedSession.editorMode,
    showAdvancedEditor: savedSession.showAdvancedEditor,
    rawEditorText: savedSession.rawEditorText || serializeDocument(document),
    templateValues: savedSession.templateValues,
    chat: {
      ...initial.chat,
      settings: savedSession.chat.settings,
      draft: savedSession.chat.draft,
      messages: savedSession.chat.messages,
      panelOpen: savedSession.chat.panelOpen,
    },
    search: savedSession.search.filterEnabled
      ? {
          ...savedSession.search,
          filterEnabled: false,
          results: [],
          navigationResultIds: [],
          activeResultId: null,
          isLoading: Boolean(savedSession.search.submittedQuery.trim()),
        }
      : savedSession.search,
    cliDraft: savedSession.cli.draft,
    cliSession: savedSession.cli.session,
    cliHistory: savedSession.cli.history,
  };
}

function bindSessionPersistence(): void {
  window.addEventListener('beforeunload', () => saveSessionState(state));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      saveSessionState(state);
    }
  });
  window.addEventListener('pagehide', () => saveSessionState(state));
}

function renderContextMenu(): string {
  const menu = state.contextMenu;
  if (!menu) {
    return '';
  }
  const popupStyle = `left: ${menu.x}px; top: ${menu.y}px;`;
  const backdropStyle = menu.targetRect
    ? [
        `--hvy-context-target-left: ${menu.targetRect.left}px`,
        `--hvy-context-target-top: ${menu.targetRect.top}px`,
        `--hvy-context-target-width: ${menu.targetRect.width}px`,
        `--hvy-context-target-height: ${menu.targetRect.height}px`,
      ].join('; ')
    : '';
  const target = menu.blockId
    ? document.querySelector<HTMLElement>(`.viewer-shell .reader-block[data-section-key="${cssEscape(menu.sectionKey)}"][data-block-id="${cssEscape(menu.blockId)}"]`)
    : null;
  const clone = menu.kind === 'ai' && target && menu.targetRect ? renderContextMenuTargetClone(target, menu.targetRect) : '';
  const backdrop = menu.targetRect
    ? `<div class="hvy-context-popover-backdrop" style="${escapeAttr(backdropStyle)}" aria-hidden="true">
        <div class="hvy-context-popover-backdrop-top"></div>
        <div class="hvy-context-popover-backdrop-left"></div>
        <div class="hvy-context-popover-backdrop-right"></div>
        <div class="hvy-context-popover-backdrop-bottom"></div>
        <div class="hvy-context-popover-backdrop-target"></div>
      </div>`
    : '<div class="hvy-context-popover-backdrop" aria-hidden="true"></div>';
  const filtering = state.search.filterEnabled && state.search.submittedQuery.trim().length > 0;
  if (menu.kind === 'filter') {
    return `
      ${backdrop}
      ${clone}
      <section class="hvy-context-popover" style="${escapeAttr(popupStyle)}" aria-label="Filter options">
        <button type="button" data-action="clear-target-filtering">Clear filtering</button>
      </section>
    `;
  }
  return `
    ${backdrop}
    ${clone}
    <section class="hvy-context-popover" style="${escapeAttr(popupStyle)}" aria-label="Component options">
      <button type="button" data-action="edit-context-component">Edit component</button>
      <button type="button" data-action="request-context-component-changes">Request changes</button>
      ${filtering ? '<button type="button" data-action="clear-target-filtering">Clear filtering</button>' : ''}
    </section>
  `;
}

function renderContextMenuTargetClone(target: HTMLElement, rect: NonNullable<NonNullable<typeof state.contextMenu>['targetRect']>): string {
  const clone = target.cloneNode(true) as HTMLElement;
  clone.classList.remove('is-context-menu-target');
  clone.removeAttribute('id');
  clone.querySelectorAll('[id]').forEach((element) => {
    element.removeAttribute('id');
  });
  clone.querySelectorAll('input, textarea, select, button, a, [tabindex]').forEach((element) => {
    element.setAttribute('tabindex', '-1');
  });
  clone.style.margin = '0';
  const wrapper = document.createElement('div');
  wrapper.classList.add('hvy-context-popover-clone');
  getContextMenuSurfaceClasses(target).forEach((className) => {
    wrapper.classList.add(className);
  });
  wrapper.setAttribute('aria-hidden', 'true');
  wrapper.style.left = `${rect.left}px`;
  wrapper.style.top = `${rect.top}px`;
  wrapper.style.width = `${rect.width}px`;
  wrapper.append(clone);
  return wrapper.outerHTML;
}

function getContextMenuSurfaceClasses(target: HTMLElement): string[] {
  const surface = target.closest<HTMLElement>('.hvy-surface');
  const classes = surface ? Array.from(surface.classList) : [];
  if (!classes.includes('hvy-surface')) {
    classes.unshift('hvy-surface');
  }
  return classes;
}

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/(["\\])/g, '\\$1');
}

function renderDescriptionPopulateModal(): string {
  const progress = state.descriptionPopulate;
  if (!progress?.isRunning) {
    return '';
  }
  const total = Math.max(0, progress.total);
  const completed = Math.min(progress.completed, total);
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const progressText = total > 0 ? `${completed} of ${total}` : 'Preparing...';
  return `
    <div class="modal-root description-progress-modal-root">
      <div class="modal-overlay"></div>
      <section class="modal-panel description-progress-modal" role="dialog" aria-modal="true" aria-labelledby="descriptionProgressTitle">
        <div class="modal-head">
          <div>
            <h3 id="descriptionProgressTitle">Populating Descriptions</h3>
            <p class="muted">Generating structural location labels parent-first.</p>
          </div>
          <div class="modal-head-actions">
            <button type="button" class="danger" data-action="stop-populate-missing-descriptions">Stop</button>
          </div>
        </div>
        <div class="description-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="${escapeAttr(String(total))}" aria-valuenow="${escapeAttr(String(completed))}">
          <div class="description-progress-fill" style="width: ${escapeAttr(String(percent))}%"></div>
        </div>
        <div class="description-progress-meta">
          <strong>${escapeHtml(progressText)}</strong>
          ${progress.current ? `<span>${escapeHtml(progress.current)}</span>` : ''}
        </div>
        ${
          progress.lastGenerated
            ? `<div class="description-progress-last">
                 <span>Last generated</span>
                 <strong>${escapeHtml(progress.lastGenerated)}</strong>
               </div>`
            : ''
        }
        ${
          progress.skippedLeaves > 0
            ? `<p class="muted">${escapeHtml(`${progress.skippedLeaves} component${progress.skippedLeaves === 1 ? '' : 's'} skipped to avoid duplicating content or layout wrappers.`)}</p>`
            : ''
        }
      </section>
    </div>
  `;
}

let editorRenderer: EditorRenderer;
let readerRenderer: ReaderRenderer;

function localGetComponentRenderHelpers() {
  return getComponentRenderHelpers(editorRenderer, readerRenderer);
}

function renderDocumentComponentOptions(selected: string): string {
  if (!isPdfDocument(state.document)) {
    return renderComponentOptions(selected);
  }
  const builtins = ['text', 'container', 'grid', 'image', ...(isPdfAllowedComponent('table', state.document.meta) ? ['table'] : [])];
  const custom = getComponentDefs()
    .map((def) => def.name.trim())
    .filter((name) => name.length > 0 && isPdfAllowedComponent(name, state.document.meta));
  return [...new Set([...builtins, ...custom])]
    .map((option) => renderOption(option, selected))
    .join('');
}

editorRenderer = createEditorRenderer(
  {
    get documentMeta() {
      return state.document.meta as Record<string, unknown>;
    },
    get documentExtension() {
      return state.document.extension;
    },
    get imageAttachmentMaxDimensions() {
      return state.imageAttachmentMaxDimensions;
    },
    get imageAttachmentReductionStatus() {
      return state.imageAttachmentReductionStatus;
    },
    get documentSections() {
      return state.document.sections;
    },
    get showAdvancedEditor() {
      const rowModal = state.sqliteRowComponentModal;
      if (rowModal && !rowModal.readOnly) {
        if (rowModal.mode === 'advanced') {
          return true;
        }
        if (rowModal.mode === 'basic' || rowModal.mode === 'raw') {
          return false;
        }
      }
      return state.showAdvancedEditor;
    },
    get addComponentBySection() {
      return state.addComponentBySection;
    },
    get activeEditorBlock() {
      return state.activeEditorBlock;
    },
    get aiEditorHostBlock() {
      return state.aiEditorHostBlock;
    },
    get aiEditorHostSectionKey() {
      return state.aiEditorHostSectionKey;
    },
    get componentPlacement() {
      return state.componentPlacement;
    },
    get pendingEditorActivation() {
      return state.pendingEditorActivation;
    },
    get expandableEditorPanels() {
      return state.expandableEditorPanels;
    },
    get readerExpandableState() {
      return state.readerExpandableState;
    },
    get editorSidebarHelpDismissed() {
      return state.editorSidebarHelpDismissed;
    },
    get currentView() {
      return state.currentView;
    },
    get responsivePreview() {
      return state.responsivePreview;
    },
    get mobileAdjustmentMode() {
      return state.editorMode === 'mobile-adjustment';
    },
    get editingReusableDefinition() {
      return state.reusableDefinitionEditModal?.mode === 'edit';
    },
    get openTemplateDefinitionKeys() {
      return state.openTemplateDefinitionKeys;
    },
    get descriptionPopulate() {
      return state.descriptionPopulate;
    },
    get openTextLineStyleName() {
      return state.openTextLineStyleName;
    },
    get paragraphStyleRecentNames() {
      return state.paragraphStyleRecentNames;
    },
  },
  {
    escapeAttr,
    escapeHtml,
    flattenSections,
    renderReaderBlock: (section, block, options) => readerRenderer.renderReaderBlock(section, block, options),
    renderReusableSectionOptions,
    renderOption,
    resolveBaseComponent,
    ensureContainerBlocks,
    ensureComponentListBlocks,
    ensureExpandableBlocks,
    ensureGridItems,
    isActiveEditorSectionTitle,
    isActiveEditorBlock,
    isDefaultUntitledSectionTitle,
    formatSectionTitle,
    findSectionByKey,
    buildSectionRenderSequence,
    getComponentDefs,
    getSectionDefs,
    getThemeConfig,
    getComponentRenderHelpers: localGetComponentRenderHelpers,
    isBuiltinComponent,
  }
);

readerRenderer = createReaderRenderer(
  {
    get documentMeta() {
      return state.document.meta;
    },
    get documentExtension() {
      return state.document.extension;
    },
    get documentSections() {
      return state.document.sections;
    },
    get addComponentBySection() {
      return state.addComponentBySection;
    },
    get tempHighlights() {
      return state.tempHighlights;
    },
    get aiEditTarget() {
      return {
        sectionKey: state.aiEdit.sectionKey,
        blockId: state.aiEdit.blockId,
      };
    },
    get contextMenu() {
      return state.contextMenu ?? null;
    },
    get activeEditorBlock() {
      return state.activeEditorBlock;
    },
    get aiEditorHostBlock() {
      return state.aiEditorHostBlock;
    },
    get aiEditorHostSectionKey() {
      return state.aiEditorHostSectionKey;
    },
    get modalSectionKey() {
      return state.modalSectionKey;
    },
    get captionTextModal() {
      return state.captionTextModal;
    },
    get sqliteRowComponentModal() {
      return state.sqliteRowComponentModal;
    },
    get dbTableQueryModal() {
      return state.dbTableQueryModal;
    },
    get pdfTemplateImportModal() {
      return state.pdfTemplateImportModal;
    },
    get reusableSaveModal() {
      return state.reusableSaveModal;
    },
    get reusableTemplateModal() {
      return state.reusableTemplateModal;
    },
    get reusableDefinitionEditModal() {
      return state.reusableDefinitionEditModal;
    },
    get sectionTemplateFlavorModal() {
      return state.sectionTemplateFlavorModal;
    },
    get componentMetaModal() {
      return state.componentMetaModal;
    },
    get themeModalOpen() {
      return state.themeModalOpen;
    },
    get themeModalMode() {
      return state.themeModalMode;
    },
    get paletteOverrideId() {
      return state.paletteOverrideId;
    },
    get theme() {
      return getThemeConfig();
    },
    get currentView() {
      return state.currentView;
    },
    get showAdvancedEditor() {
      return state.showAdvancedEditor;
    },
    get responsivePreview() {
      return state.responsivePreview;
    },
    get readerExpandableState() {
      return state.readerExpandableState;
    },
    get readerContainerState() {
      return state.readerContainerState;
    },
    get readerView() {
      return state.readerView;
    },
    get readerViewActivatedTargets() {
      return state.readerViewActivatedTargets;
    },
    get search() {
      return state.search;
    },
    get componentListReaderViews() {
      return state.componentListReaderViews;
    },
    get viewerSidebarHelpDismissed() {
      return state.viewerSidebarHelpDismissed;
    },
  },
  {
    escapeAttr,
    escapeHtml,
    flattenSections,
    findDuplicateSectionIds,
    findSectionByKey,
    findBlockByIds,
    getSectionId,
    formatSectionTitle,
    resolveBaseComponent,
    ensureExpandableBlocks,
    ensureGridItems,
    getComponentRenderHelpers: localGetComponentRenderHelpers,
    renderEditorBlock: (sectionKey, block, rootSections) => editorRenderer.renderEditorBlock(sectionKey, block, rootSections ?? state.document.sections),
    renderBlockContentEditor: (sectionKey, block) => editorRenderer.renderBlockContentEditor(sectionKey, block),
    renderComponentOptions: renderDocumentComponentOptions,
    renderReusableSectionOptions,
    getSectionDefs,
    renderBlockMetaFields: (sectionKey, block) => editorRenderer.renderBlockMetaFields(sectionKey, block),
  }
);

function renderApp(): void {
  const renderId = incrementRenderCount();
  const startedAt = performance.now();
  let captureMs = 0;
  let themeMs = 0;
  let templateFieldsMs = 0;
  let markupMs = 0;
  let domMs = 0;
  let bindMs = 0;
  let restoreMs = 0;
  let historyMs = 0;
  let focusMs = 0;

  let stepStartedAt = performance.now();
  const pendingPaneScrollRestore = state.pendingPaneScrollRestore;
  const capturedScroll = captureRenderScroll(app, state.paneScroll, pendingPaneScrollRestore);
  state.paneScroll = capturedScroll.paneScroll;
  state.pendingPaneScrollRestore = null;
  captureMs = performance.now() - stepStartedAt;

  stepStartedAt = performance.now();
  applyTheme();
  themeMs = performance.now() - stepStartedAt;

  const isCliEditor = state.editorMode === 'cli';
  const isEditorView = state.currentView === 'editor';
  const isEditorTabActive = isEditorView && !isCliEditor;
  const isViewerView = state.currentView === 'viewer';
  const isAiView = state.currentView === 'ai';
  const isAdvancedEditor = state.editorMode === 'advanced';
  const isMobileAdjustmentEditor = state.editorMode === 'mobile-adjustment';
  const isRawEditor = state.editorMode === 'raw';
  const isDocumentMetaView = isEditorView && isAdvancedEditor && state.metaPanelOpen;
  const canPreviewSurface = !isEditorView || (!isRawEditor && !isCliEditor);
  const pdfDocument = isPdfDocument(state.document);
  const readerWarningsHtml = pdfDocument ? '' : readerRenderer.renderWarnings();
  const readerSidebarSectionsHtml = pdfDocument ? '' : readerRenderer.renderSidebarSections(state.document.sections);
  const hasViewerSidebar = Boolean(readerWarningsHtml.trim() || readerSidebarSectionsHtml.trim());

  stepStartedAt = performance.now();
  const templateFields = getTemplateFields(state.document.meta);
  templateFieldsMs = performance.now() - stepStartedAt;

  stepStartedAt = performance.now();
  const markup = `
    <main class="layout reference-layout hvy-embed-layout">
      ${renderTopbar()}

      <section class="workspace-shell">
        <div class="workspace-head">
          <div class="workspace-view-tools">
            <div class="view-tabs" role="tablist" aria-label="Workspace view">
              <button type="button" class="${isEditorTabActive ? 'secondary' : 'ghost'}" data-action="switch-view" data-view="editor">Editor</button>
              <button type="button" class="${isViewerView ? 'secondary' : 'ghost'}" data-action="switch-view" data-view="viewer">Viewer</button>
              <button type="button" class="${isAiView ? 'secondary' : 'ghost'}" data-action="switch-view" data-view="ai">AI</button>
              <button type="button" class="${isCliEditor ? 'secondary' : 'ghost'}" data-action="switch-view" data-view="cli">CLI</button>
            </div>
            <button type="button" class="palette-open-button ghost" data-action="open-theme-modal">Palettes</button>
          </div>
          ${canPreviewSurface ? renderPreviewControlStack() : '<div></div>'}
          ${renderWorkspaceRightControls({
            isEditorView,
            isMobileAdjustmentEditor,
            isAdvancedEditor,
            isRawEditor,
          })}
        </div>
        <div${renderResponsivePreviewFrameAttrs(`pane ${isEditorView ? 'editor-pane' : 'reader-pane'} full-pane`)}>
          ${isCliEditor || isDocumentMetaView ? '' : renderCollapsedSearchBar(state.search, { escapeHtml })}
          ${
            isEditorView
              ? `${isRawEditor
                  ? `<div class="raw-editor-shell">
                       <div class="raw-editor-head">
                         <div>
                           <h3>Raw HVY</h3>
                           <p>Edit serialized document text directly, then apply it back into the visual editor.</p>
                         </div>
                         <div class="raw-editor-actions">
                           <button type="button" class="ghost" data-action="reset-raw-editor">Reset</button>
                           <button type="button" class="secondary" data-action="apply-raw-editor">Apply</button>
                         </div>
                       </div>
                       ${state.rawEditorError ? `<div class="raw-editor-error" role="alert">${escapeHtml(state.rawEditorError)}</div>` : ''}
                       ${
                         state.rawEditorDiagnostics.length > 0
                           ? `<div class="raw-editor-diagnostics" role="status">
                                ${state.rawEditorDiagnostics
                                  .map(
                                    (diagnostic) => `<article class="raw-editor-diagnostic raw-editor-diagnostic-${escapeAttr(diagnostic.severity)}">
                                        <strong>${escapeHtml(diagnostic.severity === 'error' ? 'Error' : 'Warning')}</strong>
                                        <p>${escapeHtml(diagnostic.message)}</p>
                                        <p class="raw-editor-diagnostic-hint">${escapeHtml(diagnostic.hint)}</p>
                                      </article>`
                                  )
                                  .join('')}
                              </div>`
                           : ''
                       }
                       <textarea id="rawEditor" class="raw-editor-textarea" data-field="raw-editor-text" spellcheck="false">${escapeHtml(state.rawEditorText)}</textarea>
                     </div>`
                  : isCliEditor
                  ? renderCliView({
                      cwd: state.cliSession.cwd,
                      draft: state.cliDraft,
                      history: state.cliHistory,
                      escapeHtml,
                      escapeAttr,
                    })
                  : isDocumentMetaView
                  ? `<div class="document-meta-view">${renderTransientNotice()}${editorRenderer.renderMetaPanel()}</div>`
                  : `${isAdvancedEditor ? renderTemplatePanel(templateFields, state.templateValues, { escapeAttr, escapeHtml }) : ''}
                <div${renderResponsivePreviewFrameAttrs(`editor-shell ${isPdfDocument(state.document) ? 'has-no-sidebar' : state.editorSidebarOpen ? 'is-sidebar-open' : 'is-sidebar-closed'}`)}>
                  ${renderTransientNotice()}
                  ${isPdfDocument(state.document) ? '' : `<div class="editor-sidebar-backdrop" data-action="toggle-editor-sidebar"></div>
                    <aside class="editor-sidebar">
                      <button type="button" class="editor-sidebar-tab" data-action="toggle-editor-sidebar" aria-expanded="${state.editorSidebarOpen ? 'true' : 'false'}" aria-label="Toggle sidebar"><span class="sidebar-tab-hamburger" aria-hidden="true"></span></button>
                      ${editorRenderer.renderSidebarHelpBalloon(state.document.sections)}
                      <div class="editor-sidebar-panel">
                        ${editorRenderer.renderSidebarEditorSections(state.document.sections)}
                      </div>
                    </aside>`}
                  <div id="editorTree" class="editor-tree">${editorRenderer.renderSectionEditorTree(state.document.sections)}</div>
                </div>`}`
              : `<div${renderResponsivePreviewFrameAttrs(
                  `viewer-shell ${pdfDocument && !isAiView ? 'phvy-viewer-shell ' : ''}${isAiView ? 'ai-view-shell ' : ''}${state.contextMenu ? 'is-context-menu-open ' : ''}${hasViewerSidebar ? (state.viewerSidebarOpen ? 'is-sidebar-open' : 'is-sidebar-closed') : 'has-no-sidebar'}`,
                  pdfDocument && !isAiView ? renderPdfDocumentViewerThemeStyle(state.document, escapeAttr) : ''
                )}>
                   ${renderTransientNotice()}
                   ${hasViewerSidebar ? `<div class="viewer-sidebar-backdrop" data-action="toggle-viewer-sidebar"></div>
                     <aside class="viewer-sidebar">
                       <button type="button" class="viewer-sidebar-tab" data-action="toggle-viewer-sidebar" aria-expanded="${state.viewerSidebarOpen ? 'true' : 'false'}" aria-label="Toggle navigation">${renderSidebarTabLabel()}</button>
                       ${readerRenderer.renderSidebarHelpBalloon(state.document.sections)}
                       <div class="viewer-sidebar-panel">
                         <div id="readerWarnings" class="reader-warnings">${readerWarningsHtml}</div>
                         <!-- <div id="readerNav" class="reader-nav">${readerRenderer.renderNavigation(state.document.sections)}</div> -->
                         <div id="${isAiView ? 'aiSidebarSections' : 'readerSidebarSections'}" class="reader-sidebar-sections hvy-reader-surface${isAiView ? ' hvy-ai-reader-surface' : ''}">${readerSidebarSectionsHtml}</div>
                       </div>
                     </aside>` : ''}
                   <div id="${isAiView ? 'aiReaderDocument' : 'readerDocument'}" class="reader-document hvy-reader-surface${isAiView ? ' hvy-ai-reader-surface' : ''}">${readerRenderer.renderReaderSections(state.document.sections)}</div>
                   ${isAiView ? renderAiModeHint(state, { escapeAttr, escapeHtml }) : ''}
                   ${renderContextMenu()}
                   ${
                     isAiView
                       ? `${renderAiEditPopover(state, { escapeAttr, escapeHtml })}`
                       : ''
                   }
                 </div>`
          }
          ${
            isCliEditor || isDocumentMetaView
              ? ''
              : `${renderChatPanel(
                  state.chat,
                  state.document,
                  { escapeAttr, escapeHtml },
                  isViewerView ? 'qa' : 'document-edit',
                  state.currentView === 'editor' || state.currentView === 'ai'
                )}
                ${renderSearchLauncher(state.search)}
                ${renderSearchModal(state.search, state.document, { escapeAttr, escapeHtml, readerRenderer })}`
          }
        </div>
      </section>

      ${readerRenderer.renderModal()}
      ${readerRenderer.renderLinkInlineModal()}
      ${renderNewDocumentModal(state.newDocumentModalOpen, { escapeAttr, escapeHtml })}
      ${renderDescriptionPopulateModal()}
    </main>
  `;
  markupMs = performance.now() - stepStartedAt;

  capturePluginFocus();

  stepStartedAt = performance.now();
  app.innerHTML = markup;
  domMs = performance.now() - stepStartedAt;

  stepStartedAt = performance.now();
  bindUi(app);
  reconcilePluginMounts(app);
  void runButtonVisibilityScripts(app);
  bindMs = performance.now() - stepStartedAt;

  stepStartedAt = performance.now();
  restoreRenderScroll(app, capturedScroll);
  centerSearchResultLenses(app);
  scheduleReaderHighlightGlow(app);
  virtualizeRenderedSections({
    root: app,
    afterRestore: (scope) => {
      reconcilePluginMounts(scope, { prune: false });
      void runButtonVisibilityScripts(scope);
      initializeCarouselReaders(scope);
    },
  });
  restoreMs = performance.now() - stepStartedAt;

  stepStartedAt = performance.now();
  commitHistorySnapshot();
  historyMs = performance.now() - stepStartedAt;

  stepStartedAt = performance.now();
  focusPendingSectionTitleEditor(app);
  centerPendingEditorSection(app);
  scrollPendingEditorActivation(app);
  scrollPendingEditorDeactivation(app);
  focusMs = performance.now() - stepStartedAt;

  console.debug('[hvy:perf] renderApp', {
    renderId,
    elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
    captureMs: Number(captureMs.toFixed(2)),
    themeMs: Number(themeMs.toFixed(2)),
    templateFieldsMs: Number(templateFieldsMs.toFixed(2)),
    markupMs: Number(markupMs.toFixed(2)),
    domMs: Number(domMs.toFixed(2)),
    bindMs: Number(bindMs.toFixed(2)),
    restoreMs: Number(restoreMs.toFixed(2)),
    historyMs: Number(historyMs.toFixed(2)),
    focusMs: Number(focusMs.toFixed(2)),
    view: state.currentView,
    advanced: state.showAdvancedEditor,
    editorMode: state.editorMode,
    historyLength: state.history.length,
  });

  void runPluginDocumentHooks('unknown');
}

function renderTopbar(): string {
  return `
    <header class="topbar">
      <div class="title-block">
        <h1>HVY Reference Implementation</h1>
        <p>Visual editor + reader for <code>.hvy</code>, <code>.thvy</code>, and <code>.phvy</code>. <a href="/examples/two-embedded-docs.html">Two embedded docs</a></p>
      </div>
      <div class="toolbar">
        <div class="toolbar-section toolbar-section-documents">
          <button id="newBtn" type="button" class="toolbar-primary-button">New</button>
          ${renderDocumentMenu()}
        </div>
        <div class="toolbar-section toolbar-section-files">
          <button id="openLocalFileBtn" type="button" class="hvy-button">Open Local</button>
          <label class="file-picker">
            Select File
            <input id="fileInput" type="file" accept=".hvy,.thvy,.phvy,.md,.markdown,text/markdown,text/plain" />
          </label>
          <input id="downloadName" type="text" value="${escapeAttr(state.filename)}" aria-label="Download file name" />
          <button id="saveFileBtn" type="button" class="hvy-button">Save File</button>
          <button id="downloadBtn" type="button" class="hvy-button">Download File</button>
          <button id="exportPdfBtn" type="button" class="hvy-button">Export PDF</button>
        </div>
      </div>
    </header>
  `;
}

function renderDocumentMenu(): string {
  const current = DOCUMENT_MENU_ITEMS.find((item) => item.selectedExample === state.selectedExample);
  const label = current?.label ?? 'Documents';
  return `
    <details class="document-menu">
      <summary>
        <span>Documents</span>
        <strong>${escapeHtml(label)}</strong>
      </summary>
      <div class="document-menu-panel">
        ${DOCUMENT_MENU_ITEMS
          .map((item) => {
            const selected = item.selectedExample === state.selectedExample;
            return `<button id="${escapeAttr(item.id)}" type="button" class="${selected ? 'secondary' : 'ghost'}" aria-pressed="${selected ? 'true' : 'false'}">${escapeHtml(item.label)}</button>`;
          })
          .join('')}
      </div>
    </details>
  `;
}

function renderResponsivePreviewControls(): string {
  const options: Array<{ value: AppState['responsivePreview']; label: string }> = [
    { value: 'full', label: 'Full' },
    { value: 'phone', label: 'Phone 390' },
    { value: 'tablet', label: 'Tablet 768' },
    { value: 'desktop', label: 'Desktop' },
  ];
  return `<div class="responsive-preview-controls" role="group" aria-label="Document preview width">
    ${options
      .map(
        (option) => `<button type="button" class="${state.responsivePreview === option.value ? 'secondary' : 'ghost'}" data-action="set-responsive-preview" data-responsive-preview="${escapeAttr(option.value)}">${escapeHtml(option.label)}</button>`
      )
      .join('')}
  </div>`;
}

function renderTransientNotice(): string {
  const notice = state.transientNotice;
  if (!notice) {
    return '';
  }
  return `<div class="transient-notice" role="status">${escapeHtml(notice.message)}</div>`;
}

function renderPreviewControlStack(): string {
  return `<div class="preview-control-stack">
    ${renderResponsivePreviewControls()}
    ${renderReaderViewControls()}
  </div>`;
}

function renderWorkspaceRightControls(options: {
  isEditorView: boolean;
  isMobileAdjustmentEditor: boolean;
  isAdvancedEditor: boolean;
  isRawEditor: boolean;
}): string {
  return `<div class="workspace-right-controls">
    ${
      options.isEditorView
        ? `<div class="editor-top-controls">
            ${isPdfDocument(state.document) ? '<span class="pdf-document-badge" title="PDF template document">PDF Doc</span>' : ''}
            <button type="button" class="${state.editorMode === 'basic' ? 'secondary' : 'ghost'}" data-action="set-editor-mode" data-editor-mode="basic">Basic</button>
            <button type="button" class="${options.isMobileAdjustmentEditor ? 'secondary' : 'ghost'}" data-action="set-editor-mode" data-editor-mode="mobile-adjustment">Mobile Adjustment</button>
            <button type="button" class="${options.isAdvancedEditor ? 'secondary' : 'ghost'}" data-action="set-editor-mode" data-editor-mode="advanced">Advanced</button>
            <button type="button" class="${options.isRawEditor ? 'secondary' : 'ghost'}" data-action="set-editor-mode" data-editor-mode="raw">Raw</button>
            ${
              options.isAdvancedEditor
                ? `<button type="button" class="${state.metaPanelOpen ? 'secondary' : 'ghost'}" data-action="toggle-document-meta">Document Meta</button>`
                : ''
            }
          </div>`
        : ''
    }
    ${renderMetaFilterControls()}
  </div>`;
}

function renderMetaFilterControls(): string {
  const status = state.metaFilter.error
    ? state.metaFilter.error
    : state.metaFilter.status
    ? state.metaFilter.status
    : state.metaFilter.resultCount === null
    ? ''
    : `${state.metaFilter.resultCount} result${state.metaFilter.resultCount === 1 ? '' : 's'}`;
  return `<form id="metaFilterComposer" class="meta-filter-controls" aria-label="Meta filter current document">
    <div class="meta-filter-mode-group" role="group" aria-label="Meta filter mode">
      ${renderMetaFilterModeButton('keyword', 'Keyword')}
      ${renderMetaFilterModeButton('semantic', 'Semantic')}
    </div>
    <div class="meta-filter-mode-group" role="group" aria-label="Meta filter behavior">
      ${renderMetaFilterBehaviorButton('deprioritize', 'Shade')}
      ${renderMetaFilterBehaviorButton('hide', 'Hide')}
    </div>
    <div class="meta-filter-input-shell">
      <input
        id="metaFilterQuery"
        class="meta-filter-input"
        data-field="meta-filter-query"
        value="${escapeAttr(state.metaFilter.query)}"
        placeholder="Meta filter prompt"
        autocomplete="off"
        spellcheck="true"
      />
      <button type="submit" class="${state.metaFilter.isRunning ? 'ghost' : 'secondary'} meta-filter-submit" ${state.metaFilter.isRunning ? 'disabled' : ''}>
        ${state.metaFilter.isRunning ? 'Running' : 'Meta Filter'}
      </button>
      <button type="button" class="ghost meta-filter-clear" data-action="clear-meta-filter" ${state.metaFilter.isRunning ? 'disabled' : ''}>
        Clear
      </button>
    </div>
    ${status ? `<div class="meta-filter-status${state.metaFilter.error ? ' is-error' : ''}" role="status">${escapeHtml(status)}</div>` : ''}
  </form>`;
}

function renderMetaFilterModeButton(mode: AppState['search']['filterQueryMode'], label: string): string {
  const active = state.search.filterQueryMode === mode;
  return `<button
    type="button"
    class="meta-filter-mode${active ? ' is-active' : ''}"
    data-action="set-meta-filter-mode"
    data-meta-filter-mode="${escapeAttr(mode)}"
    aria-pressed="${active ? 'true' : 'false'}"
    ${state.metaFilter.isRunning ? 'disabled' : ''}
  >${escapeHtml(label)}</button>`;
}

function renderMetaFilterBehaviorButton(mode: AppState['search']['filterMode'], label: string): string {
  const active = state.search.filterMode === mode;
  return `<button
    type="button"
    class="meta-filter-mode${active ? ' is-active' : ''}"
    data-action="set-meta-filter-behavior"
    data-meta-filter-behavior="${escapeAttr(mode)}"
    aria-pressed="${active ? 'true' : 'false'}"
    ${state.metaFilter.isRunning ? 'disabled' : ''}
  >${escapeHtml(label)}</button>`;
}

function renderReaderViewControls(): string {
  if (state.selectedExample !== 'resume-example') {
    return '';
  }
  const selectedView = getSelectedReaderViewId();
  const renderButton = (id: string, label: string, selected: boolean): string =>
    `<button id="${escapeAttr(id)}" type="button" class="${selected ? 'secondary' : 'ghost'}" aria-pressed="${selected ? 'true' : 'false'}">${escapeHtml(label)}</button>`;
  return `<div class="reader-view-controls" role="group" aria-label="Resume reader views">
    ${renderButton('clearReaderViewBtn', 'No View', selectedView === 'none')}
    ${renderButton('typescriptResumeViewBtn', 'TypeScript View', selectedView === 'typescript')}
    ${renderButton('llmEngineerResumeViewBtn', 'LLM Engineer View', selectedView === 'llm-engineer')}
  </div>`;
}

function getSelectedReaderViewId(): 'none' | 'typescript' | 'llm-engineer' | 'custom' {
  if (Object.keys(state.readerView).length === 0) {
    return 'none';
  }
  const resumeViews = bundledResumeViews as Record<string, ReaderViewFilter>;
  if (isSameReaderView(state.readerView, resumeViews.typescript ?? {})) {
    return 'typescript';
  }
  if (isSameReaderView(state.readerView, resumeViews['llm-engineer'] ?? {})) {
    return 'llm-engineer';
  }
  return 'custom';
}

function isSameReaderView(left: ReaderViewFilter, right: ReaderViewFilter): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function renderResponsivePreviewFrameAttrs(baseClass: string, inlineStyle = ''): string {
  const maxWidth = typeof state.document.meta.reader_max_width === 'string' ? state.document.meta.reader_max_width.trim() : '';
  const width =
    state.responsivePreview === 'phone'
      ? '390px'
      : state.responsivePreview === 'tablet'
      ? '768px'
      : state.responsivePreview === 'desktop'
      ? maxWidth || '960px'
      : '';
  const className = `${baseClass} hvy-preview-frame hvy-preview-frame-${state.responsivePreview}`;
  const styleValues = [width ? `width: ${escapeAttr(width)};` : '', inlineStyle].filter(Boolean).join(' ');
  const style = styleValues ? ` style="${styleValues}"` : '';
  return ` class="${escapeAttr(className)}"${style}`;
}

function renderSidebarTabLabel(): string {
  const label = String(state.document.meta.sidebar_label || '☰');
  return label === '☰'
    ? '<span class="sidebar-tab-hamburger" aria-hidden="true"></span>'
    : `<span class="sidebar-tab-label">${escapeHtml(label)}</span>`;
}

function refreshReaderPanels(): void {
  const refreshId = incrementRefreshReaderCount();
  const startedAt = performance.now();
  let modalMs = 0;
  const surfaceRefresh = refreshReaderSurfaces({
    root: app,
    readerRenderer,
    sections: state.document.sections,
    refreshNavigation: true,
    capturePluginFocus,
    reconcilePluginMounts,
    runButtonVisibilityScripts,
  });
  if (surfaceRefresh.refreshedSidebar || surfaceRefresh.refreshedReader) {
    scheduleReaderHighlightGlow(app);
    initializeCarouselReaders(app);
    virtualizeRenderedSections({
      root: app,
      afterRestore: (scope) => {
        reconcilePluginMounts(scope, { prune: false });
        void runButtonVisibilityScripts(scope);
        initializeCarouselReaders(scope);
      },
    });
  }

  const modalStartedAt = performance.now();
  refreshModalPreview();
  modalMs = performance.now() - modalStartedAt;
  console.debug('[hvy:perf] refreshReaderPanels', {
    refreshId,
    elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
    warningsMs: Number(surfaceRefresh.warningsMs.toFixed(2)),
    navMs: Number(surfaceRefresh.navMs.toFixed(2)),
    readerMs: Number(surfaceRefresh.readerMs.toFixed(2)),
    modalMs: Number(modalMs.toFixed(2)),
  });
  void runPluginDocumentHooks('unknown');
}

function refreshModalPreview(): void {
  if (!state.modalSectionKey) {
    return;
  }

  const section = findSectionByKey(state.document.sections, state.modalSectionKey);
  if (!section) {
    return;
  }

  const modalTitle = app.querySelector<HTMLHeadingElement>('#modalTitle');
  if (modalTitle) {
    modalTitle.innerHTML = `Meta: ${escapeHtml(formatSectionTitle(section.title))} <code>#${escapeHtml(getSectionId(section))}</code>`;
  }
}

function scheduleReaderHighlightGlow(root: ParentNode): void {
  const signature = JSON.stringify(state.readerView);
  if (signature !== readerHighlightGlowSignature) {
    readerHighlightGlowSignature = signature;
    readerHighlightGlowSeenTargets = new Set<string>();
  }

  readerHighlightGlowObserver?.disconnect();
  readerHighlightGlowObserver = null;

  const highlighted = getReaderHighlightGlowRoots(root)
    .flatMap((surface) => [...surface.querySelectorAll<HTMLElement>('.reader-section.is-highlighted, .reader-block.is-highlighted')])
    .filter((element) => !readerHighlightGlowSeenTargets.has(getReaderHighlightGlowKey(element)));
  if (highlighted.length === 0) {
    return;
  }

  const triggerGlow = (element: HTMLElement): void => {
    readerHighlightGlowSeenTargets.add(getReaderHighlightGlowKey(element));
    element.classList.add('is-reader-view-highlight-glowing');
    window.setTimeout(() => {
      element.classList.remove('is-reader-view-highlight-glowing');
    }, READER_HIGHLIGHT_GLOW_MS);
  };

  if (!('IntersectionObserver' in window)) {
    highlighted.forEach(triggerGlow);
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          continue;
        }
        const element = entry.target as HTMLElement;
        triggerGlow(element);
        observer.unobserve(element);
      }
    },
    { threshold: 0.15 }
  );
  readerHighlightGlowObserver = observer;
  highlighted.forEach((element) => observer.observe(element));
}

function getReaderHighlightGlowKey(element: HTMLElement): string {
  const surface = element.closest('#readerSidebarSections, #aiSidebarSections')
    ? 'sidebar'
    : element.closest('#readerDocument, #aiReaderDocument')
    ? 'reader'
    : 'unknown';
  return `${surface}:${element.dataset.readerViewTarget || element.id || element.dataset.blockId || ''}`;
}

function getReaderHighlightGlowRoots(root: ParentNode): HTMLElement[] {
  const sidebar =
    root.querySelector<HTMLElement>('#readerSidebarSections') ??
    root.querySelector<HTMLElement>('#aiSidebarSections');
  const reader =
    root.querySelector<HTMLElement>('#readerDocument') ??
    root.querySelector<HTMLElement>('#aiReaderDocument');
  if (state.viewerSidebarOpen && sidebar) {
    return [sidebar];
  }
  return reader ? [reader] : sidebar ? [sidebar] : [];
}

// Initialize late-bound callbacks so all modules can access renderApp/refreshReaderPanels
initCallbacks({
  renderApp,
  refreshReaderPanels,
  refreshModalPreview,
  componentRenderHelpers: localGetComponentRenderHelpers(),
  readerRenderer,
});

async function bootstrap(): Promise<void> {
  const savedSession = loadSessionState();
  setHostPlugins([...builtInPlugins, resumeOutputGeneratorsPlugin]);
  resetPluginDocumentHookState();
  initState(applySessionState(createInitialState(await createDefaultDocument()), savedSession));
  bindSessionPersistence();
  saveSessionState(state);
  initColorModeSync();
  renderApp();
  void refreshRestoredSearch(savedSession);
}

async function refreshRestoredSearch(savedSession: ReturnType<typeof loadSessionState>): Promise<void> {
  const savedSearch = savedSession?.search;
  if (!savedSearch?.submittedQuery.trim()) {
    return;
  }
  state.search.queryDraft = savedSearch.queryDraft || savedSearch.submittedQuery;
  if (savedSearch.submittedFilterQueryMode === 'semantic') {
    state.search.filterQueryMode = 'semantic';
  } else {
    state.search.submittedQuery = '';
    await submitSearch();
  }
  if (savedSearch.filterEnabled) {
    await applySearchFilter({ enabled: true });
  }
  saveSessionState(state);
}

bootstrap().catch((error) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  app.innerHTML = `
    <main class="layout reference-layout hvy-embed-layout">
      <section class="pane full-pane">
        <h2>Startup Problem</h2>
        <p>The app failed before the first render.</p>
        <pre>${escapeHtml(message)}</pre>
      </section>
    </main>
  `;
  throw error;
});
