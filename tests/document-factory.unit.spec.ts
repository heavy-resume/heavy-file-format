import { expect, test } from 'vitest';

import { createBlankDocument, createEmptyBlock, createEmptySectionWithMeta, ensureGridItems } from '../src/document-factory';

test('createBlankDocument uses the default reader max width', () => {
  const document = createBlankDocument();

  expect(document.meta.reader_max_width).toBe('60rem');
  expect(document.meta.sidebar_max_width).toBe('40rem');
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

test('expected result: grid item normalization preserves slot metadata', () => {
  const grid = createEmptyBlock('grid');
  grid.schema.gridItems = [{
    id: 'support-argument',
    idGenerated: false,
    css: 'order: 1;',
    block: createEmptyBlock('text'),
  }];

  ensureGridItems(grid.schema);

  expect(grid.schema.gridItems[0]).toMatchObject({
    id: 'support-argument',
    idGenerated: false,
    css: 'order: 1;',
  });
});

test('expected result: grid item normalization keeps generated ids non-authored', () => {
  const grid = createEmptyBlock('grid');
  grid.schema.gridItems = [{
    id: 'generated-grid-item',
    idGenerated: true,
    block: createEmptyBlock('text'),
  }];

  ensureGridItems(grid.schema);

  expect(grid.schema.gridItems[0]).toMatchObject({
    id: 'generated-grid-item',
    idGenerated: true,
  });
});
