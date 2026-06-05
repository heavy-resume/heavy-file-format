import { expect, test } from 'vitest';

import { createEmptyBlock, createEmptySection } from '../src/document-factory';
import { buildPdfExportDocDefinition } from '../src/pdf-export/doc-definition';
import { getHvyPdfBlob } from '../src/pdf-export/export';
import type { VisualDocument } from '../src/types';

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
