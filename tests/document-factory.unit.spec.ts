import { expect, test } from 'vitest';

import { createBlankDocument } from '../src/document-factory';

test('createBlankDocument uses the default reader max width', () => {
  const document = createBlankDocument();

  expect(document.meta.reader_max_width).toBe('60rem');
  expect(document.meta.section_defaults).toEqual({
    css: 'margin: 0.5rem 0;',
  });
});
