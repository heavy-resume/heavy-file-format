import './style.css';
import 'highlight.js/styles/github.css';
import bundledExampleHvy from '../examples/example.hvy?raw';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import TurndownService from 'turndown';
import { parseHvy } from './hvy/parser';
import { stringify as stringifyYaml } from 'yaml';
import type { HvySection, JsonObject } from './hvy/types';
import type { Align, BlockSchema, GridColumn, GridItem, Slot, TableRow, VisualBlock, VisualSection } from './editor/types';
import type { ComponentRenderHelpers } from './editor/component-helpers';
import {
  commitTagEditorDraft,
  handleRemoveTag,
  handleTagEditorInput,
  handleTagEditorKeydown,
  parseTags,
  serializeTags,
  type TagRenderOptions,
} from './editor/tag-editor';
import { getTemplateFields, renderTemplatePanel } from './editor/template';
import { createEditorRenderer, type EditorRenderer } from './editor/render';
import { createReaderRenderer, type ReaderRenderer } from './reader/render';

interface VisualDocument {
  meta: JsonObject;
  extension: '.hvy' | '.thvy' | '.md';
  sections: VisualSection[];
}

interface ReusableSaveModalState {
  kind: 'component' | 'section';
  sectionKey: string;
  blockId?: string;
  draftName: string;
}

interface AppState {
  document: VisualDocument;
  filename: string;
  currentView: 'editor' | 'viewer';
  paneScroll: PaneScrollState;
  showAdvancedEditor: boolean;
  activeEditorBlock: { sectionKey: string; blockId: string } | null;
  activeEditorSectionTitleKey: string | null;
  clearSectionTitleOnFocusKey: string | null;
  modalSectionKey: string | null;
  reusableSaveModal: ReusableSaveModalState | null;
  tempHighlights: Set<string>;
  addComponentBySection: Record<string, string>;
  metaPanelOpen: boolean;
  selectedReusableComponentName: string | null;
  templateValues: Record<string, string>;
  history: string[];
  future: string[];
  isRestoring: boolean;
  componentMetaModal: { sectionKey: string; blockId: string } | null;
  gridAddComponentByBlock: Record<string, string>;
  lastHistoryGroup: string | null;
  lastHistoryAt: number;
  pendingEditorCenterSectionKey: string | null;
}

interface PaneScrollState {
  editorTop: number;
  readerTop: number;
  windowTop: number;
}

marked.setOptions({ gfm: true, breaks: false });

const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  emDelimiter: '_',
});

const appRoot = document.querySelector<HTMLDivElement>('#app');
if (!appRoot) {
  throw new Error('App container not found.');
}
const app = appRoot;

app.innerHTML = '<main class="layout"><section class="pane full-pane"><p>Loading editor...</p></section></main>';

const state: AppState = createInitialState();
let shortcutsBound = false;
let appEventsBound = false;
const HISTORY_GROUP_WINDOW_MS = 1200;
const REUSABLE_SECTION_PREFIX = '__reusable__:';
const REUSABLE_SECTION_DEF_PREFIX = 'section-def:';
let pendingLinkRange: Range | null = null;
let pendingLinkEditable: HTMLElement | null = null;
let draggedSectionKey: string | null = null;
let draggedTableItem: { kind: 'row' | 'column'; sectionKey: string; blockId: string; index: number } | null = null;
const tagStateHelpers = {
  getTagState,
  setTagState,
  getRenderOptions: getTagRenderOptions,
};
let editorRenderer: EditorRenderer;
let readerRenderer: ReaderRenderer;

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
    getComponentRenderHelpers,
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
    getComponentRenderHelpers,
    renderBlockMetaFields: (sectionKey, block) => editorRenderer.renderBlockMetaFields(sectionKey, block),
  }
);

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

function createInitialState(): AppState {
  return {
    document: createDefaultDocument(),
    filename: 'example.hvy',
    currentView: 'editor',
    paneScroll: {
      editorTop: 0,
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
    gridAddComponentByBlock: {},
    lastHistoryGroup: null,
    lastHistoryAt: 0,
    pendingEditorCenterSectionKey: null,
  };
}

function renderApp(): void {
  state.paneScroll = capturePaneScroll(state.paneScroll);
  applyTheme();
  const isEditorView = state.currentView === 'editor';
  const isAdvancedEditor = state.showAdvancedEditor;
  const templateFields = getTemplateFields(state.document.meta);
  app.innerHTML = `
    <main class="layout">
      <header class="topbar">
        <div class="title-block">
          <h1>HVY Reference Implementation</h1>
          <p>Visual editor + reader for <code>.hvy</code> and <code>.thvy</code>.</p>
        </div>
        <div class="toolbar">
          <button id="newBtn" type="button" class="toolbar-primary-button">New</button>
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
                <div id="editorTree" class="editor-tree">${editorRenderer.renderSectionEditorTree(state.document.sections)}</div>`
              : `<div id="readerWarnings" class="reader-warnings">${readerRenderer.renderWarnings()}</div>
                <div id="readerNav" class="reader-nav">${readerRenderer.renderNavigation(state.document.sections)}</div>
                <div id="readerDocument" class="reader-document">${readerRenderer.renderReaderSections(state.document.sections)}</div>`
          }
        </div>
      </section>

      ${readerRenderer.renderModal()}
      ${readerRenderer.renderLinkInlineModal()}
    </main>
  `;

  bindUi();
  restorePaneScroll(state.paneScroll);
  commitHistorySnapshot();
  focusPendingSectionTitleEditor();
  centerPendingEditorSection();
}

function capturePaneScroll(previous: PaneScrollState): PaneScrollState {
  const editorPane = app.querySelector<HTMLDivElement>('.editor-pane');
  const readerPane = app.querySelector<HTMLDivElement>('.reader-pane');
  return {
    editorTop: editorPane?.scrollTop ?? previous.editorTop,
    readerTop: readerPane?.scrollTop ?? previous.readerTop,
    windowTop: window.scrollY,
  };
}

function restorePaneScroll(scroll: PaneScrollState | null): void {
  if (!scroll || state.pendingEditorCenterSectionKey) {
    return;
  }
  const restore = (): void => {
    const editorPane = app.querySelector<HTMLDivElement>('.editor-pane');
    const readerPane = app.querySelector<HTMLDivElement>('.reader-pane');
    if (editorPane) {
      editorPane.scrollTop = scroll.editorTop;
    }
    if (readerPane) {
      readerPane.scrollTop = scroll.readerTop;
    }
    window.scrollTo({ top: scroll.windowTop, left: 0, behavior: 'auto' });
  };
  restore();
  window.requestAnimationFrame(() => {
    restore();
    window.requestAnimationFrame(restore);
  });
}

function centerPendingEditorSection(): void {
  const sectionKey = state.pendingEditorCenterSectionKey;
  if (!sectionKey) {
    return;
  }
  state.pendingEditorCenterSectionKey = null;
  window.requestAnimationFrame(() => {
    const sectionEl = app.querySelector<HTMLElement>(`[data-editor-section="${sectionKey}"]`);
    if (!sectionEl) {
      return;
    }
    sectionEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

function focusPendingSectionTitleEditor(): void {
  const sectionKey = state.activeEditorSectionTitleKey;
  if (!sectionKey) {
    return;
  }
  window.requestAnimationFrame(() => {
    const input = app.querySelector<HTMLInputElement>(
      `.section-title-input[data-section-key="${CSS.escape(sectionKey)}"]`
    );
    if (!input) {
      return;
    }
    input.focus();
    if (state.clearSectionTitleOnFocusKey === sectionKey) {
      input.select();
      state.clearSectionTitleOnFocusKey = null;
      return;
    }
    const valueLength = input.value.length;
    input.setSelectionRange(valueLength, valueLength);
  });
}

function bindUi(): void {
  const newBtn = app.querySelector<HTMLButtonElement>('#newBtn');
  const fileInput = app.querySelector<HTMLInputElement>('#fileInput');
  const downloadBtn = app.querySelector<HTMLButtonElement>('#downloadBtn');
  const downloadName = app.querySelector<HTMLInputElement>('#downloadName');
  const readerDocument = app.querySelector<HTMLDivElement>('#readerDocument');
  const readerNav = app.querySelector<HTMLDivElement>('#readerNav');

  if (!newBtn || !fileInput || !downloadBtn || !downloadName) {
    throw new Error('Missing UI elements for binding.');
  }

  newBtn.addEventListener('click', () => {
    resetToBlankDocument();
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) {
      return;
    }
    const text = await file.text();
    state.filename = file.name;
    state.document = deserializeDocument(text, detectExtension(file.name, text));
    closeModal();
    resetTransientUiState();
    renderApp();
  });

  downloadName.addEventListener('input', () => {
    state.filename = downloadName.value;
  });

  downloadBtn.addEventListener('click', () => {
    const normalized = normalizeFilename(state.filename || 'document.hvy');
    state.filename = normalized;
    const text = serializeDocument(state.document);
    downloadTextFile(normalized, text);
    renderApp();
  });

  if (!appEventsBound) {
    app.addEventListener('input', (event) => {
    const target = event.target as HTMLElement;
    const field = target.dataset.field;
    if (!field) {
      return;
    }

    if (field === 'template-value' && target instanceof HTMLInputElement) {
      const key = target.dataset.templateField;
      if (!key) {
        return;
      }
      recordHistory(`template:${key}`);
      state.templateValues[key] = target.value;
      refreshReaderPanels();
      return;
    }

    if (field === 'meta-title' && target instanceof HTMLInputElement) {
      recordHistory('meta:title');
      state.document.meta.title = target.value;
      return;
    }

    if (field.startsWith('theme-')) {
      recordHistory(`meta:${field}`);
      const theme = getThemeConfig();
      if (field === 'theme-mode' && target instanceof HTMLSelectElement) {
        theme.mode = target.value === 'dark' ? 'dark' : 'light';
      }
      if (field === 'theme-accent' && target instanceof HTMLInputElement) {
        theme.accent = target.value;
      }
      if (field === 'theme-background' && target instanceof HTMLInputElement) {
        theme.background = target.value;
      }
      if (field === 'theme-surface' && target instanceof HTMLInputElement) {
        theme.surface = target.value;
      }
      if (field === 'theme-text' && target instanceof HTMLInputElement) {
        theme.text = target.value;
      }
      state.document.meta.theme = theme;
      applyTheme();
      return;
    }

    if (field === 'def-name' && target instanceof HTMLInputElement) {
      const idx = Number.parseInt(target.dataset.defIndex ?? '', 10);
      const defs = getComponentDefs();
      if (!Number.isNaN(idx) && defs[idx]) {
        recordHistory(`def:${idx}:name`);
        defs[idx].name = target.value;
        state.document.meta.component_defs = defs;
      }
      return;
    }

    if (field === 'def-base' && target instanceof HTMLSelectElement) {
      const idx = Number.parseInt(target.dataset.defIndex ?? '', 10);
      const defs = getComponentDefs();
      if (!Number.isNaN(idx) && defs[idx]) {
        recordHistory(`def:${idx}:base`);
        defs[idx].baseType = target.value;
        state.document.meta.component_defs = defs;
      }
      return;
    }

    if (field === 'def-tags' && target instanceof HTMLInputElement) {
      const idx = Number.parseInt(target.dataset.defIndex ?? '', 10);
      const defs = getComponentDefs();
      if (!Number.isNaN(idx) && defs[idx]) {
        recordHistory(`def:${idx}:tags`);
        defs[idx].tags = target.value;
        state.document.meta.component_defs = defs;
      }
      return;
    }

    if (field === 'def-description' && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      const idx = Number.parseInt(target.dataset.defIndex ?? '', 10);
      const defs = getComponentDefs();
      if (!Number.isNaN(idx) && defs[idx]) {
        recordHistory(`def:${idx}:description`);
        defs[idx].description = target.value;
        state.document.meta.component_defs = defs;
      }
      return;
    }

    if (field === 'section-def-name' && target instanceof HTMLInputElement) {
      const idx = Number.parseInt(target.dataset.sectionDefIndex ?? '', 10);
      const defs = getSectionDefs();
      if (!Number.isNaN(idx) && defs[idx]) {
        recordHistory(`section-def:${idx}:name`);
        defs[idx].name = target.value;
        state.document.meta.section_defs = defs;
      }
      return;
    }

    if (field === 'row-details-new-component-type' && target instanceof HTMLSelectElement) {
      return;
    }

    if (field === 'container-new-component-type' && target instanceof HTMLSelectElement) {
      const key = target.dataset.containerKey;
      if (key) {
        state.addComponentBySection[key] = target.value;
      }
      return;
    }

    if (field === 'expandable-stub-new-component-type' && target instanceof HTMLSelectElement) {
      const key = target.dataset.expandableKey;
      if (key) {
        state.addComponentBySection[key] = target.value;
      }
      return;
    }

    if (field === 'expandable-content-new-component-type' && target instanceof HTMLSelectElement) {
      const key = target.dataset.expandableKey;
      if (key) {
        state.addComponentBySection[key] = target.value;
      }
      return;
    }

    if (field === 'reusable-section-type' && target instanceof HTMLSelectElement) {
      const key = target.dataset.sectionKey;
      if (key) {
        state.addComponentBySection[key] = target.value;
      }
      return;
    }
  });

  app.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const actionButton = target.closest<HTMLElement>('[data-action]');
    if (!actionButton) {
      return;
    }

    const action = actionButton.dataset.action;
    if (!action) {
      return;
    }
    const sectionKey = actionButton.dataset.sectionKey ?? '';
    const blockId = actionButton.dataset.blockId ?? '';

    if (action === 'undo') {
      undoState();
      return;
    }

    if (action === 'switch-view') {
      const view = actionButton.dataset.view === 'viewer' ? 'viewer' : 'editor';
      state.currentView = view;
      renderApp();
      return;
    }

    if (action === 'set-editor-mode') {
      state.showAdvancedEditor = actionButton.dataset.editorMode === 'advanced';
      if (!state.showAdvancedEditor) {
        state.metaPanelOpen = false;
      }
      state.activeEditorSectionTitleKey = null;
      renderApp();
      return;
    }

    if (action === 'toggle-document-meta') {
      state.metaPanelOpen = !state.metaPanelOpen;
      renderApp();
      return;
    }

    if (action === 'activate-block' && blockId) {
      event.stopPropagation();
      setActiveEditorBlock(sectionKey, blockId);
      renderApp();
      return;
    }


    if (action === 'activate-section-title' && sectionKey) {
      event.stopPropagation();
      state.activeEditorSectionTitleKey = sectionKey;
      const section = findSectionByKey(state.document.sections, sectionKey);
      state.clearSectionTitleOnFocusKey = section && isDefaultUntitledSectionTitle(section.title) ? sectionKey : null;
      renderApp();
      return;
    }

    if (action === 'deactivate-block' && blockId) {
      event.stopPropagation();
      clearActiveEditorBlock(blockId);
      renderApp();
      return;
    }

    if (action === 'redo') {
      redoState();
      return;
    }

    if (action === 'add-component-def') {
      recordHistory();
      const defs = getComponentDefs();
      defs.push({
        name: `component-${defs.length + 1}`,
        baseType: 'text',
        tags: '',
        description: '',
      });
      state.document.meta.component_defs = defs;
      renderApp();
      return;
    }

    if (action === 'remove-component-def') {
      recordHistory();
      const defIndex = Number.parseInt(actionButton.dataset.defIndex ?? '', 10);
      if (Number.isNaN(defIndex)) {
        return;
      }
      const defs = getComponentDefs();
      const [removed] = defs.splice(defIndex, 1);
      if (removed) {
        revertReusableComponent(removed);
      }
      state.document.meta.component_defs = defs;
      if (state.selectedReusableComponentName === removed?.name) {
        state.selectedReusableComponentName = defs[0]?.name ?? null;
      }
      renderApp();
      return;
    }

    if (action === 'remove-section-def') {
      recordHistory();
      const defIndex = Number.parseInt(actionButton.dataset.sectionDefIndex ?? '', 10);
      if (Number.isNaN(defIndex)) {
        return;
      }
      const defs = getSectionDefs();
      if (!defs[defIndex]) {
        return;
      }
      defs.splice(defIndex, 1);
      state.document.meta.section_defs = defs;
      renderApp();
      return;
    }

    if (action === 'open-save-component-def') {
      const sectionKey = actionButton.dataset.sectionKey;
      const blockId = actionButton.dataset.blockId;
      if (!sectionKey || !blockId) {
        return;
      }
      const block = findBlockByIds(sectionKey, blockId);
      if (!block) {
        return;
      }
      state.reusableSaveModal = {
        kind: 'component',
        sectionKey,
        blockId,
        draftName: isBuiltinComponent(block.schema.component) ? '' : block.schema.component,
      };
      renderApp();
      return;
    }

    if (action === 'open-save-section-def') {
      const sectionKey = actionButton.dataset.sectionKey;
      if (!sectionKey) {
        return;
      }
      const section = findSectionByKey(state.document.sections, sectionKey);
      if (!section) {
        return;
      }
      state.reusableSaveModal = {
        kind: 'section',
        sectionKey,
        draftName: isDefaultUntitledSectionTitle(section.title) ? '' : section.title.trim(),
      };
      renderApp();
      return;
    }

    if (action === 'focus-schema-component') {
      if (target.closest('select, input, button, textarea, label')) {
        return;
      }
      const select = actionButton.querySelector<HTMLSelectElement>('[data-field="block-component"]');
      select?.focus();
      select?.click();
      return;
    }

    if (action === 'remove-tag') {
      handleRemoveTag(actionButton, tagStateHelpers);
      return;
    }

    if (action === 'add-template-field') {
      recordHistory();
      const field = actionButton.dataset.templateField;
      if (!field) {
        return;
      }
      const newSection = createEmptySection(1, 'text');
      newSection.title = field;
      if (newSection.blocks[0]) {
        newSection.blocks[0].text = `{{${field}}}`;
        setActiveEditorBlock(newSection.key, newSection.blocks[0].id);
      }
      state.document.sections.push(newSection);
      renderApp();
      return;
    }

  });

  if (!shortcutsBound) {
    window.addEventListener('keydown', (event) => {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undoState();
        return;
      }
      if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault();
        redoState();
      }
    });
    shortcutsBound = true;
  }

  app.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;

    if (target.closest('select') || target.closest('input')) {
      return;
    }

    const richButton = target.closest<HTMLElement>('[data-rich-action]');
    if (richButton) {
      event.preventDefault();
      const sectionKey = richButton.dataset.sectionKey;
      const blockId = richButton.dataset.blockId;
      const action = richButton.dataset.richAction;
      const richField = richButton.dataset.richField ?? 'block-rich';
      const gridItemId = richButton.dataset.gridItemId;
      const rowIndex = richButton.dataset.rowIndex;
      if (sectionKey && blockId && action) {
        const selectorBase = `[data-section-key="${sectionKey}"][data-block-id="${blockId}"][data-field="${richField}"]`;
        const editable = rowIndex
          ? app.querySelector<HTMLElement>(`${selectorBase}[data-row-index="${rowIndex}"]`)
          : gridItemId
          ? app.querySelector<HTMLElement>(`${selectorBase}[data-grid-item-id="${gridItemId}"]`)
          : app.querySelector<HTMLElement>(selectorBase);
        if (editable) {
          if (action === 'link') {
            openLinkInlineModal(editable);
            return;
          }
          editable.focus();
          applyRichAction(action, editable);
        }
      }
      return;
    }

    const actionButton = target.closest<HTMLElement>('[data-action]');
    if (!actionButton) {
      return;
    }

    const action = actionButton.dataset.action;
    const sectionKey = actionButton.dataset.sectionKey;
    const blockId = actionButton.dataset.blockId;

    if (!action) {
      return;
    }

    if (action === 'add-top-level-section') {
      recordHistory();
      const starter = state.addComponentBySection.__top_level__ ?? 'blank';
      const section = starter === 'blank' ? createEmptySection(1, '', false) : instantiateReusableSection(starter, 1);
      if (!section) {
        return;
      }
      state.document.sections.push(section);
      if (section.blocks[0]) {
        setActiveEditorBlock(section.key, section.blocks[0].id);
      } else {
        state.activeEditorSectionTitleKey = section.key;
        state.clearSectionTitleOnFocusKey = isDefaultUntitledSectionTitle(section.title) ? section.key : null;
      }
      renderApp();
      return;
    }

    if (!sectionKey) {
      return;
    }

    const reusableName = getReusableNameFromSectionKey(sectionKey);
    const section = reusableName ? null : findSectionByKey(state.document.sections, sectionKey);
    if (!section && !reusableName) {
      return;
    }

    if (action === 'spawn-child-ghost') {
      if (!section || section.lock) {
        return;
      }
      recordHistory();
      const component = state.addComponentBySection[section.key] ?? 'container';
      const child = createEmptySection(Math.min(section.level + 1, 6), component, false);
      section.children.push(child);
      state.pendingEditorCenterSectionKey = child.key;
      renderApp();
      return;
    }

    if (action === 'spawn-block-ghost') {
      if (!section || section.lock) {
        return;
      }
      recordHistory();
      const component = state.addComponentBySection[section.key] ?? 'container';
      const child = createEmptySection(Math.min(section.level + 1, 6), component, false);
      section.children.push(child);
      state.pendingEditorCenterSectionKey = child.key;
      renderApp();
      return;
    }

    if (action === 'add-subsection') {
      if (!section || section.lock) {
        return;
      }
      recordHistory();
      const starter = state.addComponentBySection[`subsection:${section.key}`] ?? 'blank';
      const child =
        starter === 'blank' ? createEmptySection(Math.min(section.level + 1, 6), '', false) : instantiateReusableSection(starter, Math.min(section.level + 1, 6));
      if (!child) {
        return;
      }
      section.children.push(child);
      if (child.blocks[0]) {
        setActiveEditorBlock(child.key, child.blocks[0].id);
      } else {
        state.activeEditorSectionTitleKey = child.key;
        state.clearSectionTitleOnFocusKey = isDefaultUntitledSectionTitle(child.title) ? child.key : null;
      }
      renderApp();
      return;
    }

    if (action === 'remove-section') {
      if (!section) {
        return;
      }
      recordHistory();
      removeSectionByKey(state.document.sections, sectionKey);
      closeModalIfTarget(sectionKey);
      if (state.activeEditorSectionTitleKey === sectionKey) {
        state.activeEditorSectionTitleKey = null;
      }
      if (state.activeEditorBlock?.sectionKey === sectionKey) {
        state.activeEditorBlock = null;
      }
      renderApp();
      return;
    }

    if (action === 'move-section-up') {
      if (!section) {
        return;
      }
      recordHistory();
      if (moveSectionByOffset(state.document.sections, sectionKey, -1)) {
        renderApp();
      }
      return;
    }

    if (action === 'move-section-down') {
      if (!section) {
        return;
      }
      recordHistory();
      if (moveSectionByOffset(state.document.sections, sectionKey, 1)) {
        renderApp();
      }
      return;
    }

    if (action === 'add-child') {
      if (!section || section.lock) {
        return;
      }
      recordHistory();
      const component = state.addComponentBySection[section.key] ?? 'container';
      const child = createEmptySection(Math.min(section.level + 1, 6), component, true);
      section.children.push(child);
      if (child.blocks[0]) {
        setActiveEditorBlock(child.key, child.blocks[0].id);
      }
      renderApp();
      return;
    }

    if (action === 'add-block') {
      if (!section || section.lock) {
        return;
      }
      recordHistory();
      const component = (state.addComponentBySection[section.key] ?? '').trim();
      if (!component) {
        return;
      }
      const newBlock = createEmptyBlock(component);
      section.blocks.push(newBlock);
      setActiveEditorBlock(section.key, newBlock.id);
      renderApp();
      return;
    }

    if (action === 'add-component-list-item' && blockId) {
      recordHistory();
      const block = findBlockByIds(sectionKey, blockId);
      if (!block || block.schema.lock) {
        return;
      }
      ensureComponentListBlocks(block);
      const newBlock = createEmptyBlock(block.schema.componentListComponent || 'text');
      block.schema.componentListBlocks.push(newBlock);
      syncReusableTemplateForBlock(sectionKey, block.id);
      setActiveEditorBlock(sectionKey, newBlock.id);
      renderApp();
      return;
    }

    if (action === 'add-container-block' && blockId) {
      recordHistory();
      const block = findBlockByIds(sectionKey, blockId);
      if (!block || block.schema.lock) {
        return;
      }
      ensureContainerBlocks(block);
      const addKey = `container:${sectionKey}:${blockId}`;
      const newBlock = createEmptyBlock(state.addComponentBySection[addKey] ?? 'text');
      block.schema.containerBlocks.push(newBlock);
      syncReusableTemplateForBlock(sectionKey, block.id);
      setActiveEditorBlock(sectionKey, newBlock.id);
      renderApp();
      return;
    }

    if (action === 'add-expandable-stub-block' && blockId) {
      recordHistory();
      const block = findBlockByIds(sectionKey, blockId);
      if (!block || block.schema.lock) {
        return;
      }
      ensureExpandableBlocks(block);
      const addKey = `expandable-stub:${sectionKey}:${blockId}`;
      const newBlock = createEmptyBlock(state.addComponentBySection[addKey] ?? 'container');
      block.schema.expandableStubBlocks.push(newBlock);
      syncReusableTemplateForBlock(sectionKey, block.id);
      setActiveEditorBlock(sectionKey, newBlock.id);
      renderApp();
      return;
    }

    if (action === 'add-expandable-content-block' && blockId) {
      recordHistory();
      const block = findBlockByIds(sectionKey, blockId);
      if (!block || block.schema.lock) {
        return;
      }
      ensureExpandableBlocks(block);
      const addKey = `expandable-content:${sectionKey}:${blockId}`;
      const newBlock = createEmptyBlock(state.addComponentBySection[addKey] ?? 'container');
      block.schema.expandableContentBlocks.push(newBlock);
      syncReusableTemplateForBlock(sectionKey, block.id);
      setActiveEditorBlock(sectionKey, newBlock.id);
      renderApp();
      return;
    }

    if (action === 'toggle-schema' && blockId) {
      recordHistory();
      const block = resolveBlockContext(actionButton)?.block ?? null;
      if (!block) {
        return;
      }
      block.schemaMode = !block.schemaMode;
      renderApp();
      return;
    }

    if (action === 'set-block-align' && blockId) {
      recordHistory();
      const block = resolveBlockContext(actionButton)?.block ?? null;
      if (!block) {
        return;
      }
      block.schema.align = coerceAlign(actionButton.dataset.alignValue ?? 'left');
      syncReusableTemplateForBlock(sectionKey, block.id);
      refreshReaderPanels();
      renderApp();
      return;
    }

    if (action === 'remove-block' && blockId) {
      recordHistory();
      const reusableOwnerId = findReusableOwner(sectionKey, blockId)?.id ?? null;
      if (section) {
        removeBlockFromList(section.blocks, blockId);
      } else {
        const template = reusableName ? getReusableTemplateByName(reusableName) : null;
        if (template) {
          removeBlockFromList([template], blockId);
        }
      }
      syncReusableTemplateForBlock(sectionKey, reusableOwnerId ?? blockId);
      clearActiveEditorBlock(blockId);
      renderApp();
      return;
    }

    if (action === 'move-block-up' && blockId) {
      recordHistory();
      if (moveBlockByOffset(sectionKey, blockId, -1)) {
        renderApp();
      }
      return;
    }

    if (action === 'move-block-down' && blockId) {
      recordHistory();
      if (moveBlockByOffset(sectionKey, blockId, 1)) {
        renderApp();
      }
      return;
    }

    if (action === 'add-table-row' && blockId) {
      recordHistory();
      const block = findBlockByIds(sectionKey, blockId);
      if (!block) {
        return;
      }
      const columnCount = getTableColumns(block.schema).length;
      block.schema.tableRows.push(createDefaultTableRow(columnCount));
      syncReusableTemplateForBlock(sectionKey, block.id);
      renderApp();
      return;
    }

    if (action === 'add-table-column' && blockId) {
      recordHistory();
      const block = findBlockByIds(sectionKey, blockId);
      if (!block || block.schema.lock) {
        return;
      }
      addTableColumn(block.schema);
      syncReusableTemplateForBlock(sectionKey, block.id);
      renderApp();
      return;
    }

    if (action === 'remove-table-column' && blockId) {
      recordHistory();
      const columnIndex = Number.parseInt(actionButton.dataset.columnIndex ?? '', 10);
      const block = findBlockByIds(sectionKey, blockId);
      if (!block || block.schema.lock || Number.isNaN(columnIndex)) {
        return;
      }
      removeTableColumn(block.schema, columnIndex);
      syncReusableTemplateForBlock(sectionKey, block.id);
      renderApp();
      return;
    }

    if (action === 'remove-table-row' && blockId) {
      recordHistory();
      const rowIndex = Number.parseInt(actionButton.dataset.rowIndex ?? '', 10);
      const block = findBlockByIds(sectionKey, blockId);
      if (!block || Number.isNaN(rowIndex)) {
        return;
      }
      block.schema.tableRows.splice(rowIndex, 1);
      syncReusableTemplateForBlock(sectionKey, block.id);
      renderApp();
      return;
    }

    if (action === 'focus-modal') {
      state.modalSectionKey = sectionKey;
      renderApp();
      return;
    }

    if (action === 'open-component-meta' && blockId) {
      state.componentMetaModal = { sectionKey, blockId };
      renderApp();
      return;
    }

    if (action === 'add-grid-item' && blockId) {
      recordHistory();
      const block = resolveBlockContext(actionButton)?.block ?? null;
      if (!block || block.schema.lock) {
        return;
      }
      ensureGridItems(block.schema);
      const item = createGridItem(block.schema.gridItems.length, block.schema.gridColumns);
      item.block = createEmptyBlock(state.gridAddComponentByBlock[blockId] ?? 'text');
      block.schema.gridItems.push(item);
      syncReusableTemplateForBlock(sectionKey, block.id);
      renderApp();
      return;
    }

    if (action === 'remove-grid-item' && blockId) {
      recordHistory();
      const block = resolveBlockContext(actionButton)?.block ?? null;
      const gridItemId = actionButton.dataset.gridItemId;
      if (!block || !gridItemId) {
        return;
      }
      block.schema.gridItems = block.schema.gridItems.filter((item) => item.id !== gridItemId);
      syncReusableTemplateForBlock(sectionKey, block.id);
      ensureGridItems(block.schema);
      renderApp();
      return;
    }

    if ((action === 'move-grid-item-up' || action === 'move-grid-item-down') && blockId) {
      recordHistory();
      const block = resolveBlockContext(actionButton)?.block ?? null;
      const gridItemId = actionButton.dataset.gridItemId;
      if (!block || !gridItemId) {
        return;
      }
      const currentIndex = block.schema.gridItems.findIndex((item) => item.id === gridItemId);
      if (currentIndex < 0) {
        return;
      }
      const nextIndex = action === 'move-grid-item-up' ? currentIndex - 1 : currentIndex + 1;
      if (nextIndex < 0 || nextIndex >= block.schema.gridItems.length) {
        return;
      }
      block.schema.gridItems = moveItem(block.schema.gridItems, currentIndex, nextIndex);
      syncReusableTemplateForBlock(sectionKey, block.id);
      renderApp();
      return;
    }


    if (action === 'realize-ghost') {
      if (!section) {
        return;
      }
      recordHistory();
      section.isGhost = false;
      renderApp();
      return;
    }

    if (action === 'jump-to-reader') {
      if (!section) {
        return;
      }
      navigateToSection(getSectionId(section));
    }
  });

  app.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLInputElement && handleTagEditorKeydown(event, target, tagStateHelpers)) {
      return;
    }
    if (target.dataset.inlineText === 'true' && event.key === 'Enter') {
      event.preventDefault();
      return;
    }

    if (
      target.dataset.field !== 'block-rich' &&
      target.dataset.field !== 'block-grid-rich' &&
      target.dataset.field !== 'table-details-rich'
    ) {
      return;
    }

    const meta = event.metaKey || event.ctrlKey;
    if (!meta) {
      return;
    }

    const key = event.key.toLowerCase();
    if (key === 'b') {
      event.preventDefault();
      applyRichAction('bold', target);
      return;
    }

    if (key === 'i') {
      event.preventDefault();
      applyRichAction('italic', target);
      return;
    }

    if (key === 'k') {
      event.preventDefault();
      openLinkInlineModal(target);
    }
  });

  app.addEventListener('input', (event) => {
    const target = event.target as HTMLElement;
    if (handleTagEditorInput(target, tagStateHelpers)) {
      return;
    }
    const sectionKey = target.dataset.sectionKey;
    if (!sectionKey) {
      return;
    }
    const reusableName = getReusableNameFromSectionKey(sectionKey);

    const field = target.dataset.field;
    if (field === 'new-component-type' && target instanceof HTMLSelectElement) {
      state.addComponentBySection[sectionKey] = target.value;
      return;
    }
    if (field === 'new-grid-component-type' && target instanceof HTMLSelectElement) {
      const blockId = target.dataset.blockId;
      if (!blockId) {
        return;
      }
      state.gridAddComponentByBlock[blockId] = target.value;
      return;
    }

    const section = reusableName ? null : findSectionByKey(state.document.sections, sectionKey);
    if (!section && !reusableName) {
      return;
    }

    const blockIdForHistory = target.dataset.blockId ?? '';
    if (field && field !== 'new-component-type') {
      recordHistory(`input:${sectionKey}:${blockIdForHistory}:${field}`);
    }

    if (field === 'section-title' && target instanceof HTMLInputElement) {
      if (!section) {
        return;
      }
      section.title = target.value;
      refreshReaderPanels();
      return;
    }

    if (field === 'section-custom-id' && target instanceof HTMLInputElement) {
      if (!section) {
        return;
      }
      section.customId = sanitizeOptionalId(target.value);
      refreshReaderPanels();
      return;
    }

    if (field === 'section-lock' && target instanceof HTMLInputElement) {
      if (!section) {
        return;
      }
      section.lock = target.checked;
      refreshReaderPanels();
      renderApp();
      return;
    }

    if (field === 'new-component-type' && target instanceof HTMLSelectElement) {
      if (!section) {
        return;
      }
      state.addComponentBySection[section.key] = target.value;
      return;
    }

    if (field === 'section-highlight' && target instanceof HTMLInputElement) {
      if (!section) {
        return;
      }
      section.highlight = target.checked;
      refreshReaderPanels();
      return;
    }

    if (field === 'section-expanded' && target instanceof HTMLInputElement) {
      if (!section) {
        return;
      }
      section.expanded = target.checked;
      refreshReaderPanels();
      return;
    }

    if (field === 'block-tags' && target instanceof HTMLInputElement) {
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      const block = context.block;
      block.schema.tags = target.value;
      syncReusableTemplateForBlock(sectionKey, block.id);
      refreshReaderPanels();
      return;
    }

    if (field === 'block-description' && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      const block = context.block;
      block.schema.description = target.value;
      syncReusableTemplateForBlock(sectionKey, block.id);
      refreshReaderPanels();
      return;
    }

    if (field === 'block-custom-css' && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      context.block.schema.customCss = target.value;
      syncReusableTemplateForBlock(sectionKey, context.block.id);
      refreshReaderPanels();
      return;
    }

    if (field === 'block-meta-open' && target instanceof HTMLInputElement) {
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      const block = context.block;
      block.schema.metaOpen = target.checked;
      renderApp();
      return;
    }

    if (field === 'block-lock' && target instanceof HTMLInputElement) {
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      context.block.schema.lock = target.checked;
      syncReusableTemplateForBlock(sectionKey, context.block.id);
      refreshReaderPanels();
      renderApp();
      return;
    }
    if (handleBlockFieldInput(target)) {
      return;
    }
  });

  app.addEventListener('focusout', (event) => {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLInputElement) {
      commitTagEditorDraft(target, tagStateHelpers);
      if (target.dataset.field === 'section-title') {
        const sectionKey = target.dataset.sectionKey;
        const section = sectionKey ? findSectionByKey(state.document.sections, sectionKey) : null;
        if (section && target.value.trim().length === 0) {
          section.title = 'Unnamed Section';
        }
        state.activeEditorSectionTitleKey = null;
        state.clearSectionTitleOnFocusKey = null;
        renderApp();
      }
    }
  });

  app.addEventListener('dragstart', (event) => {
    const target = event.target as HTMLElement;
    const sectionHandle = target.closest<HTMLElement>('[data-drag-handle="section"]');
    if (sectionHandle) {
      draggedSectionKey = sectionHandle.dataset.sectionKey ?? null;
      event.dataTransfer?.setData('text/plain', draggedSectionKey ?? '');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
      }
      return;
    }

    const tableRowHandle = target.closest<HTMLElement>('[data-drag-handle="table-row"]');
    if (tableRowHandle) {
      const sectionKey = tableRowHandle.dataset.sectionKey;
      const blockId = tableRowHandle.dataset.blockId;
      const index = Number.parseInt(tableRowHandle.dataset.rowIndex ?? '', 10);
      if (!sectionKey || !blockId || Number.isNaN(index)) {
        return;
      }
      draggedTableItem = { kind: 'row', sectionKey, blockId, index };
      event.dataTransfer?.setData('text/plain', `${blockId}:${index}`);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
      }
      return;
    }

    const tableColumnHandle = target.closest<HTMLElement>('[data-drag-handle="table-column"]');
    if (tableColumnHandle) {
      const sectionKey = tableColumnHandle.dataset.sectionKey;
      const blockId = tableColumnHandle.dataset.blockId;
      const index = Number.parseInt(tableColumnHandle.dataset.columnIndex ?? '', 10);
      if (!sectionKey || !blockId || Number.isNaN(index)) {
        return;
      }
      draggedTableItem = { kind: 'column', sectionKey, blockId, index };
      event.dataTransfer?.setData('text/plain', `${blockId}:${index}`);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
      }
    }
  });

  app.addEventListener('dragover', (event) => {
    const target = event.target as HTMLElement;
    if (draggedSectionKey && target.closest<HTMLElement>('[data-editor-section]')) {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
      return;
    }

    if (draggedTableItem?.kind === 'row' && target.closest<HTMLElement>('[data-table-row-drop]')) {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
      return;
    }

    if (draggedTableItem?.kind === 'column' && target.closest<HTMLElement>('[data-table-column-drop]')) {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
    }
  });

  app.addEventListener('drop', (event) => {
    const target = event.target as HTMLElement;

    if (draggedSectionKey) {
      const sectionCard = target.closest<HTMLElement>('[data-editor-section]');
      const targetKey = sectionCard?.dataset.editorSection;
      if (!sectionCard || !targetKey) {
        draggedSectionKey = null;
        return;
      }
      event.preventDefault();
      const bounds = sectionCard.getBoundingClientRect();
      const position = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
      recordHistory();
      if (moveSectionRelative(state.document.sections, draggedSectionKey, targetKey, position)) {
        renderApp();
      }
      draggedSectionKey = null;
      return;
    }

    const activeTableDrag = draggedTableItem;
    if (!activeTableDrag) {
      return;
    }

    const section = findSectionByKey(state.document.sections, activeTableDrag.sectionKey);
    const block = section?.blocks.find((candidate) => candidate.id === activeTableDrag.blockId);
    if (!block) {
      draggedTableItem = null;
      return;
    }

    if (activeTableDrag.kind === 'row') {
      const rowDrop = target.closest<HTMLElement>('[data-table-row-drop]');
      const rowIndex = Number.parseInt(rowDrop?.dataset.rowIndex ?? '', 10);
      if (rowDrop && !Number.isNaN(rowIndex)) {
        event.preventDefault();
        recordHistory();
        moveTableRow(block.schema, activeTableDrag.index, rowIndex);
        renderApp();
      }
      draggedTableItem = null;
      return;
    }

    const columnDrop = target.closest<HTMLElement>('[data-table-column-drop]');
    const columnIndex = Number.parseInt(columnDrop?.dataset.columnIndex ?? '', 10);
    if (columnDrop && !Number.isNaN(columnIndex)) {
      event.preventDefault();
      recordHistory();
      moveTableColumn(block.schema, activeTableDrag.index, columnIndex);
      renderApp();
    }
    draggedTableItem = null;
  });

  app.addEventListener('dragend', () => {
    draggedSectionKey = null;
    draggedTableItem = null;
  });
  appEventsBound = true;
  }

  readerDocument?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;

    const anchor = target.closest<HTMLAnchorElement>('a[href^="#"]');
    if (anchor) {
      event.preventDefault();
      const id = anchor.getAttribute('href')?.slice(1) ?? '';
      navigateToSection(id);
      return;
    }

    const toggle = target.closest<HTMLElement>('[data-reader-action="toggle-expand"]');
    if (toggle) {
      event.stopPropagation();
      const sectionKey = toggle.dataset.sectionKey;
      if (!sectionKey) {
        return;
      }
      const section = findSectionByKey(state.document.sections, sectionKey);
      if (!section) {
        return;
      }
      section.expanded = !section.expanded;
      refreshReaderPanels();
      return;
    }

    const expandable = target.closest<HTMLElement>('[data-reader-action="toggle-expandable"]');
    if (expandable) {
      event.stopPropagation();
      const sectionKey = expandable.dataset.sectionKey;
      const blockId = expandable.dataset.blockId;
      if (!sectionKey || !blockId) {
        return;
      }
      const section = findSectionByKey(state.document.sections, sectionKey);
      const block = section?.blocks.find((candidate) => candidate.id === blockId);
      if (!block) {
        return;
      }
      block.schema.expandableExpanded = !block.schema.expandableExpanded;
      refreshReaderPanels();
    }
  });

  readerNav?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const nav = target.closest<HTMLElement>('[data-nav-id]');
    if (!nav) {
      return;
    }
    const sectionId = nav.dataset.navId;
    if (!sectionId) {
      return;
    }
    navigateToSection(sectionId);
  });

  bindModal();
  bindLinkInlineModal();
}

function bindModal(): void {
  const modalRoot = app.querySelector<HTMLDivElement>('#modalRoot');
  if (!modalRoot) {
    return;
  }

  modalRoot.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.dataset.modalAction === 'close-overlay') {
      closeModal();
      renderApp();
      return;
    }

    const closeBtn = target.closest<HTMLElement>('[data-modal-action="close"]');
    if (closeBtn) {
      closeModal();
      renderApp();
      return;
    }

    const saveBtn = target.closest<HTMLElement>('[data-modal-action="save-reusable"]');
    if (saveBtn) {
      saveReusableFromModal();
      return;
    }

    const toggleSectionLockBtn = target.closest<HTMLElement>('[data-modal-action="toggle-section-lock"]');
    if (toggleSectionLockBtn) {
      const sectionKey = toggleSectionLockBtn.dataset.sectionKey;
      const section = sectionKey ? findSectionByKey(state.document.sections, sectionKey) : null;
      if (!section) {
        return;
      }
      section.lock = !section.lock;
      refreshReaderPanels();
      renderApp();
      return;
    }
  });

  const reusableNameInput = modalRoot.querySelector<HTMLInputElement>('#reusableNameInput');
  if (reusableNameInput && state.reusableSaveModal) {
    reusableNameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        saveReusableFromModal();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        closeModal();
        renderApp();
      }
    });
  }

  const cssInput = modalRoot.querySelector<HTMLTextAreaElement>('#modalCssInput');
  if (!cssInput || !state.modalSectionKey) {
    return;
  }

  cssInput.addEventListener('input', () => {
    const section = findSectionByKey(state.document.sections, state.modalSectionKey ?? '');
    if (!section) {
      return;
    }
    section.customCss = cssInput.value;
    refreshReaderPanels();
    refreshModalPreview();
  });
}

function bindLinkInlineModal(): void {
  const modal = app.querySelector<HTMLDivElement>('#linkInlineModal');
  const input = app.querySelector<HTMLInputElement>('#linkInlineInput');
  if (!modal || !input) {
    return;
  }

  modal.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const action = target.dataset.linkModalAction ?? target.closest<HTMLElement>('[data-link-modal-action]')?.dataset.linkModalAction;
    if (action === 'cancel') {
      closeLinkInlineModal();
      return;
    }
    if (action === 'apply') {
      applyInlineLinkFromModal();
    }
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      applyInlineLinkFromModal();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeLinkInlineModal();
    }
  });
}

function openLinkInlineModal(editable: HTMLElement): void {
  const modal = app.querySelector<HTMLDivElement>('#linkInlineModal');
  const input = app.querySelector<HTMLInputElement>('#linkInlineInput');
  if (!modal || !input) {
    return;
  }

  pendingLinkEditable = editable;
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    pendingLinkRange = selection.getRangeAt(0).cloneRange();
  } else {
    pendingLinkRange = null;
  }

  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
  input.value = '';
  window.setTimeout(() => input.focus(), 0);
}

function closeLinkInlineModal(): void {
  const modal = app.querySelector<HTMLDivElement>('#linkInlineModal');
  if (modal) {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
  }
  pendingLinkRange = null;
  pendingLinkEditable = null;
}

function applyInlineLinkFromModal(): void {
  const input = app.querySelector<HTMLInputElement>('#linkInlineInput');
  if (!input || !pendingLinkEditable) {
    closeLinkInlineModal();
    return;
  }
  const value = input.value.trim();
  if (!value) {
    closeLinkInlineModal();
    return;
  }
  const link = value.startsWith('#') ? value : value;
  pendingLinkEditable.focus();
  if (pendingLinkRange) {
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(pendingLinkRange);
    }
  }
  applyRichAction('link', pendingLinkEditable, link);
  closeLinkInlineModal();
}

function refreshReaderPanels(): void {
  const warnings = app.querySelector<HTMLDivElement>('#readerWarnings');
  const nav = app.querySelector<HTMLDivElement>('#readerNav');
  const reader = app.querySelector<HTMLDivElement>('#readerDocument');

  if (warnings) {
    warnings.innerHTML = readerRenderer.renderWarnings();
  }
  if (nav) {
    nav.innerHTML = readerRenderer.renderNavigation(state.document.sections);
  }
  if (reader) {
    reader.innerHTML = readerRenderer.renderReaderSections(state.document.sections);
  }

  refreshModalPreview();
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

function findBlockByIds(sectionKey: string, blockId: string): VisualBlock | null {
  const reusableName = getReusableNameFromSectionKey(sectionKey);
  if (reusableName) {
    const template = getReusableTemplateByName(reusableName);
    return template ? findBlockInList([template], blockId) : null;
  }
  const section = findSectionByKey(state.document.sections, sectionKey);
  if (!section) {
    return null;
  }
  return findBlockInList(section.blocks, blockId);
}

function findBlockInList(blocks: VisualBlock[], blockId: string): VisualBlock | null {
  for (const block of blocks) {
    if (block.id === blockId) {
      return block;
    }
    const nestedContainer = findBlockInList(block.schema.containerBlocks ?? [], blockId);
    if (nestedContainer) {
      return nestedContainer;
    }
    const nestedComponentList = findBlockInList(block.schema.componentListBlocks ?? [], blockId);
    if (nestedComponentList) {
      return nestedComponentList;
    }
    const nestedExpandableStub = findBlockInList(block.schema.expandableStubBlocks ?? [], blockId);
    if (nestedExpandableStub) {
      return nestedExpandableStub;
    }
    const nestedExpandableContent = findBlockInList(block.schema.expandableContentBlocks ?? [], blockId);
    if (nestedExpandableContent) {
      return nestedExpandableContent;
    }
    for (const item of block.schema.gridItems ?? []) {
      const nestedGridBlock = findBlockInList([item.block], blockId);
      if (nestedGridBlock) {
        return nestedGridBlock;
      }
    }
    for (const row of block.schema.tableRows ?? []) {
      const nestedDetails = findBlockInList(row.detailsBlocks ?? [], blockId);
      if (nestedDetails) {
        return nestedDetails;
      }
    }
  }
  return null;
}

function removeBlockFromList(blocks: VisualBlock[], blockId: string): boolean {
  const index = blocks.findIndex((candidate) => candidate.id === blockId);
  if (index >= 0) {
    blocks.splice(index, 1);
    return true;
  }
  for (const block of blocks) {
    if (removeBlockFromList(block.schema.containerBlocks ?? [], blockId)) {
      return true;
    }
    if (removeBlockFromList(block.schema.componentListBlocks ?? [], blockId)) {
      return true;
    }
    if (removeBlockFromList(block.schema.expandableStubBlocks ?? [], blockId)) {
      return true;
    }
    if (removeBlockFromList(block.schema.expandableContentBlocks ?? [], blockId)) {
      return true;
    }
    for (const row of block.schema.tableRows ?? []) {
      if (removeBlockFromList(row.detailsBlocks ?? [], blockId)) {
        return true;
      }
    }
  }
  return false;
}

function resolveBlockContext(target: HTMLElement): { block: VisualBlock; row: TableRow | null } | null {
  const blockId = target.dataset.blockId;
  const sectionKey = target.dataset.sectionKey;
  if (!blockId || !sectionKey) {
    return null;
  }
  const block = findBlockByIds(sectionKey, blockId);
  return block ? { block, row: null } : null;
}

function handleBlockFieldInput(target: HTMLElement): boolean {
  const field = target.dataset.field;
  if (!field) {
    return false;
  }

  const context = resolveBlockContext(target);
  const blockId = target.dataset.blockId;
  if (!context || !blockId) {
    return false;
  }
  const block = context.block;

  if (field === 'block-rich') {
    block.text = normalizeMarkdownLists(turndown.turndown(target.innerHTML));
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    refreshReaderPanels();
    return true;
  }

  if (field === 'block-component' && target instanceof HTMLSelectElement) {
    const reusableInstance = instantiateReusableBlock(target.value);
    if (reusableInstance) {
      block.text = reusableInstance.text;
      block.schema = reusableInstance.schema;
      block.schema.component = target.value;
    } else {
      block.schema.component = target.value;
      applyComponentDefaults(block.schema, target.value);
    }
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    refreshReaderPanels();
    renderApp();
    return true;
  }

  if (field === 'block-plugin-url' && target instanceof HTMLInputElement) {
    block.schema.pluginUrl = target.value;
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    refreshReaderPanels();
    return true;
  }

  if (field === 'block-container-title' && target instanceof HTMLInputElement) {
    block.schema.containerTitle = target.value;
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    refreshReaderPanels();
    return true;
  }

  if (field === 'block-component-list-component' && target instanceof HTMLSelectElement) {
    block.schema.componentListComponent = target.value;
    ensureComponentListBlocks(block);
    block.schema.componentListBlocks.forEach((itemBlock) => {
      itemBlock.schema.component = target.value;
      applyComponentDefaults(itemBlock.schema, target.value);
    });
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    refreshReaderPanels();
    renderApp();
    return true;
  }

  if (field === 'block-grid-columns' && target instanceof HTMLInputElement) {
    block.schema.gridColumns = coerceGridColumns(target.value);
    ensureGridItems(block.schema);
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    refreshReaderPanels();
    return true;
  }

  if (field === 'block-grid-item-component' && target instanceof HTMLSelectElement) {
    const gridItemId = target.dataset.gridItemId;
    if (!gridItemId) {
      return true;
    }
    ensureGridItems(block.schema);
    const item = block.schema.gridItems.find((candidate) => candidate.id === gridItemId);
    if (!item) {
      return true;
    }
    const reusableInstance = instantiateReusableBlock(target.value);
    if (reusableInstance) {
      item.block = reusableInstance;
      item.block.schema.component = target.value;
    } else {
      item.block.schema.component = target.value;
      applyComponentDefaults(item.block.schema, target.value);
    }
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    refreshReaderPanels();
    renderApp();
    return true;
  }

  if (field === 'block-grid-item-column' && target instanceof HTMLSelectElement) {
    const gridItemId = target.dataset.gridItemId;
    if (!gridItemId) {
      return true;
    }
    ensureGridItems(block.schema);
    const item = block.schema.gridItems.find((candidate) => candidate.id === gridItemId);
    if (!item) {
      return true;
    }
    item.column = coerceGridColumn(target.value, block.schema.gridColumns);
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    refreshReaderPanels();
    return true;
  }

  if (field === 'block-grid-rich') {
    const gridItemId = target.dataset.gridItemId;
    if (!gridItemId) {
      return true;
    }
    ensureGridItems(block.schema);
    const item = block.schema.gridItems.find((candidate) => candidate.id === gridItemId);
    if (!item) {
      return true;
    }
    item.block.text = normalizeMarkdownLists(turndown.turndown(target.innerHTML));
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    refreshReaderPanels();
    return true;
  }

  if (field === 'block-code-language' && target instanceof HTMLInputElement) {
    block.schema.codeLanguage = target.value;
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    refreshReaderPanels();
    return true;
  }

  if (field === 'block-code' && target instanceof HTMLTextAreaElement) {
    block.text = target.value;
    refreshReaderPanels();
    return true;
  }

  if (field === 'block-expandable-always' && target instanceof HTMLInputElement) {
    block.schema.expandableAlwaysShowStub = target.checked;
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    refreshReaderPanels();
    return true;
  }

  if (field === 'table-show-header' && target instanceof HTMLInputElement) {
    block.schema.tableShowHeader = target.checked;
    refreshReaderPanels();
    return true;
  }

  if (field === 'table-column') {
    const columnIndex = Number.parseInt(target.dataset.columnIndex ?? '', 10);
    if (!Number.isNaN(columnIndex)) {
      const columns = getTableColumns(block.schema);
      columns[columnIndex] = getInlineEditableText(target);
      setTableColumns(block.schema, columns);
      syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
      refreshReaderPanels();
    }
    return true;
  }

  if (field === 'table-cell') {
    const rowIndex = Number.parseInt(target.dataset.rowIndex ?? '', 10);
    const cellIndex = Number.parseInt(target.dataset.cellIndex ?? '', 10);
    const row = block.schema.tableRows[rowIndex];
    if (row && !Number.isNaN(cellIndex)) {
      row.cells[cellIndex] = getInlineEditableText(target);
      syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
      refreshReaderPanels();
    }
    return true;
  }

  if (field === 'block-align' && target instanceof HTMLSelectElement) {
    block.schema.align = coerceAlign(target.value);
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    refreshReaderPanels();
    return true;
  }

  if (field === 'block-slot' && target instanceof HTMLSelectElement) {
    block.schema.slot = coerceSlot(target.value);
    syncReusableTemplateForBlock(target.dataset.sectionKey ?? '', block.id);
    refreshReaderPanels();
    return true;
  }

  return false;
}

function getTagState(target: HTMLElement): string[] {
  const field = target.dataset.field === 'block-tags-input' || target.dataset.tagField === 'block-tags' ? 'block-tags' : 'def-tags';
  if (field === 'block-tags') {
    const context = resolveBlockContext(target);
    return context ? parseTags(context.block.schema.tags) : [];
  }
  const defIndex = Number.parseInt(target.dataset.defIndex ?? '', 10);
  const defs = getComponentDefs();
  if (Number.isNaN(defIndex) || !defs[defIndex]) {
    return [];
  }
  return parseTags(defs[defIndex].tags ?? '');
}

function setTagState(target: HTMLElement, tags: string[]): void {
  const value = serializeTags(tags);
  const field = target.dataset.field === 'block-tags-input' || target.dataset.tagField === 'block-tags' ? 'block-tags' : 'def-tags';
  if (field === 'block-tags') {
    const context = resolveBlockContext(target);
    if (!context) {
      return;
    }
    recordHistory(`tags:${context.block.id}`);
    context.block.schema.tags = value;
    refreshReaderPanels();
    return;
  }
  const defIndex = Number.parseInt(target.dataset.defIndex ?? '', 10);
  const defs = getComponentDefs();
  if (Number.isNaN(defIndex) || !defs[defIndex]) {
    return;
  }
  recordHistory(`def:${defIndex}:tags`);
  defs[defIndex].tags = value;
  state.document.meta.component_defs = defs;
}

function getTagRenderOptions(target: HTMLElement): Omit<TagRenderOptions, 'placeholder'> {
  return {
    sectionKey: target.dataset.sectionKey,
    blockId: target.dataset.blockId,
    defIndex: target.dataset.defIndex ? Number.parseInt(target.dataset.defIndex, 10) : undefined,
  };
}

function isActiveEditorBlock(sectionKey: string, blockId: string): boolean {
  return state.activeEditorBlock?.sectionKey === sectionKey && state.activeEditorBlock.blockId === blockId;
}

function setActiveEditorBlock(sectionKey: string, blockId: string): void {
  state.activeEditorBlock = { sectionKey, blockId };
}

function clearActiveEditorBlock(blockId?: string): void {
  if (!state.activeEditorBlock) {
    return;
  }
  if (!blockId || state.activeEditorBlock.blockId === blockId) {
    state.activeEditorBlock = null;
  }
}

function isActiveEditorSectionTitle(sectionKey: string): boolean {
  return state.activeEditorSectionTitleKey === sectionKey;
}

function ensureContainerBlocks(block: VisualBlock): void {
  if (!Array.isArray(block.schema.containerBlocks)) {
    block.schema.containerBlocks = [];
  }
  if (block.schema.containerBlocks.length === 0 && block.text.trim().length > 0) {
    const migrated = createEmptyBlock('text', true);
    migrated.text = block.text;
    block.schema.containerBlocks.push(migrated);
    block.text = '';
  }
}

function ensureComponentListBlocks(block: VisualBlock): void {
  if (!Array.isArray(block.schema.componentListBlocks)) {
    block.schema.componentListBlocks = [];
  }
  if (!block.schema.componentListComponent) {
    block.schema.componentListComponent = 'text';
  }
  block.schema.componentListBlocks = block.schema.componentListBlocks.map((itemBlock) => {
    itemBlock.schema.component = block.schema.componentListComponent;
    return itemBlock;
  });
}

function ensureExpandableBlocks(block: VisualBlock): void {
  if (!Array.isArray(block.schema.expandableStubBlocks)) {
    block.schema.expandableStubBlocks = [];
  }
  if (!Array.isArray(block.schema.expandableContentBlocks)) {
    block.schema.expandableContentBlocks = [];
  }
  if (block.schema.expandableStubBlocks.length === 0 && block.schema.expandableStub.trim().length > 0) {
    const migrated = createEmptyBlock(resolveBaseComponent(block.schema.expandableStubComponent || 'text'), true);
    migrated.text = block.schema.expandableStub;
    block.schema.expandableStubBlocks.push(migrated);
    block.schema.expandableStub = '';
  }
  if (block.schema.expandableContentBlocks.length === 0 && block.text.trim().length > 0) {
    const migrated = createEmptyBlock(resolveBaseComponent(block.schema.expandableContentComponent || 'text'), true);
    migrated.text = block.text;
    block.schema.expandableContentBlocks.push(migrated);
    block.text = '';
  }
}

function getComponentRenderHelpers(): ComponentRenderHelpers {
  return {
    escapeAttr,
    escapeHtml,
    markdownToEditorHtml,
    renderRichToolbar: editorRenderer.renderRichToolbar,
    renderEditorBlock: (sectionKey, block) => editorRenderer.renderEditorBlock(sectionKey, block, state.document.sections),
    renderReaderBlock: readerRenderer.renderReaderBlock,
    renderComponentFragment: editorRenderer.renderComponentFragment,
    renderComponentOptions,
    renderOption,
    getTableColumns,
    ensureContainerBlocks,
    ensureComponentListBlocks,
    getSelectedAddComponent: (key: string, fallback: string) => state.addComponentBySection[key] ?? fallback,
  };
}

function applyRichAction(action: string, editable: HTMLElement, value?: string): void {
  if (action === 'bold') {
    document.execCommand('bold');
  } else if (action === 'italic') {
    document.execCommand('italic');
  } else if (action === 'paragraph') {
    document.execCommand('formatBlock', false, 'p');
  } else if (action.startsWith('heading-')) {
    const level = action.split('-')[1] ?? '2';
    document.execCommand('formatBlock', false, `h${level}`);
  } else if (action === 'list') {
    document.execCommand('insertUnorderedList');
  } else if (action === 'link') {
    const url = (value ?? '').trim();
    if (!url) {
      return;
    }
    document.execCommand('createLink', false, url);
  }

  const inputEvent = new InputEvent('input', { bubbles: true });
  editable.dispatchEvent(inputEvent);
}

function deserializeDocument(text: string, extension: VisualDocument['extension']): VisualDocument {
  const parsed = parseHvy(text, extension);
  const meta = { ...parsed.meta };
  if (typeof meta.hvy_version === 'undefined') {
    meta.hvy_version = 0.1;
  }

  return {
    extension,
    meta,
    sections: parsed.sections.map((section) => mapParsedSection(section)),
  };
}

function mapParsedSection(section: HvySection): VisualSection {
  const sectionMeta = section.meta as JsonObject;
  const customId = sanitizeOptionalId(typeof sectionMeta.id === 'string' ? sectionMeta.id : section.id);
  const blocks = parseBlocks(section.contentMarkdown, sectionMeta);

  return {
    key: makeId('section'),
    customId,
    lock: sectionMeta.lock === true,
    idEditorOpen: false,
    isGhost: false,
    title: section.title || 'Untitled Section',
    level: section.level,
    expanded: sectionMeta.expanded === false ? false : true,
    highlight: sectionMeta.highlight === true,
    customCss: typeof sectionMeta.custom_css === 'string' ? sectionMeta.custom_css : '',
    blocks,
    children: section.children.map((child) => mapParsedSection(child)),
  };
}

function parseBlocks(contentMarkdown: string, sectionMeta: JsonObject): VisualBlock[] {
  const schemas = Array.isArray(sectionMeta.blocks) ? (sectionMeta.blocks as JsonObject[]) : [];
  const lines = contentMarkdown.split(/\r?\n/);
  const blockDirective = /^<!--hvy:block\s*(\{.*\})\s*-->$/;

  const blocks: VisualBlock[] = [];
  let currentText: string[] = [];
  let currentSchema: BlockSchema = schemaFromUnknown(schemas[0]);

  const flush = (): void => {
    if (currentText.length === 0 && blocks.length > 0) {
      return;
    }
    blocks.push({
      id: makeId('block'),
      text: currentText.join('\n').trim(),
      schema: currentSchema,
      schemaMode: false,
    });
    currentText = [];
    currentSchema = defaultBlockSchema();
  };

  lines.forEach((line) => {
    const match = line.trim().match(blockDirective);
    if (!match) {
      currentText.push(line);
      return;
    }

    flush();
    try {
      const parsed = JSON.parse(match[1] ?? '{}') as JsonObject;
      currentSchema = schemaFromUnknown(parsed);
    } catch {
      currentSchema = defaultBlockSchema();
    }
  });

  flush();

  if (blocks.length === 0) {
    return [];
  }

  return blocks.map((block, index) => ({
    ...block,
    schema: schemaFromUnknown(schemas[index] ?? block.schema),
  }));
}

function serializeDocument(document: VisualDocument): string {
  const headerMeta = {
    ...document.meta,
    hvy_version: document.meta.hvy_version ?? 0.1,
  };
  const frontMatter = `---\n${stringifyYaml(headerMeta).trim()}\n---\n`;
  const body = document.sections
    .filter((section) => !section.isGhost)
    .map((section) => serializeSection(section, 1))
    .join('\n')
    .trim();
  return `${frontMatter}\n${body}\n`;
}

function serializeSection(section: VisualSection, level: number): string {
  const heading = `${'#'.repeat(Math.max(1, Math.min(level, 6)))} ${section.title}`;
  const meta: JsonObject = {
    id: getSectionId(section),
    lock: section.lock,
    expanded: section.expanded,
    highlight: section.highlight,
  };
  if (section.customCss.trim().length > 0) {
    meta.custom_css = section.customCss;
  }

  meta.blocks = section.blocks.map((block) => ({
    component: block.schema.component,
    lock: block.schema.lock,
    align: block.schema.align,
    slot: block.schema.slot,
    customCss: block.schema.customCss,
    codeLanguage: block.schema.codeLanguage,
    containerTitle: block.schema.containerTitle,
    containerBlocks: block.schema.containerBlocks,
    componentListComponent: block.schema.componentListComponent,
    componentListBlocks: block.schema.componentListBlocks,
    gridColumns: block.schema.gridColumns,
    gridItems: block.schema.gridItems.map((item) => ({
      id: item.id,
      column: item.column,
      block: item.block,
    })),
    tags: block.schema.tags,
    description: block.schema.description,
    pluginUrl: block.schema.pluginUrl,
    expandableStubComponent: block.schema.expandableStubComponent,
    expandableContentComponent: block.schema.expandableContentComponent,
    expandableStub: block.schema.expandableStub,
    expandableStubBlocks: block.schema.expandableStubBlocks,
    expandableAlwaysShowStub: block.schema.expandableAlwaysShowStub,
    expandableExpanded: block.schema.expandableExpanded,
    expandableContentBlocks: block.schema.expandableContentBlocks,
    tableColumns: block.schema.tableColumns,
    tableShowHeader: block.schema.tableShowHeader,
    tableRows: block.schema.tableRows,
  }));

  const directive = `<!--hvy: ${JSON.stringify(meta)}-->`;

  const blockText = section.blocks
    .map((block) => {
      const schemaDirective = `<!--hvy:block ${JSON.stringify(block.schema)}-->`;
      return `${schemaDirective}\n${block.text.trim()}`;
    })
    .join('\n\n');

  const children = section.children
    .filter((child) => !child.isGhost)
    .map((child) => serializeSection(child, level + 1))
    .join('\n\n');

  return `${heading}\n${directive}\n\n${blockText}${children ? `\n\n${children}` : ''}`;
}

function navigateToSection(sectionId: string): void {
  if (!sectionId) {
    return;
  }

  closeModal();
  renderApp();

  const target = document.getElementById(sectionId);
  if (!target) {
    return;
  }

  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTemporaryHighlight(sectionId);
}

function setTemporaryHighlight(sectionId: string): void {
  state.tempHighlights.add(sectionId);
  refreshReaderPanels();

  window.setTimeout(() => {
    state.tempHighlights.delete(sectionId);
    refreshReaderPanels();
  }, 1400);
}

function closeModal(): void {
  state.modalSectionKey = null;
  state.componentMetaModal = null;
  state.reusableSaveModal = null;
}

function closeModalIfTarget(sectionKey: string): void {
  if (state.modalSectionKey === sectionKey) {
    closeModal();
  }
  if (state.componentMetaModal?.sectionKey === sectionKey) {
    state.componentMetaModal = null;
  }
  if (state.reusableSaveModal?.sectionKey === sectionKey) {
    state.reusableSaveModal = null;
  }
}

function resetTransientUiState(): void {
  state.activeEditorBlock = null;
  state.activeEditorSectionTitleKey = null;
  state.clearSectionTitleOnFocusKey = null;
  state.modalSectionKey = null;
  state.reusableSaveModal = null;
  state.componentMetaModal = null;
  state.tempHighlights = new Set<string>();
  state.addComponentBySection = {};
  state.metaPanelOpen = false;
  state.selectedReusableComponentName = null;
  state.templateValues = {};
  state.gridAddComponentByBlock = {};
  state.lastHistoryGroup = null;
  state.lastHistoryAt = 0;
  state.pendingEditorCenterSectionKey = null;
  state.paneScroll = {
    editorTop: 0,
    readerTop: 0,
    windowTop: 0,
  };
}

function resetToBlankDocument(): void {
  state.document = createBlankDocument();
  state.filename = 'untitled.hvy';
  state.history = [];
  state.future = [];
  resetTransientUiState();
  renderApp();
}

function saveReusableFromModal(): void {
  const modal = state.reusableSaveModal;
  if (!modal) {
    return;
  }
  const input = app.querySelector<HTMLInputElement>('#reusableNameInput');
  const draftName = (input?.value ?? modal.draftName).trim();
  if (!draftName) {
    input?.focus();
    return;
  }

  if (modal.kind === 'component' && modal.blockId) {
    saveReusableComponent(modal.sectionKey, modal.blockId, draftName);
    return;
  }

  saveReusableSection(modal.sectionKey, draftName);
}

function saveReusableComponent(sectionKey: string, blockId: string, name: string): void {
  const block = findBlockByIds(sectionKey, blockId);
  if (!block) {
    return;
  }
  recordHistory(`save-def:${blockId}`);
  const defs = getComponentDefs();
  const existing = defs.find((def) => def.name === name);
  const nextDef = {
    name,
    baseType: resolveBaseComponent(block.schema.component),
    tags: block.schema.tags,
    description: block.schema.description,
    schema: cloneReusableSchema(block.schema, name),
    template: cloneReusableBlock({
      ...block,
      schema: cloneReusableSchema(block.schema, name),
    }),
  };
  if (existing) {
    existing.baseType = nextDef.baseType;
    existing.tags = nextDef.tags;
    existing.description = nextDef.description;
    existing.schema = nextDef.schema;
    existing.template = nextDef.template;
  } else {
    defs.push(nextDef);
  }
  state.document.meta.component_defs = defs;
  state.selectedReusableComponentName = name;
  block.schema.component = name;
  closeModal();
  renderApp();
  refreshReaderPanels();
}

function saveReusableSection(sectionKey: string, name: string): void {
  const section = findSectionByKey(state.document.sections, sectionKey);
  if (!section) {
    return;
  }
  recordHistory(`save-section:${sectionKey}`);
  const defs = getSectionDefs();
  const existing = defs.find((def) => def.name === name);
  const template = cloneReusableSection(section);
  if (existing) {
    existing.template = template;
  } else {
    defs.push({ name, template });
  }
  state.document.meta.section_defs = defs;
  closeModal();
  renderApp();
}

function createDefaultDocument(): VisualDocument {
  return deserializeDocument(bundledExampleHvy, '.hvy');
}

function createBlankDocument(): VisualDocument {
  return {
    meta: {
      hvy_version: 0.1,
    },
    extension: '.hvy',
    sections: [],
  };
}

function createEmptySection(level: number, component = 'container', isGhost = false): VisualSection {
  return {
    key: makeId('section'),
    customId: '',
    lock: false,
    idEditorOpen: false,
    isGhost,
    title: isGhost ? 'New Component' : 'Unnamed Section',
    level,
    expanded: true,
    highlight: false,
    customCss: '',
    blocks: component ? [createEmptyBlock(component)] : [],
    children: [],
  };
}

function isDefaultUntitledSectionTitle(title: string): boolean {
  return title.trim() === '' || title.trim() === 'Unnamed Section';
}

function formatSectionTitle(title: string): string {
  return isDefaultUntitledSectionTitle(title) ? 'Unnamed Section' : title;
}

function createEmptyBlock(component = 'text', skipComponentDefaults = false): VisualBlock {
  const reusableInstance = instantiateReusableBlock(component);
  if (reusableInstance) {
    return reusableInstance;
  }
  const schema = defaultBlockSchema(component);
  if (!skipComponentDefaults) {
    applyComponentDefaults(schema, component);
  }
  return {
    id: makeId('block'),
    text: '',
    schema,
    schemaMode: false,
  };
}

function createDefaultTableRow(columnCount: number): TableRow {
  return {
    cells: new Array(Math.max(columnCount, 1)).fill(''),
    expanded: false,
    clickable: true,
    detailsTitle: '',
    detailsContent: '',
    detailsComponent: 'container',
    detailsBlocks: [createEmptyBlock('container', true)],
  };
}

function defaultBlockSchema(component = 'text'): BlockSchema {
  return {
    component,
    lock: false,
    align: 'left',
    slot: 'center',
    customCss: 'margin: 0.5rem 0;',
    codeLanguage: 'ts',
    containerTitle: 'Container',
    containerBlocks: [],
    componentListComponent: 'text',
    componentListBlocks: [],
    gridColumns: 2,
    gridItems: [],
    tags: '',
    description: '',
    metaOpen: false,
    pluginUrl: '',
    expandableStubComponent: 'container',
    expandableContentComponent: 'container',
    expandableStub: '',
    expandableStubBlocks: [],
    expandableAlwaysShowStub: true,
    expandableExpanded: false,
    expandableContentBlocks: [],
    tableColumns: 'Column 1, Column 2',
    tableShowHeader: true,
    tableRows: [],
  };
}

function normalizeTableColumns(columns: string[]): string[] {
  const cleaned = columns.map((column) => column.trim());
  const nonEmpty = cleaned.filter((column) => column.length > 0);
  const source = nonEmpty.length > 0 ? cleaned : ['Column 1', 'Column 2'];
  return source.map((column, index) => column.trim() || `Column ${index + 1}`);
}

function getTableColumns(schema: BlockSchema): string[] {
  return normalizeTableColumns(splitColumns(schema.tableColumns));
}

function setTableColumns(schema: BlockSchema, columns: string[]): void {
  const normalized = normalizeTableColumns(columns);
  schema.tableColumns = normalized.join(', ');
  schema.tableRows = schema.tableRows.map((row) => ({
    ...row,
    cells: normalized.map((_, index) => row.cells[index] ?? ''),
  }));
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length) {
    return items.slice();
  }
  const next = items.slice();
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

function addTableColumn(schema: BlockSchema): void {
  const columns = getTableColumns(schema);
  const nextColumns = [...columns, `Column ${columns.length + 1}`];
  setTableColumns(schema, nextColumns);
}

function removeTableColumn(schema: BlockSchema, columnIndex: number): void {
  const columns = getTableColumns(schema);
  if (columns.length <= 1 || columnIndex < 0 || columnIndex >= columns.length) {
    return;
  }
  const nextColumns = columns.filter((_, index) => index !== columnIndex);
  setTableColumns(schema, nextColumns);
}

function moveTableColumn(schema: BlockSchema, fromIndex: number, toIndex: number): void {
  const columns = getTableColumns(schema);
  if (fromIndex === toIndex) {
    return;
  }
  const nextColumns = moveItem(columns, fromIndex, toIndex);
  const rows = schema.tableRows.map((row) => ({
    ...row,
    cells: moveItem(nextColumns.map((_, index) => row.cells[index] ?? ''), fromIndex, toIndex),
  }));
  schema.tableRows = rows;
  schema.tableColumns = nextColumns.join(', ');
}

function moveTableRow(schema: BlockSchema, fromIndex: number, toIndex: number): void {
  if (fromIndex === toIndex) {
    return;
  }
  schema.tableRows = moveItem(schema.tableRows, fromIndex, toIndex);
}

function normalizeInlineText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\s*\n+\s*/g, ' ').trim();
}

function getInlineEditableText(target: HTMLElement): string {
  return normalizeInlineText(target.innerText || target.textContent || '');
}

function parseVisualBlock(candidate: unknown): VisualBlock {
  if (!candidate || typeof candidate !== 'object') {
    return createEmptyBlock('container', true);
  }
  const raw = candidate as JsonObject;
  const schema = schemaFromUnknown(raw.schema);
  return {
    id: typeof raw.id === 'string' ? raw.id : makeId('block'),
    text: typeof raw.text === 'string' ? raw.text : '',
    schema,
    schemaMode: raw.schemaMode === true,
  };
}

function schemaFromUnknown(value: unknown): BlockSchema {
  if (!value || typeof value !== 'object') {
    return defaultBlockSchema('text');
  }
  const candidate = value as JsonObject;
  const component = typeof candidate.component === 'string' ? candidate.component : 'text';
  const defaults = defaultBlockSchema(component);
  const rows = Array.isArray(candidate.tableRows) ? candidate.tableRows : [];
  const gridColumns = coerceGridColumns(candidate.gridColumns ?? candidate.gridTemplateColumns);
  const parsedGridItems = parseGridItems(candidate, gridColumns);
  return {
    component,
    lock: candidate.lock === true,
    align: coerceAlign(typeof candidate.align === 'string' ? candidate.align : 'left'),
    slot: coerceSlot(typeof candidate.slot === 'string' ? candidate.slot : 'center'),
    customCss:
      typeof candidate.customCss === 'string'
        ? candidate.customCss
        : typeof candidate.custom_css === 'string'
        ? candidate.custom_css
        : defaults.customCss,
    codeLanguage: typeof candidate.codeLanguage === 'string' ? candidate.codeLanguage : defaults.codeLanguage,
    containerTitle: typeof candidate.containerTitle === 'string' ? candidate.containerTitle : defaults.containerTitle,
    containerBlocks: Array.isArray(candidate.containerBlocks)
      ? candidate.containerBlocks.map((block) => parseVisualBlock(block))
      : [],
    componentListComponent:
      typeof candidate.componentListComponent === 'string' ? candidate.componentListComponent : defaults.componentListComponent,
    componentListBlocks: Array.isArray(candidate.componentListBlocks)
      ? candidate.componentListBlocks.map((block) => parseVisualBlock(block))
      : [],
    gridColumns,
    gridItems: parsedGridItems,
    tags: typeof candidate.tags === 'string' ? candidate.tags : defaults.tags,
    description: typeof candidate.description === 'string' ? candidate.description : defaults.description,
    metaOpen: candidate.metaOpen === true,
    pluginUrl: typeof candidate.pluginUrl === 'string' ? candidate.pluginUrl : defaults.pluginUrl,
    expandableStubComponent:
      typeof candidate.expandableStubComponent === 'string' ? candidate.expandableStubComponent : defaults.expandableStubComponent,
    expandableContentComponent:
      typeof candidate.expandableContentComponent === 'string' ? candidate.expandableContentComponent : defaults.expandableContentComponent,
    expandableStub: typeof candidate.expandableStub === 'string' ? candidate.expandableStub : defaults.expandableStub,
    expandableStubBlocks: Array.isArray(candidate.expandableStubBlocks)
      ? candidate.expandableStubBlocks.map((block) => parseVisualBlock(block))
      : [],
    expandableAlwaysShowStub: candidate.expandableAlwaysShowStub !== false,
    expandableExpanded: candidate.expandableExpanded === true,
    expandableContentBlocks: Array.isArray(candidate.expandableContentBlocks)
      ? candidate.expandableContentBlocks.map((block) => parseVisualBlock(block))
      : [],
    tableColumns: typeof candidate.tableColumns === 'string' ? candidate.tableColumns : defaults.tableColumns,
    tableShowHeader: candidate.tableShowHeader !== false,
    tableRows: rows.map((row) => {
      const mapped = row as JsonObject;
      return {
        cells: Array.isArray(mapped.cells) ? mapped.cells.map((cell) => String(cell ?? '')) : createDefaultTableRow(2).cells,
        expanded: mapped.expanded === true,
        clickable: mapped.clickable !== false,
        detailsTitle: typeof mapped.detailsTitle === 'string' ? mapped.detailsTitle : '',
        detailsContent:
          typeof mapped.detailsContent === 'string' ? mapped.detailsContent : typeof mapped.details === 'string' ? mapped.details : '',
        detailsComponent: 'container',
        detailsBlocks: Array.isArray(mapped.detailsBlocks)
          ? mapped.detailsBlocks.map((block) => parseVisualBlock(block))
          : createDefaultTableRow(2).detailsBlocks,
      };
    }),
  };
}

function cloneReusableSchema(schema: BlockSchema, componentName = schema.component): BlockSchema {
  const cloned = schemaFromUnknown(JSON.parse(JSON.stringify(schema)) as JsonObject);
  cloned.component = componentName;
  cloned.containerBlocks = cloned.containerBlocks.map((block) => cloneReusableBlock(block));
  cloned.componentListBlocks = cloned.componentListBlocks.map((block) => cloneReusableBlock(block));
  cloned.gridItems = cloned.gridItems.map((item) => ({
    ...item,
    block: cloneReusableBlock(item.block),
  }));
  cloned.expandableStubBlocks = cloned.expandableStubBlocks.map((block) => cloneReusableBlock(block));
  cloned.expandableContentBlocks = cloned.expandableContentBlocks.map((block) => cloneReusableBlock(block));
  cloned.tableRows = cloned.tableRows.map((row) => ({
    ...row,
    detailsBlocks: (row.detailsBlocks ?? []).map((block) => cloneReusableBlock(block)),
  }));
  return cloned;
}

function cloneReusableBlock(block: VisualBlock): VisualBlock {
  return {
    id: makeId('block'),
    text: block.text,
    schema: cloneReusableSchema(block.schema, block.schema.component),
    schemaMode: false,
  };
}

function cloneReusableSection(section: VisualSection, targetLevel = section.level): VisualSection {
  const levelDelta = targetLevel - section.level;
  return cloneReusableSectionWithDelta(section, levelDelta);
}

function cloneReusableSectionWithDelta(section: VisualSection, levelDelta: number): VisualSection {
  return {
    key: makeId('section'),
    customId: '',
    idEditorOpen: false,
    isGhost: false,
    title: section.title,
    level: Math.max(1, Math.min(6, section.level + levelDelta)),
    lock: section.lock,
    expanded: section.expanded,
    highlight: section.highlight,
    customCss: section.customCss,
    blocks: section.blocks.map((block) => cloneReusableBlock(block)),
    children: section.children.map((child) => cloneReusableSectionWithDelta(child, levelDelta)),
  };
}

function instantiateReusableBlock(componentName: string): VisualBlock | null {
  const def = getComponentDefs().find((item) => item.name === componentName);
  if (!def) {
    return null;
  }
  const template = getReusableTemplate(def);
  const instance = cloneReusableBlock(template);
  instance.schema.component = componentName;
  instance.schemaMode = false;
  return instance;
}

function findReusableOwner(sectionKey: string, blockId: string): VisualBlock | null {
  const reusableName = getReusableNameFromSectionKey(sectionKey);
  if (reusableName) {
    const template = getReusableTemplateByName(reusableName);
    if (!template) {
      return null;
    }
    return findReusableOwnerInList([template], blockId, null);
  }
  const section = findSectionByKey(state.document.sections, sectionKey);
  if (!section) {
    return null;
  }
  return findReusableOwnerInList(section.blocks, blockId, null);
}

function findReusableOwnerInList(blocks: VisualBlock[], blockId: string, currentOwner: VisualBlock | null): VisualBlock | null {
  for (const block of blocks) {
    const nextOwner = isBuiltinComponent(block.schema.component) ? currentOwner : block;
    if (block.id === blockId) {
      return nextOwner;
    }
    const nested = findReusableOwnerInList(block.schema.containerBlocks ?? [], blockId, nextOwner)
      ?? findReusableOwnerInList(block.schema.componentListBlocks ?? [], blockId, nextOwner)
      ?? findReusableOwnerInList((block.schema.gridItems ?? []).map((item) => item.block), blockId, nextOwner)
      ?? findReusableOwnerInList(block.schema.expandableStubBlocks ?? [], blockId, nextOwner)
      ?? findReusableOwnerInList(block.schema.expandableContentBlocks ?? [], blockId, nextOwner);
    if (nested) {
      return nested;
    }
    for (const row of block.schema.tableRows ?? []) {
      const nestedDetails = findReusableOwnerInList(row.detailsBlocks ?? [], blockId, nextOwner);
      if (nestedDetails) {
        return nestedDetails;
      }
    }
  }
  return null;
}

function syncReusableTemplateForBlock(sectionKey: string, blockId: string): void {
  if (!state.showAdvancedEditor) {
    return;
  }
  const owner = findReusableOwner(sectionKey, blockId);
  if (!owner || isBuiltinComponent(owner.schema.component)) {
    return;
  }
  const defs = getComponentDefs();
  const def = defs.find((item) => item.name === owner.schema.component);
  if (!def) {
    return;
  }
  const reusableName = getReusableNameFromSectionKey(sectionKey);
  if (reusableName === def.name) {
    def.template = owner;
  } else {
    def.template = cloneReusableBlock(owner);
  }
  def.baseType = resolveBaseComponent(def.name);
  def.tags = owner.schema.tags;
  def.description = owner.schema.description;
  def.schema = cloneReusableSchema(def.template.schema, def.name);
  state.document.meta.component_defs = defs;
  applyReusableTemplateToDocument(def.name, def.template, reusableName === def.name ? null : owner.id);
}

function applyReusableTemplateToDocument(name: string, template: VisualBlock, excludeBlockId: string | null): void {
  visitBlocks(state.document.sections, (block) => {
    if (block.schema.component !== name || block.id === excludeBlockId) {
      return;
    }
    const next = cloneReusableBlock(template);
    block.text = next.text;
    block.schema = next.schema;
    block.schema.component = name;
  });
}

function revertReusableComponent(def: ComponentDefinition): void {
  const template = getReusableTemplate(def);
  visitBlocks(state.document.sections, (block) => {
    if (block.schema.component !== def.name) {
      return;
    }
    const next = cloneReusableBlock(template);
    block.text = next.text;
    block.schema = next.schema;
    block.schema.component = def.baseType;
  });
}

function visitBlocks(sections: VisualSection[], visitor: (block: VisualBlock) => void): void {
  sections.forEach((section) => visitBlocksInList(section.blocks, visitor));
}

function visitBlocksInList(blocks: VisualBlock[], visitor: (block: VisualBlock) => void): void {
  blocks.forEach((block) => {
    visitor(block);
    visitBlocksInList(block.schema.containerBlocks ?? [], visitor);
    visitBlocksInList(block.schema.componentListBlocks ?? [], visitor);
    visitBlocksInList((block.schema.gridItems ?? []).map((item) => item.block), visitor);
    visitBlocksInList(block.schema.expandableStubBlocks ?? [], visitor);
    visitBlocksInList(block.schema.expandableContentBlocks ?? [], visitor);
    (block.schema.tableRows ?? []).forEach((row) => visitBlocksInList(row.detailsBlocks ?? [], visitor));
  });
}

function coerceAlign(value: string): Align {
  if (value === 'center' || value === 'right') {
    return value;
  }
  return 'left';
}

function coerceSlot(value: string): Slot {
  if (value === 'left' || value === 'right') {
    return value;
  }
  return 'center';
}

function flattenSections(sections: VisualSection[]): VisualSection[] {
  const output: VisualSection[] = [];
  const walk = (nodes: VisualSection[]): void => {
    nodes.forEach((node) => {
      output.push(node);
      walk(node.children);
    });
  };
  walk(sections);
  return output;
}

function findSectionByKey(sections: VisualSection[], sectionKey: string): VisualSection | null {
  for (const section of sections) {
    if (section.key === sectionKey) {
      return section;
    }
    const nested = findSectionByKey(section.children, sectionKey);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function findSectionContainer(
  sections: VisualSection[],
  sectionKey: string,
  parent: VisualSection | null = null
): { container: VisualSection[]; index: number; parent: VisualSection | null } | null {
  const index = sections.findIndex((section) => section.key === sectionKey);
  if (index >= 0) {
    return { container: sections, index, parent };
  }

  for (const section of sections) {
    const nested = findSectionContainer(section.children, sectionKey, section);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function sectionContainsKey(section: VisualSection, sectionKey: string): boolean {
  if (section.key === sectionKey) {
    return true;
  }
  return section.children.some((child) => sectionContainsKey(child, sectionKey));
}

function moveSectionRelative(
  sections: VisualSection[],
  draggedKey: string,
  targetKey: string,
  position: 'before' | 'after'
): boolean {
  if (draggedKey === targetKey) {
    return false;
  }

  const draggedLocation = findSectionContainer(sections, draggedKey);
  const targetLocation = findSectionContainer(sections, targetKey);
  if (!draggedLocation || !targetLocation) {
    return false;
  }

  const draggedSection = draggedLocation.container[draggedLocation.index];
  const targetSection = targetLocation.container[targetLocation.index];
  if (!draggedSection || !targetSection || draggedSection.level !== targetSection.level || sectionContainsKey(draggedSection, targetKey)) {
    return false;
  }

  draggedLocation.container.splice(draggedLocation.index, 1);
  const nextTargetLocation = findSectionContainer(sections, targetKey);
  if (!nextTargetLocation) {
    draggedLocation.container.splice(draggedLocation.index, 0, draggedSection);
    return false;
  }

  const insertIndex = position === 'before' ? nextTargetLocation.index : nextTargetLocation.index + 1;
  nextTargetLocation.container.splice(insertIndex, 0, draggedSection);
  return true;
}

function moveSectionByOffset(sections: VisualSection[], sectionKey: string, offset: -1 | 1): boolean {
  const location = findSectionContainer(sections, sectionKey);
  if (!location) {
    return false;
  }
  const targetIndex = location.index + offset;
  if (targetIndex < 0 || targetIndex >= location.container.length) {
    return false;
  }
  const [movedSection] = location.container.splice(location.index, 1);
  if (!movedSection) {
    return false;
  }
  location.container.splice(targetIndex, 0, movedSection);
  return true;
}

function moveBlockByOffset(sectionKey: string, blockId: string, offset: -1 | 1): boolean {
  const location = findBlockContainerById(state.document.sections, sectionKey, blockId);
  if (!location) {
    return false;
  }
  const targetIndex = location.index + offset;
  if (targetIndex < 0 || targetIndex >= location.container.length) {
    return false;
  }
  const [block] = location.container.splice(location.index, 1);
  if (!block) {
    return false;
  }
  location.container.splice(targetIndex, 0, block);
  syncReusableTemplateForBlock(sectionKey, location.ownerBlockId ?? blockId);
  return true;
}

function findBlockContainerById(
  sections: VisualSection[],
  sectionKey: string,
  blockId: string
): { container: VisualBlock[]; index: number; ownerBlockId: string | null } | null {
  const section = findSectionByKey(sections, sectionKey);
  if (!section) {
    return null;
  }
  return findBlockContainerInList(section.blocks, blockId, null);
}

function findBlockContainerInList(
  blocks: VisualBlock[],
  blockId: string,
  ownerBlockId: string | null
): { container: VisualBlock[]; index: number; ownerBlockId: string | null } | null {
  const index = blocks.findIndex((block) => block.id === blockId);
  if (index >= 0) {
    return { container: blocks, index, ownerBlockId };
  }
  for (const block of blocks) {
    const nested =
      findBlockContainerInList(block.schema.containerBlocks ?? [], blockId, block.id) ??
      findBlockContainerInList(block.schema.componentListBlocks ?? [], blockId, block.id) ??
      findBlockContainerInList((block.schema.gridItems ?? []).map((item) => item.block), blockId, block.id) ??
      findBlockContainerInList(block.schema.expandableStubBlocks ?? [], blockId, block.id) ??
      findBlockContainerInList(block.schema.expandableContentBlocks ?? [], blockId, block.id);
    if (nested) {
      return nested;
    }
    for (const row of block.schema.tableRows ?? []) {
      const details = findBlockContainerInList(row.detailsBlocks ?? [], blockId, block.id);
      if (details) {
        return details;
      }
    }
  }
  return null;
}

function removeSectionByKey(sections: VisualSection[], sectionKey: string): boolean {
  const index = sections.findIndex((section) => section.key === sectionKey);
  if (index >= 0) {
    sections.splice(index, 1);
    return true;
  }

  for (const section of sections) {
    if (removeSectionByKey(section.children, sectionKey)) {
      return true;
    }
  }

  return false;
}

function findDuplicateSectionIds(sections: VisualSection[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();

  flattenSections(sections).forEach((section) => {
    const id = getSectionId(section);
    if (seen.has(id)) {
      dupes.add(id);
    }
    seen.add(id);
  });

  return [...dupes];
}

function getSectionId(section: VisualSection): string {
  return section.customId.trim().length > 0 ? section.customId.trim() : section.key;
}

function markdownToEditorHtml(markdown: string): string {
  return DOMPurify.sanitize(marked.parse(markdown || '') as string);
}

function normalizeMarkdownLists(markdown: string): string {
  const lines = markdown.split(/\r?\n/).map((line) => line.replace(/^(\s*)\\-/, '$1-'));
  const out: string[] = [];
  let inList = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const bullet = line.match(/^(\s*)[-*+]\s*(.+)$/);
    if (bullet) {
      if (!inList && out.length > 0 && out[out.length - 1].trim().length > 0) {
        out.push('');
      }
      out.push(`${bullet[1]}- ${bullet[2].trim()}`);
      inList = true;
      continue;
    }

    if (line.trim().length === 0) {
      const next = lines[i + 1] ?? '';
      if (inList && /^(\s*)[-*+]\s*(.+)$/.test(next)) {
        continue;
      }
      inList = false;
      out.push('');
      continue;
    }

    inList = false;
    out.push(line);
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

function splitColumns(value: string): string[] {
  const columns = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return columns.length > 0 ? columns : ['Column 1', 'Column 2'];
}

function createGridItem(index: number, columns: number): GridItem {
  const column = columns <= 1 ? 'full' : index % 2 === 0 ? 'left' : 'right';
  return { id: makeId('griditem'), column, block: { id: makeId('block'), text: '', schema: defaultBlockSchema('text'), schemaMode: false } };
}

function coerceGridColumns(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.min(6, Math.round(value)));
  }
  if (typeof value === 'string') {
    const parsedInt = Number.parseInt(value, 10);
    if (!Number.isNaN(parsedInt)) {
      return Math.max(1, Math.min(6, parsedInt));
    }
    const tokens = value
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
    if (tokens.length > 0) {
      return Math.max(1, Math.min(6, tokens.length));
    }
  }
  return 2;
}

function coerceGridColumn(value: unknown, columns: number): GridColumn {
  if (columns <= 1) {
    return 'full';
  }
  if (value === 'right') {
    return 'right';
  }
  if (value === 'full') {
    return 'full';
  }
  return 'left';
}

function parseGridItems(candidate: JsonObject, columns: number): GridItem[] {
  const items: GridItem[] = [];
  if (Array.isArray(candidate.gridItems)) {
    (candidate.gridItems as unknown[]).forEach((raw) => {
      if (!raw || typeof raw !== 'object') {
        return;
      }
      const item = raw as JsonObject;
      items.push({
        id: typeof item.id === 'string' ? item.id : makeId('griditem'),
        column: coerceGridColumn(item.column, columns),
        block: item.block ? parseVisualBlock(item.block) : (() => {
          const block = createEmptyBlock(typeof item.component === 'string' ? item.component : 'text', true);
          block.text = typeof item.content === 'string' ? item.content : '';
          return block;
        })(),
      });
    });
    if (items.length > 0) {
      return items;
    }
  }

  // Backward compatibility with prior object-key grid model.
  if (candidate.gridItems && typeof candidate.gridItems === 'object') {
    const keyedItems = candidate.gridItems as Record<string, unknown>;
    Object.values(keyedItems).forEach((raw, index) => {
      if (!raw || typeof raw !== 'object') {
        return;
      }
      const item = raw as JsonObject;
      items.push({
        id: makeId('griditem'),
        column: coerceGridColumn(index % 2 === 0 ? 'left' : 'right', columns),
        block: (() => {
          const block = createEmptyBlock(typeof item.component === 'string' ? item.component : 'text', true);
          block.text = typeof item.content === 'string' ? item.content : '';
          return block;
        })(),
      });
    });
    if (items.length > 0) {
      return items;
    }
  }

  // Backward compatibility with old keys/values model.
  const legacyKeysRaw = typeof candidate.gridKeys === 'string' ? candidate.gridKeys : '';
  const legacyKeys = legacyKeysRaw
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
  const legacyValues =
    typeof candidate.gridValues === 'object' && candidate.gridValues ? (candidate.gridValues as Record<string, unknown>) : {};
  legacyKeys.forEach((key, index) => {
    items.push({
      id: makeId('griditem'),
      column: coerceGridColumn(index % 2 === 0 ? 'left' : 'right', columns),
      block: (() => {
        const block = createEmptyBlock('text', true);
        block.text = typeof legacyValues[key] === 'string' ? (legacyValues[key] as string) : '';
        return block;
      })(),
    });
  });

  if (items.length === 0) {
    return [createGridItem(0, columns), createGridItem(1, columns)];
  }
  return items;
}

function ensureGridItems(schema: BlockSchema): void {
  if (!Array.isArray(schema.gridItems)) {
    schema.gridItems = [createGridItem(0, schema.gridColumns), createGridItem(1, schema.gridColumns)];
    return;
  }
  if (schema.gridItems.length === 0) {
    schema.gridItems.push(createGridItem(0, schema.gridColumns));
  }
  schema.gridItems = schema.gridItems.map((item) => ({
    id: item.id || makeId('griditem'),
    column: coerceGridColumn(item.column, schema.gridColumns),
    block: item.block ? parseVisualBlock(item.block) : createEmptyBlock('text', true),
  }));
}

interface ComponentDefinition {
  name: string;
  baseType: string;
  tags?: string;
  description?: string;
  schema?: BlockSchema;
  template?: VisualBlock;
}

interface SectionDefinition {
  name: string;
  template: VisualSection;
}

function getComponentDefs(): ComponentDefinition[] {
  const defs = state.document.meta.component_defs;
  if (!Array.isArray(defs)) {
    return [];
  }
  return defs.filter((item): item is ComponentDefinition => !!item && typeof item === 'object' && 'name' in item);
}

function getSectionDefs(): SectionDefinition[] {
  const defs = state.document.meta.section_defs;
  if (!Array.isArray(defs)) {
    return [];
  }
  return defs.filter((item): item is SectionDefinition => !!item && typeof item === 'object' && 'name' in item && 'template' in item);
}

function getReusableNameFromSectionKey(sectionKey: string): string | null {
  return sectionKey.startsWith(REUSABLE_SECTION_PREFIX) ? sectionKey.slice(REUSABLE_SECTION_PREFIX.length) : null;
}

function renderReusableSectionOptions(selected: string): string {
  const options = [
    `<option value="blank"${selected === 'blank' ? ' selected' : ''}>Blank</option>`,
    ...getSectionDefs().map((def) => {
      const value = `${REUSABLE_SECTION_DEF_PREFIX}${def.name}`;
      return `<option value="${escapeAttr(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(def.name)}</option>`;
    }),
  ];
  return options.join('');
}

function getReusableTemplate(def: ComponentDefinition): VisualBlock {
  if (def.template) {
    return def.template;
  }
  const fallbackSchema = def.schema ? cloneReusableSchema(def.schema, def.name) : defaultBlockSchema(def.name);
  def.template = {
    id: makeId('block'),
    text: '',
    schema: fallbackSchema,
    schemaMode: true,
  };
  return def.template;
}

function getReusableTemplateByName(name: string): VisualBlock | null {
  const def = getComponentDefs().find((item) => item.name === name);
  return def ? getReusableTemplate(def) : null;
}

function instantiateReusableSection(name: string, level: number): VisualSection | null {
  const normalizedName = name.startsWith(REUSABLE_SECTION_DEF_PREFIX) ? name.slice(REUSABLE_SECTION_DEF_PREFIX.length) : name;
  const def = getSectionDefs().find((item) => item.name === normalizedName);
  if (!def) {
    return null;
  }
  return cloneReusableSection(def.template, level);
}

function getComponentOptions(): string[] {
  const builtins = ['text', 'quote', 'code', 'expandable', 'table', 'container', 'component-list', 'grid', 'plugin'];
  const custom = getComponentDefs()
    .map((def) => def.name.trim())
    .filter((name) => name.length > 0);
  return [...new Set([...builtins, ...custom])];
}

function isBuiltinComponent(componentName: string): boolean {
  return ['text', 'quote', 'code', 'expandable', 'table', 'container', 'component-list', 'grid', 'plugin'].includes(componentName);
}

function renderComponentOptions(selected: string): string {
  return getComponentOptions().map((option) => renderOption(option, selected)).join('');
}

function resolveBaseComponent(componentName: string): string {
  if (['text', 'quote', 'code', 'expandable', 'table', 'container', 'component-list', 'grid', 'plugin'].includes(componentName)) {
    return componentName;
  }
  const def = getComponentDefs().find((item) => item.name === componentName);
  return def?.baseType || 'text';
}

function applyComponentDefaults(schema: BlockSchema, componentName: string): void {
  const def = getComponentDefs().find((item) => item.name === componentName);
  const base = resolveBaseComponent(componentName);
  if (def?.template) {
    const next = cloneReusableSchema(def.template.schema, componentName);
    Object.assign(schema, next);
    return;
  }
  if (def?.schema) {
    Object.assign(schema, cloneReusableSchema(def.schema, componentName));
    return;
  }
  if (base === 'table' && schema.tableRows.length === 0) {
    schema.tableRows.push(createDefaultTableRow(getTableColumns(schema).length));
  }
  if (base === 'grid') {
    ensureGridItems(schema);
  }
  if (base === 'component-list') {
    schema.componentListComponent = 'text';
    ensureComponentListBlocks({ id: '', text: '', schema, schemaMode: false });
  }
  if (!def) {
    return;
  }
  if (!schema.tags) {
    schema.tags = def.tags ?? '';
  }
  if (!schema.description) {
    schema.description = def.description ?? '';
  }
}

function renderOption(value: string, selected: string): string {
  return `<option value="${escapeAttr(value)}" ${selected === value ? 'selected' : ''}>${escapeHtml(value)}</option>`;
}

function detectExtension(filename: string, fallbackContent: string): VisualDocument['extension'] {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.thvy')) {
    return '.thvy';
  }
  if (lower.endsWith('.hvy')) {
    return '.hvy';
  }
  if (lower.endsWith('.md')) {
    return '.md';
  }
  if (/template\s*:\s*true/m.test(fallbackContent)) {
    return '.thvy';
  }
  return '.hvy';
}

function normalizeFilename(input: string): string {
  if (input.endsWith('.hvy') || input.endsWith('.thvy') || input.endsWith('.md')) {
    return input;
  }
  return `${input}.hvy`;
}

function downloadTextFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  window.document.body.appendChild(anchor);
  anchor.click();
  window.document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function sanitizeOptionalId(input: string): string {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replaceAll('`', '&#096;');
}

function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${rand}`;
}

function snapshotState(): string {
  return JSON.stringify(
    {
      document: state.document,
      templateValues: state.templateValues,
      filename: state.filename,
    },
    null,
    2
  );
}

function commitHistorySnapshot(): void {
  if (state.isRestoring) {
    return;
  }
  const snap = snapshotState();
  const last = state.history[state.history.length - 1];
  if (last !== snap) {
    state.history.push(snap);
    if (state.history.length > 200) {
      state.history.shift();
    }
    state.future = [];
  }
}

function ensureHistoryInitialized(): void {
  if (state.history.length === 0) {
    commitHistorySnapshot();
  }
}

function recordHistory(group?: string): void {
  if (state.isRestoring) {
    return;
  }
  ensureHistoryInitialized();
  const snap = snapshotState();
  if (group) {
    const now = Date.now();
    if (state.lastHistoryGroup === group && now - state.lastHistoryAt < HISTORY_GROUP_WINDOW_MS) {
      return;
    }
    state.lastHistoryGroup = group;
    state.lastHistoryAt = now;
  } else {
    state.lastHistoryGroup = null;
    state.lastHistoryAt = 0;
  }
  if (state.history[state.history.length - 1] !== snap) {
    state.history.push(snap);
    if (state.history.length > 200) {
      state.history.shift();
    }
    state.future = [];
  }
}

function undoState(): void {
  ensureHistoryInitialized();
  const current = snapshotState();
  const last = state.history[state.history.length - 1];
  if (last !== current) {
    state.history.push(current);
  }
  if (state.history.length <= 1) {
    return;
  }
  state.isRestoring = true;
  const currentSnapshot = state.history.pop();
  if (currentSnapshot) {
    state.future.push(currentSnapshot);
  }
  const prev = state.history[state.history.length - 1];
  if (prev) {
    restoreFromSnapshot(prev);
  }
  state.lastHistoryGroup = null;
  state.lastHistoryAt = 0;
  state.isRestoring = false;
  renderApp();
}

function redoState(): void {
  ensureHistoryInitialized();
  const next = state.future.pop();
  if (!next) {
    return;
  }
  state.isRestoring = true;
  state.history.push(next);
  restoreFromSnapshot(next);
  state.lastHistoryGroup = null;
  state.lastHistoryAt = 0;
  state.isRestoring = false;
  renderApp();
}

function restoreFromSnapshot(snapshot: string): void {
  try {
    const parsed = JSON.parse(snapshot) as {
      document: VisualDocument;
      templateValues: Record<string, string>;
      filename: string;
    };
    state.document = parsed.document;
    state.templateValues = parsed.templateValues ?? {};
    state.filename = parsed.filename ?? 'document.hvy';
  } catch {
    // no-op
  }
}

function renderStateTracker(): string {
  ensureHistoryInitialized();
  const current = snapshotState();
  const previous =
    [...state.history]
      .reverse()
      .find((snapshot) => snapshot !== current) ?? current;
  const diff = computeSimpleDiff(previous, current);
  return `
    <section class="state-tracker">
      <div class="state-head">
        <strong>State Tracker</strong>
        <div class="state-actions">
          <button type="button" class="ghost" data-action="undo">Undo</button>
          <button type="button" class="ghost" data-action="redo">Redo</button>
        </div>
      </div>
      <pre>${escapeHtml(diff || 'No pending changes.')}</pre>
    </section>
  `;
}

function computeSimpleDiff(previous: string, current: string): string {
  if (previous === current) {
    return '';
  }
  const prevLines = previous.split('\n');
  const currLines = current.split('\n');
  const removed = prevLines.filter((line) => !currLines.includes(line)).slice(0, 30).map((line) => `- ${line}`);
  const added = currLines.filter((line) => !prevLines.includes(line)).slice(0, 30).map((line) => `+ ${line}`);
  return [...removed, ...added].join('\n');
}

function applyTheme(): void {
  const theme = getThemeConfig();
  const root = document.documentElement;
  root.style.setProperty('--hvy-bg', theme.background);
  root.style.setProperty('--hvy-surface', theme.surface);
  root.style.setProperty('--hvy-text', theme.text);
  root.style.setProperty('--hvy-accent', theme.accent);
  root.classList.toggle('theme-dark', theme.mode === 'dark');
}

interface ThemeConfig {
  mode: 'light' | 'dark';
  background: string;
  surface: string;
  text: string;
  accent: string;
}

function getThemeConfig(): ThemeConfig {
  const themeRaw = state.document.meta.theme;
  const fallback: ThemeConfig = {
    mode: 'light',
    background: '#f5f9ff',
    surface: '#ffffff',
    text: '#1a2530',
    accent: '#325f6e',
  };
  if (!themeRaw || typeof themeRaw !== 'object') {
    state.document.meta.theme = fallback;
    return fallback;
  }
  const theme = themeRaw as JsonObject;
  return {
    mode: theme.mode === 'dark' ? 'dark' : 'light',
    background: typeof theme.background === 'string' ? theme.background : fallback.background,
    surface: typeof theme.surface === 'string' ? theme.surface : fallback.surface,
    text: typeof theme.text === 'string' ? theme.text : fallback.text,
    accent: typeof theme.accent === 'string' ? theme.accent : fallback.accent,
  };
}
