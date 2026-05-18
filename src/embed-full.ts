import './default-theme.css';
import './host-overrides.css';
import './style.css';
import 'highlight.js/styles/github.css';

import { createEditorRenderer, type EditorRenderer } from './editor/render';
import { createReaderRenderer, type ReaderRenderer } from './reader/render';
import { state, initState, initCallbacks } from './state';
import type { AppState, VisualDocument } from './types';
import { deserializeDocumentBytes, serializeDocument } from './serialization';
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
import { renderAiEditPopover, renderAiModeHint } from './ai-mode-ui';
import { createDefaultSearchState } from './search/state';
import { renderSearchLauncher, renderSearchPalette } from './search/render';
import { loadPaletteOverrideId } from './palettes/palette-preferences';
import { captureRenderScroll, restoreRenderScroll } from './render-scroll';
import { observeRenderedLinks, resetObservedLinks, type HvyLinkObserver } from './link-observer';
import { recordHistory } from './history';
import { resetTransientUiState } from './navigation';
import { refreshReaderSurfaces } from './reader/refresh-surfaces';
import {
  buildImportPlanForDocument,
  importTextIntoDocument,
  type BuildImportPlanOptions,
  type BuildImportPlanResult,
  type ImportFromTextOptions,
  type ImportFromTextResult,
} from './ai-document-edit';

export type HvyEmbedMode = 'viewer' | 'editor' | 'ai';

export interface HvyMountOptions {
  root: HTMLElement;
  document: VisualDocument;
  mode?: HvyEmbedMode;
  plugins?: HvyPlugin[];
  showAdvancedEditor?: boolean;
  chatClient?: HostChatClient | null;
  linkObserver?: HvyLinkObserver | null;
  controls?: boolean;
  paletteId?: string | null;
}

export interface HvyMount {
  destroy(): void;
  getDocument(): VisualDocument;
  buildImportPlan(options: BuildImportPlanOptions): Promise<BuildImportPlanResult>;
  importFromText(options: ImportFromTextOptions): Promise<ImportFromTextResult>;
  setLinkObserver(observer: HvyLinkObserver | null): void;
  setPaletteOverrideId(id: string | null): void;
  openThemeEditor(options?: { advanced?: boolean }): void;
  mountThemeEditor(root: HTMLElement, options?: { advanced?: boolean; includePalettePicker?: boolean }): void;
}

let editorRenderer: EditorRenderer;
let readerRenderer: ReaderRenderer;
let currentRoot: HTMLElement | null = null;
let currentLinkObserver: HvyLinkObserver | null = null;

function createEmbedState(document: VisualDocument, mode: HvyEmbedMode, showAdvancedEditor = false): AppState {
  return {
    document,
    filename: document.extension === '.thvy' ? 'resume.thvy' : 'resume.hvy',
    selectedExample: 'default',
    currentView: mode,
    editorMode: 'basic',
    responsivePreview: 'full',
    chat: createDefaultChatState(),
    aiModeTipDismissed: false,
    search: createDefaultSearchState(),
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
    reusableSaveModal: null,
    reusableTemplateModal: null,
    sectionTemplateFlavorModal: null,
    tempHighlights: new Set<string>(),
    addComponentBySection: {},
    metaPanelOpen: false,
    openTextLineStyleName: null,
    descriptionPopulate: { isRunning: false, status: null, completed: 0, total: 0, current: '', skippedLeaves: 0, lastGenerated: '' },
    selectedReusableComponentName: null,
    templateValues: {},
    history: [],
    future: [],
    isRestoring: false,
    componentMetaModal: null,
    sqliteRowComponentModal: null,
    dbTableQueryModal: null,
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

function localGetComponentRenderHelpers() {
  return getComponentRenderHelpers(editorRenderer, readerRenderer);
}

function ensureRenderers(): void {
  if (editorRenderer && readerRenderer) return;
  editorRenderer = createEditorRenderer(
    {
      get documentMeta() { return state.document.meta as Record<string, unknown>; },
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
      renderComponentOptions,
      renderReusableSectionOptions,
      getSectionDefs,
      renderBlockMetaFields: (sectionKey, block) => editorRenderer.renderBlockMetaFields(sectionKey, block),
    }
  );
}

function renderApp(): void {
  if (!currentRoot) return;
  const capturedScroll = captureRenderScroll(currentRoot, state.paneScroll);
  state.paneScroll = capturedScroll.paneScroll;
  applyTheme();
  const isEditor = state.currentView === 'editor';
  const isAi = state.currentView === 'ai';
  capturePluginFocus();
  currentRoot.innerHTML = `
    <main class="layout hvy-embed-layout">
      <div hidden>
        <button id="newBtn" type="button">New</button>
        <input id="fileInput" type="file" />
        <input id="downloadName" type="text" value="${escapeAttr(state.filename)}" />
        <button id="downloadBtn" type="button">Download</button>
      </div>
      <section class="workspace-shell">
        <div class="${isEditor ? 'editor-pane' : 'reader-pane'} pane full-pane">
          ${
            isEditor
              ? `<div class="editor-shell ${state.editorSidebarOpen ? 'is-sidebar-open' : 'is-sidebar-closed'}">
                  <div class="editor-sidebar-backdrop" data-action="toggle-editor-sidebar"></div>
                  <aside class="editor-sidebar">
                    <button type="button" class="editor-sidebar-tab" data-action="toggle-editor-sidebar" aria-expanded="${state.editorSidebarOpen ? 'true' : 'false'}" aria-label="Toggle sidebar"><span class="sidebar-tab-hamburger" aria-hidden="true"></span></button>
                    ${editorRenderer.renderSidebarHelpBalloon(state.document.sections)}
                    <div class="editor-sidebar-panel">
                      ${editorRenderer.renderSidebarEditorSections(state.document.sections)}
                    </div>
                  </aside>
                  <div id="editorTree" class="editor-tree">${editorRenderer.renderSectionEditorTree(state.document.sections)}</div>
                </div>`
              : `<div class="viewer-shell ${isAi ? 'ai-view-shell ' : ''}${state.viewerSidebarOpen ? 'is-sidebar-open' : 'is-sidebar-closed'}">
                  <div class="viewer-sidebar-backdrop" data-action="toggle-viewer-sidebar"></div>
                  <aside class="viewer-sidebar">
                    <button type="button" class="viewer-sidebar-tab" data-action="toggle-viewer-sidebar" aria-expanded="${state.viewerSidebarOpen ? 'true' : 'false'}" aria-label="Toggle navigation">${renderSidebarTabLabel()}</button>
                    ${readerRenderer.renderSidebarHelpBalloon(state.document.sections)}
                    <div class="viewer-sidebar-panel">
                      <div id="readerWarnings" class="reader-warnings">${readerRenderer.renderWarnings()}</div>
                      <div id="${isAi ? 'aiSidebarSections' : 'readerSidebarSections'}" class="reader-sidebar-sections hvy-reader-surface${isAi ? ' hvy-ai-reader-surface' : ''}">${readerRenderer.renderSidebarSections(state.document.sections)}</div>
                    </div>
                  </aside>
                  <div id="${isAi ? 'aiReaderDocument' : 'readerDocument'}" class="reader-document hvy-reader-surface${isAi ? ' hvy-ai-reader-surface' : ''}">${readerRenderer.renderReaderSections(state.document.sections)}</div>
                  ${isAi ? `${renderAiModeHint(state, { escapeAttr, escapeHtml })}${renderAiEditPopover(state, { escapeAttr, escapeHtml, surface: 'embedded' })}` : ''}
                </div>`
          }
          ${renderChatPanel(
            state.chat,
            state.document,
            { escapeAttr, escapeHtml },
            state.currentView === 'viewer' ? 'qa' : 'document-edit',
            state.currentView === 'editor' || state.currentView === 'ai',
            'embedded'
          )}
          ${renderSearchLauncher(state.search)}
          ${renderSearchPalette(state.search, state.document, { escapeAttr, escapeHtml, readerRenderer })}
        </div>
      </section>
      ${readerRenderer.renderModal()}
      ${readerRenderer.renderLinkInlineModal()}
    </main>`;
  bindEmbedUi(currentRoot);
  reconcilePluginMounts(currentRoot);
  restoreRenderScroll(currentRoot, capturedScroll);
  observeRenderedLinks(currentRoot, currentLinkObserver);
  void runButtonVisibilityScripts(currentRoot);
  void runPluginDocumentHooks('unknown');
}

function bindEmbedUi(root: HTMLElement): void {
  if (state.currentView === 'viewer') {
    bindReaderUi(root);
    return;
  }
  void import('./bind-ui').then(({ bindUi }) => {
    if (currentRoot === root) {
      bindUi(root);
    }
  });
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
  refreshReaderSurfaces({
    root: currentRoot,
    readerRenderer,
    sections: state.document.sections,
    capturePluginFocus,
    reconcilePluginMounts,
    runButtonVisibilityScripts,
  });
  observeRenderedLinks(currentRoot, currentLinkObserver);
  void runPluginDocumentHooks('unknown');
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
    await runPluginDocumentHooks('ai-edit');
    state.rawEditorText = serializeDocument(state.document);
    state.rawEditorError = null;
    state.rawEditorDiagnostics = [];
    renderApp();
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
  const parsed = deserializeDocumentWithDiagnostics(serializeDocument(state.document), state.document.extension);
  state.document.meta = parsed.document.meta;
  state.document.sections.splice(0, state.document.sections.length, ...parsed.document.sections);
  state.document.attachments = parsed.document.attachments;
}

function refreshModalPreview(): void {}

function ensureEmbedRuntime(plugins: HvyPlugin[]): void {
  ensureRenderers();
  initCallbacks({
    renderApp,
    refreshReaderPanels,
    refreshModalPreview,
    componentRenderHelpers: localGetComponentRenderHelpers(),
    readerRenderer,
  });
  setHostPlugins([...builtInPlugins, ...plugins]);
  resetPluginDocumentHookState();
  initColorModeSync();
}

export function mountHvy(options: HvyMountOptions): HvyMount {
  currentRoot = options.root;
  options.root.classList.add('hvy-document');
  setThemeRoot(options.root);
  initState(createEmbedState(options.document, options.mode ?? 'viewer', options.showAdvancedEditor ?? false));
  currentLinkObserver = options.linkObserver ?? null;
  if (options.paletteId && getPaletteById(options.paletteId)) {
    state.paletteOverrideId = options.paletteId;
  }
  setHostChatClient(options.chatClient ?? window.HVY_CHAT_CLIENT ?? null);
  ensureEmbedRuntime(options.plugins ?? []);
  renderApp();
  return {
    destroy() {
      options.root.innerHTML = '';
      setHostChatClient(null);
      setHostPlugins([]);
      resetPluginDocumentHookState();
      if (currentRoot === options.root) {
        currentRoot = null;
        currentLinkObserver = null;
        setThemeRoot(null);
      }
    },
    getDocument() {
      return state.document;
    },
    buildImportPlan,
    importFromText,
    setLinkObserver,
    setPaletteOverrideId,
    openThemeEditor,
    mountThemeEditor,
  };
}

export function mountHvyViewer(options: Omit<HvyMountOptions, 'mode'>): HvyMount {
  return mountHvy({ ...options, mode: 'viewer' });
}

export { builtInPluginMap as plugins, builtInPlugins, deserializeDocumentBytes, serializeDocument };
export type { HvyLinkObserver, HvyLinkObserverRequest, HvyLinkObserverResponse } from './link-observer';
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
export type { ToolLoopCompactionOptions } from './types';

declare global {
  interface Window {
    HVY?: {
      deserializeDocumentBytes: typeof deserializeDocumentBytes;
      serializeDocument: typeof serializeDocument;
      mountHvy: typeof mountHvy;
      mountHvyViewer: typeof mountHvyViewer;
      plugins: typeof builtInPluginMap;
      builtInPlugins: typeof builtInPlugins;
    };
    HVY_CHAT_CLIENT?: HostChatClient;
  }
}

window.HVY = {
  deserializeDocumentBytes,
  serializeDocument,
  mountHvy,
  mountHvyViewer,
  plugins: builtInPluginMap,
  builtInPlugins,
};
