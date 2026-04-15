import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { ComponentRenderHelpers } from './component-helpers';
import { renderCodeEditor } from './components/code';
import { renderComponentListEditor } from './components/component-list';
import { renderContainerEditor } from './components/container';
import { renderExpandableEditor } from './components/expandable';
import { renderGridEditor } from './components/grid';
import { renderPluginEditor } from './components/plugin';
import { renderTableEditor } from './components/table';
import { renderTextEditor } from './components/text';
import { renderTagEditor } from './tag-editor';
import { getTemplateFields, renderTemplateGhosts } from './template';
import type { Align, BlockSchema, VisualBlock, VisualSection } from './types';

interface ThemeConfig {
  mode: 'light' | 'dark';
  accent: string;
  background: string;
  surface: string;
  text: string;
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
}

interface EditorRenderDeps {
  escapeAttr: (value: string) => string;
  escapeHtml: (value: string) => string;
  flattenSections: (sections: VisualSection[]) => VisualSection[];
  renderReaderBlock: (section: VisualSection, block: VisualBlock) => string;
  renderComponentOptions: (selected: string) => string;
  renderSectionStarterOptions: (selected: string) => string;
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
  renderEditorBlock: (sectionKey: string, block: VisualBlock) => string;
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
  function renderSectionEditorTree(sections: VisualSection[]): string {
    const sectionCards = sections.map((section) => renderEditorSection(section, sections)).join('');
    const flatSections = deps.flattenSections(sections);
    return `
      ${
        state.showAdvancedEditor
          ? renderTemplateGhosts(getTemplateFields(state.documentMeta), flatSections, { escapeAttr: deps.escapeAttr, escapeHtml: deps.escapeHtml })
          : ''
      }
      ${sectionCards}
          <article class="ghost-section-card add-ghost" data-action="add-top-level-section" data-section-key="__top_level__">
        <div class="ghost-plus-big"><span>+</span></div>
        <div class="ghost-label">Add Section</div>
        <label class="ghost-component-picker">
          <span>Starting From</span>
          <select data-field="new-component-type" data-section-key="__top_level__">
            ${deps.renderSectionStarterOptions(state.addComponentBySection.__top_level__ ?? 'container')}
          </select>
        </label>
      </article>
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
            <button type="button" class="section-drag-handle" draggable="true" data-drag-handle="section" data-section-key="${deps.escapeAttr(
              section.key
            )}" aria-label="Drag to reorder section">::</button>
            ${titleEditor}
          </div>
          <div class="editor-actions">
            <button type="button" class="ghost" data-action="jump-to-reader" data-section-key="${deps.escapeAttr(section.key)}">Jump</button>
            ${
              state.showAdvancedEditor
                ? `<button type="button" class="ghost" data-action="open-save-section-def" data-section-key="${deps.escapeAttr(section.key)}">Reusable</button>
                   <button type="button" class="ghost" data-action="focus-modal" data-section-key="${deps.escapeAttr(section.key)}">Meta</button>`
                : ''
            }
            <button type="button" class="danger" data-action="remove-section" data-section-key="${deps.escapeAttr(section.key)}">Remove</button>
          </div>
        </div>

        ${
          state.showAdvancedEditor
            ? `<div class="editor-row">
                <label class="checkbox-label"><input type="checkbox" data-section-key="${deps.escapeAttr(section.key)}" data-field="section-highlight" ${
                section.highlight ? 'checked' : ''
              } /> Highlight</label>
              </div>`
            : ''
        }

        <div class="editor-blocks">
          ${section.blocks.map((block) => renderEditorBlock(section.key, block, rootSections)).join('')}
          <article class="ghost-section-card add-ghost" data-action="add-block" data-section-key="${deps.escapeAttr(section.key)}">
            <div class="ghost-plus-big"><span>+</span></div>
            <div class="ghost-label">Add Component</div>
            <label class="ghost-component-picker">
              <select aria-label="Section component type" data-field="new-component-type" data-section-key="${deps.escapeAttr(section.key)}">
                ${deps.renderComponentOptions(state.addComponentBySection[section.key] ?? 'container')}
              </select>
            </label>
          </article>
        </div>

        <div class="editor-children">
          ${section.children.map((child) => renderEditorSection(child, rootSections)).join('')}
          <div class="subsection-add-row">
            <select data-field="new-component-type" data-section-key="${deps.escapeAttr(`subsection:${section.key}`)}" aria-label="Subsection starter">
              ${deps.renderSectionStarterOptions(state.addComponentBySection[`subsection:${section.key}`] ?? '__empty_section__')}
            </select>
            <button type="button" class="ghost subsection-add-button" data-action="add-subsection" data-section-key="${deps.escapeAttr(section.key)}">+ Add Subsection</button>
          </div>
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
    if (Array.isArray(block.schema.expandableStubBlocks)) {
      for (const child of block.schema.expandableStubBlocks) {
        if (child.id === targetBlockId || isDescendantActive(child, targetBlockId)) return true;
      }
    }
    if (Array.isArray(block.schema.expandableContentBlocks)) {
      for (const child of block.schema.expandableContentBlocks) {
        if (child.id === targetBlockId || isDescendantActive(child, targetBlockId)) return true;
      }
    }
    if (Array.isArray(block.schema.tableRows)) {
      for (const row of block.schema.tableRows) {
        if (Array.isArray(row.detailsBlocks)) {
          for (const child of row.detailsBlocks) {
            if (child.id === targetBlockId || isDescendantActive(child, targetBlockId)) return true;
          }
        }
      }
    }
    return false;
  }

  function renderEditorBlock(sectionKey: string, block: VisualBlock, rootSections?: VisualSection[]): string {
    const component = block.schema.component || 'text';
    const contentEditor = renderBlockContentEditor(sectionKey, block);
    const isActiveSelf = deps.isActiveEditorBlock(sectionKey, block.id);
    const isActiveDescendant = state.activeEditorBlock?.sectionKey === sectionKey && isDescendantActive(block, state.activeEditorBlock.blockId);
    const isActive = isActiveSelf || isActiveDescendant;

    if (!isActive) {
      return renderPassiveEditorBlock(sectionKey, block, rootSections ?? []);
    }

    return `
      <div class="editor-block">
        <div class="editor-block-head">
          <strong class="editor-block-title">${deps.escapeHtml(component)}</strong>
          <div class="editor-actions">
            <button type="button" class="ghost" data-action="deactivate-block" data-section-key="${deps.escapeAttr(
              sectionKey
            )}" data-block-id="${deps.escapeAttr(block.id)}">Done</button>
            ${
              state.showAdvancedEditor
                ? `<button type="button" class="ghost" data-action="open-save-component-def" data-section-key="${deps.escapeAttr(
                    sectionKey
                  )}" data-block-id="${deps.escapeAttr(block.id)}">Reusable</button>
                   <button type="button" class="ghost" data-action="open-component-meta" data-section-key="${deps.escapeAttr(
                    sectionKey
                  )}" data-block-id="${deps.escapeAttr(block.id)}">Meta</button>`
                : ''
            }
            <button type="button" class="danger remove-x" data-action="remove-block" data-section-key="${deps.escapeAttr(
              sectionKey
            )}" data-block-id="${deps.escapeAttr(block.id)}">×</button>
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
      const title = block.schema.containerTitle || 'Container';
      const body = block.schema.containerBlocks.map((innerBlock) => renderPassiveEditorBlock(sectionKey, innerBlock, rootSections)).join('');
      return `<div class="reader-container-title">${deps.escapeHtml(title)}</div>${body ? `<div class="reader-container-body">${body}</div>` : ''}`;
    }

    if (base === 'expandable') {
      deps.ensureExpandableBlocks(block);
      const expanded = block.schema.expandableExpanded;
      const alwaysShowStub = block.schema.expandableAlwaysShowStub;
      const stubHtml = (block.schema.expandableStubBlocks ?? [])
        .map((innerBlock) => renderPassiveEditorBlock(sectionKey, innerBlock, rootSections))
        .join('');
      const contentHtml = (block.schema.expandableContentBlocks ?? [])
        .map((innerBlock) => renderPassiveEditorBlock(sectionKey, innerBlock, rootSections))
        .join('');
      const body = expanded
        ? alwaysShowStub
          ? `<div class="expand-stub-toggle" data-action="toggle-editor-expandable" data-section-key="${deps.escapeAttr(
              sectionKey
            )}" data-block-id="${deps.escapeAttr(block.id)}" aria-expanded="true"><div class="expand-stub">${stubHtml}</div></div><div class="expand-content">${contentHtml}</div>`
          : `<div class="expand-content">${contentHtml}</div><div class="expand-collapse-strip" data-action="toggle-editor-expandable" data-section-key="${deps.escapeAttr(
              sectionKey
            )}" data-block-id="${deps.escapeAttr(block.id)}" aria-expanded="true">Collapse</div>`
        : `<div class="expand-stub-toggle" data-action="toggle-editor-expandable" data-section-key="${deps.escapeAttr(
            sectionKey
          )}" data-block-id="${deps.escapeAttr(block.id)}" aria-expanded="false"><div class="expand-stub">${stubHtml}</div></div>`;

      return `<div class="expandable-reader">
        <div class="expandable-reader-body">${body}</div>
      </div>`;
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
          <button type="button" data-rich-action="link"${fieldAttr}${gridAttr}${rowAttr} data-section-key="${deps.escapeAttr(sectionKey)}" data-block-id="${deps.escapeAttr(blockId)}" title="Link (Ctrl/Cmd+K)">Link</button>
        </div>
      </div>
    `;
  }

  function renderMetaPanel(): string {
    const defs = deps.getComponentDefs();
    const sectionDefs = deps.getSectionDefs();
    const theme = deps.getThemeConfig();
    return `
      <section class="meta-panel">
        <div class="meta-panel-head">
          <strong>Document Meta</strong>
        </div>
        <label>
          <span>Title</span>
          <input data-field="meta-title" value="${deps.escapeAttr(String(state.documentMeta.title ?? ''))}" />
        </label>
        <div class="editor-grid">
          <label>
            <span>Theme Mode</span>
            <select data-field="theme-mode">
              ${deps.renderOption('light', theme.mode)}
              ${deps.renderOption('dark', theme.mode)}
            </select>
          </label>
          <label>
            <span>Theme Accent</span>
            <input data-field="theme-accent" value="${deps.escapeAttr(theme.accent)}" />
          </label>
        </div>
        <div class="editor-grid">
          <label>
            <span>Theme Background</span>
            <input data-field="theme-background" value="${deps.escapeAttr(theme.background)}" />
          </label>
          <label>
            <span>Theme Surface</span>
            <input data-field="theme-surface" value="${deps.escapeAttr(theme.surface)}" />
          </label>
        </div>
        <label>
          <span>Theme Text</span>
          <input data-field="theme-text" value="${deps.escapeAttr(theme.text)}" />
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
                  <input data-field="def-name" data-def-index="${index}" value="${deps.escapeAttr(def.name)}" />
                </label>
                <label>
                  <span>Base Type</span>
                  <select data-field="def-base" data-def-index="${index}">
                    ${deps.renderOption('text', def.baseType)}
                    ${deps.renderOption('quote', def.baseType)}
                    ${deps.renderOption('code', def.baseType)}
                    ${deps.renderOption('expandable', def.baseType)}
                    ${deps.renderOption('table', def.baseType)}
                    ${deps.renderOption('container', def.baseType)}
                    ${deps.renderOption('component-list', def.baseType)}
                    ${deps.renderOption('grid', def.baseType)}
                    ${deps.renderOption('plugin', def.baseType)}
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
          ${
            sectionDefs.length === 0
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
      return renderTableEditor(sectionKey, block, helpers);
    }
    return renderTextEditor(sectionKey, block, helpers);
  }

  function renderBlockMetaFields(sectionKey: string, block: VisualBlock): string {
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
    const normalized = normalizeMarkdownLists(content);
    if (base === 'quote') {
      return `<blockquote>${DOMPurify.sanitize(marked.parse(normalized) as string)}</blockquote>`;
    }
    if (base === 'code') {
      return `<pre><code class="language-${deps.escapeAttr(block.schema.codeLanguage || 'txt')}">${deps.escapeHtml(content)}</code></pre>`;
    }
    return DOMPurify.sanitize(marked.parse(normalized) as string);
  }

  return {
    renderSectionEditorTree,
    renderEditorBlock: (sectionKey, block) => renderEditorBlock(sectionKey, block),
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
