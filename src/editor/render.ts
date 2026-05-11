import './editor.css';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import type { ComponentRenderHelpers } from './component-helpers';
import type { ComponentPlacementState } from '../types';
import { renderComponentListEditor } from './components/component-list/component-list';
import { renderContainerEditor } from './components/container/container';
import { renderExpandableEditor } from './components/expandable/expandable';
import { renderGridEditor } from './components/grid/grid';
import { renderImageEditor } from './components/image/image';
import { renderPluginEditor, getPluginBlockHeaderLabel } from './components/plugin/plugin';
import { renderTableEditor } from './components/table/table';
import { renderTextEditor } from './components/text/text';
import { renderXrefCardEditor } from './components/xref-card/xref-card';
import { getComponentListAddLabel, getComponentListEditLabel, hasComponentListItems } from './components/component-list/component-list-labels';
import { renderTagEditor } from './tag-editor';
import { getTemplateFields, renderTemplateGhosts } from './template';
import type { Align, BlockSchema, SortKeyValue, VisualBlock, VisualSection } from './types';
import { markdownToReaderHtml, normalizeMarkdownIndentation, normalizeMarkdownLists } from '../markdown';
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
import { sanitizeInlineCss } from '../css-sanitizer';
import { SCRIPTING_PLUGIN_ID } from '../plugins/registry';
import { getScriptingPluginVersion } from '../plugins/scripting/version';
import { renderAddComponentPicker } from './component-picker';
import { TEXT_FILL_IN_MARKER, getTextFillInPlaceholder, hasTextFillInMarker, splitTextFillIns } from '../text-fill-in';
import { closeIcon, plusIcon } from '../icons';

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

interface ComponentListDisplayContext {
  sortKeys: string[];
  groupKeys: string[];
}

interface EditorRenderState {
  documentMeta: Record<string, unknown>;
  documentSections: VisualSection[];
  showAdvancedEditor: boolean;
  addComponentBySection: Record<string, string>;
  activeEditorBlock: { sectionKey: string; blockId: string } | null;
  componentPlacement: ComponentPlacementState | null;
  pendingEditorActivation: {
    sectionKey: string;
    blockId: string;
    anchorTop?: number;
    clientX?: number;
    clientY?: number;
    preferTextFocus?: boolean;
  } | null;
  expandableEditorPanels: Record<string, { stubOpen: boolean; expandedOpen: boolean }>;
  editorSidebarHelpDismissed: boolean;
  currentView: 'editor' | 'viewer' | 'ai';
  responsivePreview: 'full' | 'phone' | 'tablet' | 'desktop';
  mobileAdjustmentMode: boolean;
  descriptionPopulate?: {
    isRunning: boolean;
    status: string | null;
    completed: number;
    total: number;
    current: string;
    skippedLeaves: number;
    lastGenerated: string;
  };
}

interface EditorRenderDeps {
  escapeAttr: (value: string) => string;
  escapeHtml: (value: string) => string;
  flattenSections: (sections: VisualSection[]) => VisualSection[];
  renderReaderBlock: (section: VisualSection, block: VisualBlock) => string;
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
  buildSectionRenderSequence: (
    section: VisualSection
  ) => Array<{ kind: 'block'; block: VisualBlock } | { kind: 'child'; child: VisualSection }>;
  getComponentDefs: () => ComponentDef[];
  getSectionDefs: () => SectionDef[];
  getThemeConfig: () => ThemeConfig;
  getComponentRenderHelpers: () => ComponentRenderHelpers;
  isBuiltinComponent: (componentName: string) => boolean;
}

export interface EditorRenderer {
  renderSectionEditorTree: (sections: VisualSection[]) => string;
  renderSidebarEditorSections: (sections: VisualSection[]) => string;
  renderSidebarHelpBalloon: (sections: VisualSection[]) => string;
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
      includeFillIn?: boolean;
      align?: Align;
      currentMarkdown?: string;
    }
  ) => string;
  renderMetaPanel: () => string;
  renderComponentFragment: (componentName: string, content: string, block: VisualBlock) => string;
  renderBlockMetaFields: (sectionKey: string, block: VisualBlock) => string;
  renderComponentPlacementTarget: ComponentRenderHelpers['renderComponentPlacementTarget'];
}

export function createEditorRenderer(state: EditorRenderState, deps: EditorRenderDeps): EditorRenderer {
  function renderSidebarEditorSections(sections: VisualSection[]): string {
    const sidebarSections = sections.filter((s) => !s.isGhost && s.location === 'sidebar');
    if (sidebarSections.length === 0) {
      return '<div class="muted editor-sidebar-empty">Move sections here using the sidebar button.</div>';
    }
    const surfaceAttrs = renderResponsiveSurfaceAttrs('');
    return `<div${surfaceAttrs}><div class="editor-tree-body editor-sidebar-tree-body">${sidebarSections.map((section) => renderEditorSection(section, sections)).join('')}</div></div>`;
  }

  function renderSidebarHelpBalloon(sections: VisualSection[]): string {
    if (state.editorSidebarHelpDismissed) {
      return '';
    }
    const sidebarSections = sections.filter((section) => !section.isGhost && section.location === 'sidebar');
    if (sidebarSections.length === 0) {
      return '';
    }
    return `<div class="editor-sidebar-help-balloon" role="note" aria-label="Sections in pullout">
      <div class="editor-sidebar-help-title">Contains</div>
      <ul>
        ${sidebarSections
          .map((section) => `<li title="${deps.escapeAttr(deps.formatSectionTitle(section.title))}">${deps.escapeHtml(deps.formatSectionTitle(section.title))}</li>`)
          .join('')}
      </ul>
    </div>`;
  }

  function renderComponentPicker(options: Parameters<typeof renderAddComponentPicker>[0]): string {
    return renderAddComponentPicker(options, {
      escapeAttr: deps.escapeAttr,
      escapeHtml: deps.escapeHtml,
      getComponentDefs: deps.getComponentDefs,
    });
  }

  function renderSectionEditorTree(sections: VisualSection[]): string {
    const mainSections = sections.filter((s) => s.location !== 'sidebar');
    const sectionCards = mainSections.map((section) => renderEditorSection(section, sections)).join('');
    const flatSections = deps.flattenSections(sections);
    const maxWidth = typeof state.documentMeta.reader_max_width === 'string' ? state.documentMeta.reader_max_width.trim() : '';
    const bodyStyle = maxWidth.length > 0 ? ` style="max-width: ${deps.escapeAttr(maxWidth)};"` : '';
    const surfaceAttrs = renderResponsiveSurfaceAttrs(maxWidth);
    return `
      <div${surfaceAttrs}>
        <div class="editor-tree-body"${bodyStyle}>
          ${state.showAdvancedEditor
            ? renderTemplateGhosts(getTemplateFields(state.documentMeta), flatSections, { escapeAttr: deps.escapeAttr, escapeHtml: deps.escapeHtml })
            : ''
          }
          ${sectionCards}
          ${state.mobileAdjustmentMode ? '' : `<article class="ghost-section-card add-ghost reusable-section-ghost" data-action="add-top-level-section" data-section-key="__top_level__">
            <div class="ghost-plus-big">${plusIcon()}</div>
            <div class="ghost-label">Add Section</div>
            <label class="ghost-component-picker">
              <select data-field="reusable-section-type" data-section-key="__top_level__" aria-label="Section type">
                ${deps.renderReusableSectionOptions(state.addComponentBySection.__top_level__ ?? 'blank')}
              </select>
            </label>
          </article>`}
        </div>
      </div>
    `;
  }

  function renderResponsiveSurfaceAttrs(_documentMaxWidth: string): string {
    const preview = state.responsivePreview;
    return ` class="hvy-surface hvy-surface-${deps.escapeAttr(preview)}"`;
  }

  function renderEditorSection(section: VisualSection, rootSections: VisualSection[], isSubsection = false): string {
    const visibleTitle = deps.formatSectionTitle(section.title);
    const isUntitled = deps.isDefaultUntitledSectionTitle(section.title);
    const sectionMove = getSectionMoveAvailability(section.key, rootSections);
    const isNamedEmptySection =
      !isUntitled
      && section.title.trim().length > 0
      && section.blocks.length === 0
      && section.children.length === 0;
    const emptyHeadingKey = `empty-heading:${section.key}`;
    const emptyHeadingLevel = normalizeEmptySectionHeadingLevel(state.addComponentBySection[emptyHeadingKey]);
    const titleEditor = deps.isActiveEditorSectionTitle(section.key)
      ? `<input autofocus class="section-title-input" data-section-key="${deps.escapeAttr(section.key)}" data-field="section-title" value="${deps.escapeAttr(
        deps.isDefaultUntitledSectionTitle(section.title) ? '' : section.title
      )}" />`
      : `<button type="button" class="section-title-passive${isUntitled ? ' section-title-placeholder' : ''}" data-action="activate-section-title" data-section-key="${deps.escapeAttr(
        section.key
      )}">${deps.escapeHtml(visibleTitle)}</button>`;
    const hasActiveBlockInSelfOrDescendants = (s: VisualSection): boolean => {
      if (state.activeEditorBlock?.sectionKey === s.key) return true;
      return s.children.some(hasActiveBlockInSelfOrDescendants);
    };
    const subsectionToggle = isSubsection && !hasActiveBlockInSelfOrDescendants(section)
      ? `<button type="button" class="section-nest-toggle" data-action="remove-subsection" data-section-key="${deps.escapeAttr(section.key)}" aria-label="Remove subsection" title="Remove subsection">‹</button>`
      : '';
    const addComponentGhost = state.componentPlacement || state.mobileAdjustmentMode
      ? ''
      : `<article class="ghost-section-card add-ghost compact-add-component-ghost">
                  ${renderComponentPicker({
                    id: `section:${section.key}`,
                    action: 'add-block',
                    sectionKey: section.key,
                    label: 'Section component type',
                  })}
              </article>`;
    return `
      <article class="editor-section-card${isSubsection ? ' editor-subsection-card' : ''}" data-editor-section="${deps.escapeAttr(section.key)}">
        ${subsectionToggle}
        <div class="editor-section-head">
          <div class="section-drag-title" title="Drag to reorder section">
            <div class="editor-order-controls">
              ${sectionMove.canMoveUp ? `<button type="button" class="order-arrow-button" data-action="move-section-up" data-section-key="${deps.escapeAttr(section.key)}" aria-label="Move section up">▲</button>` : ''}
              ${sectionMove.canMoveDown ? `<button type="button" class="order-arrow-button" data-action="move-section-down" data-section-key="${deps.escapeAttr(section.key)}" aria-label="Move section down">▼</button>` : ''}
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
            ${isSubsection ? '' : `<button type="button" class="${section.location === 'sidebar' ? 'secondary' : 'ghost'}" data-action="toggle-section-location" data-section-key="${deps.escapeAttr(section.key)}">${section.location === 'sidebar' ? 'main \u2192' : '\u2190 sidebar'}</button>`}
            <button type="button" class="danger remove-x editor-section-remove-button" data-action="remove-section" data-section-key="${deps.escapeAttr(
              section.key
            )}" aria-label="Remove ${deps.escapeAttr(visibleTitle)} section" title="Delete section" data-tooltip="Delete section">${closeIcon()}</button>
          </div>
        </div>

        <div class="editor-blocks">
          ${renderEditorSectionItems(section, rootSections)}
          ${state.mobileAdjustmentMode || section.lock
        ? ''
        : isNamedEmptySection
          ? `<article class="ghost-section-card add-ghost empty-section-heading-ghost" data-action="add-empty-section-heading" data-section-key="${deps.escapeAttr(section.key)}">
                  <div class="empty-section-heading-watermark">${deps.escapeHtml(visibleTitle)}</div>
                  <div class="ghost-plus-big">${plusIcon()}</div>
                  <div class="ghost-label">${deps.escapeHtml(visibleTitle)}</div>
                  <label class="ghost-component-picker">
                    <select aria-label="Heading level" data-field="empty-section-heading-level" data-section-key="${deps.escapeAttr(section.key)}">
                      ${renderHeadingLevelOption('h1', emptyHeadingLevel, deps.escapeAttr)}
                      ${renderHeadingLevelOption('h2', emptyHeadingLevel, deps.escapeAttr)}
                      ${renderHeadingLevelOption('h3', emptyHeadingLevel, deps.escapeAttr)}
                    </select>
                  </label>
                </article>
                ${addComponentGhost}`
          : addComponentGhost
      }
        </div>
      </article>
    `;
  }

  function renderEditorSectionItems(section: VisualSection, rootSections: VisualSection[]): string {
    const items = deps.buildSectionRenderSequence(section);
    const output: string[] = [];
    let renderedFirstBlockPlacement = false;
    const canPlaceInSection = !section.lock;
    for (const item of items) {
      if (item.kind === 'block') {
        if (!renderedFirstBlockPlacement) {
          if (canPlaceInSection) {
            output.push(renderComponentPlacementTarget({ container: 'section', sectionKey: section.key, placement: 'before', targetBlockId: item.block.id }));
          }
          renderedFirstBlockPlacement = true;
        }
        output.push(renderEditorBlock(section.key, item.block, rootSections, section.lock));
        if (canPlaceInSection) {
          output.push(renderComponentPlacementTarget({ container: 'section', sectionKey: section.key, placement: 'after', targetBlockId: item.block.id }));
        }
      } else {
        output.push(renderEditorSection(item.child, rootSections, true));
      }
    }
    if (!renderedFirstBlockPlacement && canPlaceInSection) {
      output.push(renderComponentPlacementTarget({ container: 'section', sectionKey: section.key, placement: 'end' }));
    }
    return output.join('');
  }

  function renderComponentPlacementTarget(options: Parameters<ComponentRenderHelpers['renderComponentPlacementTarget']>[0]): string {
    const pending = state.componentPlacement;
    if (!pending) {
      return '';
    }
    const label = `Place ${pending.mode} here`;
    return `<button type="button" class="component-placement-target" data-action="place-component" data-section-key="${deps.escapeAttr(
      options.sectionKey
    )}" data-placement-container="${options.container}" data-placement="${options.placement}"${
      options.targetBlockId ? ` data-target-block-id="${deps.escapeAttr(options.targetBlockId)}"` : ''
    }${options.parentBlockId ? ` data-parent-block-id="${deps.escapeAttr(options.parentBlockId)}"` : ''}${
      options.targetGridItemId ? ` data-target-grid-item-id="${deps.escapeAttr(options.targetGridItemId)}"` : ''
    }>
      <span>${deps.escapeHtml(label)}</span>
    </button>`;
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
    const componentLabel = component === 'plugin' ? getPluginBlockHeaderLabel(block) : component;
    const isActiveSelf = deps.isActiveEditorBlock(sectionKey, block.id);
    const isActiveDescendant = state.activeEditorBlock?.sectionKey === sectionKey && isDescendantActive(block, state.activeEditorBlock.blockId);
    const isActive = isActiveSelf || isActiveDescendant;

    if (!isActive) {
      return renderPassiveEditorBlock(sectionKey, block, rootSections ?? []);
    }

    const contentEditor = renderBlockContentEditor(sectionKey, block);
    const activationPath = getActivationPathIds(sectionKey, rootSections ?? []);
    const activationPathIndex = activationPath.indexOf(block.id);
    const isActivatingPath = state.pendingEditorActivation?.sectionKey === sectionKey && activationPathIndex >= 0;
    const activationStyle = isActivatingPath ? ` style="--editor-activation-delay: ${activationPathIndex * 150}ms;"` : '';
    const activationAttrs = isActiveSelf ? ` data-active-editor-block="true" data-active-block-id="${deps.escapeAttr(block.id)}"` : '';
    const blockMove = isActiveSelf
      ? getBlockMoveAvailability(sectionKey, block.id, rootSections ?? [])
      : { canMoveUp: false, canMoveDown: false };
    const canRemove = isActive && !parentLocked;
    const placement = state.componentPlacement;
    const isPlacementSource = placement?.sectionKey === sectionKey && placement.blockId === block.id;
    const placementActions = canRemove
      ? isPlacementSource
        ? `<button type="button" class="secondary" data-action="cancel-component-placement" data-section-key="${deps.escapeAttr(sectionKey)}" data-block-id="${deps.escapeAttr(block.id)}">Cancel place</button>`
        : `<button type="button" class="ghost" data-action="start-component-move" data-section-key="${deps.escapeAttr(sectionKey)}" data-block-id="${deps.escapeAttr(block.id)}">Move</button>
           <button type="button" class="ghost" data-action="start-component-copy" data-section-key="${deps.escapeAttr(sectionKey)}" data-block-id="${deps.escapeAttr(block.id)}">Copy</button>`
      : '';
    const componentMetaActions = state.showAdvancedEditor && isActive
      ? `<div class="editor-block-context-actions" aria-label="Component options">
          <button type="button" class="ghost" data-action="open-save-component-def" data-section-key="${deps.escapeAttr(
        sectionKey
      )}" data-block-id="${deps.escapeAttr(block.id)}">Reusable</button>
          <button type="button" class="ghost" data-action="open-component-meta" data-section-key="${deps.escapeAttr(
        sectionKey
      )}" data-block-id="${deps.escapeAttr(block.id)}">Meta</button>
        </div>`
      : '';
    const removeButton = canRemove
      ? `<button type="button" class="danger remove-x editor-block-remove-button" data-action="remove-block" data-section-key="${deps.escapeAttr(
        sectionKey
      )}" data-block-id="${deps.escapeAttr(block.id)}" aria-label="Remove ${deps.escapeAttr(componentLabel)}" title="Delete component" data-tooltip="Delete component">${closeIcon()}</button>`
      : '';
    const frameRemoveButton = state.mobileAdjustmentMode ? '' : removeButton;

    return `
      <div class="editor-block${isActivatingPath ? ' is-activating-path' : ''}${isPlacementSource ? ' is-placement-source' : ''}"${activationStyle}${activationAttrs}>
        ${componentMetaActions}
        ${frameRemoveButton}
        <div class="editor-block-head">
          <div class="section-drag-title">
            <div class="editor-order-controls">
              ${blockMove.canMoveUp ? `<button type="button" class="order-arrow-button" data-action="move-block-up" data-section-key="${deps.escapeAttr(sectionKey)}" data-block-id="${deps.escapeAttr(block.id)}" aria-label="Move block up">▲</button>` : ''}
              ${blockMove.canMoveDown ? `<button type="button" class="order-arrow-button" data-action="move-block-down" data-section-key="${deps.escapeAttr(sectionKey)}" data-block-id="${deps.escapeAttr(block.id)}" aria-label="Move block down">▼</button>` : ''}
            </div>
            <strong class="editor-block-title">${deps.escapeHtml(componentLabel)}</strong>
          </div>
          <div class="editor-actions">
            ${state.mobileAdjustmentMode ? '' : isActiveSelf ? placementActions : ''}
          </div>
        </div>

        ${contentEditor}
        ${
          isActiveSelf
            ? `<div class="editor-block-done-row">
                <button type="button" class="ghost editor-block-cancel-button" data-action="cancel-block-edit" data-section-key="${deps.escapeAttr(
                  sectionKey
                )}" data-block-id="${deps.escapeAttr(block.id)}">Cancel</button>
                <button type="button" class="ghost editor-block-done-button" data-action="deactivate-block" data-section-key="${deps.escapeAttr(
                  sectionKey
                )}" data-block-id="${deps.escapeAttr(block.id)}">Done</button>
              </div>`
            : ''
        }
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

  function getActivationPathIds(sectionKey: string, rootSections: VisualSection[]): string[] {
    const pending = state.pendingEditorActivation;
    if (!pending || pending.sectionKey !== sectionKey) {
      return [];
    }
    const section = deps.findSectionByKey(rootSections, sectionKey);
    if (!section) {
      return [];
    }
    return findBlockPathIds(section.blocks, pending.blockId) ?? [];
  }

  function getSectionMoveAvailability(
    sectionKey: string,
    sections: VisualSection[]
  ): { canMoveUp: boolean; canMoveDown: boolean } {
    const location = findSectionLocation(sections, sectionKey);
    if (!location) {
      return { canMoveUp: false, canMoveDown: false };
    }
    return {
      canMoveUp: location.index > 0,
      canMoveDown: location.index < location.container.length - 1,
    };
  }

  function getBlockMoveAvailability(
    sectionKey: string,
    blockId: string,
    rootSections: VisualSection[]
  ): { canMoveUp: boolean; canMoveDown: boolean } {
    const section = deps.findSectionByKey(rootSections, sectionKey);
    if (!section) {
      return { canMoveUp: false, canMoveDown: false };
    }
    const sectionBlockIndex = section.blocks.findIndex((candidate) => candidate.id === blockId);
    if (sectionBlockIndex >= 0) {
      const sequence = deps.buildSectionRenderSequence(section);
      const sequenceIndex = sequence.findIndex((item) => item.kind === 'block' && item.block.id === blockId);
      return {
        canMoveUp: sequenceIndex > 0,
        canMoveDown: sequenceIndex >= 0 && sequenceIndex < sequence.length - 1,
      };
    }
    const location = findBlockLocation(section.blocks, blockId);
    if (!location) {
      return { canMoveUp: false, canMoveDown: false };
    }
    return {
      canMoveUp: location.index > 0,
      canMoveDown: location.index < location.container.length - 1,
    };
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
      return body
        ? `<div class="reader-container-body">${body}</div>`
        : '<div class="container-inner-blocks is-empty is-passive-empty"><div class="container-empty-placeholder">Empty container</div></div>';
    }

    if (base === 'expandable') {
      deps.ensureExpandableBlocks(block);
      const expanded = block.schema.expandableExpanded;
      const alwaysShowStub = block.schema.expandableAlwaysShowStub;
      const stubPaneStyle = deps.escapeAttr(sanitizeInlineCss(block.schema.expandableStubCss));
      const contentPaneStyle = deps.escapeAttr(sanitizeInlineCss(block.schema.expandableContentCss));
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
      if (state.mobileAdjustmentMode) {
        return `<div class="reader-component-list">${(block.schema.componentListBlocks ?? [])
          .map((innerBlock) => renderPassiveEditorBlock(sectionKey, innerBlock, rootSections))
          .join('')}</div>`;
      }
      const actionLabel = block.schema.lock ? getComponentListEditLabel(block) : getComponentListAddLabel(block);
      const actionAttr = block.schema.lock ? '' : ` data-action="add-component-list-item" data-section-key="${deps.escapeAttr(
        sectionKey
      )}" data-block-id="${deps.escapeAttr(block.id)}"`;
      const addControl = `<div class="ghost-section-card add-ghost component-list-add-ghost passive-list-add-ghost"${actionAttr}>
        <div class="ghost-plus-big">${plusIcon()}</div>
        <div class="ghost-label">${deps.escapeHtml(actionLabel)}</div>
      </div>`;
      if (!hasComponentListItems(block)) {
        const existingContent = block.schema.componentListBlocks.length > 0 ? deps.renderReaderBlock(section, block) : '';
        return `${existingContent}<div class="ghost-section-card add-ghost passive-empty-list-ghost"${actionAttr}>
          <div class="ghost-plus-big">${plusIcon()}</div>
          <div class="ghost-label">${deps.escapeHtml(actionLabel)}</div>
        </div>`;
      }
      const listContent = `<div class="reader-component-list">${(block.schema.componentListBlocks ?? [])
        .map((innerBlock) => renderPassiveEditorBlock(sectionKey, innerBlock, rootSections))
        .join('')}</div>`;
      return `${listContent}${addControl}`;
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

    if (base === 'plugin' && block.schema.plugin === SCRIPTING_PLUGIN_ID) {
      if (block.text.trim().length === 0) {
        return `<div class="editor-passive-empty-text">Empty script...</div>`;
      }
      return renderSyntaxHighlightedCode(block.text, 'python');
    }

    if (base === 'text' && block.text.trim().length === 0) {
      const hint = block.schema.placeholder || 'Empty text...';
      const content = block.schema.placeholder
        ? renderTextFragment(hint)
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
      includeFillIn?: boolean;
      align?: Align;
      currentMarkdown?: string;
    }
  ): string {
    if (state.mobileAdjustmentMode) {
      return '';
    }
    const fieldAttr = options?.field ? ` data-rich-field="${deps.escapeAttr(options.field)}"` : '';
    const gridAttr = options?.gridItemId ? ` data-grid-item-id="${deps.escapeAttr(options.gridItemId)}"` : '';
    const rowAttr = typeof options?.rowIndex === 'number' ? ` data-row-index="${options.rowIndex}"` : '';
    const blockStyle = getMarkdownBlockStyle(options?.currentMarkdown ?? '');
    const selectedClass = (selected: boolean) => (selected ? ' secondary is-selected' : ' ghost');
    const richButtonAttrs = `${fieldAttr}${gridAttr}${rowAttr} data-section-key="${deps.escapeAttr(sectionKey)}" data-block-id="${deps.escapeAttr(blockId)}"`;
    const hotkeyModifier = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform) ? 'Cmd' : 'Ctrl';
    const alignControls =
      options?.includeAlign && options.align
        ? `<div class="toolbar-segment align-buttons" role="group" aria-label="Text alignment">
            <button type="button" class="icon-button${selectedClass(options.align === 'left')}" data-action="set-block-align" data-align-value="left" data-section-key="${deps.escapeAttr(
          sectionKey
        )}" data-block-id="${deps.escapeAttr(blockId)}" aria-label="Align left" title="Align left"><span class="toolbar-icon align-left-icon" aria-hidden="true"></span></button>
            <button type="button" class="icon-button${selectedClass(options.align === 'center')}" data-action="set-block-align" data-align-value="center" data-section-key="${deps.escapeAttr(
          sectionKey
        )}" data-block-id="${deps.escapeAttr(blockId)}" aria-label="Align center" title="Align center"><span class="toolbar-icon align-center-icon" aria-hidden="true"></span></button>
            <button type="button" class="icon-button${selectedClass(options.align === 'right')}" data-action="set-block-align" data-align-value="right" data-section-key="${deps.escapeAttr(
          sectionKey
        )}" data-block-id="${deps.escapeAttr(blockId)}" aria-label="Align right" title="Align right"><span class="toolbar-icon align-right-icon" aria-hidden="true"></span></button>
          </div>`
        : '';
    return `
      <div class="rich-toolbar">
        <div class="toolbar-segment block-style-buttons" role="group" aria-label="Block style">
          <button type="button" class="${selectedClass(blockStyle === 'paragraph')}" data-rich-action="paragraph" ${richButtonAttrs} title="Normal text">Text</button>
          <button type="button" class="${selectedClass(blockStyle === 'heading-1')}" data-rich-action="heading-1" ${richButtonAttrs} title="Heading 1">H1</button>
          <button type="button" class="${selectedClass(blockStyle === 'heading-2')}" data-rich-action="heading-2" ${richButtonAttrs} title="Heading 2">H2</button>
          <button type="button" class="${selectedClass(blockStyle === 'heading-3')}" data-rich-action="heading-3" ${richButtonAttrs} title="Heading 3">H3</button>
          <button type="button" class="${selectedClass(blockStyle === 'heading-4')}" data-rich-action="heading-4" ${richButtonAttrs} title="Heading 4">H4</button>
        </div>
        <div class="toolbar-segment format-buttons" role="group" aria-label="Text formatting">
          ${alignControls}
          <button type="button" class="icon-button ghost" data-rich-action="bold" ${richButtonAttrs} aria-label="Bold" title="Bold (${hotkeyModifier}+B)"><strong>B</strong></button>
          <button type="button" class="icon-button ghost" data-rich-action="italic" ${richButtonAttrs} aria-label="Italic" title="Italic (${hotkeyModifier}+I)"><span class="toolbar-icon italic-icon" aria-hidden="true">I</span></button>
          <button type="button" class="icon-button ghost" data-rich-action="underline" ${richButtonAttrs} aria-label="Underline" title="Underline (${hotkeyModifier}+U)"><span class="toolbar-icon underline-icon" aria-hidden="true">U</span></button>
          <button type="button" class="icon-button ghost" data-rich-action="strikethrough" ${richButtonAttrs} aria-label="Strikethrough" title="Strikethrough"><span class="toolbar-icon strikethrough-icon" aria-hidden="true">S</span></button>
          <button type="button" class="icon-button${selectedClass(blockStyle === 'quote')}" data-rich-action="quote" ${richButtonAttrs} aria-label="Quote" title="Quote"><span class="toolbar-icon quote-icon" aria-hidden="true">“</span></button>
          <button type="button" class="icon-button${selectedClass(blockStyle === 'code-block')}" data-rich-action="code-block" ${richButtonAttrs} aria-label="Code block" title="Code block"><span class="toolbar-icon code-icon" aria-hidden="true">&lt;/&gt;</span></button>
          <button type="button" class="icon-button${selectedClass(blockStyle === 'list')}" data-rich-action="list" ${richButtonAttrs} aria-label="List" title="Bullet List"><span class="toolbar-icon list-icon" aria-hidden="true"></span></button>
          <button type="button" class="icon-button${selectedClass(blockStyle === 'checklist')}" data-rich-action="checklist" ${richButtonAttrs} aria-label="Checkbox" title="Checkbox"><span class="toolbar-icon checkbox-icon" aria-hidden="true">☑</span></button>
          <button type="button" class="icon-button ghost" data-rich-action="link" ${richButtonAttrs} aria-label="Link" title="Link (${hotkeyModifier}+K)"><span class="toolbar-icon link-icon" aria-hidden="true"></span></button>
        </div>
      </div>
    `;
  }

  function getMarkdownBlockStyle(markdown: string): string {
    const trimmed = markdown.trimStart();
    const firstLine = trimmed.split(/\r?\n/, 1)[0] ?? '';
    const heading = firstLine.match(/^(#{1,4})\s+/);
    if (heading) {
      return `heading-${heading[1].length}`;
    }
    if (/^[-*]\s+\[[ xX]\]\s+/.test(firstLine)) {
      return 'checklist';
    }
    if (/^[-*]\s+/.test(firstLine)) {
      return 'list';
    }
    if (/^>\s+/.test(firstLine)) {
      return 'quote';
    }
    return 'paragraph';
  }

  function renderMetaPanel(): string {
    const defs = deps.getComponentDefs();
    const sectionDefs = deps.getSectionDefs();
    const theme = deps.getThemeConfig();
    const colorCount = Object.keys(theme.colors).length;
    const tableBaseTypeOption = areTablesEnabled() || defs.some((def) => def.baseType === 'table');
    const descriptionPopulate = state.descriptionPopulate ?? { isRunning: false, status: null, completed: 0, total: 0, current: '', skippedLeaves: 0, lastGenerated: '' };
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
        <label>
          <span>AI Context</span>
          <textarea
            rows="4"
            data-field="meta-ai-context"
            placeholder="Tell the AI how this document is organized and what intent to preserve."
          >${deps.escapeHtml(String(state.documentMeta['ai-context'] ?? ''))}</textarea>
        </label>
        <div class="editor-grid">
          <label>
            <span>Empty Descriptions</span>
            <button
              type="button"
              class="ghost"
              data-action="populate-missing-descriptions"
              aria-label="Populate Missing"
              ${descriptionPopulate.isRunning ? 'disabled' : ''}
            >${descriptionPopulate.isRunning ? 'Generating...' : 'Populate Missing'}</button>
          </label>
        </div>
        ${descriptionPopulate.status ? `<div class="muted">${deps.escapeHtml(descriptionPopulate.status)}</div>` : ''}
        ${descriptionPopulate.skippedLeaves > 0 ? `<div class="muted">${deps.escapeHtml(`${descriptionPopulate.skippedLeaves} component${descriptionPopulate.skippedLeaves === 1 ? '' : 's'} skipped.`)}</div>` : ''}
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
    if (component === 'image') {
      return renderImageEditor(sectionKey, block, helpers);
    }
    return renderTextEditor(sectionKey, block, helpers);
  }

  function renderBlockMetaFields(sectionKey: string, block: VisualBlock): string {
    const component = deps.resolveBaseComponent(block.schema.component);
    const listDisplayContext = getComponentListDisplayContext(sectionKey, block.id);
    const scriptingVersionField =
      component === 'plugin' && block.schema.plugin === SCRIPTING_PLUGIN_ID
        ? `<label>
          <span>Scripting Version</span>
          <input
            data-section-key="${deps.escapeAttr(sectionKey)}"
            data-block-id="${deps.escapeAttr(block.id)}"
            data-field="block-plugin-scripting-version"
            placeholder="${deps.escapeAttr(getScriptingPluginVersion(block.schema.pluginConfig))}"
            value="${deps.escapeAttr(getScriptingPluginVersion(block.schema.pluginConfig))}"
          />
        </label>`
        : '';
    return `
      <div class="schema-meta-stack">
        <label>
          <span>ID</span>
          <input
            data-section-key="${deps.escapeAttr(sectionKey)}"
            data-block-id="${deps.escapeAttr(block.id)}"
            data-field="block-schema-id"
            placeholder="component-id"
            value="${deps.escapeAttr(block.schema.id)}"
          />
        </label>
        <label>
          <span>Custom CSS</span>
          <textarea
            rows="2"
            data-section-key="${deps.escapeAttr(sectionKey)}"
            data-block-id="${deps.escapeAttr(block.id)}"
            data-field="block-custom-css"
            placeholder="margin: 0.5rem 0;"
          >${deps.escapeHtml(block.schema.css)}</textarea>
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
          <span>Placeholder</span>
          <input
            data-section-key="${deps.escapeAttr(sectionKey)}"
            data-block-id="${deps.escapeAttr(block.id)}"
            data-field="block-placeholder"
            placeholder="Shown when block is empty"
            value="${deps.escapeAttr(block.schema.placeholder)}"
          />
        </label>
        ${listDisplayContext ? renderComponentListDisplayFields(sectionKey, block, listDisplayContext) : ''}
        ${
          component === 'container'
            ? `<label>
          <span>Preview Height (CSS units)</span>
          <input
            type="number"
            min="1"
            step="0.25"
            data-section-key="${deps.escapeAttr(sectionKey)}"
            data-block-id="${deps.escapeAttr(block.id)}"
            data-field="block-container-collapsed-preview-rem"
            value="${deps.escapeAttr(String(block.schema.containerCollapsedPreviewRem))}"
          />
        </label>`
            : ''
        }
        ${
          component === 'component-list'
            ? `<label>
          <span>List Item Label</span>
          <input
            data-section-key="${deps.escapeAttr(sectionKey)}"
            data-block-id="${deps.escapeAttr(block.id)}"
            data-field="block-component-list-item-label"
            placeholder="${deps.escapeAttr(getComponentListAddLabel(block).replace(/^Add\s+/, ''))}"
            value="${deps.escapeAttr(block.schema.componentListItemLabel)}"
          />
        </label>
        <label>
          <span>Group Preview Height</span>
          <input
            type="number"
            min="1"
            step="0.25"
            data-section-key="${deps.escapeAttr(sectionKey)}"
            data-block-id="${deps.escapeAttr(block.id)}"
            data-field="component-list-group-preview-rem"
            value="${deps.escapeAttr(String(block.schema.componentListGroupCollapsedPreviewRem))}"
          />
        </label>`
            : ''
        }
        <label>
          <span class="description-label-with-action">Description${
            block.schema.description.trim()
              ? ''
              : ` <button type="button" class="ghost inline-generate-description" data-action="generate-block-description" data-section-key="${deps.escapeAttr(sectionKey)}" data-block-id="${deps.escapeAttr(block.id)}">Generate</button>`
          }</span>
          <textarea
            rows="3"
            data-section-key="${deps.escapeAttr(sectionKey)}"
            data-block-id="${deps.escapeAttr(block.id)}"
            data-field="block-description"
          >${deps.escapeHtml(block.schema.description)}</textarea>
        </label>
        ${scriptingVersionField}
      </div>
    `;
  }

  function renderComponentListDisplayFields(sectionKey: string, block: VisualBlock, context: ComponentListDisplayContext): string {
    return `<section class="component-list-display-editor" aria-label="Component list display">
      <strong>Component List Display</strong>
      ${renderDisplayKeyEditor('Sort Keys', 'sort', sectionKey, block, context.sortKeys, block.schema.sortKeys)}
      ${renderDisplayKeyEditor('Grouping Keys', 'group', sectionKey, block, context.groupKeys, block.schema.groupKeys)}
    </section>`;
  }

  function renderDisplayKeyEditor(
    label: string,
    kind: 'sort' | 'group',
    sectionKey: string,
    block: VisualBlock,
    suggestedKeys: string[],
    ownKeyValues: Record<string, SortKeyValue> | Record<string, string>
  ): string {
    const keys = mergeDisplayKeys(ownKeyValues, suggestedKeys);
    const datalistId = `${block.id}-${kind}-display-keys`;
    const options = keys.map((key) => `<option value="${deps.escapeAttr(key)}"></option>`).join('');
    return `<div class="sort-key-editor" data-display-key-kind="${kind}">
      <div class="sort-key-editor-head">
        <span>${label}</span>
        <button
          type="button"
          class="ghost"
          data-action="add-block-display-key"
          data-display-key-kind="${kind}"
          data-section-key="${deps.escapeAttr(sectionKey)}"
          data-block-id="${deps.escapeAttr(block.id)}"
        >Add ${kind === 'sort' ? 'Sort Key' : 'Grouping Key'}</button>
      </div>
      <datalist id="${deps.escapeAttr(datalistId)}">${options}</datalist>
      ${renderDisplayKeyRows(sectionKey, block, keys, datalistId, kind, ownKeyValues, kind === 'sort' ? 'Sort Key' : 'Grouping Key')}
    </div>`;
  }

  function renderDisplayKeyRows(
    sectionKey: string,
    block: VisualBlock,
    keys: string[],
    datalistId: string,
    kind: 'sort' | 'group',
    ownKeyValues: Record<string, SortKeyValue> | Record<string, string>,
    keyPlaceholder: string
  ): string {
    if (keys.length === 0) {
      return '<p class="muted sort-key-empty">No display keys yet.</p>';
    }
    return keys
      .map((name) => {
        const hasOwnKey = Object.prototype.hasOwnProperty.call(ownKeyValues, name);
        const value = hasOwnKey ? ownKeyValues[name] ?? '' : '';
        return `<div class="sort-key-row">
          <input
            data-section-key="${deps.escapeAttr(sectionKey)}"
            data-block-id="${deps.escapeAttr(block.id)}"
            data-field="block-sort-key-name"
            data-display-key-kind="${kind}"
            data-sort-key-name="${deps.escapeAttr(name)}"
            data-sort-key-present="${hasOwnKey ? 'true' : 'false'}"
            list="${deps.escapeAttr(datalistId)}"
            placeholder="${deps.escapeAttr(keyPlaceholder)}"
            value="${deps.escapeAttr(name)}"
          />
          <input
            data-section-key="${deps.escapeAttr(sectionKey)}"
            data-block-id="${deps.escapeAttr(block.id)}"
            data-field="block-sort-key-value"
            data-display-key-kind="${kind}"
            data-sort-key-name="${deps.escapeAttr(name)}"
            placeholder="Value"
            value="${deps.escapeAttr(String(value))}"
          />
          ${hasOwnKey
            ? `<button
                type="button"
                class="ghost remove-x"
                data-action="remove-block-display-key"
                data-section-key="${deps.escapeAttr(sectionKey)}"
                data-block-id="${deps.escapeAttr(block.id)}"
                data-sort-key-name="${deps.escapeAttr(name)}"
                data-display-key-kind="${kind}"
                aria-label="Remove ${deps.escapeAttr(name)}"
              >${closeIcon()}</button>`
            : '<span class="sort-key-row-spacer"></span>'}
        </div>`;
      })
      .join('');
  }

  function mergeDisplayKeys(ownKeyValues: Record<string, SortKeyValue> | Record<string, string>, suggestedKeys: string[]): string[] {
    const ownKeys = Object.keys(ownKeyValues).filter((key) => key.length > 0);
    return [...new Set([...suggestedKeys, ...ownKeys])].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
  }

  function getComponentListDisplayContext(sectionKey: string, blockId: string): ComponentListDisplayContext | null {
    const section = findSectionForRenderKey(state.documentSections, sectionKey);
    if (!section) {
      return null;
    }
    const listBlock = findDirectParentComponentList(section.blocks, blockId);
    return listBlock ? buildComponentListDisplayContext(listBlock) : null;
  }

  function renderTextFragment(content: string): string {
    const normalized = normalizeMarkdownIndentation(normalizeMarkdownLists(content));
    return unwrapSingleParagraph(decorateMarkdownCodeBlocks(addExternalLinkTargets(markdownToReaderHtml(normalized)), deps.escapeHtml));
  }

  function renderComponentFragment(componentName: string, content: string, block: VisualBlock): string {
    if (componentName === 'code') {
      return renderSyntaxHighlightedCode(content, block.schema.codeLanguage || 'text');
    }
    if (componentName === 'text' && block.schema.fillIn && hasTextFillInMarker(content)) {
      if (state.currentView === 'viewer') {
        return renderTextFragment(content.replaceAll(TEXT_FILL_IN_MARKER, ''));
      }
      const parts = splitTextFillIns(content);
      const tokenPrefix = 'HVY_FILL_IN_VALUE_TOKEN_';
      let html = renderTextFragment(
        parts.map((part, index) => (index < parts.length - 1 ? `${part}${tokenPrefix}${index}` : part)).join('')
      );
      for (let index = 0; index < parts.length - 1; index += 1) {
        html = html.replace(
          `${tokenPrefix}${index}`,
          `<span class="text-fill-in-box" data-placeholder="${deps.escapeAttr(getTextFillInPlaceholder(block.schema.placeholder, index))}"></span>`
        );
      }
      return html;
    }
    return renderTextFragment(content);
  }

  function renderSyntaxHighlightedCode(content: string, languageName: string): string {
    const language = languageName.trim() || 'text';
    const highlighted = highlightCode(content, language, deps.escapeHtml);
    return `<div class="reader-code-block">
      <div class="reader-code-head">
        <span class="reader-code-language">${deps.escapeHtml(language)}</span>
      </div>
      <pre><code class="hljs language-${deps.escapeAttr(language)}">${highlighted}</code></pre>
    </div>`;
  }

  return {
    renderSectionEditorTree,
    renderSidebarEditorSections,
    renderSidebarHelpBalloon,
    renderEditorBlock: (sectionKey, block, rootSections, parentLocked) => renderEditorBlock(sectionKey, block, rootSections, parentLocked),
    renderPassiveEditorBlock: (sectionKey, block, rootSections) => renderPassiveEditorBlock(sectionKey, block, rootSections ?? []),
    renderBlockContentEditor: (sectionKey, block) => renderBlockContentEditor(sectionKey, block),
    renderRichToolbar,
    renderMetaPanel,
    renderComponentFragment,
    renderBlockMetaFields,
    renderComponentPlacementTarget,
  };
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

function findBlockPathIds(blocks: VisualBlock[], targetBlockId: string): string[] | null {
  for (const block of blocks) {
    if (block.id === targetBlockId) {
      return [block.id];
    }
    const nestedBlocks = [
      ...(block.schema.containerBlocks ?? []),
      ...(block.schema.componentListBlocks ?? []),
      ...(block.schema.gridItems ?? []).map((item) => item.block),
      ...(block.schema.expandableStubBlocks?.children ?? []),
      ...(block.schema.expandableContentBlocks?.children ?? []),
    ];
    const nestedPath = findBlockPathIds(nestedBlocks, targetBlockId);
    if (nestedPath) {
      return [block.id, ...nestedPath];
    }
  }
  return null;
}

function findSectionForRenderKey(sections: VisualSection[], sectionKey: string): VisualSection | null {
  for (const section of sections) {
    if (section.key === sectionKey) {
      return section;
    }
    const nested = findSectionForRenderKey(section.children, sectionKey);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function findDirectParentComponentList(blocks: VisualBlock[], targetBlockId: string, seen = new Set<VisualBlock>()): VisualBlock | null {
  for (const block of blocks) {
    if (seen.has(block)) {
      continue;
    }
    seen.add(block);
    if ((block.schema.componentListBlocks ?? []).some((child) => child.id === targetBlockId)) {
      return block;
    }
    const nested =
      findDirectParentComponentList(block.schema.containerBlocks ?? [], targetBlockId, seen)
      ?? findDirectParentComponentList(block.schema.componentListBlocks ?? [], targetBlockId, seen)
      ?? findDirectParentComponentList((block.schema.gridItems ?? []).map((item) => item.block), targetBlockId, seen)
      ?? findDirectParentComponentList(block.schema.expandableStubBlocks?.children ?? [], targetBlockId, seen)
      ?? findDirectParentComponentList(block.schema.expandableContentBlocks?.children ?? [], targetBlockId, seen);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function buildComponentListDisplayContext(listBlock: VisualBlock): ComponentListDisplayContext {
  const sortKeys = new Set<string>();
  const groupKeys = new Set<string>();
  listBlock.schema.componentListBlocks.forEach((child) => {
    Object.keys(child.schema.sortKeys).forEach((key) => {
      if (!key.trim()) {
        return;
      }
      sortKeys.add(key);
    });
    Object.keys(child.schema.groupKeys).forEach((key) => {
      if (!key.trim()) {
        return;
      }
      groupKeys.add(key);
    });
  });
  return {
    sortKeys: sortDisplayKeys(sortKeys),
    groupKeys: sortDisplayKeys(groupKeys),
  };
}

function sortDisplayKeys(keys: Set<string>): string[] {
  return [...keys].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
}

function findBlockLocation(
  blocks: VisualBlock[],
  targetBlockId: string
): { container: VisualBlock[]; index: number } | null {
  const index = blocks.findIndex((block) => block.id === targetBlockId);
  if (index >= 0) {
    return { container: blocks, index };
  }
  for (const block of blocks) {
    const nested =
      findBlockLocation(block.schema.containerBlocks ?? [], targetBlockId)
      ?? findBlockLocation(block.schema.componentListBlocks ?? [], targetBlockId)
      ?? findBlockLocation((block.schema.gridItems ?? []).map((item) => item.block), targetBlockId)
      ?? findBlockLocation(block.schema.expandableStubBlocks?.children ?? [], targetBlockId)
      ?? findBlockLocation(block.schema.expandableContentBlocks?.children ?? [], targetBlockId);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function findSectionLocation(
  sections: VisualSection[],
  targetSectionKey: string
): { container: VisualSection[]; index: number } | null {
  const index = sections.findIndex((section) => section.key === targetSectionKey);
  if (index >= 0) {
    return { container: sections, index };
  }
  for (const section of sections) {
    const nested = findSectionLocation(section.children, targetSectionKey);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function normalizeEmptySectionHeadingLevel(value: string | undefined): 'h1' | 'h2' | 'h3' {
  if (value === 'h2' || value === 'h3') {
    return value;
  }
  return 'h1';
}

function renderHeadingLevelOption(value: 'h1' | 'h2' | 'h3', selected: string, escapeAttr: (value: string) => string): string {
  return `<option value="${escapeAttr(value)}" ${selected === value ? 'selected' : ''}>${value.toUpperCase()}</option>`;
}

function decorateMarkdownCodeBlocks(html: string, escapeHtml: (value: string) => string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  template.content.querySelectorAll<HTMLElement>('pre > code').forEach((code) => {
    const pre = code.parentElement;
    if (!pre || pre.parentElement?.classList.contains('reader-code-block')) {
      return;
    }
    const languageClass = Array.from(code.classList).find((className) => className.startsWith('language-'));
    const language = languageClass ? languageClass.slice('language-'.length) : code.dataset.language || 'text';
    const rawCode = code.textContent ?? '';
    code.classList.add('hljs');
    code.innerHTML = highlightCode(rawCode, language || 'text', escapeHtml);
    const wrapper = document.createElement('div');
    wrapper.className = 'reader-code-block';
    const head = document.createElement('div');
    head.className = 'reader-code-head';
    const label = document.createElement('span');
    label.className = 'reader-code-language';
    label.textContent = language || 'text';
    head.appendChild(label);
    pre.replaceWith(wrapper);
    wrapper.appendChild(head);
    wrapper.appendChild(pre);
  });
  return template.innerHTML;
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
