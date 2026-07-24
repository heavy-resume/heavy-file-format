import { expect, test } from 'vitest';

import { deserializeDocument } from '../src/serialization';
import { walkHvyDocument } from '../src/search/hvy-document-walk';

test('walkHvyDocument traverses visible leaf content in document order without search filtering', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"alpha"}-->
#! Alpha

<!--hvy:text {"id":"first-note"}-->
 First visible note.

<!--hvy: {"id":"beta"}-->
#! Beta

<!--hvy:text {"id":"second-note"}-->
 Second visible note.
`, '.hvy');

  // BEFORE
  const firstBatch = walkHvyDocument({ document, limit: 1 });

  // TOOL CALL
  const secondBatch = walkHvyDocument({
    document,
    limit: 1,
    cursor: firstBatch.nextCursor,
  });

  // AFTER
  expect(firstBatch).toEqual(expect.objectContaining({
    reviewedThrough: 1,
    totalItems: 2,
    nextCursor: 'hvy-walk:1',
  }));
  expect(firstBatch.items[0]).toEqual(expect.objectContaining({
    path: '/body/alpha/first-note',
    type: 'text',
    content: expect.stringContaining('First visible note.'),
  }));
  expect(secondBatch).toEqual(expect.objectContaining({
    reviewedThrough: 2,
    totalItems: 2,
  }));
  expect(secondBatch).not.toHaveProperty('nextCursor');
  expect(secondBatch.items[0]).toEqual(expect.objectContaining({
    path: '/body/beta/second-note',
    content: expect.stringContaining('Second visible note.'),
  }));
});

test('walkHvyDocument rejects malformed and out-of-range cursors', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"alpha"}-->
#! Alpha

<!--hvy:text {"id":"note"}-->
 Visible note.
`, '.hvy');

  expect(() => walkHvyDocument({ document, cursor: 'not-a-cursor' })).toThrow('Invalid HVY walk cursor.');
  expect(() => walkHvyDocument({ document, cursor: 'hvy-walk:99' })).toThrow('beyond the end');
});
