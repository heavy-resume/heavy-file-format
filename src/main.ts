import './default-theme.css';
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
import { capturePaneScroll, restorePaneScroll, centerPendingEditorSection, focusPendingSectionTitleEditor, scrollPendingEditorActivation, scrollPendingEditorDeactivation } from './scroll';
import { bindUi } from './bind-ui';
import { deserializeDocumentBytes, serializeDocument } from './serialization';
import { DEFAULT_OPENAI_COMPACTION_MODEL, createDefaultChatState, renderChatPanel } from './chat/chat';
import { captureChatThreadScroll, restoreChatThreadScroll } from './chat/chat-thread-ui';
import { loadResumeState, saveResumeState } from './state-persistence';
import { registerHostPlugin, SCRIPTING_PLUGIN_ID } from './plugins/registry';
import { reconcilePluginMounts, capturePluginFocus } from './plugins/mount';
import { dbTablePluginRegistration } from './plugins/db-table-plugin';
import { formPluginRegistration } from './plugins/form';
import { progressBarPluginRegistration } from './plugins/progress-bar';
import { scriptingPluginRegistration, setScriptingResult } from './plugins/scripting/scripting';
import { runUserScript } from './plugins/scripting/wrapper';
import { getScriptingPluginVersion } from './plugins/scripting/version';
import { runButtonVisibilityScripts } from './editor/components/button/button-actions';
import { visitBlocksInList } from './section-ops';
import { centerSearchResultLenses, renderCollapsedSearchBar, renderSearchLauncher, renderSearchPalette } from './search/render';
import { createDefaultSearchState } from './search/state';
import { loadPaletteOverrideId } from './palettes/palette-preferences';

const appRoot = document.querySelector<HTMLDivElement>('#app');
if (!appRoot) {
  throw new Error('App container not found.');
}
const app = appRoot;
app.classList.add('hvy-document');
setThemeRoot(app);
const READER_HIGHLIGHT_GLOW_MS = 6000;
let readerHighlightGlowObserver: IntersectionObserver | null = null;
let readerHighlightGlowSignature = '';
let readerHighlightGlowSeenTargets = new Set<string>();
window.addEventListener('hvy:viewer-sidebar-open-changed', () => {
  window.requestAnimationFrame(() => scheduleReaderHighlightGlow(app));
});

app.innerHTML = '<main class="layout hvy-embed-layout"><section class="pane full-pane"><p>Loading editor...</p></section></main>';

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

function applyResumeState(initial: AppState, resume: ReturnType<typeof loadResumeState>): AppState {
  if (!resume) {
    return initial;
  }
  return {
    ...initial,
    document: resume.document,
    filename: resume.filename,
    selectedExample: resume.selectedExample,
    currentView: resume.currentView,
    editorMode: resume.editorMode,
    showAdvancedEditor: resume.showAdvancedEditor,
    rawEditorText: resume.rawEditorText || serializeDocument(resume.document),
    templateValues: resume.templateValues,
    chat: {
      ...initial.chat,
      settings: resume.chat.settings,
      draft: resume.chat.draft,
      messages: resume.chat.messages,
      panelOpen: resume.chat.panelOpen,
    },
    cliDraft: resume.cli.draft,
    cliSession: resume.cli.session,
    cliHistory: resume.cli.history,
  };
}

function bindResumePersistence(): void {
  window.addEventListener('beforeunload', () => saveResumeState(state));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      saveResumeState(state);
    }
  });
  window.addEventListener('pagehide', () => saveResumeState(state));
}

function renderAiEditPopover(): string {
  if (!state.aiEdit.sectionKey || !state.aiEdit.blockId) {
    return '';
  }
  if (state.aiEdit.isSending) {
    return '';
  }

  const popupStyle = `left: ${state.aiEdit.popupX}px; top: ${state.aiEdit.popupY}px;`;
  const providerLabel = state.chat.settings.provider === 'openai' ? 'OpenAI' : state.chat.settings.provider === 'qwen' ? 'Qwen' : 'Anthropic';

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
          <select data-field="ai-provider" aria-label="AI edit provider">
            <option value="openai"${state.chat.settings.provider === 'openai' ? ' selected' : ''}>OpenAI</option>
            <option value="anthropic"${state.chat.settings.provider === 'anthropic' ? ' selected' : ''}>Anthropic</option>
            <option value="qwen"${state.chat.settings.provider === 'qwen' ? ' selected' : ''}>Qwen</option>
          </select>
        </label>

        <label class="chat-setting">
          <span>Model</span>
          <input
            type="text"
            data-field="ai-model"
            value="${escapeAttr(state.chat.settings.model)}"
            placeholder="${escapeAttr(providerLabel === 'OpenAI' ? 'gpt-5.4-mini' : providerLabel === 'Qwen' ? 'qwen-plus' : 'claude-sonnet-4-6')}"
            autocapitalize="off"
            autocomplete="off"
            spellcheck="false"
            aria-label="AI edit model"
          />
        </label>

        <label class="chat-setting">
          <span>Compaction provider</span>
          <select data-field="chat-compaction-provider" aria-label="AI edit compaction provider">
            <option value="openai"${(state.chat.settings.compactionProvider ?? 'openai') === 'openai' ? ' selected' : ''}>OpenAI</option>
            <option value="anthropic"${state.chat.settings.compactionProvider === 'anthropic' ? ' selected' : ''}>Anthropic</option>
          </select>
        </label>

        <label class="chat-setting">
          <span>Compaction model</span>
          <input
            type="text"
            data-field="chat-compaction-model"
            value="${escapeAttr(state.chat.settings.compactionModel ?? DEFAULT_OPENAI_COMPACTION_MODEL)}"
            placeholder="${escapeAttr(DEFAULT_OPENAI_COMPACTION_MODEL)}"
            autocapitalize="off"
            autocomplete="off"
            spellcheck="false"
            aria-label="AI edit compaction model"
          />
        </label>
      </div>
      ${state.aiEdit.error ? `<div class="ai-edit-error" role="alert">${escapeHtml(state.aiEdit.error)}</div>` : ''}
      <form id="aiEditComposer" class="ai-edit-composer">
        <label class="chat-composer-field">
          <span>Change request</span>
          <textarea data-field="ai-edit-input" rows="5" placeholder="Describe what should change in this component...">${escapeHtml(state.aiEdit.draft)}</textarea>
        </label>
        <div class="chat-composer-actions">
          <span class="chat-composer-status">Describe the change you want, then send.</span>
          <button type="submit" class="secondary">Send</button>
        </div>
      </form>
    </section>
  `;
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
  const clone = target && menu.targetRect ? renderContextMenuTargetClone(target, menu.targetRect) : '';
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
  clone.classList.add('hvy-context-popover-clone');
  clone.classList.remove('is-context-menu-target');
  clone.setAttribute('aria-hidden', 'true');
  clone.removeAttribute('id');
  clone.querySelectorAll('[id]').forEach((element) => {
    element.removeAttribute('id');
  });
  clone.querySelectorAll('input, textarea, select, button, a, [tabindex]').forEach((element) => {
    element.setAttribute('tabindex', '-1');
  });
  clone.style.left = `${rect.left}px`;
  clone.style.top = `${rect.top}px`;
  clone.style.width = `${rect.width}px`;
  clone.style.margin = '0';
  return clone.outerHTML;
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

editorRenderer = createEditorRenderer(
  {
    get documentMeta() {
      return state.document.meta as Record<string, unknown>;
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
    get componentPlacement() {
      return state.componentPlacement;
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
    get currentView() {
      return state.currentView;
    },
    get responsivePreview() {
      return state.responsivePreview;
    },
    get mobileAdjustmentMode() {
      return state.editorMode === 'mobile-adjustment';
    },
    get descriptionPopulate() {
      return state.descriptionPopulate;
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
    get contextMenu() {
      return state.contextMenu ?? null;
    },
    get activeEditorBlock() {
      return state.activeEditorBlock;
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
    get reusableTemplateModal() {
      return state.reusableTemplateModal;
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
  const pendingPaneScrollRestore = state.pendingPaneScrollRestore;
  state.paneScroll = pendingPaneScrollRestore ?? capturePaneScroll(state.paneScroll, app);
  state.pendingPaneScrollRestore = null;
  const chatScroll = captureChatThreadScroll(app);
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

  stepStartedAt = performance.now();
  const templateFields = getTemplateFields(state.document.meta);
  templateFieldsMs = performance.now() - stepStartedAt;

  stepStartedAt = performance.now();
  const markup = `
    <main class="layout hvy-embed-layout">
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
          ${
            isEditorView
              ? `<div class="editor-top-controls">
                  ${
                    isEditorView
                      ? `<button type="button" class="${state.editorMode === 'basic' ? 'secondary' : 'ghost'}" data-action="set-editor-mode" data-editor-mode="basic">Basic</button>
                  <button type="button" class="${isMobileAdjustmentEditor ? 'secondary' : 'ghost'}" data-action="set-editor-mode" data-editor-mode="mobile-adjustment">Mobile Adjustment</button>
                  <button type="button" class="${isAdvancedEditor ? 'secondary' : 'ghost'}" data-action="set-editor-mode" data-editor-mode="advanced">Advanced</button>
                  <button type="button" class="${isRawEditor ? 'secondary' : 'ghost'}" data-action="set-editor-mode" data-editor-mode="raw">Raw</button>`
                      : ''
                  }
                  ${
                    isEditorView && isAdvancedEditor
                      ? `<button type="button" class="${state.metaPanelOpen ? 'secondary' : 'ghost'}" data-action="toggle-document-meta">Document Meta</button>`
                      : ''
                  }
                </div>`
              : '<div></div>'
          }
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
                  ? `<div class="document-meta-view">${editorRenderer.renderMetaPanel()}</div>`
                  : `${isAdvancedEditor ? renderTemplatePanel(templateFields, state.templateValues, { escapeAttr, escapeHtml }) : ''}
                <div${renderResponsivePreviewFrameAttrs(`editor-shell ${state.editorSidebarOpen ? 'is-sidebar-open' : 'is-sidebar-closed'}`)}>
                  <div class="editor-sidebar-backdrop" data-action="toggle-editor-sidebar"></div>
                  <aside class="editor-sidebar">
                    <button type="button" class="editor-sidebar-tab" data-action="toggle-editor-sidebar" aria-expanded="${state.editorSidebarOpen ? 'true' : 'false'}" aria-label="Toggle sidebar"><span class="sidebar-tab-hamburger" aria-hidden="true"></span></button>
                    ${editorRenderer.renderSidebarHelpBalloon(state.document.sections)}
                    <div class="editor-sidebar-panel">
                      ${editorRenderer.renderSidebarEditorSections(state.document.sections)}
                    </div>
                  </aside>
                  <div id="editorTree" class="editor-tree">${editorRenderer.renderSectionEditorTree(state.document.sections)}</div>
                </div>`}`
              : `<div${renderResponsivePreviewFrameAttrs(`viewer-shell ${isAiView ? 'ai-view-shell ' : ''}${state.contextMenu ? 'is-context-menu-open ' : ''}${state.viewerSidebarOpen ? 'is-sidebar-open' : 'is-sidebar-closed'}`)}>
                   <div class="viewer-sidebar-backdrop" data-action="toggle-viewer-sidebar"></div>
                   <aside class="viewer-sidebar">
                     <button type="button" class="viewer-sidebar-tab" data-action="toggle-viewer-sidebar" aria-expanded="${state.viewerSidebarOpen ? 'true' : 'false'}" aria-label="Toggle navigation">${renderSidebarTabLabel()}</button>
                     ${readerRenderer.renderSidebarHelpBalloon(state.document.sections)}
                     <div class="viewer-sidebar-panel">
                       <div id="readerWarnings" class="reader-warnings">${readerRenderer.renderWarnings()}</div>
                       <!-- TODO: Need to figure out what to do with navigation in the sidebar -->
                       <!-- <div id="readerNav" class="reader-nav">${readerRenderer.renderNavigation(state.document.sections)}</div> -->
                       <div id="${isAiView ? 'aiSidebarSections' : 'readerSidebarSections'}" class="reader-sidebar-sections">${readerRenderer.renderSidebarSections(state.document.sections)}</div>
                     </div>
                   </aside>
                   <div id="${isAiView ? 'aiReaderDocument' : 'readerDocument'}" class="reader-document">${readerRenderer.renderReaderSections(state.document.sections)}</div>
                   ${renderContextMenu()}
                   ${
                     isAiView
                       ? `${renderAiEditPopover()}`
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
                ${renderSearchPalette(state.search, state.document, { escapeAttr, escapeHtml, readerRenderer })}`
          }
        </div>
      </section>

      ${readerRenderer.renderModal()}
      ${readerRenderer.renderLinkInlineModal()}
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
  restorePaneScroll(state.paneScroll, app);
  restoreChatThreadScroll(app, chatScroll);
  centerSearchResultLenses(app);
  scheduleReaderHighlightGlow(app);
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

  void runScriptingBlocksIfNeeded();
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

function renderPreviewControlStack(): string {
  return `<div class="preview-control-stack">
    ${renderResponsivePreviewControls()}
    ${renderReaderViewControls()}
  </div>`;
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

function renderResponsivePreviewFrameAttrs(baseClass: string): string {
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
  const style = width ? ` style="width: ${escapeAttr(width)};"` : '';
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
    void runButtonVisibilityScripts(reader);
    readerMs = performance.now() - stepStartedAt;
  }
  if (sidebarSections || reader) {
    scheduleReaderHighlightGlow(app);
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

// Register the reference-implementation built-in plugins. Hosts that embed
// this codebase can call setHostPlugins / registerHostPlugin before first
// render to add their own.
registerHostPlugin(dbTablePluginRegistration);
registerHostPlugin(formPluginRegistration);
registerHostPlugin(progressBarPluginRegistration);
registerHostPlugin(scriptingPluginRegistration);

// Run scripting blocks once per loaded document. Re-runs whenever the
// document reference or script source changes (file open, raw edit, new doc, etc.).
let lastScriptedDocument: typeof state.document | null = null;
let lastScriptedSignature = '';

async function runScriptingBlocksIfNeeded(): Promise<void> {
  if (state.currentView !== 'viewer' && state.currentView !== 'ai') {
    return;
  }
  const targets: Array<{ sectionKey: string; blockId: string; source: string; pluginVersion: string; componentId: string }> = [];
  for (const section of state.document.sections) {
    visitSectionForScripts(section, targets);
  }
  const signature = targets
    .map((target) => `${target.sectionKey}\u0000${target.blockId}\u0000${target.pluginVersion}\u0000${target.source}`)
    .join('\u0001');
  if (state.document === lastScriptedDocument && signature === lastScriptedSignature) {
    return;
  }
  lastScriptedDocument = state.document;
  lastScriptedSignature = signature;

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
      setScriptingResult(mount, result, target.source);
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
  initState(applyResumeState(createInitialState(await createDefaultDocument()), loadResumeState()));
  bindResumePersistence();
  saveResumeState(state);
  initColorModeSync();
  renderApp();
}

bootstrap().catch((error) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  app.innerHTML = `
    <main class="layout hvy-embed-layout">
      <section class="pane full-pane">
        <h2>Startup Problem</h2>
        <p>The app failed before the first render.</p>
        <pre>${escapeHtml(message)}</pre>
      </section>
    </main>
  `;
  throw error;
});
