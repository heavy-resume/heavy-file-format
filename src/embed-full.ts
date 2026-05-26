import './default-theme.css';
import './host-overrides.css';
import './style.css';
import 'highlight.js/styles/github.css';

import { createEditorRenderer, type EditorRenderer } from './editor/render';
import { createReaderRenderer, type ReaderRenderer } from './reader/render';
import {
  activateStateRuntime,
  createStateRuntime,
  getActiveStateRuntime,
  state,
  initCallbacks,
  runWithStateRuntime,
  runWithStateRuntimeAsync,
  type StateRuntime,
} from './state';
import type { AppState, ImageAttachmentMaxDimensions, VisualDocument } from './types';
import { deserializeDocumentBytes, serializeDocument, serializeDocumentBytes } from './serialization';
import { deserializeDocumentWithDiagnostics } from './serialization';
import { escapeAttr, escapeHtml, renderOption } from './utils';
import { applyTheme, getThemeConfig, initColorModeSync, setThemeRoot } from './theme';
import { getPaletteById } from './palettes/palette-registry';
import {
  buildSectionRenderSequence,
  findDuplicateSectionIds,
  findSectionByKey,
  flattenSections,
  formatSectionTitle,
  getSectionId,
  isDefaultUntitledSectionTitle,
} from './section-ops';
import {
  getComponentDefs,
  getSectionDefs,
  isBuiltinComponent,
  renderComponentOptions,
  renderReusableSectionOptions,
  resolveBaseComponent,
} from './component-defs';
import {
  findBlockByIds,
  getComponentRenderHelpers,
  isActiveEditorBlock,
  isActiveEditorSectionTitle,
} from './block-ops';
import {
  ensureComponentListBlocks,
  ensureContainerBlocks,
  ensureExpandableBlocks,
  ensureGridItems,
} from './document-factory';
import { bindReaderUi } from './bind-reader-ui';
import { bindClickActions } from './bind/handlers/click-actions';
import { bindInputBlock } from './bind/handlers/input-block';
import { capturePluginFocus, reconcilePluginMounts } from './plugins/mount';
import { setHostPlugins } from './plugins/registry';
import { resetPluginDocumentHookState, runPluginDocumentHooks } from './plugins/hooks';
import {
  builtInPluginMap,
  builtInPlugins,
} from 'virtual:hvy-built-in-plugins';
import type { HvyPlugin } from './plugins/types';
import { runButtonVisibilityScripts } from './editor/components/button/button-actions';
import { createDefaultChatState } from './chat/chat';
import { renderChatPanel, setHostChatClient, type HostChatClient } from './chat/chat';
import { setRuntimeSemanticFilterProvider } from './reference-config';
import type { HvySemanticFilterProvider } from './search/types';
import { searchDocuments } from './search/documents';
import { createDocumentFilterSnapshot } from './search/document-filter';
import {
  createDocumentSearchSnapshot,
  externalSearchSnapshotToDocumentState,
  searchStateToSnapshot,
} from './search/snapshot';
import type { HvySearchSnapshot, HvySearchSnapshotInput } from './search/types';
import { renderAiEditPopover, renderAiModeHint } from './ai-mode-ui';
import { createDefaultSearchState } from './search/state';
import { renderSearchLauncher, renderSearchModal } from './search/render';
import { loadPaletteOverrideId } from './palettes/palette-preferences';
import { captureRenderScroll, restoreRenderScroll } from './render-scroll';
import { observeRenderedLinks, resetObservedLinks, type HvyLinkObserver } from './link-observer';
import { recordHistory, redoState, undoState } from './history';
import { resetTransientUiState } from './navigation';
import { renderNewDocumentModal } from './new-document-modal';
import { applyRecoveryStatePayload, createRecoveryStatePayload, loadSessionState, saveSessionState } from './state-persistence';
import { refreshReaderSurfaces } from './reader/refresh-surfaces';
import { isPdfAllowedComponent, isPdfDocument } from './pdf-document-capabilities';
import { virtualizeRenderedSections } from './section-virtualizer';
import {
  buildImportPlanForDocument,
  importTextIntoDocument,
  type BuildImportPlanOptions,
  type BuildImportPlanResult,
  type ImportFromTextOptions,
  type ImportFromTextResult,
} from './ai-document-edit';
import {
  initDocumentChangeTracking,
  isDocumentDirty,
  markDocumentSaved,
  type HvyDocumentChangeCallback,
} from './document-change';
import type { HvyPdfExportOptions } from './pdf-export/types';
import { createPdfExportPlan, createPdfExportPlanFromPrompt } from './pdf-export/planning';
import { getPdfExportPromptTemplates, renderPdfExportPromptTemplate } from './pdf-export/prompt-templates';

export type HvyEmbedMode = 'viewer' | 'editor' | 'ai';

export interface HvyMountOptions {
  root: HTMLElement;
  document: VisualDocument;
  mode?: HvyEmbedMode;
  plugins?: HvyPlugin[];
  showAdvancedEditor?: boolean;
  chatClient?: HostChatClient | null;
  semanticFilterProvider?: HvySemanticFilterProvider | null;
  linkObserver?: HvyLinkObserver | null;
  controls?: boolean;
  paletteId?: string | null;
  storageKey?: string | null;
  imageAttachmentMaxDimensions?: ImageAttachmentMaxDimensions | null;
  searchSnapshot?: HvySearchSnapshotInput | null;
  onDocumentChange?: HvyDocumentChangeCallback;
}

export interface HvyMount {
  destroy(): void;
  getDocument(): VisualDocument;
  serializeDocumentBytes(): Uint8Array;
  getPdfBlob(options?: HvyPdfExportOptions): Promise<Blob>;
  exportPdf(options?: HvyPdfExportOptions): Promise<void>;
  markSaved(): void;
  isDirty(): boolean;
  undo(): void;
  redo(): void;
  buildImportPlan(options: BuildImportPlanOptions): Promise<BuildImportPlanResult>;
  importFromText(options: ImportFromTextOptions): Promise<ImportFromTextResult>;
  setLinkObserver(observer: HvyLinkObserver | null): void;
  setPaletteOverrideId(id: string | null): void;
  setSearchSnapshot(snapshot: HvySearchSnapshotInput | null): void;
  getSearchSnapshot(): HvySearchSnapshot;
  getRecoveryState(): string | null;
  applyRecoveryState(payload: string | null | undefined): void;
  openDocumentMeta(): boolean;
  openThemeEditor(options?: { advanced?: boolean }): void;
  mountThemeEditor(root: HTMLElement, options?: { advanced?: boolean; includePalettePicker?: boolean }): void;
}

let editorRenderer: EditorRenderer;
let readerRenderer: ReaderRenderer;
let currentRoot: HTMLElement | null = null;
let currentLinkObserver: HvyLinkObserver | null = null;
const embedUiBindGenerations = new WeakMap<HTMLElement, number>();

function createEmbedState(
  document: VisualDocument,
  mode: HvyEmbedMode,
  showAdvancedEditor = false,
  imageAttachmentMaxDimensions?: ImageAttachmentMaxDimensions | null,
  sessionStorageKey?: string | null
): AppState {
  return {
    document,
    filename: document.extension === '.phvy' ? 'document.phvy' : document.extension === '.thvy' ? 'resume.thvy' : 'resume.hvy',
    selectedExample: 'default',
    currentView: mode,
    editorMode: 'basic',
    responsivePreview: 'full',
    sessionStorageKey,
    persistDocumentState: mode !== 'viewer',
    imageAttachmentMaxDimensions,
    chat: createDefaultChatState(),
    aiModeTipDismissed: false,
    search: createDefaultSearchState(),
    metaFilter: { query: '', mode: 'semantic', isRunning: false, status: null, error: null, resultCount: null },
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
    paneScroll: { editorTop: 0, editorSidebarTop: 0, viewerSidebarTop: 0, readerTop: 0, windowLeft: 0, windowTop: 0 },
    showAdvancedEditor,
    rawEditorText: serializeDocument(document),
    rawEditorError: null,
    rawEditorDiagnostics: [],
    cliDraft: '',
    cliSession: { cwd: '/' },
    cliHistory: [],
    activeEditorBlock: null,
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
    newDocumentModalOpen: false,
    reusableSaveModal: null,
    reusableTemplateModal: null,
    sectionTemplateFlavorModal: null,
    tempHighlights: new Set<string>(),
    addComponentBySection: {},
    metaPanelOpen: false,
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
  };
}

function applyEmbeddedSessionState(initial: AppState, savedSession: ReturnType<typeof loadSessionState>): AppState {
  if (!savedSession) {
    return initial;
  }
  const shouldRestoreDocument = initial.persistDocumentState !== false && savedSession.document;
  const document = shouldRestoreDocument ? savedSession.document! : initial.document;
  const restored: AppState = {
    ...initial,
    document,
    filename: shouldRestoreDocument ? savedSession.filename : initial.filename,
    selectedExample: savedSession.selectedExample,
    currentView: initial.currentView,
    editorMode: savedSession.editorMode,
    showAdvancedEditor: savedSession.showAdvancedEditor,
    rawEditorText: shouldRestoreDocument
      ? savedSession.rawEditorText || serializeDocument(document)
      : serializeDocument(document),
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
  applyRecoveryStatePayload(restored, savedSession.activeEditor ? JSON.stringify({ version: 1, activeEditor: savedSession.activeEditor }) : null);
  return restored;
}

function bindSessionPersistence(runtime: StateRuntime): AbortController {
  const controller = new AbortController();
  const persist = () => runWithStateRuntime(runtime, () => saveSessionState(state));
  window.addEventListener('beforeunload', persist, { signal: controller.signal });
  window.addEventListener('pagehide', persist, { signal: controller.signal });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      persist();
    }
  }, { signal: controller.signal });
  return controller;
}

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

function ensureRenderers(): void {
  if (editorRenderer && readerRenderer) return;
  editorRenderer = createEditorRenderer(
    {
      get documentMeta() { return state.document.meta as Record<string, unknown>; },
      get documentExtension() { return state.document.extension; },
      get documentSections() { return state.document.sections; },
      get showAdvancedEditor() { return state.showAdvancedEditor; },
      get addComponentBySection() { return state.addComponentBySection; },
      get activeEditorBlock() { return state.activeEditorBlock; },
      get aiEditorHostBlock() { return state.aiEditorHostBlock; },
      get aiEditorHostSectionKey() { return state.aiEditorHostSectionKey; },
      get componentPlacement() { return state.componentPlacement; },
      get pendingEditorActivation() { return state.pendingEditorActivation; },
      get expandableEditorPanels() { return state.expandableEditorPanels; },
      get readerExpandableState() { return state.readerExpandableState; },
      get editorSidebarHelpDismissed() { return state.editorSidebarHelpDismissed; },
      get currentView() { return state.currentView; },
      get responsivePreview() { return state.responsivePreview; },
      get mobileAdjustmentMode() { return state.editorMode === 'mobile-adjustment'; },
      get descriptionPopulate() { return state.descriptionPopulate; },
      get openTextLineStyleName() { return state.openTextLineStyleName; },
      get paragraphStyleRecentNames() { return state.paragraphStyleRecentNames; },
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
      get documentMeta() { return state.document.meta; },
      get documentExtension() { return state.document.extension; },
      get documentSections() { return state.document.sections; },
      get addComponentBySection() { return state.addComponentBySection; },
      get tempHighlights() { return state.tempHighlights; },
      get aiEditTarget() { return { sectionKey: state.aiEdit.sectionKey, blockId: state.aiEdit.blockId }; },
      get contextMenu() { return state.contextMenu ?? null; },
      get activeEditorBlock() { return state.activeEditorBlock; },
      get aiEditorHostBlock() { return state.aiEditorHostBlock; },
      get aiEditorHostSectionKey() { return state.aiEditorHostSectionKey; },
      get modalSectionKey() { return state.modalSectionKey; },
      get sqliteRowComponentModal() { return state.sqliteRowComponentModal; },
      get dbTableQueryModal() { return state.dbTableQueryModal; },
      get reusableSaveModal() { return state.reusableSaveModal; },
      get reusableTemplateModal() { return state.reusableTemplateModal; },
      get sectionTemplateFlavorModal() { return state.sectionTemplateFlavorModal; },
      get componentMetaModal() { return state.componentMetaModal; },
      get themeModalOpen() { return state.themeModalOpen; },
      get themeModalMode() { return state.themeModalMode; },
      get paletteOverrideId() { return state.paletteOverrideId; },
      get theme() { return getThemeConfig(); },
      get currentView() { return state.currentView; },
      get showAdvancedEditor() { return state.showAdvancedEditor; },
      get responsivePreview() { return state.responsivePreview; },
      get readerExpandableState() { return state.readerExpandableState; },
      get readerContainerState() { return state.readerContainerState; },
      get readerView() { return state.readerView; },
      get readerViewActivatedTargets() { return state.readerViewActivatedTargets; },
      get search() { return state.search; },
      get componentListReaderViews() { return state.componentListReaderViews; },
      get viewerSidebarHelpDismissed() { return state.viewerSidebarHelpDismissed; },
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
      renderEditorBlock: (sectionKey, block) => editorRenderer.renderEditorBlock(sectionKey, block, state.document.sections),
      renderBlockContentEditor: (sectionKey, block) => editorRenderer.renderBlockContentEditor(sectionKey, block),
      renderComponentOptions: renderDocumentComponentOptions,
      renderReusableSectionOptions,
      getSectionDefs,
      renderBlockMetaFields: (sectionKey, block) => editorRenderer.renderBlockMetaFields(sectionKey, block),
    }
  );
}

function renderApp(options: { runDocumentHooks?: boolean } = {}): void {
  void options;
  if (!currentRoot) return;
  const root = currentRoot;
  const runtime = getActiveStateRuntime();
  const capturedScroll = captureRenderScroll(root, state.paneScroll);
  state.paneScroll = capturedScroll.paneScroll;
  applyTheme();
  const isEditor = state.currentView === 'editor';
  const isAi = state.currentView === 'ai';
  const isDocumentMetaView = isEditor && state.showAdvancedEditor && state.metaPanelOpen;
  const pdfDocument = isPdfDocument(state.document);
  const readerWarningsHtml = pdfDocument ? '' : readerRenderer.renderWarnings();
  const readerSidebarSectionsHtml = pdfDocument ? '' : readerRenderer.renderSidebarSections(state.document.sections);
  const hasViewerSidebar = Boolean(readerWarningsHtml.trim() || readerSidebarSectionsHtml.trim());
  capturePluginFocus();
  root.innerHTML = `
    <main class="layout hvy-embed-layout hvy-embed-full-layout">
      <div hidden>
        <button id="newBtn" type="button">New</button>
        <input id="fileInput" type="file" />
        <input id="downloadName" type="text" value="${escapeAttr(state.filename)}" />
        <button id="downloadBtn" type="button">Download</button>
        <button id="exportPdfBtn" type="button">Export PDF</button>
      </div>
      <section class="workspace-shell">
        <div class="${isEditor ? 'editor-pane' : 'reader-pane'} pane full-pane">
          ${
            isEditor
              ? isDocumentMetaView
                ? `<div class="document-meta-view">${editorRenderer.renderMetaPanel()}</div>`
                : `<div class="editor-shell ${isPdfDocument(state.document) ? 'has-no-sidebar' : state.editorSidebarOpen ? 'is-sidebar-open' : 'is-sidebar-closed'}">
                  ${isPdfDocument(state.document) ? '' : `<div class="editor-sidebar-backdrop" data-action="toggle-editor-sidebar"></div>
                    <aside class="editor-sidebar">
                      <button type="button" class="editor-sidebar-tab" data-action="toggle-editor-sidebar" aria-expanded="${state.editorSidebarOpen ? 'true' : 'false'}" aria-label="Toggle sidebar"><span class="sidebar-tab-hamburger" aria-hidden="true"></span></button>
                      ${editorRenderer.renderSidebarHelpBalloon(state.document.sections)}
                      <div class="editor-sidebar-panel">
                        ${editorRenderer.renderSidebarEditorSections(state.document.sections)}
                      </div>
                    </aside>`}
                  <div id="editorTree" class="editor-tree">${editorRenderer.renderSectionEditorTree(state.document.sections)}</div>
                </div>`
              : `<div class="viewer-shell ${isAi ? 'ai-view-shell ' : ''}${hasViewerSidebar ? (state.viewerSidebarOpen ? 'is-sidebar-open' : 'is-sidebar-closed') : 'has-no-sidebar'}">
                  ${hasViewerSidebar ? `<div class="viewer-sidebar-backdrop" data-action="toggle-viewer-sidebar"></div>
                    <aside class="viewer-sidebar">
                      <button type="button" class="viewer-sidebar-tab" data-action="toggle-viewer-sidebar" aria-expanded="${state.viewerSidebarOpen ? 'true' : 'false'}" aria-label="Toggle navigation">${renderSidebarTabLabel()}</button>
                      ${readerRenderer.renderSidebarHelpBalloon(state.document.sections)}
                      <div class="viewer-sidebar-panel">
                        <div id="readerWarnings" class="reader-warnings">${readerWarningsHtml}</div>
                        <div id="${isAi ? 'aiSidebarSections' : 'readerSidebarSections'}" class="reader-sidebar-sections hvy-reader-surface${isAi ? ' hvy-ai-reader-surface' : ''}">${readerSidebarSectionsHtml}</div>
                      </div>
                    </aside>` : ''}
                  <div id="${isAi ? 'aiReaderDocument' : 'readerDocument'}" class="reader-document hvy-reader-surface${isAi ? ' hvy-ai-reader-surface' : ''}">${readerRenderer.renderReaderSections(state.document.sections)}</div>
                  ${isAi ? `${renderAiModeHint(state, { escapeAttr, escapeHtml })}${renderAiEditPopover(state, { escapeAttr, escapeHtml, surface: 'embedded' })}` : ''}
                </div>`
          }
          ${
            isDocumentMetaView
              ? ''
              : `${renderChatPanel(
                  state.chat,
                  state.document,
                  { escapeAttr, escapeHtml },
                  state.currentView === 'viewer' ? 'qa' : 'document-edit',
                  state.currentView === 'editor' || state.currentView === 'ai',
                  'embedded'
                )}
                ${renderSearchLauncher(state.search)}
                ${renderSearchModal(state.search, state.document, { escapeAttr, escapeHtml, readerRenderer })}`
          }
        </div>
      </section>
      ${readerRenderer.renderModal()}
      ${readerRenderer.renderLinkInlineModal()}
      ${renderNewDocumentModal(state.newDocumentModalOpen, { escapeAttr, escapeHtml })}
    </main>`;
  bindEmbedUi(root, runtime);
  reconcilePluginMounts(root);
  restoreRenderScroll(root, capturedScroll);
  virtualizeRenderedSections({
    root,
    afterRestore: (scope) => {
      reconcilePluginMounts(scope, { prune: false });
      void runWithStateRuntime(runtime, () => runButtonVisibilityScripts(scope));
    },
  });
  observeRenderedLinks(root, currentLinkObserver);
  void runWithStateRuntime(runtime, () => runButtonVisibilityScripts(root));
}

function bindRuntimeActivation(root: HTMLElement, runtime: StateRuntime): void {
  root.addEventListener('click', () => activateStateRuntime(runtime), { capture: true });
  root.addEventListener('dblclick', () => activateStateRuntime(runtime), { capture: true });
  root.addEventListener('mousedown', () => activateStateRuntime(runtime), { capture: true });
  root.addEventListener('mouseup', () => activateStateRuntime(runtime), { capture: true });
  root.addEventListener('pointerdown', () => activateStateRuntime(runtime), { capture: true });
  root.addEventListener('pointerup', () => activateStateRuntime(runtime), { capture: true });
  root.addEventListener('contextmenu', () => activateStateRuntime(runtime), { capture: true });
  root.addEventListener('input', () => activateStateRuntime(runtime), { capture: true });
  root.addEventListener('change', () => activateStateRuntime(runtime), { capture: true });
  root.addEventListener('keydown', () => activateStateRuntime(runtime), { capture: true });
  root.addEventListener('keyup', () => activateStateRuntime(runtime), { capture: true });
  root.addEventListener('focusin', () => activateStateRuntime(runtime), { capture: true });
  root.addEventListener('submit', () => activateStateRuntime(runtime), { capture: true });
  root.addEventListener('dragstart', () => activateStateRuntime(runtime), { capture: true });
  root.addEventListener('dragover', () => activateStateRuntime(runtime), { capture: true });
  root.addEventListener('drop', () => activateStateRuntime(runtime), { capture: true });
}

function bindEmbedUi(root: HTMLElement, runtime: StateRuntime): void {
  const bindGeneration = (embedUiBindGenerations.get(root) ?? 0) + 1;
  embedUiBindGenerations.set(root, bindGeneration);
  if (state.currentView === 'viewer') {
    bindReaderUi(root);
    return;
  }
  void import('./bind-ui').then(({ bindUi }) => {
    if (embedUiBindGenerations.get(root) !== bindGeneration) {
      return;
    }
    runWithStateRuntime(runtime, () => {
      bindUi(root);
    });
  });
}

function cancelPendingEmbedUiBind(root: HTMLElement): void {
  embedUiBindGenerations.set(root, (embedUiBindGenerations.get(root) ?? 0) + 1);
}

function renderSidebarTabLabel(): string {
  const label = String(state.document.meta.sidebar_label || '\u2630');
  return label === '\u2630'
    ? '<span class="sidebar-tab-hamburger" aria-hidden="true"></span>'
    : `<span class="sidebar-tab-label">${escapeHtml(label)}</span>`;
}

function setPaletteOverrideId(id: string | null): void {
  const normalizedId = typeof id === 'string' && getPaletteById(id) ? id : null;
  state.paletteOverrideId = normalizedId;
  applyTheme();
  renderApp();
}

function setMountedSearchSnapshot(snapshot: HvySearchSnapshotInput | null, options: { render?: boolean } = {}): void {
  state.search.abortController?.abort();
  state.search = externalSearchSnapshotToDocumentState(snapshot, state.document);
  if (state.search.filterEnabled && state.currentView === 'editor') {
    state.currentView = 'viewer';
  }
  if (options.render ?? true) {
    refreshReaderPanels();
    renderApp();
  }
}

function openThemeEditor(options: { advanced?: boolean } = {}): void {
  state.themeModalOpen = true;
  state.themeModalMode = options.advanced ? 'advanced' : 'full';
  renderApp();
}

function mountThemeEditor(root: HTMLElement, options: { advanced?: boolean; includePalettePicker?: boolean } = {}): void {
  root.classList.add('hvy-document', 'hvy-theme-editor-host');
  setThemeRoot(currentRoot ?? root);
  const syncThemeStyles = () => {
    const source = currentRoot ?? root;
    const computed = window.getComputedStyle(source);
    for (const name of Object.keys(getThemeConfig().colors)) {
      root.style.setProperty(name, computed.getPropertyValue(name));
    }
    const palette = state.paletteOverrideId ? getPaletteById(state.paletteOverrideId) : null;
    if (palette) {
      for (const name of Object.keys(palette.colors)) {
        root.style.setProperty(name, computed.getPropertyValue(name));
      }
    }
  };
  const renderThemeEditor = () => {
    root.innerHTML = readerRenderer.renderThemeEditor({
      advanced: options.advanced ?? true,
      includePalettePicker: options.includePalettePicker ?? false,
      includeModalActions: false,
    });
    syncThemeStyles();
  };
  renderThemeEditor();
  bindClickActions(root);
  bindInputBlock(root);
  root.addEventListener('input', () => {
    window.setTimeout(syncThemeStyles, 0);
  });
  root.addEventListener('click', (event) => {
    const actionButton = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!actionButton) return;
    const action = actionButton.dataset.action ?? '';
    if (['theme-add-color', 'theme-remove-color', 'theme-reset-color', 'theme-apply-palette', 'theme-clear-palette-override'].includes(action)) {
      window.setTimeout(renderThemeEditor, 0);
    }
  });
}

function refreshReaderPanels(): void {
  if (!currentRoot) return;
  const runtime = getActiveStateRuntime();
  refreshReaderSurfaces({
    root: currentRoot,
    readerRenderer,
    sections: state.document.sections,
    capturePluginFocus,
    reconcilePluginMounts,
    runButtonVisibilityScripts: (root) => runWithStateRuntime(runtime, () => runButtonVisibilityScripts(root)),
  });
  virtualizeRenderedSections({
    root: currentRoot,
    afterRestore: (scope) => {
      reconcilePluginMounts(scope, { prune: false });
      void runWithStateRuntime(runtime, () => runButtonVisibilityScripts(scope));
    },
  });
  observeRenderedLinks(currentRoot, currentLinkObserver);
}

function setLinkObserver(observer: HvyLinkObserver | null): void {
  currentLinkObserver = observer;
  if (currentRoot) {
    resetObservedLinks(currentRoot);
    observeRenderedLinks(currentRoot, currentLinkObserver);
  }
}

async function buildImportPlan(options: BuildImportPlanOptions): Promise<BuildImportPlanResult> {
  return buildImportPlanForDocument(state.document, {
    ...options,
    llm: options.llm ?? { settings: state.chat.settings },
  });
}

async function importFromText(options: ImportFromTextOptions): Promise<ImportFromTextResult> {
  const refreshAfterImportMutation = async (): Promise<void> => {
    state.rawEditorText = serializeDocument(state.document);
    state.rawEditorError = null;
    state.rawEditorDiagnostics = [];
    renderApp({ runDocumentHooks: false });
  };
  const runPreparedImportHooks = async (): Promise<void> => {
    await runPluginDocumentHooks('ai-edit');
    await refreshAfterImportMutation();
  };
  const result = await importTextIntoDocument(state.document, {
    ...options,
    llm: options.llm ?? { settings: state.chat.settings },
    onProgress: (event) => {
      if (event.phase !== 'complete') {
        options.onProgress?.(event);
      }
    },
    onMutation: (group) => recordHistory(group ?? 'import:text'),
    onSectionApplied: refreshAfterImportMutation,
    onImportFillInsApplied: refreshAfterImportMutation,
    onImportXrefsApplied: refreshAfterImportMutation,
    onImportPrepared: runPreparedImportHooks,
    onImportFinalized: refreshAfterImportMutation,
  });
  if (result.status !== 'complete') {
    return result;
  }
  options.onProgress?.({ phase: 'linting', message: 'Checking imported HVY document.' });
  freshLoadMountedDocumentInPlace();
  const serialized = serializeDocument(state.document);
  state.rawEditorText = serialized;
  const diagnostics = deserializeDocumentWithDiagnostics(serialized, state.document.extension).diagnostics;
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  if (errors.length > 0) {
    resetTransientUiState();
    renderApp();
    return {
      status: 'error',
      message: errors.map((diagnostic) => diagnostic.message).join(' '),
    };
  }
  resetTransientUiState();
  renderApp();
  options.onProgress?.({ phase: 'complete', message: result.message ?? 'Import complete.' });
  return result;
}

function freshLoadMountedDocumentInPlace(): void {
  const parsed = deserializeDocumentBytes(serializeDocumentBytes(state.document), state.document.extension);
  state.document.meta = parsed.meta;
  state.document.sections.splice(0, state.document.sections.length, ...parsed.sections);
  state.document.attachments = parsed.attachments;
}

function refreshModalPreview(): void {}

function ensureEmbedRuntime(
  plugins: HvyPlugin[],
  runtime: StateRuntime,
  root: HTMLElement,
  getLinkObserver: () => HvyLinkObserver | null
): void {
  ensureRenderers();
  initCallbacks({
    renderApp: () => runWithStateRuntime(runtime, () => {
      currentRoot = root;
      currentLinkObserver = getLinkObserver();
      setThemeRoot(root);
      renderApp();
    }),
    refreshReaderPanels: () => runWithStateRuntime(runtime, () => {
      currentRoot = root;
      currentLinkObserver = getLinkObserver();
      refreshReaderPanels();
    }),
    refreshModalPreview: () => runWithStateRuntime(runtime, () => {
      currentRoot = root;
      currentLinkObserver = getLinkObserver();
      refreshModalPreview();
    }),
    componentRenderHelpers: localGetComponentRenderHelpers(),
    readerRenderer,
  });
  setHostPlugins(plugins);
  resetPluginDocumentHookState();
  initColorModeSync();
}

export function mountHvy(options: HvyMountOptions): HvyMount {
  const sessionStorageKey = options.storageKey ?? null;
  const initialState = createEmbedState(
    options.document,
    options.mode ?? 'viewer',
    options.showAdvancedEditor ?? false,
    options.imageAttachmentMaxDimensions,
    sessionStorageKey
  );
  const runtime = createStateRuntime(applyEmbeddedSessionState(
    initialState,
    options.storageKey ? loadSessionState(options.storageKey) : null
  ));
  let linkObserver = options.linkObserver ?? null;
  activateStateRuntime(runtime);
  const sessionPersistence = options.storageKey ? bindSessionPersistence(runtime) : null;
  currentRoot = options.root;
  options.root.classList.add('hvy-document');
  setThemeRoot(options.root);
  currentLinkObserver = linkObserver;
  if (options.paletteId && getPaletteById(options.paletteId)) {
    state.paletteOverrideId = options.paletteId;
  }
  if ('searchSnapshot' in options) {
    setMountedSearchSnapshot(options.searchSnapshot ?? null, { render: false });
  }
  setHostChatClient(options.chatClient ?? window.HVY_CHAT_CLIENT ?? null);
  if ('semanticFilterProvider' in options) {
    setRuntimeSemanticFilterProvider(options.semanticFilterProvider ?? null);
  }
  bindRuntimeActivation(options.root, runtime);
  ensureEmbedRuntime(options.plugins ?? builtInPlugins, runtime, options.root, () => linkObserver);
  initDocumentChangeTracking(runtime, options.onDocumentChange);
  runtime.callbacks.renderApp();
  void runPluginDocumentHooks('load');
  return {
    destroy() {
      runWithStateRuntime(runtime, () => {
        cancelPendingEmbedUiBind(options.root);
        options.root.innerHTML = '';
        setHostChatClient(null);
        setRuntimeSemanticFilterProvider(null);
        setHostPlugins([]);
        resetPluginDocumentHookState();
        sessionPersistence?.abort();
        if (currentRoot === options.root) {
          currentRoot = null;
          currentLinkObserver = null;
          setThemeRoot(null);
        }
      });
    },
    getDocument() {
      return runWithStateRuntime(runtime, () => state.document);
    },
    serializeDocumentBytes() {
      return runWithStateRuntime(runtime, () => serializeDocumentBytes(state.document));
    },
    getPdfBlob(pdfOptions) {
      return runWithStateRuntimeAsync(runtime, async () => {
        const { getHvyPdfBlob } = await import('./pdf-export/export');
        return getHvyPdfBlob(state.document, pdfOptions);
      });
    },
    exportPdf(pdfOptions) {
      return runWithStateRuntimeAsync(runtime, async () => {
        const { exportHvyPdf } = await import('./pdf-export/export');
        return exportHvyPdf(state.document, pdfOptions);
      });
    },
    markSaved() {
      markDocumentSaved(runtime);
    },
    isDirty() {
      return isDocumentDirty(runtime);
    },
    undo() {
      runWithStateRuntime(runtime, () => undoState());
    },
    redo() {
      runWithStateRuntime(runtime, () => redoState());
    },
    buildImportPlan(importOptions) {
      return runWithStateRuntimeAsync(runtime, () => buildImportPlan(importOptions));
    },
    importFromText(importOptions) {
      return runWithStateRuntimeAsync(runtime, () => importFromText(importOptions));
    },
    setLinkObserver(observer) {
      runWithStateRuntime(runtime, () => {
        linkObserver = observer;
        currentRoot = options.root;
        currentLinkObserver = linkObserver;
        setLinkObserver(observer);
      });
    },
    setPaletteOverrideId(id) {
      runWithStateRuntime(runtime, () => {
        currentRoot = options.root;
        currentLinkObserver = linkObserver;
        setThemeRoot(options.root);
        setPaletteOverrideId(id);
      });
    },
    setSearchSnapshot(snapshot) {
      runWithStateRuntime(runtime, () => {
        currentRoot = options.root;
        currentLinkObserver = linkObserver;
        setThemeRoot(options.root);
        setMountedSearchSnapshot(snapshot);
      });
    },
    getSearchSnapshot() {
      return runWithStateRuntime(runtime, () => searchStateToSnapshot(state.search));
    },
    getRecoveryState() {
      return runWithStateRuntime(runtime, () => createRecoveryStatePayload(state));
    },
    applyRecoveryState(payload) {
      runWithStateRuntime(runtime, () => {
        applyRecoveryStatePayload(state, payload);
        runtime.callbacks.renderApp();
      });
    },
    openDocumentMeta() {
      return runWithStateRuntime(runtime, () => {
        state.currentView = 'editor';
        state.editorMode = 'advanced';
        state.showAdvancedEditor = true;
        state.metaPanelOpen = true;
        runtime.callbacks.renderApp();
        return state.metaPanelOpen;
      });
    },
    openThemeEditor(themeOptions = {}) {
      runWithStateRuntime(runtime, () => openThemeEditor(themeOptions));
    },
    mountThemeEditor(root, themeOptions = {}) {
      runWithStateRuntime(runtime, () => mountThemeEditor(root, themeOptions));
    },
  };
}

export function mountHvyViewer(options: Omit<HvyMountOptions, 'mode'>): HvyMount {
  return mountHvy({ ...options, mode: 'viewer' });
}

export {
  builtInPluginMap as plugins,
  builtInPlugins,
  createDocumentFilterSnapshot,
  createDocumentSearchSnapshot,
  createPdfExportPlan,
  createPdfExportPlanFromPrompt,
  deserializeDocumentBytes,
  getPdfExportPromptTemplates,
  renderPdfExportPromptTemplate,
  searchDocuments,
  serializeDocument,
  serializeDocumentBytes,
};
export type { HvyLinkObserver, HvyLinkObserverRequest, HvyLinkObserverResponse } from './link-observer';
export type { HvyDocumentFilterSnapshotRequest } from './search/document-filter';
export type {
  BuildImportPlanOptions,
  BuildImportPlanResult,
  HvyImportLlmStepEvent,
  HvyImportLlmOptions,
  HvyImportProgressEvent,
  HvyImportProgressPhase,
  ImportFromTextOptions,
  ImportFromTextResult,
  ImportPlanStep,
  ImportPlanStepInput,
  ImportPlanTarget,
  ImportPlanTargetKind,
} from './ai-document-edit';
export type { ImageAttachmentMaxDimensions, ToolLoopCompactionOptions } from './types';
export type { HvyDocumentChangeCallback, HvyDocumentChangeEvent, HvyDocumentChangeSource } from './document-change';
export type {
  HvyPdfExportOptions,
  HvyPdfExportPlan,
  HvyPdfExportPlanDecision,
  HvyPdfExportPlanDiagnostic,
  HvyPdfExportPreviewStats,
  HvyPdfExportPromptTemplate,
  HvyPdfExportPromptTemplateVariable,
  HvyPdfExportResult,
  HvyPdfExportStrategy,
  HvyPdfExportStrategyProvider,
  HvyPdfExportStrategyProviderRequest,
  HvyPdfExportStrategyProviderResponse,
  HvyPdfExportStrategyRule,
  CreatePdfExportPlanOptions,
  CreatePdfExportPlanFromPromptOptions,
} from './pdf-export/types';
export type {
  HvyDocumentSearchDocument,
  HvyDocumentSearchMode,
  HvyDocumentSearchRequest,
  HvyDocumentSearchResponse,
  HvyDocumentSearchResult,
  HvyDocumentSearchSnapshot,
  HvySemanticFilterCandidate,
  HvySemanticFilterCandidateBudget,
  HvySemanticFilterMatch,
  HvySemanticFilterProvider,
  HvySemanticFilterRequest,
  HvySearchSnapshot,
  HvySearchSnapshotInput,
} from './search/types';

window.HVY = {
  deserializeDocumentBytes,
  serializeDocument,
  serializeDocumentBytes,
  createDocumentFilterSnapshot,
  createPdfExportPlan,
  createPdfExportPlanFromPrompt,
  createDocumentSearchSnapshot,
  getPdfExportPromptTemplates,
  renderPdfExportPromptTemplate,
  searchDocuments,
  mountHvy,
  mountHvyViewer,
  plugins: builtInPluginMap,
  builtInPlugins,
};
