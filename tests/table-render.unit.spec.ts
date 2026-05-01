import { expect, test } from 'vitest';

import { renderTableReader, resetReaderTableStripeSequence } from '../src/editor/components/table/table';
import type { ComponentRenderHelpers } from '../src/editor/component-helpers';
import type { VisualBlock, VisualSection } from '../src/editor/types';

function createTableBlock(rows: string[][], options?: { showHeader?: boolean }): VisualBlock {
  return {
    id: `table-${Math.random().toString(36).slice(2)}`,
    text: '',
    schemaMode: false,
    schema: {
      id: '',
      component: 'table',
      lock: false,
      align: 'left',
      slot: 'left',
      customCss: '',
      codeLanguage: '',
      containerBlocks: [],
      componentListComponent: 'text',
      componentListItemLabel: '',
      componentListBlocks: [],
      gridColumns: 2,
      gridItems: [],
      tags: '',
      description: '',
      placeholder: '',
      metaOpen: false,
      xrefTitle: '',
      xrefDetail: '',
      xrefTarget: '',
      plugin: '',
      pluginConfig: {},
      expandableStubComponent: 'container',
      expandableContentComponent: 'container',
      expandableStub: '',
      expandableStubCss: '',
      expandableStubBlocks: { lock: false, children: [] },
      expandableAlwaysShowStub: true,
      expandableExpanded: false,
      expandableContentCss: '',
      expandableContentBlocks: { lock: false, children: [] },
      tableColumns: 'Role, Scope',
      tableShowHeader: options?.showHeader ?? false,
      tableRows: rows.map((cells) => ({
        cells,
      })),
      imageFile: '',
      imageAlt: '',
    },
  };
}

function createHelpers(): ComponentRenderHelpers {
  return {
    escapeAttr: (value) => value,
    escapeHtml: (value) => value,
    markdownToEditorHtml: (markdown) => markdown,
    renderRichToolbar: () => '',
    renderEditorBlock: () => '',
    renderPassiveEditorBlock: () => '',
    renderReaderBlock: () => '',
    renderComponentFragment: (_componentName, content) => content,
    renderComponentOptions: () => '',
    renderAddComponentPicker: () => '',
    renderOption: (value) => value,
    getDocumentComponentCss: () => '',
    getXrefTargetOptions: () => [],
    isXrefTargetValid: () => true,
    getTableColumns: () => ['Role', 'Scope'],
    ensureContainerBlocks: () => {},
    ensureComponentListBlocks: () => {},
    getSelectedAddComponent: (_key, fallback) => fallback,
    isExpandableEditorPanelOpen: () => false,
  };
}

const section: VisualSection = {
  key: 'section',
  customId: '',
  contained: true,
  lock: false,
  idEditorOpen: false,
  isGhost: false,
  title: 'Section',
  level: 1,
  expanded: true,
  highlight: false,
  customCss: '',
  tags: '',
  description: '',
  location: 'main',
  blocks: [],
  children: [],
};

test('reader table striping continues across headerless continuation tables and resets at the next header', () => {
  resetReaderTableStripeSequence();
  const helpers = createHelpers();

  const headerTable = renderTableReader(section, createTableBlock([['Lead', 'Platform']], { showHeader: true }), helpers);
  const continuedTable = renderTableReader(
    section,
    createTableBlock(
      [
        ['Senior Engineer', 'Systems'],
        ['Engineer', 'Frontend'],
      ],
      { showHeader: false }
    ),
    helpers
  );
  const restartedTable = renderTableReader(section, createTableBlock([['Manager', 'Ops']], { showHeader: true }), helpers);

  expect(headerTable).toContain('table-main-row-even');
  expect(continuedTable).toContain('table-main-row-odd');
  expect(continuedTable).toContain('table-main-row-even');
  expect(continuedTable.indexOf('table-main-row-odd')).toBeLessThan(continuedTable.indexOf('table-main-row-even'));
  expect(restartedTable).toContain('table-main-row-even');
  expect(restartedTable).not.toContain('table-main-row-odd');
});
