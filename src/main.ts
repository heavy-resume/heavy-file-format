import './default-theme.css';
import './style.css';
import './state-tracker.css';
import 'highlight.js/styles/github.css';
import bundledExampleHvyUrl from '../examples/example.hvy?url';

import { createEditorRenderer, type EditorRenderer } from './editor/render';
import { createReaderRenderer, type ReaderRenderer } from './reader/render';
import { getTemplateFields, renderTemplatePanel } from './editor/template';

import { state, initState, initCallbacks, incrementRenderCount, incrementRefreshReaderCount } from './state';
import type { AppState } from './types';
import { escapeAttr, escapeHtml } from './utils';
import { applyTheme, getThemeConfig, initColorModeSync } from './theme';
import { flattenSections, findSectionByKey, findDuplicateSectionIds, getSectionId, formatSectionTitle, isDefaultUntitledSectionTitle, buildSectionRenderSequence } from './section-ops';
import { renderComponentOptions, renderReusableSectionOptions, getComponentDefs, getSectionDefs, isBuiltinComponent } from './component-defs';
import { renderOption } from './utils';
import { resolveBaseComponent } from './component-defs';
import { ensureContainerBlocks, ensureComponentListBlocks, ensureExpandableBlocks, ensureGridItems } from './document-factory';
import { isActiveEditorSectionTitle, isActiveEditorBlock, getComponentRenderHelpers, findBlockByIds } from './block-ops';
import { commitHistorySnapshot } from './history';
import { capturePaneScroll, restorePaneScroll, centerPendingEditorSection, focusPendingSectionTitleEditor, scrollPendingEditorActivation } from './scroll';
import { bindUi } from './bind-ui';
import { deserializeDocumentBytes, serializeDocument } from './serialization';
import { createDefaultChatState, renderChatPanel } from './chat/chat';
import { registerHostPlugin, SCRIPTING_PLUGIN_ID } from './plugins/registry';
import { reconcilePluginMounts, capturePluginFocus } from './plugins/mount';
import { dbTablePluginRegistration } from './plugins/db-table-plugin';
import { formPluginRegistration } from './plugins/form';
import { progressBarPluginRegistration } from './plugins/progress-bar';
import { scriptingPluginRegistration, setScriptingResult } from './plugins/scripting/scripting';
import { runUserScript } from './plugins/scripting/wrapper';
import { getScriptingPluginVersion } from './plugins/scripting/version';
import { visitBlocksInList } from './section-ops';

const appRoot = document.querySelector<HTMLDivElement>('#app');
if (!appRoot) {
  throw new Error('App container not found.');
}
const app = appRoot;

app.innerHTML = '<main class="layout"><section class="pane full-pane"><p>Loading editor...</p></section></main>';

async function createDefaultDocument() {
  const response = await fetch(bundledExampleHvyUrl);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return deserializeDocumentBytes(bytes, '.hvy');
}

function createInitialState(document: ReturnType<typeof deserializeDocumentBytes>): AppState {
  return {
    document,
    filename: 'example.hvy',
    currentView: 'editor',
    editorMode: 'basic',
    chat: createDefaultChatState(),
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
      editorTop: 0,
      editorSidebarTop: 0,
      viewerSidebarTop: 0,
      readerTop: 0,
      windowTop: 0,
    },
    showAdvancedEditor: false,
    rawEditorText: serializeDocument(document),
    rawEditorError: null,
    rawEditorDiagnostics: [],
    activeEditorBlock: null,
    pendingEditorActivation: null,
    activeEditorSectionTitleKey: null,
    clearSectionTitleOnFocusKey: null,
    modalSectionKey: null,
    reusableSaveModal: null,
    tempHighlights: new Set<string>(),
    addComponentBySection: {},
    metaPanelOpen: false,
    selectedReusableComponentName: null,
    templateValues: {},
    history: [],
    future: [],
    isRestoring: false,
    componentMetaModal: null,
    sqliteRowComponentModal: null,
    dbTableQueryModal: null,
    themeModalOpen: false,
    gridAddComponentByBlock: {},
    expandableEditorPanels: {},
    viewerSidebarOpen: false,
    editorSidebarOpen: false,
    editorSidebarHelpDismissed: false,
    lastHistoryGroup: null,
    lastHistoryAt: 0,
    pendingEditorCenterSectionKey: null,
  };
}

function renderAiEditPopover(): string {
  if (!state.aiEdit.sectionKey || !state.aiEdit.blockId) {
    return '';
  }

  const popupStyle = `left: ${state.aiEdit.popupX}px; top: ${state.aiEdit.popupY}px;`;
  const providerLabel = state.chat.settings.provider === 'openai' ? 'OpenAI' : 'Anthropic';
  const canSend = !state.aiEdit.isSending;

  return `
    <section class="ai-edit-popover" style="${escapeAttr(popupStyle)}" aria-label="Request AI component changes">
      <div class="ai-edit-popover-head">
        <div>
          <h3>Request changes</h3>
        </div>
        <button type="button" class="ghost" data-action="close-ai-edit" aria-label="Close request changes">Close</button>
      </div>
      <div class="ai-edit-settings">
        <label class="chat-setting">
          <span>Provider</span>
          <select data-field="ai-provider" aria-label="AI edit provider" ${state.aiEdit.isSending ? 'disabled' : ''}>
            <option value="openai"${state.chat.settings.provider === 'openai' ? ' selected' : ''}>OpenAI</option>
            <option value="anthropic"${state.chat.settings.provider === 'anthropic' ? ' selected' : ''}>Anthropic</option>
          </select>
        </label>

        <label class="chat-setting">
          <span>Model</span>
          <input
            type="text"
            data-field="ai-model"
            value="${escapeAttr(state.chat.settings.model)}"
            placeholder="${escapeAttr(providerLabel === 'OpenAI' ? 'gpt-5-mini' : 'claude-sonnet-4-6')}"
            autocapitalize="off"
            autocomplete="off"
            spellcheck="false"
            aria-label="AI edit model"
            ${state.aiEdit.isSending ? 'disabled' : ''}
          />
        </label>
      </div>
      ${state.aiEdit.error ? `<div class="ai-edit-error" role="alert">${escapeHtml(state.aiEdit.error)}</div>` : ''}
      <form id="aiEditComposer" class="ai-edit-composer">
        <label class="chat-composer-field">
          <span>Change request</span>
          <textarea data-field="ai-edit-input" rows="5" placeholder="Describe what should change in this component..." ${state.aiEdit.isSending ? 'disabled' : ''}>${escapeHtml(state.aiEdit.draft)}</textarea>
        </label>
        <div class="chat-composer-actions">
          <span class="chat-composer-status">
            ${
              state.aiEdit.isSending
                ? 'Waiting for updated component...'
                : 'Describe the change you want, then send.'
            }
          </span>
          <button type="submit" class="secondary"${canSend ? '' : ' disabled'}>${state.aiEdit.isSending ? 'Sending...' : 'Send'}</button>
        </div>
      </form>
    </section>
  `;
}

let editorRenderer: EditorRenderer;
let readerRenderer: ReaderRenderer;

function localGetComponentRenderHelpers() {
  return getComponentRenderHelpers(editorRenderer, readerRenderer);
}

editorRenderer = createEditorRenderer(
  {
    get documentMeta() {
      return state.document.meta as Record<string, unknown>;
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
    get pendingEditorActivation() {
      return state.pendingEditorActivation;
    },
    get expandableEditorPanels() {
      return state.expandableEditorPanels;
    },
    get editorSidebarHelpDismissed() {
      return state.editorSidebarHelpDismissed;
    },
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
    get documentMeta() {
      return state.document.meta;
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
    get modalSectionKey() {
      return state.modalSectionKey;
    },
    get sqliteRowComponentModal() {
      return state.sqliteRowComponentModal;
    },
    get dbTableQueryModal() {
      return state.dbTableQueryModal;
    },
    get reusableSaveModal() {
      return state.reusableSaveModal;
    },
    get componentMetaModal() {
      return state.componentMetaModal;
    },
    get themeModalOpen() {
      return state.themeModalOpen;
    },
    get theme() {
      return getThemeConfig();
    },
    get currentView() {
      return state.currentView;
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
    renderEditorBlock: (sectionKey, block) => editorRenderer.renderEditorBlock(sectionKey, block, state.document.sections),
    renderBlockContentEditor: (sectionKey, block) => editorRenderer.renderBlockContentEditor(sectionKey, block),
    renderComponentOptions,
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
  state.paneScroll = capturePaneScroll(state.paneScroll, app);
  captureMs = performance.now() - stepStartedAt;

  stepStartedAt = performance.now();
  applyTheme();
  themeMs = performance.now() - stepStartedAt;

  const isEditorView = state.currentView === 'editor';
  const isViewerView = state.currentView === 'viewer';
  const isAiView = state.currentView === 'ai';
  const isAdvancedEditor = state.editorMode === 'advanced';
  const isRawEditor = state.editorMode === 'raw';

  stepStartedAt = performance.now();
  const templateFields = getTemplateFields(state.document.meta);
  templateFieldsMs = performance.now() - stepStartedAt;

  stepStartedAt = performance.now();
  const markup = `
    <main class="layout">
      <header class="topbar">
        <div class="title-block">
          <h1>HVY Reference Implementation</h1>
          <p>Visual editor + reader for <code>.hvy</code> and <code>.thvy</code>.</p>
        </div>
        <div class="toolbar">
          <button id="newBtn" type="button" class="toolbar-primary-button">New</button>
          <button id="crmExampleBtn" type="button">CRM Example</button>
          <button id="resumeTemplateBtn" type="button">Resume Template</button>
          <button id="resumeExampleBtn" type="button">Resume Example</button>
          <label class="file-picker">
            Select File
            <input id="fileInput" type="file" accept=".hvy,.thvy,.md,.markdown,text/markdown,text/plain" />
          </label>
          <input id="downloadName" type="text" value="${escapeAttr(state.filename)}" aria-label="Download file name" />
          <button id="downloadBtn" type="button">Download File</button>
        </div>
      </header>

      <section class="workspace-shell">
        <div class="workspace-head">
          <div class="view-tabs" role="tablist" aria-label="Workspace view">
            <button type="button" class="${isEditorView ? 'secondary' : 'ghost'}" data-action="switch-view" data-view="editor">Editor</button>
            <button type="button" class="${isViewerView ? 'secondary' : 'ghost'}" data-action="switch-view" data-view="viewer">Viewer</button>
            <button type="button" class="${isAiView ? 'secondary' : 'ghost'}" data-action="switch-view" data-view="ai">AI</button>
          </div>
          ${
            isEditorView
              ? `<div class="editor-top-controls">
                  <button type="button" class="${state.editorMode === 'basic' ? 'secondary' : 'ghost'}" data-action="set-editor-mode" data-editor-mode="basic">Basic</button>
                  <button type="button" class="${isAdvancedEditor ? 'secondary' : 'ghost'}" data-action="set-editor-mode" data-editor-mode="advanced">Advanced</button>
                  <button type="button" class="${isRawEditor ? 'secondary' : 'ghost'}" data-action="set-editor-mode" data-editor-mode="raw">Raw</button>
                  ${
                    isAdvancedEditor
                      ? `<button type="button" class="${state.metaPanelOpen ? 'secondary' : 'ghost'}" data-action="toggle-document-meta">Document Meta</button>`
                      : ''
                  }
                </div>`
              : ''
          }
        </div>
        <div class="pane ${isEditorView ? 'editor-pane' : 'reader-pane'} full-pane">
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
                  : `${isAdvancedEditor ? renderTemplatePanel(templateFields, state.templateValues, { escapeAttr, escapeHtml }) : ''}
                ${isAdvancedEditor && state.metaPanelOpen ? editorRenderer.renderMetaPanel() : ''}
                <div class="editor-shell ${state.editorSidebarOpen ? 'is-sidebar-open' : 'is-sidebar-closed'}">
                  <div class="editor-sidebar-backdrop" data-action="toggle-editor-sidebar"></div>
                  <aside class="editor-sidebar">
                    <button type="button" class="editor-sidebar-tab" data-action="toggle-editor-sidebar" aria-expanded="${state.editorSidebarOpen ? 'true' : 'false'}" aria-label="Toggle sidebar">☰</button>
                    ${editorRenderer.renderSidebarHelpBalloon(state.document.sections)}
                    <div class="editor-sidebar-panel">
                      ${editorRenderer.renderSidebarEditorSections(state.document.sections)}
                    </div>
                  </aside>
                  <div id="editorTree" class="editor-tree">${editorRenderer.renderSectionEditorTree(state.document.sections)}</div>
                </div>`}`
              : `<div class="viewer-shell ${isAiView ? 'ai-view-shell ' : ''}${state.viewerSidebarOpen ? 'is-sidebar-open' : 'is-sidebar-closed'}">
                   <div class="viewer-sidebar-backdrop" data-action="toggle-viewer-sidebar"></div>
                   <aside class="viewer-sidebar">
                     <button type="button" class="viewer-sidebar-tab" data-action="toggle-viewer-sidebar" aria-expanded="${state.viewerSidebarOpen ? 'true' : 'false'}" aria-label="Toggle navigation">${escapeHtml(String(state.document.meta.sidebar_label || '☰'))}</button>
                     <div class="viewer-sidebar-panel">
                       <div id="readerWarnings" class="reader-warnings">${readerRenderer.renderWarnings()}</div>
                       <!-- TODO: Need to figure out what to do with navigation in the sidebar -->
                       <!-- <div id="readerNav" class="reader-nav">${readerRenderer.renderNavigation(state.document.sections)}</div> -->
                       <div id="${isAiView ? 'aiSidebarSections' : 'readerSidebarSections'}" class="reader-sidebar-sections">${readerRenderer.renderSidebarSections(state.document.sections)}</div>
                     </div>
                   </aside>
                   <div id="${isAiView ? 'aiReaderDocument' : 'readerDocument'}" class="reader-document">${readerRenderer.renderReaderSections(state.document.sections)}</div>
                   ${
                     isAiView
                       ? `${renderAiEditPopover()}`
                       : ''
                   }
                 </div>`
          }
        </div>
      </section>

      ${renderChatPanel(
        state.chat,
        state.document,
        { escapeAttr, escapeHtml },
        isViewerView ? 'qa' : 'document-edit',
        state.currentView === 'editor' || state.currentView === 'ai'
      )}
      ${readerRenderer.renderModal()}
      ${readerRenderer.renderLinkInlineModal()}
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
  bindMs = performance.now() - stepStartedAt;

  stepStartedAt = performance.now();
  restorePaneScroll(state.paneScroll, app);
  restoreMs = performance.now() - stepStartedAt;

  stepStartedAt = performance.now();
  commitHistorySnapshot();
  historyMs = performance.now() - stepStartedAt;

  stepStartedAt = performance.now();
  focusPendingSectionTitleEditor(app);
  centerPendingEditorSection(app);
  scrollPendingEditorActivation(app);
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

  void runScriptingBlocksIfNeeded();
}

function refreshReaderPanels(): void {
  const refreshId = incrementRefreshReaderCount();
  const startedAt = performance.now();
  let warningsMs = 0;
  let navMs = 0;
  let readerMs = 0;
  let modalMs = 0;
  const warnings = app.querySelector<HTMLDivElement>('#readerWarnings');
  const nav = app.querySelector<HTMLDivElement>('#readerNav');
  const sidebarSections =
    app.querySelector<HTMLDivElement>('#readerSidebarSections') ??
    app.querySelector<HTMLDivElement>('#aiSidebarSections');
  const reader =
    app.querySelector<HTMLDivElement>('#readerDocument') ??
    app.querySelector<HTMLDivElement>('#aiReaderDocument');

  if (warnings) {
    const stepStartedAt = performance.now();
    warnings.innerHTML = readerRenderer.renderWarnings();
    warningsMs = performance.now() - stepStartedAt;
  }
  if (nav) {
    const stepStartedAt = performance.now();
    nav.innerHTML = readerRenderer.renderNavigation(state.document.sections);
    navMs = performance.now() - stepStartedAt;
  }
  if (sidebarSections) {
    sidebarSections.innerHTML = readerRenderer.renderSidebarSections(state.document.sections);
  }
  if (reader) {
    const stepStartedAt = performance.now();
    capturePluginFocus();
    reader.innerHTML = readerRenderer.renderReaderSections(state.document.sections);
    reconcilePluginMounts(reader);
    readerMs = performance.now() - stepStartedAt;
  }

  const modalStartedAt = performance.now();
  refreshModalPreview();
  modalMs = performance.now() - modalStartedAt;
  console.debug('[hvy:perf] refreshReaderPanels', {
    refreshId,
    elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
    warningsMs: Number(warningsMs.toFixed(2)),
    navMs: Number(navMs.toFixed(2)),
    readerMs: Number(readerMs.toFixed(2)),
    modalMs: Number(modalMs.toFixed(2)),
  });
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

// Initialize late-bound callbacks so all modules can access renderApp/refreshReaderPanels
initCallbacks({
  renderApp,
  refreshReaderPanels,
  refreshModalPreview,
  componentRenderHelpers: localGetComponentRenderHelpers(),
  readerRenderer,
});

// Register the reference-implementation built-in plugins. Hosts that embed
// this codebase can call setHostPlugins / registerHostPlugin before first
// render to add their own.
registerHostPlugin(dbTablePluginRegistration);
registerHostPlugin(formPluginRegistration);
registerHostPlugin(progressBarPluginRegistration);
registerHostPlugin(scriptingPluginRegistration);

// Run scripting blocks once per loaded document. Re-runs whenever the
// document reference changes (file open, example load, new doc, etc.).
let lastScriptedDocument: typeof state.document | null = null;

async function runScriptingBlocksIfNeeded(): Promise<void> {
  if (state.currentView !== 'viewer' && state.currentView !== 'ai') {
    return;
  }
  if (state.document === lastScriptedDocument) {
    return;
  }
  lastScriptedDocument = state.document;

  const targets: Array<{ sectionKey: string; blockId: string; source: string; pluginVersion: string; componentId: string }> = [];
  for (const section of state.document.sections) {
    visitSectionForScripts(section, targets);
  }
  if (targets.length === 0) {
    return;
  }

  for (const target of targets) {
    const result = await runUserScript({
      document: state.document,
      source: target.source,
      componentId: target.componentId,
      pluginVersion: target.pluginVersion,
    });
    const mountSelector = `[data-scripting-mount="true"][data-scripting-section-key="${cssEscape(target.sectionKey)}"][data-scripting-block-id="${cssEscape(target.blockId)}"]`;
    const mount = app.querySelector<HTMLElement>(mountSelector);
    if (mount) {
      setScriptingResult(mount, result);
    }
  }
}

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/(["\\])/g, '\\$1');
}

function visitSectionForScripts(
  section: { key: string; blocks: { id: string; text: string; schema: { id?: string; component: string; plugin: string } }[]; children: unknown[] },
  out: Array<{ sectionKey: string; blockId: string; source: string; pluginVersion: string; componentId: string }>
): void {
  visitBlocksInSection(section, section.key, out);
}

function visitBlocksInSection(
  section: { key: string; blocks: { id: string; text: string; schema: { id?: string; component: string; plugin: string } }[]; children: unknown[] },
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
        pluginVersion: getScriptingPluginVersion(block.schema.pluginConfig),
      });
    }
  });
  for (const child of section.children as Array<typeof section>) {
    visitBlocksInSection(child, child.key, out);
  }
}

async function bootstrap(): Promise<void> {
  initState(createInitialState(await createDefaultDocument()));
  initColorModeSync();
  renderApp();
}

bootstrap().catch((error) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  app.innerHTML = `
    <main class="layout">
      <section class="pane full-pane">
        <h2>Startup Problem</h2>
        <p>The app failed before the first render.</p>
        <pre>${escapeHtml(message)}</pre>
      </section>
    </main>
  `;
  throw error;
});
