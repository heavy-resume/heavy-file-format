import { expect, test } from 'vitest';

import { createEditorRenderer } from '../src/editor/render';
import { defaultBlockSchema } from '../src/document-factory';
import type { ComponentRenderHelpers, ReaderBlockRenderOptions } from '../src/editor/component-helpers';
import type { VisualBlock, VisualSection } from '../src/editor/types';

function createSection(blocks: VisualBlock[]): VisualSection {
  return {
    key: 'section-tools',
    customId: 'tools',
    contained: true,
    editorOnly: false,
    lock: false,
    idEditorOpen: false,
    isGhost: false,
    title: 'Tools',
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

test('passive editor fallback renders plain reader content without re-entering AI editor delegation', () => {
  const block = {
    id: 'block-tool',
    text: 'TypeScript',
    schemaMode: false,
    schema: {
      ...defaultBlockSchema('tool-tech-record'),
      id: 'tool-typescript',
    },
  } satisfies VisualBlock;
  const section = createSection([block]);
  let expectedOptions: ReaderBlockRenderOptions | undefined;
  const helpers = {} as ComponentRenderHelpers;
  const renderer = createEditorRenderer({
    documentExtension: '.hvy',
    documentMeta: {},
    documentSections: [section],
    showAdvancedEditor: false,
    addComponentBySection: {},
    activeEditorBlock: null,
    aiEditorHostBlock: null,
    aiEditorHostSectionKey: null,
    componentPlacement: null,
    pendingEditorActivation: null,
    expandableEditorPanels: {},
    readerExpandableState: {},
    editorSidebarHelpDismissed: true,
    currentView: 'ai',
    responsivePreview: 'full',
    mobileAdjustmentMode: false,
    openTemplateDefinitionKeys: [],
    openTextLineStyleName: null,
    paragraphStyleRecentNames: [],
  }, {
    escapeAttr: escapeHtml,
    escapeHtml,
    flattenSections: (sections) => sections,
    renderReaderBlock: (_section, _block, options) => {
      expectedOptions = options;
      return '<article>Plain reader card</article>';
    },
    renderReusableSectionOptions: () => '',
    renderOption: () => '',
    resolveBaseComponent: (componentName) => componentName,
    ensureContainerBlocks: () => {},
    ensureComponentListBlocks: () => {},
    ensureExpandableBlocks: () => {},
    ensureGridItems: () => {},
    isActiveEditorSectionTitle: () => false,
    isActiveEditorBlock: () => false,
    isDefaultUntitledSectionTitle: () => false,
    formatSectionTitle: (title) => title,
    findSectionByKey: () => section,
    buildSectionRenderSequence: (targetSection) => targetSection.blocks.map((targetBlock) => ({ kind: 'block' as const, block: targetBlock })),
    getComponentDefs: () => [],
    getSectionDefs: () => [],
    getThemeConfig: () => ({ colors: {} }),
    getComponentRenderHelpers: () => helpers,
    isBuiltinComponent: () => false,
  });

  const expectedResult = renderer.renderPassiveEditorBlock(section.key, block, [section]);

  expect(expectedResult).toContain('Plain reader card');
  expect(expectedOptions).toEqual({ suppressAiEditorDelegation: true });
});

test('block meta fields include grid stack width for grid components', () => {
  const block = {
    id: 'block-grid',
    text: '',
    schemaMode: false,
    schema: {
      ...defaultBlockSchema('grid'),
      id: 'layout-grid',
      gridStackWidth: '30rem',
    },
  } satisfies VisualBlock;
  const section = createSection([block]);
  const helpers = {} as ComponentRenderHelpers;
  const renderer = createEditorRenderer({
    documentExtension: '.hvy',
    documentMeta: {},
    documentSections: [section],
    showAdvancedEditor: false,
    addComponentBySection: {},
    activeEditorBlock: null,
    aiEditorHostBlock: null,
    aiEditorHostSectionKey: null,
    componentPlacement: null,
    pendingEditorActivation: null,
    expandableEditorPanels: {},
    readerExpandableState: {},
    editorSidebarHelpDismissed: true,
    currentView: 'editor',
    responsivePreview: 'full',
    mobileAdjustmentMode: false,
    openTemplateDefinitionKeys: [],
    openTextLineStyleName: null,
    paragraphStyleRecentNames: [],
  }, {
    escapeAttr: escapeHtml,
    escapeHtml,
    flattenSections: (sections) => sections,
    renderReaderBlock: () => '',
    renderReusableSectionOptions: () => '',
    renderOption: () => '',
    resolveBaseComponent: (componentName) => componentName,
    ensureContainerBlocks: () => {},
    ensureComponentListBlocks: () => {},
    ensureExpandableBlocks: () => {},
    ensureGridItems: () => {},
    isActiveEditorSectionTitle: () => false,
    isActiveEditorBlock: () => false,
    isDefaultUntitledSectionTitle: () => false,
    formatSectionTitle: (title) => title,
    findSectionByKey: () => section,
    buildSectionRenderSequence: (targetSection) => targetSection.blocks.map((targetBlock) => ({ kind: 'block' as const, block: targetBlock })),
    getComponentDefs: () => [],
    getSectionDefs: () => [],
    getThemeConfig: () => ({ colors: {} }),
    getComponentRenderHelpers: () => helpers,
    isBuiltinComponent: () => false,
  });

  const expectedResult = renderer.renderBlockMetaFields(section.key, block);

  expect(expectedResult).toContain('Stack Width');
  expect(expectedResult).toContain('data-field="block-grid-stack-width"');
  expect(expectedResult).toContain('value="30rem"');
  expect(expectedResult).toContain('<span>Never</span>');
  expect(expectedResult).not.toContain('Never Stack');
});

test('block meta fields render hidden marker as a checkbox', () => {
  const block = {
    id: 'block-detail',
    text: '',
    schemaMode: false,
    schema: {
      ...defaultBlockSchema('text'),
      id: 'optional-detail',
      hideIfYes: 'yes',
    },
  } satisfies VisualBlock;
  const section = createSection([block]);
  const helpers = {} as ComponentRenderHelpers;
  const renderer = createEditorRenderer({
    documentExtension: '.hvy',
    documentMeta: {},
    documentSections: [section],
    showAdvancedEditor: false,
    addComponentBySection: {},
    activeEditorBlock: null,
    aiEditorHostBlock: null,
    aiEditorHostSectionKey: null,
    componentPlacement: null,
    pendingEditorActivation: null,
    expandableEditorPanels: {},
    readerExpandableState: {},
    editorSidebarHelpDismissed: true,
    currentView: 'editor',
    responsivePreview: 'full',
    mobileAdjustmentMode: false,
    openTemplateDefinitionKeys: [],
    openTextLineStyleName: null,
    paragraphStyleRecentNames: [],
  }, {
    escapeAttr: escapeHtml,
    escapeHtml,
    flattenSections: (sections) => sections,
    renderReaderBlock: () => '',
    renderReusableSectionOptions: () => '',
    renderOption: () => '',
    resolveBaseComponent: (componentName) => componentName,
    ensureContainerBlocks: () => {},
    ensureComponentListBlocks: () => {},
    ensureExpandableBlocks: () => {},
    ensureGridItems: () => {},
    isActiveEditorSectionTitle: () => false,
    isActiveEditorBlock: () => false,
    isDefaultUntitledSectionTitle: () => false,
    formatSectionTitle: (title) => title,
    findSectionByKey: () => section,
    buildSectionRenderSequence: (targetSection) => targetSection.blocks.map((targetBlock) => ({ kind: 'block' as const, block: targetBlock })),
    getComponentDefs: () => [],
    getSectionDefs: () => [],
    getThemeConfig: () => ({ colors: {} }),
    getComponentRenderHelpers: () => helpers,
    isBuiltinComponent: () => false,
  });

  const expectedResult = renderer.renderBlockMetaFields(section.key, block);

  expect(expectedResult).toContain('<span>Hidden</span>');
  expect(expectedResult).toContain('data-field="block-hide-if-yes"');
  expect(expectedResult).toContain('type="checkbox"');
  expect(expectedResult).toContain('checked');
  expect(expectedResult).not.toContain('Hide If Yes');
  expect(expectedResult).not.toContain('placeholder="yes"');
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
