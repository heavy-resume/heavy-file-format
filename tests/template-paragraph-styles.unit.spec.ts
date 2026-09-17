import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { createEmptyBlock } from '../src/document-factory';
import { markdownToReaderHtml } from '../src/markdown';
import { applyReusableTemplateValues } from '../src/reusable-template-values';
import { deserializeDocument, deserializeDocumentBytes, serializeDocument } from '../src/serialization';

test('expected result: every paragraph in a resume skill description inherits its template style', () => {
  const document = deserializeDocumentBytes(readFileSync(new URL('../examples/resume.hvy', import.meta.url)), '.hvy');
  const block = createEmptyBlock('skill-record', false, document.meta);
  expect(block.schema.expandableContentBlocks?.children[0].text).toContain('^detail-body^ {% description | block %}');

  applyReusableTemplateValues(block, { skill: 'Fake Skill', description: 'Bar Moo cow\n\nThingamabob', notes: 'Fake notes' });

  const expectedResult = block.schema.expandableContentBlocks!.children[0].text;
  expect(expectedResult).toContain('^detail-body^ Bar Moo cow\n\n^detail-body^ Thingamabob');
  const html = markdownToReaderHtml(expectedResult, {
    textLineStyles: { 'detail-body': { label: 'Detail', css: 'padding-left: 1rem;' } },
  });
  expect(html).toMatch(/data-hvy-text-line-style="detail-body"[^>]*><p>Bar Moo cow<\/p>/);
  expect(html).toMatch(/data-hvy-text-line-style="detail-body"[^>]*><p>Thingamabob<\/p>/);

  document.sections[0].blocks.push(block);
  expect(deserializeDocument(serializeDocument(document), '.hvy').sections[0].blocks.at(-1)!
    .schema.expandableContentBlocks!.children[0].text).toBe(expectedResult);
});

test.each([
  ['Fake first\nsoft wrap\n\nFake second', '^fake^ Fake first\nsoft wrap\n\n^fake^ Fake second'],
  ['Fake first\r\n\r\nFake second', '^fake^ Fake first\n\n^fake^ Fake second'],
  ['Fake first\n\n^other^ Fake second\n\nFake third', '^fake^ Fake first\n\n^other^ Fake second\n\n^fake^ Fake third'],
  ['Fake first\n\n```\nFake code\n\nMore code\n```\n\nFake last', '^fake^ Fake first\n\n```\nFake code\n\nMore code\n```\n\n^fake^ Fake last'],
  ['Fake first\n\n- Fake item\n- Other item\n\nFake last', '^fake^ Fake first\n\n- Fake item\n- Other item\n\n^fake^ Fake last'],
])('expected result: paragraph style propagation preserves Markdown structure (%s)', (value, expectedResult) => {
  const block = createEmptyBlock('text');
  block.text = '^fake^ {% value %}\n\nUnstyled following paragraph';

  applyReusableTemplateValues(block, { value });

  expect(block.text).toBe(`${expectedResult}\n\nUnstyled following paragraph`);
});

test.each([
  '{% value | block %}',
  '\\^fake^ {% value | block %}',
  '```\n^fake^ {% value | block %}\n```',
  '    ^fake^ {% value | block %}',
])('expected result: literal markers and unstyled templates do not propagate styles (%s)', (template) => {
  const block = createEmptyBlock('text');
  block.text = template;

  applyReusableTemplateValues(block, { value: 'Fake first\n\nFake second' });

  expect(block.text).toBe(template.replace('{% value | block %}', 'Fake first\n\nFake second'));
});

test('expected result: non-Markdown bodies and schema fields retain literal multiline values', () => {
  const block = createEmptyBlock('plugin');
  block.text = '^fake^ {% value | block %}';
  block.schema.description = '^fake^ {% value | block %}';

  applyReusableTemplateValues(block, { value: 'Fake first\n\nFake second' });

  expect(block.text).toBe('^fake^ Fake first\n\nFake second');
  expect(block.schema.description).toBe('^fake^ Fake first\n\nFake second');
});
