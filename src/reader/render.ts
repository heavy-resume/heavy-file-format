import './reader.css';
import './sidebar.css';
import { renderCodeReader } from '../editor/components/code/code';
import { renderComponentListReader } from '../editor/components/component-list/component-list';
import { renderContainerReader } from '../editor/components/container/container';
import { renderExpandableReader } from '../editor/components/expandable/expandable';
import { renderGridReader } from '../editor/components/grid/grid';
import { renderImageReader } from '../editor/components/image/image';
import { renderPluginReader } from '../editor/components/plugin/plugin';
import { renderTableReader, resetReaderTableStripeSequence } from '../editor/components/table/table';
import { renderTextReader } from '../editor/components/text/text';
import { renderXrefCardReader } from '../editor/components/xref-card/xref-card';
import type { ComponentRenderHelpers } from '../editor/component-helpers';
import type { BlockSchema, VisualBlock, VisualSection } from '../editor/types';
import { renderTagEditor } from '../editor/tag-editor';
import { colorValueToPickerHex, getResolvedThemeColor, getThemeColorLabel, THEME_COLOR_NAMES } from '../theme';
import type { ThemeConfig } from '../theme';
import type { DbTableQueryModalState, SqliteRowComponentModalState, VisualDocument } from '../types';
import { getDocumentSectionDefaultCss, mergeDocumentCss } from '../document-section-defaults';
import { sanitizeInlineCss } from '../css-sanitizer';
import { areTablesEnabled } from '../reference-config';
import { parseAttachedComponentBlocks } from '../plugins/db-table';
import { SCRIPTING_PLUGIN_ID } from '../plugins/registry';

interface ReaderRenderState {
  documentMeta: VisualDocument['meta'];
  documentSections: VisualSection[];
  addComponentBySection: Record<string, string>;
  tempHighlights: Set<string>;
  aiEditTarget: { sectionKey: string | null; blockId: string | null };
  modalSectionKey: string | null;
  sqliteRowComponentModal: SqliteRowComponentModalState | null;
  dbTableQueryModal: DbTableQueryModalState | null;
  reusableSaveModal: {
    kind: 'component' | 'section';
    sectionKey: string;
    blockId?: string;
    draftName: string;
  } | null;
  componentMetaModal: { sectionKey: string; blockId: string } | null;
  themeModalOpen: boolean;
  theme: ThemeConfig;
  currentView: 'editor' | 'viewer' | 'ai';
}

interface ReaderRenderDeps {
  escapeAttr: (value: string) => string;
  escapeHtml: (value: string) => string;
  flattenSections: (sections: VisualSection[]) => VisualSection[];
  findDuplicateSectionIds: (sections: VisualSection[]) => string[];
  findSectionByKey: (sections: VisualSection[], key: string) => VisualSection | null;
  findBlockByIds: (sectionKey: string, blockId: string) => VisualBlock | null;
  getSectionId: (section: VisualSection) => string;
  formatSectionTitle: (title: string) => string;
  resolveBaseComponent: (componentName: string) => string;
  ensureExpandableBlocks: (block: VisualBlock) => void;
  ensureGridItems: (schema: BlockSchema) => void;
  getComponentRenderHelpers: () => ComponentRenderHelpers;
  renderEditorBlock: (sectionKey: string, block: VisualBlock) => string;
  renderBlockContentEditor: (sectionKey: string, block: VisualBlock) => string;
  renderComponentOptions: (selected: string) => string;
  renderBlockMetaFields: (sectionKey: string, block: VisualBlock) => string;
}

export interface ReaderRenderer {
  renderNavigation: (sections: VisualSection[]) => string;
  renderReaderSections: (sections: VisualSection[]) => string;
  renderSidebarSections: (sections: VisualSection[]) => string;
  renderReaderSection: (section: VisualSection) => string;
  renderReaderBlock: (section: VisualSection, block: VisualBlock) => string;
  renderModal: () => string;
  renderLinkInlineModal: () => string;
  renderWarnings: () => string;
}

export function createReaderRenderer(state: ReaderRenderState, deps: ReaderRenderDeps): ReaderRenderer {
  function renderNavigation(sections: VisualSection[]): string {
    const items = deps.flattenSections(sections).filter((section) => !section.isGhost && section.location !== 'sidebar');
    if (items.length === 0) {
      return '<div class="muted">Navigation will appear when sections exist.</div>';
    }

    return `
      <div class="nav-title">Navigation</div>
      <div class="nav-list">
        ${items
          .map(
            (section) =>
              `<button type="button" class="nav-item" data-nav-id="${deps.escapeAttr(deps.getSectionId(section))}" data-level="${section.level}">${deps.escapeHtml(
                deps.formatSectionTitle(section.title)
              )}</button>`
          )
          .join('')}
      </div>
    `;
  }

  function renderReaderSections(sections: VisualSection[]): string {
    resetReaderTableStripeSequence();
    const realSections = sections.filter((section) => !section.isGhost && section.location !== 'sidebar');
    if (realSections.length === 0) {
      return '<div class="muted">No content to display yet.</div>';
    }
    const maxWidth = typeof state.documentMeta.reader_max_width === 'string' ? state.documentMeta.reader_max_width.trim() : '';
    const bodyStyle = maxWidth.length > 0 ? ` style="max-width: ${deps.escapeAttr(maxWidth)};"` : '';
    return `<div class="reader-document-body"${bodyStyle}>${realSections.map((section) => renderReaderSection(section)).join('')}</div>`;
  }

  function renderSidebarSections(sections: VisualSection[]): string {
    resetReaderTableStripeSequence();
    const sidebarSections = sections.filter((section) => !section.isGhost && section.location === 'sidebar');
    return sidebarSections.map((section) => renderReaderSection(section)).join('');
  }

  function renderReaderSection(section: VisualSection): string {
    const effectiveId = deps.getSectionId(section);
    const temp = state.tempHighlights.has(effectiveId);
    const classList = [
      'reader-section',
      section.contained ? '' : 'is-uncontained',
      !section.contained || section.expanded ? '' : 'is-collapsed-preview',
      section.highlight ? 'is-highlighted' : '',
      temp ? 'is-temp-highlighted' : '',
    ]
      .filter(Boolean)
      .join(' ');

    const contentClass = !section.contained || section.expanded ? 'reader-section-content' : 'reader-section-content reader-section-preview';
    const content = `<div class="${contentClass}">${section.blocks
      .map((block) => renderReaderBlock(section, block))
      .join('')}${section.children.filter((child) => !child.isGhost).map((child) => renderReaderSection(child)).join('')}</div>`;

    const toggleAttrs = section.contained && section.expanded
      ? ''
      : section.contained
      ? ` data-reader-action="toggle-expand" data-section-key="${deps.escapeAttr(section.key)}"`
      : '';

    const header = section.contained
      ? `
        <header class="reader-section-head" aria-label="Section controls">
          <div class="reader-head-actions">
            <button type="button" class="tiny toggle-expand-button" data-reader-action="toggle-expand" data-section-key="${deps.escapeAttr(section.key)}" aria-label="${
          section.expanded ? 'Collapse section' : 'Expand section'
        }">${section.expanded ? '+' : '-'}</button>
          </div>
        </header>
      `
      : '';
    const sectionStyle = mergeDocumentCss(getDocumentSectionDefaultCss(state.documentMeta), section.customCss);

    return `
      <section id="${deps.escapeAttr(effectiveId)}" class="${classList}" style="${deps.escapeAttr(sectionStyle)}"${toggleAttrs}>
        ${header}
        ${content}
      </section>
    `;
  }

  function renderReaderBlock(section: VisualSection, block: VisualBlock): string {
    const base = deps.resolveBaseComponent(block.schema.component);
    if (base === 'quote' && block.text.trim().length === 0) {
      return '';
    }
    const blockDomId = getBlockDomId(block);
    const idAttr = blockDomId ? ` id="${deps.escapeAttr(blockDomId)}"` : '';
    const blockClass = [
      'reader-block',
      `reader-block-${base}`,
      `align-${block.schema.align}`,
      `slot-${block.schema.slot}`,
      state.aiEditTarget.sectionKey === section.key && state.aiEditTarget.blockId === block.id ? 'is-ai-target' : '',
      blockDomId && state.tempHighlights.has(blockDomId) ? 'is-temp-highlighted' : '',
    ]
      .filter(Boolean)
      .map((part) => deps.escapeAttr(part))
      .join(' ');
    const blockAttrs = `${idAttr} class="${blockClass}" data-component="${deps.escapeAttr(block.schema.component)}" data-section-key="${deps.escapeAttr(section.key)}" data-block-id="${deps.escapeAttr(block.id)}" style="${deps.escapeAttr(sanitizeInlineCss(block.schema.customCss))}"`;
    const helpers = deps.getComponentRenderHelpers();

    if (base === 'code') {
      return `<div ${blockAttrs}>${renderCodeReader(section, block, helpers)}</div>`;
    }
    if (base === 'plugin') {
      if (block.schema.plugin === SCRIPTING_PLUGIN_ID && state.currentView === 'viewer') {
        return '';
      }
      return `<div ${blockAttrs}>${renderPluginReader(section, block, helpers)}</div>`;
    }
    if (base === 'container') {
      return `<div ${blockAttrs}>${renderContainerReader(section, block, helpers)}</div>`;
    }
    if (base === 'component-list') {
      return `<div ${blockAttrs}>${renderComponentListReader(section, block, helpers)}</div>`;
    }
    if (base === 'grid') {
      deps.ensureGridItems(block.schema);
      return `<div ${blockAttrs}>${renderGridReader(section, block, helpers)}</div>`;
    }
    if (base === 'expandable') {
      deps.ensureExpandableBlocks(block);
      return `<div ${blockAttrs}>${renderExpandableReader(section, block, helpers)}</div>`;
    }
    if (base === 'table') {
      if (!areTablesEnabled()) {
        return `<div ${blockAttrs}><div class="plugin-placeholder">Table rendering is disabled in this reference implementation.</div></div>`;
      }
      return `<div ${blockAttrs}>${renderTableReader(section, block, helpers)}</div>`;
    }
    if (base === 'xref-card') {
      return `<div ${blockAttrs}>${renderXrefCardReader(section, block, helpers)}</div>`;
    }
    if (base === 'image') {
      return `<div ${blockAttrs}>${renderImageReader(section, block, helpers)}</div>`;
    }
    return `<div ${blockAttrs}>${renderTextReader(section, block, helpers)}</div>`;
  }

  function getBlockDomId(block: VisualBlock): string {
    return block.schema.id.trim();
  }

  function renderThemeModal(): string {
    const theme = state.theme;
    const overrideNames = new Set(Object.keys(theme.colors));
    const rows = THEME_COLOR_NAMES.map((name) => {
      const isOverridden = overrideNames.has(name);
      const value = isOverridden ? theme.colors[name] : getResolvedThemeColor(name);
      const pickerValue = colorValueToPickerHex(value);
      return `
        <div class="theme-color-row${isOverridden ? ' theme-color-row--override' : ''}">
          <div class="theme-color-meta">
            <strong>${deps.escapeHtml(getThemeColorLabel(name))}</strong>
            <span class="theme-color-var">${deps.escapeHtml(name)}</span>
          </div>
          <input
            class="theme-color-picker"
            type="color"
            data-field="theme-color-picker"
            data-color-name="${deps.escapeAttr(name)}"
            value="${deps.escapeAttr(pickerValue)}"
            aria-label="${deps.escapeAttr(getThemeColorLabel(name))} color picker"
          />
          <input
            class="theme-color-value"
            data-field="theme-color-value"
            data-color-name="${deps.escapeAttr(name)}"
            value="${deps.escapeAttr(value)}"
            placeholder="CSS color"
            aria-label="${deps.escapeAttr(getThemeColorLabel(name))} color value"
          />
          <span class="theme-color-swatch" style="${value ? `background: ${deps.escapeAttr(value)};` : ''}" aria-hidden="true"></span>
          ${isOverridden
            ? `<button type="button" class="ghost" data-action="theme-reset-color" data-color-name="${deps.escapeAttr(name)}" title="Reset to default">Reset</button>`
            : '<span class="theme-color-default muted">default</span>'}
        </div>
      `;
    }).join('');
    const customNames = Object.keys(theme.colors).filter((name) => !(THEME_COLOR_NAMES as readonly string[]).includes(name));
    const customRows = customNames.map((name) => {
      const value = theme.colors[name] ?? '';
      return `
        <div class="theme-color-row theme-color-row--override">
          <input
            class="theme-color-name"
            data-field="theme-color-name"
            data-color-name="${deps.escapeAttr(name)}"
            value="${deps.escapeAttr(name)}"
            aria-label="Custom color variable name"
          />
          <input
            class="theme-color-value"
            data-field="theme-color-value"
            data-color-name="${deps.escapeAttr(name)}"
            value="${deps.escapeAttr(value)}"
            placeholder="CSS color"
            aria-label="Custom color value"
          />
          <span class="theme-color-swatch" style="${value ? `background: ${deps.escapeAttr(value)};` : ''}" aria-hidden="true"></span>
          <button type="button" class="ghost" data-action="theme-remove-color" data-color-name="${deps.escapeAttr(name)}" title="Remove">Remove</button>
        </div>
      `;
    }).join('');
    return `
      <div id="modalRoot" class="modal-root">
        <div class="modal-overlay" data-modal-action="close-overlay"></div>
        <section class="modal-panel theme-modal">
          <div class="modal-head">
            <h3>Theme Colors</h3>
            <button type="button" data-modal-action="close">Close</button>
          </div>
          <p class="muted">
            Adjust the document theme with a color picker or by typing any valid CSS color value.
            Overrides are saved with the document.
          </p>
          <div class="theme-color-list">
            ${rows}
          </div>
          ${customRows
            ? `<div class="theme-custom-section">
                <div class="theme-custom-head">
                  <h4>Custom Variables</h4>
                  <p class="muted">Use raw CSS variable names for custom theme entries.</p>
                </div>
                <div class="theme-color-list theme-color-list--custom">
                  ${customRows}
                </div>
              </div>`
            : ''}
          <div class="link-inline-actions">
            <button type="button" class="ghost" data-action="theme-add-color">Add Color</button>
            <button type="button" class="secondary" data-modal-action="close">Done</button>
          </div>
        </section>
      </div>
    `;
  }

  function renderModal(): string {
    if (state.themeModalOpen) {
      return renderThemeModal();
    }
    if (state.reusableSaveModal) {
      const title = state.reusableSaveModal.kind === 'section' ? 'Save As Reusable Section' : 'Save As Reusable Component';
      const help =
        state.reusableSaveModal.kind === 'section'
          ? 'This saves a cloned section template, including its current blocks and nested subsections.'
          : 'This saves a cloned component template, including pre-filled values and nested children.';
      return `
        <div id="modalRoot" class="modal-root">
          <div class="modal-overlay" data-modal-action="close-overlay"></div>
          <section class="modal-panel component-meta-modal">
            <div class="modal-head">
              <h3>${title}</h3>
              <button type="button" data-modal-action="close">Close</button>
            </div>
            <p class="muted">${help}</p>
            <label>
              <span>Name</span>
              <input id="reusableNameInput" value="${deps.escapeAttr(state.reusableSaveModal.draftName)}" placeholder="Callout, Pricing Table, FAQ Section..." autofocus />
            </label>
            <div class="link-inline-actions reusable-save-actions">
              <button type="button" class="ghost" data-modal-action="close">Cancel</button>
              <button type="button" class="secondary" data-modal-action="save-reusable">Save Reusable</button>
            </div>
          </section>
        </div>
      `;
    }

    if (state.componentMetaModal) {
      const block = deps.findBlockByIds(state.componentMetaModal.sectionKey, state.componentMetaModal.blockId);
      if (!block) {
        return '';
      }
      return `
        <div id="modalRoot" class="modal-root">
          <div class="modal-overlay" data-modal-action="close-overlay"></div>
          <section class="modal-panel component-meta-modal">
            <div class="modal-head">
              <h3>Component Meta: ${deps.escapeHtml(block.schema.component)}</h3>
              <div class="modal-head-actions">
                <button
                  type="button"
                  class="ghost lock-toggle-button"
                  data-modal-action="toggle-component-lock"
                  data-section-key="${deps.escapeAttr(state.componentMetaModal.sectionKey)}"
                  data-block-id="${deps.escapeAttr(state.componentMetaModal.blockId)}"
                  aria-pressed="${block.schema.lock ? 'true' : 'false'}"
                  title="${block.schema.lock ? 'Locked' : 'Unlocked'}"
                  aria-label="${block.schema.lock ? 'Locked' : 'Unlock'}"
                >${block.schema.lock ? '🔒 Locked' : '🔓 Unlock'}</button>
                <button type="button" data-modal-action="close">Close</button>
              </div>
            </div>
            <p class="muted">Meta is optional and can be used by readers, indexing, and plugins.</p>
            ${deps.renderBlockMetaFields(state.componentMetaModal.sectionKey, block)}
          </section>
        </div>
      `;
    }

    if (state.dbTableQueryModal) {
      const queryModal = state.dbTableQueryModal;
      const placeholderTableName = queryModal.tableName.trim().length > 0 ? queryModal.tableName.trim() : '<table_name>';
      return `
        <div id="modalRoot" class="modal-root">
          <div class="modal-overlay" data-modal-action="close-overlay"></div>
          <section class="modal-panel component-meta-modal">
            <div class="modal-head">
              <h3>DB Table Query</h3>
              <button type="button" data-modal-action="close">Close</button>
            </div>
            ${queryModal.error ? `<div class="raw-editor-error" role="alert">${deps.escapeHtml(queryModal.error)}</div>` : ''}
            <div class="modal-field-stack">
              <label>
                <span>Query</span>
                <textarea
                  id="dbTableQueryInput"
                  class="db-table-query-input"
                  rows="10"
                  spellcheck="false"
                  placeholder="${deps.escapeAttr(`SELECT * FROM ${placeholderTableName}`)}"
                >${deps.escapeHtml(queryModal.draftQuery)}</textarea>
              </label>
              <label class="checkbox-label">
                <input
                  id="dbTableQueryDynamicWindowInput"
                  type="checkbox"
                  ${queryModal.dynamicWindow ? 'checked' : ''}
                />
                <span>Dynamic offset and limit</span>
              </label>
              ${queryModal.dynamicWindow ? '' : `<label>
                <span>Rows limited to</span>
                <input
                  id="dbTableQueryLimitInput"
                  type="number"
                  min="1"
                  max="100"
                  value="${deps.escapeAttr(String(queryModal.queryLimit))}"
                />
              </label>`}
            </div>
            <div class="link-inline-actions reusable-save-actions">
              <button type="button" class="ghost" data-modal-action="close">Cancel</button>
              <button type="button" class="secondary" data-modal-action="db-table-query-save">Save</button>
            </div>
          </section>
        </div>
      `;
    }

    if (state.sqliteRowComponentModal) {
      const rowModal = state.sqliteRowComponentModal;
      const section = deps.findSectionByKey(state.documentSections, rowModal.sectionKey);
      if (!section) {
        return '';
      }
      const attachedBlocks = rowModal.blocks;
      let rawPreviewBlocks: VisualBlock[] = [];
      if (rowModal.mode === 'raw') {
        try {
          rawPreviewBlocks = rowModal.rawDraft.trim().length > 0 ? parseAttachedComponentBlocks(rowModal.rawDraft) : [];
        } catch {
          rawPreviewBlocks = [];
        }
      }
      const addKey = `sqlite-row-component:${rowModal.sectionKey}:${rowModal.rowId}`;
      return `
        <div id="modalRoot" class="modal-root">
          <div class="modal-overlay" data-modal-action="close-overlay"></div>
          <section class="modal-panel component-meta-modal">
            <div class="modal-head">
              <h3>${deps.escapeHtml(rowModal.tableName)} / ${deps.escapeHtml(String(rowModal.rowId))}</h3>
              <div class="modal-head-actions">
                ${rowModal.readOnly
                  ? ''
                  : `<div class="editor-mode-toggle">
                      <button type="button" class="${rowModal.mode === 'basic' ? 'secondary' : 'ghost'}" data-modal-action="sqlite-row-component-mode" data-modal-mode="basic">Basic</button>
                      <button type="button" class="${rowModal.mode === 'advanced' ? 'secondary' : 'ghost'}" data-modal-action="sqlite-row-component-mode" data-modal-mode="advanced">Advanced</button>
                      <button type="button" class="${rowModal.mode === 'raw' ? 'secondary' : 'ghost'}" data-modal-action="sqlite-row-component-mode" data-modal-mode="raw">Raw</button>
                    </div>`}
                <button type="button" data-modal-action="close">Close</button>
              </div>
            </div>
            <p class="muted">
              ${rowModal.readOnly
                ? 'Component(s) attached to this row.'
                : 'Add component(s) to this row.'}
            </p>
            ${rowModal.error ? `<div class="raw-editor-error" role="alert">${deps.escapeHtml(rowModal.error)}</div>` : ''}
            ${
              rowModal.readOnly
                ? ''
                : rowModal.mode === 'raw'
                ? `<label>
                    <span>Attached HVY</span>
                    <textarea id="sqliteRowComponentRawInput" class="raw-editor-textarea" spellcheck="false">${deps.escapeHtml(rowModal.rawDraft)}</textarea>
                  </label>
                  <div class="link-inline-actions reusable-save-actions">
                    <button type="button" class="ghost" data-modal-action="close">Cancel</button>
                    <button type="button" class="ghost" data-modal-action="sqlite-row-component-clear">Remove</button>
                    <button type="button" class="secondary" data-modal-action="sqlite-row-component-save">Save</button>
                  </div>`
                : attachedBlocks.length > 0
                ? `<div class="sqlite-row-component-modal-stack">
                    ${attachedBlocks.map((block) => deps.renderEditorBlock(rowModal.sectionKey, block)).join('')}
                  </div>
                  <article class="ghost-section-card add-ghost sqlite-row-component-ghost" data-action="sqlite-row-component-add-block" data-section-key="${deps.escapeAttr(
                    rowModal.sectionKey
                  )}">
                    <div class="ghost-plus-big"><span>+</span></div>
                    <div class="ghost-label">Add Component</div>
                    <label class="ghost-component-picker">
                      <select
                        aria-label="Row component type"
                        data-field="row-details-new-component-type"
                        data-row-details-key="${deps.escapeAttr(addKey)}"
                      >
                        <option value=""${!(state.addComponentBySection[addKey] ?? '').trim() ? ' selected' : ''}>Select component</option>
                        ${deps.renderComponentOptions(state.addComponentBySection[addKey] ?? '')}
                      </select>
                    </label>
                  </article>
                  <div class="link-inline-actions reusable-save-actions">
                    <button type="button" class="ghost" data-modal-action="close">Cancel</button>
                    <button type="button" class="ghost" data-modal-action="sqlite-row-component-clear">Remove</button>
                    <button type="button" class="secondary" data-modal-action="sqlite-row-component-save">Save</button>
                  </div>`
                : `<article class="ghost-section-card add-ghost sqlite-row-component-ghost" data-action="sqlite-row-component-add-block" data-section-key="${deps.escapeAttr(
                    state.sqliteRowComponentModal.sectionKey
                  )}">
                    <div class="ghost-plus-big"><span>+</span></div>
                    <div class="ghost-label">Add Component</div>
                    <label class="ghost-component-picker">
                      <select
                        aria-label="Row component type"
                        data-field="row-details-new-component-type"
                        data-row-details-key="${deps.escapeAttr(addKey)}"
                      >
                        <option value=""${!(state.addComponentBySection[addKey] ?? '').trim() ? ' selected' : ''}>Select component</option>
                        ${deps.renderComponentOptions(state.addComponentBySection[addKey] ?? '')}
                      </select>
                    </label>
                  </article>
                  <div class="link-inline-actions reusable-save-actions">
                    <button type="button" class="ghost" data-modal-action="close">Cancel</button>
                  </div>`
            }
            ${
              (rowModal.mode === 'raw' ? rawPreviewBlocks : attachedBlocks).length > 0
                ? (rowModal.mode === 'raw' ? rawPreviewBlocks : attachedBlocks)
                    .map(
                      (block) => `<div class="reader-block slot-center" style="${deps.escapeAttr(sanitizeInlineCss(block.schema.customCss))}">
                        ${renderReaderBlock(section, block)}
                      </div>`
                    )
                    .join('')
                : rowModal.readOnly
                ? '<div class="plugin-placeholder">No attached component found for this row.</div>'
                : rowModal.mode === 'raw'
                ? '<div class="plugin-placeholder">Enter valid HVY fragments to preview them here.</div>'
                : ''
            }
          </section>
        </div>
      `;
    }

    if (!state.modalSectionKey) {
      return '';
    }

    const section = deps.findSectionByKey(state.documentSections, state.modalSectionKey);
    if (!section) {
      return '';
    }

    return `
      <div id="modalRoot" class="modal-root">
        <div class="modal-overlay" data-modal-action="close-overlay"></div>
        <section class="modal-panel section-meta-modal">
          <div class="modal-head">
            <h3 id="modalTitle">Section Meta: ${deps.escapeHtml(deps.formatSectionTitle(section.title))} <code>#${deps.escapeHtml(
              deps.getSectionId(section)
            )}</code></h3>
            <div class="modal-head-actions">
              <button
                type="button"
                class="ghost lock-toggle-button"
                data-modal-action="toggle-section-lock"
                data-section-key="${deps.escapeAttr(section.key)}"
                aria-pressed="${section.lock ? 'true' : 'false'}"
                title="${section.lock ? 'Unlock schema' : 'Lock schema'}"
                aria-label="${section.lock ? 'Unlock schema' : 'Lock schema'}"
              >${section.lock ? '🔒 Unlock Schema' : '🔓 Lock Schema'}</button>
              <button type="button" data-modal-action="close">Close</button>
            </div>
          </div>
          <p class="muted">Edit section-level metadata and reader styling.</p>
          <div class="modal-field-stack">
            <label>
              <span>Custom ID (optional)</span>
              <input
                data-section-key="${deps.escapeAttr(section.key)}"
                data-field="section-custom-id"
                value="${deps.escapeAttr(section.customId)}"
                placeholder="Blank keeps generated ID"
              />
            </label>
            <label>
              <span>Style via CSS</span>
              <textarea id="modalCssInput">${deps.escapeHtml(section.customCss)}</textarea>
            </label>
            <label>
              <span>Tags</span>
              ${renderTagEditor(
                'section-tags',
                section.tags,
                { sectionKey: section.key, placeholder: 'Add a tag' },
                { escapeAttr: deps.escapeAttr, escapeHtml: deps.escapeHtml }
              )}
            </label>
            <label>
              <span>Description</span>
              <textarea
                rows="3"
                data-section-key="${deps.escapeAttr(section.key)}"
                data-field="section-description"
              >${deps.escapeHtml(section.description)}</textarea>
            </label>
            <div style="display: flex;">
              <label class="checkbox-label">
                <input
                  type="checkbox"
                  data-section-key="${deps.escapeAttr(section.key)}"
                  data-field="section-contained"
                  ${section.contained ? 'checked' : ''}
                />
                Contained
              </label>
            </div>
          </div>
        </section>
      </div>
    `;
  }

  function renderLinkInlineModal(): string {
    const ids = deps
      .flattenSections(state.documentSections)
      .filter((section) => !section.isGhost)
      .map((section) => `#${deps.getSectionId(section)}`);
    return `
      <div id="linkInlineModal" class="link-inline-modal" aria-hidden="true">
        <div class="link-inline-overlay" data-link-modal-action="cancel"></div>
        <section class="link-inline-panel">
          <h4>Insert Link</h4>
          <label>
            <span>URL or #ID</span>
            <input id="linkInlineInput" list="linkInlineIds" placeholder="https://... or #section-id" />
            <datalist id="linkInlineIds">
              ${ids.map((id) => `<option value="${deps.escapeAttr(id)}"></option>`).join('')}
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
    const duplicateIds = deps.findDuplicateSectionIds(state.documentSections);
    if (duplicateIds.length === 0) {
      return '';
    }
    return duplicateIds
      .map((id) => `<div class="warn">Duplicate section id detected: <code>${deps.escapeHtml(id)}</code></div>`)
      .join('');
  }

  return {
    renderNavigation,
    renderReaderSections,
    renderSidebarSections,
    renderReaderSection,
    renderReaderBlock,
    renderModal,
    renderLinkInlineModal,
    renderWarnings,
  };
}
