import { beforeEach, expect, test } from 'vitest';

import { actionRegistry } from '../src/bind/actions/registry';
import { createEmptyBlock, createEmptySection } from '../src/document-factory';
import { renderAddComponentPicker } from '../src/editor/component-picker';
import { createEditorRenderer } from '../src/editor/render';
import { createReaderRenderer } from '../src/reader/render';
import { createDefaultSearchState } from '../src/search/state';
import type { ComponentRenderHelpers } from '../src/editor/component-helpers';
import type { VisualSection } from '../src/editor/types';
import { isPdfAllowedComponent, isPdfAllowedComponentInstance } from '../src/pdf-document-capabilities';
import { setHostPlugins } from '../src/plugins/registry';
import { state } from '../src/state';
import type { VisualDocument } from '../src/types';
import { escapeHtml } from '../src/utils';
import { registerSerializationTestState } from './serialization-test-helpers';

registerSerializationTestState();

beforeEach(() => {
  setHostPlugins([]);
});

function createSection(id: string, location: 'main' | 'sidebar' = 'main'): VisualSection {
  const section = createEmptySection(1, '');
  section.key = `section-${id}`;
  section.customId = id;
  section.title = id;
  section.location = location;
  return section;
}

function createPdfDocument(sections: VisualSection[] = [createSection('summary')]): VisualDocument {
  return {
    meta: {
      hvy_version: 0.1,
      component_defs: [
        { name: 'pdf-card', baseType: 'container' },
        { name: 'interactive-card', baseType: 'expandable' },
      ],
    },
    extension: '.phvy',
    attachments: [],
    sections,
  };
}

test('PHVY component picker disables non-PDF components and disallowed custom templates', () => {
  const document = createPdfDocument();
  const html = renderAddComponentPicker(
    {
      id: 'section:summary',
      action: 'add-block',
      sectionKey: 'section-summary',
      componentFilter: (componentName) => isPdfAllowedComponent(componentName, document.meta),
      componentDisabledReason: (componentName) => isPdfAllowedComponent(componentName, document.meta) ? null : 'Not supported in PHVY',
    },
    {
      escapeAttr: escapeHtml,
      escapeHtml,
      getComponentDefs: () => document.meta.component_defs as never,
    }
  );

  expect(html).toContain('data-component="text"');
  expect(html).toContain('data-component="image"');
  expect(html).toContain('data-component="container"');
  expect(html).toContain('data-component="component-list"');
  expect(html).toContain('data-component="grid"');
  expect(html).toContain('data-component="pdf-card"');
  expect(html).toContain('data-component="carousel"');
  expect(html).toContain('data-component="plugin"');
  expect(html).toContain('data-component="xref-card"');
  expect(html).toContain('data-component="interactive-card"');
  expect(html).toContain('data-component-picker-disabled="true"');
  expect(html).toContain('No plugins installed - Not supported in PHVY');
  expect(html).toContain('component templates - Not supported in PHVY');
  const pluginButton = html.match(/<button(?:(?!<button)[\s\S])*data-component="plugin"(?:(?!<button)[\s\S])*?>/)?.[0] ?? '';
  expect(pluginButton).toContain('disabled');
  expect(pluginButton).not.toContain('data-action="add-block"');
});

test('PHVY component picker enables plugins with PDF static render capability', () => {
  const document = createPdfDocument();
  setHostPlugins([{
    id: 'fake.qr',
    displayName: 'QR',
    create: () => ({ element: globalThis.document.createElement('div') }),
    pdf: {
      renderStatic: () => [],
    },
  }]);

  const html = renderAddComponentPicker(
    {
      id: 'section:summary',
      action: 'add-block',
      sectionKey: 'section-summary',
      componentFilter: (componentName, pluginId) => isPdfAllowedComponentInstance(componentName, document.meta, pluginId),
      componentDisabledReason: (componentName, pluginId) =>
        isPdfAllowedComponentInstance(componentName, document.meta, pluginId) ? null : 'Not supported in PHVY',
    },
    {
      escapeAttr: escapeHtml,
      escapeHtml,
      getComponentDefs: () => document.meta.component_defs as never,
    }
  );

  const pluginButton = html.match(/<button(?:(?!<button)[\s\S])*data-plugin-id="fake.qr"(?:(?!<button)[\s\S])*?>/)?.[0] ?? '';
  expect(pluginButton).toContain('data-action="add-block"');
  expect(pluginButton).not.toContain('disabled');
});

test('PHVY editor rendering omits sidebar editor affordances', () => {
  const main = createSection('summary');
  const sidebar = createSection('notes', 'sidebar');
  const renderer = createEditorRenderer({
    documentExtension: '.phvy',
    documentMeta: {},
    documentSections: [main, sidebar],
    showAdvancedEditor: false,
    addComponentBySection: {},
    activeEditorBlock: null,
    aiEditorHostBlock: null,
    aiEditorHostSectionKey: null,
    componentPlacement: null,
    pendingEditorActivation: null,
    expandableEditorPanels: {},
    readerExpandableState: {},
    editorSidebarHelpDismissed: false,
    currentView: 'editor',
    responsivePreview: 'full',
    mobileAdjustmentMode: false,
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
    isDefaultUntitledSectionTitle: (title) => title === 'Untitled',
    formatSectionTitle: (title) => title,
    findSectionByKey: (sections, key) => sections.find((section) => section.key === key) ?? null,
    buildSectionRenderSequence: () => [],
    getComponentDefs: () => [],
    getSectionDefs: () => [],
    getThemeConfig: () => ({ colors: {} }),
    getComponentRenderHelpers: () => ({} as ComponentRenderHelpers),
    isBuiltinComponent: () => true,
  });

  expect(renderer.renderSidebarEditorSections([main, sidebar])).toBe('');
  expect(renderer.renderSidebarHelpBalloon([main, sidebar])).toBe('');
  expect(renderer.renderSectionEditorTree([main])).not.toContain('toggle-section-location');
});

test('PHVY reader rendering omits sidebar surface affordances', () => {
  const main = createSection('summary');
  const sidebar = createSection('notes', 'sidebar');
  const renderer = createReaderRenderer({
    documentExtension: '.phvy',
    documentMeta: {},
    documentSections: [main, sidebar],
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
    themeModalMode: 'full',
    paletteOverrideId: null,
    theme: { colors: {} },
    currentView: 'viewer',
    showAdvancedEditor: false,
    responsivePreview: 'full',
    readerExpandableState: {},
    readerContainerState: {},
    readerView: {},
    readerViewActivatedTargets: new Set<string>(),
    search: createDefaultSearchState(),
    componentListReaderViews: {},
    viewerSidebarHelpDismissed: false,
  }, {
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
    getComponentRenderHelpers: () => ({} as ComponentRenderHelpers),
    renderEditorBlock: () => '',
    renderBlockContentEditor: () => '',
    renderComponentOptions: () => '',
    renderReusableSectionOptions: () => '',
    getSectionDefs: () => [],
    renderBlockMetaFields: () => '',
  });

  expect(renderer.renderSidebarSections([main, sidebar])).toBe('');
  expect(renderer.renderSidebarHelpBalloon([main, sidebar])).toBe('');
});

test('PHVY AI reader rendering omits sidebar add ghost', () => {
  const sidebar = createSection('notes', 'sidebar');
  const renderer = createReaderRenderer({
    documentExtension: '.phvy',
    documentMeta: {},
    documentSections: [sidebar],
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
    themeModalMode: 'full',
    paletteOverrideId: null,
    theme: { colors: {} },
    currentView: 'ai',
    showAdvancedEditor: false,
    responsivePreview: 'full',
    readerExpandableState: {},
    readerContainerState: {},
    readerView: {},
    readerViewActivatedTargets: new Set<string>(),
    search: createDefaultSearchState(),
    componentListReaderViews: {},
    viewerSidebarHelpDismissed: false,
  }, {
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
    getComponentRenderHelpers: () => ({} as ComponentRenderHelpers),
    renderEditorBlock: () => '',
    renderBlockContentEditor: () => '',
    renderComponentOptions: () => '',
    renderReusableSectionOptions: () => '<option value="blank">Blank</option>',
    getSectionDefs: () => [{}],
    renderBlockMetaFields: () => '',
  });

  expect(renderer.renderSidebarSections([sidebar])).not.toContain('Add Section');
});

test('PHVY add-block action rejects forged disallowed components and allows PDF components', () => {
  const section = createSection('summary');
  state.document = createPdfDocument([section]);
  state.history = [];
  const disallowedButton = {
    dataset: { component: 'expandable' },
  } as unknown as HTMLElement;

  actionRegistry['add-block']?.({
    app: {} as HTMLElement,
    actionButton: disallowedButton,
    sectionKey: section.key,
    blockId: '',
    section,
    reusableName: null,
  });

  expect(section.blocks).toHaveLength(0);

  const allowedButton = {
    dataset: { component: 'text' },
  } as unknown as HTMLElement;
  actionRegistry['add-block']?.({
    app: {} as HTMLElement,
    actionButton: allowedButton,
    sectionKey: section.key,
    blockId: '',
    section,
    reusableName: null,
  });

  expect(section.blocks.map((block) => block.schema.component)).toEqual(['text']);
});

test('PHVY grid add action rejects forged disallowed components and allows PDF components', () => {
  const section = createSection('summary');
  const grid = createEmptyBlock('grid');
  grid.id = 'grid-block';
  section.blocks = [grid];
  state.document = createPdfDocument([section]);
  state.gridAddComponentByBlock = {};

  const disallowedButton = {
    dataset: { component: 'plugin', sectionKey: section.key, blockId: grid.id },
  } as unknown as HTMLElement;
  actionRegistry['add-grid-item']?.({
    app: {} as HTMLElement,
    actionButton: disallowedButton,
    sectionKey: section.key,
    blockId: grid.id,
    section,
    reusableName: null,
  });

  expect(grid.schema.gridItems).toHaveLength(0);

  const allowedButton = {
    dataset: { component: 'image', sectionKey: section.key, blockId: grid.id },
  } as unknown as HTMLElement;
  actionRegistry['add-grid-item']?.({
    app: {} as HTMLElement,
    actionButton: allowedButton,
    sectionKey: section.key,
    blockId: grid.id,
    section,
    reusableName: null,
  });

  expect(grid.schema.gridItems.map((item) => item.block.schema.component)).toEqual(['image']);
});

test('PHVY component-list add actions allow PDF components and expandable add actions are blocked defensively', () => {
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  }) as typeof requestAnimationFrame;
  globalThis.document = { querySelector: () => null } as unknown as Document;
  globalThis.CSS = { escape: (value: string) => value } as unknown as typeof CSS;
  const section = createSection('summary');
  const list = createEmptyBlock('component-list');
  list.id = 'list-block';
  const expandable = createEmptyBlock('expandable');
  expandable.id = 'expandable-block';
  section.blocks = [list, expandable];
  state.document = createPdfDocument([section]);

  const forgedButton = {
    dataset: { component: 'text', sectionKey: section.key },
    closest: () => null,
  } as unknown as HTMLElement;

  actionRegistry['add-component-list-item']?.({
    app: {} as HTMLElement,
    actionButton: forgedButton,
    sectionKey: section.key,
    blockId: list.id,
    section,
    reusableName: null,
  });
  actionRegistry['add-expandable-stub-block']?.({
    app: {} as HTMLElement,
    actionButton: forgedButton,
    sectionKey: section.key,
    blockId: expandable.id,
    section,
    reusableName: null,
  });
  actionRegistry['add-expandable-content-block']?.({
    app: {} as HTMLElement,
    actionButton: forgedButton,
    sectionKey: section.key,
    blockId: expandable.id,
    section,
    reusableName: null,
  });

  expect(list.schema.componentListBlocks.map((block) => block.schema.component)).toEqual(['text']);
  expect(expandable.schema.expandableStubBlocks.children).toHaveLength(0);
  expect(expandable.schema.expandableContentBlocks.children).toHaveLength(0);
});
