import { expect, test } from 'vitest';

import { expandSectionPathByKey, getReaderSectionExpandedOverride } from '../src/navigation';
import { deserializeDocument, serializeDocument } from '../src/serialization';
import { initState } from '../src/state';
import type { AppState } from '../src/types';

test('sidebar navigation expands sections without changing serialized document state', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"alpha","expanded":false}-->
#! Alpha

<!--hvy:text {"id":"alpha-note"}-->
 alpha facts
`, '.hvy');
  initState({
    document,
    readerContainerState: {},
  } as unknown as AppState);
  const before = serializeDocument(document);
  const section = document.sections[0]!;

  const result = expandSectionPathByKey(document.sections, section.key);

  expect(result.changed).toBe(true);
  expect(section.expanded).toBe(false);
  expect(getReaderSectionExpandedOverride(section)).toBe(true);
  expect(serializeDocument(document)).toBe(before);
});
