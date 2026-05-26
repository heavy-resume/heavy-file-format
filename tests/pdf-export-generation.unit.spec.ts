import { expect, test } from 'vitest';

import { createEmptyBlock, createEmptySection } from '../src/document-factory';
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
