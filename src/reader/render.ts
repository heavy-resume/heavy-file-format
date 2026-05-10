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
import { getMatchedPaletteId, HVY_PALETTES } from '../palettes/palette-registry';
import type { DbTableQueryModalState, ReaderViewFilter, ReusableSaveModalState, SqliteRowComponentModalState, VisualDocument } from '../types';
import type { SearchState } from '../search/types';
import { createSearchFilterContext, isBlockSearchDeprioritized, isBlockSearchMatch, isBlockSearchVisible, isSectionSearchDeprioritized, isSectionSearchMatch, isSectionSearchVisible, type SearchFilterContext } from '../search/filter';
import { highlightSearchHtml } from '../search/highlight';
import { getDocumentSectionDefaultCss, mergeDocumentCss } from '../document-section-defaults';
import { sanitizeInlineCss } from '../css-sanitizer';
import { areTablesEnabled } from '../reference-config';
import { parseAttachedComponentBlocks } from '../plugins/db-table';
import { SCRIPTING_PLUGIN_ID } from '../plugins/registry';
import { getComponentDefsFromMeta } from '../component-defs';
import { extractReusableTemplateVariablesFromDefinition } from '../reusable-template-values';
import { plusIcon } from '../icons';
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
  documentSections: VisualSection[];
  addComponentBySection: Record<string, string>;
  tempHighlights: Set<string>;
  aiEditTarget: { sectionKey: string | null; blockId: string | null };
  activeEditorBlock?: { sectionKey: string; blockId: string } | null;
  modalSectionKey: string | null;
  sqliteRowComponentModal: SqliteRowComponentModalState | null;
  dbTableQueryModal: DbTableQueryModalState | null;
  reusableSaveModal: ReusableSaveModalState | null;
  reusableTemplateModal: import('../types').ReusableTemplateModalState | null;
  componentMetaModal: { sectionKey: string; blockId: string } | null;
  themeModalOpen: boolean;
  theme: ThemeConfig;
  currentView: 'editor' | 'viewer' | 'ai';
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
  renderEditorBlock: (sectionKey: string, block: VisualBlock) => string;
  renderBlockContentEditor: (sectionKey: string, block: VisualBlock) => string;
  renderComponentOptions: (selected: string) => string;
  renderBlockMetaFields: (sectionKey: string, block: VisualBlock) => string;
}

export interface ReaderRenderer {
  renderNavigation: (sections: VisualSection[]) => string;
  renderReaderSections: (sections: VisualSection[]) => string;
  renderSidebarSections: (sections: VisualSection[]) => string;
  renderSidebarHelpBalloon: (sections: VisualSection[]) => string;
  renderReaderSection: (section: VisualSection) => string;
  renderReaderBlock: (section: VisualSection, block: VisualBlock) => string;
  renderReaderBlocks: (section: VisualSection, blocks: VisualBlock[]) => string;
  renderReaderListBlocks: (section: VisualSection, blocks: VisualBlock[]) => string;
  orderReaderBlocks: (blocks: VisualBlock[]) => VisualBlock[];
  orderReaderListBlocks: (blocks: VisualBlock[]) => VisualBlock[];
  isReaderViewPrioritizedBlock: (block: VisualBlock) => boolean;
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
    activeReaderViewContext = createReaderViewContext(
      { meta: state.documentMeta, extension: '.hvy', sections: state.documentSections, attachments: [] },
      state.readerView
    );
    activeSearchFilterContext = createSearchFilterContext(state.documentSections, state.search);
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
        { meta: state.documentMeta, extension: '.hvy', sections: state.documentSections, attachments: [] },
        state.readerView
      );
    }
    return activeReaderViewContext;
  }

  function getActiveSearchFilterContext(): SearchFilterContext {
    return activeSearchFilterContext ?? createSearchFilterContext(state.documentSections, state.search);
  }

  function renderNavigation(sections: VisualSection[]): string {
    return withReaderViewContext(() => {
      const viewContext = getActiveReaderViewContext();
      const items = deps.flattenSections(sections).filter((section) => {
        if (section.isGhost || section.location === 'sidebar') {
          return false;
        }
        return !hasReaderViewModifier(viewContext, getSectionReaderViewTargetKey(section), 'hidden');
      });
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
    });
  }

  function renderReaderSections(sections: VisualSection[]): string {
    return withReaderViewContext(() => {
      resetReaderTableStripeSequence();
      const realSections = orderReaderViewTargets(
        sections.filter((section) => !section.isGhost && section.location !== 'sidebar' && isSectionSearchVisible(getActiveSearchFilterContext(), section)),
        getActiveReaderViewContext(),
        getSectionReaderViewTargetKey,
        state.readerViewActivatedTargets
      );
      if (realSections.length === 0) {
        return getActiveSearchFilterContext().filtering
          ? '<div class="reader-search-empty"><div>No matches in this filtered view.</div></div>'
          : '<div class="muted">No content to display yet.</div>';
      }
      const maxWidth = typeof state.documentMeta.reader_max_width === 'string' ? state.documentMeta.reader_max_width.trim() : '';
      const bodyStyle = maxWidth.length > 0 ? ` style="max-width: ${deps.escapeAttr(maxWidth)};"` : '';
      const surfaceAttrs = renderResponsiveSurfaceAttrs(maxWidth);
      return `<div${surfaceAttrs}><div class="reader-document-body"${bodyStyle}>${realSections.map((section) => renderReaderSection(section)).join('')}</div></div>`;
    });
  }

  function renderResponsiveSurfaceAttrs(_documentMaxWidth: string): string {
    const preview = state.responsivePreview;
    return ` class="hvy-surface hvy-surface-${deps.escapeAttr(preview)}"`;
  }

  function renderSidebarSections(sections: VisualSection[]): string {
    return withReaderViewContext(() => {
      resetReaderTableStripeSequence();
      const sidebarSections = orderReaderViewTargets(
        sections.filter((section) => !section.isGhost && section.location === 'sidebar' && isSectionSearchVisible(getActiveSearchFilterContext(), section)),
        getActiveReaderViewContext(),
        getSectionReaderViewTargetKey,
        state.readerViewActivatedTargets
      );
      if (sidebarSections.length === 0) {
        return '';
      }
      const surfaceAttrs = renderResponsiveSurfaceAttrs('');
      return `<div${surfaceAttrs}><div class="reader-sidebar-surface-body">${sidebarSections.map((section) => renderReaderSection(section)).join('')}</div></div>`;
    });
  }

  function renderSidebarHelpBalloon(sections: VisualSection[]): string {
    if (state.viewerSidebarHelpDismissed) {
      return '';
    }
    const sidebarSections = sections.filter((section) => !section.isGhost && section.location === 'sidebar');
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
    const prioritized = isReaderViewPrioritized(viewContext, targetKey);
    const viewCollapseKey = `reader-view-collapse:${targetKey}`;
    const viewExpanded = state.readerContainerState[viewCollapseKey] ?? !modifiers.has('collapse');
    const sectionExpanded = modifiers.has('collapse') ? viewExpanded : prioritized ? true : section.expanded;
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
    const childrenHtml = orderReaderViewTargets(
      section.children.filter((child) => !child.isGhost),
      viewContext,
      getSectionReaderViewTargetKey,
      state.readerViewActivatedTargets
    ).map((child) => renderReaderSection(child)).join('');
    if (!blocksHtml.trim() && !childrenHtml.trim() && !isSectionSearchMatch(searchContext, section)) {
      return '';
    }
    const content = `<div class="${contentClass}">${blocksHtml}${childrenHtml}</div>`;

    const viewCollapseAttrs = `data-reader-action="toggle-view-collapse" data-reader-view-target="${deps.escapeAttr(targetKey)}" data-reader-view-collapse-key="${deps.escapeAttr(viewCollapseKey)}" aria-expanded="${viewExpanded ? 'true' : 'false'}"`;
    const toggleAttrs = modifiers.has('collapse')
      ? (sectionExpanded ? '' : ` ${viewCollapseAttrs}`)
      : section.contained && section.expanded
      ? ''
      : section.contained
      ? ` data-reader-action="toggle-expand" data-section-key="${deps.escapeAttr(section.key)}"`
      : '';

    const header = section.contained || modifiers.has('collapse')
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
      <section id="${deps.escapeAttr(effectiveId)}" class="${classList}" data-section-key="${deps.escapeAttr(section.key)}" style="${deps.escapeAttr(sectionStyle)}"${renderReaderViewTargetAttrs(targetKey, dimmed)}${toggleAttrs}>
        ${header}
        ${content}
      </section>
    `;
  }

  function renderReaderBlock(section: VisualSection, block: VisualBlock): string {
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
    if (state.currentView === 'ai' && state.activeEditorBlock?.sectionKey === section.key && state.activeEditorBlock.blockId === block.id) {
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
    const blockAttrs = `${idAttr} class="${blockClass}" data-component="${deps.escapeAttr(block.schema.component)}" data-section-key="${deps.escapeAttr(section.key)}" data-block-id="${deps.escapeAttr(block.id)}"${expandableAttrs} style="${deps.escapeAttr(sanitizeInlineCss(block.schema.css))}"`;
    const helpers = deps.getComponentRenderHelpers();
    const renderBlockShell = (body: string): string => {
      const query = searchContext.filtering ? '' : searchContext.query;
      return `<div ${blockAttrs}${renderReaderViewTargetAttrs(targetKey, dimmed)}>${highlightSearchHtml(body, query, searchContext.caseSensitive)}</div>`;
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
      return renderNonEmptyMaybeCollapsedBlockShell(renderComponentListReader(section, block, helpers));
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
    return renderMaybeCollapsedBlockShell(renderTextReader(section, block, helpers));
  }

  function renderReaderBlocks(section: VisualSection, blocks: VisualBlock[]): string {
    return orderReaderBlocks(blocks).map((block) => renderReaderBlock(section, block)).join('');
  }

  function renderReaderListBlocks(section: VisualSection, blocks: VisualBlock[]): string {
    return orderReaderListBlocks(blocks).map((block) => renderReaderBlock(section, block)).join('');
  }

  function orderReaderBlocks(blocks: VisualBlock[]): VisualBlock[] {
    return orderReaderViewTargets(
      blocks,
      getActiveReaderViewContext(),
      getBlockReaderViewTargetKey,
      state.readerViewActivatedTargets,
      { prioritize: false }
    ).filter((block) =>
      isBlockSearchVisible(getActiveSearchFilterContext(), block)
    );
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
    return `<div class="${deps.escapeAttr(className)}" style="--hvy-container-preview-rem: 3rem;">
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

  function renderThemeModal(): string {
    const theme = state.theme;
    const overrideNames = new Set(Object.keys(theme.colors));
    const matchedPaletteId = getMatchedPaletteId(theme.colors);
    const paletteCards = HVY_PALETTES.map((palette) => {
      const isSelected = matchedPaletteId === palette.id;
      const previewStyle = [
        `--palette-preview-bg: ${palette.colors['--hvy-bg'] ?? 'transparent'}`,
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
          <div class="theme-palette-grid" aria-label="Theme palettes">
            ${paletteCards}
          </div>
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
      const existingName = state.reusableSaveModal.kind === 'component' ? state.reusableSaveModal.existingName : undefined;
      const title = existingName
        ? 'Update Reusable Component'
        : state.reusableSaveModal.kind === 'section'
          ? 'Save As Reusable Section'
          : 'Save As Reusable Component';
      const help =
        existingName
          ? `This component already uses "${deps.escapeHtml(existingName)}". Update that reusable definition or save this component as a new reusable definition.`
          : state.reusableSaveModal.kind === 'section'
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
            ${existingName
              ? `<div class="reusable-existing-option">
                  <div>
                    <strong>${deps.escapeHtml(existingName)}</strong>
                    <span>Update the existing reusable component definition.</span>
                  </div>
                  <button type="button" class="secondary" data-modal-action="update-reusable">Update Existing</button>
                </div>`
              : ''}
            <label>
              <span>${existingName ? 'New Name' : 'Name'}</span>
              <input id="reusableNameInput" value="${deps.escapeAttr(state.reusableSaveModal.draftName)}" placeholder="Callout, Pricing Table, FAQ Section..." autofocus />
            </label>
            <div class="link-inline-actions reusable-save-actions">
              <button type="button" class="ghost" data-modal-action="close">Cancel</button>
              <button type="button" class="${existingName ? 'ghost' : 'secondary'}" data-modal-action="save-reusable">${existingName ? 'Save As New' : 'Save Reusable'}</button>
            </div>
          </section>
        </div>
      `;
    }

    if (state.reusableTemplateModal) {
      const definition = getComponentDefsFromMeta(state.documentMeta).find((item) => item.name === state.reusableTemplateModal?.component);
      const variables = extractReusableTemplateVariablesFromDefinition(definition);
      const fields = variables.map((variable) => {
        const id = `reusableTemplateValue_${variable.name}`;
        const label = deps.escapeHtml(variable.name);
        return variable.type === 'block'
          ? `<label>
              <span>${label}</span>
              <textarea id="${deps.escapeAttr(id)}" data-template-variable="${deps.escapeAttr(variable.name)}" rows="5"></textarea>
            </label>`
          : `<label>
              <span>${label}</span>
              <input id="${deps.escapeAttr(id)}" data-template-variable="${deps.escapeAttr(variable.name)}" />
            </label>`;
      }).join('');
      return `
        <div id="modalRoot" class="modal-root">
          <div class="modal-overlay" data-modal-action="close-overlay"></div>
          <section class="modal-panel component-meta-modal">
            <div class="modal-head">
              <h3>${deps.escapeHtml(state.reusableTemplateModal.component)}</h3>
              <button type="button" data-modal-action="close">Close</button>
            </div>
            <p class="muted">Create reusable component</p>
            <div class="modal-field-stack">
              ${fields}
            </div>
            <div class="link-inline-actions reusable-save-actions">
              <button type="button" class="ghost" data-modal-action="close">Cancel</button>
              <button type="button" class="secondary" data-modal-action="insert-reusable-template">Insert</button>
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
                  </article>
                  <div class="link-inline-actions reusable-save-actions">
                    <button type="button" class="ghost" data-modal-action="close">Cancel</button>
                    <button type="button" class="ghost" data-modal-action="sqlite-row-component-clear">Remove</button>
                    <button type="button" class="secondary" data-modal-action="sqlite-row-component-save">Save</button>
                  </div>`
                : `<article class="ghost-section-card add-ghost sqlite-row-component-ghost" data-action="sqlite-row-component-add-block" data-section-key="${deps.escapeAttr(
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
                  </article>
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
    renderSidebarHelpBalloon,
    renderReaderSection,
    renderReaderBlock,
    renderReaderBlocks,
    renderReaderListBlocks,
    orderReaderBlocks,
    orderReaderListBlocks,
    isReaderViewPrioritizedBlock,
    renderModal,
    renderLinkInlineModal,
    renderWarnings,
  };
}
