import './style.css';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import TurndownService from 'turndown';
import { parseHvy } from './hvy/parser';
import { stringify as stringifyYaml } from 'yaml';
import type { HvySection, JsonObject } from './hvy/types';

type Align = 'left' | 'center' | 'right';
type Slot = 'left' | 'center' | 'right';

interface BlockSchema {
  component: string;
  align: Align;
  slot: Slot;
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
};

renderApp();

function renderApp(): void {
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
            <button id="addRootSectionBtn" type="button" class="secondary">Add Root Section</button>
          </div>
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

  bindUi();
}

function bindUi(): void {
  const fileInput = app.querySelector<HTMLInputElement>('#fileInput');
  const downloadBtn = app.querySelector<HTMLButtonElement>('#downloadBtn');
  const downloadName = app.querySelector<HTMLInputElement>('#downloadName');
  const addRootSectionBtn = app.querySelector<HTMLButtonElement>('#addRootSectionBtn');
  const editorTree = app.querySelector<HTMLDivElement>('#editorTree');
  const readerDocument = app.querySelector<HTMLDivElement>('#readerDocument');
  const readerNav = app.querySelector<HTMLDivElement>('#readerNav');

  if (!fileInput || !downloadBtn || !downloadName || !addRootSectionBtn || !editorTree || !readerDocument || !readerNav) {
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

  addRootSectionBtn.addEventListener('click', () => {
    state.document.sections.push(createEmptySection(1));
    renderApp();
  });

  editorTree.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;

    const richButton = target.closest<HTMLElement>('[data-rich-action]');
    if (richButton) {
      event.preventDefault();
      const sectionKey = richButton.dataset.sectionKey;
      const blockId = richButton.dataset.blockId;
      const action = richButton.dataset.richAction;
      if (sectionKey && blockId && action) {
        const editable = editorTree.querySelector<HTMLElement>(
          `[data-section-key="${sectionKey}"][data-block-id="${blockId}"][data-field="block-rich"]`
        );
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

    if (!action || !sectionKey) {
      return;
    }

    const section = findSectionByKey(state.document.sections, sectionKey);
    if (!section) {
      return;
    }

    if (action === 'remove-section') {
      removeSectionByKey(state.document.sections, sectionKey);
      closeModalIfTarget(sectionKey);
      renderApp();
      return;
    }

    if (action === 'add-child') {
      section.children.push(createEmptySection(Math.min(section.level + 1, 6)));
      renderApp();
      return;
    }

    if (action === 'add-block') {
      section.blocks.push(createEmptyBlock());
      renderApp();
      return;
    }

    if (action === 'toggle-schema' && blockId) {
      const block = section.blocks.find((candidate) => candidate.id === blockId);
      if (!block) {
        return;
      }
      block.schemaMode = !block.schemaMode;
      renderApp();
      return;
    }

    if (action === 'remove-block' && blockId) {
      section.blocks = section.blocks.filter((candidate) => candidate.id !== blockId);
      if (section.blocks.length === 0) {
        section.blocks.push(createEmptyBlock());
      }
      renderApp();
      return;
    }

    if (action === 'focus-modal') {
      state.modalSectionKey = sectionKey;
      renderApp();
      return;
    }

    if (action === 'toggle-id-editor') {
      section.idEditorOpen = !section.idEditorOpen;
      renderApp();
      return;
    }

    if (action === 'jump-to-reader') {
      navigateToSection(getSectionId(section));
    }
  });

  editorTree.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    if (target.dataset.field !== 'block-rich') {
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

    const section = findSectionByKey(state.document.sections, sectionKey);
    if (!section) {
      return;
    }

    const field = target.dataset.field;

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
      block.text = turndown.turndown((target as HTMLElement).innerHTML);
      refreshReaderPanels();
      return;
    }

    if (field === 'block-component' && target instanceof HTMLInputElement) {
      block.schema.component = target.value;
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

    const focus = target.closest<HTMLElement>('[data-reader-action="open-modal"]');
    if (focus) {
      const sectionKey = focus.dataset.sectionKey;
      if (!sectionKey) {
        return;
      }
      state.modalSectionKey = sectionKey;
      renderApp();
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

function renderSectionEditorTree(sections: VisualSection[]): string {
  if (sections.length === 0) {
    return '<div class="muted">No sections yet. Click <strong>Add Root Section</strong>.</div>';
  }

  return sections.map((section) => renderEditorSection(section)).join('');
}

function renderEditorSection(section: VisualSection): string {
  const effectiveId = getSectionId(section);

  return `
    <article class="editor-section-card" data-editor-section="${escapeAttr(section.key)}">
      <div class="editor-section-head">
        <strong>Section L${section.level}</strong>
        <div class="editor-actions">
          <button type="button" class="ghost" data-action="jump-to-reader" data-section-key="${escapeAttr(section.key)}">Jump</button>
          <button type="button" class="ghost" data-action="focus-modal" data-section-key="${escapeAttr(section.key)}">Modal Context</button>
          <button type="button" class="ghost" data-action="add-child" data-section-key="${escapeAttr(section.key)}">Add Child</button>
          <button type="button" class="danger" data-action="remove-section" data-section-key="${escapeAttr(section.key)}">Remove</button>
        </div>
      </div>

      <div class="editor-grid">
        <label>
          <span>Title</span>
          <input data-section-key="${escapeAttr(section.key)}" data-field="section-title" value="${escapeAttr(section.title)}" />
        </label>
        <label>
          <span>Current ID</span>
          <div class="id-pill"><code>${escapeHtml(effectiveId)}</code></div>
        </label>
      </div>

      <div class="editor-row">
        <label><input type="checkbox" data-section-key="${escapeAttr(section.key)}" data-field="section-expanded" ${
    section.expanded ? 'checked' : ''
  } /> Expanded</label>
        <label><input type="checkbox" data-section-key="${escapeAttr(section.key)}" data-field="section-highlight" ${
    section.highlight ? 'checked' : ''
  } /> Highlight</label>
        <button type="button" class="ghost" data-action="toggle-id-editor" data-section-key="${escapeAttr(section.key)}">${
    section.idEditorOpen ? 'Hide ID Override' : 'Override ID'
  }</button>
        <button type="button" class="secondary" data-action="add-block" data-section-key="${escapeAttr(section.key)}">Add Text Block</button>
      </div>

      ${
        section.idEditorOpen
          ? `<label class="id-override">
              <span>ID Override (optional, blank keeps random ID)</span>
              <input data-section-key="${escapeAttr(section.key)}" data-field="section-custom-id" value="${escapeAttr(
              section.customId
            )}" placeholder="${escapeAttr(section.key)}" />
            </label>`
          : ''
      }

      <div class="editor-blocks">
        ${section.blocks.map((block) => renderEditorBlock(section.key, block)).join('')}
      </div>

      <div class="editor-children">
        ${section.children.map((child) => renderEditorSection(child)).join('')}
      </div>
    </article>
  `;
}

function renderEditorBlock(sectionKey: string, block: VisualBlock): string {
  return `
    <div class="editor-block">
      <div class="editor-block-head">
        <strong>Text Block</strong>
        <div class="editor-actions">
          <button type="button" class="ghost" data-action="toggle-schema" data-section-key="${escapeAttr(
            sectionKey
          )}" data-block-id="${escapeAttr(block.id)}">${block.schemaMode ? 'Text Mode' : 'Schema Mode'}</button>
          <button type="button" class="danger" data-action="remove-block" data-section-key="${escapeAttr(
            sectionKey
          )}" data-block-id="${escapeAttr(block.id)}">Remove Block</button>
        </div>
      </div>

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

      ${
        block.schemaMode
          ? `
        <div class="editor-grid schema-grid">
          <label>
            <span>Component</span>
            <input data-section-key="${escapeAttr(sectionKey)}" data-block-id="${escapeAttr(
              block.id
            )}" data-field="block-component" value="${escapeAttr(block.schema.component)}" />
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
      `
          : ''
      }
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

function renderNavigation(sections: VisualSection[]): string {
  const items = flattenSections(sections);
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
  if (sections.length === 0) {
    return '<div class="muted">No content to display yet.</div>';
  }
  return sections.map((section) => renderReaderSection(section)).join('');
}

function renderReaderSection(section: VisualSection): string {
  const effectiveId = getSectionId(section);
  const temp = state.tempHighlights.has(effectiveId);
  const classList = ['reader-section', section.highlight ? 'is-highlighted' : '', temp ? 'is-temp-highlighted' : '']
    .filter(Boolean)
    .join(' ');

  const content = section.expanded
    ? `<div class="reader-section-content">${section.blocks
        .map(
          (block) =>
            `<div class="reader-block align-${escapeAttr(block.schema.align)} slot-${escapeAttr(block.schema.slot)}" data-component="${
              escapeAttr(block.schema.component) || 'text'
            }">${DOMPurify.sanitize(marked.parse(block.text) as string)}</div>`
        )
        .join('')}${section.children.map((child) => renderReaderSection(child)).join('')}</div>`
    : '';

  return `
    <section id="${escapeAttr(effectiveId)}" class="${classList}" style="${escapeAttr(section.customCss)}">
      <header class="reader-section-head">
        <h${Math.min(Math.max(section.level, 1), 6)}>${escapeHtml(section.title)}</h${Math.min(Math.max(section.level, 1), 6)}>
        <div class="reader-head-actions">
          <button type="button" class="tiny" data-reader-action="open-modal" data-section-key="${escapeAttr(
            section.key
          )}">Modal Context</button>
          <button type="button" class="tiny" data-reader-action="toggle-expand" data-section-key="${escapeAttr(section.key)}">${
    section.expanded ? '−' : '+'
  }</button>
        </div>
      </header>
      ${content}
    </section>
  `;
}

function renderModal(): string {
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
  const body = document.sections.map((section) => serializeSection(section, 1)).join('\n').trim();
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
  }));

  const directive = `<!--hvy: ${JSON.stringify(meta)}-->`;

  const blockText = section.blocks
    .map((block) => {
      const schemaDirective = `<!--hvy:block ${JSON.stringify(block.schema)}-->`;
      return `${schemaDirective}\n${block.text.trim()}`;
    })
    .join('\n\n');

  const children = section.children.map((child) => serializeSection(child, level + 1)).join('\n\n');

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

  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
}

function closeModalIfTarget(sectionKey: string): void {
  if (state.modalSectionKey === sectionKey) {
    closeModal();
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
        title: 'Welcome',
        level: 1,
        expanded: true,
        highlight: false,
        customCss: '',
        blocks: [
          {
            id: makeId('block'),
            text: 'This is a **visual HVY editor**. Add sections, blocks, and style/schema settings.',
            schema: defaultBlockSchema(),
            schemaMode: false,
          },
        ],
        children: [
          {
            key: makeId('section'),
            customId: 'try-it',
            idEditorOpen: false,
            title: 'Try It',
            level: 2,
            expanded: true,
            highlight: true,
            customCss: '',
            blocks: [
              {
                id: makeId('block'),
                text: '1. Add a section in the editor.\n2. Type rich content with the toolbar or hotkeys.\n3. Download as `.hvy`.\n4. Re-open via **Select File**.\n5. Jump with [link](#welcome).',
                schema: defaultBlockSchema(),
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

function createEmptySection(level: number): VisualSection {
  return {
    key: makeId('section'),
    customId: '',
    idEditorOpen: false,
    title: 'New Section',
    level,
    expanded: true,
    highlight: false,
    customCss: '',
    blocks: [createEmptyBlock()],
    children: [],
  };
}

function createEmptyBlock(): VisualBlock {
  return {
    id: makeId('block'),
    text: '',
    schema: defaultBlockSchema(),
    schemaMode: false,
  };
}

function defaultBlockSchema(): BlockSchema {
  return {
    component: 'text',
    align: 'left',
    slot: 'center',
  };
}

function schemaFromUnknown(value: unknown): BlockSchema {
  if (!value || typeof value !== 'object') {
    return defaultBlockSchema();
  }
  const candidate = value as JsonObject;
  return {
    component: typeof candidate.component === 'string' ? candidate.component : 'text',
    align: coerceAlign(typeof candidate.align === 'string' ? candidate.align : 'left'),
    slot: coerceSlot(typeof candidate.slot === 'string' ? candidate.slot : 'center'),
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
