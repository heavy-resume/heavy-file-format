import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import type { ComponentRenderHelpers } from './component-helpers';
import { renderCodeEditor } from './components/code';
import { renderComponentListEditor } from './components/component-list';
import { renderContainerEditor } from './components/container';
import { renderExpandableEditor } from './components/expandable';
import { renderGridEditor } from './components/grid';
import { renderPluginEditor } from './components/plugin';
import { renderTableEditor } from './components/table';
import { renderTextEditor } from './components/text';
import { renderXrefCardEditor } from './components/xref-card';
import { renderTagEditor } from './tag-editor';
import { getTemplateFields, renderTemplateGhosts } from './template';
import type { Align, BlockSchema, VisualBlock, VisualSection } from './types';
import { normalizeMarkdownIndentation } from '../markdown';
import { getPluginDisplayName, isDbTablePluginId } from '../plugins/registry';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import plaintext from 'highlight.js/lib/languages/plaintext';
import python from 'highlight.js/lib/languages/python';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import { areTablesEnabled } from '../reference-config';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('css', css);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);
hljs.registerLanguage('plaintext', plaintext);
hljs.registerLanguage('text', plaintext);
hljs.registerLanguage('txt', plaintext);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);

interface ThemeConfig {
  colors: Record<string, string>;
}

interface ComponentDef {
  name: string;
  baseType: string;
  tags?: string;
  description?: string;
  schema?: BlockSchema;
}

interface SectionDef {
  name: string;
}

interface EditorRenderState {
  documentMeta: Record<string, unknown>;
  showAdvancedEditor: boolean;
  addComponentBySection: Record<string, string>;
  activeEditorBlock: { sectionKey: string; blockId: string } | null;
  expandableEditorPanels: Record<string, { stubOpen: boolean; expandedOpen: boolean }>;
}

interface EditorRenderDeps {
  escapeAttr: (value: string) => string;
  escapeHtml: (value: string) => string;
  flattenSections: (sections: VisualSection[]) => VisualSection[];
  renderReaderBlock: (section: VisualSection, block: VisualBlock) => string;
  renderComponentOptions: (selected: string) => string;
  renderReusableSectionOptions: (selected: string) => string;
  renderOption: (value: string, selected: string) => string;
  resolveBaseComponent: (componentName: string) => string;
  ensureContainerBlocks: (block: VisualBlock) => void;
  ensureComponentListBlocks: (block: VisualBlock) => void;
  ensureExpandableBlocks: (block: VisualBlock) => void;
  ensureGridItems: (schema: BlockSchema) => void;
  isActiveEditorSectionTitle: (sectionKey: string) => boolean;
  isActiveEditorBlock: (sectionKey: string, blockId: string) => boolean;
  isDefaultUntitledSectionTitle: (title: string) => boolean;
  formatSectionTitle: (title: string) => string;
  findSectionByKey: (sections: VisualSection[], key: string) => VisualSection | null;
  getComponentDefs: () => ComponentDef[];
  getSectionDefs: () => SectionDef[];
  getThemeConfig: () => ThemeConfig;
  getComponentRenderHelpers: () => ComponentRenderHelpers;
  isBuiltinComponent: (componentName: string) => boolean;
}

export interface EditorRenderer {
  renderSectionEditorTree: (sections: VisualSection[]) => string;
  renderSidebarEditorSections: (sections: VisualSection[]) => string;
  renderEditorBlock: (sectionKey: string, block: VisualBlock, rootSections?: VisualSection[], parentLocked?: boolean) => string;
  renderPassiveEditorBlock: (sectionKey: string, block: VisualBlock, rootSections?: VisualSection[]) => string;
  renderBlockContentEditor: (sectionKey: string, block: VisualBlock) => string;
  renderRichToolbar: (
    sectionKey: string,
    blockId: string,
    options?: {
      field?: string;
      gridItemId?: string;
      rowIndex?: number;
      includeAlign?: boolean;
      align?: Align;
    }
  ) => string;
  renderMetaPanel: () => string;
  renderComponentFragment: (componentName: string, content: string, block: VisualBlock) => string;
  renderBlockMetaFields: (sectionKey: string, block: VisualBlock) => string;
}

export function createEditorRenderer(state: EditorRenderState, deps: EditorRenderDeps): EditorRenderer {
  function renderSidebarEditorSections(sections: VisualSection[]): string {
    const sidebarSections = sections.filter((s) => !s.isGhost && s.location === 'sidebar');
    if (sidebarSections.length === 0) {
      return '<div class="muted editor-sidebar-empty">Move sections here using the sidebar button.</div>';
    }
    return sidebarSections.map((section) => renderEditorSection(section, sections)).join('');
  }

  function renderSectionEditorTree(sections: VisualSection[]): string {
    const mainSections = sections.filter((s) => s.location !== 'sidebar');
    const sectionCards = mainSections.map((section) => renderEditorSection(section, sections)).join('');
    const flatSections = deps.flattenSections(sections);
    const maxWidth = typeof state.documentMeta.reader_max_width === 'string' ? state.documentMeta.reader_max_width.trim() : '';
    const bodyStyle = maxWidth.length > 0 ? ` style="max-width: ${deps.escapeAttr(maxWidth)};"` : '';
    return `
      <div class="editor-tree-body"${bodyStyle}>
        ${state.showAdvancedEditor
          ? renderTemplateGhosts(getTemplateFields(state.documentMeta), flatSections, { escapeAttr: deps.escapeAttr, escapeHtml: deps.escapeHtml })
          : ''
        }
        ${sectionCards}
        <article class="ghost-section-card add-ghost reusable-section-ghost" data-action="add-top-level-section" data-section-key="__top_level__">
          <div class="ghost-plus-big"><span>+</span></div>
          <div class="ghost-label">Add Section</div>
          <label class="ghost-component-picker">
            <select data-field="reusable-section-type" data-section-key="__top_level__" aria-label="Section type">
              ${deps.renderReusableSectionOptions(state.addComponentBySection.__top_level__ ?? 'blank')}
            </select>
          </label>
        </article>
      </div>
    `;
  }

  function renderEditorSection(section: VisualSection, rootSections: VisualSection[]): string {
    const visibleTitle = deps.formatSectionTitle(section.title);
    const isUntitled = deps.isDefaultUntitledSectionTitle(section.title);
    const titleEditor = deps.isActiveEditorSectionTitle(section.key)
      ? `<input autofocus class="section-title-input" data-section-key="${deps.escapeAttr(section.key)}" data-field="section-title" value="${deps.escapeAttr(
        deps.isDefaultUntitledSectionTitle(section.title) ? '' : section.title
      )}" />`
      : `<button type="button" class="section-title-passive${isUntitled ? ' section-title-placeholder' : ''}" data-action="activate-section-title" data-section-key="${deps.escapeAttr(
        section.key
      )}">${deps.escapeHtml(visibleTitle)}</button>`;
    return `
      <article class="editor-section-card" data-editor-section="${deps.escapeAttr(section.key)}">
        <div class="editor-section-head">
          <div class="section-drag-title" title="Drag to reorder section">
            <div class="editor-order-controls">
              <button type="button" class="order-arrow-button" data-action="move-section-up" data-section-key="${deps.escapeAttr(section.key)}" aria-label="Move section up">▲</button>
              <button type="button" class="order-arrow-button" data-action="move-section-down" data-section-key="${deps.escapeAttr(section.key)}" aria-label="Move section down">▼</button>
              <button type="button" class="section-drag-handle" draggable="true" data-drag-handle="section" data-section-key="${deps.escapeAttr(
      section.key
    )}" aria-label="Drag to reorder section">⋮⋮</button>
            </div>
            ${titleEditor}
          </div>
          <div class="editor-actions">
            ${state.showAdvancedEditor
        ? `<button type="button" class="ghost" data-action="open-save-section-def" data-section-key="${deps.escapeAttr(section.key)}">Reusable</button>
                   <button type="button" class="ghost" data-action="focus-modal" data-section-key="${deps.escapeAttr(section.key)}">Meta</button>`
        : ''
      }
            <button type="button" class="${section.location === 'sidebar' ? 'secondary' : 'ghost'}" data-action="toggle-section-location" data-section-key="${deps.escapeAttr(section.key)}">${section.location === 'sidebar' ? 'main \u2192' : '\u2190 sidebar'}</button>
            <button type="button" class="danger" data-action="remove-section" data-section-key="${deps.escapeAttr(section.key)}">Remove</button>
          </div>
        </div>

        ${state.showAdvancedEditor
        ? `<div class="editor-row">
                <label class="checkbox-label"><input type="checkbox" data-section-key="${deps.escapeAttr(section.key)}" data-field="section-highlight" ${section.highlight ? 'checked' : ''
        } /> Highlight</label>
              </div>`
        : ''
      }

        <div class="editor-blocks">
          ${section.blocks.map((block) => renderEditorBlock(section.key, block, rootSections)).join('')}
          ${section.lock
        ? ''
        : `<article class="ghost-section-card add-ghost" data-action="add-block" data-section-key="${deps.escapeAttr(section.key)}">
                  <div class="ghost-plus-big"><span>+</span></div>
                  <div class="ghost-label">Add Component</div>
                  <label class="ghost-component-picker">
                    <select aria-label="Section component type" data-field="new-component-type" data-section-key="${deps.escapeAttr(section.key)}">
                      <option value=""${!(state.addComponentBySection[section.key] ?? '').trim() ? ' selected' : ''}>Select component</option>
                      ${deps.renderComponentOptions(state.addComponentBySection[section.key] ?? '')}
                    </select>
                  </label>
                </article>`
      }
        </div>

        <div class="editor-children">
          ${section.children.map((child) => renderEditorSection(child, rootSections)).join('')}
          ${section.lock
        ? ''
        : `<article class="ghost-section-card add-ghost reusable-section-ghost subsection-add-button" data-action="add-subsection" data-section-key="${deps.escapeAttr(section.key)}">
                  <div class="ghost-plus-big"><span>+</span></div>
                  <div class="ghost-label">Add Section</div>
                  <label class="ghost-component-picker">
                    <select data-field="reusable-section-type" data-section-key="${deps.escapeAttr(`subsection:${section.key}`)}" aria-label="Subsection type">
                      ${deps.renderReusableSectionOptions(state.addComponentBySection[`subsection:${section.key}`] ?? 'blank')}
                    </select>
                  </label>
                </article>`
      }
        </div>
      </article>
    `;
  }

  function isDescendantActive(block: VisualBlock, targetBlockId: string): boolean {
    if (!block.schema) return false;
    if (Array.isArray(block.schema.containerBlocks)) {
      for (const child of block.schema.containerBlocks) {
        if (child.id === targetBlockId || isDescendantActive(child, targetBlockId)) return true;
      }
    }
    if (Array.isArray(block.schema.componentListBlocks)) {
      for (const child of block.schema.componentListBlocks) {
        if (child.id === targetBlockId || isDescendantActive(child, targetBlockId)) return true;
      }
    }
    if (Array.isArray(block.schema.expandableStubBlocks?.children)) {
      for (const child of block.schema.expandableStubBlocks.children) {
        if (child.id === targetBlockId || isDescendantActive(child, targetBlockId)) return true;
      }
    }
    if (Array.isArray(block.schema.expandableContentBlocks?.children)) {
      for (const child of block.schema.expandableContentBlocks.children) {
        if (child.id === targetBlockId || isDescendantActive(child, targetBlockId)) return true;
      }
    }
    if (Array.isArray(block.schema.gridItems)) {
      for (const item of block.schema.gridItems) {
        if (item.block.id === targetBlockId || isDescendantActive(item.block, targetBlockId)) return true;
      }
    }
    return false;
  }

  function renderEditorBlock(sectionKey: string, block: VisualBlock, rootSections?: VisualSection[], parentLocked = false): string {
    const component = block.schema.component || 'text';
    const componentLabel = component === 'plugin'
      ? (isDbTablePluginId(block.schema.plugin) || block.schema.plugin.trim().length === 0 ? getPluginDisplayName(block.schema.plugin || 'dev.heavy.db-table') : 'Plugin')
      : component;
    const isActiveSelf = deps.isActiveEditorBlock(sectionKey, block.id);
    const isActiveDescendant = state.activeEditorBlock?.sectionKey === sectionKey && isDescendantActive(block, state.activeEditorBlock.blockId);
    const isActive = isActiveSelf || isActiveDescendant;

    if (!isActive) {
      return renderPassiveEditorBlock(sectionKey, block, rootSections ?? []);
    }

    const contentEditor = renderBlockContentEditor(sectionKey, block);
    const canRemove = !parentLocked && !block.schema.lock;

    return `
      <div class="editor-block">
        <div class="editor-block-head">
          <div class="section-drag-title">
            <div class="editor-order-controls">
              <button type="button" class="order-arrow-button" data-action="move-block-up" data-section-key="${deps.escapeAttr(sectionKey)}" data-block-id="${deps.escapeAttr(block.id)}" aria-label="Move block up">▲</button>
              <button type="button" class="order-arrow-button" data-action="move-block-down" data-section-key="${deps.escapeAttr(sectionKey)}" data-block-id="${deps.escapeAttr(block.id)}" aria-label="Move block down">▼</button>
            </div>
            <strong class="editor-block-title">${deps.escapeHtml(componentLabel)}</strong>
          </div>
          <div class="editor-actions">
            <button type="button" class="ghost" data-action="deactivate-block" data-section-key="${deps.escapeAttr(
      sectionKey
    )}" data-block-id="${deps.escapeAttr(block.id)}">Done</button>
            ${state.showAdvancedEditor
        ? `<button type="button" class="ghost" data-action="open-save-component-def" data-section-key="${deps.escapeAttr(
          sectionKey
        )}" data-block-id="${deps.escapeAttr(block.id)}">Reusable</button>
                   <button type="button" class="ghost" data-action="open-component-meta" data-section-key="${deps.escapeAttr(
          sectionKey
        )}" data-block-id="${deps.escapeAttr(block.id)}">Meta</button>`
        : ''
      }
            ${canRemove ? `<button type="button" class="danger remove-x" data-action="remove-block" data-section-key="${deps.escapeAttr(
        sectionKey
      )}" data-block-id="${deps.escapeAttr(block.id)}">×</button>` : ''}
          </div>
        </div>

        ${contentEditor}
      </div>
    `;
  }

  function renderPassiveEditorBlock(sectionKey: string, block: VisualBlock, rootSections: VisualSection[]): string {
    const section = deps.findSectionByKey(rootSections, sectionKey);
    if (!section) {
      return '';
    }
    return `
      <div class="editor-block-passive" data-action="activate-block" data-section-key="${deps.escapeAttr(sectionKey)}" data-block-id="${deps.escapeAttr(
      block.id
    )}">
        ${renderPassiveEditorBlockContent(sectionKey, section, block, rootSections)}
      </div>
    `;
  }

  function renderPassiveEditorBlockContent(
    sectionKey: string,
    section: VisualSection,
    block: VisualBlock,
    rootSections: VisualSection[]
  ): string {
    const base = deps.resolveBaseComponent(block.schema.component);

    if (base === 'container') {
      deps.ensureContainerBlocks(block);
      const body = block.schema.containerBlocks.map((innerBlock) => renderPassiveEditorBlock(sectionKey, innerBlock, rootSections)).join('');
      return body ? `<div class="reader-container-body">${body}</div>` : '';
    }

    if (base === 'expandable') {
      deps.ensureExpandableBlocks(block);
      const expanded = block.schema.expandableExpanded;
      const alwaysShowStub = block.schema.expandableAlwaysShowStub;
      const stubPaneStyle = deps.escapeAttr(block.schema.expandableStubCss);
      const contentPaneStyle = deps.escapeAttr(block.schema.expandableContentCss);
      const stubHtml = block.schema.expandableStubBlocks.children
        .map((innerBlock) => renderPassiveEditorBlock(sectionKey, innerBlock, rootSections))
        .join('');
      const contentHtml = block.schema.expandableContentBlocks.children
        .map((innerBlock) => renderPassiveEditorBlock(sectionKey, innerBlock, rootSections))
        .join('');
      const stubToggle = `<div class="expandable-pane expandable-pane-stub"><div class="expand-stub-toggle" style="${stubPaneStyle}" data-action="toggle-editor-expandable" data-section-key="${deps.escapeAttr(
        sectionKey
      )}" data-block-id="${deps.escapeAttr(block.id)}" aria-expanded="${expanded ? 'true' : 'false'}"><div class="expand-stub">${stubHtml}</div></div></div>`;
      const expandedPanel = `<div class="expandable-pane expandable-pane-expanded"><div class="expand-content" style="${contentPaneStyle}">${contentHtml}</div></div>`;
      const body = expanded
        ? alwaysShowStub
          ? `${stubToggle}${expandedPanel}`
          : `${expandedPanel}<div class="expand-collapse-strip" data-action="toggle-editor-expandable" data-section-key="${deps.escapeAttr(
            sectionKey
          )}" data-block-id="${deps.escapeAttr(block.id)}" aria-expanded="true">Collapse</div>`
        : stubToggle;

      return `<div class="expandable-reader is-interactive">
        <div class="expandable-reader-body">${body}</div>
      </div>`;
    }

    if (base === 'component-list') {
      deps.ensureComponentListBlocks(block);
      if (block.schema.componentListBlocks.length === 0) {
        return `<div class="ghost-section-card add-ghost passive-empty-list-ghost">
          <div class="ghost-label">Edit Component List (${deps.escapeHtml(block.schema.componentListComponent || 'item')})</div>
        </div>`;
      }
    }

    if (base === 'grid') {
      deps.ensureGridItems(block.schema);
      const columns = Math.max(1, Math.min(6, block.schema.gridColumns));
      const cells = block.schema.gridItems
        .map((item, index) => {
          const columnIndex = columns <= 1 ? 1 : (index % columns) + 1;
          const gridColumn = columns <= 1 ? '1 / -1' : `${columnIndex} / span 1`;
          return `<div class="reader-grid-cell is-passive-grid-cell" style="grid-column: ${deps.escapeAttr(gridColumn)};">${renderPassiveEditorBlock(
            sectionKey,
            item.block,
            rootSections
          )}</div>`;
        })
        .join('');
      return `<div class="reader-grid-layout editor-grid-passive-preview" style="grid-template-columns: repeat(${columns}, minmax(0, 1fr));">${cells}</div>`;
    }

    if ((base === 'text' || base === 'quote') && block.text.trim().length === 0) {
      const hint = block.schema.placeholder || (base === 'quote' ? 'Empty quote...' : 'Empty text...');
      const content = block.schema.placeholder
        ? renderComponentFragment('text', hint, block)
        : deps.escapeHtml(hint);
      const alignStyle = block.schema.align ? ` style="text-align: ${deps.escapeAttr(block.schema.align)};"` : '';
      return `<div class="editor-passive-empty-text${block.schema.placeholder ? ' has-placeholder' : ''}"${alignStyle}>${content}</div>`;
    }

    return deps.renderReaderBlock(section, block);
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
    const fieldAttr = options?.field ? ` data-rich-field="${deps.escapeAttr(options.field)}"` : '';
    const gridAttr = options?.gridItemId ? ` data-grid-item-id="${deps.escapeAttr(options.gridItemId)}"` : '';
    const rowAttr = typeof options?.rowIndex === 'number' ? ` data-row-index="${options.rowIndex}"` : '';
    const alignControls =
      options?.includeAlign && options.align
        ? `<div class="toolbar-segment align-buttons" role="group" aria-label="Text alignment">
            <button type="button" class="${options.align === 'left' ? 'secondary' : 'ghost'}" data-action="set-block-align" data-align-value="left" data-section-key="${deps.escapeAttr(
          sectionKey
        )}" data-block-id="${deps.escapeAttr(blockId)}">Left</button>
            <button type="button" class="${options.align === 'center' ? 'secondary' : 'ghost'}" data-action="set-block-align" data-align-value="center" data-section-key="${deps.escapeAttr(
          sectionKey
        )}" data-block-id="${deps.escapeAttr(blockId)}">Center</button>
            <button type="button" class="${options.align === 'right' ? 'secondary' : 'ghost'}" data-action="set-block-align" data-align-value="right" data-section-key="${deps.escapeAttr(
          sectionKey
        )}" data-block-id="${deps.escapeAttr(blockId)}">Right</button>
          </div>`
        : '';
    return `
      <div class="rich-toolbar">
        ${alignControls}
        <div class="toolbar-segment format-buttons" role="group" aria-label="Text formatting">
          <button type="button" data-rich-action="paragraph"${fieldAttr}${gridAttr}${rowAttr} data-section-key="${deps.escapeAttr(sectionKey)}" data-block-id="${deps.escapeAttr(blockId)}" title="Normal text">Text</button>
          <button type="button" data-rich-action="heading-1"${fieldAttr}${gridAttr}${rowAttr} data-section-key="${deps.escapeAttr(sectionKey)}" data-block-id="${deps.escapeAttr(blockId)}" title="Heading 1">H1</button>
          <button type="button" data-rich-action="heading-2"${fieldAttr}${gridAttr}${rowAttr} data-section-key="${deps.escapeAttr(sectionKey)}" data-block-id="${deps.escapeAttr(blockId)}" title="Heading 2">H2</button>
          <button type="button" data-rich-action="heading-3"${fieldAttr}${gridAttr}${rowAttr} data-section-key="${deps.escapeAttr(sectionKey)}" data-block-id="${deps.escapeAttr(blockId)}" title="Heading 3">H3</button>
          <button type="button" data-rich-action="heading-4"${fieldAttr}${gridAttr}${rowAttr} data-section-key="${deps.escapeAttr(sectionKey)}" data-block-id="${deps.escapeAttr(blockId)}" title="Heading 4">H4</button>
          <button type="button" data-rich-action="bold"${fieldAttr}${gridAttr}${rowAttr} data-section-key="${deps.escapeAttr(sectionKey)}" data-block-id="${deps.escapeAttr(blockId)}" title="Bold (Ctrl/Cmd+B)"><strong>B</strong></button>
          <button type="button" data-rich-action="italic"${fieldAttr}${gridAttr}${rowAttr} data-section-key="${deps.escapeAttr(sectionKey)}" data-block-id="${deps.escapeAttr(blockId)}" title="Italic (Ctrl/Cmd+I)">Italic</button>
          <button type="button" data-rich-action="list"${fieldAttr}${gridAttr}${rowAttr} data-section-key="${deps.escapeAttr(sectionKey)}" data-block-id="${deps.escapeAttr(blockId)}" title="Bullet List">List</button>
          <button type="button" data-rich-action="checklist"${fieldAttr}${gridAttr}${rowAttr} data-section-key="${deps.escapeAttr(sectionKey)}" data-block-id="${deps.escapeAttr(blockId)}" title="Checkbox">Checkbox</button>
          <button type="button" data-rich-action="link"${fieldAttr}${gridAttr}${rowAttr} data-section-key="${deps.escapeAttr(sectionKey)}" data-block-id="${deps.escapeAttr(blockId)}" title="Link (Ctrl/Cmd+K)">Link</button>
        </div>
      </div>
    `;
  }

  function renderMetaPanel(): string {
    const defs = deps.getComponentDefs();
    const sectionDefs = deps.getSectionDefs();
    const theme = deps.getThemeConfig();
    const colorCount = Object.keys(theme.colors).length;
    const tableBaseTypeOption = areTablesEnabled() || defs.some((def) => def.baseType === 'table');
    return `
      <section class="meta-panel">
        <div class="meta-panel-head">
          <strong>Document Meta</strong>
        </div>
        <label>
          <span>Title</span>
          <input data-field="meta-title" value="${deps.escapeAttr(String(state.documentMeta.title ?? ''))}" />
        </label>
        <label>
          <span>Sidebar Label</span>
          <input data-field="meta-sidebar-label" placeholder="☰" value="${deps.escapeAttr(String(state.documentMeta.sidebar_label ?? ''))}" />
        </label>
        <label>
          <span>Reader Max Width</span>
          <input data-field="meta-reader-max-width" placeholder="60rem" value="${deps.escapeAttr(String(state.documentMeta.reader_max_width ?? ''))}" />
        </label>
        <label class="checkbox-label">
          <span>Tables Enabled</span>
          <input type="checkbox" ${areTablesEnabled() ? 'checked' : ''} disabled />
        </label>
        <div class="muted">Reference app feature flag. This is not stored in the HVY file.</div>
        <div class="editor-grid">
          <label>
            <span>Theme Colors</span>
            <button type="button" class="ghost" data-action="open-theme-modal">
              Edit Colors${colorCount > 0 ? ` (${colorCount} override${colorCount === 1 ? '' : 's'})` : ''}
            </button>
          </label>
        </div>
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
                  <input data-field="def-name" data-def-index="${index}" value="${deps.escapeAttr(def.name)}" />
                </label>
                <label>
                  <span>Base Type</span>
                  <select data-field="def-base" data-def-index="${index}">
                    ${deps.renderOption('text', def.baseType)}
                    ${deps.renderOption('quote', def.baseType)}
                    ${deps.renderOption('code', def.baseType)}
                    ${deps.renderOption('expandable', def.baseType)}
                    ${tableBaseTypeOption ? deps.renderOption('table', def.baseType) : ''}
                    ${deps.renderOption('container', def.baseType)}
                    ${deps.renderOption('component-list', def.baseType)}
                    ${deps.renderOption('grid', def.baseType)}
                    ${deps.renderOption('plugin', def.baseType)}
                    ${deps.renderOption('xref-card', def.baseType)}
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
            { escapeAttr: deps.escapeAttr, escapeHtml: deps.escapeHtml }
          )}
                </label>
                <label>
                  <span>Description</span>
                  <textarea rows="3" data-field="def-description" data-def-index="${index}">${deps.escapeHtml(def.description ?? '')}</textarea>
                </label>
                <button type="button" class="danger" data-action="remove-component-def" data-def-index="${index}">Remove</button>
              </article>`
        )
        .join('')}
        </div>
        <div class="meta-panel-head">
          <strong>Reusable Sections</strong>
        </div>
        <div class="component-defs">
          ${sectionDefs.length === 0
        ? '<div class="muted">Save a section as reusable from its header to make it available here and in the add-section controls.</div>'
        : sectionDefs
          .map(
            (def, index) => `<article class="component-def">
                      <label>
                        <span>Name</span>
                        <input data-field="section-def-name" data-section-def-index="${index}" value="${deps.escapeAttr(def.name)}" />
                      </label>
                      <button type="button" class="danger" data-action="remove-section-def" data-section-def-index="${index}">Remove</button>
                    </article>`
          )
          .join('')
      }
        </div>
      </section>
    `;
  }

  function renderBlockContentEditor(sectionKey: string, block: VisualBlock): string {
    const component = deps.resolveBaseComponent(block.schema.component);
    const helpers = deps.getComponentRenderHelpers();

    if (component === 'code') {
      return renderCodeEditor(sectionKey, block, helpers);
    }
    if (component === 'plugin') {
      return renderPluginEditor(sectionKey, block, helpers);
    }
    if (component === 'container') {
      return renderContainerEditor(sectionKey, block, helpers);
    }
    if (component === 'component-list') {
      deps.ensureComponentListBlocks(block);
      return renderComponentListEditor(sectionKey, block, helpers);
    }
    if (component === 'grid') {
      deps.ensureGridItems(block.schema);
      return renderGridEditor(sectionKey, block, helpers);
    }
    if (component === 'expandable') {
      deps.ensureExpandableBlocks(block);
      return renderExpandableEditor(sectionKey, block, helpers);
    }
    if (component === 'table') {
      if (!areTablesEnabled()) {
        return '<div class="plugin-placeholder">Tables are disabled in this reference implementation.</div>';
      }
      return renderTableEditor(sectionKey, block, helpers);
    }
    if (component === 'xref-card') {
      return renderXrefCardEditor(sectionKey, block, helpers);
    }
    return renderTextEditor(sectionKey, block, helpers);
  }

  function renderBlockMetaFields(sectionKey: string, block: VisualBlock): string {
    const component = deps.resolveBaseComponent(block.schema.component);
    return `
      <div class="schema-meta-stack">
        <label>
          <span>Custom CSS</span>
          <textarea
            rows="2"
            data-section-key="${deps.escapeAttr(sectionKey)}"
            data-block-id="${deps.escapeAttr(block.id)}"
            data-field="block-custom-css"
            placeholder="margin: 0.5rem 0;"
          >${deps.escapeHtml(block.schema.customCss)}</textarea>
        </label>
        ${
          component === 'expandable'
            ? `<label>
          <span>Expandable Stub CSS</span>
          <textarea
            rows="2"
            data-section-key="${deps.escapeAttr(sectionKey)}"
            data-block-id="${deps.escapeAttr(block.id)}"
            data-field="block-expandable-stub-css"
            placeholder="padding: 0.35rem 0;"
          >${deps.escapeHtml(block.schema.expandableStubCss)}</textarea>
        </label>
        <label>
          <span>Expandable Content CSS</span>
          <textarea
            rows="2"
            data-section-key="${deps.escapeAttr(sectionKey)}"
            data-block-id="${deps.escapeAttr(block.id)}"
            data-field="block-expandable-content-css"
            placeholder="padding-top: 0.35rem;"
          >${deps.escapeHtml(block.schema.expandableContentCss)}</textarea>
        </label>`
            : ''
        }
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
      { escapeAttr: deps.escapeAttr, escapeHtml: deps.escapeHtml }
    )}
        </label>
        <label>
          <span>Placeholder</span>
          <input
            data-section-key="${deps.escapeAttr(sectionKey)}"
            data-block-id="${deps.escapeAttr(block.id)}"
            data-field="block-placeholder"
            placeholder="Shown when block is empty"
            value="${deps.escapeAttr(block.schema.placeholder)}"
          />
        </label>
        <label>
          <span>Description</span>
          <textarea
            rows="3"
            data-section-key="${deps.escapeAttr(sectionKey)}"
            data-block-id="${deps.escapeAttr(block.id)}"
            data-field="block-description"
          >${deps.escapeHtml(block.schema.description)}</textarea>
        </label>
      </div>
    `;
  }

  function renderComponentFragment(componentName: string, content: string, block: VisualBlock): string {
    const base = deps.resolveBaseComponent(componentName);
    const normalized = escapeRawHtml(normalizeMarkdownIndentation(normalizeMarkdownLists(content)));
    if (base === 'quote') {
      if (content.trim().length === 0) {
        return '';
      }
      return `<blockquote>${unwrapSingleParagraph(addExternalLinkTargets(DOMPurify.sanitize(marked.parse(normalized) as string)))}</blockquote>`;
    }
    if (base === 'code') {
      const language = (block.schema.codeLanguage || 'text').trim() || 'text';
      const highlighted = highlightCode(content, language, deps.escapeHtml);
      return `<div class="reader-code-block">
        <div class="reader-code-head">
          <span class="reader-code-language">${deps.escapeHtml(language)}</span>
        </div>
        <pre><code class="hljs language-${deps.escapeAttr(language)}">${highlighted}</code></pre>
      </div>`;
    }
    return unwrapSingleParagraph(addExternalLinkTargets(DOMPurify.sanitize(marked.parse(normalized) as string)));
  }

  return {
    renderSectionEditorTree,
    renderSidebarEditorSections,
    renderEditorBlock: (sectionKey, block, rootSections, parentLocked) => renderEditorBlock(sectionKey, block, rootSections, parentLocked),
    renderPassiveEditorBlock: (sectionKey, block, rootSections) => renderPassiveEditorBlock(sectionKey, block, rootSections ?? []),
    renderBlockContentEditor: (sectionKey, block) => renderBlockContentEditor(sectionKey, block),
    renderRichToolbar,
    renderMetaPanel,
    renderComponentFragment,
    renderBlockMetaFields,
  };
}

function normalizeMarkdownLists(markdown: string): string {
  return markdown.replace(/(^|\n)(- .+(?:\n- .+)*)/g, (_match, prefix, list) => {
    const normalized = list
      .split('\n')
      .map((line: string) => line.trim())
      .join('\n');
    return `${prefix}${normalized}`;
  });
}

function escapeRawHtml(markdown: string): string {
  return markdown.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightCode(code: string, language: string, escapeHtml: (value: string) => string): string {
  if (code.trim().length === 0) {
    return '';
  }
  const normalizedLanguage = language.trim().toLowerCase();
  try {
    if (normalizedLanguage && hljs.getLanguage(normalizedLanguage)) {
      return DOMPurify.sanitize(hljs.highlight(code, { language: normalizedLanguage }).value);
    }
    return DOMPurify.sanitize(hljs.highlightAuto(code).value);
  } catch {
    return escapeHtml(code);
  }
}

function unwrapSingleParagraph(html: string): string {
  const trimmed = html.trim();
  const match = trimmed.match(/^<p>([\s\S]*)<\/p>$/);
  if (!match) {
    return html;
  }
  const inner = match[1] ?? '';
  if (/<\/?(p|div|blockquote|pre|ul|ol|li|table|h[1-6])\b/i.test(inner)) {
    return html;
  }
  return inner;
}

function addExternalLinkTargets(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  template.content.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
    const href = anchor.getAttribute('href') ?? '';
    if (/^https?:\/\//i.test(href)) {
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
    }
  });
  return template.innerHTML;
}
