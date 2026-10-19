import { expect, test } from 'vitest';

import { createHvyCliSession, executeHvyCliCommand } from '../src/cli-core/commands';
import { deserializeDocument, serializeDocument } from '../src/serialization';

// Plugin inserts accept `[ID|--id ID]` like other components, and never treat
// an option as a positional name.
function createFakeDocument() {
  return deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"fake-section"}-->
#! Fake Section
`, '.hvy');
}

test.each([
  ['hvy insert -1 plugin /body/fake-section --id fake-raw hvy.fake', '<!--hvy:plugin {"id":"fake-raw","plugin":"hvy.fake"'],
  ['hvy insert -1 plugin /body/fake-section hvy.fake --id fake-raw', '<!--hvy:plugin {"id":"fake-raw","plugin":"hvy.fake"'],
  ['hvy insert -1 plugin /body/fake-section fake-raw hvy.fake', '<!--hvy:plugin {"id":"fake-raw","plugin":"hvy.fake"'],
  ['hvy insert -1 plugin form /body/fake-section --id fake-form', '<!--hvy:plugin {"id":"fake-form","plugin":"hvy.form"'],
  ['hvy insert -1 plugin db-table /body/fake-section --id fake-table', '<!--hvy:plugin {"id":"fake-table","plugin":"hvy.db-table"'],
])('%s creates the plugin with the given id', async (command, expectedSerializedBlock) => {
  const document = createFakeDocument();
  const session = createHvyCliSession();

  await executeHvyCliCommand(document, session, command);

  expect(serializeDocument(document)).toContain(expectedSerializedBlock);
});

test.each([
  ['hvy insert -1 plugin /body/fake-section --name fake-raw hvy.fake', 'hvy insert plugin: use --id ID, not --name.'],
  ['hvy insert -1 plugin /body/fake-section --fake-flag fake-raw hvy.fake', 'hvy insert plugin: unsupported option --fake-flag'],
  ['hvy insert -1 plugin /body/fake-section hvy.fake --id', 'hvy insert plugin: --id requires a value.'],
  ['hvy insert -1 plugin /body/fake-section fake-raw --id fake-other hvy.fake', 'hvy insert plugin: creation accepts either positional ID or --id ID, not both.'],
  ['hvy insert -1 plugin /body/fake-section hvy.fake', 'hvy insert plugin: expected SECTION_PATH [ID|--id ID] PLUGIN_ID'],
  ['hvy insert -1 plugin form /body/fake-section --fake-flag fake-form', 'hvy insert plugin form: unsupported option --fake-flag'],
  ['hvy insert -1 plugin db-table /body/fake-section --id fake-table extra', 'hvy insert plugin db-table: creation accepts either positional ID or --id ID, not both.'],
])('%s is rejected without changing the document', async (command, expectedError) => {
  const document = createFakeDocument();
  const before = serializeDocument(document);

  await expect(executeHvyCliCommand(document, createHvyCliSession(), command)).rejects.toThrow(expectedError);

  expect(serializeDocument(document)).toBe(before);
});
