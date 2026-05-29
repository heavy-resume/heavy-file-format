import './reader.css';
import './sidebar.css';
import { stringify as stringifyYaml } from 'yaml';
import { renderCodeReader } from '../editor/components/code/code';
import { renderButtonReader } from '../editor/components/button/button';
import { renderComponentListReader } from '../editor/components/component-list/component-list';
import { getComponentListAddLabel, hasComponentListItems } from '../editor/components/component-list/component-list-labels';
import { renderContainerReader } from '../editor/components/container/container';
import { renderExpandableReader } from '../editor/components/expandable/expandable';
import { renderGridReader } from '../editor/components/grid/grid';
import { renderImageReader } from '../editor/components/image/image';
import { renderCarouselReader } from '../editor/components/carousel/carousel';
import { renderPluginReader } from '../editor/components/plugin/plugin';
import { renderTableReader, resetReaderTableStripeSequence } from '../editor/components/table/table';
import { renderTextReader } from '../editor/components/text/text';
import { renderXrefCardReader } from '../editor/components/xref-card/xref-card';
import type { ComponentRenderHelpers } from '../editor/component-helpers';
import { renderAddComponentPicker } from '../editor/component-picker';
import type { BlockSchema, VisualBlock, VisualSection } from '../editor/types';
import { renderTagEditor } from '../editor/tag-editor';
import { colorValueToAlpha, colorValueToPickerHex, getResolvedThemeColor, getThemeColorLabel, getThemeResetColor, THEME_COLOR_NAMES } from '../theme';
import type { ThemeConfig } from '../theme';
import { getMatchedPaletteId, HVY_PALETTES } from '../palettes/palette-registry';
import type { ComponentDefinition, DbTableQueryModalState, ReaderViewFilter, ReusableDefinitionEditModalState, ReusableSaveModalState, SectionTemplateFlavorModalState, SqliteRowComponentModalState, VisualDocument } from '../types';
import type { SearchState } from '../search/types';
import { createSearchFilterContext, isBlockSearchDeprioritized, isBlockSearchMatch, isBlockSearchVisible, isSectionSearchDeprioritized, isSectionSearchMatch, isSectionSearchVisible, orderSearchFilteredSections, type SearchFilterContext } from '../search/filter';
import { highlightSearchHtml } from '../search/highlight';
import { getDocumentSectionDefaultCss, mergeDocumentCss } from '../document-section-defaults';
import { getHeadingStyleSurfaceClass, renderHeadingStyleElement } from '../heading-styles';
import { sanitizeInlineCss } from '../css-sanitizer';
import { areTablesEnabled } from '../reference-config';
import { defaultBlockSchema, getReusableTemplate, schemaFromUnknown } from '../document-factory';
import { parseAttachedComponentBlocks } from '../plugins/db-table-fragment';
import { getOutputGenerator, SCRIPTING_PLUGIN_ID } from '../plugins/registry';
import { getComponentDefsFromMeta, getSectionDefsFromMeta } from '../component-defs';
import { REUSABLE_SECTION_PREFIX } from '../state';
import { extractReusableTemplateVariablesFromDefinition } from '../reusable-template-values';
import { filterTemplateVisibleSections, isSectionHiddenByTemplateMarker } from '../template-hide';
import { closeIcon, plusIcon } from '../icons';
import { ENABLE_PDF_TEMPLATE_IMPORT_STEPPER } from '../pdf-export/action';
import { isAiEditablePlaceholderTextBlock } from '../ai-placeholder';
import {
  createReaderViewContext,
  getBlockReaderViewTargetKey,
  getReaderViewModifiers,
  isReaderViewPrioritized,
  getSectionReaderViewTargetKey,
  hasReaderViewModifier,
  orderReaderViewTargets,
  type ReaderViewContext,
  type ReaderViewTargetKey,
} from './view-filter';

interface ReaderRenderState {
  documentMeta: VisualDocument['meta'];
  documentExtension?: VisualDocument['extension'];
  documentSections: VisualSection[];
  addComponentBySection: Record<string, string>;
  tempHighlights: Set<string>;
  aiEditTarget: { sectionKey: string | null; blockId: string | null };
  contextMenu?: { kind: 'filter' | 'ai' | 'editor'; sectionKey: string; blockId?: string } | null;
  activeEditorBlock?: { sectionKey: string; blockId: string } | null;
  aiEditorHostBlock?: { sectionKey: string; blockId: string } | null;
  aiEditorHostSectionKey?: string | null;
  modalSectionKey: string | null;
  sqliteRowComponentModal: SqliteRowComponentModalState | null;
  dbTableQueryModal: DbTableQueryModalState | null;
  pdfTemplateImportModal: import('../types').PdfTemplateImportModalState | null;
  reusableSaveModal: ReusableSaveModalState | null;
  reusableTemplateModal: import('../types').ReusableTemplateModalState | null;
  reusableDefinitionEditModal?: ReusableDefinitionEditModalState | null;
  sectionTemplateFlavorModal: SectionTemplateFlavorModalState | null;
  componentMetaModal: { sectionKey: string; blockId: string } | null;
  themeModalOpen: boolean;
  themeModalMode: 'full' | 'advanced';
  paletteOverrideId: string | null;
  theme: ThemeConfig;
  currentView: 'editor' | 'viewer' | 'ai';
  showAdvancedEditor: boolean;
  responsivePreview: 'full' | 'phone' | 'tablet' | 'desktop';
  readerExpandableState: Record<string, boolean>;
  readerContainerState: Record<string, boolean>;
  readerView: ReaderViewFilter;
  readerViewActivatedTargets: Set<string>;
  search: SearchState;
  componentListReaderViews: Record<string, string>;
  viewerSidebarHelpDismissed: boolean;
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
  renderEditorBlock: (sectionKey: string, block: VisualBlock, rootSections?: VisualSection[]) => string;
  renderBlockContentEditor: (sectionKey: string, block: VisualBlock) => string;
  renderComponentOptions: (selected: string) => string;
  renderReusableSectionOptions: (selected: string) => string;
  getSectionDefs: () => unknown[];
  renderBlockMetaFields: (sectionKey: string, block: VisualBlock) => string;
}

export interface ReaderBlockRenderOptions {
  suppressAiEditorDelegation?: boolean;
}

export interface ReaderRenderer {
  renderNavigation: (sections: VisualSection[]) => string;
  renderReaderSections: (sections: VisualSection[]) => string;
  renderSidebarSections: (sections: VisualSection[]) => string;
  renderSidebarHelpBalloon: (sections: VisualSection[]) => string;
  renderReaderSection: (section: VisualSection) => string;
  renderReaderBlock: (section: VisualSection, block: VisualBlock, options?: ReaderBlockRenderOptions) => string;
  renderReaderBlocks: (section: VisualSection, blocks: VisualBlock[]) => string;
  renderReaderListBlocks: (section: VisualSection, blocks: VisualBlock[]) => string;
  orderReaderBlocks: (blocks: VisualBlock[]) => VisualBlock[];
  orderReaderListBlocks: (blocks: VisualBlock[]) => VisualBlock[];
  isReaderViewPrioritizedBlock: (block: VisualBlock) => boolean;
  renderThemeEditor: (options?: { advanced?: boolean; includePalettePicker?: boolean; includeModalActions?: boolean }) => string;
  renderModal: () => string;
  renderLinkInlineModal: () => string;
  renderWarnings: () => string;
}

export function createReaderRenderer(state: ReaderRenderState, deps: ReaderRenderDeps): ReaderRenderer {
  let activeReaderViewContext: ReaderViewContext | null = null;
  let activeSearchFilterContext: SearchFilterContext | null = null;

  function withReaderViewContext(render: () => string): string {
    const previous = activeReaderViewContext;
    const previousSearch = activeSearchFilterContext;
    const sections = getViewerContextSections();
    activeReaderViewContext = createReaderViewContext(
      { meta: state.documentMeta, extension: '.hvy', sections, attachments: [] },
      state.readerView
    );
    activeSearchFilterContext = createSearchFilterContext(sections, state.search);
    try {
      return render();
    } finally {
      activeReaderViewContext = previous;
      activeSearchFilterContext = previousSearch;
    }
  }

  function getActiveReaderViewContext(): ReaderViewContext {
    if (!activeReaderViewContext) {
      return createReaderViewContext(
        { meta: state.documentMeta, extension: state.documentExtension ?? '.hvy', sections: getViewerContextSections(), attachments: [] },
        state.readerView
      );
    }
    return activeReaderViewContext;
  }

  function isPdfReaderDocument(): boolean {
    return state.documentExtension === '.phvy';
  }

  function getActiveSearchFilterContext(): SearchFilterContext {
    return activeSearchFilterContext ?? createSearchFilterContext(getViewerContextSections(), state.search);
  }

  function getViewerContextSections(): VisualSection[] {
    if (state.currentView !== 'viewer') {
      return state.documentSections;
    }
    return filterTemplateVisibleSections(state.documentSections);
  }

  function renderNavigation(sections: VisualSection[]): string {
    return withReaderViewContext(() => {
      const viewContext = getActiveReaderViewContext();
      const items = deps.flattenSections(sections).filter((section) => {
        if (section.isGhost || section.location === 'sidebar' || isViewerHiddenSection(section)) {
          return false;
        }
        return !hasReaderViewModifier(viewContext, getSectionReaderViewTargetKey(section), 'hidden');
      });
      if (items.length === 0) {
        return '<div class="muted">Navigation will appear when sections exist.</div>';
      }

      return `
        <div class="hvy-nav-title">Navigation</div>
        <div class="hvy-nav-list">
          ${items
            .map(
              (section) =>
                `<button type="button" class="hvy-nav-item" data-nav-id="${deps.escapeAttr(deps.getSectionId(section))}" data-level="${section.level}">${deps.escapeHtml(
                  deps.formatSectionTitle(section.title)
                )}</button>`
            )
            .join('')}
        </div>
      `;
    });
  }

  function renderReaderSections(sections: VisualSection[]): string {
    return withReaderViewContext(() => {
      resetReaderTableStripeSequence();
      const realSections = orderReaderSections(
        sections.filter((section) => !section.isGhost && section.location !== 'sidebar' && !isViewerHiddenSection(section) && isSectionSearchVisible(getActiveSearchFilterContext(), section))
      );
      const topLevelAddGhost = renderAiTopLevelSectionAddGhost('main');
      if (realSections.length === 0) {
        return getActiveSearchFilterContext().filtering
          ? '<div class="reader-search-empty"><div>No matches in this filtered view.</div></div>'
          : topLevelAddGhost
          ? `<div${renderResponsiveSurfaceAttrs('')}>${renderSurfaceHeadingStyles()}<div class="reader-document-body">${topLevelAddGhost}</div></div>`
          : '<div class="reader-empty-state" role="status">No content to display yet.</div>';
      }
      const maxWidth = typeof state.documentMeta.reader_max_width === 'string' ? state.documentMeta.reader_max_width.trim() : '';
      const bodyStyle = maxWidth.length > 0 ? ` style="max-width: ${deps.escapeAttr(maxWidth)};"` : '';
      const surfaceAttrs = renderResponsiveSurfaceAttrs(maxWidth);
      return `<div${surfaceAttrs}>${renderSurfaceHeadingStyles()}<div class="reader-document-body"${bodyStyle}>${realSections.map((section) => renderReaderSection(section)).join('')}${topLevelAddGhost}</div></div>`;
    });
  }

  function renderAiTopLevelSectionAddGhost(location: 'main' | 'sidebar'): string {
    if (state.currentView !== 'ai' || getActiveSearchFilterContext().filtering) {
      return '';
    }
    if (location === 'sidebar' && isPdfReaderDocument()) {
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

  function renderSidebarSections(sections: VisualSection[]): string {
    if (isPdfReaderDocument()) {
      return '';
    }
    return withReaderViewContext(() => {
      resetReaderTableStripeSequence();
      const sidebarSections = orderReaderSections(
        sections.filter((section) => !section.isGhost && section.location === 'sidebar' && !isViewerHiddenSection(section) && isSectionSearchVisible(getActiveSearchFilterContext(), section))
      );
      const topLevelAddGhost = renderAiTopLevelSectionAddGhost('sidebar');
      const sidebarSectionsHtml = sidebarSections.map((section) => renderReaderSection(section)).join('');
      if (!sidebarSectionsHtml.trim() && !topLevelAddGhost) {
        return '';
      }
      const surfaceAttrs = renderResponsiveSurfaceAttrs('');
      return `<div${surfaceAttrs}>${renderSurfaceHeadingStyles()}<div class="reader-sidebar-surface-body">${sidebarSectionsHtml}${topLevelAddGhost}</div></div>`;
    });
  }

  function renderSidebarHelpBalloon(sections: VisualSection[]): string {
    if (isPdfReaderDocument()) {
      return '';
    }
    if (state.viewerSidebarHelpDismissed) {
      return '';
    }
    const sidebarSections = sections.filter((section) => !section.isGhost && section.location === 'sidebar' && !isViewerHiddenSection(section));
    if (sidebarSections.length === 0) {
      return '';
    }
    return `<div class="viewer-sidebar-help-balloon" role="note" aria-label="Sections in pullout">
      <div class="viewer-sidebar-help-title">Contains</div>
      <ul>
        ${sidebarSections
          .map((section) => `<li title="${deps.escapeAttr(deps.formatSectionTitle(section.title))}">${deps.escapeHtml(deps.formatSectionTitle(section.title))}</li>`)
          .join('')}
      </ul>
    </div>`;
  }

  function renderReaderSection(section: VisualSection): string {
    if (isViewerHiddenSection(section)) {
      return '';
    }
    const viewContext = getActiveReaderViewContext();
    const targetKey = getSectionReaderViewTargetKey(section);
    if (hasReaderViewModifier(viewContext, targetKey, 'hidden')) {
      return '';
    }
    const searchContext = getActiveSearchFilterContext();
    if (!isSectionSearchVisible(searchContext, section)) {
      return '';
    }
    const effectiveId = deps.getSectionId(section);
    const temp = state.tempHighlights.has(effectiveId);
    const modifiers = getReaderViewModifiers(viewContext, targetKey);
    const dimmed = modifiers.has('dimmed') && !state.readerViewActivatedTargets.has(targetKey);
    const searchDimmed = isSectionSearchDeprioritized(searchContext, section);
    const prioritized = isSectionReaderPriority(section, viewContext, targetKey);
    const viewCollapseKey = `reader-view-collapse:${targetKey}`;
    const viewExpanded = state.readerContainerState[viewCollapseKey] ?? !modifiers.has('collapse');
    const autoExpanded = !modifiers.has('collapse') && !section.expanded && shouldAutoExpandAuthoringSection(section);
    const sectionExpanded = modifiers.has('collapse') ? viewExpanded : prioritized || autoExpanded ? true : section.expanded;
    const classList = [
      'reader-section',
      section.contained ? '' : 'is-uncontained',
      modifiers.has('collapse')
        ? (sectionExpanded ? '' : 'is-collapsed-preview')
        : (!section.contained || sectionExpanded ? '' : 'is-collapsed-preview'),
      section.highlight || modifiers.has('highlight') ? 'is-highlighted' : '',
      isSectionSearchMatch(searchContext, section) ? 'is-search-match' : '',
      dimmed ? 'is-reader-view-dimmed' : '',
      searchDimmed ? 'is-search-deprioritized' : '',
      temp ? 'is-temp-highlighted' : '',
    ]
      .filter(Boolean)
      .join(' ');

    const contentClass = modifiers.has('collapse') || section.contained
      ? (sectionExpanded ? 'reader-section-content' : 'reader-section-content reader-section-preview')
      : 'reader-section-content';
    const blocksHtml = renderReaderBlocks(section, section.blocks);
    const childrenHtml = orderReaderSections(
      section.children.filter((child) => !child.isGhost && !isViewerHiddenSection(child))
    ).map((child) => renderReaderSection(child)).join('');
    if (!blocksHtml.trim() && !childrenHtml.trim() && !isSectionSearchMatch(searchContext, section)) {
      return '';
    }
    const content = `<div class="${contentClass}">${blocksHtml}${childrenHtml}${renderAiActiveSectionAddAffordance(section)}</div>`;

    const viewCollapseAttrs = `data-reader-action="toggle-view-collapse" data-reader-view-target="${deps.escapeAttr(targetKey)}" data-reader-view-collapse-key="${deps.escapeAttr(viewCollapseKey)}" aria-expanded="${viewExpanded ? 'true' : 'false'}"`;
    const toggleAttrs = modifiers.has('collapse')
      ? (sectionExpanded ? '' : ` ${viewCollapseAttrs}`)
      : section.contained && sectionExpanded
      ? ''
      : section.contained
      ? ` data-reader-action="toggle-expand" data-section-key="${deps.escapeAttr(section.key)}"`
      : '';

    const suppressSectionToggle = state.currentView === 'ai' && state.activeEditorBlock?.sectionKey === section.key;
    const header = !suppressSectionToggle && (section.contained || modifiers.has('collapse'))
      ? `
        <header class="reader-section-head" aria-label="Section controls">
          <div class="reader-head-actions">
            <button type="button" class="tiny toggle-expand-button" ${modifiers.has('collapse')
              ? viewCollapseAttrs
              : `data-reader-action="toggle-expand" data-section-key="${deps.escapeAttr(section.key)}"`} aria-label="${
          sectionExpanded ? 'Collapse section' : 'Expand section'
        }">${sectionExpanded ? '-' : '+'}</button>
          </div>
        </header>
      `
      : '';
    const sectionStyle = mergeDocumentCss(getDocumentSectionDefaultCss(state.documentMeta), section.css);

    return `
      <section id="${deps.escapeAttr(effectiveId)}" class="${classList}" data-hvy-virtual-section="reader" data-section-key="${deps.escapeAttr(section.key)}" style="${deps.escapeAttr(sectionStyle)}"${renderReaderViewTargetAttrs(targetKey, dimmed)}${toggleAttrs}>
        ${header}
        ${content}
      </section>
    `;
  }

  function shouldAutoExpandAuthoringSection(section: VisualSection): boolean {
    if (state.currentView !== 'ai' || !section.contained || section.children.length > 0) {
      return false;
    }
    return section.blocks.some((block) =>
      deps.resolveBaseComponent(block.schema.component) === 'component-list'
      && !hasComponentListItems(block)
    );
  }

  function renderReaderBlock(section: VisualSection, block: VisualBlock, options: ReaderBlockRenderOptions = {}): string {
    if (isViewerHiddenBlock(block)) {
      return '';
    }
    const viewContext = getActiveReaderViewContext();
    const searchContext = getActiveSearchFilterContext();
    const targetKey = getBlockReaderViewTargetKey(block);
    if (hasReaderViewModifier(viewContext, targetKey, 'hidden')) {
      return '';
    }
    if (!isBlockSearchVisible(searchContext, block)) {
      return '';
    }
    const base = deps.resolveBaseComponent(block.schema.component);
    if (!options.suppressAiEditorDelegation && state.currentView === 'ai' && (isAiEditorHostSection(section.key) || isAiEditorHostBlock(section.key, block.id))) {
      return deps.renderEditorBlock(section.key, block);
    }
    if (!options.suppressAiEditorDelegation && state.currentView === 'ai' && shouldRenderAiPassiveEditorAffordance(base, block)) {
      return deps.renderEditorBlock(section.key, block);
    }
    const modifiers = getReaderViewModifiers(viewContext, targetKey);
    const prioritized = isReaderViewPrioritized(viewContext, targetKey);
    const searchDimmed = isBlockSearchDeprioritized(searchContext, block);
    const forceSearchExpanded = searchContext.filtering && searchContext.filterMode === 'hide' && !searchDimmed;
    const readerExpanded = base === 'expandable'
      ? getReaderExpandableExpanded(section.key, block, forceSearchExpanded ? true : modifiers.has('collapse') ? false : prioritized ? true : block.schema.expandableExpanded)
      : block.schema.expandableExpanded;
    const blockDomId = getBlockDomId(block);
    const idAttr = blockDomId ? ` id="${deps.escapeAttr(blockDomId)}"` : '';
    const dimmed = modifiers.has('dimmed') && !state.readerViewActivatedTargets.has(targetKey);
    const blockClass = [
      'reader-block',
      `reader-block-${base}`,
      block.schema.align === 'left' ? '' : `align-${block.schema.align}`,
      `slot-${block.schema.slot}`,
      state.aiEditTarget.sectionKey === section.key && state.aiEditTarget.blockId === block.id ? 'is-ai-target' : '',
      state.contextMenu?.kind === 'ai' && state.contextMenu.sectionKey === section.key && state.contextMenu.blockId === block.id ? 'is-context-menu-target' : '',
      state.currentView === 'ai' && base === 'text' && isAiEditablePlaceholderTextBlock(block) ? 'is-ai-editable-placeholder' : '',
      modifiers.has('highlight') ? 'is-highlighted' : '',
      isBlockSearchMatch(searchContext, block) ? 'is-search-match' : '',
      dimmed ? 'is-reader-view-dimmed' : '',
      searchDimmed ? 'is-search-deprioritized' : '',
      blockDomId && state.tempHighlights.has(blockDomId) ? 'is-temp-highlighted' : '',
    ]
      .filter(Boolean)
      .map((part) => deps.escapeAttr(part))
      .join(' ');
    const expandableAttrs = base === 'expandable'
      ? ` data-reader-action="toggle-expandable" aria-expanded="${readerExpanded ? 'true' : 'false'}"`
      : '';
    const anchor = getReaderButtonAnchor(section, block);
    const visibleState = block.schema.visibleScript.trim() ? 'pending' : 'visible';
    const blockAttrs = `${idAttr} class="${blockClass}${anchor.className}" data-hvy-dynamic-visibility="true" data-visible-state="${deps.escapeAttr(visibleState)}" data-component="${deps.escapeAttr(block.schema.component)}" data-section-key="${deps.escapeAttr(section.key)}" data-block-id="${deps.escapeAttr(block.id)}"${blockDomId ? ` data-component-id="${deps.escapeAttr(blockDomId)}"` : ''}${anchor.attrs}${expandableAttrs} style="${deps.escapeAttr(sanitizeInlineCss(block.schema.css))}"`;
    const helpers = deps.getComponentRenderHelpers();
    const renderBlockShell = (body: string): string => {
      const query = searchContext.filtering ? '' : searchContext.query;
      return `<div ${blockAttrs}${renderReaderViewTargetAttrs(targetKey, dimmed)}>${highlightSearchHtml(body, query, searchContext.caseSensitive)}${anchor.overlay}</div>`;
    };
    const renderMaybeCollapsedBlockShell = (body: string): string => {
      if (!modifiers.has('collapse') || base === 'container' || base === 'expandable') {
        return renderBlockShell(body);
      }
      return renderBlockShell(renderReaderViewCollapseWrapper(targetKey, block, body));
    };
    const renderNonEmptyBlockShell = (body: string): string => body.trim() ? renderBlockShell(body) : '';
    const renderNonEmptyMaybeCollapsedBlockShell = (body: string): string =>
      body.trim() ? renderMaybeCollapsedBlockShell(body) : '';

    if (base === 'plugin') {
      if (block.schema.plugin === SCRIPTING_PLUGIN_ID) {
        if (state.currentView === 'viewer') {
          return renderMaybeCollapsedBlockShell(renderPluginReader(section, block, helpers));
        }
        if (state.currentView === 'ai') {
          if (block.text.trim().length === 0) {
            return renderMaybeCollapsedBlockShell(renderPluginReader(section, block, helpers));
          }
          const codeReader = renderCodeReader(
            section,
            { ...block, schema: { ...block.schema, codeLanguage: 'python' } } as VisualBlock,
            helpers
          );
          return renderMaybeCollapsedBlockShell(`${codeReader}${renderPluginReader(section, block, helpers)}`);
        }
        if (block.text.trim().length === 0) {
          return renderMaybeCollapsedBlockShell('<div class="plugin-placeholder">Empty script...</div>');
        }
        return renderMaybeCollapsedBlockShell(renderCodeReader(section, { ...block, schema: { ...block.schema, codeLanguage: 'python' } } as VisualBlock, helpers));
      }
      return renderMaybeCollapsedBlockShell(renderPluginReader(section, block, helpers));
    }
    if (base === 'button') {
      return renderMaybeCollapsedBlockShell(renderButtonReader(section, block, helpers));
    }
    if (base === 'container') {
      const readerBlock = modifiers.has('collapse')
        ? { ...block, schema: { ...block.schema, containerExpanded: false } } as VisualBlock
        : forceSearchExpanded
        ? { ...block, schema: { ...block.schema, containerExpanded: true } } as VisualBlock
        : prioritized
        ? { ...block, schema: { ...block.schema, containerExpanded: true } } as VisualBlock
        : block;
      return renderNonEmptyBlockShell(renderContainerReader(section, readerBlock, helpers));
    }
    if (base === 'component-list') {
      const listHtml = renderComponentListReader(section, block, helpers);
      const addAffordance = renderAiActiveComponentListAddAffordance(section, block);
      return renderNonEmptyMaybeCollapsedBlockShell(`${listHtml}${addAffordance}`);
    }
    if (base === 'grid') {
      deps.ensureGridItems(block.schema);
      return renderNonEmptyMaybeCollapsedBlockShell(renderGridReader(section, block, helpers));
    }
    if (base === 'expandable') {
      deps.ensureExpandableBlocks(block);
      const readerBlock = {
        ...block,
        schema: {
          ...block.schema,
          expandableExpanded: readerExpanded,
          expandableAlwaysShowStub: forceSearchExpanded ? true : block.schema.expandableAlwaysShowStub,
        },
      } as VisualBlock;
      return renderNonEmptyBlockShell(renderExpandableReader(section, readerBlock, helpers));
    }
    if (base === 'table') {
      if (!areTablesEnabled()) {
        return renderMaybeCollapsedBlockShell('<div class="plugin-placeholder">Table rendering is disabled in this reference implementation.</div>');
      }
      return renderMaybeCollapsedBlockShell(renderTableReader(section, block, helpers));
    }
    if (base === 'xref-card') {
      return renderMaybeCollapsedBlockShell(renderXrefCardReader(section, block, helpers));
    }
    if (base === 'image') {
      return renderMaybeCollapsedBlockShell(renderImageReader(section, block, helpers));
    }
    if (base === 'carousel') {
      return renderMaybeCollapsedBlockShell(renderCarouselReader(section, block, helpers));
    }
    return renderMaybeCollapsedBlockShell(renderTextReader(section, block, helpers));
  }

  function isAiEditorHostBlock(sectionKey: string, blockId: string): boolean {
    const host = state.aiEditorHostBlock ?? state.activeEditorBlock ?? null;
    return host?.sectionKey === sectionKey && host.blockId === blockId;
  }

  function isAiEditorHostSection(sectionKey: string): boolean {
    return state.aiEditorHostSectionKey === sectionKey;
  }

  function renderAiActiveSectionAddAffordance(section: VisualSection): string {
    if (state.currentView !== 'ai' || section.lock || !isAiEditorHostSection(section.key)) {
      return '';
    }
    return `<div class="ghost-section-card add-ghost compact-add-component-ghost">
      ${renderAddComponentPicker({
        id: `ai-section:${section.key}`,
        action: 'add-block',
        sectionKey: section.key,
        label: 'Section component type',
      }, {
        escapeAttr: deps.escapeAttr,
        escapeHtml: deps.escapeHtml,
        getComponentDefs: () => getComponentDefsFromMeta(state.documentMeta),
      })}
    </div>`;
  }

  function renderAiActiveComponentListAddAffordance(section: VisualSection, block: VisualBlock): string {
    if (
      state.currentView !== 'ai' ||
      block.schema.lock ||
      !hasComponentListItems(block)
    ) {
      return '';
    }
    return `<div class="ghost-section-card add-ghost component-list-add-ghost" data-action="add-component-list-item" data-section-key="${deps.escapeAttr(
      section.key
    )}" data-block-id="${deps.escapeAttr(block.id)}">
      <div class="ghost-plus-small">${plusIcon()}</div>
      <div class="ghost-label">${deps.escapeHtml(getComponentListAddLabel(block))}</div>
    </div>`;
  }

  function shouldRenderAiPassiveEditorAffordance(base: string, block: VisualBlock): boolean {
    if (base === 'text') {
      return block.text.trim().length === 0;
    }
    if (base === 'component-list') {
      if (!Array.isArray(block.schema.componentListBlocks)) {
        block.schema.componentListBlocks = [];
      }
      return !hasComponentListItems(block);
    }
    return false;
  }

  function renderReaderBlocks(section: VisualSection, blocks: VisualBlock[]): string {
    return orderReaderBlocks(blocks)
      .filter((block) => !isAnchoredReaderButton(section, block))
      .map((block) => renderReaderBlock(section, block))
      .join('');
  }

  function renderReaderListBlocks(section: VisualSection, blocks: VisualBlock[]): string {
    return orderReaderListBlocks(blocks).map((block) => renderReaderBlock(section, block)).join('');
  }

  function orderReaderSections(sections: VisualSection[]): VisualSection[] {
    const viewContext = getActiveReaderViewContext();
    const ordered = orderReaderViewTargets(
      sections,
      viewContext,
      getSectionReaderViewTargetKey,
      state.readerViewActivatedTargets
    );
    return orderSearchFilteredSections(ordered, getActiveSearchFilterContext(), {
      isPriority: (section) => isSectionReaderPriority(section, viewContext, getSectionReaderViewTargetKey(section)),
    });
  }

  function isSectionReaderPriority(section: VisualSection, viewContext: ReaderViewContext, targetKey: ReaderViewTargetKey): boolean {
    return section.priority === true || isReaderViewPrioritized(viewContext, targetKey);
  }

  function orderReaderBlocks(blocks: VisualBlock[]): VisualBlock[] {
    return orderReaderViewTargets(
      blocks,
      getActiveReaderViewContext(),
      getBlockReaderViewTargetKey,
      state.readerViewActivatedTargets,
      { prioritize: false }
    ).filter((block) => isBlockSearchVisible(getActiveSearchFilterContext(), block));
  }

  function orderReaderListBlocks(blocks: VisualBlock[]): VisualBlock[] {
    return orderReaderViewTargets(
      blocks,
      getActiveReaderViewContext(),
      getBlockReaderViewTargetKey,
      state.readerViewActivatedTargets,
      { prioritize: true }
    ).filter((block) =>
      isBlockSearchVisible(getActiveSearchFilterContext(), block)
    );
  }

  function isViewerHiddenSection(section: VisualSection): boolean {
    if (state.currentView === 'viewer') {
      return section.editorOnly || isSectionHiddenByTemplateMarker(section);
    }
    return state.currentView === 'ai'
      && !state.showAdvancedEditor
      && section.editorOnly
      && sectionContainsAdvancedOnlyScriptingBlock(section);
  }

  function isAdvancedOnlyScriptingBlock(block: VisualBlock): boolean {
    return block.schema.editorOnly
      && deps.resolveBaseComponent(block.schema.component) === 'plugin'
      && block.schema.plugin === SCRIPTING_PLUGIN_ID;
  }

  function sectionContainsAdvancedOnlyScriptingBlock(section: VisualSection): boolean {
    return section.blocks.some(blockContainsAdvancedOnlyScriptingBlock)
      || section.children.some(sectionContainsAdvancedOnlyScriptingBlock);
  }

  function blockContainsAdvancedOnlyScriptingBlock(block: VisualBlock): boolean {
    return isAdvancedOnlyScriptingBlock(block)
      || (block.schema.containerBlocks ?? []).some(blockContainsAdvancedOnlyScriptingBlock)
      || (block.schema.componentListBlocks ?? []).some(blockContainsAdvancedOnlyScriptingBlock)
      || (block.schema.gridItems ?? []).some((item) => blockContainsAdvancedOnlyScriptingBlock(item.block))
      || (block.schema.expandableStubBlocks?.children ?? []).some(blockContainsAdvancedOnlyScriptingBlock)
      || (block.schema.expandableContentBlocks?.children ?? []).some(blockContainsAdvancedOnlyScriptingBlock);
  }

  function isViewerHiddenBlock(block: VisualBlock): boolean {
    if (state.currentView === 'viewer' && block.schema.editorOnly) {
      return true;
    }
    return state.currentView === 'ai' && !state.showAdvancedEditor && isAdvancedOnlyScriptingBlock(block);
  }

  function isAnchoredReaderButton(section: VisualSection | null, block: VisualBlock): boolean {
    if (!section || state.currentView !== 'ai' || deps.resolveBaseComponent(block.schema.component) !== 'button') {
      return false;
    }
    const targetId = block.schema.buttonPositionTargetId.trim();
    return !!targetId && section.blocks.some((candidate) => candidate !== block && candidate.schema.id.trim() === targetId);
  }

  function getReaderButtonAnchor(section: VisualSection, block: VisualBlock): { className: string; attrs: string; overlay: string } {
    if (state.currentView !== 'ai') {
      return { className: '', attrs: '', overlay: '' };
    }
    const componentId = block.schema.id.trim();
    const buttons = componentId
      ? section.blocks.filter((candidate) =>
          deps.resolveBaseComponent(candidate.schema.component) === 'button'
          && candidate.schema.buttonPositionTargetId.trim() === componentId
        )
      : [];
    if (buttons.length === 0) {
      return { className: '', attrs: '', overlay: '' };
    }
    const helpers = deps.getComponentRenderHelpers();
    return {
      className: ' hvy-button-position-anchor',
      attrs: ' data-hvy-button-anchor="true"',
      overlay: `<div class="hvy-button-overlay-layer">${buttons.map((button) => renderButtonReader(section, button, helpers)).join('')}</div>`,
    };
  }

  function isReaderViewPrioritizedBlock(block: VisualBlock): boolean {
    return isReaderViewPrioritized(getActiveReaderViewContext(), getBlockReaderViewTargetKey(block));
  }

  function renderReaderViewTargetAttrs(targetKey: ReaderViewTargetKey, dimmed: boolean): string {
    return ` data-reader-view-target="${deps.escapeAttr(targetKey)}"${dimmed ? ' data-reader-view-dimmed="true"' : ''}`;
  }

  function renderReaderViewCollapseWrapper(targetKey: ReaderViewTargetKey, block: VisualBlock, body: string): string {
    const key = `reader-view-collapse:${targetKey}`;
    const expanded = state.readerContainerState[key] ?? false;
    const className = `reader-container reader-view-collapse-wrapper is-collapsible ${expanded ? 'is-expanded' : 'is-collapsed-preview'}`;
    const title = block.schema.id.trim() || block.schema.xrefTitle.trim() || block.schema.containerTitle.trim() || block.schema.component;
    const attrs = `data-reader-action="toggle-view-collapse" data-reader-view-target="${deps.escapeAttr(targetKey)}" data-reader-view-collapse-key="${deps.escapeAttr(key)}" aria-expanded="${expanded ? 'true' : 'false'}"`;
    return `<div class="${deps.escapeAttr(className)}" style="--hvy-container-preview-rem: 5rem;">
      <header class="reader-container-head">
        <div class="reader-container-title">${deps.escapeHtml(title)}</div>
        <div class="reader-container-actions">
          <button type="button" class="tiny toggle-expand-button reader-container-toggle" ${attrs} aria-label="${expanded ? 'Collapse component' : 'Expand component'}">${expanded ? '-' : '+'}</button>
        </div>
      </header>
      <div class="reader-container-body" ${expanded ? '' : attrs}>${body}</div>
    </div>`;
  }

  function getBlockDomId(block: VisualBlock): string {
    return block.schema.id.trim();
  }

  function getReaderExpandableExpanded(sectionKey: string, block: VisualBlock, fallback = block.schema.expandableExpanded): boolean {
    const key = `${sectionKey}:${block.id}`;
    return state.readerExpandableState[key] ?? fallback;
  }

  function renderThemeEditor(options: { advanced?: boolean; includePalettePicker?: boolean; includeModalActions?: boolean } = {}): string {
    const includePalettePicker = options.includePalettePicker ?? true;
    const includeModalActions = options.includeModalActions ?? true;
    const theme = state.theme;
    const overrideNames = new Set(Object.keys(theme.colors));
    const helpers = deps.getComponentRenderHelpers();
    const previewSection: VisualSection = {
      key: 'theme-preview-section',
      customId: '',
      contained: true,
      editorOnly: false,
      lock: true,
      idEditorOpen: false,
      isGhost: false,
      title: 'Theme Preview',
      level: 1,
      expanded: true,
      highlight: false,
      css: '',
      tags: '',
      description: '',
      location: 'main',
      blocks: [],
      children: [],
    };
    const makePreviewBlock = (id: string, component: string, text: string, schema: Partial<BlockSchema> = {}): VisualBlock => ({
      id,
      text,
      schema: {
        ...defaultBlockSchema(component),
        id,
        ...schema,
      },
      schemaMode: false,
    });
    const previewTextBlock = makePreviewBlock('theme-preview-text', 'text', 'Paragraph with *alternate text* and a fill-in.');
    const previewButtonBlock = makePreviewBlock('theme-preview-button', 'button', '', { buttonLabel: 'Generate' });
    const previewFillInBlock = makePreviewBlock('theme-preview-fill-in', 'text', 'The answer is [____].', { fillIn: true });
    const previewXrefTarget = state.documentSections[0] ? `#${deps.getSectionId(state.documentSections[0])}` : '#';
    const previewXrefBlock = makePreviewBlock('theme-preview-xref', 'xref-card', '', {
      xrefTitle: 'TypeScript',
      xrefDetail: 'Primary language',
      xrefTarget: previewXrefTarget,
    });
    const previewInvalidXrefBlock = makePreviewBlock('theme-preview-xref-invalid', 'xref-card', '', {
      xrefTitle: 'Missing target',
      xrefDetail: 'Invalid reference',
      xrefTarget: '#missing-theme-preview-target',
    });
    const previewTableBlock = makePreviewBlock('theme-preview-table', 'table', '', {
      tableColumns: ['Name', 'Role'],
      tableShowHeader: true,
      tableRows: [{ cells: ['Ada', 'Engineer'] }, { cells: ['Grace', 'Compiler'] }],
    });
    const previewCodeBlock = makePreviewBlock('theme-preview-code', 'code', 'const value = "HVY";', { codeLanguage: 'ts' });
    const previewContainerBlock = makePreviewBlock('theme-preview-container', 'container', '', {
      css: 'margin: 0.5rem 0; border: 1px solid var(--hvy-border);',
      containerTitle: 'Container',
      containerExpanded: false,
      containerCollapsedPreviewRem: 3,
      containerBlocks: [previewTextBlock],
    });
    const previewComponentListBlock = makePreviewBlock('theme-preview-component-list', 'component-list', '', {
      componentListComponent: 'text',
      componentListBlocks: [
        makePreviewBlock('theme-preview-list-one', 'text', 'First grouped item', { sortKeys: { order: 1 }, groupKeys: { type: 'Examples' } }),
        makePreviewBlock('theme-preview-list-two', 'text', 'Second grouped item', { sortKeys: { order: 2 }, groupKeys: { type: 'Examples' } }),
      ],
      componentListDefaultSortKey: 'order',
      componentListDefaultGroupKey: 'type',
      componentListGroupCollapsedPreviewRem: 5,
    });
    const addPreviewAttrs = (html: string, attrs: Record<string, string>): string => {
      const extraClass = attrs.class;
      const restAttrs = Object.entries(attrs)
        .filter(([name]) => name !== 'class')
        .map(([name, value]) => `${name}="${deps.escapeAttr(value)}"`)
        .join(' ');
      return html.replace(/<([a-z][\w:-]*)([^>]*)>/i, (_match, tagName: string, rawAttrs: string) => {
        const attrsWithClass = extraClass
          ? /\sclass="/i.test(rawAttrs)
            ? rawAttrs.replace(/\sclass="([^"]*)"/i, (_classMatch, classValue: string) => ` class="${deps.escapeAttr(`${classValue} ${extraClass}`.trim())}"`)
            : ` class="${deps.escapeAttr(extraClass)}"${rawAttrs}`
          : rawAttrs;
        const joiner = restAttrs ? ' ' : '';
        return `<${tagName}${attrsWithClass}${joiner}${restAttrs}>`;
      });
    };
    const renderDemoSurface = (html: string, stateName: string, filter: string, className = '') => addPreviewAttrs(html, {
      class: `theme-demo-target ${className}`.trim(),
      'data-theme-demo-state': stateName,
      'data-action': 'theme-filter-to-colors',
      'data-theme-filter': filter,
    });
    const renderDemoWrapper = (html: string, stateName: string, filter: string, className = '') => `
      <div
        class="theme-demo-target ${deps.escapeAttr(className)}"
        data-theme-demo-state="${deps.escapeAttr(stateName)}"
        data-action="theme-filter-to-colors"
        data-theme-filter="${deps.escapeAttr(filter)}"
      >${html}</div>`;
    const containerPreview = renderDemoSurface(
      renderContainerReader(previewSection, previewContainerBlock, helpers),
      'collapsed',
      '--hvy-surface --hvy-surface-alt --hvy-text-alt'
    );
    const componentListPreview = renderDemoWrapper(
      renderComponentListReader(previewSection, previewComponentListBlock, helpers),
      'controls',
      '--hvy-surface-alt --hvy-border-input --hvy-shadow --hvy-text-muted',
      'theme-demo-component-list'
    );
    const componentListHoverPreview = componentListPreview
      .replace('data-theme-demo-state="controls"', 'data-theme-demo-state="hover"')
      .replace('--hvy-surface-alt --hvy-border-input --hvy-shadow --hvy-text-muted', '--hvy-xref-card-hover-bg --hvy-border-alt --hvy-text');
    const ghostInputPreview = renderDemoWrapper(
      '<div class="theme-demo-ghost-input">Add component</div>',
      'ghost',
      '--hvy-surface-alt --hvy-ghost-border --hvy-text-muted',
      'theme-demo-ghost-input-wrap'
    );
    const textPreview = renderDemoSurface(
      renderTextReader(previewSection, previewTextBlock, helpers),
      'rest',
      '--hvy-text --hvy-text-alt --hvy-text-muted',
      'theme-demo-rich-text'
    );
    const buttonRestPreview = renderDemoWrapper(
      renderButtonReader(previewSection, previewButtonBlock, helpers),
      'rest',
      '--hvy-button-bg --hvy-button-text --hvy-border-alt',
      'theme-demo-button-stack'
    );
    const buttonHoverPreview = renderDemoWrapper(
      renderButtonReader(previewSection, previewButtonBlock, helpers),
      'hover',
      '--hvy-button-hover-bg --hvy-button-hover-text --hvy-focus --hvy-shadow-md',
      'theme-demo-button-stack'
    );
    const fillInPreview = renderDemoSurface(
      renderTextReader(previewSection, previewFillInBlock, helpers),
      'fill-in',
      '--hvy-text --hvy-text-muted --hvy-focus-ring'
    );
    const xrefPreview = renderDemoSurface(
      renderXrefCardReader(previewSection, previewXrefBlock, helpers),
      'rest',
      '--hvy-xref-card-bg --hvy-border --hvy-text --hvy-text-alt --hvy-shadow'
    );
    const xrefHoverPreview = renderDemoSurface(
      renderXrefCardReader(previewSection, previewXrefBlock, helpers),
      'hover',
      '--hvy-xref-card-hover-bg --hvy-focus --hvy-shadow-md'
    );
    const xrefInvalidPreview = renderDemoSurface(
      renderXrefCardReader(previewSection, previewInvalidXrefBlock, helpers),
      'invalid',
      '--hvy-xref-card-bg --hvy-border-alt --hvy-text-muted'
    );
    resetReaderTableStripeSequence();
    const tablePreview = renderDemoSurface(
      renderTableReader(previewSection, previewTableBlock, helpers),
      'header',
      '--hvy-table-header --hvy-table-row-bg-1 --hvy-table-row-bg-2 --hvy-border-input --hvy-text'
    );
    const tableRowOnePreview = tablePreview.replace('data-theme-demo-state="header"', 'data-theme-demo-state="row-1"');
    const tableRowTwoPreview = tablePreview.replace('data-theme-demo-state="header"', 'data-theme-demo-state="row-2"');
    const codePreview = renderDemoSurface(
      renderCodeReader(previewSection, previewCodeBlock, helpers),
      'block',
      '--hvy-code-bg --hvy-code-text --hvy-code-muted --hvy-code-string --hvy-code-builtin --hvy-code-keyword --hvy-code-function --hvy-code-number --hvy-border-input'
    );
    const codeSyntaxPreview = codePreview.replace('data-theme-demo-state="block"', 'data-theme-demo-state="syntax"');
    const previewItems: Array<{
      id: string;
      label: string;
      detail: string;
      className: string;
      variables: string[];
      states: Array<{ id: string; label: string; variables: string[] }>;
      html: string;
    }> = [
      {
        id: 'container',
        label: 'Container',
        detail: 'Reader container shell, title, collapsed preview',
        className: 'theme-preview-container-card',
        variables: ['--hvy-surface', '--hvy-surface-alt', '--hvy-surface-tint', '--hvy-border', '--hvy-text', '--hvy-text-alt', '--hvy-focus-ring', '--hvy-focus-glow'],
        states: [
          { id: 'collapsed', label: 'Collapsed', variables: ['--hvy-surface', '--hvy-surface-alt', '--hvy-text-alt'] },
          { id: 'target', label: 'Target', variables: ['--hvy-surface', '--hvy-surface-tint', '--hvy-focus-ring', '--hvy-focus-glow'] },
        ],
        html: containerPreview,
      },
      {
        id: 'component-list',
        label: 'Component List',
        detail: 'Reader controls, hover state, and editor ghost input',
        className: 'theme-preview-component-list-card',
        variables: ['--hvy-surface', '--hvy-surface-alt', '--hvy-border-input', '--hvy-border-alt', '--hvy-ghost-border', '--hvy-text', '--hvy-text-muted', '--hvy-xref-card-hover-bg', '--hvy-shadow'],
        states: [
          { id: 'controls', label: 'Controls', variables: ['--hvy-surface-alt', '--hvy-border-input', '--hvy-shadow', '--hvy-text-muted'] },
          { id: 'hover', label: 'Hover', variables: ['--hvy-xref-card-hover-bg', '--hvy-border-alt', '--hvy-text'] },
          { id: 'ghost', label: 'Ghost', variables: ['--hvy-surface-alt', '--hvy-ghost-border', '--hvy-text-muted'] },
        ],
        html: `${componentListPreview}${componentListHoverPreview}${ghostInputPreview}`,
      },
      {
        id: 'button',
        label: 'Button',
        detail: 'Primary button rest and hover states',
        className: 'theme-preview-button-card',
        variables: ['--hvy-button-bg', '--hvy-button-text', '--hvy-button-hover-bg', '--hvy-button-hover-text', '--hvy-border-alt', '--hvy-focus', '--hvy-shadow-md'],
        states: [
          { id: 'rest', label: 'Rest', variables: ['--hvy-button-bg', '--hvy-button-text', '--hvy-border-alt'] },
          { id: 'hover', label: 'Hover', variables: ['--hvy-button-hover-bg', '--hvy-button-hover-text', '--hvy-focus', '--hvy-shadow-md'] },
        ],
        html: `${buttonRestPreview}${buttonHoverPreview}`,
      },
      {
        id: 'text',
        label: 'Text',
        detail: 'Rich text, fill-ins, quotes, and AI target state',
        className: 'theme-preview-text-card',
        variables: ['--hvy-text', '--hvy-text-alt', '--hvy-text-muted', '--hvy-surface', '--hvy-surface-alt', '--hvy-surface-tint', '--hvy-border-alt', '--hvy-focus-ring', '--hvy-focus-glow'],
        states: [
          { id: 'rest', label: 'Rest', variables: ['--hvy-text', '--hvy-text-alt', '--hvy-text-muted'] },
          { id: 'fill-in', label: 'Fill-in', variables: ['--hvy-text', '--hvy-text-muted', '--hvy-focus-ring'] },
          { id: 'target', label: 'Target', variables: ['--hvy-surface', '--hvy-surface-tint', '--hvy-focus-ring', '--hvy-focus-glow'] },
        ],
        html: `<div class="theme-demo-text">
          ${textPreview}
          ${fillInPreview}
          <button type="button" class="theme-demo-target theme-demo-ai-target" data-theme-demo-state="target" data-action="theme-filter-to-colors" data-theme-filter="--hvy-surface --hvy-surface-tint --hvy-focus-ring --hvy-focus-glow" title="Filter to highlighted text target colors">AI target</button>
        </div>`,
      },
      {
        id: 'xref',
        label: 'Xref Card',
        detail: 'Reference card rest, invalid, and hover colors',
        className: 'theme-preview-xref-card',
        variables: ['--hvy-xref-card-bg', '--hvy-xref-card-hover-bg', '--hvy-border', '--hvy-border-alt', '--hvy-focus', '--hvy-text', '--hvy-text-alt', '--hvy-text-muted', '--hvy-shadow', '--hvy-shadow-md'],
        states: [
          { id: 'rest', label: 'Rest', variables: ['--hvy-xref-card-bg', '--hvy-border', '--hvy-text', '--hvy-text-alt', '--hvy-shadow'] },
          { id: 'hover', label: 'Hover', variables: ['--hvy-xref-card-hover-bg', '--hvy-focus', '--hvy-shadow-md'] },
          { id: 'invalid', label: 'Invalid', variables: ['--hvy-xref-card-bg', '--hvy-border-alt', '--hvy-text-muted'] },
        ],
        html: `<div class="theme-demo-xref-stack">${xrefPreview}${xrefHoverPreview}${xrefInvalidPreview}</div>`,
      },
      {
        id: 'highlights',
        label: 'Highlights',
        detail: 'Search result and xref jump states',
        className: 'theme-preview-highlight-card',
        variables: ['--hvy-highlight-1', '--hvy-highlight-2', '--hvy-button-bg', '--hvy-surface'],
        states: [
          { id: 'search', label: 'Search', variables: ['--hvy-highlight-1'] },
          { id: 'active', label: 'Active', variables: ['--hvy-highlight-2'] },
          { id: 'jump', label: 'Xref Jump', variables: ['--hvy-button-bg', '--hvy-surface'] },
        ],
        html: `<div class="theme-demo-highlight">
          <button type="button" class="theme-demo-target" data-theme-demo-state="search" data-action="theme-filter-to-colors" data-theme-filter="--hvy-highlight-1" title="Filter to inline highlight colors">Filtered match</button>
          <button type="button" class="theme-demo-target theme-demo-highlight-active" data-theme-demo-state="active" data-action="theme-filter-to-colors" data-theme-filter="--hvy-highlight-2" title="Filter to active search result colors">active result</button>
          <button type="button" class="theme-demo-target theme-demo-highlight-jump" data-theme-demo-state="jump" data-action="theme-filter-to-colors" data-theme-filter="--hvy-button-bg --hvy-surface" title="Filter to xref jump flash colors">xref jump</button>
        </div>`,
      },
      {
        id: 'table',
        label: 'Table',
        detail: 'Header and alternating rows',
        className: 'theme-preview-table-card',
        variables: ['--hvy-table-header', '--hvy-table-row-bg-1', '--hvy-table-row-bg-2', '--hvy-border-input', '--hvy-text'],
        states: [
          { id: 'header', label: 'Header', variables: ['--hvy-table-header', '--hvy-text', '--hvy-border-input'] },
          { id: 'row-1', label: 'Row 1', variables: ['--hvy-table-row-bg-1', '--hvy-text', '--hvy-border-input'] },
          { id: 'row-2', label: 'Row 2', variables: ['--hvy-table-row-bg-2', '--hvy-text', '--hvy-border-input'] },
        ],
        html: `<div class="theme-demo-table-stack">${tablePreview}${tableRowOnePreview}${tableRowTwoPreview}</div>`,
      },
      {
        id: 'diagnostics',
        label: 'Diagnostics',
        detail: 'Reader warnings and raw editor errors',
        className: 'theme-preview-diagnostics-card',
        variables: ['--hvy-warning-bg', '--hvy-warning-border', '--hvy-warning-text', '--hvy-danger', '--hvy-surface', '--hvy-border', '--hvy-text-alt'],
        states: [
          { id: 'warning', label: 'Warning', variables: ['--hvy-warning-bg', '--hvy-warning-border', '--hvy-warning-text'] },
          { id: 'error', label: 'Error', variables: ['--hvy-danger', '--hvy-surface', '--hvy-border'] },
        ],
        html: `<div class="theme-demo-diagnostics">
          <button type="button" class="theme-demo-target theme-demo-warning" data-theme-demo-state="warning" data-action="theme-filter-to-colors" data-theme-filter="--hvy-warning-bg --hvy-warning-border --hvy-warning-text" title="Filter to reader warning colors">Warning</button>
          <button type="button" class="theme-demo-target theme-demo-error" data-theme-demo-state="error" data-action="theme-filter-to-colors" data-theme-filter="--hvy-danger --hvy-surface --hvy-border" title="Filter to raw editor error colors">Error</button>
        </div>`,
      },
      {
        id: 'code',
        label: 'Code',
        detail: 'Text code block and syntax colors',
        className: 'theme-preview-code-card',
        variables: ['--hvy-code-bg', '--hvy-code-text', '--hvy-code-muted', '--hvy-code-string', '--hvy-code-builtin', '--hvy-code-keyword', '--hvy-code-function', '--hvy-code-number'],
        states: [
          { id: 'block', label: 'Block', variables: ['--hvy-code-bg', '--hvy-code-text', '--hvy-code-muted', '--hvy-border-input'] },
          { id: 'syntax', label: 'Syntax', variables: ['--hvy-code-string', '--hvy-code-builtin', '--hvy-code-keyword', '--hvy-code-function', '--hvy-code-number'] },
        ],
        html: `${codePreview}${codeSyntaxPreview}`,
      },
    ];
    const previewPicker = previewItems.map((item, index) => `<button
      type="button"
      class="theme-component-picker-button${index === 0 ? ' is-active' : ''}"
      data-action="theme-preview-select-component"
      data-theme-component="${deps.escapeAttr(item.id)}"
    >${deps.escapeHtml(item.label)}</button>`).join('');
    const previewCards = previewItems.map((item, index) => {
      const filter = item.variables.join(' ');
      const stateButtons = item.states.map((previewState, stateIndex) => `<button
        type="button"
        class="theme-preview-state-button${stateIndex === 0 ? ' is-active' : ''}"
        data-action="theme-preview-set-state"
        data-theme-state="${deps.escapeAttr(previewState.id)}"
        data-theme-filter="${deps.escapeAttr(previewState.variables.join(' '))}"
      >${deps.escapeHtml(previewState.label)}</button>`).join('');
      return `<article
        class="theme-preview-card ${deps.escapeAttr(item.className)}${index === 0 ? ' is-active' : ''}"
        data-theme-preview-component="${deps.escapeAttr(item.id)}"
        data-theme-preview-state="${deps.escapeAttr(item.states[0]?.id ?? 'rest')}"
      >
        <span class="theme-preview-card-copy">
          <strong>${deps.escapeHtml(item.label)}</strong>
          <span>${deps.escapeHtml(item.detail)}</span>
        </span>
        <span class="theme-preview-state-row">${stateButtons}</span>
        ${item.html}
        <button
          type="button"
          class="theme-preview-all"
          data-action="theme-filter-to-colors"
          data-theme-filter="${deps.escapeAttr(filter)}"
          title="${deps.escapeAttr(`Filter to all ${item.label} colors`)}"
        >All ${deps.escapeHtml(item.label)} colors</button>
      </article>`;
    }).join('');
    const matchedPaletteId = state.paletteOverrideId ?? getMatchedPaletteId(theme.colors);
    const documentThemeSelected = state.paletteOverrideId === null;
    const documentPaletteCard = `
        <article class="theme-palette-card${documentThemeSelected ? ' is-selected' : ''}">
          <div class="theme-palette-preview theme-palette-preview-document" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
          </div>
          <div class="theme-palette-copy">
            <strong>Document Theme</strong>
            <span>Use the theme stored in the current HVY file.</span>
          </div>
          <button
            type="button"
            class="${documentThemeSelected ? 'secondary' : 'ghost'}"
            data-action="theme-clear-palette-override"
            aria-pressed="${documentThemeSelected ? 'true' : 'false'}"
          >${documentThemeSelected ? 'Applied' : 'Apply'}</button>
        </article>
      `;
    const paletteCards = HVY_PALETTES.map((palette) => {
      const isSelected = matchedPaletteId === palette.id;
      const previewStyle = [
        `--palette-preview-bg: ${palette.colors['--hvy-bg'] ?? 'transparent'}`,
        `--palette-preview-bg-alt: ${palette.colors['--hvy-bg-alt'] ?? palette.colors['--hvy-bg'] ?? 'transparent'}`,
        `--palette-preview-surface: ${palette.colors['--hvy-surface'] ?? 'transparent'}`,
        `--palette-preview-text: ${palette.colors['--hvy-text'] ?? 'currentColor'}`,
        `--palette-preview-accent: ${palette.colors['--hvy-accent-1'] ?? 'currentColor'}`,
        `--palette-preview-accent-2: ${palette.colors['--hvy-accent-2'] ?? 'currentColor'}`,
      ].join('; ');
      return `
        <article class="theme-palette-card${isSelected ? ' is-selected' : ''}" style="${deps.escapeAttr(previewStyle)}">
          <div class="theme-palette-preview" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
          </div>
          <div class="theme-palette-copy">
            <strong>${deps.escapeHtml(palette.name)}</strong>
            <span>${deps.escapeHtml(palette.description)}</span>
          </div>
          <button
            type="button"
            class="${isSelected ? 'secondary' : 'ghost'}"
            data-action="theme-apply-palette"
            data-palette-id="${deps.escapeAttr(palette.id)}"
            aria-pressed="${isSelected ? 'true' : 'false'}"
          >${isSelected ? 'Applied' : 'Apply'}</button>
        </article>
      `;
    }).join('');
    const rows = THEME_COLOR_NAMES.map((name) => {
      const isOverridden = overrideNames.has(name);
      const value = isOverridden ? theme.colors[name] : getResolvedThemeColor(name);
      const resetValue = isOverridden ? getThemeResetColor(name) : '';
      const pickerValue = colorValueToPickerHex(value);
      const alphaValue = colorValueToAlpha(value);
      return `
        <div class="theme-color-row${isOverridden ? ' theme-color-row--override' : ''}" data-theme-color-name="${deps.escapeAttr(name)}" data-theme-search="${deps.escapeAttr(`${name} ${getThemeColorLabel(name)} ${value}`)}">
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
          <label class="theme-alpha-control" title="Alpha">
            <span>A</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              data-field="theme-color-alpha"
              data-color-name="${deps.escapeAttr(name)}"
              value="${deps.escapeAttr(String(alphaValue))}"
              aria-label="${deps.escapeAttr(getThemeColorLabel(name))} alpha"
            />
            <output>${deps.escapeHtml(String(Math.round(alphaValue * 100)))}</output>
          </label>
          ${isOverridden
            ? `<span class="theme-color-reset-group">
                <button type="button" class="ghost theme-color-action" data-action="theme-reset-color" data-color-name="${deps.escapeAttr(name)}" title="Reset to default">Reset</button>
                <span class="theme-color-reset-swatch" style="${resetValue ? `background: ${deps.escapeAttr(resetValue)};` : ''}" title="${deps.escapeAttr(`Reset value: ${resetValue}`)}" aria-hidden="true"></span>
              </span>`
            : '<span class="theme-color-action theme-color-default muted">default</span>'}
        </div>
      `;
    }).join('');
    const customNames = Object.keys(theme.colors).filter((name) => !(THEME_COLOR_NAMES as readonly string[]).includes(name));
    const customRows = customNames.map((name) => {
      const value = theme.colors[name] ?? '';
      return `
        <div class="theme-color-row theme-color-row--override" data-theme-color-name="${deps.escapeAttr(name)}" data-theme-search="${deps.escapeAttr(`${name} ${getThemeColorLabel(name)} ${value} custom`)}">
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
        <section class="theme-modal${options.advanced ? ' theme-modal--advanced' : ''}">
          <div class="modal-head">
            <h3>Theme Colors</h3>
            ${includeModalActions ? '<button type="button" class="hvy-button" data-modal-action="close">Close</button>' : ''}
          </div>
          <p class="muted">
            Adjust the document theme with a color picker or by typing any valid CSS color value.
            Overrides are saved with the document.
          </p>
          ${includePalettePicker
            ? `<div class="theme-palette-grid" aria-label="Theme palettes">
                ${documentPaletteCard}
                ${paletteCards}
              </div>`
            : ''}
          <div class="theme-component-preview-picker" aria-label="Theme component preview picker">
            ${previewPicker}
          </div>
          <div class="theme-preview-grid" aria-label="Theme component preview">
            ${previewCards}
          </div>
          <label class="theme-filter-shell">
            <span>Filter Colors</span>
            <input
              type="search"
              data-field="theme-color-filter"
              placeholder="Type a token, role, component, or click a preview..."
              autocomplete="off"
              spellcheck="false"
            />
          </label>
          <div class="theme-color-list">
            ${rows}
          </div>
          <div class="theme-filter-empty muted" hidden>No matching theme colors.</div>
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
            ${includeModalActions ? '<button type="button" class="secondary" data-modal-action="close">Done</button>' : ''}
          </div>
        </section>
    `;
  }

  function renderThemeModal(): string {
    return `
      <div id="modalRoot" class="modal-root">
        <div class="modal-overlay" data-modal-action="close-overlay"></div>
        <section class="modal-panel">
          ${renderThemeEditor({
            advanced: state.themeModalMode === 'advanced',
            includePalettePicker: true,
            includeModalActions: true,
          })}
        </section>
      </div>
    `;
  }

  function hasPdfTemplateImportTokenUsage(usage: import('../types').ChatTokenUsage): boolean {
    return Object.values(usage).some((value) => typeof value === 'number');
  }

  function formatPdfTemplateImportTokenUsage(usage: import('../types').ChatTokenUsage): string {
    return [
      typeof usage.inputTokens === 'number' ? `input ${usage.inputTokens}` : '',
      typeof usage.outputTokens === 'number' ? `output ${usage.outputTokens}` : '',
      typeof usage.totalTokens === 'number' ? `total ${usage.totalTokens}` : '',
      typeof usage.cachedTokens === 'number' ? `cached ${usage.cachedTokens}` : '',
      typeof usage.reasoningTokens === 'number' ? `reasoning ${usage.reasoningTokens}` : '',
    ].filter(Boolean).join(' / ');
  }

  function formatPdfTemplateImportStepStatus(status: import('../types').PdfTemplateImportStepState['status']): string {
    if (status === 'complete') return 'Done';
    if (status === 'running') return 'Running';
    if (status === 'error') return 'Error';
    return 'Pending';
  }

  function renderPdfTemplateImportRequestLog(entries: import('../types').PdfTemplateImportRequestLogEntry[]): string {
    if (entries.length === 0) {
      return '';
    }
    return `<details class="pdf-template-import-log">
      <summary>LLM request log (${entries.length})</summary>
      <div class="pdf-template-import-log-list">
        ${entries.map((entry) => `
          <details class="pdf-template-import-log-entry">
            <summary>${deps.escapeHtml(`${entry.callIndex}. ${entry.debugLabel}`)}</summary>
            <pre>${deps.escapeHtml(JSON.stringify(entry.request, null, 2))}</pre>
          </details>
        `).join('')}
      </div>
    </details>`;
  }

  function renderModal(): string {
    if (state.themeModalOpen) {
      return renderThemeModal();
    }
    if (state.pdfTemplateImportModal) {
      const modal = state.pdfTemplateImportModal;
      return `
        <div id="modalRoot" class="modal-root">
          <div class="modal-overlay" data-modal-action="${modal.isRunning ? '' : 'close-overlay'}"></div>
          <section class="modal-panel component-meta-modal pdf-template-import-modal">
            <div class="modal-head">
              <h3>Export PDF From PHVY</h3>
              ${modal.isRunning ? '' : `<button type="button" class="ghost remove-x" data-modal-action="close" aria-label="Close PDF export" title="Close">${closeIcon()}</button>`}
            </div>
            <p class="muted">Choose a PHVY template. The current document will be imported into it before the PDF is rendered.</p>
            ${modal.error ? `<div class="raw-editor-error" role="alert">${deps.escapeHtml(modal.error)}</div>` : ''}
            ${modal.status ? `<p class="pdf-template-import-status">${deps.escapeHtml(modal.status)}</p>` : ''}
            ${ENABLE_PDF_TEMPLATE_IMPORT_STEPPER
              ? `<ol class="pdf-template-import-stepper">
                  ${modal.steps.map((step) => `
                    <li class="pdf-template-import-step is-${deps.escapeAttr(step.status)}">
                      <span class="pdf-template-import-step-state">${deps.escapeHtml(formatPdfTemplateImportStepStatus(step.status))}</span>
                      <span class="pdf-template-import-step-label">${deps.escapeHtml(step.label)}</span>
                      ${hasPdfTemplateImportTokenUsage(step.tokenUsage) ? `<span class="pdf-template-import-step-tokens">${deps.escapeHtml(formatPdfTemplateImportTokenUsage(step.tokenUsage))}</span>` : ''}
                    </li>
                  `).join('')}
                </ol>`
              : ''}
            ${hasPdfTemplateImportTokenUsage(modal.totalTokenUsage)
              ? `<p class="pdf-template-import-token-total">${deps.escapeHtml(`Total ${formatPdfTemplateImportTokenUsage(modal.totalTokenUsage)}`)}</p>`
              : ''}
            ${ENABLE_PDF_TEMPLATE_IMPORT_STEPPER && modal.awaitingLlmStep
              ? `<div class="pdf-template-import-next-step">
                  <button type="button" class="secondary" data-modal-action="pdf-template-import-next-llm">Run Next LLM Step</button>
                </div>`
              : ''}
            ${renderPdfTemplateImportRequestLog(modal.requestLog)}
            <label class="pdf-template-import-picker">
              <span>PHVY Template</span>
              <input id="pdfTemplateFileInput" type="file" accept=".phvy,text/phvy" ${modal.isRunning ? 'disabled' : ''} />
            </label>
            <div class="link-inline-actions reusable-save-actions">
              <button type="button" class="ghost" data-modal-action="close" ${modal.isRunning ? 'disabled' : ''}>Cancel</button>
              <button type="button" class="secondary" data-modal-action="pdf-template-import-export" ${modal.isRunning ? 'disabled' : ''}>Import & Export</button>
            </div>
          </section>
        </div>
      `;
    }
    if (state.reusableSaveModal) {
      const existingName = state.reusableSaveModal.existingName;
      const title = existingName
        ? state.reusableSaveModal.kind === 'component' ? 'Update Component Template' : 'Update Section Template'
        : state.reusableSaveModal.kind === 'section'
          ? 'Save As Section Template'
          : 'Save As Component Template';
      const help =
        existingName
          ? state.reusableSaveModal.kind === 'component'
            ? `This component already uses "${deps.escapeHtml(existingName)}". Update that component template, save this component as a new template, or add it as a flavor.`
            : `This section already uses "${deps.escapeHtml(existingName)}". Update that section template, save this section as a new template, or add it as a flavor.`
          : state.reusableSaveModal.kind === 'section'
            ? 'This saves a cloned section template, including its current blocks and nested subsections.'
            : 'This saves a cloned component template, including pre-filled values and nested children.';
      return `
        <div id="modalRoot" class="modal-root">
          <div class="modal-overlay" data-modal-action="close-overlay"></div>
          <section class="modal-panel component-meta-modal">
            <div class="modal-head">
              <h3>${title}</h3>
              <button type="button" class="hvy-button" data-modal-action="close">Close</button>
            </div>
            <p class="muted">${help}</p>
            ${existingName
              ? `<div class="reusable-existing-option">
                  <div>
                    <strong>${deps.escapeHtml(existingName)}</strong>
                    <span>Update the existing ${state.reusableSaveModal.kind === 'component' ? 'component' : 'section'} template definition.</span>
                  </div>
                  <button type="button" class="secondary" data-modal-action="update-reusable">Update Existing</button>
                </div>`
              : ''}
            <label>
              <span>${existingName ? 'New Name' : 'Name'}</span>
              <input id="reusableNameInput" value="${deps.escapeAttr(state.reusableSaveModal.draftName)}" placeholder="Callout, Pricing Table, FAQ Section..." autofocus />
            </label>
            ${existingName
              ? `<label>
                  <span>Flavor Description</span>
                  <textarea id="reusableFlavorDescriptionInput" rows="3" placeholder="Describe when this flavor should be used."></textarea>
                </label>`
              : ''}
            <div class="link-inline-actions reusable-save-actions">
              <button type="button" class="ghost" data-modal-action="close">Cancel</button>
              ${existingName ? '<button type="button" class="ghost" data-modal-action="add-reusable-flavor">Add Flavor</button>' : ''}
              <button type="button" class="${existingName ? 'ghost' : 'secondary'}" data-modal-action="save-reusable">${existingName ? 'Save As New' : 'Save Template'}</button>
            </div>
          </section>
        </div>
      `;
    }

    if (state.reusableTemplateModal) {
      const definition = getComponentDefsFromMeta(state.documentMeta).find((item) => item.name === state.reusableTemplateModal?.component);
      const variables = extractReusableTemplateVariablesFromDefinition(definition);
      const modalTitle = `Add ${humanizeComponentName(state.reusableTemplateModal.component)}`;
      let hasUnavailablePicker = false;
      let hasTargetPicker = false;
      const fields = variables.map((variable) => {
        const id = `reusableTemplateValue_${variable.name}`;
        const label = deps.escapeHtml(variable.label);
        const xrefTargetTagFilter = getTemplateVariableXrefTargetTagFilter(definition, variable.name);
        const outputGenerator = variable.generator ? getOutputGenerator(variable.generator) : null;
        const generatorButton = outputGenerator
          ? `<button
              type="button"
              class="ghost template-generator-button"
              data-modal-action="run-template-generator"
              data-template-generator="${deps.escapeAttr(outputGenerator.key)}"
              data-template-variable-target="${deps.escapeAttr(variable.name)}"
              data-required-variables="${deps.escapeAttr((outputGenerator.requiredVariables ?? []).join(','))}"
              aria-label="${deps.escapeAttr(variable.generatorLabel || outputGenerator.label || 'Generate')}"
              disabled
            >${deps.escapeHtml(variable.generatorLabel || outputGenerator.label || 'Generate')}</button>`
          : '';
        const status = outputGenerator
          ? `<span class="template-generator-status" data-template-generator-status="${deps.escapeAttr(variable.name)}"></span>`
          : '';
        const labelHead = `<span class="template-field-label-row"><span>${label}</span>${generatorButton}</span>`;
        if (xrefTargetTagFilter) {
          hasTargetPicker = true;
          const targetOptions = deps.getComponentRenderHelpers().getXrefTargetOptions(xrefTargetTagFilter);
          if (targetOptions.length === 0) {
            hasUnavailablePicker = true;
          }
          return `<label class="template-target-picker">
              ${labelHead}
              <input
                id="${deps.escapeAttr(id)}"
                data-template-variable="${deps.escapeAttr(variable.name)}"
                list="${deps.escapeAttr(`${id}_targets`)}"
                placeholder="${targetOptions.length === 0 ? 'No targets available' : 'Type or pick a target'}"
                ${targetOptions.length === 0 ? 'disabled' : ''}
              />
              <datalist id="${deps.escapeAttr(`${id}_targets`)}">
                ${targetOptions.map((option) => `<option value="${deps.escapeAttr(option.value)}" label="${deps.escapeAttr(option.label)}">${deps.escapeHtml(option.label)}</option>`).join('')}
              </datalist>
              ${status}
              ${targetOptions.length === 0 ? `<p class="template-picker-empty">No ${deps.escapeHtml(xrefTargetTagFilter)} targets available yet.</p>` : ''}
            </label>`;
        }
        return variable.type === 'block'
          ? `<label>
              ${labelHead}
              <textarea id="${deps.escapeAttr(id)}" data-template-variable="${deps.escapeAttr(variable.name)}" rows="5"></textarea>
              ${status}
            </label>`
          : `<label>
              ${labelHead}
              <input id="${deps.escapeAttr(id)}" data-template-variable="${deps.escapeAttr(variable.name)}" />
              ${status}
            </label>`;
      }).join('');
      return `
        <div id="modalRoot" class="modal-root">
          <div class="modal-overlay" data-modal-action="close-overlay"></div>
          <section class="modal-panel component-meta-modal reusable-template-modal ${hasTargetPicker ? 'template-picker-modal' : ''}">
            <div class="modal-head">
              <h3>${deps.escapeHtml(modalTitle)}</h3>
              <button type="button" class="ghost remove-x" data-modal-action="close" aria-label="Close ${deps.escapeAttr(modalTitle)}" title="Close">${closeIcon()}</button>
            </div>
            <div class="modal-field-stack">
              ${fields}
            </div>
            <div class="link-inline-actions reusable-save-actions">
              <button type="button" class="ghost" data-modal-action="close">Cancel</button>
              <button type="button" class="secondary" data-modal-action="insert-reusable-template" ${hasUnavailablePicker ? 'disabled' : ''}>Add</button>
            </div>
          </section>
        </div>
      `;
    }

    if (state.reusableDefinitionEditModal) {
      const modal = state.reusableDefinitionEditModal;
      const componentDefinitions = getComponentDefsFromMeta(state.documentMeta);
      const sectionDefinitions = getSectionDefsFromMeta(state.documentMeta);
      const definition = modal.kind === 'component' ? componentDefinitions[modal.index] : sectionDefinitions[modal.index];
      if (!definition) {
        return '';
      }
      const title = modal.kind === 'component'
        ? `Edit ${definition.name || 'Component Template'}`
        : `Edit ${definition.name || 'Section Template'}`;
      const rawDraft = modal.rawDraft || stringifyYaml(definition).trimEnd();
      const componentTemplate = modal.kind === 'component' && componentDefinitions[modal.index]
        ? getReusableTemplate(componentDefinitions[modal.index])
        : null;
      if (componentTemplate) {
        componentTemplate.schema = schemaFromUnknown(
          { ...(componentTemplate.schema as unknown as Record<string, unknown>), component: definition.name },
          new WeakSet<object>(),
          state.documentMeta
        );
      }
      const sectionTemplate = modal.kind === 'section' ? sectionDefinitions[modal.index]?.template ?? null : null;
      const componentTemplateSectionKey = `${REUSABLE_SECTION_PREFIX}${definition.name}`;
      const sectionTemplateKey = sectionTemplate?.key || `section-def:${definition.name}`;
      return `
        <div id="modalRoot" class="modal-root">
          <div class="modal-overlay" data-modal-action="save-reusable-definition-close"></div>
          <section class="modal-panel reusable-definition-modal">
            <div class="modal-head">
              <h3>${deps.escapeHtml(title)}</h3>
              <div class="modal-head-actions">
                <button type="button" class="ghost" data-modal-action="reusable-definition-mode">${modal.mode === 'raw' ? 'Edit' : 'HVY'}</button>
                <button type="button" class="ghost remove-x" data-modal-action="save-reusable-definition-close" aria-label="Close ${deps.escapeAttr(title)}" title="Close">${closeIcon()}</button>
              </div>
            </div>
            ${modal.error ? `<div class="raw-editor-error" role="alert">${deps.escapeHtml(modal.error)}</div>` : ''}
            ${modal.mode === 'raw'
              ? `<label class="reusable-definition-raw-field">
                  <span>Header Definition YAML</span>
                  <textarea id="reusableDefinitionRawInput" rows="18" spellcheck="false">${deps.escapeHtml(rawDraft)}</textarea>
                </label>`
              : `<div class="reusable-definition-editor">
                  ${componentTemplate
                    ? `<div class="reusable-definition-hvy-surface">
                        ${deps.renderBlockContentEditor(componentTemplateSectionKey, componentTemplate)}
                        <details class="meta-expandable-field">
                          <summary><span>Template Meta</span></summary>
                          ${deps.renderBlockMetaFields(componentTemplateSectionKey, componentTemplate)}
                        </details>
                      </div>`
                    : ''}
                  ${sectionTemplate
                    ? `<div class="reusable-definition-section-surface">
                        <label>
                          <span>Section Title</span>
                          <input data-field="section-title" data-section-key="${deps.escapeAttr(sectionTemplateKey)}" value="${deps.escapeAttr(sectionTemplate.title)}" />
                        </label>
                        <label class="checkbox-label">
                          <span>Locked</span>
                          <input type="checkbox" data-field="section-lock" data-section-key="${deps.escapeAttr(sectionTemplateKey)}" ${sectionTemplate.lock ? 'checked' : ''} />
                        </label>
                        ${sectionTemplate.blocks.map((block) => deps.renderEditorBlock(sectionTemplateKey, block)).join('')}
                      </div>`
                    : ''}
                </div>`}
          </section>
        </div>
      `;
    }

    if (state.sectionTemplateFlavorModal) {
      const definition = getSectionDefsFromMeta(state.documentMeta).find((item) => item.name === state.sectionTemplateFlavorModal?.templateName);
      const flavors = (definition?.flavors ?? []).filter((flavor) => flavor.name.trim().length > 0 && !!flavor.template);
      if (!definition || flavors.length === 0) {
        return '';
      }
      const modalTitle = `Choose ${definition.name} Flavor`;
      return `
        <div id="modalRoot" class="modal-root">
          <div class="modal-overlay" data-modal-action="close-overlay"></div>
          <section class="modal-panel component-meta-modal section-template-flavor-modal">
            <div class="modal-head">
              <h3>${deps.escapeHtml(modalTitle)}</h3>
              <button type="button" class="ghost remove-x" data-modal-action="close" aria-label="Close ${deps.escapeAttr(modalTitle)}" title="Close">${closeIcon()}</button>
            </div>
            <p class="muted">Pick the section structure to insert.</p>
            <div class="section-template-flavor-list">
              ${flavors.map((flavor) => `
                <button type="button" class="section-template-flavor-option" data-modal-action="choose-section-template-flavor" data-section-template-name="${deps.escapeAttr(definition.name)}" data-section-template-flavor="${deps.escapeAttr(flavor.name)}">
                  <span class="section-template-flavor-name">${deps.escapeHtml(flavor.name)}</span>
                  ${flavor.description?.trim()
                    ? `<span class="section-template-flavor-description">${deps.escapeHtml(flavor.description.trim())}</span>`
                    : '<span class="section-template-flavor-description muted">No description.</span>'
                  }
                </button>
              `).join('')}
            </div>
            <div class="link-inline-actions reusable-save-actions">
              <button type="button" class="ghost" data-modal-action="close">Cancel</button>
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
                  title="${block.schema.lock ? 'Unlock' : 'Lock'}"
                  aria-label="${block.schema.lock ? 'Unlock' : 'Lock'}"
                >${block.schema.lock ? '🔓 Unlock' : '🔒 Lock'}</button>
                <button type="button" class="hvy-button" data-modal-action="close">Close</button>
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
              <button type="button" class="hvy-button" data-modal-action="close">Close</button>
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
                <button type="button" class="hvy-button" data-modal-action="close">Close</button>
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
                  <div class="ghost-section-card add-ghost sqlite-row-component-ghost" data-action="sqlite-row-component-add-block" data-section-key="${deps.escapeAttr(
                    rowModal.sectionKey
                  )}">
                    <div class="ghost-plus-big">${plusIcon()}</div>
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
                  </div>
                  <div class="link-inline-actions reusable-save-actions">
                    <button type="button" class="ghost" data-modal-action="close">Cancel</button>
                    <button type="button" class="ghost" data-modal-action="sqlite-row-component-clear">Remove</button>
                    <button type="button" class="secondary" data-modal-action="sqlite-row-component-save">Save</button>
                  </div>`
                : `<div class="ghost-section-card add-ghost sqlite-row-component-ghost" data-action="sqlite-row-component-add-block" data-section-key="${deps.escapeAttr(
                    state.sqliteRowComponentModal.sectionKey
                  )}">
                    <div class="ghost-plus-big">${plusIcon()}</div>
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
                  </div>
                  <div class="link-inline-actions reusable-save-actions">
                    <button type="button" class="ghost" data-modal-action="close">Cancel</button>
                  </div>`
            }
            ${
              (rowModal.mode === 'raw' ? rawPreviewBlocks : attachedBlocks).length > 0
                ? (rowModal.mode === 'raw' ? rawPreviewBlocks : attachedBlocks)
                    .map(
                      (block) => `<div class="reader-block slot-center" style="${deps.escapeAttr(sanitizeInlineCss(block.schema.css))}">
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
                title="${section.lock ? 'Unlock' : 'Lock'}"
                aria-label="${section.lock ? 'Unlock' : 'Lock'}"
              >${section.lock ? '🔓 Unlock' : '🔒 Lock'}</button>
              <button type="button" class="hvy-button" data-modal-action="close">Close</button>
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
              <textarea id="modalCssInput">${deps.escapeHtml(section.css)}</textarea>
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
              <span class="description-label-with-action">Description${
                section.description.trim()
                  ? ''
                  : ` <button type="button" class="ghost inline-generate-description" data-action="generate-section-description" data-section-key="${deps.escapeAttr(section.key)}">Generate</button>`
              }</span>
              <textarea
                rows="3"
                data-section-key="${deps.escapeAttr(section.key)}"
                data-field="section-description"
              >${deps.escapeHtml(section.description)}</textarea>
            </label>
            <div style="display: flex; gap: 1rem; flex-wrap: wrap;">
              <label class="checkbox-label">
                <input
                  type="checkbox"
                  data-section-key="${deps.escapeAttr(section.key)}"
                  data-field="section-contained"
                  ${section.contained ? 'checked' : ''}
                />
                Contained
              </label>
              <label class="checkbox-label">
                <input
                  type="checkbox"
                  data-section-key="${deps.escapeAttr(section.key)}"
                  data-field="section-highlight"
                  ${section.highlight ? 'checked' : ''}
                />
                Highlight
              </label>
              <label class="checkbox-label">
                <input
                  type="checkbox"
                  data-section-key="${deps.escapeAttr(section.key)}"
                  data-field="section-priority"
                  ${section.priority ? 'checked' : ''}
                />
                Priority
              </label>
              <label class="checkbox-label">
                <input
                  type="checkbox"
                  data-section-key="${deps.escapeAttr(section.key)}"
                  data-field="section-editor-only"
                  ${section.editorOnly ? 'checked' : ''}
                />
                Editor Only
              </label>
              <label class="checkbox-label">
                <input
                  type="checkbox"
                  data-section-key="${deps.escapeAttr(section.key)}"
                  data-field="section-exclude-from-import"
                  ${section.exclude_from_import ? 'checked' : ''}
                />
                Exclude From Import
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

  function getTemplateVariableXrefTargetTagFilter(definition: ComponentDefinition | undefined, variableName: string): string {
    const schema = definition?.template?.schema ?? definition?.schema;
    const target = schema?.xrefTarget ?? '';
    if (!schema || !target || !templateStringContainsVariable(target, variableName)) {
      return '';
    }
    return schema.xrefTargetTagFilter.trim();
  }

  function templateStringContainsVariable(value: string, variableName: string): boolean {
    const escaped = variableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`{%\\s*${escaped}\\s*(?:\\|\\s*(?:text|block)\\s*)?%}`).test(value);
  }

  function humanizeComponentName(name: string): string {
    return name
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  return {
    renderNavigation,
    renderReaderSections,
    renderSidebarSections,
    renderSidebarHelpBalloon,
    renderReaderSection,
    renderReaderBlock,
    renderReaderBlocks,
    renderReaderListBlocks,
    orderReaderBlocks,
    orderReaderListBlocks,
    isReaderViewPrioritizedBlock,
    renderThemeEditor,
    renderModal,
    renderLinkInlineModal,
    renderWarnings,
  };
}
