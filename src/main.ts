import './style.css';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import TurndownService from 'turndown';
import { parseHvy } from './hvy/parser';
import { stringify as stringifyYaml } from 'yaml';
import type { HvySection, JsonObject } from './hvy/types';
import type { Align, BlockSchema, GridColumn, GridItem, Slot, TableRow, VisualBlock, VisualSection } from './editor/types';
import type { ComponentRenderHelpers } from './editor/component-helpers';
import { renderTextEditor, renderTextReader } from './editor/components/text';
import { renderCodeEditor, renderCodeReader } from './editor/components/code';
import { renderPluginEditor, renderPluginReader } from './editor/components/plugin';
import { renderContainerEditor, renderContainerReader } from './editor/components/container';
import { renderGridEditor, renderGridReader } from './editor/components/grid';
import { renderExpandableEditor, renderExpandableReader } from './editor/components/expandable';
import { renderTableDetailsEditor, renderTableEditor, renderTableReader } from './editor/components/table';
import {
  commitTagEditorDraft,
  handleRemoveTag,
  handleTagEditorInput,
  handleTagEditorKeydown,
  parseTags,
  renderTagEditor,
  serializeTags,
  type TagRenderOptions,
} from './editor/tag-editor';
import { getTemplateFields, renderTemplateGhosts, renderTemplatePanel } from './editor/template';

interface VisualDocument {
  meta: JsonObject;
  extension: '.hvy' | '.thvy' | '.md';
  sections: VisualSection[];
}

interface AppState {
  document: VisualDocument;
  filename: string;
  currentView: 'editor' | 'viewer';
  modalSectionKey: string | null;
  tempHighlights: Set<string>;
  addComponentBySection: Record<string, string>;
  metaPanelOpen: boolean;
  templateValues: Record<string, string>;
  history: string[];
  future: string[];
  isRestoring: boolean;
  componentMetaModal: { sectionKey: string; blockId: string } | null;
  gridAddComponentByBlock: Record<string, string>;
  lastHistoryGroup: string | null;
  lastHistoryAt: number;
  pendingEditorCenterSectionKey: string | null;
  tableDetailsModal: { sectionKey: string; blockId: string; rowIndex: number } | null;
  schemaDefDraftByBlock: Record<string, string>;
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
  emDelimiter: '*',
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
let pendingLinkRange: Range | null = null;
let pendingLinkEditable: HTMLElement | null = null;
let draggedSectionKey: string | null = null;
let draggedTableItem: { kind: 'row' | 'column'; sectionKey: string; blockId: string; index: number } | null = null;
const tagStateHelpers = {
  getTagState,
  setTagState,
  getRenderOptions: getTagRenderOptions,
};

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
    filename: 'document.hvy',
    currentView: 'editor',
    modalSectionKey: null,
    tempHighlights: new Set<string>(),
    addComponentBySection: {},
    metaPanelOpen: false,
    templateValues: {},
    history: [],
    future: [],
    isRestoring: false,
    componentMetaModal: null,
    gridAddComponentByBlock: {},
    lastHistoryGroup: null,
    lastHistoryAt: 0,
    pendingEditorCenterSectionKey: null,
    tableDetailsModal: null,
    schemaDefDraftByBlock: {},
  };
}

function renderApp(): void {
  const paneScroll = capturePaneScroll();
  applyTheme();
  const isEditorView = state.currentView === 'editor';
  const templateFields = getTemplateFields(state.document.meta);
  app.innerHTML = `
    <main class="layout">
      <header class="topbar">
        <div class="title-block">
          <h1>HVY Reference Implementation</h1>
          <p>Visual editor + reader for <code>.hvy</code> and <code>.thvy</code>.</p>
        </div>
        <div class="toolbar">
          <label class="file-picker">
            Select File
            <input id="fileInput" type="file" accept=".hvy,.thvy,.md,text/markdown,text/plain" />
          </label>
          <input id="downloadName" type="text" value="${escapeAttr(state.filename)}" aria-label="Download file name" />
          <button id="downloadBtn" type="button">Download File</button>
        </div>
      </header>

      <section class="workspace-shell">
        <div class="view-tabs" role="tablist" aria-label="Workspace view">
          <button type="button" class="${isEditorView ? 'secondary' : 'ghost'}" data-action="switch-view" data-view="editor">Editor</button>
          <button type="button" class="${!isEditorView ? 'secondary' : 'ghost'}" data-action="switch-view" data-view="viewer">Viewer</button>
        </div>
        <div class="pane ${isEditorView ? 'editor-pane' : 'reader-pane'} full-pane">
          ${
            isEditorView
              ? `<div class="pane-title-row">
                  <h2>Visual Editor</h2>
                  <div class="pane-controls">
                    <button id="toggleMetaBtn" type="button" class="ghost">${state.metaPanelOpen ? 'Hide Meta' : 'Show Meta'}</button>
                  </div>
                </div>
                ${renderTemplatePanel(templateFields, state.templateValues, { escapeAttr, escapeHtml })}
                ${state.metaPanelOpen ? renderMetaPanel() : ''}
                ${renderStateTracker()}
                <div id="editorTree" class="editor-tree">${renderSectionEditorTree(state.document.sections)}</div>`
              : `<div class="pane-title-row">
                  <h2>Viewer</h2>
                </div>
                <div id="readerWarnings" class="reader-warnings">${renderWarnings()}</div>
                <div id="readerNav" class="reader-nav">${renderNavigation(state.document.sections)}</div>
                <div id="readerDocument" class="reader-document">${renderReaderSections(state.document.sections)}</div>`
          }
        </div>
      </section>

      ${renderModal()}
      ${renderLinkInlineModal()}
    </main>
  `;

  bindUi();
  restorePaneScroll(paneScroll);
  commitHistorySnapshot();
  centerPendingEditorSection();
}

function capturePaneScroll(): PaneScrollState | null {
  const editorPane = app.querySelector<HTMLDivElement>('.editor-pane');
  const readerPane = app.querySelector<HTMLDivElement>('.reader-pane');
  if (!editorPane && !readerPane) {
    return null;
  }
  return {
    editorTop: editorPane?.scrollTop ?? 0,
    readerTop: readerPane?.scrollTop ?? 0,
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

function bindUi(): void {
  const fileInput = app.querySelector<HTMLInputElement>('#fileInput');
  const downloadBtn = app.querySelector<HTMLButtonElement>('#downloadBtn');
  const downloadName = app.querySelector<HTMLInputElement>('#downloadName');
  const toggleMetaBtn = app.querySelector<HTMLButtonElement>('#toggleMetaBtn');
  const readerDocument = app.querySelector<HTMLDivElement>('#readerDocument');
  const readerNav = app.querySelector<HTMLDivElement>('#readerNav');

  if (!fileInput || !downloadBtn || !downloadName) {
    throw new Error('Missing UI elements for binding.');
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) {
      return;
    }
    const text = await file.text();
    state.filename = file.name;
    state.document = deserializeDocument(text, detectExtension(file.name, text));
    closeModal();
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

  toggleMetaBtn?.addEventListener('click', () => {
    state.metaPanelOpen = !state.metaPanelOpen;
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

    if (field === 'schema-def-name' && target instanceof HTMLInputElement) {
      const blockId = target.dataset.blockId;
      if (blockId) {
        state.schemaDefDraftByBlock[blockId] = target.value;
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
      defs.splice(defIndex, 1);
      state.document.meta.component_defs = defs;
      renderApp();
      return;
    }

    if (action === 'save-component-def') {
      const sectionKey = actionButton.dataset.sectionKey;
      const blockId = actionButton.dataset.blockId;
      if (!sectionKey || !blockId) {
        return;
      }
      const block = findBlockByIds(sectionKey, blockId);
      if (!block) {
        return;
      }
      const draftName = (state.schemaDefDraftByBlock[blockId] ?? block.schema.component).trim();
      if (!draftName) {
        return;
      }
      recordHistory(`save-def:${blockId}`);
      const defs = getComponentDefs();
      const existing = defs.find((def) => def.name === draftName);
      const nextDef = {
        name: draftName,
        baseType: resolveBaseComponent(block.schema.component),
        tags: block.schema.tags,
        description: block.schema.description,
      };
      if (existing) {
        existing.baseType = nextDef.baseType;
        existing.tags = nextDef.tags;
        existing.description = nextDef.description;
      } else {
        defs.push(nextDef);
      }
      state.document.meta.component_defs = defs;
      state.schemaDefDraftByBlock[blockId] = draftName;
      block.schema.component = draftName;
      renderApp();
      refreshReaderPanels();
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
      const component = state.addComponentBySection.__top_level__ ?? 'container';
      const section = createEmptySection(1, component, false);
      state.document.sections.push(section);
      state.pendingEditorCenterSectionKey = section.key;
      renderApp();
      return;
    }

    if (!sectionKey) {
      return;
    }

    const section = findSectionByKey(state.document.sections, sectionKey);
    if (!section) {
      return;
    }

    if (action === 'spawn-child-ghost') {
      recordHistory();
      const component = state.addComponentBySection[section.key] ?? 'container';
      const child = createEmptySection(Math.min(section.level + 1, 6), component, false);
      section.children.push(child);
      state.pendingEditorCenterSectionKey = child.key;
      renderApp();
      return;
    }

    if (action === 'spawn-block-ghost') {
      recordHistory();
      const component = state.addComponentBySection[section.key] ?? 'container';
      const child = createEmptySection(Math.min(section.level + 1, 6), component, false);
      section.children.push(child);
      state.pendingEditorCenterSectionKey = child.key;
      renderApp();
      return;
    }

    if (action === 'add-subsection') {
      recordHistory();
      const child = createEmptySection(Math.min(section.level + 1, 6), 'container', false);
      section.children.push(child);
      state.pendingEditorCenterSectionKey = child.key;
      renderApp();
      return;
    }

    if (action === 'remove-section') {
      recordHistory();
      removeSectionByKey(state.document.sections, sectionKey);
      closeModalIfTarget(sectionKey);
      renderApp();
      return;
    }

    if (action === 'add-child') {
      recordHistory();
      const component = state.addComponentBySection[section.key] ?? 'container';
      section.children.push(createEmptySection(Math.min(section.level + 1, 6), component, true));
      renderApp();
      return;
    }

    if (action === 'add-block') {
      recordHistory();
      const component = state.addComponentBySection[section.key] ?? 'container';
      section.blocks.push(createEmptyBlock(component));
      renderApp();
      return;
    }

    if (action === 'add-row-details-block' && blockId) {
      recordHistory();
      const rowIndex = Number.parseInt(actionButton.dataset.rowIndex ?? '', 10);
      const row = findTableRow(sectionKey, blockId, rowIndex);
      if (!row) {
        return;
      }
      row.detailsBlocks.push(createEmptyBlock('container'));
      renderApp();
      return;
    }

    if (action === 'add-container-block' && blockId) {
      recordHistory();
      const block = findBlockByIds(sectionKey, blockId);
      if (!block) {
        return;
      }
      ensureContainerBlocks(block);
      const addKey = `container:${sectionKey}:${blockId}`;
      block.schema.containerBlocks.push(createEmptyBlock(state.addComponentBySection[addKey] ?? 'text'));
      renderApp();
      return;
    }

    if (action === 'add-expandable-stub-block' && blockId) {
      recordHistory();
      const block = findBlockByIds(sectionKey, blockId);
      if (!block) {
        return;
      }
      ensureExpandableBlocks(block);
      const addKey = `expandable-stub:${sectionKey}:${blockId}`;
      block.schema.expandableStubBlocks.push(createEmptyBlock(state.addComponentBySection[addKey] ?? 'container'));
      renderApp();
      return;
    }

    if (action === 'add-expandable-content-block' && blockId) {
      recordHistory();
      const block = findBlockByIds(sectionKey, blockId);
      if (!block) {
        return;
      }
      ensureExpandableBlocks(block);
      const addKey = `expandable-content:${sectionKey}:${blockId}`;
      block.schema.expandableContentBlocks.push(createEmptyBlock(state.addComponentBySection[addKey] ?? 'container'));
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
      refreshReaderPanels();
      renderApp();
      return;
    }

    if (action === 'remove-block' && blockId) {
      recordHistory();
      removeBlockFromList(section.blocks, blockId);
      renderApp();
      return;
    }

    if (action === 'add-table-row' && blockId) {
      recordHistory();
      const block = section.blocks.find((candidate) => candidate.id === blockId);
      if (!block) {
        return;
      }
      const columnCount = getTableColumns(block.schema).length;
      block.schema.tableRows.push(createDefaultTableRow(columnCount));
      renderApp();
      return;
    }

    if (action === 'add-table-column' && blockId) {
      recordHistory();
      const block = section.blocks.find((candidate) => candidate.id === blockId);
      if (!block) {
        return;
      }
      addTableColumn(block.schema);
      renderApp();
      return;
    }

    if (action === 'remove-table-column' && blockId) {
      recordHistory();
      const columnIndex = Number.parseInt(actionButton.dataset.columnIndex ?? '', 10);
      const block = section.blocks.find((candidate) => candidate.id === blockId);
      if (!block || Number.isNaN(columnIndex)) {
        return;
      }
      removeTableColumn(block.schema, columnIndex);
      renderApp();
      return;
    }

    if (action === 'remove-table-row' && blockId) {
      recordHistory();
      const rowIndex = Number.parseInt(actionButton.dataset.rowIndex ?? '', 10);
      const block = section.blocks.find((candidate) => candidate.id === blockId);
      if (!block || Number.isNaN(rowIndex)) {
        return;
      }
      block.schema.tableRows.splice(rowIndex, 1);
      renderApp();
      return;
    }

    if (action === 'open-table-details' && blockId) {
      const rowIndex = Number.parseInt(actionButton.dataset.rowIndex ?? '', 10);
      if (Number.isNaN(rowIndex)) {
        return;
      }
      const block = section.blocks.find((candidate) => candidate.id === blockId);
      const row = block?.schema.tableRows[rowIndex];
      if (!row) {
        return;
      }
      row.clickable = true;
      row.detailsComponent = 'container';
      state.tableDetailsModal = { sectionKey, blockId, rowIndex };
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
      if (!block) {
        return;
      }
      ensureGridItems(block.schema);
      const item = createGridItem(block.schema.gridItems.length, block.schema.gridColumns);
      item.component = state.gridAddComponentByBlock[blockId] ?? 'text';
      block.schema.gridItems.push(item);
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
      ensureGridItems(block.schema);
      renderApp();
      return;
    }

    if (action === 'toggle-id-editor') {
      recordHistory();
      section.idEditorOpen = !section.idEditorOpen;
      if (!section.idEditorOpen) {
        section.customId = '';
      }
      renderApp();
      return;
    }

    if (action === 'realize-ghost') {
      recordHistory();
      section.isGhost = false;
      renderApp();
      return;
    }

    if (action === 'jump-to-reader') {
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

    const section = findSectionByKey(state.document.sections, sectionKey);
    if (!section) {
      return;
    }

    const blockIdForHistory = target.dataset.blockId ?? '';
    if (field && field !== 'new-component-type') {
      recordHistory(`input:${sectionKey}:${blockIdForHistory}:${field}`);
    }

    if (field === 'section-title' && target instanceof HTMLInputElement) {
      section.title = target.value;
      refreshReaderPanels();
      return;
    }

    if (field === 'section-custom-id' && target instanceof HTMLInputElement) {
      section.customId = sanitizeOptionalId(target.value);
      refreshReaderPanels();
      return;
    }

    if (field === 'new-component-type' && target instanceof HTMLSelectElement) {
      state.addComponentBySection[section.key] = target.value;
      return;
    }

    if (field === 'section-highlight' && target instanceof HTMLInputElement) {
      section.highlight = target.checked;
      refreshReaderPanels();
      return;
    }

    if (field === 'section-expanded' && target instanceof HTMLInputElement) {
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
    if (handleBlockFieldInput(target)) {
      return;
    }
  });

  app.addEventListener('focusout', (event) => {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLInputElement) {
      commitTagEditorDraft(target, tagStateHelpers);
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
      return;
    }

    const rowToggle = target.closest<HTMLElement>('[data-reader-action="toggle-table-row"]');
    if (rowToggle) {
      const sectionKey = rowToggle.dataset.sectionKey;
      const blockId = rowToggle.dataset.blockId;
      const rowIndex = Number.parseInt(rowToggle.dataset.rowIndex ?? '', 10);
      if (!sectionKey || !blockId || Number.isNaN(rowIndex)) {
        return;
      }
      const section = findSectionByKey(state.document.sections, sectionKey);
      const block = section?.blocks.find((candidate) => candidate.id === blockId);
      const row = block?.schema.tableRows[rowIndex];
      if (!row) {
        return;
      }
      if (!row.clickable) {
        return;
      }
      row.expanded = !row.expanded;
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
    }
  });

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
    warnings.innerHTML = renderWarnings();
  }
  if (nav) {
    nav.innerHTML = renderNavigation(state.document.sections);
  }
  if (reader) {
    reader.innerHTML = renderReaderSections(state.document.sections);
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
  const modalPreview = app.querySelector<HTMLDivElement>('#modalPreview');
  if (modalTitle) {
    modalTitle.innerHTML = `Modal Context: ${escapeHtml(section.title)} <code>#${escapeHtml(getSectionId(section))}</code>`;
  }
  if (modalPreview) {
    modalPreview.innerHTML = renderReaderSection(section);
  }
}

function findBlockByIds(sectionKey: string, blockId: string): VisualBlock | null {
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
    const nestedExpandableStub = findBlockInList(block.schema.expandableStubBlocks ?? [], blockId);
    if (nestedExpandableStub) {
      return nestedExpandableStub;
    }
    const nestedExpandableContent = findBlockInList(block.schema.expandableContentBlocks ?? [], blockId);
    if (nestedExpandableContent) {
      return nestedExpandableContent;
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

function findTableRow(sectionKey: string, parentBlockId: string, rowIndex: number): TableRow | null {
  const section = findSectionByKey(state.document.sections, sectionKey);
  const block = section?.blocks.find((candidate) => candidate.id === parentBlockId);
  const row = block?.schema.tableRows[rowIndex];
  if (!row) {
    return null;
  }
  if (!Array.isArray(row.detailsBlocks) || row.detailsBlocks.length === 0) {
    row.detailsBlocks = [createEmptyBlock('container')];
  }
  row.detailsComponent = 'container';
  return row;
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
    refreshReaderPanels();
    return true;
  }

  if (field === 'block-component' && target instanceof HTMLSelectElement) {
    block.schema.component = target.value;
    applyComponentDefaults(block.schema, target.value);
    refreshReaderPanels();
    renderApp();
    return true;
  }

  if (field === 'block-plugin-url' && target instanceof HTMLInputElement) {
    block.schema.pluginUrl = target.value;
    refreshReaderPanels();
    return true;
  }

  if (field === 'block-container-title' && target instanceof HTMLInputElement) {
    block.schema.containerTitle = target.value;
    refreshReaderPanels();
    return true;
  }

  if (field === 'block-grid-columns' && target instanceof HTMLInputElement) {
    block.schema.gridColumns = coerceGridColumns(target.value);
    ensureGridItems(block.schema);
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
    item.component = target.value;
    refreshReaderPanels();
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
    item.content = normalizeMarkdownLists(turndown.turndown(target.innerHTML));
    refreshReaderPanels();
    return true;
  }

  if (field === 'block-code-language' && target instanceof HTMLInputElement) {
    block.schema.codeLanguage = target.value;
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
      refreshReaderPanels();
    }
    return true;
  }

  if (field === 'table-details-title') {
    const rowIndex = Number.parseInt(target.dataset.rowIndex ?? '', 10);
    const row = block.schema.tableRows[rowIndex];
    if (row) {
      row.detailsTitle = target instanceof HTMLInputElement ? target.value : getInlineEditableText(target);
      refreshReaderPanels();
    }
    return true;
  }

  if (field === 'table-clickable' && target instanceof HTMLInputElement) {
    const rowIndex = Number.parseInt(target.dataset.rowIndex ?? '', 10);
    const row = block.schema.tableRows[rowIndex];
    if (row) {
      row.clickable = target.checked;
      refreshReaderPanels();
    }
    return true;
  }

  if (field === 'block-align' && target instanceof HTMLSelectElement) {
    block.schema.align = coerceAlign(target.value);
    refreshReaderPanels();
    return true;
  }

  if (field === 'block-slot' && target instanceof HTMLSelectElement) {
    block.schema.slot = coerceSlot(target.value);
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
    renderRichToolbar,
    renderEditorBlock,
    renderReaderBlock,
    renderComponentFragment,
    renderComponentOptions,
    renderOption,
    getTableColumns,
    ensureContainerBlocks,
    getSelectedAddComponent: (key: string, fallback: string) => state.addComponentBySection[key] ?? fallback,
  };
}

function renderSectionEditorTree(sections: VisualSection[]): string {
  const sectionCards = sections.map((section) => renderEditorSection(section)).join('');
  const flatSections = flattenSections(sections);
  return `
    ${renderTemplateGhosts(getTemplateFields(state.document.meta), flatSections, { escapeAttr, escapeHtml })}
    ${sectionCards}
    <article class="ghost-section-card add-ghost" data-action="add-top-level-section" data-section-key="__top_level__">
      <div class="ghost-plus-big"><span>+</span></div>
      <div class="ghost-label">Add Section</div>
      <label class="ghost-component-picker">
        <span>Starting Component</span>
        <select data-field="new-component-type" data-section-key="__top_level__">
          ${renderComponentOptions(state.addComponentBySection.__top_level__ ?? 'container')}
        </select>
      </label>
    </article>
  `;
}

function renderEditorSection(section: VisualSection): string {
  return `
    <article class="editor-section-card" data-editor-section="${escapeAttr(section.key)}">
      <div class="editor-section-head">
        <div class="section-drag-title" draggable="true" data-drag-handle="section" data-section-key="${escapeAttr(section.key)}" title="Drag to reorder section">
          <strong>${escapeHtml(section.title || `Section L${section.level}`)}</strong>
          <span>Section L${section.level}</span>
        </div>
        <div class="editor-actions">
          <button type="button" class="ghost" data-action="jump-to-reader" data-section-key="${escapeAttr(section.key)}">Jump</button>
          <button type="button" class="ghost" data-action="focus-modal" data-section-key="${escapeAttr(section.key)}">Modal Context</button>
          <button type="button" class="danger" data-action="remove-section" data-section-key="${escapeAttr(section.key)}">Remove</button>
        </div>
      </div>

      <div class="editor-grid">
        <label>
          <span>Title</span>
          <input data-section-key="${escapeAttr(section.key)}" data-field="section-title" value="${escapeAttr(section.title)}" />
        </label>
        <label>
          <span>Custom ID</span>
          <label><input type="checkbox" data-action="toggle-id-editor" data-section-key="${escapeAttr(section.key)}" ${
    section.idEditorOpen ? 'checked' : ''
  } /> Enable custom ID</label>
        </label>
      </div>

      <div class="editor-row">
        <label><input type="checkbox" data-section-key="${escapeAttr(section.key)}" data-field="section-expanded" ${
    section.expanded ? 'checked' : ''
  } /> Expanded</label>
        <label><input type="checkbox" data-section-key="${escapeAttr(section.key)}" data-field="section-highlight" ${
    section.highlight ? 'checked' : ''
  } /> Highlight</label>
      </div>

      ${
        section.idEditorOpen
          ? `<label class="id-override">
              <span>ID Override (optional, blank keeps random ID)</span>
              <input data-section-key="${escapeAttr(section.key)}" data-field="section-custom-id" value="${escapeAttr(
              section.customId
            )}" placeholder="" />
            </label>`
          : ''
      }

      <div class="editor-blocks">
        ${section.blocks.map((block) => renderEditorBlock(section.key, block)).join('')}
        <article class="ghost-section-card add-ghost" data-action="add-block" data-section-key="${escapeAttr(section.key)}">
          <div class="ghost-plus-big"><span>+</span></div>
          <div class="ghost-label">Add Component</div>
          <label class="ghost-component-picker">
            <span>Component</span>
            <select data-field="new-component-type" data-section-key="${escapeAttr(section.key)}">
              ${renderComponentOptions(state.addComponentBySection[section.key] ?? 'container')}
            </select>
          </label>
        </article>
      </div>

      <div class="editor-children">
        ${section.children.map((child) => renderEditorSection(child)).join('')}
        <button type="button" class="ghost subsection-add-button" data-action="add-subsection" data-section-key="${escapeAttr(section.key)}">+ Add Subsection</button>
      </div>
    </article>
  `;
}

function renderEditorBlock(sectionKey: string, block: VisualBlock): string {
  const component = block.schema.component || 'text';
  const contentEditor = renderBlockContentEditor(sectionKey, block);
  const schemaEditor = renderBlockSchemaEditor(sectionKey, block);

  return `
    <div class="editor-block">
      <div class="editor-block-head">
        <strong class="editor-block-title">${escapeHtml(component)}</strong>
        <div class="editor-actions">
          <button type="button" class="ghost" data-action="open-component-meta" data-section-key="${escapeAttr(
            sectionKey
          )}" data-block-id="${escapeAttr(block.id)}">Meta</button>
          <button type="button" class="ghost" data-action="toggle-schema" data-section-key="${escapeAttr(
            sectionKey
          )}" data-block-id="${escapeAttr(block.id)}">${block.schemaMode ? 'Content Mode' : 'Schema Mode'}</button>
          <button type="button" class="danger remove-x" data-action="remove-block" data-section-key="${escapeAttr(
            sectionKey
          )}" data-block-id="${escapeAttr(block.id)}">×</button>
        </div>
      </div>

      ${block.schemaMode ? schemaEditor : contentEditor}
    </div>
  `;
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

function renderRichToolbar(
  sectionKey: string,
  blockId: string,
  options?: {
    field?: string;
    gridItemId?: string;
    rowIndex?: number;
    includeAlign?: boolean;
    align?: Align;
  }
): string {
  const fieldAttr = options?.field ? ` data-rich-field="${escapeAttr(options.field)}"` : '';
  const gridAttr = options?.gridItemId ? ` data-grid-item-id="${escapeAttr(options.gridItemId)}"` : '';
  const rowAttr = typeof options?.rowIndex === 'number' ? ` data-row-index="${options.rowIndex}"` : '';
  const alignControls =
    options?.includeAlign && options.align
      ? `<div class="toolbar-segment align-buttons" role="group" aria-label="Text alignment">
          <button type="button" class="${options.align === 'left' ? 'secondary' : 'ghost'}" data-action="set-block-align" data-align-value="left" data-section-key="${escapeAttr(
            sectionKey
          )}" data-block-id="${escapeAttr(blockId)}">Left</button>
          <button type="button" class="${options.align === 'center' ? 'secondary' : 'ghost'}" data-action="set-block-align" data-align-value="center" data-section-key="${escapeAttr(
            sectionKey
          )}" data-block-id="${escapeAttr(blockId)}">Center</button>
          <button type="button" class="${options.align === 'right' ? 'secondary' : 'ghost'}" data-action="set-block-align" data-align-value="right" data-section-key="${escapeAttr(
            sectionKey
          )}" data-block-id="${escapeAttr(blockId)}">Right</button>
        </div>`
      : '';
  return `
    <div class="rich-toolbar">
      ${alignControls}
      <div class="toolbar-segment format-buttons" role="group" aria-label="Text formatting">
        <button type="button" data-rich-action="paragraph"${fieldAttr}${gridAttr}${rowAttr} data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(blockId)}" title="Normal text">Text</button>
        <button type="button" data-rich-action="heading-1"${fieldAttr}${gridAttr}${rowAttr} data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(blockId)}" title="Heading 1">H1</button>
        <button type="button" data-rich-action="heading-2"${fieldAttr}${gridAttr}${rowAttr} data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(blockId)}" title="Heading 2">H2</button>
        <button type="button" data-rich-action="heading-3"${fieldAttr}${gridAttr}${rowAttr} data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(blockId)}" title="Heading 3">H3</button>
        <button type="button" data-rich-action="heading-4"${fieldAttr}${gridAttr}${rowAttr} data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(blockId)}" title="Heading 4">H4</button>
        <button type="button" data-rich-action="bold"${fieldAttr}${gridAttr}${rowAttr} data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(blockId)}" title="Bold (Ctrl/Cmd+B)"><strong>B</strong></button>
        <button type="button" data-rich-action="italic"${fieldAttr}${gridAttr}${rowAttr} data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(blockId)}" title="Italic (Ctrl/Cmd+I)">Italic</button>
        <button type="button" data-rich-action="list"${fieldAttr}${gridAttr}${rowAttr} data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(blockId)}" title="Bullet List">List</button>
        <button type="button" data-rich-action="link"${fieldAttr}${gridAttr}${rowAttr} data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(blockId)}" title="Link (Ctrl/Cmd+K)">Link</button>
      </div>
    </div>
  `;
}

function renderMetaPanel(): string {
  const defs = getComponentDefs();
  const theme = getThemeConfig();
  return `
    <section class="meta-panel">
      <div class="meta-panel-head">
        <strong>Document Meta</strong>
      </div>
      <label>
        <span>Title</span>
        <input data-field="meta-title" value="${escapeAttr(String(state.document.meta.title ?? ''))}" />
      </label>
      <div class="editor-grid">
        <label>
          <span>Theme Mode</span>
          <select data-field="theme-mode">
            ${renderOption('light', theme.mode)}
            ${renderOption('dark', theme.mode)}
          </select>
        </label>
        <label>
          <span>Theme Accent</span>
          <input data-field="theme-accent" value="${escapeAttr(theme.accent)}" />
        </label>
      </div>
      <div class="editor-grid">
        <label>
          <span>Theme Background</span>
          <input data-field="theme-background" value="${escapeAttr(theme.background)}" />
        </label>
        <label>
          <span>Theme Surface</span>
          <input data-field="theme-surface" value="${escapeAttr(theme.surface)}" />
        </label>
      </div>
      <label>
        <span>Theme Text</span>
        <input data-field="theme-text" value="${escapeAttr(theme.text)}" />
      </label>
      <div class="meta-panel-head">
        <strong>Component Definitions</strong>
        <button type="button" class="ghost" data-action="add-component-def">Add Component</button>
      </div>
      <div class="component-defs">
        ${defs
          .map(
            (def, index) => `<article class="component-def">
              <label>
                <span>Name</span>
                <input data-field="def-name" data-def-index="${index}" value="${escapeAttr(def.name)}" />
              </label>
              <label>
                <span>Base Type</span>
                <select data-field="def-base" data-def-index="${index}">
                  ${renderOption('text', def.baseType)}
                  ${renderOption('quote', def.baseType)}
                  ${renderOption('code', def.baseType)}
                  ${renderOption('expandable', def.baseType)}
                  ${renderOption('table', def.baseType)}
                  ${renderOption('container', def.baseType)}
                  ${renderOption('grid', def.baseType)}
                  ${renderOption('plugin', def.baseType)}
                </select>
              </label>
              <label>
                <span>Default Tags</span>
                ${renderTagEditor(
                  'def-tags',
                  def.tags ?? '',
                  {
                    defIndex: index,
                    placeholder: 'Add a default tag',
                  },
                  { escapeAttr, escapeHtml }
                )}
              </label>
              <label>
                <span>Description</span>
                <textarea rows="3" data-field="def-description" data-def-index="${index}">${escapeHtml(def.description ?? '')}</textarea>
              </label>
              <button type="button" class="danger" data-action="remove-component-def" data-def-index="${index}">Remove</button>
            </article>`
          )
          .join('')}
      </div>
    </section>
  `;
}

function renderBlockContentEditor(sectionKey: string, block: VisualBlock): string {
  const component = resolveBaseComponent(block.schema.component);
  const helpers = getComponentRenderHelpers();

  if (component === 'code') {
    return renderCodeEditor(sectionKey, block, helpers);
  }
  if (component === 'plugin') {
    return renderPluginEditor(sectionKey, block, helpers);
  }
  if (component === 'container') {
    return renderContainerEditor(sectionKey, block, helpers);
  }
  if (component === 'grid') {
    ensureGridItems(block.schema);
    return renderGridEditor(sectionKey, block, helpers);
  }
  if (component === 'expandable') {
    ensureExpandableBlocks(block);
    return renderExpandableEditor(sectionKey, block, helpers);
  }
  if (component === 'table') {
    return renderTableEditor(sectionKey, block, helpers);
  }
  return renderTextEditor(sectionKey, block, helpers);
}

function renderBlockSchemaEditor(sectionKey: string, block: VisualBlock): string {
  const draftName =
    state.schemaDefDraftByBlock[block.id] ??
    (isBuiltinComponent(block.schema.component) ? '' : block.schema.component);
  return `
    <div class="schema-editor">
      <section class="schema-save-card">
        <strong>Reusable Component</strong>
        <label>
          <span>Name</span>
          <input
            data-field="schema-def-name"
            data-block-id="${escapeAttr(block.id)}"
            value="${escapeAttr(draftName)}"
            placeholder="Callout, Hero, Spec Table..."
          />
        </label>
        <button
          type="button"
          class="secondary"
          data-action="save-component-def"
          data-section-key="${escapeAttr(sectionKey)}"
          data-block-id="${escapeAttr(block.id)}"
        >Save To Dropdown</button>
        <div class="muted">Saves this base type with its default tags and description as a reusable component.</div>
      </section>
      <div class="editor-grid schema-grid">
        <article class="ghost-section-card add-ghost" data-action="focus-schema-component" data-section-key="${escapeAttr(
          sectionKey
        )}" data-block-id="${escapeAttr(block.id)}">
          <div class="ghost-plus-big"><span>+</span></div>
          <div class="ghost-label">Component: ${escapeHtml(block.schema.component)}</div>
          <label class="ghost-component-picker">
            <span>Component</span>
            <select data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(block.id)}" data-field="block-component">
              ${renderComponentOptions(block.schema.component)}
            </select>
          </label>
        </article>
      </div>
      ${renderBlockMetaFields(sectionKey, block)}
      <div class="schema-content-shell">
        ${renderBlockContentEditor(sectionKey, block)}
      </div>
    </div>
  `;
}

function renderBlockMetaFields(sectionKey: string, block: VisualBlock): string {
  return `
    <div class="schema-meta-stack">
      <label>
        <span>Tags</span>
        ${renderTagEditor(
          'block-tags',
          block.schema.tags,
          {
            sectionKey,
            blockId: block.id,
            placeholder: 'Add a tag',
          },
          { escapeAttr, escapeHtml }
        )}
      </label>
      <label>
        <span>Description</span>
        <textarea
          rows="3"
          data-section-key="${escapeAttr(sectionKey)}"
          data-block-id="${escapeAttr(block.id)}"
          data-field="block-description"
        >${escapeHtml(block.schema.description)}</textarea>
      </label>
    </div>
  `;
}

function renderTableDetailsBlocksEditor(sectionKey: string, _parentBlockId: string, _rowIndex: number, row: TableRow): string {
  return renderTableDetailsEditor(sectionKey, row, getComponentRenderHelpers());
}

function renderNavigation(sections: VisualSection[]): string {
  const items = flattenSections(sections).filter((section) => !section.isGhost);
  if (items.length === 0) {
    return '<div class="muted">Navigation will appear when sections exist.</div>';
  }

  return `
    <div class="nav-title">Navigation</div>
    <div class="nav-list">
      ${items
        .map(
          (section) =>
            `<button type="button" class="nav-item" data-nav-id="${escapeAttr(getSectionId(section))}">${escapeHtml(
              section.title
            )} <code>#${escapeHtml(getSectionId(section))}</code></button>`
        )
        .join('')}
    </div>
  `;
}

function renderReaderSections(sections: VisualSection[]): string {
  const realSections = sections.filter((section) => !section.isGhost);
  if (realSections.length === 0) {
    return '<div class="muted">No content to display yet.</div>';
  }
  return realSections.map((section) => renderReaderSection(section)).join('');
}

function renderReaderSection(section: VisualSection): string {
  const effectiveId = getSectionId(section);
  const temp = state.tempHighlights.has(effectiveId);
  const classList = ['reader-section', section.highlight ? 'is-highlighted' : '', temp ? 'is-temp-highlighted' : '']
    .filter(Boolean)
    .join(' ');

  const content = section.expanded
    ? `<div class="reader-section-content">${section.blocks
        .map((block) => renderReaderBlock(section, block))
        .join('')}${section.children.filter((child) => !child.isGhost).map((child) => renderReaderSection(child)).join('')}</div>`
    : '';

  return `
    <section id="${escapeAttr(effectiveId)}" class="${classList}" style="${escapeAttr(section.customCss)}">
      <header class="reader-section-head">
        <h${Math.min(Math.max(section.level, 1), 6)}>${escapeHtml(section.title)}</h${Math.min(Math.max(section.level, 1), 6)}>
        <div class="reader-head-actions">
          <button type="button" class="tiny" data-reader-action="toggle-expand" data-section-key="${escapeAttr(section.key)}">${
    section.expanded ? '−' : '+'
  }</button>
        </div>
      </header>
      ${content}
    </section>
  `;
}

function renderReaderBlock(section: VisualSection, block: VisualBlock): string {
  const base = resolveBaseComponent(block.schema.component);
  const blockAttrs = `class="reader-block reader-block-${escapeAttr(base)} align-${escapeAttr(block.schema.align)} slot-${escapeAttr(
    block.schema.slot
  )}" data-component="${escapeAttr(block.schema.component)}"`;
  const helpers = getComponentRenderHelpers();

  if (base === 'code') {
    return `<div ${blockAttrs}>${renderCodeReader(section, block, helpers)}</div>`;
  }
  if (base === 'plugin') {
    return `<div ${blockAttrs}>${renderPluginReader(section, block, helpers)}</div>`;
  }
  if (base === 'container') {
    return `<div ${blockAttrs}>${renderContainerReader(section, block, helpers)}</div>`;
  }
  if (base === 'grid') {
    ensureGridItems(block.schema);
    return `<div ${blockAttrs}>${renderGridReader(section, block, helpers)}</div>`;
  }
  if (base === 'expandable') {
    ensureExpandableBlocks(block);
    return `<div ${blockAttrs}>${renderExpandableReader(section, block, helpers)}</div>`;
  }
  if (base === 'table') {
    return `<div ${blockAttrs}>${renderTableReader(section, block, helpers)}</div>`;
  }
  return `<div ${blockAttrs}>${renderTextReader(section, block, helpers)}</div>`;
}

function renderComponentFragment(componentName: string, content: string, block: VisualBlock): string {
  const base = resolveBaseComponent(componentName);
  const normalized = normalizeMarkdownLists(content);
  if (base === 'quote') {
    return `<blockquote>${DOMPurify.sanitize(marked.parse(normalized) as string)}</blockquote>`;
  }
  if (base === 'code') {
    return `<pre><code class="language-${escapeAttr(block.schema.codeLanguage || 'txt')}">${escapeHtml(content)}</code></pre>`;
  }
  return DOMPurify.sanitize(marked.parse(normalized) as string);
}

function renderModal(): string {
  if (state.componentMetaModal) {
    const block = findBlockByIds(state.componentMetaModal.sectionKey, state.componentMetaModal.blockId);
    if (!block) {
      return '';
    }
    return `
      <div id="modalRoot" class="modal-root">
        <div class="modal-overlay" data-modal-action="close-overlay"></div>
        <section class="modal-panel component-meta-modal">
          <div class="modal-head">
            <h3>Component Meta</h3>
            <button type="button" data-modal-action="close">Close</button>
          </div>
          <p class="muted">Meta is optional and can be used by readers, indexing, and plugins.</p>
          ${renderBlockMetaFields(state.componentMetaModal.sectionKey, block)}
        </section>
      </div>
    `;
  }

  if (state.tableDetailsModal) {
    const block = findBlockByIds(state.tableDetailsModal.sectionKey, state.tableDetailsModal.blockId);
    const row = block?.schema.tableRows[state.tableDetailsModal.rowIndex];
    if (!block || !row) {
      return '';
    }
    return `
      <div id="modalRoot" class="modal-root">
        <div class="modal-overlay" data-modal-action="close-overlay"></div>
        <section class="modal-panel">
          <div class="modal-head">
            <h3>Row Details Container</h3>
            <button type="button" data-modal-action="close">Close</button>
          </div>
          <p class="muted">This row opens a standard container. Edit the title and body inline here.</p>
          <label>
            <span>Container Title</span>
            <input data-section-key="${escapeAttr(state.tableDetailsModal.sectionKey)}" data-block-id="${escapeAttr(
      state.tableDetailsModal.blockId
    )}" data-row-index="${state.tableDetailsModal.rowIndex}" data-field="table-details-title" value="${escapeAttr(row.detailsTitle)}" />
          </label>
          ${renderTableDetailsBlocksEditor(
            state.tableDetailsModal.sectionKey,
            state.tableDetailsModal.blockId,
            state.tableDetailsModal.rowIndex,
            row
          )}
        </section>
      </div>
    `;
  }

  if (!state.modalSectionKey) {
    return '';
  }

  const section = findSectionByKey(state.document.sections, state.modalSectionKey);
  if (!section) {
    return '';
  }

  return `
    <div id="modalRoot" class="modal-root">
      <div class="modal-overlay" data-modal-action="close-overlay"></div>
      <section class="modal-panel">
        <div class="modal-head">
          <h3 id="modalTitle">Modal Context: ${escapeHtml(section.title)} <code>#${escapeHtml(getSectionId(section))}</code></h3>
          <button type="button" data-modal-action="close">Close</button>
        </div>
        <p>Edit section-level CSS and review the section in focus.</p>
        <label>
          <span>Custom CSS (inline style value)</span>
          <textarea id="modalCssInput">${escapeHtml(section.customCss)}</textarea>
        </label>
        <div id="modalPreview" class="modal-preview">
          ${renderReaderSection(section)}
        </div>
      </section>
    </div>
  `;
}

function renderLinkInlineModal(): string {
  const ids = flattenSections(state.document.sections)
    .filter((section) => !section.isGhost)
    .map((section) => `#${getSectionId(section)}`);
  return `
    <div id="linkInlineModal" class="link-inline-modal" aria-hidden="true">
      <div class="link-inline-overlay" data-link-modal-action="cancel"></div>
      <section class="link-inline-panel">
        <h4>Insert Link</h4>
        <label>
          <span>URL or #ID</span>
          <input id="linkInlineInput" list="linkInlineIds" placeholder="https://... or #section-id" />
          <datalist id="linkInlineIds">
            ${ids.map((id) => `<option value="${escapeAttr(id)}"></option>`).join('')}
          </datalist>
        </label>
        <div class="link-inline-actions">
          <button type="button" class="ghost" data-link-modal-action="cancel">Cancel</button>
          <button type="button" class="secondary" data-link-modal-action="apply">Apply</button>
        </div>
      </section>
    </div>
  `;
}

function renderWarnings(): string {
  const duplicateIds = findDuplicateSectionIds(state.document.sections);
  if (duplicateIds.length === 0) {
    return '<div class="ok">No warnings. IDs are unique.</div>';
  }
  return duplicateIds
    .map((id) => `<div class="warn">Duplicate section id detected: <code>${escapeHtml(id)}</code></div>`)
    .join('');
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
    expanded: section.expanded,
    highlight: section.highlight,
  };
  if (section.customCss.trim().length > 0) {
    meta.custom_css = section.customCss;
  }

  meta.blocks = section.blocks.map((block) => ({
    component: block.schema.component,
    align: block.schema.align,
    slot: block.schema.slot,
    codeLanguage: block.schema.codeLanguage,
    containerTitle: block.schema.containerTitle,
    containerBlocks: block.schema.containerBlocks,
    gridColumns: block.schema.gridColumns,
    gridItems: block.schema.gridItems,
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
  state.tableDetailsModal = null;
}

function closeModalIfTarget(sectionKey: string): void {
  if (state.modalSectionKey === sectionKey) {
    closeModal();
  }
  if (state.componentMetaModal?.sectionKey === sectionKey) {
    state.componentMetaModal = null;
  }
  if (state.tableDetailsModal?.sectionKey === sectionKey) {
    state.tableDetailsModal = null;
  }
}

function createDefaultDocument(): VisualDocument {
  const textBlock = createEmptyBlock('text', true);
  textBlock.text = 'This is a **visual HVY editor**. What you see in the editor is the primary authoring experience.';

  const quoteBlock = createEmptyBlock('quote', true);
  quoteBlock.text = 'Design the format like a document, not a form.';

  const codeBlock = createEmptyBlock('code', true);
  codeBlock.schema.codeLanguage = 'ts';
  codeBlock.text = "export const demo = 'HVY';";

  const expandableBlock = createEmptyBlock('expandable', true);
  expandableBlock.schema.expandableStubBlocks = [createEmptyBlock('table', true)];
  expandableBlock.schema.expandableContentBlocks = [createEmptyBlock('container', true)];
  expandableBlock.schema.expandableContentBlocks[0]!.schema.containerTitle = 'Expanded Container';

  const tableBlock = createEmptyBlock('table', true);
  tableBlock.schema.tableColumns = 'Feature, Status';
  tableBlock.schema.tableRows = [
    {
      cells: ['Inline editing', 'Ready'],
      expanded: false,
      clickable: true,
      detailsTitle: 'Inline editing details',
      detailsContent: 'Headers, cells, and row details are all editable directly in the proof of concept.',
      detailsComponent: 'container',
      detailsBlocks: [
        (() => {
          const block = createEmptyBlock('container', true);
          block.schema.containerTitle = 'Details Container';
          return block;
        })(),
      ],
    },
  ];

  const containerBlock = createEmptyBlock('container', true);
  containerBlock.schema.containerTitle = 'Container';
  containerBlock.text = 'Containers are good defaults for subsections and grouped notes.';

  const gridBlock = createEmptyBlock('grid', true);
  gridBlock.schema.gridItems = [
    { id: makeId('griditem'), component: 'text', content: 'Grid item A', column: 'left' },
    { id: makeId('griditem'), component: 'text', content: 'Grid item B', column: 'right' },
  ];

  const pluginBlock = createEmptyBlock('plugin', true);
  pluginBlock.schema.pluginUrl = 'https://example.com/plugin';

  return {
    extension: '.hvy',
    meta: {
      hvy_version: 0.1,
      title: 'Reference Implementation Demo',
    },
    sections: [
      {
        key: makeId('section'),
        customId: 'welcome',
        idEditorOpen: false,
        isGhost: false,
        title: 'Welcome',
        level: 1,
        expanded: true,
        highlight: false,
        customCss: '',
        blocks: [textBlock, quoteBlock, codeBlock, expandableBlock, tableBlock, containerBlock, gridBlock, pluginBlock],
        children: [
          {
            key: makeId('section'),
            customId: 'try-it',
            idEditorOpen: false,
            isGhost: false,
            title: 'Container Subsection',
            level: 2,
            expanded: true,
            highlight: true,
            customCss: '',
            blocks: [
              (() => {
                const subsectionBlock = createEmptyBlock('container', true);
                subsectionBlock.schema.containerTitle = 'Nested Container';
                subsectionBlock.text = 'Subsections now start as plain container sections.';
                return subsectionBlock;
              })(),
            ],
            children: [],
          },
        ],
      },
    ],
  };
}

function createEmptySection(level: number, component = 'container', isGhost = false): VisualSection {
  return {
    key: makeId('section'),
    customId: '',
    idEditorOpen: false,
    isGhost,
    title: isGhost ? 'New Component' : 'New Section',
    level,
    expanded: true,
    highlight: false,
    customCss: '',
    blocks: component ? [createEmptyBlock(component)] : [],
    children: [],
  };
}

function createEmptyBlock(component = 'text', skipComponentDefaults = false): VisualBlock {
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
    align: 'left',
    slot: 'center',
    codeLanguage: 'ts',
    containerTitle: 'Container',
    containerBlocks: [],
    gridColumns: 2,
    gridItems: [createGridItem(0, 2), createGridItem(1, 2)],
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
  const rows = Array.isArray(candidate.tableRows) ? candidate.tableRows : [];
  const gridColumns = coerceGridColumns(candidate.gridColumns ?? candidate.gridTemplateColumns);
  const parsedGridItems = parseGridItems(candidate, gridColumns);
  return {
    component: typeof candidate.component === 'string' ? candidate.component : 'text',
    align: coerceAlign(typeof candidate.align === 'string' ? candidate.align : 'left'),
    slot: coerceSlot(typeof candidate.slot === 'string' ? candidate.slot : 'center'),
    codeLanguage: typeof candidate.codeLanguage === 'string' ? candidate.codeLanguage : 'ts',
    containerTitle: typeof candidate.containerTitle === 'string' ? candidate.containerTitle : 'Container',
    containerBlocks: Array.isArray(candidate.containerBlocks)
      ? candidate.containerBlocks.map((block) => parseVisualBlock(block))
      : [],
    gridColumns,
    gridItems: parsedGridItems,
    tags: typeof candidate.tags === 'string' ? candidate.tags : '',
    description: typeof candidate.description === 'string' ? candidate.description : '',
    metaOpen: candidate.metaOpen === true,
    pluginUrl: typeof candidate.pluginUrl === 'string' ? candidate.pluginUrl : '',
    expandableStubComponent:
      typeof candidate.expandableStubComponent === 'string' ? candidate.expandableStubComponent : 'container',
    expandableContentComponent:
      typeof candidate.expandableContentComponent === 'string' ? candidate.expandableContentComponent : 'container',
    expandableStub: typeof candidate.expandableStub === 'string' ? candidate.expandableStub : '',
    expandableStubBlocks: Array.isArray(candidate.expandableStubBlocks)
      ? candidate.expandableStubBlocks.map((block) => parseVisualBlock(block))
      : [],
    expandableAlwaysShowStub: candidate.expandableAlwaysShowStub !== false,
    expandableExpanded: candidate.expandableExpanded === true,
    expandableContentBlocks: Array.isArray(candidate.expandableContentBlocks)
      ? candidate.expandableContentBlocks.map((block) => parseVisualBlock(block))
      : [],
    tableColumns: typeof candidate.tableColumns === 'string' ? candidate.tableColumns : 'Column 1, Column 2',
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
  return { id: makeId('griditem'), component: 'text', content: '', column };
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
        component: typeof item.component === 'string' ? item.component : 'text',
        content: typeof item.content === 'string' ? item.content : '',
        column: coerceGridColumn(item.column, columns),
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
        component: typeof item.component === 'string' ? item.component : 'text',
        content: typeof item.content === 'string' ? item.content : '',
        column: coerceGridColumn(index % 2 === 0 ? 'left' : 'right', columns),
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
      component: 'text',
      content: typeof legacyValues[key] === 'string' ? (legacyValues[key] as string) : '',
      column: coerceGridColumn(index % 2 === 0 ? 'left' : 'right', columns),
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
    component: item.component || 'text',
    content: item.content ?? '',
    column: coerceGridColumn(item.column, schema.gridColumns),
  }));
}

interface ComponentDefinition {
  name: string;
  baseType: string;
  tags?: string;
  description?: string;
}

function getComponentDefs(): ComponentDefinition[] {
  const defs = state.document.meta.component_defs;
  if (!Array.isArray(defs)) {
    return [];
  }
  return defs.filter((item): item is ComponentDefinition => !!item && typeof item === 'object' && 'name' in item);
}

function getComponentOptions(): string[] {
  const builtins = ['text', 'quote', 'code', 'expandable', 'table', 'container', 'grid', 'plugin'];
  const custom = getComponentDefs()
    .map((def) => def.name.trim())
    .filter((name) => name.length > 0);
  return [...new Set([...builtins, ...custom])];
}

function isBuiltinComponent(componentName: string): boolean {
  return ['text', 'quote', 'code', 'expandable', 'table', 'container', 'grid', 'plugin'].includes(componentName);
}

function renderComponentOptions(selected: string): string {
  return getComponentOptions().map((option) => renderOption(option, selected)).join('');
}

function resolveBaseComponent(componentName: string): string {
  if (['text', 'quote', 'code', 'expandable', 'table', 'container', 'grid', 'plugin'].includes(componentName)) {
    return componentName;
  }
  const def = getComponentDefs().find((item) => item.name === componentName);
  return def?.baseType || 'text';
}

function applyComponentDefaults(schema: BlockSchema, componentName: string): void {
  const def = getComponentDefs().find((item) => item.name === componentName);
  const base = resolveBaseComponent(componentName);
  if (base === 'table' && schema.tableRows.length === 0) {
    schema.tableRows.push(createDefaultTableRow(getTableColumns(schema).length));
  }
  if (base === 'grid') {
    ensureGridItems(schema);
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
