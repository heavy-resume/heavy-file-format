import { beforeEach, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const { requestProxyCompletionMock, requestAiComponentEditMock } = vi.hoisted(() => ({
  requestProxyCompletionMock: vi.fn(),
  requestAiComponentEditMock: vi.fn(),
}));

vi.mock('../src/chat', () => ({
  requestProxyCompletion: requestProxyCompletionMock,
}));

vi.mock('../src/ai-edit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ai-edit')>();
  return {
    ...actual,
    requestAiComponentEdit: requestAiComponentEditMock,
  };
});

import { buildDocumentEditFormatInstructions, requestAiDocumentEditTurn, summarizeDocumentStructure } from '../src/ai-document-edit';
import { deserializeDocument, serializeDocument } from '../src/serialization';
import { initState } from '../src/state';
import type { ChatSettings } from '../src/types';

beforeEach(() => {
  requestProxyCompletionMock.mockReset();
  requestAiComponentEditMock.mockReset();
});

function seedStateForDocument(document: ReturnType<typeof deserializeDocument>): void {
  initState({
    document,
    showAdvancedEditor: true,
  } as never);
}

function seedStateForParsing(): void {
  initState({
    document: {
      meta: {},
      extension: '.hvy',
      sections: [],
    },
    showAdvancedEditor: true,
  } as never);
}

function queueAiToolResponses(...responses: string[]): void {
  for (const response of responses) {
    requestProxyCompletionMock.mockResolvedValueOnce(response);
  }
}

function lastToolResultBeforeCall(callIndex: number): string {
  return requestProxyCompletionMock.mock.calls[callIndex]?.[0]?.messages.at(-1)?.content ?? '';
}

test('summarizeDocumentStructure produces section and component refs with visible ids and text', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"skills"}-->
#! Skills

<!--hvy:xref-card {"xrefTitle":"Python","xrefDetail":"Automation","xrefTarget":"tool-python","id":"skill-python-card"}-->

<!--hvy:expandable {"id":"python-details","expandableAlwaysShowStub":true,"expandableExpanded":false}-->

 <!--hvy:expandable:stub {}-->

  <!--hvy:text {}-->
   Python usage

 <!--hvy:expandable:content {}-->

  <!--hvy:text {}-->
   More detail
`, '.hvy');

  const summary = summarizeDocumentStructure(document);

  expect(summary.summary).toContain('<!-- section id="skills" title="Skills" location="main" -->');
  expect(summary.summary).toContain('# Skills');
  expect(summary.summary).toContain('Python - Automation <!-- xref-card id="skill-python-card" -->');
  expect(summary.summary).toContain('Python usage <!-- expandable id="python-details" -->');
  expect(summary.sectionRefs.get('skills')?.title).toBe('Skills');
  expect(summary.componentRefs.get('skill-python-card')?.component).toBe('xref-card');
});

test('summarizeDocumentStructure hides content deeper than three nesting levels', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"deep"}-->
#! Deep

<!--hvy:container {}-->

 <!--hvy:container {}-->

  <!--hvy:container {}-->

   <!--hvy:container {}-->

    <!--hvy:text {}-->
     Hidden leaf
`, '.hvy');

  const summary = summarizeDocumentStructure(document);

  expect(summary.summary).toContain('... contents hidden ...');
  expect(summary.summary).not.toContain('Hidden leaf');
});

test('summarizeDocumentStructure shows the exact reduced structure the AI sees', () => {
  const inputFixturePath = new URL('./fixtures/resume-structure-input.hvy', import.meta.url);
  const expectedFixturePath = new URL('./fixtures/resume-structure-expected.txt', import.meta.url);
  const input = readFileSync(inputFixturePath, 'utf8');
  const expected = readFileSync(expectedFixturePath, 'utf8');
  seedStateForParsing();
  const document = deserializeDocument(input, '.hvy');
  const summary = summarizeDocumentStructure(document);

  expect(summary.summary).toBe(expected.trimEnd());
});

test('buildDocumentEditFormatInstructions documents the tool protocol', () => {
  const instructions = buildDocumentEditFormatInstructions();
  expect(instructions).toContain(
    'Valid tools are: `grep`, `view_component`, `edit_component`, `patch_component`, `create_component`, `remove_component`, `create_section`, `remove_section`, `reorder_section`, `request_structure`, `done`.'
  );
  expect(instructions).toContain('It may revise that component in place or fully replace it');
  expect(instructions).toContain('Use real section ids when a section has an id.');
  expect(instructions).toContain('Use `grep` to search the whole serialized document with a regex pattern.');
  expect(instructions).toContain('alternation like `Python|TypeScript`');
  expect(instructions).toContain('defaults to lines 1-200');
  expect(instructions).toContain('{"tool":"grep","query":"Python|TypeScript","flags":"i","before":2,"after":2,"max_count":3,"reason":"optional"}');
  expect(instructions).toContain('{"tool":"grep","query":"/Python|TypeScript/i","before":2,"after":2,"max_count":3,"reason":"optional"}');
  expect(instructions).toContain('{"tool":"patch_component","component_ref":"C3","edits":[{"op":"replace","start_line":2,"end_line":2,"text":" New content"}],"reason":"optional"}');
  expect(instructions).toContain('{"tool":"create_component","position":"append-to-section","section_ref":"skills","hvy":"<!--hvy:text {}-->\\n New content","reason":"optional"}');
  expect(instructions).toContain('{"tool":"remove_component","component_ref":"C3","reason":"optional"}');
  expect(instructions).toContain('{"tool":"remove_section","section_ref":"skills","reason":"optional"}');
  expect(instructions).toContain('{"tool":"done","summary":"Short summary of what changed."}');
});

test('requestAiDocumentEditTurn can grep the serialized document with context and component ids', async () => {
  queueAiToolResponses(
    '{"tool":"grep","query":"python|tail","flags":"i","before":1,"after":1,"max_count":2}',
    '{"tool":"done","summary":"Searched for Python."}'
  );

  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"skills"}-->
#! Skills

<!--hvy:text {"id":"intro"}-->
 Intro line

<!--hvy:xref-card {"id":"skill-python-card","xrefTitle":"Python","xrefDetail":"Automation","xrefTarget":"tool-python"}-->

<!--hvy:text {"id":"tail"}-->
 Tail line
`, '.hvy');
  seedStateForDocument(document);
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Search for Python in the document.',
  });

  expect(result.error).toBeNull();
  const grepResult = lastToolResultBeforeCall(1);
  expect(grepResult).toContain('Match 1 of 2 (component_id="skill-python-card")');
  expect(grepResult).toContain('Match 2 of 2 (component_id="tail")');
  expect(grepResult).toContain('<!--hvy:xref-card {"id":"skill-python-card"');
  expect(grepResult).toContain('Tail line');
});

test('requestAiDocumentEditTurn greps wrapped serialized lines with post-wrap line numbers', async () => {
  const beforeHvy = `---
hvy_version: 0.1
---

<!--hvy: {"id":"long-lines"}-->
#! Long Lines

<!--hvy:text {"id":"long-text"}-->
 ${'a'.repeat(410)}wrapped-needle
`;

  queueAiToolResponses(
    '{"tool":"grep","query":"wrapped-needle","before":1,"after":0,"max_count":1}',
    '{"tool":"done","summary":"Searched wrapped lines."}'
  );

  const document = deserializeDocument(beforeHvy, '.hvy');
  seedStateForDocument(document);
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Search for the wrapped needle.',
  });

  expect(result.error).toBeNull();
  const grepResult = lastToolResultBeforeCall(1);
  expect(grepResult).toContain('Match 1 of 1 (component_id="long-text")');
  expect(grepResult).toContain(`   9 | ${' '.repeat(2)}${'a'.repeat(398)}`);
  expect(grepResult).toContain(`  10 | ${'a'.repeat(12)}wrapped-needle`);
});

test('requestAiDocumentEditTurn can patch a component after viewing numbered lines', async () => {
  const beforeHvy = `---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"summary-text"}-->
 Existing content
`;
  queueAiToolResponses(
    '{"tool":"view_component","component_ref":"summary-text"}',
    '{"tool":"patch_component","component_ref":"summary-text","edits":[{"op":"replace","start_line":2,"end_line":2,"text":" Updated content"}]}',
    '{"tool":"done","summary":"Patched the summary text."}'
  );

  const document = deserializeDocument(beforeHvy, '.hvy');
  seedStateForDocument(document);
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Change the existing text to say Updated content.',
  });

  expect(result.error).toBeNull();
  const prePatchView = lastToolResultBeforeCall(1);
  expect(prePatchView).toContain('Showing lines 1-2 (default range is 1-200)');
  expect(prePatchView).toContain('  1 | <!--hvy:text {"id":"summary-text"}-->');
  expect(prePatchView).toContain('  2 |  Existing content');
  expect(serializeDocument(document)).toBe(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary","lock":false,"expanded":true,"highlight":false}-->
#! Summary

 <!--hvy:text {"id":"summary-text"}-->
  Updated content
`);
});

test('requestAiDocumentEditTurn can create a component in a section', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce('{"tool":"create_component","position":"append-to-section","section_ref":"summary","hvy":"<!--hvy:text {}-->\\n Added content"}')
    .mockResolvedValueOnce('{"tool":"done","summary":"Added a new text component."}');

  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {}-->
 Existing content
`, '.hvy');
  seedStateForDocument(document);
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Add another text block to the summary section.',
  });

  expect(result.error).toBeNull();
  expect(document.sections[0]?.blocks).toHaveLength(2);
  expect(document.sections[0]?.blocks[1]?.schema.component).toBe('text');
  expect(document.sections[0]?.blocks[1]?.text).toBe('Added content');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).toContain('<!-- section id="summary" title="Summary" location="main" -->');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).toContain('Reduced document structure was already provided earlier');
  expect(result.messages.at(-1)).toEqual(
    expect.objectContaining({
      role: 'assistant',
      content: 'Added a new text component.',
    })
  );
});

test('requestAiDocumentEditTurn can remove a section', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce('{"tool":"remove_section","section_ref":"details"}')
    .mockResolvedValueOnce('{"tool":"done","summary":"Removed the extra section."}');

  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {}-->
 Existing content

<!--hvy: {"id":"details"}-->
#! Details

<!--hvy:text {}-->
 Extra content
`, '.hvy');
  seedStateForDocument(document);
  const settings: ChatSettings = { provider: 'anthropic', model: 'claude-sonnet-4-6' };

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Remove the details section.',
  });

  expect(result.error).toBeNull();
  expect(document.sections).toHaveLength(1);
  expect(document.sections[0]?.title).toBe('Summary');
  expect(result.messages.at(-1)).toEqual(
    expect.objectContaining({
      role: 'assistant',
      content: 'Removed the extra section.',
    })
  );
});
