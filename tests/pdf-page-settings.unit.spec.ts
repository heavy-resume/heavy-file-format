import { expect, test } from 'vitest';

import { formatPdfMarginUnitValue, formatPdfPointsAsUnit, inferPdfPageMarginUnit, normalizePdfPageMargins, pdfPageLengthToPoints } from '../src/pdf-page-settings';

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

test('PDF page margin display values round to nearest twentieth unit', () => {
  expect(formatPdfMarginUnitValue(1.234)).toBe('1.25');
  expect(formatPdfMarginUnitValue(1.226)).toBe('1.25');
  expect(formatPdfMarginUnitValue(1.224)).toBe('1.2');
  expect(formatPdfPointsAsUnit(72, 'in')).toBe('1');
  expect(formatPdfPointsAsUnit(72, 'cm')).toBe('2.55');
});

test('PDF page margin unit infers centimeters only when all margins use centimeters', () => {
  expect(inferPdfPageMarginUnit(['1cm', '2cm', '1.5cm', '2.5cm'])).toBe('cm');
  expect(inferPdfPageMarginUnit(['0.5in', '1in', '0.5in', '1in'])).toBe('in');
  expect(inferPdfPageMarginUnit(['1cm', '1in', '1cm', '1cm'])).toBe('in');
});
