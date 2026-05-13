import './default-theme.css';
import './host-overrides.css';
import './style.css';
import 'highlight.js/styles/github.css';

import { createEditorRenderer, type EditorRenderer } from './editor/render';
import { createReaderRenderer, type ReaderRenderer } from './reader/render';
import { state, initState, initCallbacks } from './state';
import type { AppState, VisualDocument } from './types';
import { deserializeDocumentBytes, serializeDocument } from './serialization';
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
import { bindUi } from './bind-ui';
import { bindClickActions } from './bind/handlers/click-actions';
import { bindInputBlock } from './bind/handlers/input-block';
import { capturePluginFocus, reconcilePluginMounts } from './plugins/mount';
import { registerHostPlugin, SCRIPTING_PLUGIN_ID } from './plugins/registry';
import {
  getBuiltInScriptingPluginVersion,
  isBuiltInPluginEnabled,
  registerBuiltInPlugins,
  runBuiltInScriptingPlugin,
  setBuiltInScriptingResult,
} from 'virtual:hvy-built-in-plugins';
import { runButtonVisibilityScripts } from './editor/components/button/button-actions';
import { visitBlocksInList } from './section-ops';
import { createDefaultChatState } from './chat/chat';
import { renderChatPanel, setHostChatClient, type HostChatClient } from './chat/chat';
import { renderAiEditPopover, renderAiModeHint } from './ai-mode-ui';
import { createDefaultSearchState } from './search/state';
import { renderSearchLauncher, renderSearchPalette } from './search/render';
import { loadPaletteOverrideId } from './palettes/palette-preferences';

export type HvyEmbedMode = 'viewer' | 'editor' | 'ai';

export interface HvyMountOptions {
  root: HTMLElement;
  document: VisualDocument;
  mode?: HvyEmbedMode;
  showAdvancedEditor?: boolean;
  chatClient?: HostChatClient | null;
  controls?: boolean;
  paletteId?: string | null;
}

export interface HvyMount {
  destroy(): void;
  getDocument(): VisualDocument;
  setPaletteOverrideId(id: string | null): void;
  openThemeEditor(options?: { advanced?: boolean }): void;
  mountThemeEditor(root: HTMLElement, options?: { advanced?: boolean; includePalettePicker?: boolean }): void;
}

let editorRenderer: EditorRenderer;
let readerRenderer: ReaderRenderer;
let currentRoot: HTMLElement | null = null;
let lastScriptedDocument: VisualDocument | null = null;
let lastScriptedSignature = '';

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
    paneScroll: { editorTop: 0, editorSidebarTop: 0, viewerSidebarTop: 0, readerTop: 0, windowTop: 0 },
    showAdvancedEditor,
    rawEditorText: serializeDocument(document),
    rawEditorError: null,
    rawEditorDiagnostics: [],
    cliDraft: '',
    cliSession: { cwd: '/' },
    cliHistory: [],
    activeEditorBlock: null,
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
    tempHighlights: new Set<string>(),
    addComponentBySection: {},
    metaPanelOpen: false,
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
      get componentPlacement() { return state.componentPlacement; },
      get pendingEditorActivation() { return state.pendingEditorActivation; },
      get expandableEditorPanels() { return state.expandableEditorPanels; },
      get editorSidebarHelpDismissed() { return state.editorSidebarHelpDismissed; },
      get currentView() { return state.currentView; },
      get responsivePreview() { return state.responsivePreview; },
      get mobileAdjustmentMode() { return state.editorMode === 'mobile-adjustment'; },
      get descriptionPopulate() { return state.descriptionPopulate; },
    },
    {
      escapeAttr,
      escapeHtml,
      flattenSections,
      renderReaderBlock: (section, block) => readerRenderer.renderReaderBlock(section, block),
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
      get modalSectionKey() { return state.modalSectionKey; },
      get sqliteRowComponentModal() { return state.sqliteRowComponentModal; },
      get dbTableQueryModal() { return state.dbTableQueryModal; },
      get reusableSaveModal() { return state.reusableSaveModal; },
      get reusableTemplateModal() { return state.reusableTemplateModal; },
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
      renderBlockMetaFields: (sectionKey, block) => editorRenderer.renderBlockMetaFields(sectionKey, block),
    }
  );
}

function renderApp(): void {
  if (!currentRoot) return;
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
                      <div id="${isAi ? 'aiSidebarSections' : 'readerSidebarSections'}" class="reader-sidebar-sections">${readerRenderer.renderSidebarSections(state.document.sections)}</div>
                    </div>
                  </aside>
                  <div id="${isAi ? 'aiReaderDocument' : 'readerDocument'}" class="reader-document">${readerRenderer.renderReaderSections(state.document.sections)}</div>
                  ${isAi ? `${renderAiModeHint(state, { escapeAttr, escapeHtml })}${renderAiEditPopover(state, { escapeAttr, escapeHtml })}` : ''}
                </div>`
          }
          ${renderChatPanel(
            state.chat,
            state.document,
            { escapeAttr, escapeHtml },
            state.currentView === 'viewer' ? 'qa' : 'document-edit',
            state.currentView === 'editor' || state.currentView === 'ai'
          )}
          ${renderSearchLauncher(state.search)}
          ${renderSearchPalette(state.search, state.document, { escapeAttr, escapeHtml, readerRenderer })}
        </div>
      </section>
      ${readerRenderer.renderModal()}
      ${readerRenderer.renderLinkInlineModal()}
    </main>`;
  bindUi(currentRoot);
  reconcilePluginMounts(currentRoot);
  void runButtonVisibilityScripts(currentRoot);
  void runScriptingBlocksIfNeeded();
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
  const reader = currentRoot.querySelector<HTMLDivElement>('#readerDocument') ?? currentRoot.querySelector<HTMLDivElement>('#aiReaderDocument');
  if (!reader) return;
  capturePluginFocus();
  reader.innerHTML = readerRenderer.renderReaderSections(state.document.sections);
  reconcilePluginMounts(reader);
  void runButtonVisibilityScripts(reader);
}

function refreshModalPreview(): void {}

async function runScriptingBlocksIfNeeded(): Promise<void> {
  if (!isBuiltInPluginEnabled(SCRIPTING_PLUGIN_ID)) return;
  if (state.currentView !== 'viewer' && state.currentView !== 'ai') return;
  const targets: Array<{ sectionKey: string; blockId: string; source: string; pluginVersion: string; componentId: string }> = [];
  for (const section of state.document.sections) {
    visitBlocksInSection(section as never, section.key, targets);
  }
  const signature = targets.map((target) => `${target.sectionKey}\u0000${target.blockId}\u0000${target.pluginVersion}\u0000${target.source}`).join('\u0001');
  if (state.document === lastScriptedDocument && signature === lastScriptedSignature) return;
  lastScriptedDocument = state.document;
  lastScriptedSignature = signature;
  for (const target of targets) {
    const result = await runBuiltInScriptingPlugin({
      document: state.document,
      source: target.source,
      componentId: target.componentId,
      pluginVersion: target.pluginVersion,
    });
    if (!result) continue;
    const mount = currentRoot?.querySelector<HTMLElement>(
      `[data-scripting-mount="true"][data-scripting-section-key="${cssEscape(target.sectionKey)}"][data-scripting-block-id="${cssEscape(target.blockId)}"]`
    );
    if (mount) await setBuiltInScriptingResult(mount, result, target.source);
  }
}

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/(["\\])/g, '\\$1');
}

function visitBlocksInSection(
  section: { key: string; blocks: Array<{ id: string; text: string; schema: { id?: string; component: string; plugin: string; pluginConfig?: unknown } }>; children: unknown[] },
  sectionKey: string,
  out: Array<{ sectionKey: string; blockId: string; source: string; pluginVersion: string; componentId: string }>
): void {
  visitBlocksInList(section.blocks as never, (block) => {
    if (block.schema.component === 'plugin' && block.schema.plugin === SCRIPTING_PLUGIN_ID) {
      out.push({
        sectionKey,
        blockId: block.id,
        source: block.text ?? '',
        componentId: typeof block.schema.id === 'string' ? block.schema.id : '',
        pluginVersion: getBuiltInScriptingPluginVersion(block.schema.pluginConfig),
      });
    }
  });
  for (const child of section.children as Array<typeof section>) {
    visitBlocksInSection(child, child.key, out);
  }
}

function ensureEmbedRuntime(): void {
  ensureRenderers();
  initCallbacks({
    renderApp,
    refreshReaderPanels,
    refreshModalPreview,
    componentRenderHelpers: localGetComponentRenderHelpers(),
    readerRenderer,
  });
  registerBuiltInPlugins(registerHostPlugin);
  initColorModeSync();
}

export function mountHvy(options: HvyMountOptions): HvyMount {
  currentRoot = options.root;
  options.root.classList.add('hvy-document');
  setThemeRoot(options.root);
  initState(createEmbedState(options.document, options.mode ?? 'viewer', options.showAdvancedEditor ?? false));
  if (options.paletteId && getPaletteById(options.paletteId)) {
    state.paletteOverrideId = options.paletteId;
  }
  setHostChatClient(options.chatClient ?? window.HVY_CHAT_CLIENT ?? null);
  ensureEmbedRuntime();
  renderApp();
  return {
    destroy() {
      options.root.innerHTML = '';
      setHostChatClient(null);
      if (currentRoot === options.root) {
        currentRoot = null;
        setThemeRoot(null);
      }
    },
    getDocument() {
      return state.document;
    },
    setPaletteOverrideId,
    openThemeEditor,
    mountThemeEditor,
  };
}

export function mountHvyViewer(options: Omit<HvyMountOptions, 'mode'>): HvyMount {
  return mountHvy({ ...options, mode: 'viewer' });
}

export { deserializeDocumentBytes, serializeDocument };

declare global {
  interface Window {
    HVY?: {
      deserializeDocumentBytes: typeof deserializeDocumentBytes;
      serializeDocument: typeof serializeDocument;
      mountHvy: typeof mountHvy;
      mountHvyViewer: typeof mountHvyViewer;
    };
    HVY_CHAT_CLIENT?: HostChatClient;
  }
}

window.HVY = {
  deserializeDocumentBytes,
  serializeDocument,
  mountHvy,
  mountHvyViewer,
};
