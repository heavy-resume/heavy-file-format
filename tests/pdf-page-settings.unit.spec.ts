import { expect, test } from 'vitest';

import { normalizePdfPageMargins, pdfPageLengthToPoints } from '../src/pdf-page-settings';

test('PDF page margin lengths accept normal physical units', () => {
  expect(pdfPageLengthToPoints('1in')).toBe(72);
  expect(pdfPageLengthToPoints('2.54cm')).toBe(72);
  expect(pdfPageLengthToPoints('25.4mm')).toBe(72);
  expect(pdfPageLengthToPoints('72pt')).toBe(72);
});

test('PDF page margins normalize document lengths to PDF points', () => {
  const expectedResult = normalizePdfPageMargins(['0.5in', '1cm', '12mm', '18pt']);

  expect(expectedResult[0]).toBe(36);
  expect(expectedResult[1]).toBeCloseTo(28.346, 3);
  expect(expectedResult[2]).toBeCloseTo(34.016, 3);
  expect(expectedResult[3]).toBe(18);
});
