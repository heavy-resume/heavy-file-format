import { describe, expect, test, vi } from 'vitest';

import { createEmptyBlock } from '../src/document-factory';
import type { VisualBlock, VisualSection } from '../src/editor/types';
import type { VisualDocument } from '../src/types';
import { buildPdfExportDocDefinition } from '../src/pdf-export/doc-definition';
import { getHvyPdfBlob, preparePdfExport } from '../src/pdf-export/export';
import { createPdfExportRuleRecorder, resolvePdfExportStrategy } from '../src/pdf-export/strategy';

vi.mock('pdfmake/build/pdfmake.js', () => ({
  default: {
    createPdf: vi.fn((definition) => ({
      getBlob: (callback: (blob: Blob) => void) => {
        callback(new Blob([JSON.stringify(definition)], { type: 'application/pdf' }));
      },
    })),
  },
}));

vi.mock('pdfmake/build/vfs_fonts.js', () => ({
  default: {
    vfs: {
      'Roboto-Regular.ttf': 'font-bytes',
      'Roboto-Medium.ttf': 'font-bytes',
      'Roboto-Italic.ttf': 'font-bytes',
      'Roboto-MediumItalic.ttf': 'font-bytes',
    },
  },
}));

vi.mock('../src/plugins/scripting/wrapper', () => ({
  runUserScript: vi.fn(async (options) => {
    options.document.sections[0].blocks[0].text = 'Export clone text';
    options.exportRuleRecorder.hide('#hidden-by-prep');
    options.exportRuleRecorder.strategy({ componentTag: 'prep-keep', keepTogether: true });
    return { ok: true, stepsExecuted: 1, stepBudget: 100_000, linesExecuted: 1, toolCalls: 0 };
  }),
}));

function createTextBlock(id: string, text: string, tags = ''): VisualBlock {
  const block = createEmptyBlock('text');
  block.id = `block-${id}`;
  block.schema.id = id;
  block.schema.tags = tags;
  block.text = text;
  return block;
}

function createExpandableBlock(id: string): VisualBlock {
  const block = createEmptyBlock('expandable');
  block.id = `block-${id}`;
  block.schema.id = id;
  block.schema.expandableStub = 'Short version';
  block.schema.expandableExpanded = false;
  block.schema.expandableStubBlocks.children = [createTextBlock(`${id}-stub`, 'Stub child')];
  block.schema.expandableContentBlocks.children = [createTextBlock(`${id}-content`, 'Expanded child')];
  return block;
}

function createSection(id: string, blocks: VisualBlock[], tags = ''): VisualSection {
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
    tags,
    description: '',
    location: 'main',
    hideIfUnmodified: false,
    blocks,
    children: [],
  };
}

function createDocument(): VisualDocument {
  return {
    meta: {},
    extension: '.hvy',
    attachments: [],
    sections: [
      createSection('summary', [createTextBlock('intro', 'Intro text', 'lead prep-keep')], 'resume-primary'),
      createSection('details', [createTextBlock('skip', 'Hidden text')]),
      createSection('extras', [createExpandableBlock('expandable')]),
    ],
  };
}

describe('PDF export strategy', () => {
  test('resolves targets by ID, path, component, and tag with deterministic precedence', () => {
    const document = createDocument();
    const expectedResult = resolvePdfExportStrategy(document, {
      rules: [
        { id: 'intro', hide: true },
        { id: 'intro', include: true, keepTogether: true },
        { path: '/id/summary/intro', pdfStyle: { fontSize: 9 } },
        { component: 'text', dim: true },
        { tag: 'lead', highlight: true },
        { sectionTag: 'resume-primary', asHeading: true },
        { predicate: (target) => target.kind === 'component' && target.id === 'skip', asMetadata: true },
      ],
    });

    expect(expectedResult.getBlockDecision('block-intro')).toMatchObject({
      visibility: 'highlight',
      keepTogether: true,
      pdfStyle: { fontSize: 9 },
    });
    expect(expectedResult.getSectionDecision('section-summary').role).toBe('heading');
    expect(expectedResult.getBlockDecision('block-skip').visibility).toBe('dim');
    expect(expectedResult.getBlockDecision('block-skip').role).toBe('metadata');
  });

  test('layers PDF rules after content view rules', () => {
    const document = createDocument();
    const expectedResult = resolvePdfExportStrategy(
      document,
      { rules: [{ id: 'intro', include: true }] },
      { intro: ['hidden'] }
    );

    expect(expectedResult.getBlockDecision('block-intro').visibility).toBe('include');
  });

  test('keeps hide sticky unless a later include explicitly restores the item', () => {
    const document = createDocument();
    const expectedResult = resolvePdfExportStrategy(document, {
      rules: [
        { id: 'intro', hide: true },
        { id: 'intro', highlight: true },
        { id: 'skip', hide: true },
        { id: 'skip', include: true },
      ],
    });

    expect(expectedResult.getBlockDecision('block-intro').visibility).toBe('hide');
    expect(expectedResult.getBlockDecision('block-skip').visibility).toBe('include');
  });

  test('prep script mutates only the export clone and adds runtime strategy rules', async () => {
    const document = createDocument();
    const before = document.sections[0].blocks[0].text;
    const expectedResult = await preparePdfExport(document, {
      strategy: { prepScript: 'doc.component.set_text("intro", "Export clone text")' },
    });

    expect(document.sections[0].blocks[0].text).toBe(before);
    expect(expectedResult.exportDocument.sections[0].blocks[0].text).toBe('Export clone text');
    expect(expectedResult.strategy.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'hidden-by-prep', hide: true }),
        expect.objectContaining({ componentTag: 'prep-keep', keepTogether: true }),
      ])
    );
  });

  test('doc.export recorder supports script-friendly strategy calls', () => {
    const recorder = createPdfExportRuleRecorder();

    recorder.hide('#intro');
    recorder.include('resume-primary');
    recorder.expand('#expandable');
    recorder.keep_together('pdf-keep');
    recorder.style('#intro', { fontSize: 8 });
    recorder.strategy([{ id: 'intro', asMetadata: true }]);

    expect(recorder.getStrategy().rules).toEqual([
      { id: 'intro', hide: true },
      { tag: 'resume-primary', include: true },
      { id: 'expandable', expand: true },
      { tag: 'pdf-keep', keepTogether: true },
      { id: 'intro', pdfStyle: { fontSize: 8 } },
      { id: 'intro', asMetadata: true },
    ]);
  });

  test('emits orphan-heading metadata and page break hook', () => {
    const document = createDocument();
    const expectedResult = buildPdfExportDocDefinition(document);
    const firstNode = expectedResult.content[0];

    expect(JSON.stringify(firstNode)).toContain('"headlineLevel":1');
    expect(
      expectedResult.pageBreakBefore?.(
        { text: 'Heading', headlineLevel: 1 },
        {
          getFollowingNodesOnPage: () => [],
          getNodesOnNextPage: () => [{ text: 'Body' }],
          getPreviousNodesOnPage: () => [{ text: 'Previous' }],
        }
      )
    ).toBe(true);
  });

  test('normalizes fill-in and text line style markers before creating PDF text nodes', () => {
    const document = createDocument();
    document.sections[0].blocks[0].text = `
[<!-- value {"placeholder":"pronunciation"} -->]
<!-- value {"placeholder":"title"} -->
^detail-heading^ #### Highlights
^detail-body^ - Led teams and improved developer velocity.
^detail-body^ - Built services on cloud platforms.
`;
    const expectedResult = buildPdfExportDocDefinition(document);
    const serialized = JSON.stringify(expectedResult.content);

    expect(serialized).not.toContain('<!-- value');
    expect(serialized).not.toContain('^detail');
    expect(serialized).toContain('Highlights');
    expect(serialized).toContain('Led teams and improved developer velocity.');
    expect(serialized).toContain('detailHeading');
    expect(serialized).toContain('detailBody');
  });

  test('normalizes responsive alt annotations in PDF text and tables', () => {
    const document = createDocument();
    document.sections[0].blocks[0].text = '# Tools & <!--hvy:alt {"compact":"Tech"}-->Technologies<!--/hvy:alt-->';
    const table = createEmptyBlock('table');
    table.schema.id = 'history-table';
    table.schema.tableColumns = ['TITLE', '<!--hvy:alt {"compact":"ORG"}-->ORGANIZATION<!--/hvy:alt-->', 'DATES'];
    table.schema.tableRows = [{ cells: ['Senior Engineer', 'Northwind Labs', '2024'] }];
    document.sections[0].blocks.push(table);
    const expectedResult = buildPdfExportDocDefinition(document);
    const serialized = JSON.stringify(expectedResult.content);

    expect(serialized).not.toContain('hvy:alt');
    expect(serialized).not.toContain('compact');
    expect(serialized).toContain('Tools & Technologies');
    expect(serialized).toContain('ORGANIZATION');
  });

  test('exports right-aligned grid item text into the PDF definition', async () => {
    const document = createDocument();
    const grid = createEmptyBlock('grid');
    grid.schema.id = 'aligned-grid';
    grid.schema.gridColumns = 2;
    grid.schema.gridItems = [
      { id: 'left-grid-cell', block: createTextBlock('left-grid-text', 'Left cell') },
      { id: 'right-grid-cell', align: 'right', block: createTextBlock('right-grid-text', 'Right cell') },
    ];
    document.sections = [createSection('aligned-grid-section', [grid])];

    const expectedResult = await getHvyPdfBlob(document);
    const pdfDefinition = JSON.parse(await expectedResult.text());
    const gridNode = pdfDefinition.content[0].stack.find((node: { columns?: unknown[] }) => Array.isArray(node.columns));

    expect(gridNode.columns[0].stack[0]).toEqual(expect.objectContaining({ text: 'Left cell' }));
    expect(gridNode.columns[0].stack[0]).not.toHaveProperty('alignment');
    expect(gridNode.columns[1]).toEqual(expect.objectContaining({ alignment: 'right' }));
    expect(gridNode.columns[1].stack[0]).toEqual(expect.objectContaining({ text: 'Right cell', alignment: 'right' }));
  });

  test('exports right-aligned child text inside a grid into the PDF definition', async () => {
    const document = createDocument();
    const grid = createEmptyBlock('grid');
    const rightText = createTextBlock('right-grid-text', 'Right cell');
    rightText.schema.align = 'right';
    grid.schema.id = 'aligned-child-text-grid';
    grid.schema.gridColumns = 2;
    grid.schema.gridItems = [
      { id: 'left-grid-cell', block: createTextBlock('left-grid-text', 'Left cell') },
      { id: 'right-grid-cell', block: rightText },
    ];
    document.sections = [createSection('aligned-child-text-grid-section', [grid])];

    const expectedResult = await getHvyPdfBlob(document);
    const pdfDefinition = JSON.parse(await expectedResult.text());
    const gridNode = pdfDefinition.content[0].stack.find((node: { columns?: unknown[] }) => Array.isArray(node.columns));

    expect(gridNode.columns[1].stack[0]).toEqual(expect.objectContaining({ text: 'Right cell', alignment: 'right' }));
  });

  test('honors hidden targets and strategy-selected expandable pane', () => {
    const document = createDocument();
    const expectedResult = buildPdfExportDocDefinition(document, {
      strategy: {
        rules: [
          { id: 'skip', hide: true },
          { id: 'expandable', contentOnly: true },
        ],
      },
    });
    const serialized = JSON.stringify(expectedResult.content);

    expect(serialized).not.toContain('Hidden text');
    expect(serialized).toContain('Expanded child');
    expect(serialized).not.toContain('Stub child');
  });

  test('fails PDF export by default for unsupported components', async () => {
    const document = createDocument();
    const plugin = createEmptyBlock('plugin');
    plugin.schema.id = 'custom-plugin';
    plugin.schema.plugin = 'fake-plugin';
    document.sections[0].blocks.push(plugin);

    await expect(getHvyPdfBlob(document)).rejects.toThrow('PDF export cannot render component "fake-plugin"');
  });

  test('can opt into PDF placeholders for unsupported components', async () => {
    const document = createDocument();
    const plugin = createEmptyBlock('plugin');
    plugin.schema.id = 'custom-plugin';
    plugin.schema.plugin = 'fake-plugin';
    document.sections[0].blocks.push(plugin);

    const expectedResult = await getHvyPdfBlob(document, {
      contentView: { skip: ['hidden'] },
      strategy: {
        defaults: { unsupportedPluginPolicy: 'placeholder' },
        rules: [{ id: 'intro', keepWithNext: true }],
      },
    });
    const text = await expectedResult.text();

    expect(expectedResult.type).toBe('application/pdf');
    expect(text).toContain('Unsupported PDF export component: fake-plugin');
    expect(text).not.toContain('Hidden text');
  });

  test('PHVY export accepts PDF-compatible components', async () => {
    const document = createDocument();
    document.extension = '.phvy';
    document.sections = [createSection('summary', [createTextBlock('intro', 'PDF template text')])];

    const expectedResult = await getHvyPdfBlob(document);

    expect(expectedResult.type).toBe('application/pdf');
  });

  test('PHVY export rejects existing PDF-incompatible components', async () => {
    const document = createDocument();
    document.extension = '.phvy';
    document.sections = [createSection('details', [createExpandableBlock('details')])];

    await expect(getHvyPdfBlob(document)).rejects.toThrow('PDF document cannot render component "expandable"');
  });

  test('PHVY export rejects existing sidebar sections', async () => {
    const document = createDocument();
    document.extension = '.phvy';
    const section = createSection('notes', [createTextBlock('note', 'Sidebar note')]);
    section.location = 'sidebar';
    document.sections = [section];

    await expect(getHvyPdfBlob(document)).rejects.toThrow('PDF document cannot render sidebar section "notes"');
  });
});
