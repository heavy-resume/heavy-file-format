import { expect, test } from 'vitest';

import { deserializeDocument } from '../src/serialization';
import { registerSerializationTestState, serializeWithState } from './serialization-test-helpers';

registerSerializationTestState();

const legacySnakeCaseDocument = `---
hvy_version: 0.1
section_defs:
  - name: Fake Template
    key: fake-template
    template:
      id: fake-template-section
      title: Fake Template
      exclude_from_import: true
      blocks: []
      children: []
---

<!--hvy: {"id":"fake-excluded","exclude_from_import":true}-->
#! Fake Excluded

<!--hvy: {"id":"fake-protected","protect_from_import":true}-->
#! Fake Protected
`;

test('legacy snake_case import flags load as camelCase flags', () => {
  const document = deserializeDocument(legacySnakeCaseDocument, '.hvy');

  expect(document.sections[0]?.excludeFromImport).toBe(true);
  expect(document.sections[1]?.protectFromImport).toBe(true);
});

test('legacy snake_case import flags are rewritten as camelCase on save', () => {
  const expectedResult = serializeWithState(deserializeDocument(legacySnakeCaseDocument, '.hvy'));

  expect(expectedResult).toMatch(/\{"id":"fake-excluded"[^}]*"excludeFromImport":true\}/);
  expect(expectedResult).toMatch(/\{"id":"fake-protected"[^}]*"protectFromImport":true\}/);
  expect(expectedResult).toContain('excludeFromImport: true');
  expect(expectedResult).not.toContain('exclude_from_import');
  expect(expectedResult).not.toContain('protect_from_import');
});
