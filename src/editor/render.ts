import './editor.css';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import type { ComponentRenderHelpers, ReaderBlockRenderOptions } from './component-helpers';
import type { ComponentPlacementState, ImageAttachmentMaxDimensions } from '../types';
import { renderComponentListEditor } from './components/component-list/component-list';
import { renderButtonEditor } from './components/button/button';
import { renderContainerEditor } from './components/container/container';
import { renderExpandableEditor } from './components/expandable/expandable';
import { renderGridEditor } from './components/grid/grid';
import { renderImageEditor } from './components/image/image';
import { renderCarouselEditor } from './components/carousel/carousel';
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
import { applyWorkspaceLinkRendering } from '../workspace-links';
import { SCRIPTING_PLUGIN_ID } from '../plugins/registry';
import { getScriptingPluginMaxSteps, getScriptingPluginVersion } from '../plugins/scripting/version';
import { SCRIPTING_LIBRARY_OPTIONS } from '../plugins/scripting/wrapper';
import { renderAddComponentPicker } from './component-picker';
import { getTextFillInPlaceholder, hasTextFillInMarker, removeTextFillInMarkers, splitTextFillIns } from '../text-fill-in';
import { closeIcon, plusIcon } from '../icons';
import { getEmptySectionHeadingLevel } from '../section-heading-memory';
import { coerceGridStackWidth, DEFAULT_GRID_STACK_WIDTH } from '../grid-ops';
import {
  formatTextLineStyleCssLines,
  getTextLineStyleLabel,
  getTextLineStylePreviewCss,
  getTextLineStyleSpacing,
  getTextLineStylesFromMeta,
  type TextLineStyles,
} from '../text-line-styles';
import {
  HEADING_STYLE_NAMES,
  formatHeadingStyleCssLines,
  getHeadingStyleLabel,
  getHeadingStyleSpacing,
  getHeadingStyleSurfaceClass,
  getHeadingStylesFromMeta,
  renderHeadingStyleElement,
} from '../heading-styles';
import { isPdfAllowedComponentInstance } from '../pdf-document-capabilities';
import { getSectionFilteredMoveAvailability, isHiddenEditorOnlySection } from '../section-ops';
import { getDefaultSectionContained } from '../document-factory';
import type { JsonObject } from '../hvy/types';
import { resolveImageAttachmentMaxDimensions } from '../image-attachments';
import { PDF_DOCUMENT_PAGE_SIZE_OPTIONS, formatPdfPointsAsUnit, inferPdfPageMarginUnit, pdfPageLengthToPoints, readPdfPageMetaObject, resolvePdfPageDimensions, resolvePdfPageSettings, type PdfPageMarginUnit } from '../pdf-page-settings';
import type { HvyPdfStylePreset } from '../pdf-style-presets';

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
  template?: VisualBlock;
  flavors?: Array<{
    name: string;
    description?: string;
    schema?: BlockSchema;
  }>;
}

interface SectionDef {
  name: string;
  repeatable?: boolean;
  flavors?: Array<{
    name: string;
    description?: string;
  }>;
}

function getDocumentSectionContainedDefault(documentMeta: JsonObject): boolean {
  return getDefaultSectionContained(documentMeta);
}

function formatDocumentMetaTags(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((tag) => (typeof tag === 'string' ? tag.trim() : '')).filter(Boolean).join(', ');
  }
  return typeof value === 'string' ? value : '';
}

interface ComponentListDisplayContext {
  sortKeys: string[];
  groupKeys: string[];
}

interface EditorRenderState {
  documentExtension: '.hvy' | '.thvy' | '.phvy' | '.md';
  documentMeta: Record<string, unknown>;
  imageAttachmentMaxDimensions?: ImageAttachmentMaxDimensions | null;
  imageAttachmentReductionStatus?: { state: 'reducing' | 'reduced' | 'unchanged' | 'error'; message: string } | null;
  documentSections: VisualSection[];
  showAdvancedEditor: boolean;
  addComponentBySection: Record<string, string>;
  activeEditorBlock: { sectionKey: string; blockId: string } | null;
  aiEditorHostBlock?: { sectionKey: string; blockId: string } | null;
  aiEditorHostSectionKey?: string | null;
  componentPlacement: ComponentPlacementState | null;
  pendingEditorActivation: {
    sectionKey: string;
    blockId: string;
    revealPath?: boolean;
    anchorTop?: number;
    clientX?: number;
    clientY?: number;
    preferTextFocus?: boolean;
    immediateFocus?: boolean;
  } | null;
  expandableEditorPanels: Record<string, { stubOpen: boolean; expandedOpen: boolean }>;
  readerExpandableState: Record<string, boolean>;
  editorSidebarHelpDismissed: boolean;
  currentView: 'editor' | 'viewer' | 'ai';
  crossDocumentLinksEnabled?: boolean;
  responsivePreview: 'full' | 'phone' | 'tablet' | 'desktop';
  mobileAdjustmentMode: boolean;
  editingReusableDefinition?: boolean;
  openTemplateDefinitionKeys: string[];
  openTextLineStyleName: string | null;
  paragraphStyleRecentNames: string[];
  pdfStylePresets: HvyPdfStylePreset[];
  pdfStylePresetId: string | null;
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
  renderReaderBlock: (section: VisualSection, block: VisualBlock, options?: ReaderBlockRenderOptions) => string;
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
      textLineStyles?: TextLineStyles;
    }
  ) => string;
  renderMetaPanel: () => string;
  renderTextFragment: (content: string) => string;
  renderComponentFragment: (componentName: string, content: string, block: VisualBlock, sectionKey?: string) => string;
  renderBlockMetaFields: (sectionKey: string, block: VisualBlock) => string;
  renderComponentPlacementTarget: ComponentRenderHelpers['renderComponentPlacementTarget'];
}

export function createEditorRenderer(state: EditorRenderState, deps: EditorRenderDeps): EditorRenderer {
  function isPdfEditorDocument(): boolean {
    return state.documentExtension === '.phvy';
  }

  function isPdfAllowedEditorComponent(componentName: string, pluginId?: string): boolean {
    return isPdfAllowedComponentInstance(componentName, state.documentMeta, pluginId);
  }

  function getPdfDisabledComponentReason(componentName: string, pluginId?: string): string | null {
    return isPdfAllowedEditorComponent(componentName, pluginId) ? null : 'Not supported in PHVY';
  }

  function renderSidebarEditorSections(sections: VisualSection[]): string {
    if (isPdfEditorDocument()) {
      return '';
    }
    const sidebarSections = sections.filter((s) => !s.isGhost && s.location === 'sidebar');
    const surfaceAttrs = renderResponsiveSurfaceAttrs('');
    return `<div${surfaceAttrs}>${renderSurfaceHeadingStyles()}<div class="editor-tree-body editor-sidebar-tree-body">
      ${sidebarSections.length === 0 ? '<div class="muted editor-sidebar-empty">Move sections here using the sidebar button, or add one below.</div>' : ''}
      ${sidebarSections.map((section) => renderEditorSection(section, sections)).join('')}
      ${renderTopLevelSectionAddGhost('sidebar')}
    </div></div>`;
  }

  function renderSidebarHelpBalloon(sections: VisualSection[]): string {
    if (isPdfEditorDocument()) {
      return '';
    }
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
    const mainSections = sections.filter((s) => s.location !== 'sidebar' && !isHiddenEditorOnlySection(s, state.documentMeta, state.showAdvancedEditor));
    const sectionCards = mainSections.map((section) => renderEditorSection(section, sections)).join('');
    const flatSections = deps.flattenSections(sections);
    const maxWidth = typeof state.documentMeta.reader_max_width === 'string' ? state.documentMeta.reader_max_width.trim() : '';
    const bodyStyle = maxWidth.length > 0 ? ` style="max-width: ${deps.escapeAttr(maxWidth)};"` : '';
    const surfaceAttrs = renderResponsiveSurfaceAttrs(maxWidth);
    return `
      <div${surfaceAttrs}>
        ${renderSurfaceHeadingStyles()}
        <div class="editor-tree-body"${bodyStyle}>
          ${state.showAdvancedEditor
        ? renderTemplateGhosts(getTemplateFields(state.documentMeta), flatSections, { escapeAttr: deps.escapeAttr, escapeHtml: deps.escapeHtml })
        : ''
      }
          ${sectionCards}
          ${renderTopLevelSectionAddGhost('main')}
        </div>
      </div>
    `;
  }

  function renderTopLevelSectionAddGhost(location: 'main' | 'sidebar'): string {
    if (state.mobileAdjustmentMode || (isPdfEditorDocument() && location === 'sidebar')) {
      return '';
    }
    const key = location === 'sidebar' ? '__sidebar_top_level__' : '__top_level__';
    const hasReusableSectionOptions = deps.getSectionDefs().length > 0;
    return `<div class="ghost-section-card add-ghost reusable-section-ghost" data-action="add-top-level-section" data-section-key="${deps.escapeAttr(key)}" data-section-location="${location}">
      <div class="ghost-plus-big">${plusIcon()}</div>
      <div class="ghost-label">Add Section</div>
      ${hasReusableSectionOptions ? `<label class="ghost-component-picker">
        <select data-field="reusable-section-type" data-section-key="${deps.escapeAttr(key)}" aria-label="Section type">
          ${deps.renderReusableSectionOptions(state.addComponentBySection[key] ?? 'blank')}
        </select>
      </label>` : ''}
    </div>`;
  }

  function renderResponsiveSurfaceAttrs(_documentMaxWidth: string): string {
    const preview = state.responsivePreview;
    return ` class="hvy-surface hvy-surface-${deps.escapeAttr(preview)} ${deps.escapeAttr(getHeadingStyleSurfaceClass(state.documentMeta))}"`;
  }

  function renderSurfaceHeadingStyles(): string {
    return renderHeadingStyleElement(state.documentMeta, getHeadingStyleSurfaceClass(state.documentMeta));
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
    const emptyHeadingLevel = getEmptySectionHeadingLevel(section.key);
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
      : `<div class="ghost-section-card add-ghost compact-add-component-ghost">
                  ${renderComponentPicker({
        id: `section:${section.key}`,
        action: 'add-block',
        sectionKey: section.key,
        label: 'Section component type',
        ...(isPdfEditorDocument() ? { componentFilter: isPdfAllowedEditorComponent, componentDisabledReason: getPdfDisabledComponentReason } : {}),
      })}
              </div>`;
    return `
      <article class="editor-section-card${isSubsection ? ' editor-subsection-card' : ''}" data-hvy-virtual-section="editor" data-section-key="${deps.escapeAttr(section.key)}" data-editor-section="${deps.escapeAttr(section.key)}">
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
        ? `<button type="button" class="ghost" data-action="open-save-section-def" data-section-key="${deps.escapeAttr(section.key)}">Make Template</button>
                   <button type="button" class="ghost" data-action="focus-modal" data-section-key="${deps.escapeAttr(section.key)}">Meta</button>`
        : ''
      }
            ${isSubsection || isPdfEditorDocument() ? '' : `<button type="button" class="${section.location === 'sidebar' ? 'secondary' : 'ghost'}" data-action="toggle-section-location" data-section-key="${deps.escapeAttr(section.key)}">${section.location === 'sidebar' ? 'main \u2192' : '\u2190 sidebar'}</button>`}
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
          ? `<div class="ghost-section-card add-ghost empty-section-heading-ghost" data-action="add-empty-section-heading" data-section-key="${deps.escapeAttr(section.key)}">
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
                </div>
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
        if (isHiddenEditorOnlyScriptingBlock(item.block)) {
          continue;
        }
        if (isAnchoredButtonInSection(section, item.block)) {
          continue;
        }
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
        if (isHiddenEditorOnlySection(item.child, state.documentMeta, state.showAdvancedEditor)) {
          continue;
        }
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
    const mode = pending.mode;
    const label = `${capitalizePlacementMode(mode)} (in ${formatPlacementContainerLabel(options.container)})`;
    return `<button type="button" class="component-placement-target" data-action="place-component" data-section-key="${deps.escapeAttr(
      options.sectionKey
    )}" data-placement-container="${options.container}" data-placement="${options.placement}"${options.targetBlockId ? ` data-target-block-id="${deps.escapeAttr(options.targetBlockId)}"` : ''
      }${options.parentBlockId ? ` data-parent-block-id="${deps.escapeAttr(options.parentBlockId)}"` : ''}${options.targetGridItemId ? ` data-target-grid-item-id="${deps.escapeAttr(options.targetGridItemId)}"` : ''
      }>
      <span>${deps.escapeHtml(label)}</span>
    </button>`;
  }

  function capitalizePlacementMode(mode: ComponentPlacementState['mode']): string {
    return mode === 'copy' ? 'Copy' : 'Move';
  }

  function formatPlacementContainerLabel(container: Parameters<ComponentRenderHelpers['renderComponentPlacementTarget']>[0]['container']): string {
    if (container === 'component-list') {
      return 'list';
    }
    if (container === 'expandable-stub') {
      return 'expandable stub';
    }
    if (container === 'expandable-content') {
      return 'expandable content';
    }
    return container;
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
    if (block.schema.encryptedBlock) {
      return block.schema.encryptedBlock.id === targetBlockId || isDescendantActive(block.schema.encryptedBlock, targetBlockId);
    }
    return false;
  }

  function renderEditorBlock(sectionKey: string, block: VisualBlock, rootSections?: VisualSection[], parentLocked = false): string {
    if (isHiddenEditorOnlyScriptingBlock(block)) {
      return '';
    }
    const component = block.schema.component || 'text';
    const componentLabel = component === 'plugin' ? getPluginBlockHeaderLabel(block) : component === 'carousel' ? 'Carousel' : component;
    const isActiveFrame = deps.isActiveEditorBlock(sectionKey, block.id);
    const isActiveDescendant = state.activeEditorBlock?.sectionKey === sectionKey && isDescendantActive(block, state.activeEditorBlock.blockId);
    const isAiSectionEditBlock = isAiHostedSectionBlock(sectionKey, block);
    const isAiHostDescendant = isAiHostedBlockDescendant(sectionKey, block, rootSections ?? []);
    const isActive = isActiveFrame || isActiveDescendant || isAiSectionEditBlock || isAiHostDescendant;

    if (block.schema.kind === 'encrypted' && block.schema.encryptedBlock && !isActive) {
      return renderPassiveEditorBlock(sectionKey, block, rootSections ?? []);
    }

    if (!isActive) {
      return renderPassiveEditorBlock(sectionKey, block, rootSections ?? []);
    }

    const contentEditor = renderBlockContentEditor(sectionKey, block);
    const activationPath = getActivationPathIds(sectionKey, rootSections ?? []);
    const activationPathIndex = activationPath.indexOf(block.id);
    const isActivatingPath = state.pendingEditorActivation?.sectionKey === sectionKey
      && state.pendingEditorActivation.revealPath !== false
      && activationPathIndex >= 0;
    const activationStyle = isActivatingPath ? ` style="--editor-activation-delay: ${activationPathIndex * 150}ms;"` : '';
    const activationAttrs = isActiveFrame ? ` data-active-editor-block="true" data-active-block-id="${deps.escapeAttr(block.id)}"` : '';
    const anchorAttrs = renderButtonAnchorAttrs(sectionKey, block, rootSections ?? []);
    const owningSection = deps.findSectionByKey(rootSections ?? [], sectionKey);
    const isDirectSectionBlock = owningSection?.blocks.some((candidate) => candidate === block) === true;
    const editingReusableDefinition = state.editingReusableDefinition === true;
    const structurallyLocked = !editingReusableDefinition && (parentLocked || (isDirectSectionBlock && owningSection?.lock === true));
    const blockMove = isActiveFrame
      ? getBlockMoveAvailability(sectionKey, block.id, rootSections ?? [])
      : { canMoveUp: false, canMoveDown: false };
    const canRemove = isActive && !structurallyLocked;
    const placement = state.componentPlacement;
    const isPlacementSource = placement?.sectionKey === sectionKey && placement.blockId === block.id;
    const showActiveBlockDoneRow = isActiveFrame && !editingReusableDefinition;
    const encryptionAction = state.showAdvancedEditor && isActiveFrame && !editingReusableDefinition
      ? block.schema.kind === 'encrypted'
        ? `<button type="button" class="ghost" data-action="decrypt-component" data-section-key="${deps.escapeAttr(sectionKey)}" data-block-id="${deps.escapeAttr(block.id)}">Decrypt</button>`
        : `<button type="button" class="ghost" data-action="encrypt-component" data-section-key="${deps.escapeAttr(sectionKey)}" data-block-id="${deps.escapeAttr(block.id)}">Encrypt</button>`
      : '';
    const placementActions = canRemove
      ? isPlacementSource
        ? `<button type="button" class="secondary" data-action="cancel-component-placement" data-section-key="${deps.escapeAttr(sectionKey)}" data-block-id="${deps.escapeAttr(block.id)}">Cancel place</button>`
        : `<button type="button" class="ghost" data-action="start-component-move" data-section-key="${deps.escapeAttr(sectionKey)}" data-block-id="${deps.escapeAttr(block.id)}">Move</button>
           <button type="button" class="ghost" data-action="start-component-copy" data-section-key="${deps.escapeAttr(sectionKey)}" data-block-id="${deps.escapeAttr(block.id)}">Copy</button>`
      : '';
    const makeTemplateAction = editingReusableDefinition
      ? ''
      : `<button type="button" class="ghost" data-action="open-save-component-def" data-section-key="${deps.escapeAttr(
        sectionKey
      )}" data-block-id="${deps.escapeAttr(block.id)}">Make Template</button>`;
    const componentMetaActions = state.showAdvancedEditor && isActive
      ? `<div class="editor-block-context-actions" aria-label="Component options">
          ${makeTemplateAction}
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
    const insertAboveGhost = canRenderActiveComponentInsertGhost(isActiveFrame, structurallyLocked)
      ? renderActiveComponentInsertGhost(sectionKey, block, 'before')
      : '';
    const insertBelowGhost = canRenderActiveComponentInsertGhost(isActiveFrame, structurallyLocked)
      ? renderActiveComponentInsertGhost(sectionKey, block, 'after')
      : '';

    return `
      ${insertAboveGhost}
      <div class="editor-block${isActivatingPath ? ' is-activating-path' : ''}${isPlacementSource ? ' is-placement-source' : ''}" data-section-key="${deps.escapeAttr(sectionKey)}" data-block-id="${deps.escapeAttr(block.id)}"${activationStyle}${activationAttrs}>
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
            ${state.mobileAdjustmentMode ? '' : isActiveFrame ? `${encryptionAction}${placementActions}` : ''}
          </div>
        </div>

        <div class="editor-block-content${anchorAttrs.className}"${anchorAttrs.attrs}>
          ${contentEditor}
          ${anchorAttrs.overlay}
        </div>
        ${showActiveBlockDoneRow
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
      ${insertBelowGhost}
    `;
  }

  function canRenderActiveComponentInsertGhost(isActiveSelf: boolean, structurallyLocked: boolean): boolean {
    return isActiveSelf && state.currentView !== 'ai' && !structurallyLocked && !state.componentPlacement && !state.mobileAdjustmentMode;
  }

  function isAiHostedSectionBlock(sectionKey: string, block: VisualBlock): boolean {
    return state.currentView === 'ai'
      && state.aiEditorHostSectionKey === sectionKey
      && deps.findSectionByKey(state.documentSections, sectionKey)?.blocks.some((candidate) => candidate === block) === true;
  }

  function isAiHostedBlockDescendant(sectionKey: string, block: VisualBlock, rootSections: VisualSection[]): boolean {
    if (state.currentView !== 'ai') {
      return false;
    }
    if (state.aiEditorHostSectionKey === sectionKey) {
      const section = deps.findSectionByKey(state.documentSections, sectionKey);
      return section?.blocks.some((candidate) => candidate !== block && isDescendantActive(candidate, block.id)) === true;
    }
    const host = state.aiEditorHostBlock;
    if (!host || host.sectionKey !== sectionKey || host.blockId === block.id) {
      return false;
    }
    const section = deps.findSectionByKey(rootSections, sectionKey);
    const path = section ? findBlockPathIds(section.blocks, block.id) : null;
    return path?.includes(host.blockId) === true;
  }

  function renderActiveComponentInsertGhost(sectionKey: string, block: VisualBlock, placement: 'before' | 'after'): string {
    return `<div class="ghost-section-card add-ghost compact-add-component-ghost active-component-insert-ghost active-component-insert-ghost-${placement}">
      <span class="active-component-insert-label">Insert ${placement === 'before' ? 'Above' : 'Below'}</span>
      ${renderComponentPicker({
      id: `block:${block.id}:${placement}`,
      action: 'add-block',
      sectionKey,
      label: `Insert component ${placement === 'before' ? 'above' : 'below'}`,
      extraAttrs: {
        'data-insert-placement': placement,
        'data-target-block-id': block.id,
      },
      ...(isPdfEditorDocument() ? { componentFilter: isPdfAllowedEditorComponent, componentDisabledReason: getPdfDisabledComponentReason } : {}),
    })}
    </div>`;
  }

  function renderPassiveEditorBlock(sectionKey: string, block: VisualBlock, rootSections: VisualSection[]): string {
    if (isHiddenEditorOnlyScriptingBlock(block)) {
      return '';
    }
    const section = deps.findSectionByKey(rootSections, sectionKey);
    if (!section) {
      return '';
    }
    const anchorAttrs = renderButtonAnchorAttrs(sectionKey, block, rootSections);
    const visibleState = block.schema.visibleScript.trim() ? 'pending' : 'visible';
    if (block.schema.kind === 'encrypted' && !block.schema.encryptedBlock && !state.showAdvancedEditor) {
      return '';
    }
    return `
      <div class="editor-block-passive hvy-link-observer-surface" data-hvy-dynamic-visibility="true" data-visible-state="${deps.escapeAttr(visibleState)}" data-action="activate-block" data-section-key="${deps.escapeAttr(sectionKey)}" data-block-id="${deps.escapeAttr(
      block.id
    )}">
        <div class="editor-block-content${anchorAttrs.className}"${anchorAttrs.attrs}>
          ${renderPassiveEditorBlockContent(sectionKey, section, block, rootSections)}
          ${anchorAttrs.overlay}
        </div>
      </div>
    `;
  }

  function isAnchoredButtonInSection(section: VisualSection, block: VisualBlock): boolean {
    if (state.showAdvancedEditor) {
      return false;
    }
    if (deps.resolveBaseComponent(block.schema.component) !== 'button') {
      return false;
    }
    const targetId = block.schema.buttonPositionTargetId.trim();
    if (!targetId) {
      return false;
    }
    return section.blocks.some((candidate) => candidate !== block && candidate.schema.id.trim() === targetId);
  }

  function isHiddenEditorOnlyScriptingBlock(block: VisualBlock): boolean {
    return !state.showAdvancedEditor
      && block.schema.editorOnly
      && deps.resolveBaseComponent(block.schema.component) === 'plugin'
      && block.schema.plugin === SCRIPTING_PLUGIN_ID;
  }

  function renderButtonAnchorAttrs(
    sectionKey: string,
    block: VisualBlock,
    rootSections: VisualSection[]
  ): { className: string; attrs: string; overlay: string } {
    const componentId = block.schema.id.trim();
    const section = deps.findSectionByKey(rootSections, sectionKey);
    const buttons = componentId && section
      ? section.blocks.filter((candidate) =>
        deps.resolveBaseComponent(candidate.schema.component) === 'button'
        && candidate.schema.buttonPositionTargetId.trim() === componentId
      )
      : [];
    const componentAttr = componentId ? ` data-component-id="${deps.escapeAttr(componentId)}"` : '';
    if (buttons.length === 0) {
      return { className: '', attrs: componentAttr, overlay: '' };
    }
    const helpers = deps.getComponentRenderHelpers();
    const overlay = `<div class="hvy-button-overlay-layer">${buttons.map((button) => renderButtonEditor(sectionKey, button, helpers)).join('')}</div>`;
    return {
      className: ' hvy-button-position-anchor',
      attrs: `${componentAttr} data-hvy-button-anchor="true"`,
      overlay,
    };
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
    return getSectionFilteredMoveAvailability(sections, sectionKey, isEditorOrderSibling);
  }

  function isEditorOrderSibling(candidate: VisualSection, target: VisualSection, parent: VisualSection | null): boolean {
    if (candidate.isGhost || isHiddenEditorOnlySection(candidate, state.documentMeta, state.showAdvancedEditor)) {
      return false;
    }
    return parent !== null || candidate.location === target.location;
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

    if (base === 'encrypted') {
      if (block.schema.encryptedBlock) {
        return renderPassiveEditorBlock(sectionKey, block.schema.encryptedBlock, rootSections);
      }
      if (!state.showAdvancedEditor) {
        return '';
      }
      return renderEncryptedComponentEditor(sectionKey, block);
    }

    if (base === 'container') {
      deps.ensureContainerBlocks(block);
      const body = renderPassiveContainerBlocks(sectionKey, block, rootSections);
      return body
        ? `<div class="reader-container-body">${body}</div>`
        : '<div class="container-inner-blocks is-empty is-passive-empty"><div class="container-empty-placeholder">Empty container</div></div>';
    }

    if (base === 'expandable') {
      deps.ensureExpandableBlocks(block);
      const expandableStateKey = `${sectionKey}:${block.id}`;
      const expanded = state.readerExpandableState[expandableStateKey] ?? block.schema.expandableExpanded;
      const alwaysShowStub = block.schema.expandableAlwaysShowStub;
      const stubPaneStyle = deps.escapeAttr(sanitizeInlineCss(block.schema.expandableStubCss));
      const contentPaneStyle = deps.escapeAttr(sanitizeInlineCss(block.schema.expandableContentCss));
      const stubHtml = block.schema.expandableStubBlocks.children
        .map((innerBlock) => renderPassiveEditorBlock(sectionKey, innerBlock, rootSections))
        .join('');
      const contentHtml = block.schema.expandableContentBlocks.children
        .map((innerBlock) => renderPassiveEditorBlock(sectionKey, innerBlock, rootSections))
        .join('');
      const hasStubContent = stubHtml.trim().length > 0;
      const hasExpandedContent = contentHtml.trim().length > 0;
      const stubBody = hasStubContent ? stubHtml : '<div class="expandable-passive-empty-ghost">Empty stub</div>';
      const contentBody = hasExpandedContent ? contentHtml : '<div class="expandable-passive-empty-ghost">Empty expanded content</div>';
      const stubToggle = `<div class="expandable-reader-pane expandable-reader-pane-stub"><div class="expand-stub-toggle" style="${stubPaneStyle}" data-action="toggle-editor-expandable" data-section-key="${deps.escapeAttr(
        sectionKey
      )}" data-block-id="${deps.escapeAttr(block.id)}" aria-expanded="${expanded ? 'true' : 'false'}"><div class="expand-stub">${stubBody}</div></div></div>`;
      const expandedPanel = `<div class="expandable-reader-pane expandable-reader-pane-expanded"><div class="expand-content" style="${contentPaneStyle}">${contentBody}</div></div>`;
      const collapsedContentPreview = `<div class="expandable-reader-pane expandable-reader-pane-expanded expandable-reader-pane-content-preview"><div class="expand-content" style="${contentPaneStyle}" data-action="toggle-editor-expandable" data-section-key="${deps.escapeAttr(
        sectionKey
      )}" data-block-id="${deps.escapeAttr(block.id)}" aria-expanded="false">${contentBody}</div></div>`;
      const body = !hasStubContent && !hasExpandedContent
        ? `${stubToggle}${expandedPanel}`
        : expanded
          ? alwaysShowStub && hasStubContent
            ? `${stubToggle}${expandedPanel}`
            : `${expandedPanel}<div class="expand-collapse-strip" data-action="toggle-editor-expandable" data-section-key="${deps.escapeAttr(
              sectionKey
            )}" data-block-id="${deps.escapeAttr(block.id)}" aria-expanded="true">Collapse</div>`
          : hasStubContent
            ? stubToggle
            : collapsedContentPreview;
      const className = [
        'expandable-reader',
        'is-interactive',
        expanded ? 'is-expanded' : 'is-collapsed',
        hasStubContent ? '' : 'has-empty-stub',
      ].filter(Boolean).join(' ');

      return `<div class="${deps.escapeAttr(className)}">
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
        <div class="ghost-plus-small">${plusIcon()}</div>
        <div class="ghost-label">${deps.escapeHtml(actionLabel)}</div>
      </div>`;
      if (!hasComponentListItems(block)) {
        const existingContent = block.schema.componentListBlocks.length > 0
          ? state.currentView === 'ai'
            ? `<div class="reader-component-list">${block.schema.componentListBlocks
              .map((innerBlock) => renderPassiveEditorBlock(sectionKey, innerBlock, rootSections))
              .join('')}</div>`
            : deps.renderReaderBlock(section, block)
          : '';
        return `${existingContent}<div class="ghost-section-card add-ghost component-list-add-ghost passive-empty-list-ghost"${actionAttr}>
          <div class="ghost-plus-small">${plusIcon()}</div>
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
      const leadingPlacementTarget = state.componentPlacement && !block.schema.lock && block.schema.gridItems[0]
        ? renderComponentPlacementTarget({
          container: 'grid',
          sectionKey,
          parentBlockId: block.id,
          placement: 'before',
          targetGridItemId: block.schema.gridItems[0].id,
        })
        : '';
      const cells = block.schema.gridItems
        .map((item, index) => {
          const columnIndex = columns <= 1 ? 1 : (index % columns) + 1;
          const gridColumn = columns <= 1 ? '1 / -1' : `${columnIndex} / span 1`;
          const cellStyle = [
            `grid-column: ${gridColumn};`,
          ].filter(Boolean).join(' ');
          const beforePlacementTarget = index === 0 ? leadingPlacementTarget : '';
          const trailingPlacementTarget = state.componentPlacement && !block.schema.lock
            ? renderComponentPlacementTarget({
              container: 'grid',
              sectionKey,
              parentBlockId: block.id,
              placement: 'after',
              targetGridItemId: item.id,
            })
            : '';
          return `<div class="reader-grid-cell is-passive-grid-cell" style="${deps.escapeAttr(cellStyle)}">${beforePlacementTarget}${renderPassiveEditorBlock(
            sectionKey,
            item.block,
            rootSections
          )}${trailingPlacementTarget}</div>`;
        })
        .join('');
      return `<div class="reader-grid-layout editor-grid-passive-preview" style="grid-template-columns: repeat(${columns}, minmax(0, 1fr));">${cells}</div>`;
    }

    if (base === 'plugin' && block.schema.plugin === SCRIPTING_PLUGIN_ID) {
      if (block.text.trim().length === 0) {
        return `<div class="editor-passive-empty-text">Empty script...</div>`;
      }
      return renderSyntaxHighlightedCode(block.text, 'python', block.schema.editorOnly ? { badge: 'editor script' } : undefined);
    }

    if (base === 'button') {
      const targetId = block.schema.buttonPositionTargetId.trim();
      const targetSummary = targetId ? ` anchored to ${targetId}` : ' inline';
      return `<div class="editor-passive-empty-text">Button: ${deps.escapeHtml(block.schema.buttonLabel || 'Generate')}${deps.escapeHtml(targetSummary)}</div>`;
    }

    if (base === 'text' && block.text.trim().length === 0) {
      const hint = block.schema.placeholder || 'Empty text...';
      const content = block.schema.placeholder
        ? renderTextFragment(hint)
        : deps.escapeHtml(hint);
      const alignStyle = block.schema.align === 'left' ? '' : ` style="text-align: ${deps.escapeAttr(block.schema.align)};"`;
      return `<div class="editor-passive-empty-text${block.schema.placeholder ? ' has-placeholder' : ''}"${alignStyle}>${content}</div>`;
    }

    return deps.renderReaderBlock(section, block, { suppressAiEditorDelegation: true });
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
      textLineStyles?: TextLineStyles;
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
            <button type="button" class="icon-button${selectedClass(options.align === 'left')}" data-action="set-block-align" data-align-value="left" ${richButtonAttrs} aria-label="Align left" title="Align left"><span class="toolbar-icon align-left-icon" aria-hidden="true"></span></button>
            <button type="button" class="icon-button${selectedClass(options.align === 'center')}" data-action="set-block-align" data-align-value="center" ${richButtonAttrs} aria-label="Align center" title="Align center"><span class="toolbar-icon align-center-icon" aria-hidden="true"></span></button>
            <button type="button" class="icon-button${selectedClass(options.align === 'right')}" data-action="set-block-align" data-align-value="right" ${richButtonAttrs} aria-label="Align right" title="Align right"><span class="toolbar-icon align-right-icon" aria-hidden="true"></span></button>
          </div>`
        : '';
    const textLineStyles = options?.textLineStyles ?? {};
    const textLineStyleControls = renderTextLineStyleToolbar(textLineStyles, richButtonAttrs, sectionKey, blockId);
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
          <button type="button" class="icon-button${selectedClass(blockStyle === 'ordered-list')}" data-rich-action="ordered-list" ${richButtonAttrs} aria-label="Numbered List" title="Numbered List"><span class="toolbar-icon ordered-list-icon" aria-hidden="true"></span></button>
          <button type="button" class="icon-button${selectedClass(blockStyle === 'checklist')}" data-rich-action="checklist" ${richButtonAttrs} aria-label="Checkbox" title="Checkbox"><span class="toolbar-icon checkbox-icon" aria-hidden="true">☑</span></button>
          <button type="button" class="icon-button ghost" data-rich-action="link" ${richButtonAttrs} aria-label="Link" title="Link (${hotkeyModifier}+K)"><span class="toolbar-icon link-icon" aria-hidden="true"></span></button>
        </div>
        ${textLineStyleControls}
      </div>
    `;
  }

  function renderTextLineStyleToolbar(styles: TextLineStyles, richButtonAttrs: string, sectionKey: string, blockId: string): string {
    const names = Object.keys(styles).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
    if (names.length === 0) {
      return '';
    }
    const visibleNames = getRecentParagraphStyleNames(names);
    const pickerId = `paragraph-style-picker-${sectionKey}-${blockId}`.replace(/[^a-zA-Z0-9_-]/g, '-');
    const renderStyleButton = (name: string, extraClass = ''): string => {
      const style = styles[name];
      const label = getTextLineStyleLabel(name, style);
      const css = getTextLineStylePreviewCss(style.css);
      return `<button
        type="button"
        class="ghost text-line-style-pill paragraph-style-card${extraClass}"
        data-rich-action="text-line-style"
        data-text-line-style-name="${deps.escapeAttr(name)}"
        ${richButtonAttrs}
        title="${deps.escapeAttr(`Apply ${label}`)}"
      ><span class="text-line-style-pill-sample" style="${deps.escapeAttr(css)}">${deps.escapeHtml(label)}</span></button>`;
    };
    return `<div class="toolbar-segment text-line-style-toolbar paragraph-style-toolbar" role="group" aria-label="Paragraph style">
      <span class="text-line-style-toolbar-label">Paragraph Style</span>
      <button
        type="button"
        class="ghost text-line-style-pill paragraph-style-card text-line-style-clear"
        data-rich-action="text-line-style"
        data-text-line-style-name=""
        ${richButtonAttrs}
        title="Use normal paragraph style"
      ><span class="text-line-style-pill-sample">Normal</span></button>
      <span class="paragraph-style-recent">
        ${visibleNames.map((name) => renderStyleButton(name)).join('')}
      </span>
      <button
          type="button"
          class="ghost icon-button paragraph-style-expand"
          data-action="open-paragraph-style-picker"
          ${richButtonAttrs}
          aria-expanded="false"
          aria-controls="${deps.escapeAttr(pickerId)}"
          aria-label="More paragraph styles"
          title="More paragraph styles"
        >…</button>
      <div class="paragraph-style-modal" id="${deps.escapeAttr(pickerId)}" role="dialog" aria-label="Paragraph styles" aria-modal="false">
        <div class="paragraph-style-modal-card">
          <div class="paragraph-style-modal-head">
            <strong>Paragraph Style</strong>
            <button type="button" class="ghost icon-button" data-action="close-paragraph-style-picker" ${richButtonAttrs} aria-label="Close paragraph styles">×</button>
          </div>
          <div class="paragraph-style-modal-list">
            <button
              type="button"
              class="ghost text-line-style-pill paragraph-style-card text-line-style-clear"
              data-rich-action="text-line-style"
              data-text-line-style-name=""
              ${richButtonAttrs}
              title="Use normal paragraph style"
            ><span class="text-line-style-pill-sample">Normal</span></button>
            ${names.map((name) => renderStyleButton(name, ' paragraph-style-modal-option')).join('')}
          </div>
        </div>
      </div>
      <div class="paragraph-style-edit-modal" role="dialog" aria-label="Edit paragraph style" aria-modal="false">
        <div class="paragraph-style-edit-card">
          <div class="paragraph-style-modal-head">
            <strong>Edit Paragraph Style</strong>
            <button type="button" class="ghost icon-button" data-action="close-paragraph-style-edit" ${richButtonAttrs} aria-label="Close paragraph style editor">×</button>
          </div>
          ${names.map((name) => renderParagraphStyleEditPanel(name, styles[name])).join('')}
        </div>
      </div>
    </div>`;
  }

  function getRecentParagraphStyleNames(names: string[]): string[] {
    const available = new Set(names);
    const recent = state.paragraphStyleRecentNames.filter((name) => available.has(name));
    const remaining = names.filter((name) => !recent.includes(name));
    return [...recent, ...remaining].slice(0, 2);
  }

  function renderParagraphStyleEditPanel(name: string, style: TextLineStyles[string]): string {
    const label = getTextLineStyleLabel(name, style);
    const spacing = getTextLineStyleSpacing(style.css);
    const rawCss = formatTextLineStyleCssLines(style.css);
    const renderSpacingInput = (property: string, shortLabel: string): string => `<label class="paragraph-style-box-field paragraph-style-box-field-${deps.escapeAttr(property)}">
      <span class="${property.startsWith('margin-') ? 'paragraph-style-margin-mobile-label' : 'sr-only'}">${shortLabel}</span>
      <input data-field="text-line-style-spacing" data-style-name="${deps.escapeAttr(name)}" data-css-property="${deps.escapeAttr(property)}" value="${deps.escapeAttr(spacing[property] ?? '')}" placeholder="0" aria-label="${deps.escapeAttr(`${shortLabel} ${property.startsWith('margin-') ? 'margin' : 'padding'}`)}" />
    </label>`;
    const boxModel = `<div class="paragraph-style-box-model" aria-label="${deps.escapeAttr(`${label} box model spacing`)}">
        <strong class="paragraph-style-box-model-label paragraph-style-box-model-label-margin">Margin</strong>
        ${renderSpacingInput('margin-top', 'Top')}
        ${renderSpacingInput('margin-right', 'Right')}
        ${renderSpacingInput('margin-bottom', 'Bottom')}
        ${renderSpacingInput('margin-left', 'Left')}
        <div class="paragraph-style-padding-box">
          <strong class="paragraph-style-box-model-label paragraph-style-box-model-label-padding">Padding</strong>
          ${renderSpacingInput('padding-top', 'Top')}
          ${renderSpacingInput('padding-right', 'Right')}
          ${renderSpacingInput('padding-bottom', 'Bottom')}
          ${renderSpacingInput('padding-left', 'Left')}
        </div>
      </div>`;
    return `<div class="paragraph-style-edit-panel" data-edit-style-name="${deps.escapeAttr(name)}" hidden>
      <div class="paragraph-style-edit-title">
        <span>${deps.escapeHtml(label)}</span>
        <code>${deps.escapeHtml(name)}</code>
      </div>
      ${boxModel}
      <label class="paragraph-style-css-lines">
        <span>CSS declarations</span>
        <textarea rows="5" data-field="text-line-style-css" data-style-name="${deps.escapeAttr(name)}" spellcheck="false">${deps.escapeHtml(rawCss)}</textarea>
      </label>
    </div>`;
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
    const textLineStyles = getTextLineStylesFromMeta(state.documentMeta);
    const headingStyles = getHeadingStylesFromMeta(state.documentMeta);
    const imageAttachmentMaxDimensions = state.documentMeta.image_attachment_max_dimensions && typeof state.documentMeta.image_attachment_max_dimensions === 'object' && !Array.isArray(state.documentMeta.image_attachment_max_dimensions)
      ? state.documentMeta.image_attachment_max_dimensions as { width?: unknown; height?: unknown }
      : {};
    const globalImageAttachmentMaxDimensions = resolveImageAttachmentMaxDimensions(state.imageAttachmentMaxDimensions);
    const imageAttachmentReductionStatus = state.imageAttachmentReductionStatus ?? null;
    const imageAttachmentReductionComplete = imageAttachmentReductionStatus?.state === 'reduced' || imageAttachmentReductionStatus?.state === 'unchanged';
    const imageAttachmentReductionButtonLabel = imageAttachmentReductionStatus?.message ?? 'Apply to Existing Images';
    const imageAttachmentReductionButtonClass = [
      'ghost',
      'meta-image-reduction-button',
      imageAttachmentReductionStatus ? `is-${imageAttachmentReductionStatus.state}` : '',
    ].filter(Boolean).join(' ');
    const imageAttachmentReductionButtonDisabled = imageAttachmentReductionStatus?.state === 'reducing' || imageAttachmentReductionComplete;
    const descriptionPopulate = state.descriptionPopulate ?? { isRunning: false, status: null, completed: 0, total: 0, current: '', skippedLeaves: 0, lastGenerated: '' };
    const pdfPageMeta = readPdfPageMetaObject(state.documentMeta);
    const rawPdfPageSettings = resolvePdfPageSettings(state.documentMeta);
    const pdfPageSettings = resolvePdfPageDimensions(rawPdfPageSettings);
    const pdfPageSizeValue = typeof rawPdfPageSettings.pageSize === 'string'
      ? rawPdfPageSettings.pageSize.trim().toUpperCase()
      : 'CUSTOM';
    const pdfMargins = Array.isArray(pdfPageMeta.margins) ? pdfPageMeta.margins : [];
    const pdfMarginUnit = inferPdfPageMarginUnit(pdfPageMeta.margins);
    const pdfMarginValue = (index: number) => {
      const value = pdfMargins[index];
      const points = typeof value === 'number' || typeof value === 'string' ? pdfPageLengthToPoints(value) : null;
      return points === null ? '' : formatPdfPointsAsUnit(points, pdfMarginUnit);
    };
    const pdfPresetControls = state.pdfStylePresets.length > 0
      ? `<div class="meta-pdf-preset-picker">
          <label>
            <span>PDF Preset</span>
            <select data-field="meta-pdf-style-preset">
              ${renderPdfPresetOptions(state.pdfStylePresets, getActivePdfStylePresetId(state.pdfStylePresets))}
            </select>
          </label>
          <button type="button" class="secondary" data-action="apply-pdf-style-preset">Apply</button>
        </div>
        ${renderPdfPresetDescription(state.pdfStylePresets, getActivePdfStylePresetId(state.pdfStylePresets))}`
      : '';
    const pdfPageControls = state.documentExtension === '.phvy'
      ? `${pdfPresetControls}
        <div class="meta-pdf-document-options">
          <label class="meta-pdf-page-size-field">
            <span>PDF Page Size</span>
            <select data-field="meta-pdf-page-size">
              ${renderPdfPageSizeOptions(pdfPageSizeValue)}
            </select>
          </label>
        </div>
        <div class="meta-pdf-page-grid">
          <div class="meta-pdf-page-heading">
            <span>PDF Margins</span>
            ${renderPdfMarginUnitToggle(pdfMarginUnit)}
          </div>
          ${renderPdfMarginInput('Left', 'meta-pdf-margin-left', pdfPageSettings.pageMargins[0], pdfMarginValue(0), pdfMarginUnit)}
          ${renderPdfMarginInput('Top', 'meta-pdf-margin-top', pdfPageSettings.pageMargins[1], pdfMarginValue(1), pdfMarginUnit)}
          ${renderPdfMarginInput('Right', 'meta-pdf-margin-right', pdfPageSettings.pageMargins[2], pdfMarginValue(2), pdfMarginUnit)}
          ${renderPdfMarginInput('Bottom', 'meta-pdf-margin-bottom', pdfPageSettings.pageMargins[3], pdfMarginValue(3), pdfMarginUnit)}
        </div>
        <label class="checkbox-label">
          <span>PDF Debug Bounds</span>
          <input
            type="checkbox"
            data-field="meta-pdf-debug"
            ${pdfPageMeta.debug === true ? 'checked' : ''}
          />
        </label>`
      : '';
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
          <span>Description</span>
          <textarea
            rows="3"
            data-field="meta-description"
            placeholder="Describe this document"
          >${deps.escapeHtml(String(state.documentMeta.description ?? ''))}</textarea>
        </label>
        <label>
          <span>Tags</span>
          <input data-field="meta-tags" placeholder="Enter comma separated tags for this document" value="${deps.escapeAttr(formatDocumentMetaTags(state.documentMeta.tags))}" />
        </label>
        <label>
          <span>Sidebar Label</span>
          <input data-field="meta-sidebar-label" placeholder="☰" value="${deps.escapeAttr(String(state.documentMeta.sidebar_label ?? ''))}" />
        </label>
        <label>
          <span>Reader Max Width</span>
          <input data-field="meta-reader-max-width" placeholder="60rem" value="${deps.escapeAttr(String(state.documentMeta.reader_max_width ?? ''))}" />
        </label>
        ${pdfPageControls}
        <div class="meta-image-reduction-row">
          <span>Reduce new image sizes to fit:</span>
          <input aria-label="Image reduce width" data-field="meta-image-attachment-max-width" type="number" min="1" max="16384" step="1" placeholder="${deps.escapeAttr(globalImageAttachmentMaxDimensions ? String(globalImageAttachmentMaxDimensions.width) : '')}" value="${deps.escapeAttr(String(imageAttachmentMaxDimensions.width ?? ''))}" />
          <span aria-hidden="true">w</span>
          <span aria-hidden="true">x</span>
          <input aria-label="Image reduce height" data-field="meta-image-attachment-max-height" type="number" min="1" max="16384" step="1" placeholder="${deps.escapeAttr(globalImageAttachmentMaxDimensions ? String(globalImageAttachmentMaxDimensions.height) : '')}" value="${deps.escapeAttr(String(imageAttachmentMaxDimensions.height ?? ''))}" />
          <span aria-hidden="true">h</span>
          <button type="button" class="${deps.escapeAttr(imageAttachmentReductionButtonClass)}" data-action="reduce-existing-image-attachments"${imageAttachmentReductionButtonDisabled ? ' disabled' : ''}>${deps.escapeHtml(imageAttachmentReductionButtonLabel)}</button>
        </div>
        <label class="checkbox-label">
          <span>New Sections Contained</span>
          <input
            type="checkbox"
            data-field="meta-section-contained-default"
            ${getDocumentSectionContainedDefault(state.documentMeta) ? 'checked' : ''}
          />
        </label>
        <details class="meta-expandable-field">
          <summary>
            <span>AI Context</span>
            ${String(state.documentMeta['ai-context'] ?? '').trim() ? '<span class="muted">Configured</span>' : ''}
          </summary>
          <label>
            <span>Instructions</span>
            <textarea
              rows="4"
              data-field="meta-ai-context"
              placeholder="Tell the AI how this document is organized and what intent to preserve."
            >${deps.escapeHtml(String(state.documentMeta['ai-context'] ?? ''))}</textarea>
          </label>
        </details>
        <details class="meta-expandable-field">
          <summary>
            <span>AI Import Guidance</span>
            ${String(state.documentMeta['ai-import-guidance'] ?? '').trim() ? '<span class="muted">Configured</span>' : ''}
          </summary>
          <label>
            <span>Instructions</span>
            <textarea
              rows="5"
              data-field="meta-ai-import-guidance"
              placeholder="Tell import how source facts should map to sections, templates, and template records."
            >${deps.escapeHtml(String(state.documentMeta['ai-import-guidance'] ?? ''))}</textarea>
          </label>
        </details>
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
        <div class="editor-grid">
          <label>
            <span>Theme Colors</span>
            <button type="button" class="ghost" data-action="open-theme-modal">
              Edit Colors${colorCount > 0 ? ` (${colorCount} override${colorCount === 1 ? '' : 's'})` : ''}
            </button>
          </label>
        </div>
        <div class="meta-panel-head">
          <strong>Paragraph Styles</strong>
          <button type="button" class="ghost" data-action="add-text-line-style">Add Style</button>
        </div>
        <div class="text-line-style-editor">
          ${renderTextLineStyleEditorRows(textLineStyles)}
        </div>
        <div class="meta-panel-head">
          <strong>Heading Styles</strong>
        </div>
        <div class="text-line-style-editor heading-style-editor">
          ${renderHeadingStyleEditorRows(headingStyles)}
        </div>
        <div class="meta-panel-head">
          <strong>Component Templates</strong>
          <button type="button" class="ghost" data-action="add-component-def">Add Template</button>
        </div>
        <div class="component-defs">
          ${defs.length === 0
        ? '<div class="muted template-def-empty">No component templates</div>'
        : defs
          .map(
            (def, index) => {
              const flavors = Array.isArray(def.flavors) ? def.flavors : [];
              const detailsKey = templateDefinitionDetailsKey('component', index);
              return `<details class="component-def template-def-details" data-template-kind="component" data-def-index="${index}"${state.openTemplateDefinitionKeys.includes(detailsKey) ? ' open' : ''}>
                <summary class="template-def-summary">
                  <span class="template-def-summary-text">
                    <strong>${deps.escapeHtml(def.name || 'Untitled Template')}</strong>
                    <span>${deps.escapeHtml(def.baseType)}${flavors.length > 0 ? ` · ${flavors.length} flavor${flavors.length === 1 ? '' : 's'}` : ''}</span>
                  </span>
                  <span class="template-def-summary-actions">
                    <button type="button" class="secondary" data-action="open-reusable-definition-editor" data-template-kind="component" data-def-index="${index}">Edit Template</button>
                    <span class="template-def-summary-icon" aria-hidden="true">⌄</span>
                  </span>
                </summary>
                <div class="template-def-body">
                  <label>
                    <span>Name</span>
                    <input data-field="def-name" data-def-index="${index}" value="${deps.escapeAttr(def.name)}" />
                  </label>
                  <div class="template-meta-display">
                    <span>Base Type</span>
                    <strong>${deps.escapeHtml(def.baseType)}</strong>
                  </div>
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
                  ${deps.resolveBaseComponent(def.baseType) === 'xref-card'
                  ? `<label>
                    <span>Target Tag Filter</span>
                    <input data-field="def-xref-target-tag-filter" data-def-index="${index}" placeholder="tag-name" value="${deps.escapeAttr(def.template?.schema.xrefTargetTagFilter ?? def.schema?.xrefTargetTagFilter ?? '')}" />
                  </label>`
                  : ''
                }
                  <div class="meta-panel-head">
                    <strong>Flavors</strong>
                  </div>
                  ${flavors.length === 0
                  ? '<div class="muted">No flavors. Import uses the main component template.</div>'
                  : `${flavors.length === 1 ? '<div class="muted">One saved flavor. Import uses flavor choices after there are at least two options.</div>' : ''}
                    ${flavors.map((flavor, flavorIndex) => `<div class="component-def-flavor">
                      <label>
                        <span>Flavor Name</span>
                        <input data-field="def-flavor-name" data-def-index="${index}" data-flavor-index="${flavorIndex}" value="${deps.escapeAttr(flavor.name)}" />
                      </label>
                      <label>
                        <span>Flavor Description</span>
                        <textarea rows="2" data-field="def-flavor-description" data-def-index="${index}" data-flavor-index="${flavorIndex}">${deps.escapeHtml(flavor.description ?? '')}</textarea>
                      </label>
                  <button type="button" class="danger" data-action="remove-component-def-flavor" data-def-index="${index}" data-flavor-index="${flavorIndex}">Remove Flavor</button>
                    </div>`).join('')}`}
                  <button type="button" class="danger" data-action="remove-component-def" data-def-index="${index}">Remove</button>
                </div>
              </details>`;
            }
          )
          .join('')}
        </div>
        <div class="meta-panel-head">
          <strong>Section Templates</strong>
        </div>
        <div class="component-defs">
          ${sectionDefs.length === 0
        ? '<div class="muted">Save a section as a template from its header to make it available here and in the add-section controls.</div>'
        : sectionDefs
          .map(
            (def, index) => {
              const flavors = Array.isArray(def.flavors) ? def.flavors : [];
              const detailsKey = templateDefinitionDetailsKey('section', index);
              return `<details class="component-def template-def-details" data-template-kind="section" data-section-def-index="${index}"${state.openTemplateDefinitionKeys.includes(detailsKey) ? ' open' : ''}>
                      <summary class="template-def-summary">
                        <span class="template-def-summary-text">
                          <strong>${deps.escapeHtml(def.name || 'Untitled Template')}</strong>
                          <span>Section template · ${def.repeatable === true ? 'multiple allowed' : 'one per document'}${flavors.length > 0 ? ` · ${flavors.length} flavor${flavors.length === 1 ? '' : 's'}` : ''}</span>
                        </span>
                        <span class="template-def-summary-actions">
                          <button type="button" class="secondary" data-action="open-reusable-definition-editor" data-template-kind="section" data-section-def-index="${index}">Edit Template</button>
                          <span class="template-def-summary-icon" aria-hidden="true">⌄</span>
                        </span>
                      </summary>
                      <div class="template-def-body">
                        <label>
                          <span>Name</span>
                          <input data-field="section-def-name" data-section-def-index="${index}" value="${deps.escapeAttr(def.name)}" />
                        </label>
                        <label class="checkbox-label">
                          <span>Allow Multiple Per Document</span>
                          <input type="checkbox" data-field="section-def-repeatable" data-section-def-index="${index}" ${def.repeatable === true ? 'checked' : ''} />
                        </label>
                        <div class="meta-panel-head">
                          <strong>Flavors</strong>
                        </div>
                        ${flavors.length === 0
                  ? '<div class="muted">No flavors. Import uses the main section template.</div>'
                  : `${flavors.length === 1 ? '<div class="muted">One saved flavor. Import uses flavor choices after there are at least two options.</div>' : ''}
                        ${flavors.map((flavor, flavorIndex) => `<div class="component-def-flavor">
                            <label>
                              <span>Flavor Name</span>
                              <input data-field="section-def-flavor-name" data-section-def-index="${index}" data-flavor-index="${flavorIndex}" value="${deps.escapeAttr(flavor.name)}" />
                            </label>
                            <label>
                              <span>Flavor Description</span>
                              <textarea rows="2" data-field="section-def-flavor-description" data-section-def-index="${index}" data-flavor-index="${flavorIndex}">${deps.escapeHtml(flavor.description ?? '')}</textarea>
                            </label>
                            <button type="button" class="danger" data-action="remove-section-def-flavor" data-section-def-index="${index}" data-flavor-index="${flavorIndex}">Remove Flavor</button>
                          </div>`).join('')}`}
                          <button type="button" class="danger" data-action="remove-section-def" data-section-def-index="${index}">Remove</button>
                        </div>
                      </details>`;
            }
          )
          .join('')
      }
        </div>
      </section>
    `;
  }

  function renderPdfMarginUnitToggle(unit: PdfPageMarginUnit): string {
    return `<div class="meta-pdf-unit-toggle" role="radiogroup" aria-label="PDF margin unit">
      ${(['in', 'cm'] as PdfPageMarginUnit[]).map((option) => `
        <label class="${unit === option ? 'is-active' : ''}">
          <input type="radio" name="meta-pdf-margin-unit" data-field="meta-pdf-margin-unit" value="${option}" ${unit === option ? 'checked' : ''} />
          <span>${option}</span>
        </label>
      `).join('')}
    </div>`;
  }

  function renderPdfPageSizeOptions(value: string): string {
    const normalized = (PDF_DOCUMENT_PAGE_SIZE_OPTIONS as readonly string[]).includes(value) ? value : 'CUSTOM';
    const customOption = normalized === 'CUSTOM'
      ? '<option value="CUSTOM" selected disabled>Custom</option>'
      : '';
    return `${customOption}${PDF_DOCUMENT_PAGE_SIZE_OPTIONS.map((option) => `<option value="${option}" ${normalized === option ? 'selected' : ''}>${option}</option>`).join('')}`;
  }

  function renderPdfMarginInput(label: string, field: string, placeholderPoints: number, value: string, unit: PdfPageMarginUnit): string {
    return `<label class="meta-pdf-margin-field">
      <span>${deps.escapeHtml(label)}</span>
      <input aria-label="PDF ${deps.escapeAttr(label.toLowerCase())} margin in ${unit === 'cm' ? 'centimeters' : 'inches'}" data-field="${deps.escapeAttr(field)}" data-pdf-margin-unit="${unit}" type="number" min="0" max="${unit === 'cm' ? '10' : '4'}" step="0.05" placeholder="${deps.escapeAttr(formatPdfPointsAsUnit(placeholderPoints, unit))}" value="${deps.escapeAttr(value)}" />
    </label>`;
  }

  function getActivePdfStylePresetId(presets: readonly HvyPdfStylePreset[]): string {
    return presets.some((preset) => preset.id === state.pdfStylePresetId)
      ? state.pdfStylePresetId ?? ''
      : presets[0]?.id ?? '';
  }

  function renderPdfPresetOptions(presets: readonly HvyPdfStylePreset[], activeId: string): string {
    return presets
      .map((preset) => `<option value="${deps.escapeAttr(preset.id)}" ${preset.id === activeId ? 'selected' : ''}>${deps.escapeHtml(preset.label)}</option>`)
      .join('');
  }

  function renderPdfPresetDescription(presets: readonly HvyPdfStylePreset[], activeId: string): string {
    const description = presets.find((preset) => preset.id === activeId)?.description?.trim() ?? '';
    return `<div class="meta-pdf-preset-description" data-pdf-preset-description>${deps.escapeHtml(description)}</div>`;
  }

  function renderTextLineStyleEditorRows(styles: TextLineStyles): string {
    const names = Object.keys(styles).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
    if (names.length === 0) {
      return '<div class="muted text-line-style-empty">No paragraph styles yet. Add one to format repeated lines inside text blocks.</div>';
    }
    return names.map((name) => {
      const style = styles[name];
      const label = getTextLineStyleLabel(name, style);
      const css = getTextLineStylePreviewCss(style.css);
      const rawCss = formatTextLineStyleCssLines(style.css);
      const spacing = getTextLineStyleSpacing(style.css);
      const renderSpacingInput = (property: string, shortLabel: string): string => `<label class="paragraph-style-box-field paragraph-style-box-field-${deps.escapeAttr(property)}">
        <span class="${property.startsWith('margin-') ? 'paragraph-style-margin-mobile-label' : 'sr-only'}">${shortLabel}</span>
        <input data-field="text-line-style-spacing" data-style-name="${deps.escapeAttr(name)}" data-css-property="${deps.escapeAttr(property)}" value="${deps.escapeAttr(spacing[property] ?? '')}" placeholder="0" aria-label="${deps.escapeAttr(`${shortLabel} ${property.startsWith('margin-') ? 'margin' : 'padding'}`)}" />
      </label>`;
      const boxModel = `<div class="paragraph-style-box-model" aria-label="${deps.escapeAttr(`${label} box model spacing`)}">
            <strong class="paragraph-style-box-model-label paragraph-style-box-model-label-margin">Margin</strong>
            ${renderSpacingInput('margin-top', 'Top')}
            ${renderSpacingInput('margin-right', 'Right')}
            ${renderSpacingInput('margin-bottom', 'Bottom')}
            ${renderSpacingInput('margin-left', 'Left')}
            <div class="paragraph-style-padding-box">
              <strong class="paragraph-style-box-model-label paragraph-style-box-model-label-padding">Padding</strong>
              ${renderSpacingInput('padding-top', 'Top')}
              ${renderSpacingInput('padding-right', 'Right')}
              ${renderSpacingInput('padding-bottom', 'Bottom')}
              ${renderSpacingInput('padding-left', 'Left')}
            </div>
          </div>`;
      return `<details class="text-line-style-row template-def-details" data-text-line-style-name="${deps.escapeAttr(name)}"${state.openTextLineStyleName === name ? ' open' : ''}>
        <summary class="template-def-summary">
          <span class="template-def-summary-text">
            <strong data-text-line-style-sample-label>${deps.escapeHtml(label)}</strong>
            <span>${deps.escapeHtml(name)}</span>
          </span>
          <span class="template-def-summary-icon" aria-hidden="true">⌄</span>
        </summary>
        <div class="template-def-body">
          <div class="text-line-style-row-head">
            <label>
              <span>Name</span>
              <input data-field="text-line-style-name" data-style-name="${deps.escapeAttr(name)}" value="${deps.escapeAttr(name)}" spellcheck="false" />
            </label>
            <button type="button" class="danger remove-x" data-action="remove-text-line-style" data-style-name="${deps.escapeAttr(name)}" aria-label="Remove ${deps.escapeAttr(name)}">${closeIcon()}</button>
          </div>
          <label>
            <span>Label</span>
            <input data-field="text-line-style-label" data-style-name="${deps.escapeAttr(name)}" value="${deps.escapeAttr(style.label)}" placeholder="${deps.escapeAttr(name)}" />
          </label>
          ${boxModel}
          <label class="paragraph-style-css-lines">
            <span>CSS declarations</span>
            <textarea rows="5" data-field="text-line-style-css" data-style-name="${deps.escapeAttr(name)}" spellcheck="false" placeholder="font-weight: 700;">${deps.escapeHtml(rawCss)}</textarea>
          </label>
          <div class="text-line-style-preview">
            <span>Preview</span>
            <div class="text-line-style-sample" style="${deps.escapeAttr(css)}">
              <span data-text-line-style-sample-label>${deps.escapeHtml(label)}</span>
            </div>
          </div>
        </div>
      </details>`;
    }).join('');
  }

  function renderHeadingStyleEditorRows(styles: ReturnType<typeof getHeadingStylesFromMeta>): string {
    return HEADING_STYLE_NAMES.map((name) => {
      const style = styles[name];
      const label = getHeadingStyleLabel(name, style);
      const rawCss = formatHeadingStyleCssLines(style.css);
      const spacing = getHeadingStyleSpacing(style.css);
      const renderSpacingInput = (property: string, shortLabel: string): string => `<label class="paragraph-style-box-field paragraph-style-box-field-${deps.escapeAttr(property)}">
        <span class="${property.startsWith('margin-') ? 'paragraph-style-margin-mobile-label' : 'sr-only'}">${shortLabel}</span>
        <input data-field="heading-style-spacing" data-heading-style-name="${deps.escapeAttr(name)}" data-css-property="${deps.escapeAttr(property)}" value="${deps.escapeAttr(spacing[property] ?? '')}" placeholder="0" aria-label="${deps.escapeAttr(`${label} ${shortLabel.toLowerCase()} ${property.startsWith('margin-') ? 'margin' : 'padding'}`)}" />
      </label>`;
      const boxModel = `<div class="paragraph-style-box-model" aria-label="${deps.escapeAttr(`${label} box model spacing`)}">
            <strong class="paragraph-style-box-model-label paragraph-style-box-model-label-margin">Margin</strong>
            ${renderSpacingInput('margin-top', 'Top')}
            ${renderSpacingInput('margin-right', 'Right')}
            ${renderSpacingInput('margin-bottom', 'Bottom')}
            ${renderSpacingInput('margin-left', 'Left')}
            <div class="paragraph-style-padding-box">
              <strong class="paragraph-style-box-model-label paragraph-style-box-model-label-padding">Padding</strong>
              ${renderSpacingInput('padding-top', 'Top')}
              ${renderSpacingInput('padding-right', 'Right')}
              ${renderSpacingInput('padding-bottom', 'Bottom')}
              ${renderSpacingInput('padding-left', 'Left')}
            </div>
          </div>`;
      return `<details class="heading-style-row template-def-details" data-heading-style-name="${deps.escapeAttr(name)}">
        <summary class="template-def-summary">
          <span class="template-def-summary-text">
            <strong data-heading-style-sample-label>${deps.escapeHtml(label)}</strong>
            <span>${deps.escapeHtml(name.toUpperCase())}</span>
          </span>
          <span class="template-def-summary-icon" aria-hidden="true">⌄</span>
        </summary>
        <div class="template-def-body">
          <label>
            <span>Label</span>
            <input data-field="heading-style-label" data-heading-style-name="${deps.escapeAttr(name)}" value="${deps.escapeAttr(style.label)}" placeholder="${deps.escapeAttr(name.toUpperCase())}" />
          </label>
          ${boxModel}
          <label>
            <span>Top Margin After Content</span>
            <input data-field="heading-style-after-margin-top" data-heading-style-name="${deps.escapeAttr(name)}" value="${deps.escapeAttr(style.afterContentMarginTop)}" placeholder="0.7rem" />
          </label>
          <label class="paragraph-style-css-lines">
            <span>CSS declarations</span>
            <textarea rows="5" data-field="heading-style-css" data-heading-style-name="${deps.escapeAttr(name)}" spellcheck="false" placeholder="font-weight: 700;">${deps.escapeHtml(rawCss)}</textarea>
          </label>
          <div class="text-line-style-preview">
            <span>Preview</span>
            <div class="text-line-style-sample heading-style-sample" style="${deps.escapeAttr(style.css)}">
              <span data-heading-style-sample-label>${deps.escapeHtml(label)}</span>
            </div>
          </div>
        </div>
      </details>`;
    }).join('');
  }

  function renderBlockContentEditor(sectionKey: string, block: VisualBlock): string {
    const component = deps.resolveBaseComponent(block.schema.component);
    const helpers = deps.getComponentRenderHelpers();

    if (component === 'encrypted') {
      return renderEncryptedComponentEditor(sectionKey, block);
    }
    if (component === 'plugin') {
      return renderPluginEditor(sectionKey, block, helpers);
    }
    if (component === 'button') {
      return state.showAdvancedEditor
        ? renderButtonAdvancedEditor(sectionKey, block)
        : renderButtonEditor(sectionKey, block, helpers);
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
    if (component === 'carousel') {
      return renderCarouselEditor(sectionKey, block, helpers);
    }
    return renderTextEditor(sectionKey, block, helpers);
  }

  function renderEncryptedComponentEditor(sectionKey: string, block: VisualBlock): string {
    if (block.schema.encryptedBlock) {
      return `<div class="encrypted-component-editor">
        ${renderEditorBlock(sectionKey, block.schema.encryptedBlock, state.documentSections)}
      </div>`;
    }
    const keyId = block.schema.keyId.trim() || '(missing)';
    const attachmentId = block.schema.encryptedAttachmentId.trim() || `encrypted:${keyId}`;
    return `<div class="plugin-placeholder encrypted-component-placeholder">
      <strong>Encrypted component</strong>
      <div>Key UUID: ${deps.escapeHtml(keyId)}</div>
      <div>Attachment: ${deps.escapeHtml(attachmentId)}</div>
      ${block.schema.encryptedError ? `<div>${deps.escapeHtml(block.schema.encryptedError)}</div>` : ''}
    </div>`;
  }

  function renderBlockMetaFields(sectionKey: string, block: VisualBlock): string {
    const component = deps.resolveBaseComponent(block.schema.component);
    const listDisplayContext = getComponentListDisplayContext(sectionKey, block.id);
    const isScriptingPlugin = component === 'plugin' && block.schema.plugin === SCRIPTING_PLUGIN_ID;
    const scriptingLibraries = Array.isArray(block.schema.pluginConfig?.libraries) ? block.schema.pluginConfig.libraries : [];
    const gridStackWidth = component === 'grid' ? coerceGridStackWidth(block.schema.gridStackWidth) : DEFAULT_GRID_STACK_WIDTH;
    const textMetaFields = component === 'text'
      ? `<label class="schema-meta-checkbox">
          <input
            type="checkbox"
            data-section-key="${deps.escapeAttr(sectionKey)}"
            data-block-id="${deps.escapeAttr(block.id)}"
            data-field="block-show-copy"
            ${block.schema.showCopy ? 'checked' : ''}
          />
          <span>Show Copy Button</span>
        </label>`
      : '';
    const gridMetaFields = component === 'grid'
      ? `<div class="grid-stack-width-field block-meta-field">
          <label>
            <span>Stack Width</span>
            <input
              class="grid-stack-width-input"
              data-section-key="${deps.escapeAttr(sectionKey)}"
              data-block-id="${deps.escapeAttr(block.id)}"
              data-field="block-grid-stack-width"
              placeholder="${DEFAULT_GRID_STACK_WIDTH}"
              value="${deps.escapeAttr(gridStackWidth === DEFAULT_GRID_STACK_WIDTH || gridStackWidth === 'never' ? '' : gridStackWidth)}"
              ${gridStackWidth === 'never' ? 'disabled' : ''}
            />
          </label>
          <label class="checkbox-label grid-stack-never-toggle">
            <span>Never</span>
            <input
              type="checkbox"
              data-section-key="${deps.escapeAttr(sectionKey)}"
              data-block-id="${deps.escapeAttr(block.id)}"
              data-field="block-grid-stack-never"
              ${gridStackWidth === 'never' ? 'checked' : ''}
            />
          </label>
        </div>`
      : '';
    const scriptingVersionField =
      isScriptingPlugin
        ? `<label>
          <span>Scripting Version</span>
          <input
            data-section-key="${deps.escapeAttr(sectionKey)}"
            data-block-id="${deps.escapeAttr(block.id)}"
            data-field="block-plugin-scripting-version"
            placeholder="${deps.escapeAttr(getScriptingPluginVersion(block.schema.pluginConfig))}"
            value="${deps.escapeAttr(getScriptingPluginVersion(block.schema.pluginConfig))}"
          />
        </label>
        <label>
          <span>Script Step Budget</span>
          <input
            type="number"
            min="1"
            data-section-key="${deps.escapeAttr(sectionKey)}"
            data-block-id="${deps.escapeAttr(block.id)}"
            data-field="block-plugin-scripting-max-steps"
            value="${deps.escapeAttr(String(getScriptingPluginMaxSteps(block.schema.pluginConfig) ?? 100_000))}"
          />
        </label>
        <fieldset class="schema-meta-fieldset">
          <legend>Script Libraries</legend>
          ${SCRIPTING_LIBRARY_OPTIONS.map((library) => `
            <label class="schema-meta-checkbox">
              <input
                type="checkbox"
                data-section-key="${deps.escapeAttr(sectionKey)}"
                data-block-id="${deps.escapeAttr(block.id)}"
                data-field="block-plugin-scripting-library"
                data-library="${deps.escapeAttr(library)}"
                ${scriptingLibraries.includes(library) ? 'checked' : ''}
              />
              <span>${deps.escapeHtml(library)}</span>
            </label>
          `).join('')}
        </fieldset>`
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
        <div class="block-meta-checkbox-row">
          <label class="checkbox-label">
            <span>Locked</span>
            <input
              type="checkbox"
              data-section-key="${deps.escapeAttr(sectionKey)}"
              data-block-id="${deps.escapeAttr(block.id)}"
              data-field="block-lock"
              ${block.schema.lock ? 'checked' : ''}
            />
          </label>
          <label class="checkbox-label">
            <span>Hidden</span>
            <input
              type="checkbox"
              data-section-key="${deps.escapeAttr(sectionKey)}"
              data-block-id="${deps.escapeAttr(block.id)}"
              data-field="block-hide-if-yes"
              ${block.schema.hideIfYes.trim().toLowerCase() === 'yes' ? 'checked' : ''}
            />
          </label>
        </div>
        ${textMetaFields}
        ${gridMetaFields}
        <label>
          <div>Visible When Function Body</div>
          <div>Controls when this block is visible. Returns boolean.</div>
          <textarea
            rows="5"
            spellcheck="false"
            data-section-key="${deps.escapeAttr(sectionKey)}"
            data-block-id="${deps.escapeAttr(block.id)}"
            data-field="block-visible-script"
          >${deps.escapeHtml(block.schema.visibleScript)}</textarea>
        </label>
        ${listDisplayContext ? renderComponentListDisplayFields(sectionKey, block, listDisplayContext) : ''}
        ${component === 'container'
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
        ${component === 'component-list'
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
        ${deps.resolveBaseComponent(component) === 'xref-card'
        ? `<label>
          <span>Target Tag Filter</span>
          <input
            data-section-key="${deps.escapeAttr(sectionKey)}"
            data-block-id="${deps.escapeAttr(block.id)}"
            data-field="block-xref-target-tag-filter"
            placeholder="tag-name"
            value="${deps.escapeAttr(block.schema.xrefTargetTagFilter)}"
          />
        </label>`
        : ''
      }
        <label>
          <span class="description-label-with-action">Description${block.schema.description.trim()
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
        <label class="checkbox-label">
          <span>Editor Only</span>
          <input
            type="checkbox"
            data-section-key="${deps.escapeAttr(sectionKey)}"
            data-block-id="${deps.escapeAttr(block.id)}"
            data-field="block-editor-only"
            ${block.schema.editorOnly ? 'checked' : ''}
          />
        </label>
      </div>
    `;
  }

  function renderButtonMetaFields(sectionKey: string, block: VisualBlock): string {
    const attr = `data-section-key="${deps.escapeAttr(sectionKey)}" data-block-id="${deps.escapeAttr(block.id)}"`;
    return `<section class="component-list-display-editor" aria-label="Button settings">
      <strong>Button</strong>
      <p class="button-script-lifecycle-note">
        A button to get a response from an LLM and do something with it. Uses scripting.</p>
      <label>
        <span>Label</span>
        <input ${attr} data-field="block-button-label" value="${deps.escapeAttr(block.schema.buttonLabel)}" />
      </label>
      <label>
        <span>Position Target ID</span>
        <input ${attr} data-field="block-button-position-target-id" value="${deps.escapeAttr(block.schema.buttonPositionTargetId)}" />
      </label>
      <label>
        <span>Button CSS</span>
        <textarea rows="2" ${attr} data-field="block-button-css">${deps.escapeHtml(block.schema.buttonCss)}</textarea>
      </label>
      <label>
        <span>Input Character Limit</span>
        <input type="number" min="1" step="1" ${attr} data-field="block-button-input-char-limit" value="${deps.escapeAttr(String(block.schema.buttonInputCharLimit))}" />
      </label>
      <label>
        <span>Output Character Limit</span>
        <input type="number" min="1" step="1" ${attr} data-field="block-button-output-char-limit" value="${deps.escapeAttr(String(block.schema.buttonOutputCharLimit))}" />
      </label>
      <label>
        <div>Visible When Function Body</div>
        <div>Controls when the button is visible.</div>
        <div>Returns boolean</div>
        <textarea rows="5" spellcheck="false" ${attr} data-field="block-button-visible-script">${deps.escapeHtml(block.schema.buttonVisibleScript)}</textarea>
      </label>
      <label>
        <div>Context Builder Function Body</div>
        <div>This is provided to the LLM</div>
        <div>Returns a string</div>
        <textarea rows="5" spellcheck="false" ${attr} data-field="block-button-source-script">${deps.escapeHtml(block.schema.buttonSourceScript)}</textarea>
      </label>
      <label>
        <span>Prompt</span>
        <textarea rows="4" ${attr} data-field="block-button-prompt">${deps.escapeHtml(block.schema.buttonPrompt)}</textarea>
      </label>
      <label>
        <span>AI Response Handler Script</span>
        <textarea rows="5" spellcheck="false" ${attr} data-field="block-button-target-script">${deps.escapeHtml(block.schema.buttonTargetScript)}</textarea>
      </label>
	    </section>`;
  }

  function renderButtonAdvancedEditor(sectionKey: string, block: VisualBlock): string {
    const label = block.schema.buttonLabel.trim() || 'Generate';
    const buttonStyle = deps.escapeAttr(sanitizeInlineCss(block.schema.buttonCss));
    return `<div class="button-component-editor">
      <section class="component-list-display-editor" aria-label="Button preview">
        <strong>Button Preview</strong>
        <div class="button-component-preview-stage">
          <div class="hvy-button-component" style="${buttonStyle}">
            <button type="button" class="hvy-button-component-button" disabled>${deps.escapeHtml(label)}</button>
          </div>
        </div>
      </section>
      ${renderButtonMetaFields(sectionKey, block)}
    </div>`;
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
    return unwrapSingleParagraph(decorateMarkdownCodeBlocks(addExternalLinkTargets(markdownToReaderHtml(normalized, {
      textLineStyles: getTextLineStylesFromMeta(state.documentMeta),
      textLineStyleMode: state.currentView === 'editor' ? 'editor' : 'viewer',
      crossDocumentLinksEnabled: state.crossDocumentLinksEnabled === true,
    }), state.crossDocumentLinksEnabled === true), deps.escapeHtml));
  }

  function renderComponentFragment(componentName: string, content: string, block: VisualBlock, sectionKey = ''): string {
    if (componentName === 'code') {
      return renderSyntaxHighlightedCode(content, block.schema.codeLanguage || 'text');
    }
    if (componentName === 'text' && block.schema.fillIn && hasTextFillInMarker(content)) {
      if (state.currentView === 'viewer') {
        return renderTextFragment(removeTextFillInMarkers(content));
      }
      const parts = splitTextFillIns(content);
      const tokenPrefix = 'HVY_FILL_IN_VALUE_TOKEN_';
      let html = renderTextFragment(
        parts.map((part, index) => (index < parts.length - 1 ? `${part}${tokenPrefix}${index}` : part)).join('')
      );
      for (let index = 0; index < parts.length - 1; index += 1) {
        html = html.replace(
          `${tokenPrefix}${index}`,
          `<span
            class="text-fill-in-box"
            contenteditable="true"
            spellcheck="true"
            data-section-key="${deps.escapeAttr(sectionKey)}"
            data-block-id="${deps.escapeAttr(block.id)}"
            data-field="text-fill-in-value"
            data-fill-index="${String(index)}"
            data-placeholder="${deps.escapeAttr(getTextFillInPlaceholder(content, index))}"
          ></span>`
        );
      }
      return `<div class="text-fill-in-editor text-fill-in-reader-editor" data-fill-parts="${deps.escapeAttr(JSON.stringify(parts))}">${html}</div>`;
    }
    return renderTextFragment(content);
  }

  function renderPassiveContainerBlocks(sectionKey: string, block: VisualBlock, rootSections: VisualSection[]): string {
    const blocks = block.schema.containerBlocks;
    const output: string[] = [];
    if (!block.schema.lock && blocks[0]) {
      output.push(renderComponentPlacementTarget({
        container: 'container',
        sectionKey,
        parentBlockId: block.id,
        placement: 'before',
        targetBlockId: blocks[0].id,
      }));
    }
    for (const innerBlock of blocks) {
      output.push(renderPassiveEditorBlock(sectionKey, innerBlock, rootSections));
      if (!block.schema.lock) {
        output.push(renderComponentPlacementTarget({
          container: 'container',
          sectionKey,
          parentBlockId: block.id,
          placement: 'after',
          targetBlockId: innerBlock.id,
        }));
      }
    }
    if (!block.schema.lock && blocks.length === 0) {
      output.push(renderComponentPlacementTarget({
        container: 'container',
        sectionKey,
        parentBlockId: block.id,
        placement: 'end',
      }));
    }
    return output.join('');
  }

  function renderSyntaxHighlightedCode(content: string, languageName: string, options?: { badge?: string }): string {
    const language = languageName.trim() || 'text';
    const highlighted = highlightCode(content, language, deps.escapeHtml);
    const badge = options?.badge
      ? `<span class="reader-code-badge">${deps.escapeHtml(options.badge)}</span>`
      : '';
    return `<div class="reader-code-block">
      <div class="reader-code-head">
        <span class="reader-code-language">${deps.escapeHtml(language)}</span>
        ${badge}
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
    renderTextFragment,
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

export function templateDefinitionDetailsKey(kind: 'component' | 'section', index: number): string {
  return `${kind}:${index}`;
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

function addExternalLinkTargets(html: string, crossDocumentLinksEnabled: boolean): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  template.content.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
    const href = anchor.getAttribute('href') ?? '';
    if (/^https?:\/\//i.test(href)) {
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
    }
  });
  applyWorkspaceLinkRendering(template.content, crossDocumentLinksEnabled === true);
  return template.innerHTML;
}
