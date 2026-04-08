import './style.css';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import TurndownService from 'turndown';
import { parseHvy } from './hvy/parser';
import { stringify as stringifyYaml } from 'yaml';
import type { HvySection, JsonObject } from './hvy/types';

type Align = 'left' | 'center' | 'right';
type Slot = 'left' | 'center' | 'right';
type GridColumn = 'left' | 'right' | 'full';

interface TableRow {
  cells: string[];
  expanded: boolean;
  clickable: boolean;
  detailsTitle: string;
  detailsContent: string;
}

interface GridItem {
  id: string;
  component: string;
  content: string;
  column: GridColumn;
}

interface BlockSchema {
  component: string;
  align: Align;
  slot: Slot;
  codeLanguage: string;
  containerTitle: string;
  gridColumns: number;
  gridItems: GridItem[];
  tags: string;
  description: string;
  metaOpen: boolean;
  pluginUrl: string;
  expandableStubComponent: string;
  expandableContentComponent: string;
  expandableStub: string;
  expandableAlwaysShowStub: boolean;
  expandableExpanded: boolean;
  tableColumns: string;
  tableRows: TableRow[];
}

interface VisualBlock {
  id: string;
  text: string;
  schema: BlockSchema;
  schemaMode: boolean;
}

interface VisualSection {
  key: string;
  customId: string;
  idEditorOpen: boolean;
  isGhost: boolean;
  title: string;
  level: number;
  expanded: boolean;
  highlight: boolean;
  customCss: string;
  blocks: VisualBlock[];
  children: VisualSection[];
}

interface VisualDocument {
  meta: JsonObject;
  extension: '.hvy' | '.thvy' | '.md';
  sections: VisualSection[];
}

interface AppState {
  document: VisualDocument;
  filename: string;
  modalSectionKey: string | null;
  tempHighlights: Set<string>;
  addComponentBySection: Record<string, string>;
  metaPanelOpen: boolean;
  templateValues: Record<string, string>;
  history: string[];
  future: string[];
  isRestoring: boolean;
  componentMetaModal: { sectionKey: string; blockId: string } | null;
  lastHistoryGroup: string | null;
  lastHistoryAt: number;
  pendingEditorCenterSectionKey: string | null;
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

const state: AppState = {
  document: createDefaultDocument(),
  filename: 'document.hvy',
  modalSectionKey: null,
  tempHighlights: new Set<string>(),
  addComponentBySection: {},
  metaPanelOpen: false,
  templateValues: {},
  history: [],
  future: [],
  isRestoring: false,
  componentMetaModal: null,
  lastHistoryGroup: null,
  lastHistoryAt: 0,
  pendingEditorCenterSectionKey: null,
};
let shortcutsBound = false;
const HISTORY_GROUP_WINDOW_MS = 1200;

renderApp();

function renderApp(): void {
  applyTheme();
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

      <section class="panes">
        <div class="pane editor-pane">
          <div class="pane-title-row">
            <h2>Visual Editor</h2>
            <div class="pane-controls">
              <button id="toggleMetaBtn" type="button" class="ghost">${state.metaPanelOpen ? 'Hide Meta' : 'Show Meta'}</button>
            </div>
          </div>
          ${renderTemplatePanel()}
          ${state.metaPanelOpen ? renderMetaPanel() : ''}
          ${renderStateTracker()}
          <div id="editorTree" class="editor-tree">${renderSectionEditorTree(state.document.sections)}</div>
        </div>

        <div class="pane reader-pane">
          <h2>Reader</h2>
          <div id="readerWarnings" class="reader-warnings">${renderWarnings()}</div>
          <div id="readerNav" class="reader-nav">${renderNavigation(state.document.sections)}</div>
          <div id="readerDocument" class="reader-document">${renderReaderSections(state.document.sections)}</div>
        </div>
      </section>

      ${renderModal()}
    </main>
  `;

  commitHistorySnapshot();
  bindUi();
  centerPendingEditorSection();
}

function renderAppPreserveEditorScroll(): void {
  const editorPane = app.querySelector<HTMLDivElement>('.editor-pane');
  const scrollTop = editorPane?.scrollTop ?? 0;
  renderApp();
  const nextEditorPane = app.querySelector<HTMLDivElement>('.editor-pane');
  if (nextEditorPane) {
    nextEditorPane.scrollTop = scrollTop;
  }
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
  const editorTree = app.querySelector<HTMLDivElement>('#editorTree');
  const readerDocument = app.querySelector<HTMLDivElement>('#readerDocument');
  const readerNav = app.querySelector<HTMLDivElement>('#readerNav');

  if (!fileInput || !downloadBtn || !downloadName || !toggleMetaBtn || !editorTree || !readerDocument || !readerNav) {
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

  toggleMetaBtn.addEventListener('click', () => {
    state.metaPanelOpen = !state.metaPanelOpen;
    renderApp();
  });

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

    if (field === 'def-description' && target instanceof HTMLInputElement) {
      const idx = Number.parseInt(target.dataset.defIndex ?? '', 10);
      const defs = getComponentDefs();
      if (!Number.isNaN(idx) && defs[idx]) {
        recordHistory(`def:${idx}:description`);
        defs[idx].description = target.value;
        state.document.meta.component_defs = defs;
      }
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

  editorTree.addEventListener('click', (event) => {
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
          ? editorTree.querySelector<HTMLElement>(`${selectorBase}[data-row-index="${rowIndex}"]`)
          : gridItemId
          ? editorTree.querySelector<HTMLElement>(`${selectorBase}[data-grid-item-id="${gridItemId}"]`)
          : editorTree.querySelector<HTMLElement>(selectorBase);
        if (editable) {
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

    if (action === 'spawn-root-ghost') {
      recordHistory();
      const component = state.addComponentBySection.__root__ ?? 'text';
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
      const component = state.addComponentBySection[section.key] ?? 'text';
      const child = createEmptySection(Math.min(section.level + 1, 6), component, false);
      section.children.push(child);
      state.pendingEditorCenterSectionKey = child.key;
      renderApp();
      return;
    }

    if (action === 'spawn-block-ghost') {
      recordHistory();
      const component = state.addComponentBySection[section.key] ?? 'text';
      const child = createEmptySection(Math.min(section.level + 1, 6), component, false);
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
      const component = state.addComponentBySection[section.key] ?? 'text';
      section.children.push(createEmptySection(Math.min(section.level + 1, 6), component, true));
      renderApp();
      return;
    }

    if (action === 'add-block') {
      recordHistory();
      const component = state.addComponentBySection[section.key] ?? 'text';
      section.blocks.push(createEmptyBlock(component));
      renderApp();
      return;
    }

    if (action === 'toggle-schema' && blockId) {
      recordHistory();
      const block = section.blocks.find((candidate) => candidate.id === blockId);
      if (!block) {
        return;
      }
      block.schemaMode = !block.schemaMode;
      renderApp();
      return;
    }

    if (action === 'remove-block' && blockId) {
      recordHistory();
      section.blocks = section.blocks.filter((candidate) => candidate.id !== blockId);
      if (section.blocks.length === 0) {
        section.blocks.push(createEmptyBlock());
      }
      renderApp();
      return;
    }

    if (action === 'add-table-row' && blockId) {
      recordHistory();
      const block = section.blocks.find((candidate) => candidate.id === blockId);
      if (!block) {
        return;
      }
      const columnCount = Math.max(splitColumns(block.schema.tableColumns).length, 1);
      block.schema.tableRows.push({
        cells: new Array(columnCount).fill(''),
        expanded: false,
        clickable: true,
        detailsTitle: 'Details',
        detailsContent: '',
      });
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
      const block = section.blocks.find((candidate) => candidate.id === blockId);
      if (!block) {
        return;
      }
      ensureGridItems(block.schema);
      block.schema.gridItems.push(createGridItem(block.schema.gridItems.length, block.schema.gridColumns));
      renderApp();
      return;
    }

    if (action === 'remove-grid-item' && blockId) {
      recordHistory();
      const block = section.blocks.find((candidate) => candidate.id === blockId);
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
      if (section.blocks.length === 0) {
        section.blocks.push(createEmptyBlock());
      }
      renderApp();
      return;
    }

    if (action === 'jump-to-reader') {
      navigateToSection(getSectionId(section));
    }
  });

  editorTree.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
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
      applyRichAction('link', target);
    }
  });

  editorTree.addEventListener('input', (event) => {
    const target = event.target as HTMLElement;
    const sectionKey = target.dataset.sectionKey;
    if (!sectionKey) {
      return;
    }

    const field = target.dataset.field;
    if (field === 'new-component-type' && target instanceof HTMLSelectElement) {
      state.addComponentBySection[sectionKey] = target.value;
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

    const blockId = target.dataset.blockId;
    if (!blockId) {
      return;
    }

    const block = section.blocks.find((candidate) => candidate.id === blockId);
    if (!block) {
      return;
    }

    if (field === 'block-rich') {
      block.text = normalizeMarkdownLists(turndown.turndown((target as HTMLElement).innerHTML));
      refreshReaderPanels();
      return;
    }

    if (field === 'block-component' && target instanceof HTMLSelectElement) {
      block.schema.component = target.value;
      applyComponentDefaults(block.schema, target.value);
      refreshReaderPanels();
      renderApp();
      return;
    }

    if (field === 'block-tags' && target instanceof HTMLInputElement) {
      block.schema.tags = target.value;
      refreshReaderPanels();
      return;
    }

    if (field === 'block-description' && target instanceof HTMLInputElement) {
      block.schema.description = target.value;
      refreshReaderPanels();
      return;
    }

    if (field === 'block-meta-open' && target instanceof HTMLInputElement) {
      block.schema.metaOpen = target.checked;
      renderApp();
      return;
    }

    if (field === 'block-plugin-url' && target instanceof HTMLInputElement) {
      block.schema.pluginUrl = target.value;
      refreshReaderPanels();
      return;
    }

    if (field === 'block-container-title' && target instanceof HTMLInputElement) {
      block.schema.containerTitle = target.value;
      refreshReaderPanels();
      return;
    }

    if (field === 'block-grid-columns' && target instanceof HTMLInputElement) {
      block.schema.gridColumns = coerceGridColumns(target.value);
      ensureGridItems(block.schema);
      refreshReaderPanels();
      return;
    }

    if (field === 'block-grid-item-component' && target instanceof HTMLSelectElement) {
      const gridItemId = target.dataset.gridItemId;
      if (!gridItemId) {
        return;
      }
      ensureGridItems(block.schema);
      const item = block.schema.gridItems.find((candidate) => candidate.id === gridItemId);
      if (!item) {
        return;
      }
      item.component = target.value;
      refreshReaderPanels();
      return;
    }

    if (field === 'block-grid-item-column' && target instanceof HTMLSelectElement) {
      const gridItemId = target.dataset.gridItemId;
      if (!gridItemId) {
        return;
      }
      ensureGridItems(block.schema);
      const item = block.schema.gridItems.find((candidate) => candidate.id === gridItemId);
      if (!item) {
        return;
      }
      item.column = coerceGridColumn(target.value, block.schema.gridColumns);
      refreshReaderPanels();
      return;
    }

    if (field === 'block-grid-rich') {
      const gridItemId = target.dataset.gridItemId;
      if (!gridItemId) {
        return;
      }
      ensureGridItems(block.schema);
      const item = block.schema.gridItems.find((candidate) => candidate.id === gridItemId);
      if (!item) {
        return;
      }
      item.content = normalizeMarkdownLists(turndown.turndown((target as HTMLElement).innerHTML));
      refreshReaderPanels();
      return;
    }

    if (field === 'block-code-language' && target instanceof HTMLInputElement) {
      block.schema.codeLanguage = target.value;
      refreshReaderPanels();
      return;
    }

    if (field === 'block-code' && target instanceof HTMLTextAreaElement) {
      block.text = target.value;
      refreshReaderPanels();
      return;
    }

    if (field === 'block-expandable-stub' && target instanceof HTMLInputElement) {
      block.schema.expandableStub = target.value;
      refreshReaderPanels();
      return;
    }

    if (field === 'block-expandable-stub-component' && target instanceof HTMLSelectElement) {
      block.schema.expandableStubComponent = target.value;
      refreshReaderPanels();
      return;
    }

    if (field === 'block-expandable-content-component' && target instanceof HTMLSelectElement) {
      block.schema.expandableContentComponent = target.value;
      refreshReaderPanels();
      return;
    }

    if (field === 'block-expandable-always' && target instanceof HTMLInputElement) {
      block.schema.expandableAlwaysShowStub = target.checked;
      refreshReaderPanels();
      return;
    }

    if (field === 'table-columns' && target instanceof HTMLInputElement) {
      block.schema.tableColumns = target.value;
      refreshReaderPanels();
      return;
    }

    if (field === 'table-cell' && target instanceof HTMLInputElement) {
      const rowIndex = Number.parseInt(target.dataset.rowIndex ?? '', 10);
      const cellIndex = Number.parseInt(target.dataset.cellIndex ?? '', 10);
      const row = block.schema.tableRows[rowIndex];
      if (!row || Number.isNaN(cellIndex)) {
        return;
      }
      row.cells[cellIndex] = target.value;
      refreshReaderPanels();
      return;
    }

    if (field === 'table-details-title' && target instanceof HTMLInputElement) {
      const rowIndex = Number.parseInt(target.dataset.rowIndex ?? '', 10);
      const row = block.schema.tableRows[rowIndex];
      if (!row) {
        return;
      }
      row.detailsTitle = target.value;
      refreshReaderPanels();
      return;
    }

    if (field === 'table-details-rich') {
      const rowIndex = Number.parseInt(target.dataset.rowIndex ?? '', 10);
      const row = block.schema.tableRows[rowIndex];
      if (!row) {
        return;
      }
      row.detailsContent = normalizeMarkdownLists(turndown.turndown((target as HTMLElement).innerHTML));
      refreshReaderPanels();
      return;
    }

    if (field === 'table-clickable' && target instanceof HTMLInputElement) {
      const rowIndex = Number.parseInt(target.dataset.rowIndex ?? '', 10);
      const row = block.schema.tableRows[rowIndex];
      if (!row) {
        return;
      }
      row.clickable = target.checked;
      refreshReaderPanels();
      return;
    }

    if (field === 'block-align' && target instanceof HTMLSelectElement) {
      block.schema.align = coerceAlign(target.value);
      refreshReaderPanels();
      return;
    }

    if (field === 'block-slot' && target instanceof HTMLSelectElement) {
      block.schema.slot = coerceSlot(target.value);
      refreshReaderPanels();
    }
  });

  editorTree.addEventListener('change', (event) => {
    const target = event.target as HTMLElement;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    if (target.dataset.field !== 'table-columns') {
      return;
    }
    renderAppPreserveEditorScroll();
  });

  readerDocument.addEventListener('click', (event) => {
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

  readerNav.addEventListener('click', (event) => {
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
  return section.blocks.find((candidate) => candidate.id === blockId) ?? null;
}

function renderSectionEditorTree(sections: VisualSection[]): string {
  const sectionCards = sections.map((section) => renderEditorSection(section)).join('');
  return `
    ${renderTemplateGhosts()}
    ${sectionCards}
    ${renderAddGhostCard('__root__', 'Add New Component')}
  `;
}

function renderTemplateGhosts(): string {
  const fields = getTemplateFields();
  if (fields.length === 0) {
    return '';
  }

  const cards = fields
    .filter((field) => !hasTemplateFieldBlock(field))
    .map(
      (field) => `
      <article class="ghost-section-card template-ghost" data-action="add-template-field" data-template-field="${escapeAttr(field)}">
        <div class="ghost-plus-big"><span>+</span></div>
        <div class="ghost-label">Add Template Field: ${escapeHtml(field)}</div>
      </article>
    `
    )
    .join('');

  return cards;
}

function renderAddGhostCard(sectionKey: string, label: string): string {
  const selectKey = sectionKey;
  const action = sectionKey === '__root__' ? 'spawn-root-ghost' : 'spawn-block-ghost';

  return `
    <article class="ghost-section-card add-ghost" data-action="${action}" data-section-key="${escapeAttr(sectionKey)}">
      <div class="ghost-plus-big"><span>+</span></div>
      <div class="ghost-label">${escapeHtml(label)}</div>
      <label class="ghost-component-picker">
        <span>Component</span>
        <select data-section-key="${escapeAttr(selectKey)}" data-field="new-component-type">
          ${renderComponentOptions(state.addComponentBySection[selectKey] ?? 'text')}
        </select>
      </label>
    </article>
  `;
}

function renderEditorSection(section: VisualSection): string {
  return `
    <article class="editor-section-card" data-editor-section="${escapeAttr(section.key)}">
      <div class="editor-section-head">
        <strong>Section L${section.level}</strong>
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
      </div>

      <div class="editor-children">
        ${section.children.map((child) => renderEditorSection(child)).join('')}
        ${renderAddGhostCard(section.key, 'Add New Component')}
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
        <strong>${escapeHtml(component)} component</strong>
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

function applyRichAction(action: string, editable: HTMLElement): void {
  if (action === 'bold') {
    document.execCommand('bold');
  } else if (action === 'italic') {
    document.execCommand('italic');
  } else if (action === 'heading') {
    document.execCommand('formatBlock', false, 'h2');
  } else if (action === 'list') {
    document.execCommand('insertUnorderedList');
  } else if (action === 'link') {
    const url = window.prompt('Enter link URL');
    if (!url) {
      return;
    }
    document.execCommand('createLink', false, url);
  }

  const inputEvent = new InputEvent('input', { bubbles: true });
  editable.dispatchEvent(inputEvent);
}

function renderTemplatePanel(): string {
  const fields = getTemplateFields();
  if (fields.length === 0) {
    return '';
  }

  return `
    <section class="template-panel">
      <div class="template-title">Template Fields</div>
      <div class="template-grid">
        ${fields
          .map(
            (field) => `<div class="template-item">
              <label>
                <span>${escapeHtml(field)}</span>
                <input data-field="template-value" data-template-field="${escapeAttr(field)}" value="${escapeAttr(
                  state.templateValues[field] ?? ''
                )}" placeholder="Fill value or leave blank" />
              </label>
            </div>`
          )
          .join('')}
      </div>
    </section>
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
                <input data-field="def-tags" data-def-index="${index}" value="${escapeAttr(def.tags ?? '')}" />
              </label>
              <label>
                <span>Description</span>
                <input data-field="def-description" data-def-index="${index}" value="${escapeAttr(def.description ?? '')}" />
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

  if (component === 'plugin') {
    return `
      <label>
        <span>Plugin URL</span>
        <input data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(
      block.id
    )}" data-field="block-plugin-url" value="${escapeAttr(block.schema.pluginUrl)}" />
      </label>
      <div class="plugin-placeholder">Plugin placeholder: ${escapeHtml(block.schema.pluginUrl || 'No URL set')}</div>
    `;
  }

  if (component === 'table') {
    const columns = splitColumns(block.schema.tableColumns);
    return `
      <div class="table-editor">
        <label>
          <span>Columns (comma-separated)</span>
          <input data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(
      block.id
    )}" data-field="table-columns" value="${escapeAttr(block.schema.tableColumns)}" />
        </label>
        <div class="table-rows">
          ${block.schema.tableRows
            .map((row, rowIndex) => renderTableRowEditor(sectionKey, block.id, columns, row, rowIndex))
            .join('')}
        </div>
        <button type="button" class="ghost" data-action="add-table-row" data-section-key="${escapeAttr(
          sectionKey
        )}" data-block-id="${escapeAttr(block.id)}">Add Row</button>
      </div>
    `;
  }

  if (component === 'container') {
    return `
      <label>
        <span>Container Title</span>
        <input data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(
      block.id
    )}" data-field="block-container-title" value="${escapeAttr(block.schema.containerTitle)}" />
      </label>
      <div class="muted">Use the section ghost add card below to add contained components.</div>
    `;
  }

  if (component === 'grid') {
    ensureGridItems(block.schema);

    return `
      <div class="editor-grid schema-grid">
        <label>
          <span>Grid Columns</span>
          <input type="number" min="1" max="6" data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(
      block.id
    )}" data-field="block-grid-columns" value="${escapeAttr(String(block.schema.gridColumns))}" />
        </label>
      </div>
      <div class="grid-fields">
        ${block.schema.gridItems
          .map(
            (item, index) => `<div class="grid-field-row">
              <div class="grid-field-head">
                <strong>Grid Component ${index + 1}</strong>
                <button type="button" class="danger remove-x" data-action="remove-grid-item" data-section-key="${escapeAttr(
                  sectionKey
                )}" data-block-id="${escapeAttr(block.id)}" data-grid-item-id="${escapeAttr(item.id)}">×</button>
              </div>
              <select data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(
              block.id
            )}" data-field="block-grid-item-component" data-grid-item-id="${escapeAttr(item.id)}">
                ${renderComponentOptions(item.component)}
              </select>
              <select data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(
                block.id
              )}" data-field="block-grid-item-column" data-grid-item-id="${escapeAttr(item.id)}">
                ${renderOption('left', item.column)}
                ${renderOption('right', item.column)}
                ${renderOption('full', item.column)}
              </select>
              <div class="rich-toolbar">
                <button type="button" data-rich-action="bold" data-rich-field="block-grid-rich" data-grid-item-id="${escapeAttr(
                  item.id
                )}" data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(
                  block.id
                )}" title="Bold (Ctrl/Cmd+B)"><strong>B</strong></button>
                <button type="button" data-rich-action="italic" data-rich-field="block-grid-rich" data-grid-item-id="${escapeAttr(
                  item.id
                )}" data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(
                  block.id
                )}" title="Italic (Ctrl/Cmd+I)"><em>I</em></button>
                <button type="button" data-rich-action="list" data-rich-field="block-grid-rich" data-grid-item-id="${escapeAttr(
                  item.id
                )}" data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(
                  block.id
                )}" title="Bullet List">List</button>
                <button type="button" data-rich-action="link" data-rich-field="block-grid-rich" data-grid-item-id="${escapeAttr(
                  item.id
                )}" data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(
                  block.id
                )}" title="Link (Ctrl/Cmd+K)">Link</button>
              </div>
              <div class="rich-editor" contenteditable="true" data-section-key="${escapeAttr(
                sectionKey
              )}" data-block-id="${escapeAttr(block.id)}" data-grid-item-id="${escapeAttr(item.id)}" data-field="block-grid-rich">${markdownToEditorHtml(item.content)}</div>
            </div>`
          )
          .join('')}
      </div>
      <button type="button" class="ghost" data-action="add-grid-item" data-section-key="${escapeAttr(
        sectionKey
      )}" data-block-id="${escapeAttr(block.id)}">Add Grid Component</button>
    `;
  }

  if (component === 'code') {
    return `
      <label>
        <span>Language</span>
        <input data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(
      block.id
    )}" data-field="block-code-language" value="${escapeAttr(block.schema.codeLanguage)}" />
      </label>
      <textarea class="code-editor" data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(
      block.id
    )}" data-field="block-code">${escapeHtml(block.text)}</textarea>
    `;
  }

  const richEditor = `
    <div class="rich-toolbar">
      <button type="button" data-rich-action="bold" data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(
    block.id
  )}" title="Bold (Ctrl/Cmd+B)"><strong>B</strong></button>
      <button type="button" data-rich-action="italic" data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(
    block.id
  )}" title="Italic (Ctrl/Cmd+I)"><em>I</em></button>
      <button type="button" data-rich-action="heading" data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(
    block.id
  )}" title="Heading">H2</button>
      <button type="button" data-rich-action="list" data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(
    block.id
  )}" title="Bullet List">List</button>
      <button type="button" data-rich-action="link" data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(
    block.id
  )}" title="Link (Ctrl/Cmd+K)">Link</button>
    </div>
    <div
      class="rich-editor"
      contenteditable="true"
      data-section-key="${escapeAttr(sectionKey)}"
      data-block-id="${escapeAttr(block.id)}"
      data-field="block-rich"
    >${markdownToEditorHtml(block.text)}</div>
  `;

  if (component === 'expandable') {
    return `
      <label>
        <span>Stub Text</span>
        <input data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(
      block.id
    )}" data-field="block-expandable-stub" value="${escapeAttr(block.schema.expandableStub)}" />
      </label>
      <div class="expand-chooser-grid">
        <article class="ghost-section-card add-ghost">
          <div class="ghost-plus-big"><span>+</span></div>
          <div class="ghost-label">Stub: ${escapeHtml(block.schema.expandableStubComponent)}</div>
          <label class="ghost-component-picker">
            <span>Component</span>
            <select data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(
      block.id
    )}" data-field="block-expandable-stub-component">
              ${renderComponentOptions(block.schema.expandableStubComponent)}
            </select>
          </label>
        </article>
        <article class="ghost-section-card add-ghost">
          <div class="ghost-plus-big"><span>+</span></div>
          <div class="ghost-label">Expanded: ${escapeHtml(block.schema.expandableContentComponent)}</div>
          <label class="ghost-component-picker">
            <span>Component</span>
            <select data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(
      block.id
    )}" data-field="block-expandable-content-component">
              ${renderComponentOptions(block.schema.expandableContentComponent)}
            </select>
          </label>
        </article>
      </div>
      <label><input type="checkbox" data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(
      block.id
    )}" data-field="block-expandable-always" ${block.schema.expandableAlwaysShowStub ? 'checked' : ''} /> Always show stub</label>
      ${richEditor}
    `;
  }

  return richEditor;
}

function renderBlockSchemaEditor(sectionKey: string, block: VisualBlock): string {
  return `
    <div class="editor-grid schema-grid">
      <label>
        <span>Component</span>
        <select data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(block.id)}" data-field="block-component">
          ${renderComponentOptions(block.schema.component)}
        </select>
      </label>
      <label>
        <span>Alignment</span>
        <select data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(block.id)}" data-field="block-align">
          ${renderOption('left', block.schema.align)}
          ${renderOption('center', block.schema.align)}
          ${renderOption('right', block.schema.align)}
        </select>
      </label>
      <label>
        <span>Placement Slot</span>
        <select data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(block.id)}" data-field="block-slot">
          ${renderOption('left', block.schema.slot)}
          ${renderOption('center', block.schema.slot)}
          ${renderOption('right', block.schema.slot)}
        </select>
      </label>
    </div>
    <div class="muted">Use the Meta button to edit tags and description.</div>
  `;
}

function renderTableRowEditor(
  sectionKey: string,
  blockId: string,
  columns: string[],
  row: TableRow,
  rowIndex: number
): string {
  const safeColumns = columns.length > 0 ? columns : ['Column 1', 'Column 2'];
  return `
    <div class="table-row-editor">
      <div class="table-row-cells">
        ${safeColumns
          .map(
            (column, cellIndex) => `<label>
              <span>${escapeHtml(column)}</span>
              <input data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(
              blockId
            )}" data-row-index="${rowIndex}" data-cell-index="${cellIndex}" data-field="table-cell" value="${escapeAttr(
              row.cells[cellIndex] ?? ''
            )}" />
            </label>`
          )
          .join('')}
      </div>
      <label><input type="checkbox" data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(
    blockId
  )}" data-row-index="${rowIndex}" data-field="table-clickable" ${row.clickable ? 'checked' : ''} /> Click to reveal details</label>
      ${
        row.clickable
          ? `<div class="table-details-editor">
              <label>
                <span>Details Container Title</span>
                <input data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(
              blockId
            )}" data-row-index="${rowIndex}" data-field="table-details-title" value="${escapeAttr(row.detailsTitle || 'Details')}" />
              </label>
              <div class="rich-toolbar">
                <button type="button" data-rich-action="bold" data-rich-field="table-details-rich" data-row-index="${rowIndex}" data-section-key="${escapeAttr(
              sectionKey
            )}" data-block-id="${escapeAttr(blockId)}" title="Bold (Ctrl/Cmd+B)"><strong>B</strong></button>
                <button type="button" data-rich-action="italic" data-rich-field="table-details-rich" data-row-index="${rowIndex}" data-section-key="${escapeAttr(
              sectionKey
            )}" data-block-id="${escapeAttr(blockId)}" title="Italic (Ctrl/Cmd+I)"><em>I</em></button>
                <button type="button" data-rich-action="list" data-rich-field="table-details-rich" data-row-index="${rowIndex}" data-section-key="${escapeAttr(
              sectionKey
            )}" data-block-id="${escapeAttr(blockId)}" title="Bullet List">List</button>
                <button type="button" data-rich-action="link" data-rich-field="table-details-rich" data-row-index="${rowIndex}" data-section-key="${escapeAttr(
              sectionKey
            )}" data-block-id="${escapeAttr(blockId)}" title="Link (Ctrl/Cmd+K)">Link</button>
              </div>
              <div class="rich-editor" contenteditable="true" data-section-key="${escapeAttr(
                sectionKey
              )}" data-block-id="${escapeAttr(blockId)}" data-row-index="${rowIndex}" data-field="table-details-rich">${markdownToEditorHtml(
                row.detailsContent || ''
              )}</div>
            </div>`
          : ''
      }
      <button type="button" class="danger" data-action="remove-table-row" data-section-key="${escapeAttr(
        sectionKey
      )}" data-block-id="${escapeAttr(blockId)}" data-row-index="${rowIndex}">Remove Row</button>
    </div>
  `;
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
  const sectionKey = section.key;
  const blockAttrs = `class="reader-block reader-block-${escapeAttr(base)} align-${escapeAttr(block.schema.align)} slot-${escapeAttr(
    block.schema.slot
  )}" data-component="${escapeAttr(block.schema.component)}"`;

  if (base === 'plugin') {
    return `<div ${blockAttrs}><div class="plugin-placeholder">Plugin placeholder: ${escapeHtml(
      block.schema.pluginUrl || 'No URL set'
    )}</div></div>`;
  }

  if (base === 'expandable') {
    const stubHtml = renderComponentFragment(block.schema.expandableStubComponent, block.schema.expandableStub, block);
    const contentHtml = renderComponentFragment(block.schema.expandableContentComponent, applyTemplateValues(block.text), block);
    const expanded = block.schema.expandableExpanded;
    const alwaysShowStub = block.schema.expandableAlwaysShowStub;
    const body = expanded
      ? alwaysShowStub
        ? `<div class="expand-stub">${stubHtml}</div><div class="expand-content">${contentHtml}</div>`
        : `<div class="expand-content">${contentHtml}</div>`
      : `<div class="expand-stub">${stubHtml}</div>`;
    return `<div ${blockAttrs} data-reader-action="toggle-expandable" data-section-key="${escapeAttr(
      sectionKey
    )}" data-block-id="${escapeAttr(block.id)}">${body}</div>`;
  }

  if (base === 'table') {
    const columns = splitColumns(block.schema.tableColumns);
    return `<div ${blockAttrs}>
      <table class="reader-table">
        <thead>
          <tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${block.schema.tableRows
            .map(
              (row, rowIndex) => `
                <tr class="table-main-row table-main-row-${rowIndex % 2 === 0 ? 'even' : 'odd'} ${
                  row.clickable ? 'is-clickable' : 'is-static'
                }" data-reader-action="toggle-table-row" data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(
                  block.id
                )}" data-row-index="${rowIndex}">
                  ${columns
                    .map((_, cellIndex) => `<td>${escapeHtml(row.cells[cellIndex] ?? '')}</td>`)
                    .join('')}
                </tr>
                ${
                  row.expanded
                    ? `<tr class="table-details-row"><td colspan="${Math.max(
                        columns.length,
                        1
                      )}"><div class="reader-table-details-container"><div class="reader-container-title">${escapeHtml(
                        row.detailsTitle || 'Details'
                      )}</div><div class="reader-container-body">${renderComponentFragment(
                        'text',
                        applyTemplateValues(row.detailsContent || ''),
                        block
                      )}</div></div></td></tr>`
                    : ''
                }
              `
            )
            .join('')}
        </tbody>
      </table>
    </div>`;
  }

  if (base === 'container') {
    const title = block.schema.containerTitle || 'Container';
    const body = block.text.trim().length > 0 ? renderComponentFragment('text', applyTemplateValues(block.text), block) : '';
    return `<div ${blockAttrs}>
      <div class="reader-container-title">${escapeHtml(title)}</div>
      ${body ? `<div class="reader-container-body">${body}</div>` : ''}
    </div>`;
  }

  if (base === 'grid') {
    ensureGridItems(block.schema);
    const columns = coerceGridColumns(block.schema.gridColumns);
    const gridStyle = `grid-template-columns: repeat(${columns}, minmax(0, 1fr));`;
    const cells = block.schema.gridItems
      .map((item) => {
        const gridColumn =
          item.column === 'full' ? '1 / -1' : item.column === 'right' && columns > 1 ? `${Math.min(columns, 2)} / span 1` : '1 / span 1';
        return `<div class="reader-grid-cell" style="grid-column: ${escapeAttr(gridColumn)};">${renderComponentFragment(
          item.component,
          applyTemplateValues(item.content),
          block
        )}</div>`;
      })
      .join('');
    return `<div ${blockAttrs}>
      <div class="reader-grid-layout" style="${escapeAttr(gridStyle)}">${cells}</div>
    </div>`;
  }

  const html = renderComponentFragment(base, applyTemplateValues(block.text), block);
  return `<div ${blockAttrs}>${html}</div>`;
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
          <div class="editor-grid">
            <label>
              <span>Tags (comma-separated)</span>
              <input data-section-key="${escapeAttr(state.componentMetaModal.sectionKey)}" data-block-id="${escapeAttr(
      state.componentMetaModal.blockId
    )}" data-field="block-tags" value="${escapeAttr(block.schema.tags)}" />
            </label>
            <label>
              <span>Description</span>
              <input data-section-key="${escapeAttr(state.componentMetaModal.sectionKey)}" data-block-id="${escapeAttr(
      state.componentMetaModal.blockId
    )}" data-field="block-description" value="${escapeAttr(block.schema.description)}" />
            </label>
          </div>
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
    return [createEmptyBlock()];
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
    gridColumns: block.schema.gridColumns,
    gridItems: block.schema.gridItems,
    tags: block.schema.tags,
    description: block.schema.description,
    pluginUrl: block.schema.pluginUrl,
    expandableStubComponent: block.schema.expandableStubComponent,
    expandableContentComponent: block.schema.expandableContentComponent,
    expandableStub: block.schema.expandableStub,
    expandableAlwaysShowStub: block.schema.expandableAlwaysShowStub,
    expandableExpanded: block.schema.expandableExpanded,
    tableColumns: block.schema.tableColumns,
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
}

function closeModalIfTarget(sectionKey: string): void {
  if (state.modalSectionKey === sectionKey) {
    closeModal();
  }
  if (state.componentMetaModal?.sectionKey === sectionKey) {
    state.componentMetaModal = null;
  }
}

function createDefaultDocument(): VisualDocument {
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
        blocks: [
          {
            id: makeId('block'),
            text: 'This is a **visual HVY editor**. Add sections, blocks, and style/schema settings.',
            schema: defaultBlockSchema('text'),
            schemaMode: false,
          },
        ],
        children: [
          {
            key: makeId('section'),
            customId: 'try-it',
            idEditorOpen: false,
            isGhost: false,
            title: 'Try It',
            level: 2,
            expanded: true,
            highlight: true,
            customCss: '',
            blocks: [
              {
                id: makeId('block'),
                text: '1. Add a section in the editor.\n2. Type rich content with the toolbar or hotkeys.\n3. Download as `.hvy`.\n4. Re-open via **Select File**.\n5. Jump with [link](#welcome).',
                schema: defaultBlockSchema('text'),
                schemaMode: false,
              },
            ],
            children: [],
          },
        ],
      },
    ],
  };
}

function createEmptySection(level: number, component = 'text', isGhost = false): VisualSection {
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
    blocks: [createEmptyBlock(component)],
    children: [],
  };
}

function createEmptyBlock(component = 'text'): VisualBlock {
  const schema = defaultBlockSchema(component);
  applyComponentDefaults(schema, component);
  return {
    id: makeId('block'),
    text: '',
    schema,
    schemaMode: false,
  };
}

function defaultBlockSchema(component = 'text'): BlockSchema {
  return {
    component,
    align: 'left',
    slot: 'center',
    codeLanguage: 'ts',
    containerTitle: 'Container',
    gridColumns: 2,
    gridItems: [createGridItem(0, 2), createGridItem(1, 2)],
    tags: '',
    description: '',
    metaOpen: false,
    pluginUrl: '',
    expandableStubComponent: 'quote',
    expandableContentComponent: 'text',
    expandableStub: 'Read more',
    expandableAlwaysShowStub: true,
    expandableExpanded: false,
    tableColumns: 'Column 1, Column 2',
    tableRows: [],
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
    gridColumns,
    gridItems: parsedGridItems,
    tags: typeof candidate.tags === 'string' ? candidate.tags : '',
    description: typeof candidate.description === 'string' ? candidate.description : '',
    metaOpen: candidate.metaOpen === true,
    pluginUrl: typeof candidate.pluginUrl === 'string' ? candidate.pluginUrl : '',
    expandableStubComponent: typeof candidate.expandableStubComponent === 'string' ? candidate.expandableStubComponent : 'quote',
    expandableContentComponent:
      typeof candidate.expandableContentComponent === 'string' ? candidate.expandableContentComponent : 'text',
    expandableStub: typeof candidate.expandableStub === 'string' ? candidate.expandableStub : 'Read more',
    expandableAlwaysShowStub: candidate.expandableAlwaysShowStub !== false,
    expandableExpanded: candidate.expandableExpanded === true,
    tableColumns: typeof candidate.tableColumns === 'string' ? candidate.tableColumns : 'Column 1, Column 2',
    tableRows: rows.map((row) => {
      const mapped = row as JsonObject;
      return {
        cells: Array.isArray(mapped.cells) ? mapped.cells.map((cell) => String(cell ?? '')) : ['', ''],
        expanded: mapped.expanded === true,
        clickable: mapped.clickable !== false,
        detailsTitle: typeof mapped.detailsTitle === 'string' ? mapped.detailsTitle : 'Details',
        detailsContent:
          typeof mapped.detailsContent === 'string' ? mapped.detailsContent : typeof mapped.details === 'string' ? mapped.details : '',
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

function applyTemplateValues(input: string): string {
  return input.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_all, key: string) => state.templateValues[key] ?? '');
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
    schema.tableRows.push({
      cells: ['', ''],
      expanded: false,
      clickable: true,
      detailsTitle: 'Details',
      detailsContent: '',
    });
  }
  if (base === 'expandable' && !schema.expandableStub) {
    schema.expandableStub = 'Read more';
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

function getTemplateFields(): string[] {
  if (state.document.meta.template !== true) {
    return [];
  }
  const schema = state.document.meta.schema;
  if (!schema || typeof schema !== 'object') {
    return [];
  }
  const properties = (schema as JsonObject).properties;
  if (!properties || typeof properties !== 'object') {
    return [];
  }
  return Object.keys(properties as JsonObject);
}

function hasTemplateFieldBlock(field: string): boolean {
  const token = `{{${field}}}`;
  const sections = flattenSections(state.document.sections);
  return sections.some((section) => section.blocks.some((block) => block.text.includes(token)));
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
