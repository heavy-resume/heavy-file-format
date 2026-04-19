import './style.css';
import 'highlight.js/styles/github.css';

import { createEditorRenderer, type EditorRenderer } from './editor/render';
import { createReaderRenderer, type ReaderRenderer } from './reader/render';
import { getTemplateFields, renderTemplatePanel } from './editor/template';

import { state, initState, initCallbacks, incrementRenderCount, incrementRefreshReaderCount } from './state';
import type { AppState } from './types';
import { escapeAttr, escapeHtml } from './utils';
import { applyTheme, getThemeConfig } from './theme';
import { flattenSections, findSectionByKey, findDuplicateSectionIds, getSectionId, formatSectionTitle, isDefaultUntitledSectionTitle } from './section-ops';
import { renderComponentOptions, renderReusableSectionOptions, getComponentDefs, getSectionDefs, isBuiltinComponent } from './component-defs';
import { renderOption } from './utils';
import { resolveBaseComponent } from './component-defs';
import { ensureContainerBlocks, ensureComponentListBlocks, ensureExpandableBlocks, ensureGridItems } from './document-factory';
import { isActiveEditorSectionTitle, isActiveEditorBlock, getComponentRenderHelpers, findBlockByIds } from './block-ops';
import { commitHistorySnapshot, renderStateTracker } from './history';
import { capturePaneScroll, restorePaneScroll, centerPendingEditorSection, focusPendingSectionTitleEditor } from './scroll';
import { bindUi } from './bind-ui';
import { deserializeDocument } from './serialization';
import bundledExampleHvy from '../examples/example.hvy?raw';

const appRoot = document.querySelector<HTMLDivElement>('#app');
if (!appRoot) {
  throw new Error('App container not found.');
}
const app = appRoot;

app.innerHTML = '<main class="layout"><section class="pane full-pane"><p>Loading editor...</p></section></main>';

function createDefaultDocument() {
  return deserializeDocument(bundledExampleHvy, '.hvy');
}

function createInitialState(): AppState {
  return {
    document: createDefaultDocument(),
    filename: 'example.hvy',
    currentView: 'editor',
    paneScroll: {
      editorTop: 0,
      editorSidebarTop: 0,
      readerTop: 0,
      windowTop: 0,
    },
    showAdvancedEditor: false,
    activeEditorBlock: null,
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
    themeModalOpen: false,
    gridAddComponentByBlock: {},
    expandableEditorPanels: {},
    viewerSidebarOpen: false,
    editorSidebarOpen: false,
    lastHistoryGroup: null,
    lastHistoryAt: 0,
    pendingEditorCenterSectionKey: null,
  };
}

initState(createInitialState());

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
      return state.showAdvancedEditor;
    },
    get addComponentBySection() {
      return state.addComponentBySection;
    },
    get activeEditorBlock() {
      return state.activeEditorBlock;
    },
    get expandableEditorPanels() {
      return state.expandableEditorPanels;
    },
  },
  {
    escapeAttr,
    escapeHtml,
    flattenSections,
    renderReaderBlock: (section, block) => readerRenderer.renderReaderBlock(section, block),
    renderComponentOptions,
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
    getComponentDefs,
    getSectionDefs,
    getThemeConfig,
    getComponentRenderHelpers: localGetComponentRenderHelpers,
    isBuiltinComponent,
  }
);

readerRenderer = createReaderRenderer(
  {
    get documentSections() {
      return state.document.sections;
    },
    get tempHighlights() {
      return state.tempHighlights;
    },
    get modalSectionKey() {
      return state.modalSectionKey;
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
  const isAdvancedEditor = state.showAdvancedEditor;

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
          <button id="resumeTemplateBtn" type="button">Resume Template</button>
          <button id="resumeExampleBtn" type="button">Resume Example</button>
          <label class="file-picker">
            Select File
            <input id="fileInput" type="file" accept=".hvy,.thvy,.md,text/markdown,text/plain" />
          </label>
          <input id="downloadName" type="text" value="${escapeAttr(state.filename)}" aria-label="Download file name" />
          <button id="downloadBtn" type="button">Download File</button>
        </div>
      </header>

      <section class="workspace-shell">
        <div class="workspace-head">
          <div class="view-tabs" role="tablist" aria-label="Workspace view">
            <button type="button" class="${isEditorView ? 'secondary' : 'ghost'}" data-action="switch-view" data-view="editor">Editor</button>
            <button type="button" class="${!isEditorView ? 'secondary' : 'ghost'}" data-action="switch-view" data-view="viewer">Viewer</button>
          </div>
          ${
            isEditorView
              ? `<div class="editor-top-controls">
                  <button type="button" class="${!isAdvancedEditor ? 'secondary' : 'ghost'}" data-action="set-editor-mode" data-editor-mode="basic">Basic</button>
                  <button type="button" class="${isAdvancedEditor ? 'secondary' : 'ghost'}" data-action="set-editor-mode" data-editor-mode="advanced">Advanced</button>
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
              ? `${isAdvancedEditor ? renderTemplatePanel(templateFields, state.templateValues, { escapeAttr, escapeHtml }) : ''}
                ${isAdvancedEditor && state.metaPanelOpen ? editorRenderer.renderMetaPanel() : ''}
                ${isAdvancedEditor ? renderStateTracker() : ''}
                <div class="editor-shell ${state.editorSidebarOpen ? 'is-sidebar-open' : 'is-sidebar-closed'}">
                  <div class="editor-sidebar-backdrop" data-action="toggle-editor-sidebar"></div>
                  <aside class="editor-sidebar">
                    <button type="button" class="editor-sidebar-tab" data-action="toggle-editor-sidebar" aria-expanded="${state.editorSidebarOpen ? 'true' : 'false'}" aria-label="Toggle sidebar">☰</button>
                    <div class="editor-sidebar-panel">
                      ${editorRenderer.renderSidebarEditorSections(state.document.sections)}
                    </div>
                  </aside>
                  <div id="editorTree" class="editor-tree">${editorRenderer.renderSectionEditorTree(state.document.sections)}</div>
                </div>`
              : `<div class="viewer-shell ${state.viewerSidebarOpen ? 'is-sidebar-open' : 'is-sidebar-closed'}">
                   <div class="viewer-sidebar-backdrop" data-action="toggle-viewer-sidebar"></div>
                   <aside class="viewer-sidebar">
                     <button type="button" class="viewer-sidebar-tab" data-action="toggle-viewer-sidebar" aria-expanded="${state.viewerSidebarOpen ? 'true' : 'false'}" aria-label="Toggle navigation">${escapeHtml(String(state.document.meta.sidebar_label || '☰'))}</button>
                     <div class="viewer-sidebar-panel">
                       <div id="readerWarnings" class="reader-warnings">${readerRenderer.renderWarnings()}</div>
                       <!-- TODO: Need to figure out what to do with navigation in the sidebar -->
                       <!-- <div id="readerNav" class="reader-nav">${readerRenderer.renderNavigation(state.document.sections)}</div> -->
                       <div id="readerSidebarSections" class="reader-sidebar-sections">${readerRenderer.renderSidebarSections(state.document.sections)}</div>
                     </div>
                   </aside>
                   <div id="readerDocument" class="reader-document">${readerRenderer.renderReaderSections(state.document.sections)}</div>
                 </div>`
          }
        </div>
      </section>

      ${readerRenderer.renderModal()}
      ${readerRenderer.renderLinkInlineModal()}
    </main>
  `;
  markupMs = performance.now() - stepStartedAt;

  stepStartedAt = performance.now();
  app.innerHTML = markup;
  domMs = performance.now() - stepStartedAt;

  stepStartedAt = performance.now();
  bindUi(app);
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
    historyLength: state.history.length,
  });
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
  const sidebarSections = app.querySelector<HTMLDivElement>('#readerSidebarSections');
  const reader = app.querySelector<HTMLDivElement>('#readerDocument');

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
    reader.innerHTML = readerRenderer.renderReaderSections(state.document.sections);
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
});

try {
  renderApp();
} catch (error) {
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
}
