import './editor.css';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import type { ComponentRenderHelpers, ReaderBlockRenderOptions } from './component-helpers';
import type { ComponentDefinition, ComponentPlacementState, ImageAttachmentMaxDimensions, VisualDocument } from '../types';
import { renderComponentListEditor } from './components/component-list/component-list';
import { renderButtonEditor } from './components/button/button';
import { renderContainerEditor } from './components/container/container';
import { renderExpandableEditor } from './components/expandable/expandable';
import { renderGridEditor, renderGridHeaderControls } from './components/grid/grid';
import { renderImageEditor } from './components/image/image';
import { renderCarouselEditor } from './components/carousel/carousel';
import { renderPluginEditor, getPluginBlockHeaderLabel } from './components/plugin/plugin';
import { renderTableEditor } from './components/table/table';
import { renderTextEditor } from './components/text/text';
import { renderTextToolbarDismissButton } from './components/text/text-toolbar-layout';
import { renderXrefCardEditor } from './components/xref-card/xref-card';
import { renderDocumentAttachmentManager } from './components/document-attachments/document-attachments';
import { renderDeleteControl } from './components/delete-control/delete-control';
import { getComponentListAddLabel, getComponentListEditLabel, hasComponentListItems } from './components/component-list/component-list-labels';
import { renderTagEditor } from './tag-editor';
import { getTemplateFields, renderTemplateGhosts } from './template';
import type { Align, BlockSchema, SortKeyValue, VisualBlock, VisualSection } from './types';
import { markdownToReaderHtml, normalizeMarkdownIndentation, normalizeMarkdownLists } from '../markdown';
import { renderUserFileAttachmentLinksInHtml } from '../document-attachment-links';
import { getBlockAnswerGroups, getInlineAnswerGroupIndex } from '../inline-answer-groups';
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
import {
  createChildRenderTreeWindowOptions,
  createRenderTreeHeightLedger,
  type RenderTreeWindowEntry,
} from '../render-tree-window';
import {
  createEditorBlockRenderTreeNode,
  createEditorSectionRenderTreeNode,
  EDITOR_BLOCK_TREE_LAYOUT,
  EDITOR_SECTION_TREE_LAYOUT,
  type EditorRenderTreeItem,
  type EditorRenderTreeWindowOptions,
} from './editor-render-tree-window';
import { SCRIPTING_PLUGIN_ID } from '../plugins/registry';
import { getScriptingPluginMaxSteps, getScriptingPluginVersion } from '../plugins/scripting/version';
import { SCRIPTING_LIBRARY_OPTIONS } from '../plugins/scripting/wrapper';
import { renderAddComponentPicker } from './component-picker';
import { getTextFillInPlaceholder, hasTextFillInMarker, removeTextFillInMarkers, splitTextFillIns } from '../text-fill-in';
import { closeIcon, plusIcon, wrenchIcon } from '../icons';
import { getEmptySectionHeadingLevel } from '../section-heading-memory';
import { getDocumentParagraphSpacing } from '../document-typography';
import { coerceGridStackWidth, DEFAULT_GRID_STACK_WIDTH } from '../grid-ops';
import { getComponentEditorMinimumWidth } from './component-editor-width';
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
import { getSectionFilteredMoveAvailability, isHiddenEditorOnlySection, visitBlocksInList } from '../section-ops';
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

type ComponentDef = ComponentDefinition;

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
  document?: VisualDocument;
  documentExtension: '.hvy' | '.thvy' | '.phvy' | '.md';
  documentMeta: Record<string, unknown>;
  imageAttachmentMaxDimensions?: ImageAttachmentMaxDimensions | null;
  imageAttachmentReductionStatus?: { state: 'reducing' | 'reduced' | 'unchanged' | 'error'; message: string } | null;
  documentSections: VisualSection[];
  showAdvancedEditor: boolean;
  showComponentEncryptionControls?: boolean;
  addComponentBySection: Record<string, string>;
  activeEditorBlock: { sectionKey: string; blockId: string } | null;
  activeEditorBlockSnapshots: Array<{ sectionKey: string; blockId: string; block: VisualBlock }>;
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
    passiveHeight?: number;
  } | null;
  expandableEditorPanels: Record<string, { stubOpen: boolean; expandedOpen: boolean }>;
  readerExpandableState: Record<string, boolean>;
  searchRevealedAncestors: Record<string, boolean>;
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
  renderSectionEditorTree: (sections: VisualSection[], windowOptions?: EditorRenderTreeWindowOptions) => string;
  renderEditorSection: (section: VisualSection, rootSections: VisualSection[], isSubsection?: boolean, windowOptions?: EditorRenderTreeWindowOptions) => string;
  renderTopLevelSectionInsertGutter: (section: VisualSection, acceptsImageDrop: boolean) => string;
  recordEditorSectionHeight: (sectionKey: string, height: number) => void;
  recordEditorBlockHeight: (sectionKey: string, blockId: string, height: number) => void;
  renderSidebarEditorSections: (sections: VisualSection[]) => string;
  renderSidebarHelpBalloon: (sections: VisualSection[]) => string;
  renderEditorBlock: (sectionKey: string, block: VisualBlock, rootSections?: VisualSection[], parentLocked?: boolean) => string;
  renderEditorNestedBlocks: ComponentRenderHelpers['renderEditorNestedBlocks'];
  renderEditorGridBlocks: ComponentRenderHelpers['renderEditorGridBlocks'];
  renderPassiveEditorBlock: (sectionKey: string, block: VisualBlock, rootSections?: VisualSection[]) => string;
  renderBlockContentEditor: (sectionKey: string, block: VisualBlock) => string;
  renderRichToolbar: (
    sectionKey: string,
    blockId: string,
    options?: {
      field?: string;
      gridItemId?: string;
      rowIndex?: number;
      includeDismiss?: boolean;
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
  let encryptedEditorDepth = 0;
  const editorRenderTreeHeightLedger = createRenderTreeHeightLedger();
  let activeEditorRenderTreeWindowOptions: EditorRenderTreeWindowOptions | null = null;
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
      ${sidebarSections.map((section, index) => `${renderTopLevelSectionInsertGutter(section, index > 0)}${renderEditorSection(section, sections)}`).join('')}
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

  function renderSectionEditorTree(sections: VisualSection[], windowOptions?: EditorRenderTreeWindowOptions): string {
    const mainSections = sections.filter((s) =>
      s.location !== 'sidebar'
      && (!isHiddenEditorOnlySection(s, state.documentMeta, state.showAdvancedEditor) || hasOpenEditorInSectionTree(s))
    );
    const sectionCards = editorRenderTreeHeightLedger.plan(
      mainSections.map(createEditorSectionRenderTreeNode),
      windowOptions,
      EDITOR_SECTION_TREE_LAYOUT
    ).map((entry, index) => {
      const section = entry.node.item as VisualSection;
      const card = entry.shouldRender || hasOpenEditorInSectionTree(section)
        ? renderEditorSection(
          section,
          sections,
          false,
          createChildRenderTreeWindowOptions(windowOptions, entry.offsetTop, 90)
        )
        : renderEditorSectionPlaceholder(section, entry.estimatedHeight, false);
      return `${renderTopLevelSectionInsertGutter(section, index > 0)}${card}`;
    }).join('');
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
      <div class="editor-document-tail" aria-hidden="true"></div>
    `;
  }

  function renderTopLevelSectionInsertGutter(section: VisualSection, acceptsImageDrop: boolean): string {
    if (state.mobileAdjustmentMode) {
      return '';
    }
    const visibleTitle = deps.formatSectionTitle(section.title);
    const imageDropAttrs = acceptsImageDrop
      ? ` data-image-section-drop-gap="true" data-before-section-key="${deps.escapeAttr(section.key)}" data-section-location="${deps.escapeAttr(section.location)}"`
      : '';
    return `<div class="top-level-section-insert-gutter${acceptsImageDrop ? ' image-section-drop-gap' : ''}"${imageDropAttrs}>
      <button
        type="button"
        class="top-level-section-insert-button"
        data-action="insert-top-level-section-before"
        data-section-key="${deps.escapeAttr(section.key)}"
        data-section-location="${deps.escapeAttr(section.location)}"
        aria-label="Insert section before ${deps.escapeAttr(visibleTitle)}"
        title="Insert section here"
      >${plusIcon()}</button>
    </div>`;
  }

  function recordEditorSectionHeight(sectionKey: string, height: number): void {
    const section = deps.findSectionByKey(state.documentSections, sectionKey);
    if (section) {
      editorRenderTreeHeightLedger.record(createEditorSectionRenderTreeNode(section), height);
    }
  }

  function recordEditorBlockHeight(sectionKey: string, blockId: string, height: number): void {
    const section = deps.findSectionByKey(state.documentSections, sectionKey);
    let block: VisualBlock | null = null;
    if (section) {
      visitBlocksInList(section.blocks, (candidate) => {
        if (!block && candidate.id === blockId) {
          block = candidate;
        }
      });
    }
    if (block) {
      editorRenderTreeHeightLedger.record(createEditorBlockRenderTreeNode(block), height);
    }
  }

  function renderEditorSectionPlaceholder(
    section: VisualSection,
    estimatedHeight: number,
    isSubsection: boolean
  ): string {
    return `<div class="hvy-section-virtual-placeholder" data-hvy-virtual-placeholder="true" data-hvy-virtual-kind="editor" data-section-key="${deps.escapeAttr(section.key)}" data-hvy-virtual-subsection="${isSubsection ? 'true' : 'false'}" style="min-height: ${deps.escapeAttr(String(estimatedHeight))}px; margin: 0 0 0.55rem;" aria-hidden="true"></div>`;
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

  function renderEditorSection(
    section: VisualSection,
    rootSections: VisualSection[],
    isSubsection = false,
    windowOptions?: EditorRenderTreeWindowOptions
  ): string {
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
      if (state.activeEditorBlockSnapshots.some((active) => active.sectionKey === s.key)) return true;
      return s.children.some(hasActiveBlockInSelfOrDescendants);
    };
    const subsectionToggle = isSubsection && !hasActiveBlockInSelfOrDescendants(section)
      ? `<button type="button" class="section-nest-toggle" data-action="remove-subsection" data-section-key="${deps.escapeAttr(section.key)}" aria-label="Remove subsection" title="Remove subsection">‹</button>`
      : '';
    const addComponentGhost = state.componentPlacement || state.mobileAdjustmentMode
      ? ''
      : `<div class="ghost-section-card add-ghost compact-add-component-ghost" data-section-insertion="true" data-section-before-kind="end">
                  ${renderComponentPicker({
        id: `section:${section.key}`,
        action: 'add-block',
        sectionKey: section.key,
        label: 'Section component type',
        extraAttrs: {
          'data-section-insertion': 'true',
          'data-section-before-kind': 'end',
        },
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
            ${renderDeleteControl({
        className: 'editor-section-remove-button',
        label: `Remove ${visibleTitle} section`,
        title: 'Delete section',
        attributes: {
          'data-action': 'remove-section',
          'data-section-key': section.key,
          'data-tooltip': 'Delete section',
        },
      })}
          </div>
        </div>

        <div class="editor-blocks">
          ${renderEditorSectionItems(section, rootSections, windowOptions)}
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

  function renderEditorSectionItems(
    section: VisualSection,
    rootSections: VisualSection[],
    windowOptions?: EditorRenderTreeWindowOptions
  ): string {
    const items = deps.buildSectionRenderSequence(section).filter((item) => item.kind === 'block'
      ? !isHiddenEditorOnlyScriptingBlock(item.block, section.key)
        && (!isAnchoredButtonInSection(section, item.block) || deps.isActiveEditorBlock(section.key, item.block.id))
      : !isHiddenEditorOnlySection(item.child, state.documentMeta, state.showAdvancedEditor)
        || hasOpenEditorInSectionTree(item.child)
    );
    if (windowOptions && !state.componentPlacement && !state.mobileAdjustmentMode) {
      const activeBlockIds = state.activeEditorBlockSnapshots
        .filter((active) => active.sectionKey === section.key)
        .map((active) => active.blockId);
      const forceNodeKeys = new Set<string>();
      items.forEach((item) => {
        if (item.kind === 'child') {
          if (hasOpenEditorInSectionTree(item.child) || deps.isActiveEditorSectionTitle(item.child.key)) {
            forceNodeKeys.add(item.child.key);
          }
          return;
        }
        if (activeBlockIds.some((blockId) => item.block.id === blockId || isDescendantActive(item.block, blockId))) {
          forceNodeKeys.add(item.block.id);
        }
      });
      const effectiveWindowOptions: EditorRenderTreeWindowOptions = {
        ...windowOptions,
        forceNodeKeys,
      };
      const nodes = items.map((item) => item.kind === 'block'
        ? createEditorBlockRenderTreeNode(item.block)
        : createEditorSectionRenderTreeNode(item.child)
      );
      return renderEditorSectionItemPlan(
        section,
        rootSections,
        editorRenderTreeHeightLedger.plan(
          nodes,
          effectiveWindowOptions,
          items.some((item) => item.kind === 'child') ? EDITOR_SECTION_TREE_LAYOUT : EDITOR_BLOCK_TREE_LAYOUT
        ),
        effectiveWindowOptions
      );
    }
    const output: string[] = [];
    const canPlaceInSection = !section.lock;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]!;
      const previous = items[index - 1];
      const boundary = item.kind === 'block'
        ? { beforeKind: 'block' as const, beforeId: item.block.id }
        : { beforeKind: 'child' as const, beforeId: item.child.key };
      if (state.componentPlacement && canPlaceInSection) {
        output.push(renderComponentPlacementTarget({
          container: 'section',
          sectionKey: section.key,
          placement: index === 0 ? 'before' : previous?.kind === 'block' ? 'after' : 'before',
          ...(previous?.kind === 'block' ? { targetBlockId: previous.block.id } : item.kind === 'block' ? { targetBlockId: item.block.id } : {}),
          sectionBoundary: boundary,
        }));
      } else if (canPlaceInSection && previous?.kind === 'child' && item.kind === 'child') {
        output.push(renderSectionSequenceAddGhost(section.key, boundary));
      }
      if (item.kind === 'block') {
        output.push(renderEditorBlock(section.key, item.block, rootSections, section.lock));
      } else {
        output.push(renderEditorSection(item.child, rootSections, true));
      }
    }
    if (state.componentPlacement && canPlaceInSection) {
      const previous = items.at(-1);
      output.push(renderComponentPlacementTarget({
        container: 'section',
        sectionKey: section.key,
        placement: previous?.kind === 'block' ? 'after' : 'end',
        ...(previous?.kind === 'block' ? { targetBlockId: previous.block.id } : {}),
        sectionBoundary: { beforeKind: 'end', beforeId: '' },
      }));
    }
    return output.join('');
  }

  function renderSectionSequenceAddGhost(
    sectionKey: string,
    boundary: { beforeKind: 'block' | 'child'; beforeId: string },
  ): string {
    return `<div class="ghost-section-card add-ghost compact-add-component-ghost section-sequence-add-ghost" data-section-insertion="true" data-section-before-kind="${boundary.beforeKind}" data-section-before-id="${deps.escapeAttr(boundary.beforeId)}">
      ${renderComponentPicker({
        id: `section-boundary:${sectionKey}:${boundary.beforeId}`,
        action: 'add-block',
        sectionKey,
        label: 'Insert component between subsections',
        extraAttrs: {
          'data-section-insertion': 'true',
          'data-section-before-kind': boundary.beforeKind,
          'data-section-before-id': boundary.beforeId,
        },
        ...(isPdfEditorDocument() ? { componentFilter: isPdfAllowedEditorComponent, componentDisabledReason: getPdfDisabledComponentReason } : {}),
      })}
    </div>`;
  }

  function renderEditorSectionItemPlan(
    section: VisualSection,
    rootSections: VisualSection[],
    entries: Array<RenderTreeWindowEntry<EditorRenderTreeItem>>,
    windowOptions: EditorRenderTreeWindowOptions
  ): string {
    const output: string[] = [];
    for (let index = 0; index < entries.length;) {
      const entry = entries[index];
      if (!entry) break;
      if (entry.node.kind === 'section') {
        const child = entry.node.item as VisualSection;
        const previous = entries[index - 1];
        if (!section.lock && previous?.node.kind === 'section') {
          output.push(renderSectionSequenceAddGhost(section.key, { beforeKind: 'child', beforeId: child.key }));
        }
        output.push(entry.shouldRender || hasOpenEditorInSectionTree(child)
          ? renderEditorSection(
            child,
            rootSections,
            true,
            createChildRenderTreeWindowOptions(windowOptions, entry.offsetTop, 90)
          )
          : renderEditorSectionPlaceholder(child, entry.estimatedHeight, true)
        );
        index += 1;
        continue;
      }
      if (entry.shouldRender) {
        output.push(withEditorRenderTreeWindow(entry, windowOptions, () => (
          renderEditorBlock(section.key, entry.node.item as VisualBlock, rootSections, section.lock)
        )));
        index += 1;
        continue;
      }
      const chunk: Array<RenderTreeWindowEntry<EditorRenderTreeItem>> = [];
      while (index + chunk.length < entries.length && chunk.length < 20) {
        const candidate = entries[index + chunk.length];
        if (!candidate || candidate.node.kind !== 'block' || candidate.shouldRender) break;
        chunk.push(candidate);
      }
      const estimatedHeight = chunk.reduce((total, candidate) => total + candidate.estimatedHeight, 0);
      const blockIds = chunk.map((candidate) => (candidate.node.item as VisualBlock).id).join(' ');
      output.push(`<div class="hvy-section-virtual-placeholder" data-hvy-virtual-placeholder="true" data-hvy-virtual-kind="editor-block-range" data-section-key="${deps.escapeAttr(section.key)}" data-block-ids="${deps.escapeAttr(blockIds)}" data-parent-locked="${section.lock ? 'true' : 'false'}" style="min-height: ${Math.ceil(estimatedHeight)}px;" aria-hidden="true"></div>`);
      index += Math.max(1, chunk.length);
    }
    return output.join('');
  }

  function renderEditorBlockPlan(
    sectionKey: string,
    rootSections: VisualSection[],
    parentLocked: boolean,
    entries: Array<RenderTreeWindowEntry<EditorRenderTreeItem>>,
    windowOptions?: EditorRenderTreeWindowOptions,
    placement?: {
      container: 'container' | 'component-list' | 'expandable-stub' | 'expandable-content';
      parentBlockId: string;
    }
  ): string {
    const output: string[] = [];
    if (placement && !parentLocked && entries.length > 0) {
      output.push(renderComponentPlacementTarget({
        container: placement.container,
        sectionKey,
        parentBlockId: placement.parentBlockId,
        placement: 'before',
        targetBlockId: (entries[0]?.node.item as VisualBlock | undefined)?.id,
      }));
    }
    for (let index = 0; index < entries.length;) {
      const entry = entries[index];
      if (!entry) break;
      if (entry.shouldRender) {
        output.push(withEditorRenderTreeWindow(entry, windowOptions, () => (
          renderEditorBlock(sectionKey, entry.node.item as VisualBlock, rootSections, parentLocked)
        )));
        if (placement && !parentLocked) {
          output.push(renderComponentPlacementTarget({
            container: placement.container,
            sectionKey,
            parentBlockId: placement.parentBlockId,
            placement: 'after',
            targetBlockId: (entry.node.item as VisualBlock).id,
          }));
        }
        index += 1;
        continue;
      }
      const chunk: Array<RenderTreeWindowEntry<EditorRenderTreeItem>> = [];
      while (index + chunk.length < entries.length && chunk.length < 20) {
        const candidate = entries[index + chunk.length];
        if (!candidate || candidate.shouldRender) break;
        chunk.push(candidate);
      }
      if (chunk.length === 0) {
        index += 1;
        continue;
      }
      const estimatedHeight = chunk.reduce((total, candidate) => total + candidate.estimatedHeight, 0);
      const blockIds = chunk.map((candidate) => (candidate.node.item as VisualBlock).id).join(' ');
      output.push(`<div class="hvy-section-virtual-placeholder" data-hvy-virtual-placeholder="true" data-hvy-virtual-kind="editor-block-range" data-section-key="${deps.escapeAttr(sectionKey)}" data-block-ids="${deps.escapeAttr(blockIds)}" data-parent-locked="${parentLocked ? 'true' : 'false'}" style="min-height: ${Math.ceil(estimatedHeight)}px;" aria-hidden="true"></div>`);
      index += chunk.length;
    }
    if (placement && !parentLocked && entries.length === 0) {
      output.push(renderComponentPlacementTarget({
        container: placement.container,
        sectionKey,
        parentBlockId: placement.parentBlockId,
        placement: 'end',
      }));
    }
    return output.join('');
  }

  function withEditorRenderTreeWindow(
    entry: RenderTreeWindowEntry<EditorRenderTreeItem>,
    windowOptions: EditorRenderTreeWindowOptions | undefined,
    render: () => string
  ): string {
    const previous = activeEditorRenderTreeWindowOptions;
    activeEditorRenderTreeWindowOptions = createChildRenderTreeWindowOptions(windowOptions, entry.offsetTop) ?? null;
    try {
      return render();
    } finally {
      activeEditorRenderTreeWindowOptions = previous;
    }
  }

  function renderEditorNestedBlocks(
    sectionKey: string,
    blocks: VisualBlock[],
    options: {
      container: 'container' | 'component-list' | 'expandable-stub' | 'expandable-content';
      parentBlockId: string;
      locked: boolean;
    }
  ): string {
    const nestedWindowOptions = activeEditorRenderTreeWindowOptions && !state.componentPlacement && !state.mobileAdjustmentMode
      ? {
        ...activeEditorRenderTreeWindowOptions,
        layoutOffsetTop: (activeEditorRenderTreeWindowOptions.layoutOffsetTop ?? 0) + 80,
        forceNodeKeys: new Set(
          state.activeEditorBlockSnapshots
            .filter((active) => active.sectionKey === sectionKey)
            .map((active) => active.blockId)
        ),
      }
      : undefined;
    return renderEditorBlockPlan(
      sectionKey,
      state.documentSections,
      options.locked,
      editorRenderTreeHeightLedger.plan(
        blocks.map(createEditorBlockRenderTreeNode),
        nestedWindowOptions,
        EDITOR_BLOCK_TREE_LAYOUT
      ),
      nestedWindowOptions,
      { container: options.container, parentBlockId: options.parentBlockId }
    );
  }

  function renderEditorGridBlocks(
    sectionKey: string,
    blocks: VisualBlock[],
    columns: number,
    parentLocked: boolean
  ): Array<{ block: VisualBlock; html: string }> {
    const nestedWindowOptions = activeEditorRenderTreeWindowOptions && !state.componentPlacement && !state.mobileAdjustmentMode
      ? {
        ...activeEditorRenderTreeWindowOptions,
        layoutOffsetTop: (activeEditorRenderTreeWindowOptions.layoutOffsetTop ?? 0) + 80,
        layoutColumns: columns,
        forceNodeKeys: new Set(
          state.activeEditorBlockSnapshots
            .filter((active) => active.sectionKey === sectionKey)
            .map((active) => active.blockId)
        ),
      }
      : undefined;
    return editorRenderTreeHeightLedger.plan(
      blocks.map(createEditorBlockRenderTreeNode),
      nestedWindowOptions,
      EDITOR_BLOCK_TREE_LAYOUT
    ).map((entry) => ({
      block: entry.node.item as VisualBlock,
      html: entry.shouldRender
        ? withEditorRenderTreeWindow(entry, nestedWindowOptions, () => (
          renderEditorBlock(sectionKey, entry.node.item as VisualBlock, state.documentSections, parentLocked)
        ))
        : `<div class="hvy-section-virtual-placeholder" data-hvy-virtual-placeholder="true" data-hvy-virtual-kind="editor-block" data-section-key="${deps.escapeAttr(sectionKey)}" data-block-id="${deps.escapeAttr((entry.node.item as VisualBlock).id)}" data-parent-locked="${parentLocked ? 'true' : 'false'}" style="min-height: ${Math.ceil(entry.estimatedHeight)}px;" aria-hidden="true"></div>`,
    }));
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
      }${options.parentBlockId ? ` data-parent-block-id="${deps.escapeAttr(options.parentBlockId)}"` : ''}${options.targetGridItemId ? ` data-target-grid-item-id="${deps.escapeAttr(options.targetGridItemId)}"` : ''}${options.sectionBoundary ? ` data-section-insertion="true" data-section-before-kind="${options.sectionBoundary.beforeKind}"${options.sectionBoundary.beforeId ? ` data-section-before-id="${deps.escapeAttr(options.sectionBoundary.beforeId)}"` : ''}` : ''
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
    if (isHiddenEditorOnlyScriptingBlock(block, sectionKey)) {
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
      return renderPassiveEditorBlock(sectionKey, block, rootSections ?? [], parentLocked);
    }

    if (!isActive) {
      return renderPassiveEditorBlock(sectionKey, block, rootSections ?? [], parentLocked);
    }

    const contentEditor = addCoreEditorControlClasses(renderBlockContentEditor(sectionKey, block));
    const componentHeaderControls = addCoreEditorControlClasses(renderBlockHeaderControls(sectionKey, block));
    const minimumEditorWidth = getComponentEditorMinimumWidth(block);
    const activationPath = getActivationPathIds(sectionKey, rootSections ?? []);
    const activationPathIndex = activationPath.indexOf(block.id);
    const isActivatingPath = state.pendingEditorActivation?.sectionKey === sectionKey
      && state.pendingEditorActivation.revealPath !== false
      && activationPathIndex >= 0;
    const activationStyle = isActivatingPath ? ` style="--editor-activation-delay: ${activationPathIndex * 150}ms;"` : '';
    const activationAttrs = isActiveFrame ? ` data-active-editor-block="true" data-active-block-id="${deps.escapeAttr(block.id)}"` : '';
    const passiveHeightAttr = state.pendingEditorActivation?.sectionKey === sectionKey
      && state.pendingEditorActivation.blockId === block.id
      && typeof state.pendingEditorActivation.passiveHeight === 'number'
      ? ` data-passive-block-height="${state.pendingEditorActivation.passiveHeight}"`
      : '';
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
    const encryptionAction = state.showAdvancedEditor && state.showComponentEncryptionControls !== false && isActiveFrame && !editingReusableDefinition && encryptedEditorDepth === 0
      ? block.schema.kind === 'encrypted'
        ? `<button type="button" class="secondary" data-action="open-encryption-modal" data-section-key="${deps.escapeAttr(sectionKey)}" data-block-id="${deps.escapeAttr(block.id)}">Encrypted</button>`
        : `<button type="button" class="ghost" data-action="open-encryption-modal" data-section-key="${deps.escapeAttr(sectionKey)}" data-block-id="${deps.escapeAttr(block.id)}">Encrypt</button>`
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
      ? renderDeleteControl({
        className: 'editor-block-remove-button',
        label: `Remove ${componentLabel}`,
        title: 'Delete component',
        attributes: {
          'data-action': 'remove-block',
          'data-section-key': sectionKey,
          'data-block-id': block.id,
        },
      })
      : '';
    const frameRemoveButton = state.mobileAdjustmentMode ? '' : removeButton;
    const insertAboveGhost = canRenderActiveComponentInsertGhost(isActiveFrame, structurallyLocked)
      ? renderActiveComponentInsertGhost(sectionKey, block, 'before')
      : '';
    const directSectionSequence = isDirectSectionBlock && owningSection ? deps.buildSectionRenderSequence(owningSection) : [];
    const directSequenceIndex = directSectionSequence.findIndex((item) => item.kind === 'block' && item.block === block);
    const usesSectionEndGhost = directSequenceIndex >= 0 && directSequenceIndex === directSectionSequence.length - 1;
    const insertBelowGhost = canRenderActiveComponentInsertGhost(isActiveFrame, structurallyLocked)
      && !usesSectionEndGhost
      ? renderActiveComponentInsertGhost(sectionKey, block, 'after')
      : '';

    return `
      ${insertAboveGhost}
      <div class="editor-block${isActivatingPath ? ' is-activating-path' : ''}${isPlacementSource ? ' is-placement-source' : ''}" data-hvy-virtual-item="editor-block" data-section-key="${deps.escapeAttr(sectionKey)}" data-block-id="${deps.escapeAttr(block.id)}" data-parent-locked="${parentLocked ? 'true' : 'false'}"${activationStyle}${activationAttrs}${passiveHeightAttr}>
        ${componentMetaActions}
        ${frameRemoveButton}
        <div class="editor-block-head">
          <div class="section-drag-title">
            <div class="editor-order-controls">
              ${blockMove.canMoveUp ? `<button type="button" class="order-arrow-button" data-action="move-block-up" data-section-key="${deps.escapeAttr(sectionKey)}" data-block-id="${deps.escapeAttr(block.id)}" aria-label="Move block up">▲</button>` : ''}
              ${blockMove.canMoveDown ? `<button type="button" class="order-arrow-button" data-action="move-block-down" data-section-key="${deps.escapeAttr(sectionKey)}" data-block-id="${deps.escapeAttr(block.id)}" aria-label="Move block down">▼</button>` : ''}
            </div>
            ${componentHeaderControls ? `<div class="component-editor-header-controls">${componentHeaderControls}</div>` : ''}
            <strong class="editor-block-title">${deps.escapeHtml(componentLabel)}</strong>
          </div>
          <div class="editor-actions">
            ${state.mobileAdjustmentMode ? '' : isActiveFrame ? `${encryptionAction}${placementActions}` : ''}
          </div>
        </div>

        <div class="editor-block-content${anchorAttrs.className}"${anchorAttrs.attrs}>
          <div class="component-editor-width-gate" data-hvy-component-editor-gate="true" data-section-key="${deps.escapeAttr(sectionKey)}" data-block-id="${deps.escapeAttr(block.id)}" data-component-label="${deps.escapeAttr(componentLabel)}" style="--hvy-component-editor-minimum-width: ${deps.escapeAttr(minimumEditorWidth)};">
            <span class="component-editor-minimum-ruler" aria-hidden="true"></span>
            <button type="button" class="component-editor-compact-button" data-hvy-component-editor-action="open" aria-label="Edit ${deps.escapeAttr(componentLabel)}">${wrenchIcon()}<span>Edit</span></button>
            <div class="component-editor-inline-content">
              ${contentEditor}
            </div>
          </div>
          ${anchorAttrs.overlay}
        </div>
        ${showActiveBlockDoneRow
        ? `<div class="editor-block-done-row${component === 'text' ? ' editor-block-text-done-row' : ''}">
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
    const section = deps.findSectionByKey(state.documentSections, sectionKey);
    const sequence = section ? deps.buildSectionRenderSequence(section) : [];
    const blockIndex = section?.blocks.some((candidate) => candidate === block)
      ? sequence.findIndex((item) => item.kind === 'block' && item.block === block)
      : -1;
    const next = blockIndex >= 0 ? sequence[blockIndex + (placement === 'after' ? 1 : 0)] : null;
    const sectionBoundary = blockIndex < 0
      ? null
      : next?.kind === 'block'
        ? { beforeKind: 'block', beforeId: next.block.id }
        : next?.kind === 'child'
          ? { beforeKind: 'child', beforeId: next.child.key }
          : { beforeKind: 'end', beforeId: '' };
    const sectionBoundaryAttrs = sectionBoundary
      ? ` data-section-insertion="true" data-section-before-kind="${sectionBoundary.beforeKind}"${sectionBoundary.beforeId ? ` data-section-before-id="${deps.escapeAttr(sectionBoundary.beforeId)}"` : ''}`
      : '';
    return `<div class="ghost-section-card add-ghost compact-add-component-ghost active-component-insert-ghost active-component-insert-ghost-${placement}"${sectionBoundaryAttrs}>
      <span class="active-component-insert-label">Insert ${placement === 'before' ? 'Above' : 'Below'}</span>
      ${renderComponentPicker({
      id: `block:${block.id}:${placement}`,
      action: 'add-block',
      sectionKey,
      label: `Insert component ${placement === 'before' ? 'above' : 'below'}`,
      extraAttrs: {
        'data-insert-placement': placement,
        'data-target-block-id': block.id,
        ...(sectionBoundary ? {
          'data-section-insertion': 'true',
          'data-section-before-kind': sectionBoundary.beforeKind,
          ...(sectionBoundary.beforeId ? { 'data-section-before-id': sectionBoundary.beforeId } : {}),
        } : {}),
      },
      ...(isPdfEditorDocument() ? { componentFilter: isPdfAllowedEditorComponent, componentDisabledReason: getPdfDisabledComponentReason } : {}),
    })}
    </div>`;
  }

  function renderPassiveEditorBlock(
    sectionKey: string,
    block: VisualBlock,
    rootSections: VisualSection[],
    parentLocked = false
  ): string {
    if (isHiddenEditorOnlyScriptingBlock(block, sectionKey)) {
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
      <div class="editor-block-passive hvy-link-observer-surface" data-hvy-virtual-item="editor-block" data-hvy-dynamic-visibility="true" data-visible-state="${deps.escapeAttr(visibleState)}" data-action="activate-block" data-section-key="${deps.escapeAttr(sectionKey)}" data-parent-locked="${parentLocked ? 'true' : 'false'}" data-block-id="${deps.escapeAttr(
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

  function isHiddenEditorOnlyScriptingBlock(block: VisualBlock, sectionKey: string): boolean {
    return !state.showAdvancedEditor
      && !deps.isActiveEditorBlock(sectionKey, block.id)
      && block.schema.editorOnly
      && deps.resolveBaseComponent(block.schema.component) === 'plugin'
      && block.schema.plugin === SCRIPTING_PLUGIN_ID;
  }

  function hasOpenEditorInSectionTree(section: VisualSection): boolean {
    return state.activeEditorBlockSnapshots.some((active) => active.sectionKey === section.key)
      || section.children.some(hasOpenEditorInSectionTree);
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
        && !deps.isActiveEditorBlock(sectionKey, candidate.id)
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
      const body = renderPassiveContainerBlocks(sectionKey, block);
      const imageDropAttrs = `data-image-drop-block-container="container" data-section-key="${deps.escapeAttr(sectionKey)}" data-block-id="${deps.escapeAttr(block.id)}"`;
      return body
        ? `<div class="reader-container-body" ${imageDropAttrs}>${body}</div>`
        : `<div class="container-inner-blocks is-empty is-passive-empty" ${imageDropAttrs}><div class="container-empty-placeholder">Empty container</div></div>`;
    }

    if (base === 'expandable') {
      deps.ensureExpandableBlocks(block);
      // Editing surfaces follow the document: the editor's own toggle writes
      // expandableExpanded, while readerExpandableState is ephemeral viewer session state
      // that must not decide what the editor shows. Search reveal is the exception, since
      // a search runs on the surface you are already looking at.
      const expanded = state.searchRevealedAncestors[`${sectionKey}:${block.id}`] === true
        || block.schema.expandableExpanded;
      const alwaysShowStub = block.schema.expandableAlwaysShowStub;
      const stubPaneStyle = deps.escapeAttr(sanitizeInlineCss(block.schema.expandableStubCss));
      const contentPaneStyle = deps.escapeAttr(sanitizeInlineCss(block.schema.expandableContentCss));
      const stubHtml = renderEditorNestedBlocks(sectionKey, block.schema.expandableStubBlocks.children, {
        container: 'expandable-stub',
        parentBlockId: block.id,
        locked: true,
      });
      const contentHtml = renderEditorNestedBlocks(sectionKey, block.schema.expandableContentBlocks.children, {
        container: 'expandable-content',
        parentBlockId: block.id,
        locked: true,
      });
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
        return `<div class="reader-component-list">${renderEditorNestedBlocks(sectionKey, block.schema.componentListBlocks ?? [], {
          container: 'component-list',
          parentBlockId: block.id,
          locked: true,
        })}</div>`;
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
            ? `<div class="reader-component-list">${renderEditorNestedBlocks(sectionKey, block.schema.componentListBlocks, {
              container: 'component-list',
              parentBlockId: block.id,
              locked: true,
            })}</div>`
            : deps.renderReaderBlock(section, block, { ignoreReaderSessionState: true })
          : '';
        return `${existingContent}<div class="ghost-section-card add-ghost component-list-add-ghost passive-empty-list-ghost"${actionAttr}>
          <div class="ghost-plus-small">${plusIcon()}</div>
          <div class="ghost-label">${deps.escapeHtml(actionLabel)}</div>
        </div>`;
      }
      const listContent = `<div class="reader-component-list">${renderEditorNestedBlocks(sectionKey, block.schema.componentListBlocks ?? [], {
        container: 'component-list',
        parentBlockId: block.id,
        locked: true,
      })}</div>`;
      return `${listContent}${addControl}`;
    }

    if (base === 'grid') {
      deps.ensureGridItems(block.schema);
      const columns = Math.max(1, Math.min(6, block.schema.gridColumns));
      const renderedGridBlocks = new Map(
        renderEditorGridBlocks(
          sectionKey,
          block.schema.gridItems.map((item) => item.block),
          columns,
          block.schema.lock
        ).map((entry) => [entry.block, entry.html])
      );
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
          // Keep document cell CSS off passive editor scaffolding because
          // placement controls share these cells. Reader rendering owns that CSS.
          const cellStyle = `grid-column: ${gridColumn};`;
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
          return `<div class="reader-grid-cell is-passive-grid-cell" data-grid-item-id="${deps.escapeAttr(item.id)}" style="${deps.escapeAttr(cellStyle)}">${beforePlacementTarget}${renderedGridBlocks.get(item.block) ?? ''}${trailingPlacementTarget}</div>`;
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

    if (base === 'image' && !block.schema.imageFile.trim()) {
      return `<div class="image-reader">
        <div class="image-empty image-empty-editable muted">
          <span>No image</span>
          <button type="button" class="ghost image-empty-edit-button" data-action="activate-block" data-section-key="${deps.escapeAttr(
            sectionKey
          )}" data-block-id="${deps.escapeAttr(block.id)}">Edit</button>
        </div>
      </div>`;
    }

    if (base === 'text' && block.text.trim().length === 0) {
      const hint = block.schema.placeholder || 'Empty text...';
      const content = block.schema.placeholder
        ? renderTextFragment(hint)
        : deps.escapeHtml(hint);
      const alignStyle = block.schema.align === 'left' ? '' : ` style="text-align: ${deps.escapeAttr(block.schema.align)};"`;
      return `<div class="editor-passive-empty-text${block.schema.placeholder ? ' has-placeholder' : ''}"${alignStyle}>${content}</div>`;
    }

    return deps.renderReaderBlock(section, block, { suppressAiEditorDelegation: true, ignoreReaderSessionState: true });
  }

  function renderRichToolbar(
    sectionKey: string,
    blockId: string,
    options?: {
      field?: string;
      gridItemId?: string;
      rowIndex?: number;
      includeDismiss?: boolean;
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
        ${options?.includeDismiss === false ? '' : renderTextToolbarDismissButton()}
        <div class="toolbar-segment block-style-buttons" role="group" aria-label="Block style">
          <button type="button" class="${selectedClass(blockStyle === 'paragraph')}" data-rich-action="paragraph" ${richButtonAttrs} title="Normal text">Text</button>
          <button type="button" class="${selectedClass(blockStyle === 'heading-1')}" data-rich-action="heading-1" ${richButtonAttrs} title="Heading 1">H1</button>
          <button type="button" class="${selectedClass(blockStyle === 'heading-2')}" data-rich-action="heading-2" ${richButtonAttrs} title="Heading 2">H2</button>
          <button type="button" class="${selectedClass(blockStyle === 'heading-3')}" data-rich-action="heading-3" ${richButtonAttrs} title="Heading 3">H3</button>
          <button type="button" class="${selectedClass(blockStyle === 'heading-4')}" data-rich-action="heading-4" ${richButtonAttrs} title="Heading 4">H4</button>
          ${alignControls}
        </div>
        <div class="toolbar-segment format-buttons" role="group" aria-label="Text formatting">
          <button type="button" class="icon-button ghost" data-rich-action="bold" ${richButtonAttrs} aria-label="Bold" title="Bold (${hotkeyModifier}+B)"><strong>B</strong></button>
          <button type="button" class="icon-button ghost" data-rich-action="italic" ${richButtonAttrs} aria-label="Italic" title="Italic (${hotkeyModifier}+I)"><span class="toolbar-icon italic-icon" aria-hidden="true">I</span></button>
          <button type="button" class="icon-button ghost" data-rich-action="underline" ${richButtonAttrs} aria-label="Underline" title="Underline (${hotkeyModifier}+U)"><span class="toolbar-icon underline-icon" aria-hidden="true">U</span></button>
          <button type="button" class="icon-button ghost" data-rich-action="strikethrough" ${richButtonAttrs} aria-label="Strikethrough" title="Strikethrough"><span class="toolbar-icon strikethrough-icon" aria-hidden="true">S</span></button>
          <button type="button" class="icon-button${selectedClass(blockStyle === 'quote')}" data-rich-action="quote" ${richButtonAttrs} aria-label="Quote" title="Quote"><span class="toolbar-icon quote-icon" aria-hidden="true">“</span></button>
          <button type="button" class="icon-button${selectedClass(blockStyle === 'code-block')}" data-rich-action="code-block" ${richButtonAttrs} aria-label="Code block" title="Code block"><span class="toolbar-icon code-icon" aria-hidden="true">&lt;/&gt;</span></button>
          <button type="button" class="icon-button${selectedClass(blockStyle === 'list')}" data-rich-action="list" ${richButtonAttrs} aria-label="List" title="Bullet List"><span class="toolbar-icon list-icon" aria-hidden="true"></span></button>
          <button type="button" class="icon-button${selectedClass(blockStyle === 'ordered-list')}" data-rich-action="ordered-list" ${richButtonAttrs} aria-label="Numbered List" title="Numbered List"><span class="toolbar-icon ordered-list-icon" aria-hidden="true"></span></button>
          <button type="button" class="icon-button${selectedClass(blockStyle === 'checklist')}" data-rich-action="checklist" ${richButtonAttrs} aria-label="Checkbox" title="Checkbox"><span class="toolbar-icon checkbox-icon" aria-hidden="true">☑</span></button>
          <button type="button" class="icon-button ghost" data-rich-action="link" ${richButtonAttrs} aria-label="Link" title="Link (${hotkeyModifier}+K)" disabled><span class="toolbar-icon link-icon" aria-hidden="true"></span></button>
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
        <label>
          <span>Sidebar Max Width</span>
          <input data-field="meta-sidebar-max-width" placeholder="40rem" value="${deps.escapeAttr(String(state.documentMeta.sidebar_max_width ?? ''))}" />
        </label>
        <label>
          <span>Paragraph Spacing</span>
          <input data-field="meta-paragraph-spacing" placeholder="0.45rem" value="${deps.escapeAttr(getDocumentParagraphSpacing(state.documentMeta))}" />
        </label>
        <label>
          <span>Database Table Max Column Width</span>
          <input data-field="meta-database-table-max-column-width" placeholder="40rem" value="${deps.escapeAttr(String(state.documentMeta.database_table_max_column_width ?? ''))}" />
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
                  ${renderComponentSortValueDefinitions(def, index)}
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
      ${state.documentExtension === '.hvy' && state.document ? renderDocumentAttachmentManager(state.document, deps) : ''}
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
      return state.showAdvancedEditor || block.schema.buttonPositionTargetId.trim().length > 0
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

  function renderBlockHeaderControls(sectionKey: string, block: VisualBlock): string {
    const component = deps.resolveBaseComponent(block.schema.component);
    return component === 'grid'
      ? renderGridHeaderControls(sectionKey, block, deps.getComponentRenderHelpers())
      : '';
  }

  function renderEncryptedComponentEditor(sectionKey: string, block: VisualBlock): string {
    if (block.schema.encryptedBlock) {
      encryptedEditorDepth += 1;
      try {
        return `<div class="encrypted-component-editor">
          ${renderEditorBlock(sectionKey, block.schema.encryptedBlock, state.documentSections)}
        </div>`;
      } finally {
        encryptedEditorDepth -= 1;
      }
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
    const listItemComponent = block.schema.componentListComponent || 'text';
    const componentDefs = component === 'component-list' ? deps.getComponentDefs() : [];
    const listItemDefIndex = componentDefs.findIndex((definition) => definition.name === listItemComponent);
    const listItemDefinition = listItemDefIndex >= 0 ? componentDefs[listItemDefIndex] : null;
    const componentHelpers = component === 'component-list' ? deps.getComponentRenderHelpers() : null;
    const listDisplayContext = getComponentListDisplayContext(sectionKey, block.id);
    const isScriptingPlugin = component === 'plugin' && block.schema.plugin === SCRIPTING_PLUGIN_ID;
    const scriptingLibraries = Array.isArray(block.schema.pluginConfig?.libraries) ? block.schema.pluginConfig.libraries : [];
    const gridStackWidth = component === 'grid' ? coerceGridStackWidth(block.schema.gridStackWidth) : DEFAULT_GRID_STACK_WIDTH;
    const gridStackWidthDescriptionId = `grid-stack-width-description-${sectionKey}-${block.id}`;
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
              aria-describedby="${deps.escapeAttr(gridStackWidthDescriptionId)}"
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
          <p class="grid-stack-width-description" id="${deps.escapeAttr(gridStackWidthDescriptionId)}">The minimum width before grid elements are displayed vertically.</p>
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
        ${renderVisibilityScriptDisclosure(
          'block-visible-script',
          block.schema.visibleScript,
          `data-section-key="${deps.escapeAttr(sectionKey)}" data-block-id="${deps.escapeAttr(block.id)}"`,
          'Controls when this component is visible. The script must return a boolean.'
        )}
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
        ? `<section class="component-list-item-meta" aria-label="List item configuration">
          <label>
            <span>List Item Type</span>
            <select
              data-section-key="${deps.escapeAttr(sectionKey)}"
              data-block-id="${deps.escapeAttr(block.id)}"
              data-field="block-component-list-component"
              ${block.schema.componentListBlocks.length > 0 ? 'disabled' : ''}
            >${componentHelpers?.renderComponentOptions(listItemComponent) ?? ''}</select>
          </label>
          ${block.schema.componentListBlocks.length > 0
            ? '<p class="component-list-type-note">Remove all list items before changing the item type.</p>'
            : ''}
          <label>
          <span>List Item Label</span>
          <input
            data-section-key="${deps.escapeAttr(sectionKey)}"
            data-block-id="${deps.escapeAttr(block.id)}"
            data-field="block-component-list-item-label"
            placeholder="${deps.escapeAttr(getComponentListAddLabel(block).replace(/^Add\s+/, ''))}"
            value="${deps.escapeAttr(block.schema.componentListItemLabel)}"
          />
        </label>
        ${listItemDefinition
          ? `<div class="component-list-shared-sort-values">
            <p class="component-list-shared-note">Shared by every list using <strong>${deps.escapeHtml(listItemDefinition.name)}</strong>.</p>
            ${renderComponentSortValueDefinitions(listItemDefinition, listItemDefIndex)}
          </div>`
          : `<p class="component-list-shared-note">Typed sort values require a reusable component item type.</p>`}
        </section>
        <label class="checkbox-label">
          <input
            type="checkbox"
            data-section-key="${deps.escapeAttr(sectionKey)}"
            data-block-id="${deps.escapeAttr(block.id)}"
            data-field="component-list-groups-expanded"
            ${block.schema.componentListGroupsExpanded ? 'checked' : ''}
          />
          <span>Groups Expanded by Default</span>
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
      ${renderVisibilityScriptDisclosure(
        'block-button-visible-script',
        block.schema.buttonVisibleScript,
        attr,
        'Controls when the button is visible. The script must return a boolean.'
      )}
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

  function renderVisibilityScriptDisclosure(
    field: 'block-visible-script' | 'block-button-visible-script',
    value: string,
    attributes: string,
    description: string
  ): string {
    return `<details class="meta-expandable-field visibility-script-field">
      <summary>
        <span>Visibility Script</span>
        ${value.trim() ? '<span class="muted">Configured</span>' : ''}
      </summary>
      <label>
        <span>${deps.escapeHtml(description)}</span>
        <textarea
          rows="5"
          spellcheck="false"
          ${attributes}
          data-field="${field}"
        >${deps.escapeHtml(value)}</textarea>
      </label>
    </details>`;
  }

  function renderComponentListDisplayFields(sectionKey: string, block: VisualBlock, context: ComponentListDisplayContext): string {
    return `<section class="component-list-display-editor" aria-label="Component list display">
      <strong>Component List Display</strong>
      ${renderDisplayKeyEditor('Sort Keys', 'sort', sectionKey, block, context.sortKeys, block.schema.sortKeys)}
      ${renderDisplayKeyEditor('Grouping Keys', 'group', sectionKey, block, context.groupKeys, block.schema.groupKeys)}
    </section>`;
  }

  function renderComponentSortValueDefinitions(definition: ComponentDefinition, defIndex: number): string {
    const entries = Object.entries(definition.sortValueDefs ?? {});
    return `<section class="component-sort-value-editor" aria-label="Sort Values">
      <div class="meta-panel-head">
        <strong>Sort Values</strong>
        <button type="button" class="ghost component-sort-value-action" data-action="add-component-sort-value" data-def-index="${defIndex}">
          ${plusIcon()} Add Sort Value
        </button>
      </div>
      ${entries.length === 0
        ? '<p class="muted component-sort-value-empty">No sort values defined.</p>'
        : entries.map(([name, sortDefinition], sortValueIndex) => {
          const options = sortDefinition.type === 'enum' ? sortDefinition.options ?? [] : [];
          const openKey = componentSortValueDetailsKey(defIndex, name);
          return `<details
            class="component-sort-value-card component-sort-value-details"
            data-def-index="${defIndex}"
            data-sort-value-name="${deps.escapeAttr(name)}"
            data-sort-value-index="${sortValueIndex}"
            ${state.openTemplateDefinitionKeys.includes(openKey) ? 'open' : ''}
          >
            <summary class="component-sort-value-summary">
              <span class="component-sort-value-summary-text">
                <strong>${deps.escapeHtml(name)}</strong>
                <span>${sortDefinition.type === 'datetime' ? 'Date & Time' : sortDefinition.type[0].toUpperCase() + sortDefinition.type.slice(1)}${sortDefinition.type === 'enum' ? ` · ${options.length} option${options.length === 1 ? '' : 's'}` : ''}</span>
              </span>
              <span class="component-sort-value-summary-icon" aria-hidden="true">⌄</span>
            </summary>
            <div class="component-sort-value-card-body">
              <div class="component-sort-value-fields">
              <label>
                <span>Name</span>
                <input
                  data-field="def-sort-value-name"
                  data-def-index="${defIndex}"
                  data-sort-value-name="${deps.escapeAttr(name)}"
                  value="${deps.escapeAttr(name)}"
                />
              </label>
              <label>
                <span>Type</span>
                <select
                  data-field="def-sort-value-type"
                  data-def-index="${defIndex}"
                  data-sort-value-name="${deps.escapeAttr(name)}"
                >
                  ${(['text', 'number', 'date', 'datetime', 'enum'] as const).map((type) =>
                    `<option value="${type}"${sortDefinition.type === type ? ' selected' : ''}>${type === 'datetime' ? 'Date & Time' : type[0].toUpperCase() + type.slice(1)}</option>`
                  ).join('')}
                </select>
              </label>
              <button
                type="button"
                class="danger remove-x component-sort-value-remove"
                data-action="remove-component-sort-value"
                data-def-index="${defIndex}"
                data-sort-value-name="${deps.escapeAttr(name)}"
                aria-label="Remove ${deps.escapeAttr(name)} sort value"
              >${closeIcon()}</button>
              </div>
            ${sortDefinition.type === 'date'
              ? `<label>
                <span>Date Format</span>
                <select data-field="def-sort-value-format" data-def-index="${defIndex}" data-sort-value-name="${deps.escapeAttr(name)}">
                  ${(['YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY'] as const).map((format) =>
                    `<option value="${format}"${sortDefinition.format === format ? ' selected' : ''}>${format}</option>`
                  ).join('')}
                </select>
              </label>`
              : ''}
            ${sortDefinition.type === 'enum'
              ? `<div class="component-enum-option-editor">
                <div class="component-enum-option-head">
                  <strong>Options</strong>
                  <button
                    type="button"
                    class="ghost component-sort-value-action"
                    data-action="add-component-enum-option"
                    data-def-index="${defIndex}"
                    data-sort-value-name="${deps.escapeAttr(name)}"
                  >${plusIcon()} Add Option</button>
                </div>
                ${options.length === 0
                  ? '<p class="muted component-sort-value-empty">No enum options defined.</p>'
                  : options.map((option, optionIndex) => `<div class="component-enum-option-row">
                    <label>
                      <span>Label</span>
                      <input data-field="def-enum-option-label" data-def-index="${defIndex}" data-sort-value-name="${deps.escapeAttr(name)}" data-option-index="${optionIndex}" value="${deps.escapeAttr(option.label)}" />
                    </label>
                    <label>
                      <span>Value</span>
                      <input data-field="def-enum-option-value" data-def-index="${defIndex}" data-sort-value-name="${deps.escapeAttr(name)}" data-option-index="${optionIndex}" value="${deps.escapeAttr(String(option.value))}" />
                    </label>
                    <button
                      type="button"
                      class="danger remove-x"
                      data-action="remove-component-enum-option"
                      data-def-index="${defIndex}"
                      data-sort-value-name="${deps.escapeAttr(name)}"
                      data-option-index="${optionIndex}"
                      aria-label="Remove ${deps.escapeAttr(option.label)} option"
                    >${closeIcon()}</button>
                  </div>`).join('')}
              </div>`
              : ''}
            </div>
          </details>`;
        }).join('')}
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

  function renderTextFragment(content: string, answerGroups?: Map<number, string>): string {
    const normalized = normalizeMarkdownIndentation(normalizeMarkdownLists(content));
    const linkedHtml = addExternalLinkTargets(markdownToReaderHtml(normalized, {
      answerGroups,
      textLineStyles: getTextLineStylesFromMeta(state.documentMeta),
      textLineStyleMode: state.currentView === 'editor' ? 'editor' : 'viewer',
      preserveSortValueAnnotations: state.currentView === 'editor',
      crossDocumentLinksEnabled: state.crossDocumentLinksEnabled === true,
    }), state.crossDocumentLinksEnabled === true);
    const attachmentHtml = state.document
      ? renderUserFileAttachmentLinksInHtml(linkedHtml, state.document)
      : linkedHtml;
    return unwrapSingleParagraph(decorateMarkdownCodeBlocks(attachmentHtml, deps.escapeHtml));
  }

  function renderComponentFragment(componentName: string, content: string, block: VisualBlock, sectionKey = ''): string {
    if (componentName === 'code') {
      return renderSyntaxHighlightedCode(content, block.schema.codeLanguage || 'text');
    }
    // Radio groups can span components, so membership comes from the document index.
    const answerGroups = componentName === 'text'
      ? getBlockAnswerGroups(getInlineAnswerGroupIndex(state.documentSections), sectionKey, block.id)
      : undefined;
    if (componentName === 'text' && block.schema.fillIn && hasTextFillInMarker(content)) {
      if (state.currentView === 'viewer') {
        return renderTextFragment(removeTextFillInMarkers(content), answerGroups);
      }
      const parts = splitTextFillIns(content);
      const tokenPrefix = 'HVY_FILL_IN_VALUE_TOKEN_';
      let html = renderTextFragment(
        parts.map((part, index) => (index < parts.length - 1 ? `${part}${tokenPrefix}${index}` : part)).join(''),
        answerGroups
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
    return renderTextFragment(content, answerGroups);
  }

  function renderPassiveContainerBlocks(sectionKey: string, block: VisualBlock): string {
    return renderEditorNestedBlocks(sectionKey, block.schema.containerBlocks, {
      container: 'container',
      parentBlockId: block.id,
      locked: block.schema.lock,
    });
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
    renderEditorSection,
    renderTopLevelSectionInsertGutter,
    recordEditorSectionHeight,
    recordEditorBlockHeight,
    renderSidebarEditorSections,
    renderSidebarHelpBalloon,
    renderEditorBlock: (sectionKey, block, rootSections, parentLocked) => renderEditorBlock(sectionKey, block, rootSections, parentLocked),
    renderEditorNestedBlocks,
    renderEditorGridBlocks,
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

function addCoreEditorControlClasses(markup: string): string {
  // Plugins render an empty mount placeholder here and attach their own DOM later,
  // so only controls emitted by core editor renderers receive these ownership classes.
  return markup.replace(/<(input|select|textarea)\b[^>]*>/g, (tag, elementName: string) => {
    const controlClass = elementName === 'select'
      ? 'hvy-editor-select-control'
      : 'hvy-editor-field-control';
    const classAttribute = tag.match(/\bclass=(['"])(.*?)\1/);
    if (!classAttribute) {
      return tag.replace(/^<([a-z]+)/, `<$1 class="${controlClass}"`);
    }
    const currentClasses = classAttribute[2].split(/\s+/);
    if (currentClasses.includes(controlClass)) {
      return tag;
    }
    const nextClassAttribute = `class=${classAttribute[1]}${classAttribute[2]} ${controlClass}${classAttribute[1]}`;
    return tag.replace(classAttribute[0], nextClassAttribute);
  });
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

export function componentSortValueDetailsKey(defIndex: number, name: string): string {
  return `component-sort-value:${defIndex}:${name}`;
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
