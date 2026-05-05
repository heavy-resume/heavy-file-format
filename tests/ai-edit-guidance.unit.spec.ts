import { expect, test } from 'vitest';

import { getAiEditComponentGuidance } from '../src/ai-edit-guidance';
import { deserializeDocument } from '../src/serialization';

test('table component guidance points edits at canonical table config', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"data"}-->
#! Data

<!--hvy:table {"id":"rows","tableColumns":"Name,Status","tableRows":[{"cells":["Alpha","Open"]}]}-->
`, '.hvy');

  const block = document.sections[0]?.blocks[0];
  if (!block) {
    throw new Error('expected table block');
  }
  const guidance = getAiEditComponentGuidance(block);

  expect(guidance).toContain('edit tableColumns.json and tableRows.json for static table data');
  expect(guidance).toContain('table.txt is only a read-only preview');
  expect(guidance).toContain('tableColumns.json is a JSON array of strings');
  expect(guidance).toContain('tableRows.json is a JSON array of string arrays');
  expect(guidance).toContain('Do not write YAML, Markdown tables, or pipe-delimited rows into table.txt');
  expect(guidance).not.toContain('Do not use GitHub-flavored Markdown table syntax or pipe-delimited pseudo-tables as a shortcut');
});
