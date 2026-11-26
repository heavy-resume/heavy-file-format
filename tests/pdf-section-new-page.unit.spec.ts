import { expect, test } from 'vitest';

import { getHvyPdfBlob } from '../src/pdf-export/export';
import { deserializeDocument } from '../src/serialization';
import { serializeWithState, registerSerializationTestState } from './serialization-test-helpers';

registerSerializationTestState();

async function countPdfPages(hvySource: string, extension: '.hvy' | '.phvy'): Promise<number> {
  const blob = await getHvyPdfBlob(deserializeDocument(hvySource, extension));
  const pdfText = Buffer.from(await blob.arrayBuffer()).toString('latin1');
  return pdfText.match(/\/Type \/Page\b/g)?.length ?? 0;
}

test('startOnNewPage section metadata round-trips through serialize', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"fake-alpha"}-->
#! Fake Alpha

Alpha text.

<!--hvy: {"id":"fake-beta","startOnNewPage":true}-->
#! Fake Beta

Beta text.
`, '.phvy');

  const expectedResult = serializeWithState(document);

  expect(document.sections[1]?.startOnNewPage).toBe(true);
  expect(expectedResult.match(/"startOnNewPage":true/g)?.length).toBe(1);
  expect(expectedResult).toMatch(/\{"id":"fake-beta"[^}]*"startOnNewPage":true\}/);
});

test('PHVY export starts a startOnNewPage section on a new page', async () => {
  const withoutFlag = `---
hvy_version: 0.1
---

<!--hvy: {"id":"fake-alpha"}-->
#! Fake Alpha

Alpha text.

<!--hvy: {"id":"fake-beta"}-->
#! Fake Beta

Beta text.
`;

  expect(await countPdfPages(withoutFlag, '.phvy')).toBe(1);
  expect(await countPdfPages(withoutFlag.replace('{"id":"fake-beta"}', '{"id":"fake-beta","startOnNewPage":true}'), '.phvy')).toBe(2);
});

test('PHVY export does not add an empty page when a startOnNewPage section is already at the top of a page', async () => {
  const expectedResult = await countPdfPages(`---
hvy_version: 0.1
---

<!--hvy: {"id":"fake-alpha","startOnNewPage":true}-->
#! Fake Alpha

Alpha text.

<!--hvy: {"id":"fake-beta","startOnNewPage":true}-->
#! Fake Beta

Beta text.
`, '.phvy');

  expect(expectedResult).toBe(2);
});

test('HVY export ignores startOnNewPage because it is PHVY-only', async () => {
  const expectedResult = await countPdfPages(`---
hvy_version: 0.1
---

<!--hvy: {"id":"fake-alpha"}-->
#! Fake Alpha

Alpha text.

<!--hvy: {"id":"fake-beta","startOnNewPage":true}-->
#! Fake Beta

Beta text.
`, '.hvy');

  expect(expectedResult).toBe(1);
});
