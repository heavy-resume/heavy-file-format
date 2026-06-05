import { afterEach, expect, test, vi } from 'vitest';

import { setReferenceAppConfig } from '../src/reference-config';
import { deserializeDocument } from '../src/serialization';
import { populateMissingDescriptions } from '../src/descriptions/populate';
import { buildDescriptionRequest, openAiDescriptionProvider } from '../src/descriptions/provider';
import { setHostChatClient } from '../src/chat/chat';

const originalFetch = globalThis.fetch;

afterEach(() => {
  setReferenceAppConfig(null);
  setHostChatClient(null);
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

test('populateMissingDescriptions fills only structural descriptions through the configured provider', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"history"}-->
#! History

<!--hvy:text {"id":"northwind","description":"Existing description"}-->
 Northwind Labs

<!--hvy:component-list {"id":"history-skills"}-->

 <!--hvy:component-list:0 {}-->

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
  expect(expectedResult.skippedLeaves).toBe(1);
  expect(requestedKinds).toEqual(['section', 'block']);
  expect(document.sections[0]!.description).toBe('section: History Northwind La');
  expect(document.sections[0]!.blocks[0]!.schema.description).toBe('Existing description');
  expect(document.sections[0]!.blocks[1]!.schema.description).toBe('block: Heavy Stack');
  expect(document.sections[0]!.blocks[1]!.schema.componentListBlocks[0]!.schema.description).toBe('');
});

test('buildDescriptionRequest summarizes table responsive annotations as visible text', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"history"}-->
#! History

<!--hvy:table {"id":"history-table","tableColumns":["TITLE","<!--hvy:alt {\\"compact\\":\\"ORG\\"}-->ORGANIZATION<!--/hvy:alt-->","DATES"],"tableRows":[]}-->
`, '.hvy');

  const expectedResult = buildDescriptionRequest({
    document,
    section: document.sections[0]!,
    block: document.sections[0]!.blocks[0]!,
    kind: 'block',
  });

  expect(expectedResult.contentSummary).toContain('TITLE ORGANIZATION DATES');
  expect(expectedResult.contentSummary).not.toContain('hvy:alt');
});

test('populateMissingDescriptions skips plain layout containers without title or border', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"layout-test","description":"Layout test section"}-->
#! Layout Test

<!--hvy:container {"id":"layout-wrapper"}-->

<!--hvy:container {"id":"titled-panel","containerTitle":"Details"}-->

<!--hvy:container {"id":"bordered-panel","css":"border: 1px solid var(--hvy-border);"}-->

<!--hvy:grid {"id":"layout-grid"}-->

 <!--hvy:grid:0 {"id":"grid-cell"}-->

  <!--hvy:text {"id":"grid-text"}-->
   Grid content
`, '.hvy');
  const requestedIds: string[] = [];
  setReferenceAppConfig({
    descriptionProvider: (request) => {
      requestedIds.push(request.block?.schema.id ?? request.section?.customId ?? request.kind);
      return { description: `generated ${request.block?.schema.id ?? request.kind}` };
    },
  });

  const expectedResult = await populateMissingDescriptions(document);

  expect(expectedResult.updated).toBe(2);
  expect(expectedResult.skippedLeaves).toBe(3);
  expect(requestedIds).toEqual(['titled-panel', 'bordered-panel']);
  expect(document.sections[0]!.blocks[0]!.schema.description).toBe('');
  expect(document.sections[0]!.blocks[1]!.schema.description).toBe('generated titled-panel');
  expect(document.sections[0]!.blocks[2]!.schema.description).toBe('generated bordered-panel');
  expect(document.sections[0]!.blocks[3]!.schema.description).toBe('');
  expect(document.sections[0]!.blocks[3]!.schema.gridItems[0]!.block.schema.description).toBe('');
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

  expect(expectedResult.updated).toBe(2);
  expect(expectedResult.skippedLeaves).toBe(2);
  expect(block.schema.description).toBe('Project record');
  expect(block.schema.expandableStubDescription).toBe('generated expandable-stub');
  expect(block.schema.expandableContentDescription).toBe('generated expandable-content');
  expect(block.schema.expandableStubBlocks.children[0]!.schema.description).toBe('');
  expect(block.schema.expandableContentBlocks.children[0]!.schema.description).toBe('');
});

test('populateMissingDescriptions sends populated parent descriptions in the parent tree', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"history","description":"Work history section"}-->
#! History

<!--hvy:expandable {"id":"northwind","description":"history role entry"}-->

 <!--hvy:expandable:content {}-->

  <!--hvy:text {}-->
   ### Northwind Labs

 <!--hvy:expandable:content {}-->

  <!--hvy:component-list {"id":"northwind-skills"}-->

   <!--hvy:component-list:0 {}-->

    <!--hvy:text {}-->
     Skill reference
`, '.hvy');
  const parentTrees: string[][] = [];
  setReferenceAppConfig({
    descriptionProvider: (request) => {
      if (request.block?.schema.id === 'northwind-skills') {
        parentTrees.push(request.parentTree.map((entry) => `${entry.label}: ${entry.description ?? ''}`));
      }
      return { description: `generated ${request.kind}` };
    },
  });

  await populateMissingDescriptions(document);

  expect(parentTrees).toEqual([[
    'History: Work history section',
    'Northwind Labs: history role entry',
  ]]);
});

test('openAiDescriptionProvider sends the app proxy payload', async () => {
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
  });
  expect(payload.messages).toEqual([
    { id: 'system', role: 'system', content: 'Return only the description text.' },
    { id: 'description-request', role: 'user', content: 'Write the description now.' },
  ]);
  expect(payload.context).toContain('Generate one concise search location description');
  expect(payload.context).toContain('Write a shorthand label, not a sentence.');
  expect(payload.context).toContain('Keep it under 8 words when possible.');
  expect(payload.context).toContain('Describe what function this location serves in the document.');
  expect(payload.context).toContain('Do not summarize, restate, or describe the specific contents found here.');
  expect(payload.context).toContain('Combine the owning context with the local function when both are available.');
  expect(payload.context).toContain('If an owning context is provided, include it in the description.');
  expect(payload).not.toHaveProperty('input');
});

test('openAiDescriptionProvider uses the installed host chat client', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"skills"}-->
#! Skills

<!--hvy:text {"id":"typescript"}-->
 TypeScript
`, '.hvy');
  globalThis.fetch = vi.fn() as typeof fetch;
  const complete = vi.fn(async () => ({ output: 'TypeScript skill summary' }));
  setHostChatClient({ complete });

  const expectedResult = await openAiDescriptionProvider(buildDescriptionRequest({
    document,
    section: document.sections[0]!,
    block: document.sections[0]!.blocks[0]!,
    kind: 'block',
    parentTrail: ['Skills'],
  }));

  expect(expectedResult.description).toBe('TypeScript skill summary');
  expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(complete).toHaveBeenCalledTimes(1);
  const [request, options] = complete.mock.calls[0] as any[];
  expect(request).toMatchObject({
    provider: 'openai',
    model: 'gpt-5.4-nano',
    mode: 'qa',
  });
  expect(options?.debugLabel).toBe('description-generation');
  expect(request.context).toContain('Generate one concise search location description');
});
