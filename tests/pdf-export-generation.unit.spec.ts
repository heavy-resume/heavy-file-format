import { expect, test } from 'vitest';

import { createEmptyBlock, createEmptySection } from '../src/document-factory';
import { buildPdfExportDocDefinition } from '../src/pdf-export/doc-definition';
import { getHvyPdfBlob } from '../src/pdf-export/export';
import type { HvyPdfMakeNodeObject } from '../src/pdf-export/types';
import type { VisualDocument } from '../src/types';
import { createDefaultTextCaption } from '../src/caption';

test('pdfmake backend produces a PDF blob for a strategy-filtered document', async () => {
  const block = createEmptyBlock('text');
  block.schema.id = 'intro';
  block.text = 'PDF export smoke test.';
  const section = createEmptySection(1, '');
  section.customId = 'summary';
  section.title = 'Summary';
  section.blocks = [block];
  const document: VisualDocument = {
    meta: { title: 'PDF Smoke' },
    extension: '.hvy',
    attachments: [],
    sections: [section],
  };

  const expectedResult = await getHvyPdfBlob(document, {
    strategy: { rules: [{ id: 'summary', keepWithNext: true }] },
  });

  expect(expectedResult.type).toBe('application/pdf');
  expect(expectedResult.size).toBeGreaterThan(1000);
});

test('PDF doc definition renders component-list children as exportable content', () => {
  const firstItem = createEmptyBlock('text');
  firstItem.text = 'First repeated item.';
  const secondItem = createEmptyBlock('text');
  secondItem.text = 'Second repeated item.';
  const listBlock = createEmptyBlock('component-list');
  listBlock.schema.componentListBlocks = [firstItem, secondItem];
  const section = createEmptySection(1, '');
  section.title = 'Repeated Items';
  section.blocks = [listBlock];
  const document: VisualDocument = {
    meta: { title: 'PDF Component List' },
    extension: '.phvy',
    attachments: [],
    sections: [section],
  };

  const expectedResult = buildPdfExportDocDefinition(document);

  expect(JSON.stringify(expectedResult.content)).toContain('First repeated item.');
  expect(JSON.stringify(expectedResult.content)).toContain('Second repeated item.');
  expect(JSON.stringify(expectedResult.content)).not.toContain('Unsupported PDF export component');
});

test('PDF doc definition omits unfilled placeholder-only text blocks', () => {
  const unfilledHeading = createEmptyBlock('text');
  unfilledHeading.schema.fillIn = true;
  unfilledHeading.text = '^section-heading^ #### <!-- value {"placeholder":"Classes Or \'\' if no classes"} -->';
  const emptyPlaceholder = createEmptyBlock('text');
  emptyPlaceholder.schema.placeholder = 'classes';
  const filledText = createEmptyBlock('text');
  filledText.text = 'Visible education details.';
  const section = createEmptySection(1, '');
  section.title = 'Education';
  section.blocks = [unfilledHeading, emptyPlaceholder, filledText];
  const document: VisualDocument = {
    meta: { title: 'PDF Placeholders' },
    extension: '.phvy',
    attachments: [],
    sections: [section],
  };

  const expectedResult = buildPdfExportDocDefinition(document);
  const serialized = JSON.stringify(expectedResult.content);

  expect(serialized).toContain('Visible education details.');
  expect(serialized).not.toContain('####');
  expect(serialized).not.toContain('classes');
  expect(serialized).not.toContain('<!-- value');
});

test('PDF doc definition applies component CSS margins to block wrappers', () => {
  const firstBlock = createEmptyBlock('text');
  firstBlock.schema.id = 'first';
  firstBlock.schema.css = 'margin: 0.5rem 0 1rem 0.25rem;';
  firstBlock.text = 'First block';
  const secondBlock = createEmptyBlock('table');
  secondBlock.schema.id = 'second';
  secondBlock.schema.css = 'margin-bottom: 2rem;';
  secondBlock.schema.tableColumns = ['Column'];
  secondBlock.schema.tableRows = [{ cells: ['Cell'] }];
  const section = createEmptySection(1, '');
  section.blocks = [firstBlock, secondBlock];
  const document: VisualDocument = {
    meta: { title: 'PDF Component Margins' },
    extension: '.phvy',
    attachments: [],
    sections: [section],
  };

  const expectedResult = buildPdfExportDocDefinition(document);
  const firstSection = expectedResult.content[0];
  expect(typeof firstSection).not.toBe('string');
  if (typeof firstSection === 'string') return;
  const firstNode = firstSection.stack?.[0] as HvyPdfMakeNodeObject | undefined;
  const secondNode = firstSection.stack?.[1] as HvyPdfMakeNodeObject | undefined;

  expect(firstNode?.margin).toEqual([3, 6, 0, 12]);
  expect(secondNode?.margin).toEqual([0, 0, 0, 24]);
});

test('PDF doc definition applies section default and explicit CSS margins', () => {
  const defaultSection = createEmptySection(1, '');
  defaultSection.customId = 'default-section';
  defaultSection.blocks = [createEmptyBlock('text')];
  defaultSection.blocks[0].text = 'Default section';
  const explicitSection = createEmptySection(1, '');
  explicitSection.customId = 'explicit-section';
  explicitSection.css = 'margin-top: 1rem; margin-bottom: 2rem;';
  explicitSection.blocks = [createEmptyBlock('text')];
  explicitSection.blocks[0].text = 'Explicit section';
  const document: VisualDocument = {
    meta: {
      title: 'PDF Section Margins',
      section_defaults: { css: 'margin: 0 0 0.5rem;' },
    },
    extension: '.phvy',
    attachments: [],
    sections: [defaultSection, explicitSection],
  };

  const expectedResult = buildPdfExportDocDefinition(document);
  const defaultNode = expectedResult.content[0] as HvyPdfMakeNodeObject;
  const explicitNode = expectedResult.content[1] as HvyPdfMakeNodeObject;

  expect(defaultNode.margin).toEqual([0, 0, 0, 6]);
  expect(explicitNode.margin).toEqual([0, 12, 0, 24]);
});

test('PDF doc definition constrains grid images to their column width', () => {
  const leftImage = createEmptyBlock('image');
  leftImage.schema.imageFile = 'left.png';
  leftImage.schema.imageAlt = 'Left image';
  const rightImage = createEmptyBlock('image');
  rightImage.schema.imageFile = 'right.png';
  rightImage.schema.imageAlt = 'Right image';
  const grid = createEmptyBlock('grid');
  grid.schema.gridColumns = 2;
  grid.schema.gridItems = [
    { id: 'left-image', block: leftImage },
    { id: 'right-image', block: rightImage },
  ];
  const section = createEmptySection(1, '');
  section.blocks = [grid];
  const document: VisualDocument = {
    meta: { title: 'PDF Grid Images' },
    extension: '.phvy',
    attachments: [
      { id: 'image:left.png', meta: { mediaType: 'image/png' }, bytes: new Uint8Array([1, 2, 3]) },
      { id: 'image:right.png', meta: { mediaType: 'image/png' }, bytes: new Uint8Array([4, 5, 6]) },
    ],
    sections: [section],
  };

  const expectedResult = buildPdfExportDocDefinition(document);
  const firstSection = expectedResult.content[0];
  expect(typeof firstSection).not.toBe('string');
  if (typeof firstSection === 'string') return;
  const gridNode = firstSection.stack?.[0];
  expect(typeof gridNode).not.toBe('string');
  if (typeof gridNode === 'string') return;
  const leftColumn = gridNode.columns?.[0];
  expect(typeof leftColumn).not.toBe('string');
  if (typeof leftColumn === 'string') return;
  const imageStack = leftColumn?.stack?.[0];
  expect(typeof imageStack).not.toBe('string');
  if (typeof imageStack === 'string') return;
  const imageNode = imageStack.stack?.[0] as HvyPdfMakeNodeObject | undefined;

  expect(imageNode?.fit).toEqual([246, 240]);
});

test('PDF doc definition keeps image captions with CSS-sized images', () => {
  const image = createEmptyBlock('image');
  image.schema.imageFile = 'qr-code.svg';
  image.schema.imageAlt = 'QR code';
  image.schema.caption = createDefaultTextCaption('**AI Generated** - expectations from disc golf course');
  image.schema.css = 'margin: 0.5rem auto; display: block; width: 12rem; height: auto;';
  const section = createEmptySection(1, '');
  section.blocks = [image];
  const document: VisualDocument = {
    meta: { title: 'PDF CSS Image Size' },
    extension: '.phvy',
    attachments: [
      {
        id: 'image:qr-code.svg',
        meta: { mediaType: 'image/svg+xml' },
        bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100"/></svg>'),
      },
    ],
    sections: [section],
  };

  const expectedResult = buildPdfExportDocDefinition(document);
  const firstSection = expectedResult.content[0];
  expect(typeof firstSection).not.toBe('string');
  if (typeof firstSection === 'string') return;
  const imageStack = firstSection.stack?.[0] as HvyPdfMakeNodeObject | undefined;
  const imageNode = imageStack?.stack?.[0] as HvyPdfMakeNodeObject | undefined;
  const captionNode = imageStack?.stack?.[1] as HvyPdfMakeNodeObject | undefined;

  expect(imageStack?.unbreakable).toBe(true);
  expect(imageNode?.fit).toEqual([96, 96]);
  expect(imageNode?.margin).toEqual([0, 0, 0, 3]);
  expect(captionNode).toEqual(expect.objectContaining({
    text: [
      { text: 'AI Generated', bold: true },
      ' - expectations from disc golf course',
    ],
    alignment: 'center',
    style: 'paragraph',
  }));
});

test('PDF doc definition renders image caption headings as text headings', () => {
  const image = createEmptyBlock('image');
  image.schema.imageFile = 'qr-code.svg';
  image.schema.imageAlt = 'QR code';
  image.schema.caption = createDefaultTextCaption('## Caption Heading');
  image.schema.css = 'margin: 0.5rem auto; display: block; width: 12rem; height: auto;';
  const section = createEmptySection(1, '');
  section.blocks = [image];
  const document: VisualDocument = {
    meta: { title: 'PDF Caption Heading' },
    extension: '.phvy',
    attachments: [
      {
        id: 'image:qr-code.svg',
        meta: { mediaType: 'image/svg+xml' },
        bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100"/></svg>'),
      },
    ],
    sections: [section],
  };

  const expectedResult = buildPdfExportDocDefinition(document);
  const firstSection = expectedResult.content[0];
  expect(typeof firstSection).not.toBe('string');
  if (typeof firstSection === 'string') return;
  const imageStack = firstSection.stack?.[0] as HvyPdfMakeNodeObject | undefined;
  const captionNode = imageStack?.stack?.[1] as HvyPdfMakeNodeObject | undefined;

  expect(captionNode).toEqual(expect.objectContaining({
    text: 'Caption Heading',
    style: ['sectionTitle2'],
    headlineLevel: 2,
    alignment: 'center',
  }));
});

test('PDF doc definition maps medium image preset to a moderate page size', () => {
  const image = createEmptyBlock('image');
  image.schema.imageFile = 'qr-code.svg';
  image.schema.imageAlt = 'QR code';
  image.schema.css = 'margin: 0.5rem auto; display: block; width: 30rem; height: auto;';
  const section = createEmptySection(1, '');
  section.blocks = [image];
  const document: VisualDocument = {
    meta: { title: 'PDF Medium Image Size' },
    extension: '.phvy',
    attachments: [
      {
        id: 'image:qr-code.svg',
        meta: { mediaType: 'image/svg+xml' },
        bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100"/></svg>'),
      },
    ],
    sections: [section],
  };

  const expectedResult = buildPdfExportDocDefinition(document);
  const firstSection = expectedResult.content[0];
  expect(typeof firstSection).not.toBe('string');
  if (typeof firstSection === 'string') return;
  const imageStack = firstSection.stack?.[0] as HvyPdfMakeNodeObject | undefined;
  const imageNode = imageStack?.stack?.[0] as HvyPdfMakeNodeObject | undefined;

  expect(imageNode?.fit).toEqual([240, 240]);
});

test('PDF doc definition wraps grid items by gridColumns', () => {
  const grid = createEmptyBlock('grid');
  grid.schema.gridColumns = 2;
  grid.schema.gridItems = [
    { id: 'first', block: createEmptyBlock('text') },
    { id: 'second', block: createEmptyBlock('text') },
    { id: 'third', block: createEmptyBlock('text') },
  ];
  grid.schema.gridItems[0].block.text = 'First';
  grid.schema.gridItems[1].block.text = 'Second';
  grid.schema.gridItems[2].block.text = 'Third';
  const section = createEmptySection(1, '');
  section.blocks = [grid];
  const document: VisualDocument = {
    meta: { title: 'PDF Grid Rows' },
    extension: '.phvy',
    attachments: [],
    sections: [section],
  };

  const expectedResult = buildPdfExportDocDefinition(document);
  const firstSection = expectedResult.content[0];
  expect(typeof firstSection).not.toBe('string');
  if (typeof firstSection === 'string') return;
  const gridNode = firstSection.stack?.[0];
  expect(typeof gridNode).not.toBe('string');
  if (typeof gridNode === 'string') return;

  expect(gridNode.stack).toHaveLength(2);
  expect(JSON.stringify(gridNode.stack?.[0])).toContain('First');
  expect(JSON.stringify(gridNode.stack?.[0])).toContain('Second');
  expect(JSON.stringify(gridNode.stack?.[1])).toContain('Third');
});

test('PDF doc definition applies document heading font size styles', () => {
  const block = createEmptyBlock('text');
  block.text = '# Larger Heading';
  const section = createEmptySection(1, '');
  section.blocks = [block];
  const document: VisualDocument = {
    meta: {
      title: 'PDF Heading Styles',
      heading_styles: {
        h1: {
          label: 'Heading 1',
          css: 'margin: 0; font-size: 3rem; font-weight: 700; line-height: 1.1;',
          afterContentMarginTop: '0',
        },
      },
    },
    extension: '.phvy',
    attachments: [],
    sections: [section],
  };

  const expectedResult = buildPdfExportDocDefinition(document);
  const firstSection = expectedResult.content[0];
  expect(typeof firstSection).not.toBe('string');
  if (typeof firstSection === 'string') return;
  const headingNode = firstSection.stack?.[0] as HvyPdfMakeNodeObject | undefined;

  expect(headingNode).toEqual(expect.objectContaining({
    text: 'Larger Heading',
    fontSize: 36,
    bold: true,
    lineHeight: 1.1,
  }));
});
