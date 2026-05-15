import { expect, test } from 'vitest';

import { convertMarkdownToHvyDocument } from '../src/markdown-import';
import { applyUnderlineSyntax, escapeRawHtml, markdownToReaderHtml, normalizeMarkdownIndentation, normalizeMarkdownLists, turndown } from '../src/markdown';
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

test('normalizes ordered checkbox lists for plan progress', () => {
  expect(normalizeMarkdownLists('Plan progress:\n1. [ ] Inspect components\n2. [x] Patch forms')).toBe(
    'Plan progress:\n\n1. [ ] Inspect components\n2. [x] Patch forms'
  );
});

test('escapes raw html before applying underline syntax', () => {
  expect(applyUnderlineSyntax(escapeRawHtml('___safe___ <u>unsafe</u> <script>bad()</script>'))).toBe(
    '<u>safe</u> &lt;u&gt;unsafe&lt;/u&gt; &lt;script&gt;bad()&lt;/script&gt;'
  );
});

test('does not double escape literal angle brackets inside markdown code', () => {
  const html = markdownToReaderHtml('HVY directives are HTML comments: `<!--hvy:text {"id":"summary-text"}-->`.');

  expect(html).toContain('<code>&lt;!--hvy:text {&quot;id&quot;:&quot;summary-text&quot;}--&gt;</code>');
  expect(html).not.toContain('&amp;lt;!--');
});

test('keeps raw html escaped outside code while preserving fenced code literals', () => {
  const escaped = escapeRawHtml('<script>bad()</script>\n```html\n<div>literal</div>\n```');

  expect(escaped).toContain('&lt;script&gt;bad()&lt;/script&gt;');
  expect(escaped).toContain('<div>literal</div>');
});

test('serializes editor underline with hvy underline syntax', () => {
  expect(turndown.turndown('<p><u>Important</u></p>')).toBe('___Important___');
});

test('does not treat C++ as underline syntax', () => {
  expect(applyUnderlineSyntax('Use C++ for native modules.')).toBe('Use C++ for native modules.');
});

test('serializes editor inline code with markdown backticks', () => {
  expect(turndown.turndown('<p>Use <code>foobar</code> now</p>')).toBe('Use `foobar` now');
});

test('serializes editor inline code with literal angle brackets', () => {
  expect(turndown.turndown('<p>Use <code>&lt;tag&gt;</code> now</p>')).toBe('Use `<tag>` now');
});

test('renders hvy alt annotations as responsive spans', () => {
  const html = markdownToReaderHtml('Use <!--hvy:alt {"compact":"Tools & Tech"}-->Tools & Technologies<!--/hvy:alt--> daily.');
  expect(html).toContain('data-hvy-alt="true"');
  expect(html).toContain('<span class="hvy-alt-full">Tools &amp; Technologies</span>');
  expect(html).toContain('<span class="hvy-alt-compact">Tools &amp; Tech</span>');
});

test('serializes editor alt annotations back to hvy comments', () => {
  expect(
    turndown.turndown(
      '<p><span class="hvy-alt" data-hvy-alt="true"><span class="hvy-alt-full">Tools &amp; Technologies</span><span class="hvy-alt-compact">Tools &amp; Tech</span></span></p>'
    )
  ).toBe('<!--hvy:alt {"compact":"Tools & Tech"}-->Tools & Technologies<!--/hvy:alt-->');
});

test('blank editor alt annotation serializes as original full text', () => {
  expect(
    turndown.turndown(
      '<p><span class="hvy-alt" data-hvy-alt="true"><span class="hvy-alt-full">Tools &amp; Technologies</span><span class="hvy-alt-compact"></span></span></p>'
    )
  ).toBe('Tools & Technologies');
});

test('renders and serializes hvy nowrap annotations', () => {
  const html = markdownToReaderHtml('Use <!--hvy:nowrap-->Tools & Technologies<!--/hvy:nowrap--> daily.');
  expect(html).toContain('data-hvy-nowrap="true"');
  expect(html).toContain('Tools &amp; Technologies');
  expect(turndown.turndown('<p><span class="hvy-nowrap" data-hvy-nowrap="true">Tools &amp; Technologies</span></p>')).toBe(
    '<!--hvy:nowrap-->Tools & Technologies<!--/hvy:nowrap-->'
  );
});

test('renders text line style markers as styled source-only wrappers', () => {
  const html = markdownToReaderHtml('^role^ #### Foo', {
    textLineStyles: {
      role: { label: 'Role heading', css: 'margin: 0.5rem 0; background-image: url("bad"); font-weight: 700;' },
    },
  });

  expect(html).toContain('data-hvy-text-line-style="role"');
  expect(html).toContain('font-weight: 700');
  expect(html).not.toContain('url(');
  expect(html).toContain('<h4>Foo</h4>');
  expect(html).not.toContain('^role^');
});

test('renders unknown text line styles as normal viewer content', () => {
  const html = markdownToReaderHtml('^missing^ #### Foo', { textLineStyles: {} });

  expect(html).not.toContain('data-hvy-text-line-style');
  expect(html).toContain('<h4>Foo</h4>');
  expect(html).not.toContain('^missing^');
});

test('preserves escaped and fenced text line style markers as literal text', () => {
  const escaped = markdownToReaderHtml('\\^role^ literal', {
    textLineStyles: { role: { label: 'Role', css: 'font-weight: 700;' } },
  });
  const fenced = markdownToReaderHtml('```md\n^role^ literal\n```', {
    textLineStyles: { role: { label: 'Role', css: 'font-weight: 700;' } },
  });

  expect(escaped).toContain('^role^ literal');
  expect(escaped).not.toContain('data-hvy-text-line-style');
  expect(fenced).toContain('^role^ literal');
  expect(fenced).not.toContain('data-hvy-text-line-style');
});

test('serializes editor text line style wrappers back to markers', () => {
  expect(
    turndown.turndown(
      '<div class="hvy-text-line-style" data-hvy-text-line-style="role"><span class="hvy-text-line-style-marker">^role^</span><h4>Foo</h4></div>'
    )
  ).toBe('^role^ #### Foo');
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
  expect(blocks[0]?.schema.tableColumns).toEqual(['Name', 'Count']);
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
