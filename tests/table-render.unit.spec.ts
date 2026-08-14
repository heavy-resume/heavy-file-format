import { expect, test } from 'vitest';

import { renderTableEditor, renderTableReader, resetReaderTableStripeSequence } from '../src/editor/components/table/table';
import type { ComponentRenderHelpers } from '../src/editor/component-helpers';
import type { VisualBlock, VisualSection } from '../src/editor/types';
import { defaultBlockSchema } from '../src/document-factory';

function createTableBlock(rows: string[][], options?: { showHeader?: boolean }): VisualBlock {
  return {
    id: `table-${Math.random().toString(36).slice(2)}`,
    text: '',
    schemaMode: false,
    schema: {
      ...defaultBlockSchema('table'),
      slot: 'left',
      css: '',
      tableColumns: ['Role', 'Scope'],
      tableShowHeader: options?.showHeader ?? false,
      tableRows: rows.map((cells) => ({
        cells,
      })),
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
    renderReaderBlocks: () => '',
    renderReaderListBlocks: () => '',
    orderReaderBlocks: (blocks) => blocks,
    orderReaderListBlocks: (blocks) => blocks,
    isReaderViewPrioritizedBlock: () => false,
    renderTextFragment: (content) => content,
    renderComponentFragment: (_componentName, content) => content,
    renderComponentOptions: () => '',
    renderAddComponentPicker: () => '',
    renderComponentPlacementTarget: () => '',
    renderOption: (value) => value,
    getDocumentComponentCss: () => '',
    getXrefTargetOptions: () => [],
    isXrefTargetValid: () => true,
    getTableColumns: () => ['Role', 'Scope'],
    ensureContainerBlocks: () => {},
    ensureComponentListBlocks: () => {},
    getSelectedAddComponent: (_key, fallback) => fallback,
    getComponentListReaderViewId: () => '',
    getReaderContainerExpanded: (_key, fallback) => fallback,
    isExpandableEditorPanelOpen: () => false,
    isAdvancedEditorMode: () => false,
    isMobileAdjustmentMode: () => false,
  };
}

const section: VisualSection = {
  key: 'section',
  customId: '',
  contained: true,
  editorOnly: false,
  lock: false,
  idEditorOpen: false,
  isGhost: false,
  title: 'Section',
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

test('table editor renders inline cell content without paragraph wrappers', () => {
  const helpers = createHelpers();
  const html = renderTableEditor(
    section.key,
    createTableBlock([['Staff Engineer', '<!--hvy:alt {"compact":"Tech"}-->Technologies<!--/hvy:alt-->']]),
    {
      ...helpers,
      markdownToEditorHtml: (markdown) => `<p>${markdown}</p>\n`,
    }
  );

  expect(html).not.toContain('<p>');
  expect(html).not.toContain('</p>');
  expect(html).toContain('Staff Engineer');
  expect(html).toContain('<!--hvy:alt {"compact":"Tech"}-->Technologies<!--/hvy:alt-->');
});

test('reader table renders inline cell content without paragraph wrappers', () => {
  const helpers = {
    ...createHelpers(),
    renderTextFragment: (content: string) => `<p>${content}</p>\n`,
    renderComponentFragment: (_componentName: string, content: string) => `<p>${content}</p>\n`,
  };
  const html = renderTableReader(section, createTableBlock([['Staff Engineer', 'Platform']]), helpers);

  expect(html).not.toContain('<p>');
  expect(html).not.toContain('</p>');
  expect(html).toContain('title="Staff Engineer">Staff Engineer</td>');
  expect(html).toContain('title="Platform">Platform</td>');
});

test('table column presentation renders through colgroups and cell classes', () => {
  const helpers = createHelpers();
  const block = createTableBlock([['Staff Engineer', 'Platform']], { showHeader: true });
  block.schema.tableColumnProperties = {
    Role: { width: '12rem', wrap: true, truncate: false, align: 'right', headerAlign: 'left' },
  };

  const readerHtml = renderTableReader(section, block, helpers);
  const editorHtml = renderTableEditor(section.key, block, helpers);

  expect(readerHtml).toContain('<col data-table-column-index="0" data-table-column-name="Role" style="width: 12rem;">');
  expect(readerHtml).toContain('table-column-header-align-left');
  expect(readerHtml).toContain('table-column-align-right');
  expect(readerHtml).toContain('table-column-no-truncate');
  expect(editorHtml).toContain('data-field="table-column-width"');
  expect(editorHtml).toContain('data-field="table-column-truncate"');
  expect(editorHtml).toContain('value="12rem"');
  expect(editorHtml).toContain('table-column-resize-handle');
  const firstHeaderStart = editorHtml.indexOf('<div class="table-column-head">');
  const firstHeader = editorHtml.slice(firstHeaderStart, editorHtml.indexOf('</th>', firstHeaderStart));
  expect(firstHeader.indexOf('<details class="table-column-settings">')).toBeLessThan(firstHeader.indexOf('class="inline-editable table-inline-text table-column-name"'));
  expect(firstHeader.indexOf('class="inline-editable table-inline-text table-column-name"')).toBeLessThan(firstHeader.indexOf('data-action="remove-table-column"'));
});

test('reader table header title uses alt full text instead of raw annotation', () => {
  const helpers = {
    ...createHelpers(),
    getTableColumns: (schema: VisualBlock['schema']) => schema.tableColumns,
  };
  const block = createTableBlock([], { showHeader: true });
  block.schema.tableColumns = ['YEAR', '<!--hvy:alt {"compact":"ORG"}-->ORGANIZATION<!--/hvy:alt-->', 'TITLE'];

  const html = renderTableReader(section, block, helpers);

  expect(html).toContain('title="ORGANIZATION"');
  expect(html).not.toContain('title="<!--hvy:alt');
});

test('table editor cell placeholders carry full and compact alt text', () => {
  const helpers = {
    ...createHelpers(),
    getTableColumns: (schema: VisualBlock['schema']) => schema.tableColumns,
  };
  const block = createTableBlock([['', '', '']]);
  block.schema.tableColumns = ['YEAR', '<!--hvy:alt {"compact":"ORG"}-->ORGANIZATION<!--/hvy:alt-->', 'TITLE'];

  const html = renderTableEditor(section.key, block, helpers);

  expect(html).toContain('data-placeholder="ORGANIZATION"');
  expect(html).toContain('data-placeholder-compact="ORG"');
  expect(html).not.toContain('data-placeholder="<!--hvy:alt');
});

test('reader table placeholders are available only for wholly empty rows', () => {
  const helpers = {
    ...createHelpers(),
    getTableColumns: (schema: VisualBlock['schema']) => schema.tableColumns,
  };
  const block = createTableBlock([['2026', '', 'Open'], ['', '', '']]);
  block.schema.tableColumns = ['YEAR', '<!--hvy:alt {"compact":"ORG"}-->ORGANIZATION<!--/hvy:alt-->', 'TITLE'];

  const html = renderTableReader(section, block, helpers);

  expect(html).toContain('data-table-column-index="1"></td>');
  expect(html).toContain('table-main-row-empty');
  expect(html).toContain('data-placeholder="ORGANIZATION"');
  expect(html).toContain('data-placeholder-compact="ORG"');
  expect(html).not.toContain('data-placeholder="<!--hvy:alt');
});
