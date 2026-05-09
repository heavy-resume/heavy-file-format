import { afterEach, expect, test, vi } from 'vitest';

import { setReferenceAppConfig } from '../src/reference-config';
import { deserializeDocument } from '../src/serialization';
import { populateMissingDescriptions } from '../src/descriptions/populate';
import { buildDescriptionRequest, openAiDescriptionProvider } from '../src/descriptions/provider';

const originalFetch = globalThis.fetch;

afterEach(() => {
  setReferenceAppConfig(null);
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

test('populateMissingDescriptions fills only missing component descriptions through the configured provider', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"history"}-->
#! History

<!--hvy:text {"id":"northwind","description":"Existing description"}-->
 Northwind Labs

<!--hvy:text {"id":"heavy-stack"}-->
 Heavy Stack
`, '.hvy');
  const requestedKinds: string[] = [];
  setReferenceAppConfig({
    descriptionProvider: (request) => {
      requestedKinds.push(request.kind);
      return { description: `${request.kind}: ${request.contentSummary.slice(0, 20)}` };
    },
  });

  const expectedResult = await populateMissingDescriptions(document);

  expect(expectedResult.updated).toBe(2);
  expect(requestedKinds).toEqual(['section', 'block']);
  expect(document.sections[0]!.description).toBe('section: History Northwind La');
  expect(document.sections[0]!.blocks[0]!.schema.description).toBe('Existing description');
  expect(document.sections[0]!.blocks[1]!.schema.description).toBe('block: Heavy Stack');
});

test('populateMissingDescriptions includes expandable stub and expanded pane descriptions', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"projects","description":"Projects section"}-->
#! Projects

<!--hvy:expandable {"id":"heavy-stack","description":"Project record"}-->

 <!--hvy:expandable:stub {}-->

  <!--hvy:text {}-->
   Heavy Stack

 <!--hvy:expandable:content {}-->

  <!--hvy:text {}-->
   Developer container and testing workflow
`, '.hvy');
  setReferenceAppConfig({
    descriptionProvider: (request) => ({ description: `generated ${request.kind}` }),
  });

  const expectedResult = await populateMissingDescriptions(document);
  const block = document.sections[0]!.blocks[0]!;

  expect(expectedResult.updated).toBe(4);
  expect(block.schema.description).toBe('Project record');
  expect(block.schema.expandableStubDescription).toBe('generated expandable-stub');
  expect(block.schema.expandableContentDescription).toBe('generated expandable-content');
  expect(block.schema.expandableStubBlocks.children[0]!.schema.description).toBe('generated block');
  expect(block.schema.expandableContentBlocks.children[0]!.schema.description).toBe('generated block');
});

test('openAiDescriptionProvider sends the app proxy payload with reasoning disabled', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"skills"}-->
#! Skills

<!--hvy:text {"id":"typescript"}-->
 TypeScript
`, '.hvy');
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ output: 'TypeScript skill summary' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })) as typeof fetch;

  const expectedResult = await openAiDescriptionProvider(buildDescriptionRequest({
    document,
    section: document.sections[0]!,
    block: document.sections[0]!.blocks[0]!,
    kind: 'block',
    parentTrail: ['Skills'],
  }));

  expect(expectedResult.description).toBe('TypeScript skill summary');
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  const [, init] = vi.mocked(globalThis.fetch).mock.calls[0]!;
  const payload = JSON.parse(String(init?.body));
  expect(payload).toMatchObject({
    provider: 'openai',
    model: 'gpt-5.4-nano',
    mode: 'qa',
    openAiReasoningEffort: 'none',
    messages: [{ role: 'user', content: 'Write the description now.' }],
  });
  expect(payload).not.toHaveProperty('input');
});
