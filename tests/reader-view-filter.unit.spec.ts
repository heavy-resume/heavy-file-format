import { expect, test, vi } from 'vitest';

import { createReaderRenderer } from '../src/reader/render';
import {
  createReaderViewContext,
  getBlockReaderViewTargetKey,
  getReaderViewModifiers,
  getReaderViewPriorityRank,
  getSectionReaderViewTargetKey,
  orderReaderViewTargets,
} from '../src/reader/view-filter';
import { deserializeDocument } from '../src/serialization';
import { defaultBlockSchema } from '../src/document-factory';
import { createDefaultSearchState } from '../src/search/state';
import type { ComponentRenderHelpers } from '../src/editor/component-helpers';
import type { VisualBlock, VisualSection } from '../src/editor/types';
import type { ReaderViewFilter } from '../src/types';

function createReaderViewTestDocument() {
  return deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"intro"}-->
 Intro

<!--hvy:text {"id":"shared"}-->
 First shared

<!--hvy: {"id":"details"}-->
#! Details

<!--hvy:text {"id":"shared"}-->
 Second shared
`, '.hvy');
}

function createTextBlock(id: string, text: string): VisualBlock {
  return {
    id: `block-${id}`,
    text,
    schemaMode: false,
    schema: {
      ...defaultBlockSchema('text'),
      id,
    },
  };
}

function createSection(id: string, blocks: VisualBlock[] = []): VisualSection {
  return {
    key: `section-${id}`,
    customId: id,
    contained: true,
    editorOnly: false,
    lock: false,
    idEditorOpen: false,
    isGhost: false,
    title: id,
    level: 1,
    expanded: true,
    highlight: false,
    css: '',
    tags: '',
    description: '',
    location: 'main',
    blocks,
    children: [],
  };
}

test('reader view resolves IDs and CLI virtual paths', () => {
  const document = createReaderViewTestDocument();
  const expectedResult = createReaderViewContext(document, {
    summary: ['highlight'],
    '/id/summary/intro': ['collapse'],
  });

  const summary = document.sections[0];
  const intro = summary?.blocks[0];

  expect(summary).toBeTruthy();
  expect(intro).toBeTruthy();
  expect(getReaderViewModifiers(expectedResult, getSectionReaderViewTargetKey(summary as VisualSection)).has('highlight')).toBe(true);
  expect(getReaderViewModifiers(expectedResult, getBlockReaderViewTargetKey(intro as VisualBlock)).has('collapse')).toBe(true);
});

test('reader view warns for invalid targets', () => {
  const document = createReaderViewTestDocument();
  const warn = vi.fn();

  createReaderViewContext(document, { '/body/missing': ['hidden'] }, warn);

  expect(warn).toHaveBeenCalledWith('[hvy:reader-view] Unknown reader view target: /body/missing');
});

test('reader view applies duplicate ID matches consistently', () => {
  const document = createReaderViewTestDocument();
  const expectedResult = createReaderViewContext(document, { shared: ['dimmed'] });

  const firstShared = document.sections[0]?.blocks[1];
  const secondShared = document.sections[1]?.blocks[0];

  expect(getReaderViewModifiers(expectedResult, getBlockReaderViewTargetKey(firstShared as VisualBlock)).has('dimmed')).toBe(true);
  expect(getReaderViewModifiers(expectedResult, getBlockReaderViewTargetKey(secondShared as VisualBlock)).has('dimmed')).toBe(true);
});

test('reader view ordering hides hidden blocks and moves dimmed blocks behind siblings', () => {
  const first = createTextBlock('first', 'First');
  const second = createTextBlock('second', 'Second');
  const third = createTextBlock('third', 'Third');
  const document = {
    meta: {},
    extension: '.hvy' as const,
    attachments: [],
    sections: [createSection('summary', [first, second, third])],
  };
  const context = createReaderViewContext(document, {
    first: ['dimmed'],
    second: ['hidden'],
    third: ['dimmed'],
  });

  const expectedResult = orderReaderViewTargets([first, second, third], context, getBlockReaderViewTargetKey, new Set<string>());

  expect(expectedResult.map((block) => block.schema.id)).toEqual(['first', 'third']);
});

test('reader view prioritizes highlighted ancestors and plain priority targets with stable order', () => {
  const highlightedChild = createTextBlock('highlighted-child', 'Highlighted child');
  const plainPriorityChild = createTextBlock('plain-priority-child', 'Plain priority child');
  const normalChild = createTextBlock('normal-child', 'Normal child');
  const highlightedSection = createSection('highlighted-parent', [highlightedChild]);
  const plainPrioritySection = createSection('plain-priority-parent', [plainPriorityChild]);
  const normalSection = createSection('normal-parent', [normalChild]);
  const document = {
    meta: {},
    extension: '.hvy' as const,
    attachments: [],
    sections: [plainPrioritySection, normalSection, highlightedSection],
  };
  const context = createReaderViewContext(document, {
    'highlighted-child': ['highlight'],
    'plain-priority-parent': ['priority'],
  });

  const expectedResult = orderReaderViewTargets(
    [plainPrioritySection, normalSection, highlightedSection],
    context,
    getSectionReaderViewTargetKey,
    new Set<string>()
  );

  expect(expectedResult.map((section) => section.customId)).toEqual(['plain-priority-parent', 'highlighted-parent', 'normal-parent']);
  expect(getReaderViewPriorityRank(context, getSectionReaderViewTargetKey(highlightedSection))).toBe(1);
  expect(getReaderViewPriorityRank(context, getSectionReaderViewTargetKey(plainPrioritySection))).toBe(1);
});

test('reader view can preserve non-list block order while keeping priority available', () => {
  const header = createTextBlock('header', 'Header');
  const highlighted = createTextBlock('highlighted', 'Highlighted');
  const document = {
    meta: {},
    extension: '.hvy' as const,
    attachments: [],
    sections: [createSection('summary', [header, highlighted])],
  };
  const context = createReaderViewContext(document, {
    highlighted: ['highlight'],
  });

  const expectedResult = orderReaderViewTargets(
    [header, highlighted],
    context,
    getBlockReaderViewTargetKey,
    new Set<string>(),
    { prioritize: false }
  );

  expect(expectedResult.map((block) => block.schema.id)).toEqual(['header', 'highlighted']);
  expect(getReaderViewPriorityRank(context, getBlockReaderViewTargetKey(highlighted))).toBe(1);
});

test('reader view keeps activated dimmed targets in their dimmed order', () => {
  const first = createTextBlock('first', 'First');
  const second = createTextBlock('second', 'Second');
  const third = createTextBlock('third', 'Third');
  const document = {
    meta: {},
    extension: '.hvy' as const,
    attachments: [],
    sections: [createSection('summary', [first, second, third])],
  };
  const context = createReaderViewContext(document, {
    first: ['dimmed'],
  });
  const activatedTargets = new Set<string>([getBlockReaderViewTargetKey(first)]);

  const expectedResult = orderReaderViewTargets([first, second, third], context, getBlockReaderViewTargetKey, activatedTargets);

  expect(expectedResult.map((block) => block.schema.id)).toEqual(['second', 'third', 'first']);
});

test('reader view rendering applies hidden, dimmed, highlight, and generic collapse wrappers', () => {
  const first = createTextBlock('first', 'First');
  const second = createTextBlock('second', 'Second');
  const third = createTextBlock('third', 'Third');
  const priorityChild = createTextBlock('priority-child', 'Priority child');
  const prioritySection = createSection('collapsed-priority', [priorityChild]);
  prioritySection.expanded = false;
  const document = {
    meta: {},
    extension: '.hvy' as const,
    attachments: [],
    sections: [createSection('summary', [first, second, third]), prioritySection],
  };
  const state = {
    documentMeta: document.meta,
    documentSections: document.sections,
    addComponentBySection: {},
    tempHighlights: new Set<string>(),
    aiEditTarget: { sectionKey: null, blockId: null },
    modalSectionKey: null,
    sqliteRowComponentModal: null,
    dbTableQueryModal: null,
    pdfTemplateImportModal: null,
    reusableSaveModal: null,
    reusableTemplateModal: null,
    sectionTemplateFlavorModal: null,
    componentMetaModal: null,
    themeModalOpen: false,
    themeModalMode: 'full' as const,
    paletteOverrideId: null,
    theme: { colors: {} },
    currentView: 'viewer' as const,
    showAdvancedEditor: false,
    responsivePreview: 'full' as const,
    readerExpandableState: {},
    readerContainerState: {},
    readerView: {
      first: ['dimmed'],
      second: ['hidden'],
      third: ['highlight', 'collapse'],
      'priority-child': ['highlight'],
    } satisfies ReaderViewFilter,
    search: createDefaultSearchState(),
    readerViewActivatedTargets: new Set<string>(),
    componentListReaderViews: {},
    viewerSidebarHelpDismissed: true,
  };
  const renderer = createReaderRenderer(state, {
    escapeAttr: escapeHtml,
    escapeHtml,
    flattenSections: (sections) => sections,
    findDuplicateSectionIds: () => [],
    findSectionByKey: () => null,
    findBlockByIds: () => null,
    getSectionId: (section) => section.customId,
    formatSectionTitle: (title) => title,
    resolveBaseComponent: (componentName) => componentName,
    ensureExpandableBlocks: () => {},
    ensureGridItems: () => {},
    getComponentRenderHelpers: () => helpers,
    renderEditorBlock: () => '',
    renderBlockContentEditor: () => '',
    renderComponentOptions: () => '',
    renderReusableSectionOptions: () => '',
    getSectionDefs: () => [],
    renderBlockMetaFields: () => '',
  });
  const helpers = {
    escapeAttr: escapeHtml,
    escapeHtml,
    markdownToEditorHtml: escapeHtml,
    renderRichToolbar: () => '',
    renderEditorBlock: () => '',
    renderPassiveEditorBlock: () => '',
    renderReaderBlock: renderer.renderReaderBlock,
    renderReaderBlocks: renderer.renderReaderBlocks,
    renderReaderListBlocks: renderer.renderReaderListBlocks,
    orderReaderBlocks: renderer.orderReaderBlocks,
    orderReaderListBlocks: renderer.orderReaderListBlocks,
    isReaderViewPrioritizedBlock: () => false,
    renderTextFragment: (content: string) => escapeHtml(content),
    renderComponentFragment: (_componentName: string, content: string) => escapeHtml(content),
    renderComponentOptions: () => '',
    renderAddComponentPicker: () => '',
    renderComponentPlacementTarget: () => '',
    renderOption: () => '',
    getDocumentComponentCss: () => '',
    getXrefTargetOptions: () => [],
    isXrefTargetValid: () => true,
    getTableColumns: () => [],
    ensureContainerBlocks: () => {},
    ensureComponentListBlocks: () => {},
    getSelectedAddComponent: (_key: string, fallback: string) => fallback,
    getComponentListReaderViewId: () => '',
    getReaderContainerExpanded: (_key: string, fallback: boolean) => fallback,
    isExpandableEditorPanelOpen: (_sectionKey: string, _blockId: string, _panel: 'stub' | 'expanded', fallback: boolean) => fallback,
    isAdvancedEditorMode: () => false,
    isMobileAdjustmentMode: () => false,
  } satisfies ComponentRenderHelpers;

  const expectedResult = renderer.renderReaderSections(document.sections);

  expect(expectedResult).toContain('data-reader-view-dimmed="true"');
  expect(expectedResult).toContain('is-highlighted');
  expect(expectedResult).toContain('reader-view-collapse-wrapper');
  expect(expectedResult).toContain('id="collapsed-priority" class="reader-section');
  expect(expectedResult).not.toContain('id="collapsed-priority" class="reader-section is-collapsed-preview');
  expect(expectedResult).toContain('First');
  expect(expectedResult).not.toContain('Second');
});

test('AI reader hides editor-only scripting blocks outside advanced mode', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"maintenance"}-->
#! Maintenance

<!--hvy:plugin {"id":"cleanup","editorOnly":true,"plugin":"hvy.scripting","pluginConfig":{"version":"0.1"}}-->
print("maintenance script")
`, '.hvy');
  const state = {
    documentMeta: document.meta,
    documentSections: document.sections,
    addComponentBySection: {},
    tempHighlights: new Set<string>(),
    aiEditTarget: { sectionKey: null, blockId: null },
    modalSectionKey: null,
    sqliteRowComponentModal: null,
    dbTableQueryModal: null,
    pdfTemplateImportModal: null,
    reusableSaveModal: null,
    reusableTemplateModal: null,
    sectionTemplateFlavorModal: null,
    componentMetaModal: null,
    themeModalOpen: false,
    themeModalMode: 'full' as const,
    paletteOverrideId: null,
    theme: { colors: {} },
    currentView: 'ai' as const,
    showAdvancedEditor: false,
    responsivePreview: 'full' as const,
    readerExpandableState: {},
    readerContainerState: {},
    readerView: {},
    search: createDefaultSearchState(),
    readerViewActivatedTargets: new Set<string>(),
    componentListReaderViews: {},
    viewerSidebarHelpDismissed: true,
  };
  const renderer = createReaderRenderer(state, {
    escapeAttr: escapeHtml,
    escapeHtml,
    flattenSections: (sections) => sections,
    findDuplicateSectionIds: () => [],
    findSectionByKey: () => null,
    findBlockByIds: () => null,
    getSectionId: (section) => section.customId,
    formatSectionTitle: (title) => title,
    resolveBaseComponent: (componentName) => componentName,
    ensureExpandableBlocks: () => {},
    ensureGridItems: () => {},
    getComponentRenderHelpers: () => helpers,
    renderEditorBlock: () => '',
    renderBlockContentEditor: () => '',
    renderComponentOptions: () => '',
    renderReusableSectionOptions: () => '',
    getSectionDefs: () => [],
    renderBlockMetaFields: () => '',
  });
  const helpers = {
    escapeAttr: escapeHtml,
    escapeHtml,
    markdownToEditorHtml: escapeHtml,
    renderRichToolbar: () => '',
    renderEditorBlock: () => '',
    renderPassiveEditorBlock: () => '',
    renderReaderBlock: renderer.renderReaderBlock,
    renderReaderBlocks: renderer.renderReaderBlocks,
    renderReaderListBlocks: renderer.renderReaderListBlocks,
    orderReaderBlocks: renderer.orderReaderBlocks,
    orderReaderListBlocks: renderer.orderReaderListBlocks,
    isReaderViewPrioritizedBlock: () => false,
    renderTextFragment: (content: string) => escapeHtml(content),
    renderComponentFragment: (_componentName: string, content: string) => escapeHtml(content),
    renderComponentOptions: () => '',
    renderAddComponentPicker: () => '',
    renderComponentPlacementTarget: () => '',
    renderOption: () => '',
    getDocumentComponentCss: () => '',
    getXrefTargetOptions: () => [],
    isXrefTargetValid: () => true,
    getTableColumns: () => [],
    ensureContainerBlocks: () => {},
    ensureComponentListBlocks: () => {},
    getSelectedAddComponent: (_key: string, fallback: string) => fallback,
    getComponentListReaderViewId: () => '',
    getReaderContainerExpanded: (_key: string, fallback: boolean) => fallback,
    isExpandableEditorPanelOpen: (_sectionKey: string, _blockId: string, _panel: 'stub' | 'expanded', fallback: boolean) => fallback,
    isAdvancedEditorMode: () => state.showAdvancedEditor,
    isMobileAdjustmentMode: () => false,
  } satisfies ComponentRenderHelpers;

  expect(renderer.renderReaderSections(document.sections)).not.toContain('maintenance script');

  state.showAdvancedEditor = true;
  expect(renderer.renderReaderSections(document.sections)).toContain('maintenance script');
});

test('inline link modal includes component ids as document targets', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:container {"id":"outer-container"}-->

  <!--hvy:text {"id":"nested-note"}-->
   Nested note
`, '.hvy');
  let helpers: ComponentRenderHelpers;
  const state = {
    documentMeta: document.meta,
    documentSections: document.sections,
    addComponentBySection: {},
    tempHighlights: new Set<string>(),
    aiEditTarget: { sectionKey: null, blockId: null },
    contextMenu: null,
    activeEditorBlock: null,
    aiEditorHostBlock: null,
    aiEditorHostSectionKey: null,
    modalSectionKey: null,
    sqliteRowComponentModal: null,
    dbTableQueryModal: null,
    pdfTemplateImportModal: null,
    reusableSaveModal: null,
    reusableTemplateModal: null,
    reusableDefinitionEditModal: null,
    sectionTemplateFlavorModal: null,
    componentMetaModal: null,
    themeModalOpen: false,
    themeModalMode: 'full' as const,
    paletteOverrideId: null,
    theme: { colors: {} },
    currentView: 'editor' as const,
    showAdvancedEditor: false,
    responsivePreview: 'full' as const,
    readerExpandableState: {},
    readerContainerState: {},
    readerView: {},
    search: createDefaultSearchState(),
    readerViewActivatedTargets: new Set<string>(),
    componentListReaderViews: {},
    viewerSidebarHelpDismissed: true,
  };
  const renderer = createReaderRenderer(state, {
    escapeAttr: escapeHtml,
    escapeHtml,
    flattenSections: (sections) => sections,
    findDuplicateSectionIds: () => [],
    findSectionByKey: () => null,
    findBlockByIds: () => null,
    getSectionId: (section) => section.customId,
    formatSectionTitle: (title) => title,
    resolveBaseComponent: (componentName) => componentName,
    ensureExpandableBlocks: () => {},
    ensureGridItems: () => {},
    getComponentRenderHelpers: () => helpers,
    renderEditorBlock: () => '',
    renderBlockContentEditor: () => '',
    renderComponentOptions: () => '',
    renderReusableSectionOptions: () => '',
    getSectionDefs: () => [],
    renderBlockMetaFields: () => '',
  });
  helpers = {
    escapeAttr: escapeHtml,
    escapeHtml,
    markdownToEditorHtml: escapeHtml,
    renderRichToolbar: () => '',
    renderEditorBlock: () => '',
    renderPassiveEditorBlock: () => '',
    renderReaderBlock: renderer.renderReaderBlock,
    renderReaderBlocks: renderer.renderReaderBlocks,
    renderReaderListBlocks: renderer.renderReaderListBlocks,
    orderReaderBlocks: renderer.orderReaderBlocks,
    orderReaderListBlocks: renderer.orderReaderListBlocks,
    isReaderViewPrioritizedBlock: () => false,
    renderTextFragment: (content: string) => escapeHtml(content),
    renderComponentFragment: (_componentName: string, content: string) => escapeHtml(content),
    renderComponentOptions: () => '',
    renderAddComponentPicker: () => '',
    renderComponentPlacementTarget: () => '',
    renderOption: () => '',
    getDocumentComponentCss: () => '',
    getXrefTargetOptions: () => [],
    isXrefTargetValid: () => true,
    getTableColumns: () => [],
    ensureContainerBlocks: () => {},
    ensureComponentListBlocks: () => {},
    getSelectedAddComponent: (_key: string, fallback: string) => fallback,
    getComponentListReaderViewId: () => '',
    getReaderContainerExpanded: (_key: string, fallback: boolean) => fallback,
    isExpandableEditorPanelOpen: (_sectionKey: string, _blockId: string, _panel: 'stub' | 'expanded', fallback: boolean) => fallback,
    isAdvancedEditorMode: () => false,
    isMobileAdjustmentMode: () => false,
  };

  const expectedResult = renderer.renderLinkInlineModal();

  expect(expectedResult).toContain('value="#summary"');
  expect(expectedResult).toContain('value="#outer-container"');
  expect(expectedResult).toContain('value="#nested-note"');
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
