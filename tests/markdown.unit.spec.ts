import { expect, test } from 'vitest';

import { convertMarkdownToHvyDocument } from '../src/markdown-import';
import {
  applyUnderlineSyntax,
  escapeRawHtml,
  markdownToReaderHtml,
  normalizeMarkdownIndentation,
  normalizeMarkdownLists,
  removeNonTextContentFromRichEditor,
  turndown,
} from '../src/markdown';
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

test('folds orphan wrapped bullet paragraphs back into the previous list item', () => {
  const html = markdownToReaderHtml(
    normalizeMarkdownLists('- First bullet starts here\n\nand this is the wrapped remainder\n- Second bullet')
  );

  expect(html).toContain('<ul>');
  expect(html).toContain('<li>First bullet starts here\nand this is the wrapped remainder</li>');
  expect(html).toContain('<li>Second bullet</li>');
  expect(html).not.toContain('</ul>\n<p>and this is the wrapped remainder</p>');
});

test('keeps a paragraph after a completed list as its own paragraph', () => {
  expect(normalizeMarkdownLists('- First bullet\n\nThis paragraph follows the list.')).toBe(
    '- First bullet\n\nThis paragraph follows the list.'
  );
});

test('renders bare inline checkbox markers as checkbox controls in reader html', () => {
  const html = markdownToReaderHtml('[ ] Draft task\n\n[x] Done task');

  expect(html).toContain('<div class="hvy-inline-checkbox-line">');
  expect(html).toContain('<input class="hvy-inline-checkbox" type="checkbox" contenteditable="false" disabled>');
  expect(html).toContain('<input class="hvy-inline-checkbox" type="checkbox" checked contenteditable="false" disabled>');
  expect(html).toContain('Draft task');
  expect(html).toContain('Done task');
  expect(html).not.toContain('<p><input class="hvy-inline-checkbox"');
  expect(html).not.toContain('[ ] Draft task');
  expect(html).not.toContain('[x] Done task');
});

test('keeps checkbox marker text literal inside code', () => {
  const html = markdownToReaderHtml('`[ ]` stays literal\n\n```md\n[x] also literal\n```');

  expect(html).toContain('<code>[ ]</code>');
  expect(html).toContain('[x] also literal');
  expect(html).not.toContain('hvy-inline-checkbox');
});

test('keeps markdown task list markers as task lists', () => {
  const html = markdownToReaderHtml('- [ ] Draft task\n- [x] Done task');

  expect(html).toContain('<ul>');
  expect(html).toContain('<li><input');
  expect(html).toContain('type="checkbox"');
  expect(html).not.toContain('hvy-inline-checkbox');
});

test('renders markdown quote markers as blockquotes', () => {
  const html = markdownToReaderHtml('> Alpha\n>\n> - Bravo\n> - Charlie\n>\n> Delta');

  expect(html).toContain('<blockquote>');
  expect(html).toContain('<p>Alpha</p>');
  expect(html).toContain('<ul>');
  expect(html).toContain('<li>Bravo</li>');
  expect(html).toContain('<li>Charlie</li>');
  expect(html).toContain('<p>Delta</p>');
  expect(html).not.toContain('&gt; Alpha');
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

test('serializes mailto links and drops empty editor links to plain text', () => {
  expect(turndown.turndown('<p><a href="mailto:person@example.com">person@example.com</a></p>')).toBe(
    '[person@example.com](mailto:person@example.com)'
  );
  expect(turndown.turndown('<p><a href="">person@example.com</a></p>')).toBe('person@example.com');
  expect(turndown.turndown('<p><a>person@example.com</a></p>')).toBe('person@example.com');
});

test('renders mailto links from text markdown', () => {
  expect(markdownToReaderHtml('[person@example.com](mailto:person@example.com)')).toContain(
    '<a href="mailto:person@example.com">person@example.com</a>'
  );
});

test('renders workspace markdown links disabled unless cross-document links are enabled', () => {
  const disabled = markdownToReaderHtml('[Other](./other.hvy#summary) and [Root](/docs/root.hvy)');
  expect(disabled).toContain('class="hvy-workspace-link-disabled"');
  expect(disabled).toContain('aria-disabled="true"');
  expect(disabled).not.toContain('href="./other.hvy#summary"');
  expect(disabled).not.toContain('href="/docs/root.hvy"');

  const enabled = markdownToReaderHtml('[Other](./other.hvy#summary)', { crossDocumentLinksEnabled: true });
  expect(enabled).toContain('href="./other.hvy#summary"');
  expect(enabled).toContain('data-hvy-cross-document="true"');
});

test('does not render markdown image syntax in text components', () => {
  expect(markdownToReaderHtml('Before ![Alt](https://example.invalid/image.png) after.')).toBe('<p>Before  after.</p>\n');
});

test('does not serialize pasted image html into text component markdown', () => {
  expect(turndown.turndown('<p>Before <img src="data:image/png;base64,AAAA" alt="Alt"> after.</p>')).toBe('Before  after.');
});

test('removes non-text media from rich editor content before serialization', () => {
  const removed: string[] = [];

  removeNonTextContentFromRichEditor({
    querySelectorAll: (selector: string) => {
      expect(selector).toContain('img');
      return [
        { remove: () => removed.push('img') },
        { remove: () => removed.push('canvas') },
      ] as unknown as NodeListOf<HTMLElement>;
    },
  } as unknown as ParentNode);

  expect(removed).toEqual(['img', 'canvas']);
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

test('renders soft-wrapped text line style paragraphs as one styled wrapper', () => {
  const html = markdownToReaderHtml(
    '^detail-body^ Planning, coordinating, and delivering cross-functional work with clear scope, ownership, timelines,\nrisks, and decision points.',
    {
      textLineStyles: {
        'detail-body': { label: 'Detail body', css: 'margin-left: 0.5rem;' },
      },
    }
  );

  expect(html.match(/data-hvy-text-line-style="detail-body"/g)).toHaveLength(1);
  expect(html).toContain('Planning, coordinating');
  expect(html).toContain('risks, and decision points.');
  expect(html).not.toContain('</div><p>risks');
});

test('stops text line style soft wrapping before structural markdown', () => {
  const html = markdownToReaderHtml('^detail-body^ Planning text\n- Separate list item', {
    textLineStyles: {
      'detail-body': { label: 'Detail body', css: 'margin-left: 0.5rem;' },
    },
  });

  expect(html.match(/data-hvy-text-line-style="detail-body"/g)).toHaveLength(1);
  expect(html).toContain('<ul>');
  expect(html).toContain('<li>Separate list item</li>');
});

test('stops text line style soft wrapping after a blank line', () => {
  const html = markdownToReaderHtml('^detail-body^ Planning text\n\nDefault paragraph.', {
    textLineStyles: {
      'detail-body': { label: 'Detail body', css: 'margin-left: 0.5rem;' },
    },
  });

  expect(html.match(/data-hvy-text-line-style="detail-body"/g)).toHaveLength(1);
  expect(html).toContain('<p>Default paragraph.</p>');
  expect(html).not.toContain('Planning text\nDefault paragraph');
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
  expect(
    turndown.turndown(
      '<div class="hvy-text-line-style" data-hvy-text-line-style="role"><span class="hvy-text-line-style-marker">^role^</span><p></p></div>'
    )
  ).toBe('^role^');
});

test('serializes rich editor fill-in markers back to value comments', () => {
  expect(
    turndown.turndown(
      '<p>Before <span class="text-fill-in-box text-fill-in-rich-marker" contenteditable="false" data-hvy-fill-in-marker="true" data-placeholder="Summary">Summary</span> after.</p>'
    )
  ).toBe('Before <!-- value {"placeholder":"Summary"} --> after.');
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
