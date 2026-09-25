import { expect, test } from 'vitest';
import { createHvyCliSession, executeHvyCliCommand } from '../src/cli-core/commands';
import { deserializeDocument, serializeDocument } from '../src/serialization';
import { parseDocumentEditToolRequest } from '../src/ai-document-tool-parsing';
import { getSectionDefsFromMeta } from '../src/component-defs';
import { registerSerializationTestState } from './serialization-test-helpers';

registerSerializationTestState();

test('expected result: CLI section insertion is confined to the document root', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
section_defs:
  - name: fake-template
    repeatable: true
    template:
      title: Fake Template
      blocks: []
---
<!--hvy: {"id":"fake-root"}-->
#! Fake Root
`, '.hvy');
  const session = createHvyCliSession();
  const before = serializeDocument(document);

  for (const destination of ['/body/fake-root', '/templates/sections/fake-template/template']) {
    await expect(executeHvyCliCommand(document, session,
      `hvy insert -1 section ${destination} fake-child "Fake Child"`
    )).rejects.toThrow('sections must be added at /body');
    expect(serializeDocument(document)).toBe(before);
    await expect(executeHvyCliCommand(document, session,
      `hvy insert -1 section ${destination} --from-template fake-template`
    )).rejects.toThrow('sections must be added at /body');
    expect(serializeDocument(document)).toBe(before);
  }

  await executeHvyCliCommand(document, session, 'hvy insert -1 section /body --from-template fake-template');
  expect(document.sections).toHaveLength(2);
  expect(document.sections[1].title).toBe('Fake Template');
  expect(document.sections[1]).not.toHaveProperty('children');
  expect(document.sections[1]).not.toHaveProperty('level');
  expect(getSectionDefsFromMeta(deserializeDocument(serializeDocument(document), '.hvy').meta)[0].template)
    .not.toHaveProperty('children');
});

test('expected result: AI tools accept root sections and reject nested section creation', () => {
  expect(parseDocumentEditToolRequest('{"tool":"create_section","position":"append-root","title":"Fake Section"}').ok).toBe(true);
  expect(parseDocumentEditToolRequest('{"tool":"create_section","position":"append-child","parent_section_ref":"fake-root","title":"Fake Section"}'))
    .toEqual({ ok: false, message: 'create_section.position must be append-root, before, or after.' });
});

test('expected result: heading depth does not create nested sections', () => {
  const document = deserializeDocument(`<!--hvy: {"id":"fake-first"}-->
#! Fake First
##! Fake content
<!--hvy: {"id":"fake-second"}-->
#! Fake Second
`, '.hvy');
  expect(document.sections.map(section => section.customId)).toEqual(['fake-first', 'fake-second']);
  expect(document.sections[0].blocks[0].text).toBe('##! Fake content');
  expect(document.sections.every(section => !('children' in section) && !('level' in section))).toBe(true);
});
