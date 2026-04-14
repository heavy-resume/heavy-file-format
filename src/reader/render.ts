import { renderCodeReader } from '../editor/components/code';
import { renderContainerReader } from '../editor/components/container';
import { renderExpandableReader } from '../editor/components/expandable';
import { renderGridReader } from '../editor/components/grid';
import { renderPluginReader } from '../editor/components/plugin';
import { renderTableReader } from '../editor/components/table';
import { renderTextReader } from '../editor/components/text';
import type { ComponentRenderHelpers } from '../editor/component-helpers';
import type { BlockSchema, VisualBlock, VisualSection } from '../editor/types';

interface ReaderRenderState {
  documentSections: VisualSection[];
  tempHighlights: Set<string>;
  modalSectionKey: string | null;
  componentMetaModal: { sectionKey: string; blockId: string } | null;
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
  renderBlockMetaFields: (sectionKey: string, block: VisualBlock) => string;
}

export interface ReaderRenderer {
  renderNavigation: (sections: VisualSection[]) => string;
  renderReaderSections: (sections: VisualSection[]) => string;
  renderReaderSection: (section: VisualSection) => string;
  renderReaderBlock: (section: VisualSection, block: VisualBlock) => string;
  renderModal: () => string;
  renderLinkInlineModal: () => string;
  renderWarnings: () => string;
}

export function createReaderRenderer(state: ReaderRenderState, deps: ReaderRenderDeps): ReaderRenderer {
  function renderNavigation(sections: VisualSection[]): string {
    const items = deps.flattenSections(sections).filter((section) => !section.isGhost);
    if (items.length === 0) {
      return '<div class="muted">Navigation will appear when sections exist.</div>';
    }

    return `
      <div class="nav-title">Navigation</div>
      <div class="nav-list">
        ${items
          .map(
            (section) =>
              `<button type="button" class="nav-item" data-nav-id="${deps.escapeAttr(deps.getSectionId(section))}">${deps.escapeHtml(
                deps.formatSectionTitle(section.title)
              )} <code>#${deps.escapeHtml(deps.getSectionId(section))}</code></button>`
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
    const effectiveId = deps.getSectionId(section);
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
      <section id="${deps.escapeAttr(effectiveId)}" class="${classList}" style="${deps.escapeAttr(section.customCss)}">
        <header class="reader-section-head">
          <h${Math.min(Math.max(section.level, 1), 6)}>${deps.escapeHtml(deps.formatSectionTitle(section.title))}</h${Math.min(
            Math.max(section.level, 1),
            6
          )}>
          <div class="reader-head-actions">
            <button type="button" class="tiny" data-reader-action="toggle-expand" data-section-key="${deps.escapeAttr(section.key)}">${
      section.expanded ? '−' : '+'
    }</button>
          </div>
        </header>
        ${content}
      </section>
    `;
  }

  function renderReaderBlock(section: VisualSection, block: VisualBlock): string {
    const base = deps.resolveBaseComponent(block.schema.component);
    const blockAttrs = `class="reader-block reader-block-${deps.escapeAttr(base)} align-${deps.escapeAttr(block.schema.align)} slot-${deps.escapeAttr(
      block.schema.slot
    )}" data-component="${deps.escapeAttr(block.schema.component)}" style="${deps.escapeAttr(block.schema.customCss)}"`;
    const helpers = deps.getComponentRenderHelpers();

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
      deps.ensureGridItems(block.schema);
      return `<div ${blockAttrs}>${renderGridReader(section, block, helpers)}</div>`;
    }
    if (base === 'expandable') {
      deps.ensureExpandableBlocks(block);
      return `<div ${blockAttrs}>${renderExpandableReader(section, block, helpers)}</div>`;
    }
    if (base === 'table') {
      return `<div ${blockAttrs}>${renderTableReader(section, block, helpers)}</div>`;
    }
    return `<div ${blockAttrs}>${renderTextReader(section, block, helpers)}</div>`;
  }

  function renderModal(): string {
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
              <h3>Component Meta</h3>
              <button type="button" data-modal-action="close">Close</button>
            </div>
            <p class="muted">Meta is optional and can be used by readers, indexing, and plugins.</p>
            ${deps.renderBlockMetaFields(state.componentMetaModal.sectionKey, block)}
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
        <section class="modal-panel">
          <div class="modal-head">
            <h3 id="modalTitle">Meta: ${deps.escapeHtml(deps.formatSectionTitle(section.title))} <code>#${deps.escapeHtml(
              deps.getSectionId(section)
            )}</code></h3>
            <button type="button" data-modal-action="close">Close</button>
          </div>
          <p>Edit section-level metadata and reader styling.</p>
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
            <span>Custom CSS (inline style value)</span>
            <textarea id="modalCssInput">${deps.escapeHtml(section.customCss)}</textarea>
          </label>
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
      return '<div class="ok">No warnings. IDs are unique.</div>';
    }
    return duplicateIds
      .map((id) => `<div class="warn">Duplicate section id detected: <code>${deps.escapeHtml(id)}</code></div>`)
      .join('');
  }

  return {
    renderNavigation,
    renderReaderSections,
    renderReaderSection,
    renderReaderBlock,
    renderModal,
    renderLinkInlineModal,
    renderWarnings,
  };
}
