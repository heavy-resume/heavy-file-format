import './default-theme.css';
import './host-overrides.css';
import './style.css';

import { createReaderRenderer, type ReaderRenderer } from './reader/render';
import { initCallbacks, initState, state } from './state';
import type { AppState, ChatProvider, VisualDocument } from './types';
import { deserializeDocumentBytes, serializeDocument } from './serialization';
import { escapeAttr, escapeHtml } from './utils';
import { applyTheme, getThemeConfig, initColorModeSync as syncColorMode, setThemeRoot } from './theme';
import { getPaletteById } from './palettes/palette-registry';
import {
  findDuplicateSectionIds,
  findSectionByKey,
  flattenSections,
  formatSectionTitle,
  getSectionId,
} from './section-ops';
import {
  findBlockByIds,
  getComponentRenderHelpers,
} from './block-ops';
import {
  ensureExpandableBlocks,
  ensureGridItems,
} from './document-factory';
import { resolveBaseComponent } from './component-defs';
import { bindReaderUi } from './bind-reader-ui';
import { capturePluginFocus, reconcilePluginMounts } from './plugins/mount';
import { setHostPlugins } from './plugins/registry';
import { resetPluginDocumentHookState, runPluginDocumentHooks } from './plugins/hooks';
import {
  builtInPluginMap,
  builtInPlugins,
} from 'virtual:hvy-built-in-plugins';
import { loadPaletteOverrideId } from './palettes/palette-preferences';
import { captureRenderScroll, restoreRenderScroll } from './render-scroll';
import { observeRenderedLinks, resetObservedLinks, type HvyLinkObserver } from './link-observer';
import { recordHistory } from './history';
import type { HvyPlugin } from './plugins/types';
import type { HostChatClient } from './chat/chat';
import type {
  BuildImportPlanOptions,
  BuildImportPlanResult,
  ImportFromTextOptions,
  ImportFromTextResult,
} from './ai-document-edit';
import { markdownToReaderHtml, normalizeMarkdownIndentation, normalizeMarkdownLists } from './markdown';
import { removeTextFillInMarkers } from './text-fill-in';

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

type FullEmbedModule = typeof import('./embed-full');

let readerRenderer: ReaderRenderer | null = null;
let currentRoot: HTMLElement | null = null;
let currentLinkObserver: HvyLinkObserver | null = null;

function createDefaultChatState(): AppState['chat'] {
  return {
    settings: {
      provider: 'openai' as ChatProvider,
      model: 'gpt-5.4-mini',
    },
    draft: '',
    messages: [],
    isSending: false,
    error: null,
    panelOpen: false,
    requestNonce: 0,
    abortController: null,
    cliSimEnabled: false,
    cliSim: null,
  };
}

function createDefaultSearchState(): AppState['search'] {
  return {
    open: false,
    queryDraft: '',
    submittedQuery: '',
    caseSensitive: false,
    categories: {
      tags: true,
      contents: true,
      description: true,
    },
    activeTab: 'search',
    filterEnabled: false,
    filterMode: 'deprioritize',
    resultsCollapsed: false,
    activeResultId: null,
    isLoading: false,
    error: null,
    results: [],
    navigationResultIds: [],
    clearedSectionKeys: [],
    clearedBlockIds: [],
    requestNonce: 0,
    abortController: null,
  };
}

function createEmbedState(document: VisualDocument, showAdvancedEditor = false): AppState {
  return {
    document,
    filename: document.extension === '.thvy' ? 'resume.thvy' : 'resume.hvy',
    selectedExample: 'default',
    currentView: 'viewer',
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
  if (!readerRenderer) {
    throw new Error('HVY reader renderer is not initialized.');
  }
  return getComponentRenderHelpers(
    {
      renderRichToolbar: () => '',
      renderEditorBlock: () => '',
      renderPassiveEditorBlock: () => '',
      renderComponentFragment,
      renderComponentPlacementTarget: () => '',
    },
    readerRenderer
  );
}

function renderComponentFragment(componentName: string, content: string, block: { schema: { codeLanguage?: string; fillIn?: boolean } }): string {
  if (componentName === 'code') {
    const language = block.schema.codeLanguage?.trim() || 'text';
    return `<pre class="code-reader"><code data-language="${escapeAttr(language)}">${escapeHtml(content)}</code></pre>`;
  }
  const source = componentName === 'text' && block.schema.fillIn ? removeTextFillInMarkers(content) : content;
  const normalized = normalizeMarkdownIndentation(normalizeMarkdownLists(source));
  return markdownToReaderHtml(normalized);
}

function ensureReaderRenderer(): ReaderRenderer {
  if (readerRenderer) {
    return readerRenderer;
  }
  readerRenderer = createReaderRenderer(
    {
      get documentMeta() { return state.document.meta; },
      get documentSections() { return state.document.sections; },
      get addComponentBySection() { return state.addComponentBySection; },
      get tempHighlights() { return state.tempHighlights; },
      get aiEditTarget() { return { sectionKey: null, blockId: null }; },
      get contextMenu() { return null; },
      get activeEditorBlock() { return null; },
      get aiEditorHostBlock() { return null; },
      get aiEditorHostSectionKey() { return null; },
      get modalSectionKey() { return null; },
      get sqliteRowComponentModal() { return state.sqliteRowComponentModal; },
      get dbTableQueryModal() { return state.dbTableQueryModal; },
      get reusableSaveModal() { return null; },
      get reusableTemplateModal() { return null; },
      get sectionTemplateFlavorModal() { return null; },
      get componentMetaModal() { return null; },
      get themeModalOpen() { return false; },
      get themeModalMode() { return 'full' as const; },
      get paletteOverrideId() { return state.paletteOverrideId; },
      get theme() { return getThemeConfig(); },
      get currentView() { return 'viewer' as const; },
      get showAdvancedEditor() { return false; },
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
      renderEditorBlock: () => '',
      renderBlockContentEditor: () => '',
      renderComponentOptions: () => '',
      renderReusableSectionOptions: () => '',
      getSectionDefs: () => [],
      renderBlockMetaFields: () => '',
    }
  );
  return readerRenderer;
}

function renderSidebarTabLabel(): string {
  const label = String(state.document.meta.sidebar_label || '\u2630');
  return label === '\u2630'
    ? '<span class="sidebar-tab-hamburger" aria-hidden="true"></span>'
    : `<span class="sidebar-tab-label">${escapeHtml(label)}</span>`;
}

function renderApp(): void {
  if (!currentRoot) return;
  const renderer = ensureReaderRenderer();
  const capturedScroll = captureRenderScroll(currentRoot, state.paneScroll);
  state.paneScroll = capturedScroll.paneScroll;
  applyTheme();
  capturePluginFocus();
  currentRoot.innerHTML = `
    <main class="layout hvy-embed-layout">
      <section class="workspace-shell">
        <div class="reader-pane pane full-pane">
          <div class="viewer-shell ${state.viewerSidebarOpen ? 'is-sidebar-open' : 'is-sidebar-closed'}">
            <div class="viewer-sidebar-backdrop" data-action="toggle-viewer-sidebar"></div>
            <aside class="viewer-sidebar">
              <button type="button" class="viewer-sidebar-tab" data-action="toggle-viewer-sidebar" aria-expanded="${state.viewerSidebarOpen ? 'true' : 'false'}" aria-label="Toggle navigation">${renderSidebarTabLabel()}</button>
              ${renderer.renderSidebarHelpBalloon(state.document.sections)}
              <div class="viewer-sidebar-panel">
                <div id="readerWarnings" class="reader-warnings">${renderer.renderWarnings()}</div>
                <div id="readerSidebarSections" class="reader-sidebar-sections hvy-reader-surface">${renderer.renderSidebarSections(state.document.sections)}</div>
              </div>
            </aside>
            <div id="readerDocument" class="reader-document hvy-reader-surface">${renderer.renderReaderSections(state.document.sections)}</div>
          </div>
        </div>
      </section>
    </main>`;
  bindReaderUi(currentRoot);
  reconcilePluginMounts(currentRoot);
  restoreRenderScroll(currentRoot, capturedScroll);
  observeRenderedLinks(currentRoot, currentLinkObserver);
  void runButtonVisibilityScriptsIfNeeded(currentRoot);
  void runPluginDocumentHooks('unknown');
}

function refreshReaderPanels(): void {
  if (!currentRoot) return;
  const renderer = ensureReaderRenderer();
  const reader = currentRoot.querySelector<HTMLDivElement>('#readerDocument');
  if (!reader) return;
  capturePluginFocus();
  reader.innerHTML = renderer.renderReaderSections(state.document.sections);
  reconcilePluginMounts(reader);
  observeRenderedLinks(currentRoot, currentLinkObserver);
  void runButtonVisibilityScriptsIfNeeded(reader);
  void runPluginDocumentHooks('unknown');
}

function refreshModalPreview(): void {}

async function runButtonVisibilityScriptsIfNeeded(root: ParentNode): Promise<void> {
  if (!root.querySelector('[data-hvy-dynamic-visibility="true"], [data-hvy-button="true"]')) {
    return;
  }
  const { runButtonVisibilityScripts } = await import('./editor/components/button/button-actions');
  await runButtonVisibilityScripts(root);
}

function ensureEmbedRuntime(plugins: HvyPlugin[]): void {
  const renderer = ensureReaderRenderer();
  initCallbacks({
    renderApp,
    refreshReaderPanels,
    refreshModalPreview,
    componentRenderHelpers: localGetComponentRenderHelpers(),
    readerRenderer: renderer,
  });
  setHostPlugins([...builtInPlugins, ...plugins]);
  resetPluginDocumentHookState();
  syncColorMode();
}

function setLinkObserver(observer: HvyLinkObserver | null): void {
  currentLinkObserver = observer;
  if (currentRoot) {
    resetObservedLinks(currentRoot);
    observeRenderedLinks(currentRoot, currentLinkObserver);
  }
}

function setPaletteOverrideId(id: string | null): void {
  const normalizedId = typeof id === 'string' && getPaletteById(id) ? id : null;
  state.paletteOverrideId = normalizedId;
  applyTheme();
  renderApp();
}

async function loadFullEmbed(): Promise<FullEmbedModule> {
  return import('./embed-full');
}

function mountFullHvyProxy(options: HvyMountOptions): HvyMount {
  let mounted: HvyMount | null = null;
  const pending: Array<(mount: HvyMount) => void> = [];
  options.root.classList.add('hvy-document');
  options.root.innerHTML = '<main class="layout hvy-embed-layout"><section class="pane full-pane"><p>Loading HVY...</p></section></main>';
  const ready = loadFullEmbed().then((module) => {
    mounted = module.mountHvy(options);
    for (const action of pending.splice(0)) {
      action(mounted);
    }
    return mounted;
  });
  const withMount = (action: (mount: HvyMount) => void): void => {
    if (mounted) {
      action(mounted);
    } else {
      pending.push(action);
    }
  };
  const renderQueuedThemeModal = (): void => {
    if (mounted || options.root.querySelector('.modal-root')) {
      return;
    }
    options.root.insertAdjacentHTML('beforeend', `
      <div class="modal-root" style="isolation: isolate; z-index: var(--hvy-modal-root-z, 1200);">
        <div class="modal-overlay" style="z-index: var(--hvy-modal-overlay-z, 1);"></div>
        <div class="modal-panel" style="z-index: var(--hvy-modal-panel-z, 2);"></div>
      </div>
    `);
  };
  return {
    destroy() {
      if (mounted) {
        mounted.destroy();
      } else {
        pending.length = 0;
        options.root.innerHTML = '';
      }
    },
    getDocument() {
      return mounted?.getDocument() ?? options.document;
    },
    buildImportPlan(importOptions) {
      return ready.then((mount) => mount.buildImportPlan(importOptions));
    },
    importFromText(importOptions) {
      return ready.then((mount) => mount.importFromText(importOptions));
    },
    setLinkObserver(observer) {
      withMount((mount) => mount.setLinkObserver(observer));
    },
    setPaletteOverrideId(id) {
      withMount((mount) => mount.setPaletteOverrideId(id));
    },
    openThemeEditor(themeOptions) {
      renderQueuedThemeModal();
      withMount((mount) => mount.openThemeEditor(themeOptions));
    },
    mountThemeEditor(root, themeOptions) {
      withMount((mount) => mount.mountThemeEditor(root, themeOptions));
    },
  };
}

async function buildImportPlan(options: BuildImportPlanOptions): Promise<BuildImportPlanResult> {
  const { buildImportPlanForDocument } = await import('./ai-document-edit');
  return buildImportPlanForDocument(state.document, {
    ...options,
    llm: options.llm ?? { settings: state.chat.settings },
  });
}

async function importFromText(options: ImportFromTextOptions): Promise<ImportFromTextResult> {
  const { deserializeDocumentWithDiagnostics } = await import('./serialization');
  const { importTextIntoDocument } = await import('./ai-document-edit');
  const result = await importTextIntoDocument(state.document, {
    ...options,
    llm: options.llm ?? { settings: state.chat.settings },
    onProgress: (event) => {
      if (event.phase !== 'complete') {
        options.onProgress?.(event);
      }
    },
    onMutation: (group) => recordHistory(group ?? 'import:text'),
  });
  if (result.status !== 'complete') {
    return result;
  }
  options.onProgress?.({ phase: 'linting', message: 'Checking imported HVY document.' });
  const serialized = serializeDocument(state.document);
  state.rawEditorText = serialized;
  const diagnostics = deserializeDocumentWithDiagnostics(serialized, state.document.extension).diagnostics;
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  if (errors.length > 0) {
    renderApp();
    return {
      status: 'error',
      message: errors.map((diagnostic) => diagnostic.message).join(' '),
    };
  }
  renderApp();
  options.onProgress?.({ phase: 'complete', message: result.message ?? 'Import complete.' });
  return result;
}

export function mountHvy(options: HvyMountOptions): HvyMount {
  if ((options.mode ?? 'viewer') !== 'viewer') {
    return mountFullHvyProxy(options);
  }
  currentRoot = options.root;
  options.root.classList.add('hvy-document');
  setThemeRoot(options.root);
  initState(createEmbedState(options.document, options.showAdvancedEditor ?? false));
  currentLinkObserver = options.linkObserver ?? null;
  if (options.paletteId && getPaletteById(options.paletteId)) {
    state.paletteOverrideId = options.paletteId;
  }
  ensureEmbedRuntime(options.plugins ?? []);
  renderApp();
  return {
    destroy() {
      options.root.innerHTML = '';
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
    openThemeEditor(options = {}) {
      void loadFullEmbed().then((module) => {
        const fullMount = module.mountHvy({ root: currentRoot ?? document.createElement('div'), document: state.document, mode: 'editor' });
        fullMount.openThemeEditor(options);
      });
    },
    mountThemeEditor(root, options = {}) {
      void loadFullEmbed().then((module) => {
        const fullMount = module.mountHvy({ root: currentRoot ?? root, document: state.document, mode: 'editor' });
        fullMount.mountThemeEditor(root, options);
      });
    },
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
