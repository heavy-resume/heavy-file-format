import { expect, test } from 'vitest';

import { actionRegistry } from '../src/bind/actions/registry';
import { createEmptyBlock, createEmptySection } from '../src/document-factory';
import { renderAddComponentPicker } from '../src/editor/component-picker';
import { createEditorRenderer } from '../src/editor/render';
import type { ComponentRenderHelpers } from '../src/editor/component-helpers';
import type { VisualSection } from '../src/editor/types';
import { isPdfAllowedComponent } from '../src/pdf-document-capabilities';
import { state } from '../src/state';
import type { VisualDocument } from '../src/types';
import { escapeHtml } from '../src/utils';
import { registerSerializationTestState } from './serialization-test-helpers';

registerSerializationTestState();

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

test('PHVY component picker hides non-PDF components and disallowed custom templates', () => {
  const document = createPdfDocument();
  const html = renderAddComponentPicker(
    {
      id: 'section:summary',
      action: 'add-block',
      sectionKey: 'section-summary',
      componentFilter: (componentName) => isPdfAllowedComponent(componentName, document.meta),
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
  expect(html).toContain('data-component="grid"');
  expect(html).toContain('data-component="pdf-card"');
  expect(html).not.toContain('data-component="carousel"');
  expect(html).not.toContain('data-component="plugin"');
  expect(html).not.toContain('data-component="xref-card"');
  expect(html).not.toContain('data-component="interactive-card"');
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

test('PHVY component-list and expandable add actions are blocked defensively', () => {
  const section = createSection('summary');
  const list = createEmptyBlock('component-list');
  list.id = 'list-block';
  const expandable = createEmptyBlock('expandable');
  expandable.id = 'expandable-block';
  section.blocks = [list, expandable];
  state.document = createPdfDocument([section]);

  const forgedButton = {
    dataset: { component: 'text', sectionKey: section.key },
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

  expect(list.schema.componentListBlocks).toHaveLength(0);
  expect(expandable.schema.expandableStubBlocks.children).toHaveLength(0);
  expect(expandable.schema.expandableContentBlocks.children).toHaveLength(0);
});
