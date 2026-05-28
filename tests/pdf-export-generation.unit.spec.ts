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
