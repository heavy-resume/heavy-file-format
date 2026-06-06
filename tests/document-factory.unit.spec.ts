import { expect, test } from 'vitest';

import { createBlankDocument, createEmptyBlock, createEmptySectionWithMeta } from '../src/document-factory';

test('createBlankDocument uses the default reader max width', () => {
  const document = createBlankDocument();

  expect(document.meta.reader_max_width).toBe('60rem');
  expect(document.meta.section_defaults).toEqual({
    css: 'margin: 0 0 0.5rem;',
    contained: true,
  });
});

test('createBlankDocument can create PHVY and THVY documents', () => {
  expect(createBlankDocument('.phvy').extension).toBe('.phvy');
  expect(createBlankDocument('.thvy').extension).toBe('.thvy');
});

test('createEmptyBlock centers image components by default', () => {
  const expectedResult = createEmptyBlock('image');

  expect(expectedResult.schema.css).toBe('margin: 0.5rem auto; display: block;');
});

test('createEmptySectionWithMeta uses document section contained default', () => {
  const expectedResult = createEmptySectionWithMeta(1, '', false, {
    section_defaults: {
      contained: false,
    },
  });

  expect(expectedResult.contained).toBe(false);
});
