import { expect, test } from 'vitest';

import { applyTextFillInValue, removeTextFillInMarkers } from '../src/text-fill-in';

test('removing empty styled fill-ins does not leak markdown emphasis delimiters', () => {
  expect(removeTextFillInMarkers('Before _<!-- value -->_ after')).toBe('Before  after');
  expect(removeTextFillInMarkers('Before __<!-- value {"placeholder":"Name"} -->__ after')).toBe('Before  after');
  expect(removeTextFillInMarkers('Before ___<!-- value -->___ after')).toBe('Before  after');
});

test('filled styled fill-ins keep their markdown emphasis delimiters', () => {
  expect(applyTextFillInValue('Before _<!-- value -->_ after', 'Ada')).toBe('Before _Ada_ after');
});
