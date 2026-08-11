import { expect, test } from 'vitest';

import { deserializeDocument, serializeDocument } from '../src/serialization';
import { builtInSearchProvider } from '../src/search/search-provider';
import { buildSemanticFilterRequest } from '../src/search/semantic-candidates';

test('static table GFM bodies provide values while inline columns remain authoritative', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"data"}-->
#! Data

<!--hvy:table {"id":"facts","tableColumns":["Authoritative A","Authoritative B"]}-->
 | Ignored A | Ignored B |
 | --- | --- |
 | Alpha | Left &#124; right |
 | Fish &amp; Chips | Line one&#10;Line two |
 | Standard GFM | Backslash \\| pipe |
`, '.hvy');

  const table = document.sections[0]?.blocks[0];

  expect(table?.schema.tableColumns).toEqual(['Authoritative A', 'Authoritative B']);
  expect(table?.schema.tableRows).toEqual([
    { cells: ['Alpha', 'Left | right'] },
    { cells: ['Fish & Chips', 'Line one\nLine two'] },
    { cells: ['Standard GFM', 'Backslash | pipe'] },
  ]);
  expect(table?.text).toBe('');
});

test('legacy inline static table values take precedence over a GFM body in data and search', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"data"}-->
#! Data

<!--hvy:table {"id":"facts","tableColumns":["Name","Status"],"tableRows":[{"cells":["Inline","Wins"]}]}-->
 | Name | Status |
 | --- | --- |
 | Body | Loses |
`, '.hvy');

  const table = document.sections[0]?.blocks[0];
  const inlineResults = await builtInSearchProvider({
    document,
    query: 'Inline',
    caseSensitive: false,
    categories: ['contents'],
  });
  const fallbackResults = await builtInSearchProvider({
    document,
    query: 'Body',
    caseSensitive: false,
    categories: ['contents'],
  });

  expect(table?.schema.tableRows).toEqual([{ cells: ['Inline', 'Wins'] }]);
  expect(table?.text).toBe('');
  expect(inlineResults[0]?.matches).toEqual([
    expect.objectContaining({ field: 'tableCells', label: 'Table', matchedText: 'Inline' }),
  ]);
  expect(fallbackResults).toEqual([]);
});

test('an explicitly empty inline static table value array takes precedence over GFM rows', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"data"}-->
#! Data

<!--hvy:table {"id":"facts","tableColumns":["Name","Status"],"tableRows":[]}-->
 | Name | Status |
 | --- | --- |
 | Body | Loses |
`, '.hvy');

  expect(document.sections[0]?.blocks[0]?.schema.tableRows).toEqual([]);
});

test('static table serialization uses a lossless values-only GFM body', () => {
  const input = `---
hvy_version: 0.1
---

<!--hvy: {"id":"data"}-->
#! Data

<!--hvy:table {"id":"facts","tableColumns":["Expression","Path","Spacing","Lines","Annotation"],"tableRows":[{"cells":["A | B","C:\\\\temp","  padded  ","Line one\\nLine two","<!--hvy:alt {\\"compact\\":\\"A|B\\"}-->Alpha<!--/hvy:alt-->"]}]}-->
`;
  const document = deserializeDocument(input, '.hvy');
  const expectedValues = document.sections[0]?.blocks[0]?.schema.tableRows;

  const serialized = serializeDocument(document);
  const roundTripped = deserializeDocument(serialized, '.hvy');

  expect(serialized).toContain('<!--hvy:table {"id":"facts","tableColumns":["Expression","Path","Spacing","Lines","Annotation"]}-->');
  expect(serialized).not.toContain('"tableRows"');
  expect(serialized).toContain('| A &#124; B | C:\\temp | &#32;&#32;padded&#32;&#32; | Line one&#10;Line two | <!--hvy:alt {"compact":"A&#124;B"}-->Alpha<!--/hvy:alt--> |');
  expect(roundTripped.sections[0]?.blocks[0]?.schema.tableRows).toEqual(expectedValues);
  expect(serializeDocument(roundTripped)).toBe(serialized);
});

test('non-GFM legacy static table text remains preserved alongside inline values', () => {
  const input = `---
hvy_version: 0.1
---

<!--hvy: {"id":"data"}-->
#! Data

<!--hvy:table {"id":"facts","tableColumns":["Name"],"tableRows":[{"cells":["Legacy"]}]}-->
 Legacy table note
`;
  const document = deserializeDocument(input, '.hvy');
  const serialized = serializeDocument(document);

  expect(document.sections[0]?.blocks[0]?.text).toBe('Legacy table note');
  expect(serialized).toContain('"tableRows":[{"cells":["Legacy"]}]');
  expect(serialized).toContain('Legacy table note');
});

test('static table GFM values enter keyword and semantic search without source scaffolding', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
title: Search Tables
---

<!--hvy: {"id":"data"}-->
#! Data

<!--hvy:table {"id":"facts","tableColumns":["Name","Detail"]}-->
 | Body Name | Body Detail |
 | --- | --- |
 | Needle | Left &#124; right |
`, '.hvy');

  const valueResults = await builtInSearchProvider({
    document,
    query: 'Left | right',
    caseSensitive: false,
    categories: ['contents'],
  });
  const entityResults = await builtInSearchProvider({
    document,
    query: '&#124;',
    caseSensitive: false,
    categories: ['contents'],
  });
  const bodyHeaderResults = await builtInSearchProvider({
    document,
    query: 'Body Name',
    caseSensitive: false,
    categories: ['contents'],
  });
  const inlineColumnResults = await builtInSearchProvider({
    document,
    query: 'Name',
    caseSensitive: false,
    categories: ['contents'],
  });
  const semanticTable = buildSemanticFilterRequest({ document, prompt: 'Find the needle table' })
    .candidates.find((candidate) => candidate.targetId === 'facts');

  expect(valueResults).toHaveLength(1);
  expect(valueResults[0]?.matches).toEqual([
    expect.objectContaining({ field: 'tableCells', label: 'Table', matchedText: 'Left | right' }),
  ]);
  expect(entityResults).toEqual([]);
  expect(bodyHeaderResults).toEqual([]);
  expect(inlineColumnResults[0]?.matches).toEqual([
    expect.objectContaining({ field: 'tableColumns', label: 'Table', matchedText: 'Name' }),
  ]);
  expect(semanticTable?.summary).toContain('Needle Left | right');
  expect(semanticTable?.summary).not.toContain('&#124;');
  expect(semanticTable?.summary).not.toContain('| --- |');
});
