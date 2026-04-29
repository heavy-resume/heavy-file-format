import { expect, test } from 'vitest';

import { createBlankDocument } from '../src/document-factory';

test('createBlankDocument uses the default reader max width', () => {
  const document = createBlankDocument();

  expect(document.meta.reader_max_width).toBe('60rem');
});
