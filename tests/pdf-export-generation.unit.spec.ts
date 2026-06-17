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

test('PDF doc definition maps container CSS box styling to a flow box', () => {
  const child = createEmptyBlock('text');
  child.text = 'Box content';
  const container = createEmptyBlock('container');
  container.schema.id = 'styled-container';
  container.schema.css = 'background-color: var(--hvy-surface); color: #ffffff; padding: 0.25in 0.5in; border: 2pt solid var(--hvy-border);';
  container.schema.containerBlocks = [child];
  const section = createEmptySection(1, '');
  section.blocks = [container];
  const document: VisualDocument = {
    meta: {
      title: 'PDF Box Styling',
      theme: {
        colors: {
          '--hvy-surface': '#123456',
          '--hvy-border': '#abcdef',
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
  const boxNode = firstSection.stack?.[0] as HvyPdfMakeNodeObject | undefined;
  const cell = boxNode?.table?.body[0]?.[0] as HvyPdfMakeNodeObject | undefined;
  const boxLayout = boxNode?.layout as Record<string, () => unknown> | undefined;

  expect(boxNode?.table?.widths).toEqual([504]);
  expect(cell?.fillColor).toBe('#123456');
  expect(cell?.color).toBe('#ffffff');
  expect(JSON.stringify(cell?.stack)).toContain('Box content');
  expect(boxLayout?.paddingLeft()).toBe(36);
  expect(boxLayout?.paddingTop()).toBe(18);
  expect(boxLayout?.hLineWidth()).toBe(2);
  expect(boxLayout?.hLineColor()).toBe('#abcdef');
});

test('pdfmake backend produces a PDF blob with a styled flow box', async () => {
  const child = createEmptyBlock('text');
  child.text = 'Styled box PDF export.';
  const container = createEmptyBlock('container');
  container.schema.css = 'background: #f8fafc; padding: 0.2in; border: 1pt solid #cbd5e1;';
  container.schema.containerBlocks = [child];
  const section = createEmptySection(1, '');
  section.blocks = [container];
  const document: VisualDocument = {
    meta: { title: 'PDF Styled Box Blob' },
    extension: '.phvy',
    attachments: [],
    sections: [section],
  };

  const expectedResult = await getHvyPdfBlob(document);

  expect(expectedResult.type).toBe('application/pdf');
  expect(expectedResult.size).toBeGreaterThan(1000);
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

test('PDF doc definition widens styled section boxes for negative margin bleed', () => {
  const block = createEmptyBlock('text');
  block.text = 'Bleed header';
  const section = createEmptySection(1, '');
  section.customId = 'bleed-section';
  section.css = 'margin: -0.75in -0.75in 0; background: #24566f; padding: 0.25in;';
  section.blocks = [block];
  const document: VisualDocument = {
    meta: { title: 'PDF Bleed Section' },
    extension: '.phvy',
    attachments: [],
    sections: [section],
  };

  const expectedResult = buildPdfExportDocDefinition(document);
  const bleedNode = expectedResult.content[0];
  expect(typeof bleedNode).not.toBe('string');
  if (typeof bleedNode === 'string') return;
  const cell = bleedNode.table?.body[0]?.[0] as HvyPdfMakeNodeObject | undefined;
  const boxLayout = bleedNode.layout as Record<string, () => unknown> | undefined;

  expect(bleedNode.margin).toEqual([-54, -54, -54, 0]);
  expect(bleedNode.table?.widths).toEqual([612]);
  expect(cell?.fillColor).toBe('#24566f');
  expect(boxLayout?.paddingLeft()).toBe(18);
  expect(JSON.stringify(cell?.stack)).toContain('Bleed header');
});

test('PDF doc definition uses PHVY document page margins', () => {
  const block = createEmptyBlock('text');
  block.text = 'Page margin text.';
  const section = createEmptySection(1, '');
  section.blocks = [block];
  const document: VisualDocument = {
    meta: {
      title: 'PDF Page Margins',
      pdf_page: { margins: ['0.5in', '1in', '0.5in', '1in'] },
    },
    extension: '.phvy',
    attachments: [],
    sections: [section],
  };

  const expectedResult = buildPdfExportDocDefinition(document);

  expect(expectedResult.pageMargins).toEqual([36, 72, 36, 72]);
});

test('PDF doc definition renders debug page bounds into PDF background', () => {
  const block = createEmptyBlock('text');
  block.text = 'Page margin text.';
  const section = createEmptySection(1, '');
  section.blocks = [block];
  const document: VisualDocument = {
    meta: {
      title: 'PDF Debug Bounds',
      pdf_page: { margins: ['0.5in', '1in', '0.5in', '1in'], debug: true },
    },
    extension: '.phvy',
    attachments: [],
    sections: [section],
  };

  const expectedResult = buildPdfExportDocDefinition(document);

  expect(typeof expectedResult.background).toBe('function');
  if (typeof expectedResult.background !== 'function') return;
  expect(expectedResult.background(1, { width: 612, height: 792 })).toEqual(expect.objectContaining({
    absolutePosition: { x: 0, y: 0 },
    canvas: [
      expect.objectContaining({ type: 'rect', x: 0, y: 0, w: 612, h: 792, lineColor: '#dc2626' }),
      expect.objectContaining({ type: 'rect', x: 36, y: 72, w: 540, h: 648, lineColor: '#2563eb' }),
    ],
  }));
});

test('pdfmake backend produces a PDF blob with debug page bounds enabled', async () => {
  const block = createEmptyBlock('text');
  block.schema.id = 'debug-intro';
  block.text = 'PDF export debug bounds smoke test.';
  const section = createEmptySection(1, '');
  section.customId = 'debug-summary';
  section.blocks = [block];
  const document: VisualDocument = {
    meta: {
      title: 'PDF Debug Smoke',
      pdf_page: { margins: ['0.5in', '1in', '0.5in', '1in'], debug: true },
    },
    extension: '.phvy',
    attachments: [],
    sections: [section],
  };

  const expectedResult = await getHvyPdfBlob(document);

  expect(expectedResult.type).toBe('application/pdf');
  expect(expectedResult.size).toBeGreaterThan(1000);
});

test('PDF doc definition omits debug page bounds when PDF debug is disabled', () => {
  const block = createEmptyBlock('text');
  block.text = 'Page margin text.';
  const section = createEmptySection(1, '');
  section.blocks = [block];
  const document: VisualDocument = {
    meta: {
      title: 'PDF Debug Bounds',
      pdf_page: { margins: ['0.5in', '1in', '0.5in', '1in'] },
    },
    extension: '.phvy',
    attachments: [],
    sections: [section],
  };

  const expectedResult = buildPdfExportDocDefinition(document);

  expect(expectedResult.background).toBeUndefined();
});

test('PDF export keeps QR static SVG captions visible with debug bounds enabled', async () => {
  const block = createEmptyBlock('image');
  block.schema.id = 'qr';
  block.schema.css = 'width: 15rem; height: auto; display: block;';
  block.schema.imageFile = 'qr-code.svg';
  block.schema.imageAlt = 'Generated QR code';
  block.schema.caption = createDefaultTextCaption('Scan code');
  const section = createEmptySection(1, '');
  section.blocks = [block];
  const document: VisualDocument = {
    meta: {
      title: 'PDF QR Debug',
      pdf_page: { margins: ['0.75in', '0.75in', '0.75in', '0.75in'], debug: true },
    },
    extension: '.phvy',
    attachments: [
      {
        id: 'image:qr-code.svg',
        meta: { mediaType: 'image/svg+xml' },
        bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640"><rect width="640" height="640" fill="#fff"/><rect x="64" y="64" width="512" height="512" fill="#111827"/></svg>'),
      },
    ],
    sections: [section],
  };

  const expectedResult = buildPdfExportDocDefinition(document);
  const serialized = JSON.stringify(expectedResult.content);
  const firstSection = expectedResult.content[0];
  expect(typeof firstSection).not.toBe('string');
  if (typeof firstSection === 'string') return;
  const qrNode = firstSection.stack?.[0] as HvyPdfMakeNodeObject | undefined;
  const qrInner = qrNode?.stack?.[1] as HvyPdfMakeNodeObject | undefined;
  const qrImageBounds = qrInner?.stack?.[0] as HvyPdfMakeNodeObject | undefined;
  const blob = await getHvyPdfBlob(document);

  expect(serialized).toContain('Scan code');
  expect(serialized).toContain('"svg"');
  expect(qrNode?.table).toBeUndefined();
  expect(qrNode?.stack?.[0]).toEqual(expect.objectContaining({ relativePosition: { x: 0, y: 0 } }));
  expect(qrImageBounds).toEqual(expect.objectContaining({
    relativePosition: expect.objectContaining({ y: 0 }),
    canvas: [expect.objectContaining({ type: 'rect', w: 120, h: 140, lineColor: '#f59e0b' })],
  }));
  expect(countPdfPages(await blob.arrayBuffer())).toBe(1);
});

test('PDF export strategy page margins override PHVY document page margins', () => {
  const block = createEmptyBlock('text');
  block.text = 'Page margin text.';
  const section = createEmptySection(1, '');
  section.blocks = [block];
  const document: VisualDocument = {
    meta: {
      title: 'PDF Page Margins',
      pdf_page: { margins: ['0.5in', '1in', '0.5in', '1in'] },
    },
    extension: '.phvy',
    attachments: [],
    sections: [section],
  };

  const expectedResult = buildPdfExportDocDefinition(document, {
    strategy: { defaults: { pageMargins: [24, 30, 24, 30] } },
  });

  expect(expectedResult.pageMargins).toEqual([24, 30, 24, 30]);
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

function countPdfPages(buffer: ArrayBuffer): number {
  const text = Buffer.from(buffer).toString('latin1');
  return (text.match(/\/Type\s*\/Page\b/g) ?? []).length;
}
