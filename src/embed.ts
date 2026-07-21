import './default-theme.css';
import './host-overrides.css';
import './style.css';

import { createReaderRenderer, type ReaderRenderer } from './reader/render';
import { isPdfDocument } from './pdf-document-capabilities';
import { renderPdfDocumentViewerThemeStyle } from './pdf-document-theme';
import {
  activateStateRuntime,
  createStateRuntime,
  getActiveStateRuntime,
  initCallbacks,
  state,
  runWithStateRuntime,
  runWithStateRuntimeAsync,
  type ReaderPanelRefreshOptions,
  type StateRuntime,
} from './state';
import type { AppState, ChatProvider, HvyChatContextOptions, HvyChatContextProvider, HvyChatSearchCache, HvyEditorClipboardHost, HvyEmbeddingProvider, ImageAttachmentMaxDimensions, VisualDocument } from './types';
import { deserializeDocumentBytes, deserializeDocumentBytesAsync, serializeDocument, serializeDocumentBytes, serializeDocumentBytesAsync, type HvyDocumentSerializerAdapter } from './serialization';
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
import { recordHistory, redoState, undoState } from './history';
import { virtualizeRenderedSections } from './section-virtualizer';
import { refreshReaderBlockDom, refreshReaderSectionDom } from './reader/block-refresh';
import {
  createDocumentChangeApi,
  type HvyDocumentChangeCallback,
} from './document-change';
import type { HvyPlugin } from './plugins/types';
import type { HostChatClient } from './chat/chat';
import type { HvySearchSnapshot, HvySearchSnapshotInput, HvySemanticFilterProvider } from './search/types';
import type { HvyPdfExportOptions } from './pdf-export/types';
import { normalizePdfStylePresets, type HvyPdfStylePreset } from './pdf-style-presets';
import { createPdfExportPlan, createPdfExportPlanFromPrompt } from './pdf-export/planning';
import { createProxyEmbeddingProvider } from './chat/embedding-provider';
import { planEmbeddingIndexUpdate, prepareEmbeddingChatContext, readEmbeddingIndexFromDocumentBytes } from './chat/embedding-context';
import { getPdfExportPromptTemplates, renderPdfExportPromptTemplate } from './pdf-export/prompt-templates';
import { searchDocuments } from './search/documents';
import { createDocumentFilterSnapshot } from './search/document-filter';
import {
  createDocumentSearchSnapshot,
  normalizeSearchSnapshotInput,
  externalSearchSnapshotToDocumentState,
  searchStateToSnapshot,
} from './search/snapshot';
import type {
  BuildImportPlanOptions,
  BuildImportPlanResult,
  ImportFromTextOptions,
  ImportFromTextResult,
} from './ai-document-edit';
import { addExternalLinkTargets, markdownToReaderHtml, normalizeMarkdownIndentation, normalizeMarkdownLists } from './markdown';
import { removeTextFillInMarkers } from './text-fill-in';
import { setRuntimeSemanticFilterProvider } from './reference-config';
import { setEditorClipboardHost } from './editor-clipboard';
import { hydrateHostAttachmentDescriptorsSync, type HvyAttachmentHostAdapter } from './attachment-store';
import { serializeMountedDocumentBytesAsync } from './embed-serialization';
import { materializePreparedEmbeddingAttachments } from './chat/embedding-context';
import { createHostedAttachmentAdapter } from './hosted-attachments';
import { bindCarouselInteractions } from './editor/components/carousel/carousel';
import { bindLazyImageHydration } from './editor/components/image/image';
import { syncTextToolbarLayout } from './editor/components/text/text-toolbar-layout';
import { decryptEncryptedComponents, encryptComponentInDocument, decryptComponentInDocument } from './encrypted-components';
import { encryptDocumentBytes, generateEncryptionKey, rememberEncryptionKey, type HvyEncryptionOptions, type HvyGeneratedEncryptionKey } from './encryption';
import { buildDocumentRichTextCopyPayload } from './rich-text-copy';
import { exportDocumentSourceMarkdown } from './document-source-markdown';
import { elapsedMs, logPerfTrace, nowMs } from './perf-trace';
import { applyHvyDocumentDelta, createHvyDocumentDelta, isHvyDocumentDelta } from './document-delta';

export type HvyEmbedMode = 'viewer' | 'editor' | 'ai';

export interface HvyMountOptions {
  root: HTMLElement;
  document: VisualDocument;
  mode?: HvyEmbedMode;
  plugins?: HvyPlugin[];
  showAdvancedEditor?: boolean;
  chatClient?: HostChatClient | null;
  chatContext?: HvyChatContextOptions | null;
  chatContextProvider?: HvyChatContextProvider | null;
  chatSearchCache?: HvyChatSearchCache | null;
  embeddingProvider?: HvyEmbeddingProvider | null;
  semanticFilterProvider?: HvySemanticFilterProvider | null;
  linkObserver?: HvyLinkObserver | null;
  crossDocumentLinks?: boolean;
  controls?: boolean;
  paletteId?: string | null;
  pdfStylePresets?: HvyPdfStylePreset[] | null;
  storageKey?: string | null;
  persistSessionState?: boolean;
  imageAttachmentMaxDimensions?: ImageAttachmentMaxDimensions | null;
  attachmentStore?: HvyAttachmentHostAdapter | null;
  serializer?: HvyDocumentSerializerAdapter | null;
  searchSnapshot?: HvySearchSnapshotInput | null;
  editorClipboard?: HvyEditorClipboardHost | null;
  encryption?: HvyEncryptionOptions | null;
  onDocumentChange?: HvyDocumentChangeCallback;
}

export interface HvyMount {
  destroy(): void;
  getDocument(): VisualDocument;
  serializeDocumentBytes(): Uint8Array;
  serializeDocumentBytesAsync(): Promise<Uint8Array>;
  exportDocumentSourceMarkdown(): string;
  encryptDocumentAsync(): Promise<HvyGeneratedEncryptionKey>;
  encryptComponentAsync(sectionKey: string, blockId: string): Promise<HvyGeneratedEncryptionKey>;
  decryptComponentAsync(sectionKey: string, blockId: string): Promise<void>;
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
    status: null,
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
    filterQueryMode: 'keyword',
    submittedFilterQueryMode: 'keyword',
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

function createEmbedState(
  document: VisualDocument,
  showAdvancedEditor = false,
  imageAttachmentMaxDimensions?: ImageAttachmentMaxDimensions | null,
  sessionStorageKey?: string | null,
  attachmentHost?: HvyAttachmentHostAdapter | null,
  encryption?: HvyEncryptionOptions | null,
  crossDocumentLinksEnabled = false
): AppState {
  return {
    document,
    filename: document.extension === '.phvy' ? 'document.phvy' : document.extension === '.thvy' ? 'resume.thvy' : 'resume.hvy',
    selectedExample: 'default',
    currentView: 'viewer',
    editorMode: 'basic',
    responsivePreview: 'full',
    chatContext: null,
    chatContextProvider: null,
    chatSearchCache: null,
    embeddingProvider: null,
    crossDocumentLinksEnabled,
    sessionStorageKey,
    persistDocumentState: false,
    imageAttachmentMaxDimensions,
    attachmentHost: attachmentHost ?? null,
    encryption: encryption ?? null,
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
    paneScroll: { fullPaneTop: 0, editorTop: 0, editorSidebarTop: 0, viewerSidebarTop: 0, readerTop: 0, windowLeft: 0, windowTop: 0 },
    showAdvancedEditor,
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
    pdfStylePresets: normalizePdfStylePresets(null),
    pdfStylePresetId: null,
    themeModalOpen: false,
    themeModalMode: 'full',
    paletteOverrideId: loadPaletteOverrideId(),
    gridAddComponentByBlock: {},
    expandableEditorPanels: {},
    readerExpandableState: {},
    readerContainerState: {},
    readerDeferredSectionBodies: {},
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

function localGetComponentRenderHelpers() {
  if (!readerRenderer) {
    throw new Error('HVY reader renderer is not initialized.');
  }
  return getComponentRenderHelpers(
    {
      renderRichToolbar: renderLightweightRichToolbar,
      renderEditorBlock: () => '',
      renderPassiveEditorBlock: () => '',
      renderTextFragment,
      renderComponentFragment,
      renderComponentPlacementTarget: () => '',
    },
    readerRenderer
  );
}

function renderLightweightRichToolbar(
  sectionKey: string,
  blockId: string,
  options: {
    field?: string;
    gridItemId?: string;
    rowIndex?: number;
    includeAlign?: boolean;
    includeFillIn?: boolean;
    align?: 'left' | 'center' | 'right';
    currentMarkdown?: string;
  } = {}
): string {
  const fieldAttr = options.field ? ` data-rich-field="${escapeAttr(options.field)}"` : '';
  const gridAttr = options.gridItemId ? ` data-grid-item-id="${escapeAttr(options.gridItemId)}"` : '';
  const rowAttr = typeof options.rowIndex === 'number' ? ` data-row-index="${options.rowIndex}"` : '';
  const richButtonAttrs = `${fieldAttr}${gridAttr}${rowAttr} data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(blockId)}"`;
  const blockStyle = getMarkdownBlockStyle(options.currentMarkdown ?? '');
  const selectedClass = (selected: boolean) => (selected ? ' secondary is-selected' : ' ghost');
  const hotkeyModifier = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? 'Cmd' : 'Ctrl';
  return `
    <div class="rich-toolbar">
      <div class="toolbar-segment block-style-buttons" role="group" aria-label="Block style">
        <button type="button" class="${selectedClass(blockStyle === 'paragraph')}" data-rich-action="paragraph" ${richButtonAttrs} title="Normal text">Text</button>
        <button type="button" class="${selectedClass(blockStyle === 'heading-1')}" data-rich-action="heading-1" ${richButtonAttrs} title="Heading 1">H1</button>
        <button type="button" class="${selectedClass(blockStyle === 'heading-2')}" data-rich-action="heading-2" ${richButtonAttrs} title="Heading 2">H2</button>
        <button type="button" class="${selectedClass(blockStyle === 'heading-3')}" data-rich-action="heading-3" ${richButtonAttrs} title="Heading 3">H3</button>
        <button type="button" class="${selectedClass(blockStyle === 'heading-4')}" data-rich-action="heading-4" ${richButtonAttrs} title="Heading 4">H4</button>
      </div>
      <div class="toolbar-segment format-buttons" role="group" aria-label="Text formatting">
        <button type="button" class="icon-button ghost" data-rich-action="bold" ${richButtonAttrs} aria-label="Bold" title="Bold (${hotkeyModifier}+B)"><strong>B</strong></button>
        <button type="button" class="icon-button ghost" data-rich-action="italic" ${richButtonAttrs} aria-label="Italic" title="Italic (${hotkeyModifier}+I)"><span class="toolbar-icon italic-icon" aria-hidden="true">I</span></button>
        <button type="button" class="icon-button ghost" data-rich-action="underline" ${richButtonAttrs} aria-label="Underline" title="Underline (${hotkeyModifier}+U)"><span class="toolbar-icon underline-icon" aria-hidden="true">U</span></button>
        <button type="button" class="icon-button ghost" data-rich-action="strikethrough" ${richButtonAttrs} aria-label="Strikethrough" title="Strikethrough"><span class="toolbar-icon strikethrough-icon" aria-hidden="true">S</span></button>
        <button type="button" class="icon-button${selectedClass(blockStyle === 'quote')}" data-rich-action="quote" ${richButtonAttrs} aria-label="Quote" title="Quote"><span class="toolbar-icon quote-icon" aria-hidden="true">“</span></button>
        <button type="button" class="icon-button${selectedClass(blockStyle === 'code-block')}" data-rich-action="code-block" ${richButtonAttrs} aria-label="Code block" title="Code block"><span class="toolbar-icon code-icon" aria-hidden="true">&lt;/&gt;</span></button>
        <button type="button" class="icon-button${selectedClass(blockStyle === 'list')}" data-rich-action="list" ${richButtonAttrs} aria-label="List" title="Bullet List"><span class="toolbar-icon list-icon" aria-hidden="true"></span></button>
        <button type="button" class="icon-button${selectedClass(blockStyle === 'ordered-list')}" data-rich-action="ordered-list" ${richButtonAttrs} aria-label="Numbered List" title="Numbered List"><span class="toolbar-icon ordered-list-icon" aria-hidden="true"></span></button>
        <button type="button" class="icon-button${selectedClass(blockStyle === 'checklist')}" data-rich-action="checklist" ${richButtonAttrs} aria-label="Checkbox" title="Checkbox"><span class="toolbar-icon checkbox-icon" aria-hidden="true">☑</span></button>
        <button type="button" class="icon-button ghost" data-rich-action="link" ${richButtonAttrs} aria-label="Link" title="Link (${hotkeyModifier}+K)"><span class="toolbar-icon link-icon" aria-hidden="true"></span></button>
      </div>
    </div>
  `;
}

function getMarkdownBlockStyle(markdown: string): string {
  const firstLine = markdown.trimStart().split(/\r?\n/, 1)[0] ?? '';
  const heading = firstLine.match(/^(#{1,4})\s+/);
  if (heading) {
    return `heading-${heading[1].length}`;
  }
  if (/^[-*]\s+\[[ xX]\]\s+/.test(firstLine)) {
    return 'checklist';
  }
  if (/^[-*]\s+/.test(firstLine)) {
    return 'list';
  }
  if (/^\d+\.\s+/.test(firstLine)) {
    return 'ordered-list';
  }
  if (/^>\s+/.test(firstLine)) {
    return 'quote';
  }
  if (/^```/.test(firstLine)) {
    return 'code-block';
  }
  return 'paragraph';
}

function renderComponentFragment(componentName: string, content: string, block: { schema: { codeLanguage?: string; fillIn?: boolean } }): string {
  if (componentName === 'code') {
    const language = block.schema.codeLanguage?.trim() || 'text';
    return `<pre class="code-reader"><code data-language="${escapeAttr(language)}">${escapeHtml(content)}</code></pre>`;
  }
  const source = componentName === 'text' && block.schema.fillIn ? removeTextFillInMarkers(content) : content;
  return renderTextFragment(source);
}

function renderTextFragment(content: string): string {
  const normalized = normalizeMarkdownIndentation(normalizeMarkdownLists(content));
  return addExternalLinkTargets(markdownToReaderHtml(normalized, {
    crossDocumentLinksEnabled: state.crossDocumentLinksEnabled === true,
  }), { crossDocumentLinksEnabled: state.crossDocumentLinksEnabled === true });
}

function ensureReaderRenderer(): ReaderRenderer {
  if (readerRenderer) {
    return readerRenderer;
  }
  readerRenderer = createReaderRenderer(
    {
      get documentMeta() { return state.document.meta; },
      get documentExtension() { return state.document.extension; },
      get documentSections() { return state.document.sections; },
      get addComponentBySection() { return state.addComponentBySection; },
      get tempHighlights() { return state.tempHighlights; },
      get aiEditTarget() { return { sectionKey: null, blockId: null }; },
      get contextMenu() { return null; },
      get activeEditorBlock() { return null; },
      get aiEditorHostBlock() { return null; },
      get aiEditorHostSectionKey() { return null; },
      get modalSectionKey() { return null; },
      get captionTextModal() { return null; },
      get sqliteRowComponentModal() { return state.sqliteRowComponentModal; },
      get dbTableQueryModal() { return state.dbTableQueryModal; },
      get pdfTemplateImportModal() { return null; },
      get reusableSaveModal() { return null; },
      get reusableTemplateModal() { return null; },
      get reusableDefinitionEditModal() { return null; },
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
      get readerDeferredSectionBodies() { return state.readerDeferredSectionBodies; },
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

function renderTransientNotice(): string {
  const notice = state.transientNotice;
  if (!notice) {
    return '';
  }
  return `<div class="transient-notice" role="status">${escapeHtml(notice.message)}</div>`;
}

function renderApp(options: { runDocumentHooks?: boolean } = {}): void {
  void options;
  if (!currentRoot) return;
  const startedAt = nowMs();
  let renderHtmlMs = 0;
  let domMs = 0;
  let postMs = 0;
  const root = currentRoot;
  const runtime = getActiveStateRuntime();
  const renderer = ensureReaderRenderer();
  const pendingPaneScrollRestore = state.pendingPaneScrollRestore;
  const capturedScroll = captureRenderScroll(root, state.paneScroll, pendingPaneScrollRestore);
  state.paneScroll = capturedScroll.paneScroll;
  state.pendingPaneScrollRestore = null;
  applyTheme();
  const readerWarningsHtml = renderer.renderWarnings();
  const readerSidebarSectionsHtml = renderer.renderSidebarSections(state.document.sections);
  const hasViewerSidebar = Boolean(readerWarningsHtml.trim() || readerSidebarSectionsHtml.trim());
  const pdfDocument = isPdfDocument(state.document);
  capturePluginFocus();
  const renderHtmlStartedAt = nowMs();
  const markup = `
    <main class="layout hvy-embed-layout hvy-embed-full-layout">
      <section class="workspace-shell">
        <div class="reader-pane pane full-pane">
          <div class="viewer-shell ${pdfDocument ? 'phvy-viewer-shell ' : ''}${hasViewerSidebar ? (state.viewerSidebarOpen ? 'is-sidebar-open' : 'is-sidebar-closed') : 'has-no-sidebar'}"${pdfDocument ? ` style="${renderPdfDocumentViewerThemeStyle(state.document, escapeAttr)}"` : ''}>
            ${renderTransientNotice()}
            ${hasViewerSidebar ? `<div class="viewer-sidebar-backdrop" data-action="toggle-viewer-sidebar"></div>
              <aside class="viewer-sidebar">
                <button type="button" class="viewer-sidebar-tab" data-action="toggle-viewer-sidebar" aria-expanded="${state.viewerSidebarOpen ? 'true' : 'false'}" aria-label="Toggle navigation">${renderSidebarTabLabel()}</button>
                ${renderer.renderSidebarHelpBalloon(state.document.sections)}
                <div class="viewer-sidebar-panel">
                  <div id="readerWarnings" class="reader-warnings">${readerWarningsHtml}</div>
                  <div id="readerSidebarSections" class="reader-sidebar-sections hvy-reader-surface">${readerSidebarSectionsHtml}</div>
                </div>
              </aside>` : ''}
            <div id="readerDocument" class="reader-document hvy-reader-surface">${renderer.renderReaderSections(state.document.sections)}</div>
          </div>
        </div>
      </section>
    </main>`;
  renderHtmlMs = elapsedMs(renderHtmlStartedAt);
  const domStartedAt = nowMs();
  root.innerHTML = markup;
  domMs = elapsedMs(domStartedAt);
  const postStartedAt = nowMs();
  bindReaderUi(root);
  bindCarouselInteractions(root);
  reconcilePluginMounts(root);
  syncTextToolbarLayout(root);
  restoreRenderScroll(root, capturedScroll);
  virtualizeRenderedSections({
    root,
    afterRestore: (scope) => {
      reconcilePluginMounts(scope, { prune: false });
      syncTextToolbarLayout(scope);
      bindLazyImageHydration(scope);
      void runWithStateRuntime(runtime, () => runButtonVisibilityScriptsIfNeeded(scope));
    },
  });
  bindLazyImageHydration(root);
  syncTextToolbarLayout(root);
  observeRenderedLinks(root, currentLinkObserver);
  void runWithStateRuntime(runtime, () => runButtonVisibilityScriptsIfNeeded(root));
  postMs = elapsedMs(postStartedAt);
  logPerfTrace('renderApp', {
    elapsedMs: elapsedMs(startedAt),
    renderHtmlMs,
    domMs,
    postMs,
    currentView: state.currentView,
    embedded: true,
    lightweight: true,
  });
}

function refreshReaderPanels(options: ReaderPanelRefreshOptions = {}): void {
  if (!currentRoot) return;
  const runtime = getActiveStateRuntime();
  const renderer = ensureReaderRenderer();
  const startedAt = nowMs();
  const reader = currentRoot.querySelector<HTMLDivElement>('#readerDocument');
  const sidebarSections = currentRoot.querySelector<HTMLDivElement>('#readerSidebarSections');
  const surface = options.surface ?? 'all';
  let sidebarRenderMs = 0;
  let sidebarDomMs = 0;
  let sidebarPostMs = 0;
  let readerRenderMs = 0;
  let readerDomMs = 0;
  let readerPostMs = 0;
  let lazyMs = 0;
  let afterRefreshMs = 0;
  capturePluginFocus();
  if (sidebarSections && surface !== 'reader') {
    let phaseStartedAt = nowMs();
    const sidebarHtml = renderer.renderSidebarSections(state.document.sections);
    sidebarRenderMs = elapsedMs(phaseStartedAt);
    phaseStartedAt = nowMs();
    sidebarSections.innerHTML = sidebarHtml;
    sidebarDomMs = elapsedMs(phaseStartedAt);
    phaseStartedAt = nowMs();
    reconcilePluginMounts(sidebarSections);
    syncTextToolbarLayout(sidebarSections);
    if (options.runVisibilityScripts !== false) {
      void runWithStateRuntime(runtime, () => runButtonVisibilityScriptsIfNeeded(sidebarSections));
    }
    sidebarPostMs = elapsedMs(phaseStartedAt);
  }
  if (reader && surface !== 'sidebar') {
    let phaseStartedAt = nowMs();
    const readerHtml = renderer.renderReaderSections(state.document.sections);
    readerRenderMs = elapsedMs(phaseStartedAt);
    phaseStartedAt = nowMs();
    reader.innerHTML = readerHtml;
    readerDomMs = elapsedMs(phaseStartedAt);
    phaseStartedAt = nowMs();
    reconcilePluginMounts(reader);
    syncTextToolbarLayout(reader);
    if (options.runVisibilityScripts !== false) {
      void runWithStateRuntime(runtime, () => runButtonVisibilityScriptsIfNeeded(reader));
    }
    readerPostMs = elapsedMs(phaseStartedAt);
  }
  const afterRefreshStartedAt = nowMs();
  const lazyStartedAt = nowMs();
  virtualizeRenderedSections({
    root: currentRoot,
    afterRestore: (scope) => {
      reconcilePluginMounts(scope, { prune: false });
      syncTextToolbarLayout(scope);
      bindLazyImageHydration(scope);
      if (options.runVisibilityScripts !== false) {
        void runWithStateRuntime(runtime, () => runButtonVisibilityScriptsIfNeeded(scope));
      }
    },
  });
  lazyMs = elapsedMs(lazyStartedAt);
  bindLazyImageHydration(currentRoot);
  syncTextToolbarLayout(currentRoot);
  observeRenderedLinks(currentRoot, currentLinkObserver);
  bindCarouselInteractions(currentRoot);
  afterRefreshMs = elapsedMs(afterRefreshStartedAt);
  logPerfTrace('refreshReaderPanels', {
    elapsedMs: elapsedMs(startedAt),
    sidebarRenderMs,
    sidebarDomMs,
    sidebarPostMs,
    readerRenderMs,
    readerDomMs,
    readerPostMs,
    lazyMs,
    afterRefreshMs,
    currentView: state.currentView,
    embedded: true,
    lightweight: true,
    visibilityScriptsSkipped: options.runVisibilityScripts === false,
    surface,
  });
}

function refreshReaderBlock(root: ParentNode, sectionKey: string, blockId: string, options: { runVisibilityScripts?: boolean } = {}): boolean {
  const runtime = getActiveStateRuntime();
  const renderer = ensureReaderRenderer();
  const startedAt = nowMs();
  const refreshed = refreshReaderBlockDom({
    root,
    readerRenderer: renderer,
    sections: state.document.sections,
    sectionKey,
    blockId,
    afterReplace: (element) => {
      reconcilePluginMounts(element, { prune: false });
      syncTextToolbarLayout(element);
      bindLazyImageHydration(element);
      bindCarouselInteractions(element);
      if (options.runVisibilityScripts !== false) {
        void runWithStateRuntime(runtime, () => runButtonVisibilityScriptsIfNeeded(element));
      }
      observeRenderedLinks(element, currentLinkObserver);
    },
  });
  logPerfTrace('refreshReaderBlock', {
    sectionKey,
    blockId,
    refreshed,
    elapsedMs: elapsedMs(startedAt),
    currentView: state.currentView,
    embedded: true,
    lightweight: true,
    visibilityScriptsSkipped: options.runVisibilityScripts === false,
  });
  return refreshed;
}

function refreshReaderSection(root: ParentNode, sectionKey: string, options: { runVisibilityScripts?: boolean } = {}): boolean {
  const runtime = getActiveStateRuntime();
  const renderer = ensureReaderRenderer();
  const startedAt = nowMs();
  const refreshed = refreshReaderSectionDom({
    root,
    readerRenderer: renderer,
    sections: state.document.sections,
    sectionKey,
    afterReplace: (element) => {
      reconcilePluginMounts(element, { prune: false });
      syncTextToolbarLayout(element);
      bindLazyImageHydration(element);
      bindCarouselInteractions(element);
      if (options.runVisibilityScripts !== false) {
        void runWithStateRuntime(runtime, () => runButtonVisibilityScriptsIfNeeded(element));
      }
      observeRenderedLinks(element, currentLinkObserver);
    },
  });
  logPerfTrace('refreshReaderSection', {
    sectionKey,
    refreshed,
    elapsedMs: elapsedMs(startedAt),
    currentView: state.currentView,
    embedded: true,
    lightweight: true,
    visibilityScriptsSkipped: options.runVisibilityScripts === false,
  });
  return refreshed;
}

function refreshModalPreview(): void {}

async function runButtonVisibilityScriptsIfNeeded(root: ParentNode): Promise<void> {
  if (!root.querySelector('[data-hvy-dynamic-visibility="true"], [data-hvy-button="true"]')) {
    return;
  }
  const runtime = getActiveStateRuntime();
  const { runButtonVisibilityScripts } = await import('./editor/components/button/button-actions');
  await runWithStateRuntime(runtime, () => runButtonVisibilityScripts(root));
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
}

function ensureEmbedRuntime(
  plugins: HvyPlugin[],
  runtime: StateRuntime,
  root: HTMLElement,
  getLinkObserver: () => HvyLinkObserver | null
): void {
  const renderer = ensureReaderRenderer();
  initCallbacks({
    renderApp: () => runWithStateRuntime(runtime, () => {
      currentRoot = root;
      currentLinkObserver = getLinkObserver();
      setThemeRoot(root);
      renderApp();
    }),
    refreshReaderPanels: (options) => runWithStateRuntime(runtime, () => {
      currentRoot = root;
      currentLinkObserver = getLinkObserver();
      refreshReaderPanels(options);
    }),
    refreshReaderSection: (target, sectionKey, options) => runWithStateRuntime(runtime, () => {
      currentRoot = root;
      currentLinkObserver = getLinkObserver();
      return refreshReaderSection(target, sectionKey, options);
    }),
    refreshReaderBlock: (target, sectionKey, blockId, options) => runWithStateRuntime(runtime, () => {
      currentRoot = root;
      currentLinkObserver = getLinkObserver();
      return refreshReaderBlock(target, sectionKey, blockId, options);
    }),
    refreshModalPreview: () => runWithStateRuntime(runtime, () => {
      currentRoot = root;
      currentLinkObserver = getLinkObserver();
      refreshModalPreview();
    }),
    observeLinks: (target) => runWithStateRuntime(runtime, () => {
      currentRoot = root;
      currentLinkObserver = getLinkObserver();
      observeRenderedLinks(target, currentLinkObserver);
    }),
    componentRenderHelpers: localGetComponentRenderHelpers(),
    readerRenderer: renderer,
  });
  setHostPlugins(plugins);
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

function setMountedSearchSnapshot(snapshot: HvySearchSnapshotInput | null, options: { render?: boolean } = {}): void {
  state.search.abortController?.abort();
  state.search = externalSearchSnapshotToDocumentState(snapshot, state.document);
  if (options.render ?? true) {
    renderApp();
  }
}

async function loadFullEmbed(): Promise<FullEmbedModule> {
  return import('./embed-full');
}

function mountFullHvyProxy(options: HvyMountOptions): HvyMount {
  let mounted: HvyMount | null = null;
  let queuedSearchSnapshot = options.searchSnapshot ?? null;
  const pending: Array<(mount: HvyMount) => void> = [];
  options.root.classList.add('hvy-document');
  options.root.innerHTML = '<main class="layout hvy-embed-layout hvy-embed-full-layout"><section class="pane full-pane"><p>Loading HVY...</p></section></main>';
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
    serializeDocumentBytes() {
      if (!mounted && options.document.encryption?.encrypted === true) {
        throw new Error('Encrypted HVY documents require serializeDocumentBytesAsync().');
      }
      if (mounted) {
        return mounted.serializeDocumentBytes();
      }
      materializePreparedEmbeddingAttachments(options.document);
      return serializeDocumentBytes(options.document);
    },
    serializeDocumentBytesAsync() {
      return mounted?.serializeDocumentBytesAsync() ?? serializeMountedDocumentBytesAsync(options.document, options.attachmentStore ?? null, options.serializer ?? null, options.encryption ?? null);
    },
    exportDocumentSourceMarkdown() {
      return mounted?.exportDocumentSourceMarkdown() ?? exportDocumentSourceMarkdown(options.document);
    },
    encryptDocumentAsync() {
      return ready.then((mount) => mount.encryptDocumentAsync());
    },
    encryptComponentAsync(sectionKey, blockId) {
      return ready.then((mount) => mount.encryptComponentAsync(sectionKey, blockId));
    },
    decryptComponentAsync(sectionKey, blockId) {
      return ready.then((mount) => mount.decryptComponentAsync(sectionKey, blockId));
    },
    getPdfBlob(pdfOptions) {
      return ready.then((mount) => mount.getPdfBlob(pdfOptions));
    },
    exportPdf(pdfOptions) {
      return ready.then((mount) => mount.exportPdf(pdfOptions));
    },
    markSaved() {
      withMount((mount) => mount.markSaved());
    },
    isDirty() {
      return mounted?.isDirty() ?? false;
    },
    undo() {
      withMount((mount) => mount.undo());
    },
    redo() {
      withMount((mount) => mount.redo());
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
    setSearchSnapshot(snapshot) {
      queuedSearchSnapshot = snapshot;
      options.searchSnapshot = snapshot;
      withMount((mount) => mount.setSearchSnapshot(snapshot));
    },
    getSearchSnapshot() {
      return mounted?.getSearchSnapshot() ?? normalizeSearchSnapshotInput(queuedSearchSnapshot);
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
  const refreshAfterImportMutation = (): void => {
    state.rawEditorText = serializeDocument(state.document);
    renderApp({ runDocumentHooks: false });
  };
  const runPreparedImportHooks = async (): Promise<void> => {
    await runPluginDocumentHooks('ai-edit');
    refreshAfterImportMutation();
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
    hydrateHostAttachmentDescriptorsSync(options.document, options.attachmentStore ?? null);
    return mountFullHvyProxy(options);
  }
  hydrateHostAttachmentDescriptorsSync(options.document, options.attachmentStore ?? null);
  const runtime = createStateRuntime(createEmbedState(
    options.document,
    options.showAdvancedEditor ?? false,
    options.imageAttachmentMaxDimensions,
    options.persistSessionState === true ? options.storageKey : null,
    options.attachmentStore ?? null,
    options.encryption ?? null,
    options.crossDocumentLinks === true
  ));
  let linkObserver = options.linkObserver ?? null;
  runtime.state.chatContext = options.chatContext ?? null;
  runtime.state.chatContextProvider = options.chatContextProvider ?? null;
  runtime.state.chatSearchCache = options.chatSearchCache ?? null;
  runtime.state.embeddingProvider = options.embeddingProvider ?? null;
  activateStateRuntime(runtime);
  if ('semanticFilterProvider' in options) {
    setRuntimeSemanticFilterProvider(options.semanticFilterProvider ?? null);
  }
  setEditorClipboardHost(options.editorClipboard ?? null);
  currentRoot = options.root;
  options.root.classList.add('hvy-document');
  setThemeRoot(options.root);
  currentLinkObserver = linkObserver;
  if ('paletteId' in options) {
    state.paletteOverrideId = options.paletteId && getPaletteById(options.paletteId) ? options.paletteId : null;
  }
  if ('pdfStylePresets' in options) {
    state.pdfStylePresets = normalizePdfStylePresets(options.pdfStylePresets ?? null);
    state.pdfStylePresetId = null;
  }
  if ('searchSnapshot' in options) {
    setMountedSearchSnapshot(options.searchSnapshot ?? null, { render: false });
  }
  bindRuntimeActivation(options.root, runtime);
  ensureEmbedRuntime(options.plugins ?? builtInPlugins, runtime, options.root, () => linkObserver);
  const documentChangeApi = createDocumentChangeApi(runtime, options.onDocumentChange);
  runtime.callbacks.renderApp();
  void runPluginDocumentHooks('load');
  void decryptEncryptedComponents(state.document, options.encryption ?? null).then(() => runtime.callbacks.renderApp());
  return {
    destroy() {
      runWithStateRuntime(runtime, () => {
        options.root.innerHTML = '';
        setHostPlugins([]);
        setEditorClipboardHost(null);
        setRuntimeSemanticFilterProvider(null);
        resetPluginDocumentHookState();
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
      return runWithStateRuntime(runtime, () => {
        if (state.document.encryption?.encrypted === true) {
          throw new Error('Encrypted HVY documents require serializeDocumentBytesAsync().');
        }
        materializePreparedEmbeddingAttachments(state.document);
        return serializeDocumentBytes(state.document);
      });
    },
    serializeDocumentBytesAsync() {
      return runWithStateRuntimeAsync(runtime, () => serializeMountedDocumentBytesAsync(state.document, state.attachmentHost, options.serializer ?? null, state.encryption ?? null));
    },
    exportDocumentSourceMarkdown() {
      return runWithStateRuntime(runtime, () => exportDocumentSourceMarkdown(state.document));
    },
    encryptDocumentAsync() {
      return runWithStateRuntimeAsync(runtime, async () => {
        const generated = generateEncryptionKey();
        if (!state.encryption) {
          state.encryption = { keyring: {} };
        }
        rememberEncryptionKey(state.encryption ?? null, generated);
        state.document.encryption = { algorithm: 'fernet', keyId: generated.keyId, encrypted: true };
        return generated;
      });
    },
    encryptComponentAsync(sectionKey, blockId) {
      return runWithStateRuntimeAsync(runtime, async () => {
        if (!state.encryption) {
          state.encryption = { keyring: {} };
        }
        const result = await encryptComponentInDocument(state.document, sectionKey, blockId, state.encryption ?? null);
        runtime.callbacks.renderApp();
        return { keyId: result.keyId, key: result.key };
      });
    },
    decryptComponentAsync(sectionKey, blockId) {
      return runWithStateRuntimeAsync(runtime, async () => {
        await decryptComponentInDocument(state.document, sectionKey, blockId, state.encryption ?? null);
        runtime.callbacks.renderApp();
      });
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
      documentChangeApi.markSaved();
    },
    isDirty() {
      return documentChangeApi.isDirty();
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
    openThemeEditor(themeOptions = {}) {
      void loadFullEmbed().then((module) => runWithStateRuntime(runtime, () => {
        const fullMount = module.mountHvy({
          root: options.root,
          document: state.document,
          mode: 'editor',
          imageAttachmentMaxDimensions: state.imageAttachmentMaxDimensions,
          attachmentStore: state.attachmentHost,
          serializer: options.serializer ?? null,
          encryption: state.encryption,
          storageKey: state.sessionStorageKey,
          persistSessionState: options.persistSessionState,
          onDocumentChange: options.onDocumentChange,
        });
        fullMount.openThemeEditor(themeOptions);
      }));
    },
    mountThemeEditor(root, themeOptions = {}) {
      void loadFullEmbed().then((module) => runWithStateRuntime(runtime, () => {
        const fullMount = module.mountHvy({
          root: options.root,
          document: state.document,
          mode: 'editor',
          imageAttachmentMaxDimensions: state.imageAttachmentMaxDimensions,
          attachmentStore: state.attachmentHost,
          serializer: options.serializer ?? null,
          encryption: state.encryption,
          storageKey: state.sessionStorageKey,
          persistSessionState: options.persistSessionState,
          onDocumentChange: options.onDocumentChange,
        });
        fullMount.mountThemeEditor(root, themeOptions);
      }));
    },
  };
}

export function mountHvyViewer(options: Omit<HvyMountOptions, 'mode'>): HvyMount {
  return mountHvy({ ...options, mode: 'viewer' });
}

export {
  applyHvyDocumentDelta,
  builtInPluginMap as plugins,
  builtInPlugins,
  createDocumentFilterSnapshot,
  createDocumentSearchSnapshot,
  createHvyDocumentDelta,
  createHostedAttachmentAdapter,
  createPdfExportPlan,
  createPdfExportPlanFromPrompt,
  deserializeDocumentBytes,
  deserializeDocumentBytesAsync,
  encryptDocumentBytes,
  exportDocumentSourceMarkdown,
  getPdfExportPromptTemplates,
  renderPdfExportPromptTemplate,
  searchDocuments,
  serializeDocument,
  serializeDocumentBytes,
  serializeDocumentBytesAsync,
  isHvyDocumentDelta,
  buildDocumentRichTextCopyPayload,
};
export type { HvyDocumentDeltaOptions } from './document-delta';
export type { RichTextCopyPayload } from './rich-text-copy';
export type { HvyAttachmentDescriptor, HvyAttachmentHostAdapter } from './attachment-store';
export type { HostedAttachmentManifest, HostedAttachmentManifestEntry } from './hosted-attachments';
export type { HvyDocumentSerializerAdapter, HvyDocumentSerializerRequest } from './serialization';
export type { HvyEncryptionOptions, HvyGeneratedEncryptionKey } from './encryption';
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
export type { HvyEmbeddingInput, HvyEmbeddingProvider, HvyEmbeddingProviderRequest, HvyEmbeddingVector, ImageAttachmentMaxDimensions, ToolLoopCompactionOptions } from './types';
export { createProxyEmbeddingProvider };
export { planEmbeddingIndexUpdate };
export { prepareEmbeddingChatContext };
export { readEmbeddingIndexFromDocumentBytes };
export type {
  HvyEmbeddingIndexChunk,
  HvyEmbeddingIndexUpdatePlan,
  HvyEmbeddingIndexUpdateRequest,
  HvyEmbeddingIndexVector,
  HvySerializedEmbeddingIndex,
  HvySerializedEmbeddingIndexReadOptions,
} from './chat/embedding-context';
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

declare global {
  interface Window {
    HVY?: {
      deserializeDocumentBytes: typeof deserializeDocumentBytes;
      deserializeDocumentBytesAsync: typeof deserializeDocumentBytesAsync;
      applyHvyDocumentDelta: typeof applyHvyDocumentDelta;
      createHvyDocumentDelta: typeof createHvyDocumentDelta;
      isHvyDocumentDelta: typeof isHvyDocumentDelta;
      encryptDocumentBytes: typeof encryptDocumentBytes;
      exportDocumentSourceMarkdown: typeof exportDocumentSourceMarkdown;
      serializeDocument: typeof serializeDocument;
      serializeDocumentBytes: typeof serializeDocumentBytes;
      serializeDocumentBytesAsync: typeof serializeDocumentBytesAsync;
      createDocumentFilterSnapshot: typeof createDocumentFilterSnapshot;
      createPdfExportPlan: typeof createPdfExportPlan;
      createPdfExportPlanFromPrompt: typeof createPdfExportPlanFromPrompt;
      searchDocuments: typeof searchDocuments;
      buildDocumentRichTextCopyPayload: typeof buildDocumentRichTextCopyPayload;
      createDocumentSearchSnapshot: typeof createDocumentSearchSnapshot;
      createHostedAttachmentAdapter: typeof createHostedAttachmentAdapter;
      createProxyEmbeddingProvider: typeof createProxyEmbeddingProvider;
      planEmbeddingIndexUpdate: typeof planEmbeddingIndexUpdate;
      prepareEmbeddingChatContext: typeof prepareEmbeddingChatContext;
      readEmbeddingIndexFromDocumentBytes: typeof readEmbeddingIndexFromDocumentBytes;
      getPdfExportPromptTemplates: typeof getPdfExportPromptTemplates;
      renderPdfExportPromptTemplate: typeof renderPdfExportPromptTemplate;
      mountHvy: typeof mountHvy;
      mountHvyViewer: typeof mountHvyViewer;
      plugins: typeof builtInPluginMap;
      builtInPlugins: typeof builtInPlugins;
    };
    HVY_CHAT_CLIENT?: HostChatClient;
  }
}

window.HVY = {
  applyHvyDocumentDelta,
  createHvyDocumentDelta,
  deserializeDocumentBytes,
  deserializeDocumentBytesAsync,
  isHvyDocumentDelta,
  encryptDocumentBytes,
  exportDocumentSourceMarkdown,
  serializeDocument,
  serializeDocumentBytes,
  serializeDocumentBytesAsync,
  createDocumentFilterSnapshot,
  createPdfExportPlan,
  createPdfExportPlanFromPrompt,
  searchDocuments,
  buildDocumentRichTextCopyPayload,
  createDocumentSearchSnapshot,
  createHostedAttachmentAdapter,
  createProxyEmbeddingProvider,
  planEmbeddingIndexUpdate,
  prepareEmbeddingChatContext,
  readEmbeddingIndexFromDocumentBytes,
  getPdfExportPromptTemplates,
  renderPdfExportPromptTemplate,
  mountHvy,
  mountHvyViewer,
  plugins: builtInPluginMap,
  builtInPlugins,
};
