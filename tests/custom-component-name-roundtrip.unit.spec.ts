import { expect, it } from 'vitest';
import { deserializeDocumentBytes, serializeDocumentBytes } from '../src/serialization';

it('preserves custom component names and inherited styles across a round trip', () => {
  const source = new TextEncoder().encode(`---
hvy_version: 0.1
component_defs:
  - name: FakeProfile
    baseType: text
    schema:
      css: "color: navy;"
      align: center
---
#! Sample
<!--hvy:FakeProfile {}-->
Filled value
`);
  const document = deserializeDocumentBytes(source, '.hvy');
  expect(document.sections[0].blocks[0].schema.component).toBe('FakeProfile');
  expect(document.sections[0].blocks[0].schema.css).toBe('color: navy;');
  const reopened = deserializeDocumentBytes(serializeDocumentBytes(document), '.hvy');
  expect(reopened.sections[0].blocks[0].schema.component).toBe('FakeProfile');
  expect(reopened.sections[0].blocks[0].schema.css).toBe('color: navy;');
  expect(reopened.sections[0].blocks[0].schema.align).toBe('center');
  expect(reopened.sections[0].blocks[0].text).toContain('Filled value');
});
