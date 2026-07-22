import { expect, test } from 'vitest';

import { createBlankDocument, createEmptyBlock, createEmptySection, defaultBlockSchema } from '../src/document-factory';
import type { TextBlockSchema } from '../src/editor/types';
import { buildDocumentRichTextCopyPayload } from '../src/rich-text-copy';

test('buildDocumentRichTextCopyPayload linearizes PDF-rendered PHVY content as html and plain text', () => {
  const document = createBlankDocument('.phvy');
  const section = createEmptySection(1);
  section.title = 'Profile';
  const text = createEmptyBlock('text');
  text.text = 'Senior **engineer**\n\n- Builds tools';
  const table = createEmptyBlock('table');
  table.schema.tableColumns = ['Company', 'Impact'];
  table.schema.tableShowHeader = true;
  table.schema.tableRows = [{ cells: ['HVY', 'Shipped rich copy'] }];
  const container = createEmptyBlock('container');
  container.schema.containerTitle = 'Details';
  const nested = createEmptyBlock('text');
  nested.text = 'Nested _note_';
  container.schema.containerBlocks = [nested];
  const image = createEmptyBlock('image');
  image.schema.imageAlt = 'Portfolio screenshot';
  image.schema.caption = {
    text: 'Caption **text**',
    schema: defaultBlockSchema('text') as TextBlockSchema,
  };
  section.blocks = [text, table, container, image];
  const hidden = createEmptySection(1);
  hidden.title = 'Hidden';
  hidden.editorOnly = true;
  document.sections = [section, hidden];

  const payload = buildDocumentRichTextCopyPayload(document);

  expect(payload.plainText).not.toContain('Profile');
  expect(payload.plainText).toContain('Senior engineer');
  expect(payload.plainText).toContain('Builds tools');
  expect(payload.plainText).toContain('Company\tImpact\nHVY\tShipped rich copy');
  expect(payload.plainText).toContain('Details');
  expect(payload.plainText).toContain('Nested note');
  expect(payload.plainText).toContain('Portfolio screenshot');
  expect(payload.plainText).toContain('Caption text');
  expect(payload.plainText).not.toContain('Hidden');
  expect(payload.html).toContain('<article>');
  expect(payload.html).not.toContain('<h1>Profile</h1>');
  expect(payload.html).toContain('<strong>engineer</strong>');
  expect(payload.html).toContain('<table>');
  expect(payload.html).toContain('<strong>Details</strong>');
  expect(payload.html).toContain('Caption <strong>text</strong>');
  expect(payload.html).not.toContain('Hidden');
});

test('buildDocumentRichTextCopyPayload omits invisible PHVY fill-in markers', () => {
  const document = createBlankDocument('.phvy');
  const section = createEmptySection(1);
  const heading = createEmptyBlock('text');
  heading.schema.fillIn = true;
  heading.text = '**<!-- value {"placeholder":"A literal \"Accomplishments\" or \'\' if none given"} -->**';
  const list = createEmptyBlock('text');
  list.schema.fillIn = true;
  list.text = '- <!-- value {"placeholder":"Accomplishments as bulleted list"} -->';
  section.blocks = [heading, list];
  document.sections = [section];

  const payload = buildDocumentRichTextCopyPayload(document);

  expect(payload.plainText).toBe('');
  expect(payload.html).toContain('<ul>');
  expect(payload.plainText).not.toContain('<!-- value');
  expect(payload.html).not.toContain('<!-- value');
});
