import { expect, test } from 'vitest';

import { createDefaultTextCaption, normalizeTextCaption, serializeTextCaption } from '../src/caption';

test('expected result: text caption payload defaults to centered text component', () => {
  const expectedResult = createDefaultTextCaption('Caption text');

  expect(expectedResult.text).toBe('Caption text');
  expect(expectedResult.schema.kind).toBe('text');
  expect(expectedResult.schema.component).toBe('text');
  expect(expectedResult.schema.align).toBe('center');
});

test('expected result: text caption normalization migrates string captions', () => {
  const expectedResult = normalizeTextCaption('Plain caption');

  expect(expectedResult?.text).toBe('Plain caption');
  expect(expectedResult?.schema.align).toBe('center');
});

test('expected result: empty text caption serializes as absent', () => {
  expect(serializeTextCaption(createDefaultTextCaption(''))).toBeNull();
});
