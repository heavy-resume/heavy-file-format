import { beforeEach, expect, test, vi } from 'vitest';

const { requestProxyCompletionMock } = vi.hoisted(() => ({
  requestProxyCompletionMock: vi.fn(),
}));

vi.mock('../src/chat/chat', () => ({
  requestProxyCompletion: requestProxyCompletionMock,
}));

import { buildImportXrefBatches } from '../src/ai-import-xref-batches';
import { applyImportXrefResponse, runImportXrefPass } from '../src/ai-import-xrefs';
import { deserializeDocument, serializeDocument } from '../src/serialization';

beforeEach(() => {
  requestProxyCompletionMock.mockReset();
});

test('applyImportXrefResponse fills valid xref items and strips generated ids', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"tool-typescript","tags":"tool"}-->
TypeScript

<!--hvy:component-list {"id":"refs","componentListComponent":"xref-card"}-->
`, '.hvy');
  const batch = buildImportXrefBatches(document, [document.sections[0]!.key])[0]!;

  const expectedResult = applyImportXrefResponse(document, batch, '{"L1":[{"xrefTarget":"tool-typescript","xrefTitle":"TypeScript","xrefDetail":"Primary language"}]}');

  const serialized = serializeDocument(document);
  expect(expectedResult).toBe(1);
  expect(serialized).toContain('<!--hvy:xref-card {"xrefTitle":"TypeScript","xrefDetail":"Primary language","xrefTarget":"tool-typescript"}-->');
  expect(serialized).not.toContain('<!--hvy:xref-card {"id"');
});

test('applyImportXrefResponse leaves omitted list ids unchanged', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"tool-typescript","tags":"tool"}-->
TypeScript

<!--hvy:component-list {"id":"refs","componentListComponent":"xref-card"}-->
 <!--hvy:component-list:0 {}-->
  <!--hvy:xref-card {"xrefTitle":"Existing","xrefTarget":"tool-typescript"}-->
`, '.hvy');
  const batch = buildImportXrefBatches(document, [document.sections[0]!.key])[0]!;

  const expectedResult = applyImportXrefResponse(document, batch, '{}');

  expect(expectedResult).toBe(0);
  expect(serializeDocument(document)).toContain('Existing');
});

test('applyImportXrefResponse clears a list for an empty array', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"tool-typescript","tags":"tool"}-->
TypeScript

<!--hvy:component-list {"id":"refs","componentListComponent":"xref-card"}-->
 <!--hvy:component-list:0 {}-->
  <!--hvy:xref-card {"xrefTitle":"Existing","xrefTarget":"tool-typescript"}-->
`, '.hvy');
  const batch = buildImportXrefBatches(document, [document.sections[0]!.key])[0]!;

  const expectedResult = applyImportXrefResponse(document, batch, '{"L1":[]}');

  expect(expectedResult).toBe(1);
  expect(serializeDocument(document)).not.toContain('Existing');
});

test('applyImportXrefResponse drops invalid targets', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"tool-typescript","tags":"tool"}-->
TypeScript

<!--hvy:component-list {"id":"refs","componentListComponent":"xref-card"}-->
`, '.hvy');
  const batch = buildImportXrefBatches(document, [document.sections[0]!.key])[0]!;

  const expectedResult = applyImportXrefResponse(document, batch, '{"L1":[{"xrefTarget":"missing-target","xrefTitle":"Missing"}]}');

  expect(expectedResult).toBe(1);
  expect(serializeDocument(document)).not.toContain('Missing');
});

test('runImportXrefPass skips the model when imported sections have no eligible lists', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"summary-text"}-->
Summary
`, '.hvy');

  const expectedResult = await runImportXrefPass(
    document,
    {
      sourceName: 'notes.txt',
      sourceText: 'Summary',
    },
    {
      settings: { provider: 'openai', model: 'fallback-model' },
      client: { complete: vi.fn() },
    },
    undefined,
    undefined,
    [document.sections[0]!.key],
    []
  );

  expect(expectedResult).toBe(0);
  expect(requestProxyCompletionMock).not.toHaveBeenCalled();
});
