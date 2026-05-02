import { expect, test } from 'vitest';

import { convertMarkdownToHvyDocument } from '../src/markdown-import';
import { applyUnderlineSyntax, escapeRawHtml, normalizeMarkdownIndentation, normalizeMarkdownLists, turndown } from '../src/markdown';
import { deserializeDocument, serializeDocument } from '../src/serialization';

test('normalizes fully indented text so indentation alone does not imply code', () => {
  expect(normalizeMarkdownIndentation('    Seattle, WA')).toBe('Seattle, WA');
});

test('preserves fenced code relative indentation after removing outer indentation', () => {
  expect(normalizeMarkdownIndentation('  ```ts\n    const answer = 42;\n  ```')).toBe('```ts\n  const answer = 42;\n```');
});

test('preserves nested list indentation when content starts at column zero', () => {
  expect(normalizeMarkdownIndentation('Skills\n  - TypeScript\n  - Testing')).toBe('Skills\n  - TypeScript\n  - Testing');
});

test('does not treat bold labels as star list items', () => {
  expect(normalizeMarkdownLists('**Location:** Seattle, WA')).toBe('**Location:** Seattle, WA');
  expect(normalizeMarkdownLists('**Target Location(s):** Remote, Seattle, San Francisco')).toBe(
    '**Target Location(s):** Remote, Seattle, San Francisco'
  );
});

test('escapes raw html before applying underline syntax', () => {
  expect(applyUnderlineSyntax(escapeRawHtml('++safe++ <u>unsafe</u> <script>bad()</script>'))).toBe(
    '<u>safe</u> &lt;u&gt;unsafe&lt;/u&gt; &lt;script&gt;bad()&lt;/script&gt;'
  );
});

test('serializes editor underline with hvy underline syntax', () => {
  expect(turndown.turndown('<p><u>Important</u></p>')).toBe('++Important++');
});

test('converts markdown headings into HVY section hierarchy', () => {
  const document = convertMarkdownToHvyDocument(`# Project Brief

Intro text.

## Goals

- Ship import
- Preserve tables
`);

  expect(document.extension).toBe('.hvy');
  expect(document.meta.reader_max_width).toBe('60rem');
  expect(document.meta.title).toBe('Project Brief');
  expect(document.sections).toHaveLength(1);
  expect(document.sections[0]?.title).toBe('Project Brief');
  expect(document.sections[0]?.blocks[0]?.schema.component).toBe('text');
  expect(document.sections[0]?.blocks[0]?.text).toBe('Intro text.');
  expect(document.sections[0]?.children[0]?.title).toBe('Goals');
  expect(document.sections[0]?.children[0]?.blocks[0]?.text).toBe('- Ship import\n- Preserve tables');
});

test('converts markdown tables to HVY tables and preserves fenced code as text markdown', () => {
  const document = convertMarkdownToHvyDocument(`# Data

| Name | Count |
| --- | ---: |
| Alpha | 2 |
| Beta | 5 |

\`\`\`sql
SELECT * FROM items;
\`\`\`
`);

  const blocks = document.sections[0]?.blocks ?? [];

  expect(blocks[0]?.schema.component).toBe('table');
  expect(blocks[0]?.schema.tableColumns).toBe('Name, Count');
  expect(blocks[0]?.schema.tableRows).toEqual([{ cells: ['Alpha', '2'] }, { cells: ['Beta', '5'] }]);
  expect(blocks[1]?.schema.component).toBe('text');
  expect(blocks[1]?.text).toBe('```sql\nSELECT * FROM items;\n```');
});

test('deserializes plain markdown as editable HVY instead of an empty document', () => {
  const document = deserializeDocument(`# Notes

Plain Markdown should not go blank.
`, '.md');

  expect(document.extension).toBe('.hvy');
  expect(document.meta.reader_max_width).toBe('60rem');
  expect(document.sections[0]?.title).toBe('Notes');
  expect(document.sections[0]?.blocks[0]?.text).toBe('Plain Markdown should not go blank.');

  const expectedResult = serializeDocument(document);
  expect(expectedResult).toContain('<!--hvy: {"id":"notes"');
  expect(expectedResult).toContain('<!--hvy:text {}-->');
  expect(expectedResult).toContain('Plain Markdown should not go blank.');
});
