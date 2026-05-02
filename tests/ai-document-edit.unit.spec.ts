import { beforeEach, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const { requestProxyCompletionMock, requestAiComponentEditMock } = vi.hoisted(() => ({
  requestProxyCompletionMock: vi.fn(),
  requestAiComponentEditMock: vi.fn(),
}));

vi.mock('../src/chat/chat', () => ({
  requestProxyCompletion: requestProxyCompletionMock,
}));

vi.mock('../src/ai-edit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ai-edit')>();
  return {
    ...actual,
    requestAiComponentEdit: requestAiComponentEditMock,
  };
});

import { requestAiDocumentEditTurn, summarizeDocumentStructure, summarizeHeaderStructure } from '../src/ai-document-edit';
import {
  buildDocumentEditFormatInstructions,
  buildEditPathSelectionInstructions,
  buildHeaderEditFormatInstructions,
} from '../src/ai-document-edit-instructions';
import { deserializeDocument, serializeDocument } from '../src/serialization';
import { initState } from '../src/state';
import type { ChatMessage, ChatSettings } from '../src/types';
import { dbTablePluginRegistration } from '../src/plugins/db-table-plugin';
import { setHostPlugins } from '../src/plugins/registry';

beforeEach(() => {
  requestProxyCompletionMock.mockReset();
  requestAiComponentEditMock.mockReset();
  setHostPlugins([]);
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
  requestProxyCompletionMock.mockResolvedValueOnce('document');
  for (const response of responses) {
    requestProxyCompletionMock.mockResolvedValueOnce(response);
  }
}

function lastToolResultBeforeCall(callIndex: number): string {
  return requestProxyCompletionMock.mock.calls[callIndex + 1]?.[0]?.messages.at(-1)?.content ?? '';
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

test('summarizeDocumentStructure includes plugin AI hints', () => {
  setHostPlugins([dbTablePluginRegistration]);
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"chores"}-->
#! Chores

<!--hvy:plugin {"id":"chores-table","plugin":"dev.heavy.db-table","pluginConfig":{"source":"with-file","table":"chores"}}-->
 SELECT * FROM chores WHERE completed_by IS NULL
`, '.hvy');

  const summary = summarizeDocumentStructure(document).summary;

  expect(summary).toContain('plugin id="chores-table"');
  expect(summary).toContain('AI hint: db-table owns SQLite table "chores".');
  expect(summary).toContain('fix the SQL query stored in the plugin body text');
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
  const pathInstructions = buildEditPathSelectionInstructions();
  expect(pathInstructions).toContain('Choose whether this request should edit the HVY header or the document body.');
  expect(pathInstructions).toContain('Reply with exactly one word: `document` or `header`.');
  expect(pathInstructions).toContain('Use `document` for visible content');
  expect(pathInstructions).toContain('Use `header` for front matter metadata');
  expect(pathInstructions).toContain('Use `document` for requests to change visible spacing, margins, or layout between existing sections.');

  const instructions = buildDocumentEditFormatInstructions();
  expect(instructions).toContain(
    'Valid tools are: `answer`, `plan`, `mark_step_done`, `grep`, `get_css`, `get_properties`, `set_properties`, `view_component`, `view_rendered_component`, `edit_component`, `patch_component`, `create_component`, `remove_component`, `create_section`, `remove_section`, `reorder_section`, `request_structure`, `request_rendered_structure`, `done`.'
  );
  expect(instructions).toContain('Use `answer` for informational questions, explanations, or requests that do not require changing the HVY document.');
  expect(instructions).toContain('{"tool":"answer","answer":"Direct answer to the user."}');
  expect(instructions).toContain('{"tool":"plan","steps":["Find the relevant section","Patch the component","Verify the updated structure"],"reason":"optional"}');
  expect(instructions).toContain('{"tool":"mark_step_done","step":1,"summary":"Found the relevant section.","reason":"optional"}');
  expect(instructions).toContain('It may revise that component in place or fully replace it');
  expect(instructions).toContain('Use real section ids when a section has an id.');
  expect(instructions).toContain('Use `grep` to search the whole serialized document with a regex pattern.');
  expect(instructions).toContain('alternation like `Python|TypeScript`');
  expect(instructions).toContain('defaults to lines 1-200');
  expect(instructions).toContain('Use `request_rendered_structure` to inspect what visible components render');
  expect(instructions).toContain('Use `view_rendered_component` to inspect one component rendered as user-facing text plus plugin diagnostics.');
  expect(instructions).toContain('Use `create_section.hvy` to add one complete serialized HVY section');
  expect(instructions).toContain('new_position_index_from_0');
  expect(instructions).toContain('{"tool":"grep","query":"Python|TypeScript","flags":"i","before":2,"after":2,"max_count":3,"reason":"optional"}');
  expect(instructions).toContain('{"tool":"grep","query":"/Python|TypeScript/i","before":2,"after":2,"max_count":3,"reason":"optional"}');
  expect(instructions).toContain('{"tool":"get_css","ids":["summary","C3"],"regex":"margin|padding","flags":"i","reason":"optional"}');
  expect(instructions).toContain('{"tool":"get_properties","ids":["summary","skill-python-card"],"properties":["margin","padding"],"reason":"optional"}');
  expect(instructions).toContain('{"tool":"set_properties","ids":["summary","C3"],"properties":{"margin":"0.5rem 0","padding":"0.25rem","background":null},"reason":"optional"}');
  expect(instructions).toContain('{"tool":"request_rendered_structure","reason":"optional"}');
  expect(instructions).toContain('{"tool":"view_rendered_component","component_ref":"chores-table","reason":"optional"}');
  expect(instructions).toContain('{"tool":"patch_component","component_ref":"C3","edits":[{"op":"replace","start_line":2,"end_line":2,"text":" New content"}],"reason":"optional"}');
  expect(instructions).toContain('{"tool":"create_component","position":"append-to-section","section_ref":"skills","hvy":"<!--hvy:text {}-->\\n New content","reason":"optional"}');
  expect(instructions).toContain('{"tool":"create_section","position":"append-root","hvy":"<!--hvy: {\\"id\\":\\"new-section\\"}-->\\n#! New section');
  expect(instructions).toContain('{"tool":"reorder_section","section_ref":"history","new_position_index_from_0":0,"reason":"optional"}');
  expect(instructions).toContain('{"tool":"remove_component","component_ref":"C3","reason":"optional"}');
  expect(instructions).toContain('{"tool":"remove_section","section_ref":"skills","reason":"optional"}');
  expect(instructions).toContain('{"tool":"done","summary":"Short summary of what changed."}');

  const dbInstructions = buildDocumentEditFormatInstructions({ dbTableNames: ['work_items'] });
  expect(dbInstructions).toContain('`query_db_table`');
  expect(dbInstructions).toContain('Available tables: work_items');
  expect(dbInstructions).toContain('{"tool":"query_db_table","table_name":"work_items","limit":10,"reason":"optional"}');

  const headerInstructions = buildHeaderEditFormatInstructions();
  expect(headerInstructions).toContain('Valid header tools are: `answer`, `plan`, `mark_step_done`, `grep_header`, `view_header`, `patch_header`, `request_header`, `done`.');
  expect(headerInstructions).toContain('Use `answer` for informational questions, explanations, or requests that do not require changing the HVY header.');
  expect(headerInstructions).toContain('{"tool":"plan","steps":["Find the reusable definition","Patch the YAML","Verify the header"],"reason":"optional"}');
  expect(headerInstructions).toContain('The header is YAML front matter only.');
  expect(headerInstructions).toContain('component_defs');
  expect(headerInstructions).toContain('Do not invent metadata fields.');
  expect(headerInstructions).toContain('For `section_defaults`, the only supported field is `css`');
  expect(headerInstructions).toContain('Do not use `section_defaults` to satisfy requests about visible spacing between existing sections');
  expect(headerInstructions).toContain('including table colors: `--hvy-table-header`, `--hvy-table-row-bg-1`, and `--hvy-table-row-bg-2`');
  expect(headerInstructions).toContain('Use `grep_header` to search the YAML header with a regex pattern before viewing or patching a specific reusable definition.');
  expect(headerInstructions).toContain('{"tool":"grep_header","query":"component_defs|skill-card","flags":"i","before":2,"after":8,"max_count":3,"reason":"optional"}');
  expect(headerInstructions).toContain('{"tool":"answer","answer":"Direct answer to the user."}');
  expect(headerInstructions).toContain('section_defaults:\\n  css:');
  expect(headerInstructions).toContain('{"tool":"patch_header","edits":[{"op":"replace","start_line":2,"end_line":2,"text":"title: New title"}],"reason":"optional"}');
});

test('summarizeHeaderStructure shows metadata and reusable definitions', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
title: Resume Example
reader_max_width: 60rem
theme:
  colors:
    --hvy-bg: "#ffffff"
component_defs:
  - name: skill-card
    baseType: xref-card
    description: Skill card
    schema:
      xrefTitle: Skill
      xrefTarget: skill-target
section_defs:
  - name: profile
    title: Profile
---

<!--hvy: {"id":"summary"}-->
#! Summary
`, '.hvy');

  const summary = summarizeHeaderStructure(document).summary;

  expect(summary).toContain('Header outline and properties');
  expect(summary).toContain('title: Resume Example');
  expect(summary).toContain('reader_max_width: 60rem');
  expect(summary).toContain('theme.colors set: --hvy-bg');
  expect(summary).toContain('known theme color variables:');
  expect(summary).toContain('- --hvy-bg (Page Background): #ffffff');
  expect(summary).toContain('- --hvy-table-header (Table Header Background): (not set; viewer default applies)');
  expect(summary).toContain('- --hvy-table-row-bg-1 (Odd Table Row Background): (not set; viewer default applies)');
  expect(summary).toContain('- --hvy-table-row-bg-2 (Even Table Row Background): (not set; viewer default applies)');
  expect(summary).toContain('name="skill-card" baseType="xref-card" description="Skill card" properties="baseType, description, name, schema"');
  expect(summary).not.toContain('xrefTitle');
  expect(summary).not.toContain('skill-target');
  expect(summary).toContain('name="profile" title="Profile"');
  expect(summary).toContain('Reusable definition outlines show first-level metadata only.');
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

test('requestAiDocumentEditTurn keeps plan progress in context', async () => {
  queueAiToolResponses(
    '{"tool":"plan","steps":["Find the summary text","Patch the summary text"]}',
    '{"tool":"grep","query":"Existing","max_count":1}',
    '{"tool":"mark_step_done","step":1,"summary":"Found the summary text."}',
    '{"tool":"done","summary":"Plan checked."}'
  );

  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"summary-text"}-->
 Existing content
`, '.hvy');
  seedStateForDocument(document);
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Make a couple of careful updates to the summary.',
    onProgress: vi.fn(),
  });

  expect(result.error).toBeNull();
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.context).toContain('Plan progress:');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.context).toContain('- [ ] 1. Find the summary text');
  expect(requestProxyCompletionMock.mock.calls[4]?.[0]?.context).toContain('- [x] 1. Find the summary text — Found the summary text.');
});

test('requestAiDocumentEditTurn keeps one active plan instead of replacing it', async () => {
  queueAiToolResponses(
    '{"tool":"plan","steps":["Find the summary text","Patch the summary text"]}',
    '{"tool":"plan","steps":["Start over with a different plan"]}',
    '{"tool":"done","summary":"Original plan kept."}'
  );

  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"summary-text"}-->
 Existing content
`, '.hvy');
  seedStateForDocument(document);
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Make a couple of careful updates to the summary.',
  });

  expect(result.error).toBeNull();
  expect(lastToolResultBeforeCall(2)).toContain('A plan already exists. Do not replace it');
  expect(lastToolResultBeforeCall(2)).toContain('Find the summary text');
  expect(lastToolResultBeforeCall(2)).not.toContain('Start over with a different plan');
});

test('requestAiDocumentEditTurn finishes automatically when the plan is complete', async () => {
  queueAiToolResponses(
    '{"tool":"plan","steps":["Find the summary text"]}',
    '{"tool":"mark_step_done","step":1,"summary":"Found the summary text."}'
  );

  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"summary-text"}-->
 Existing content
`, '.hvy');
  seedStateForDocument(document);
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const onProgress = vi.fn();

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Check the summary text.',
    onProgress,
  });

  expect(result.error).toBeNull();
  expect(result.messages.at(-1)?.content).toBe('Found the summary text.');
  expect(requestProxyCompletionMock).toHaveBeenCalledTimes(3);
  expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
    progress: true,
    content: 'Completed all plan steps.',
  }));
});

test('requestAiDocumentEditTurn emits visible progress messages', async () => {
  queueAiToolResponses(
    '{"tool":"grep","query":"Existing","max_count":1}',
    '{"tool":"done","summary":"Checked content."}'
  );

  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"summary-text"}-->
 Existing content
`, '.hvy');
  seedStateForDocument(document);
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const onProgress = vi.fn();

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Search for existing content.',
    onProgress,
  });

  expect(result.error).toBeNull();
  expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
    role: 'assistant',
    progress: true,
    content: expect.stringContaining('Choosing whether to edit'),
  }));
  expect(result.messages.some((message) => message.progress && message.content.includes('Searching the document'))).toBe(true);
});

test('requestAiDocumentEditTurn lets the model inspect rendered component output', async () => {
  queueAiToolResponses(
    '{"tool":"request_rendered_structure"}',
    '{"tool":"view_rendered_component","component_ref":"summary-text"}',
    '{"tool":"done","summary":"Rendered output checked."}'
  );

  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"summary-text","placeholder":"Summary text"}-->
 Existing content
`, '.hvy');
  seedStateForDocument(document);
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Check the rendered summary for visible problems.',
  });

  expect(result.error).toBeNull();
  expect(lastToolResultBeforeCall(1)).toContain('Tool result for request_rendered_structure:');
  expect(lastToolResultBeforeCall(1)).toContain('- summary-text (text): Existing content');
  expect(lastToolResultBeforeCall(2)).toContain('Tool result for view_rendered_component:');
  expect(lastToolResultBeforeCall(2)).toContain('Rendered component text/diagnostics:');
  expect(lastToolResultBeforeCall(2)).toContain('Existing content');
});

test('requestAiDocumentEditTurn sends a recovery prompt when the loop stalls', async () => {
  queueAiToolResponses(
    '{"tool":"grep","query":"Existing","max_count":1}',
    '{"tool":"grep","query":"Existing","max_count":1}',
    '{"tool":"grep","query":"Existing","max_count":1}',
    '{"tool":"grep","query":"Existing","max_count":1}',
    '{"tool":"done","summary":"Recovered."}'
  );

  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"summary-text"}-->
 Existing content
`, '.hvy');
  seedStateForDocument(document);
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Check the existing content repeatedly until you are certain.',
  });

  expect(result.error).toBeNull();
  expect(requestProxyCompletionMock.mock.calls.some((call) => {
    const messages = call[0]?.messages ?? [];
    return messages.some((message: ChatMessage) => message.content.includes('You appear to be stuck. Do not repeat the previous action.'));
  })).toBe(true);
});

test('requestAiDocumentEditTurn compacts older tool-loop history into an operational summary', async () => {
  queueAiToolResponses(
    '{"tool":"grep","query":"Existing","max_count":1}',
    '{"tool":"request_structure"}',
    '{"tool":"view_component","component_ref":"summary-text"}',
    '{"tool":"grep","query":"Missing","max_count":1}',
    '{"tool":"request_rendered_structure"}',
    '{"tool":"get_properties","ids":["summary-text"],"properties":["margin"]}',
    '{"tool":"view_rendered_component","component_ref":"summary-text"}',
    '{"tool":"done","summary":"Compaction checked."}'
  );

  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"summary-text"}-->
 Existing content
`, '.hvy');
  seedStateForDocument(document);
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Inspect the summary carefully before finishing.',
  });

  expect(result.error).toBeNull();
  const lastModelCall = requestProxyCompletionMock.mock.calls.at(-1)?.[0];
  const compactedSummary = lastModelCall?.messages.find((message: ChatMessage) => message.content.includes('Context summary for pruned older tool-loop history'));
  expect(compactedSummary?.content).toContain('- Goal: Inspect the summary carefully before finishing.');
  expect(compactedSummary?.content).toContain('- Completed actions:');
  expect(compactedSummary?.content).toContain('grep');
  expect(compactedSummary?.content).toContain('- Important refs/ids:');
  expect(lastModelCall?.messages.length).toBeLessThanOrEqual(8);
});

test('requestAiDocumentEditTurn can answer informational questions without mutating the document', async () => {
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"tool":"answer","answer":"Yes. SQLite supports unique constraints with UNIQUE column constraints or table constraints."}'
  );

  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"notes"}-->
#! Notes

<!--hvy:text {}-->
 Existing content
`, '.hvy');
  seedStateForDocument(document);
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const onMutation = vi.fn();

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Does SQLite support unique constraints?',
    onMutation,
  });

  expect(result.error).toBeNull();
  expect(result.messages.at(-1)).toEqual(
    expect.objectContaining({
      role: 'assistant',
      content: 'Yes. SQLite supports unique constraints with UNIQUE column constraints or table constraints.',
    })
  );
  expect(serializeDocument(document)).toContain('Existing content');
  expect(onMutation).not.toHaveBeenCalled();
  expect(requestProxyCompletionMock).toHaveBeenCalledTimes(1);
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.debugLabel).toBe('ai-document-edit:1');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.formatInstructions).toContain('`answer`');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.messages[0]?.content).toContain('answer directly with the `answer` tool');
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

test('requestAiDocumentEditTurn can get css and css properties for ids', async () => {
  queueAiToolResponses(
    '{"tool":"get_css","ids":["summary","skill-python-card"],"regex":"margin|padding","flags":"i"}',
    '{"tool":"get_properties","ids":["summary","skill-python-card"],"properties":["margin","padding"]}',
    '{"tool":"done","summary":"Read CSS."}'
  );

  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary","custom_css":"padding: 0.5rem; border: 1px solid red;"}-->
#! Summary

<!--hvy:xref-card {"id":"skill-python-card","css":"margin: 0.35rem 0; padding: 0.25rem; color: blue;","xrefTitle":"Python","xrefTarget":"tool-python"}-->
`, '.hvy');
  seedStateForDocument(document);
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Inspect CSS for summary and the Python card.',
  });

  expect(result.error).toBeNull();
  const cssResult = lastToolResultBeforeCall(1);
  expect(cssResult).toContain('section Summary (summary)');
  expect(cssResult).toContain('padding: 0.5rem; border: 1px solid red;');
  expect(cssResult).toContain('component xref-card (skill-python-card)');
  expect(cssResult).toContain('margin: 0.35rem 0; padding: 0.25rem; color: blue;');
  const propertiesResult = lastToolResultBeforeCall(2);
  expect(propertiesResult).toContain('padding: 0.5rem');
  expect(propertiesResult).toContain('margin: 0.35rem 0');
  expect(propertiesResult).toContain('padding: 0.25rem');
  expect(propertiesResult).not.toContain('color: blue');
});

test('requestAiDocumentEditTurn can set css properties for multiple ids', async () => {
  queueAiToolResponses(
    '{"tool":"set_properties","ids":["summary","skill-python-card"],"properties":{"margin":"0","padding":"1rem","color":null}}',
    '{"tool":"done","summary":"Updated CSS."}'
  );

  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary","custom_css":"padding: 0.5rem; color: red;"}-->
#! Summary

<!--hvy:xref-card {"id":"skill-python-card","css":"margin: 0.35rem 0; color: blue;","xrefTitle":"Python","xrefTarget":"tool-python"}-->
`, '.hvy');
  seedStateForDocument(document);
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Normalize spacing CSS.',
  });

  expect(result.error).toBeNull();
  expect(document.sections[0]?.customCss).toBe('padding: 1rem; margin: 0;');
  expect(document.sections[0]?.blocks[0]?.schema.customCss).toBe('margin: 0; padding: 1rem;');
});

test('requestAiDocumentEditTurn routes header requests to header tools', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce('header')
    .mockResolvedValueOnce('{"tool":"grep_header","query":"skill-card","before":2,"after":4,"max_count":1}')
    .mockResolvedValueOnce('{"tool":"view_header","start_line":1,"end_line":20}')
    .mockResolvedValueOnce('{"tool":"patch_header","edits":[{"op":"replace","start_line":2,"end_line":2,"text":"title: New Resume"}]}')
    .mockResolvedValueOnce('{"tool":"done","summary":"Updated the document title."}');

  const document = deserializeDocument(`---
hvy_version: 0.1
title: Old Resume
component_defs:
  - name: skill-card
    baseType: xref-card
    description: Skill card
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
    request: 'Change the document metadata title to New Resume.',
  });

  expect(result.error).toBeNull();
  expect(document.meta.title).toBe('New Resume');
  expect(document.meta.component_defs).toEqual([
    {
      name: 'skill-card',
      baseType: 'xref-card',
      description: 'Skill card',
    },
  ]);
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).toContain('Header outline and properties');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).toContain('component_defs:');
  const headerGrep = requestProxyCompletionMock.mock.calls[2]?.[0]?.messages.at(-1)?.content ?? '';
  expect(headerGrep).toContain('Tool result for grep_header:');
  expect(headerGrep).toContain('Header match 1 of 1');
  expect(headerGrep).toContain('name: skill-card');
  const headerView = requestProxyCompletionMock.mock.calls[3]?.[0]?.messages.at(-1)?.content ?? '';
  expect(headerView).toContain('Header YAML with 1-based line numbers:');
  expect(headerView).toContain('  2 | title: Old Resume');
  expect(result.messages.at(-1)).toEqual(
    expect.objectContaining({
      role: 'assistant',
      content: 'Updated the document title.',
    })
  );
});

test('requestAiDocumentEditTurn rejects invented section default fields', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce('header')
    .mockResolvedValueOnce('{"tool":"patch_header","edits":[{"op":"insert_after","line":2,"text":"section_defaults:\\n  wrapper_style: \\"margin-bottom: 24px;\\""}]}');

  const document = deserializeDocument(`---
hvy_version: 0.1
title: Existing
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
    request: 'Add vertical margin between sections.',
  });

  expect(result.error).toBe('section_defaults only supports the "css" field. Unsupported field: wrapper_style.');
  expect(document.meta.section_defaults).toBeUndefined();
  expect(document.meta.title).toBe('Existing');
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
    .mockResolvedValueOnce('document')
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
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).toContain('<!-- section id="summary" title="Summary" location="main" -->');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.context).toContain('Reduced outline context was already provided earlier');
  expect(result.messages.at(-1)).toEqual(
    expect.objectContaining({
      role: 'assistant',
      content: 'Added a new text component.',
    })
  );
});

test('requestAiDocumentEditTurn can create a full serialized section with nested content in one tool call', async () => {
  queueAiToolResponses(
    '{"tool":"create_section","position":"after","target_section_ref":"education","hvy":"<!--hvy: {\\"id\\":\\"patents\\"}-->\\n#! Patents\\n\\n <!--hvy:text {}-->\\n  # Patents\\n\\n <!--hvy:component-list {\\"componentListComponent\\":\\"patent-record\\"}-->\\n\\n  <!--hvy:component-list:0 {}-->\\n\\n   <!--hvy:container {\\"id\\":\\"patent-placeholder\\"}-->\\n\\n    <!--hvy:container:0 {}-->\\n\\n     <!--hvy:text {\\"placeholder\\":\\"Patent title\\"}-->\\n      Patent title\\n\\n    <!--hvy:container:1 {}-->\\n\\n     <!--hvy:text {\\"placeholder\\":\\"Patent number, status, and date\\"}-->\\n      Patent number / status / date"}',
    '{"tool":"done","summary":"Added Patents section."}'
  );

  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {}-->
 Existing content

<!--hvy: {"id":"education"}-->
#! Education

<!--hvy:text {}-->
 Existing education
`, '.hvy');
  seedStateForDocument(document);
  const settings: ChatSettings = { provider: 'anthropic', model: 'claude-sonnet-4-6' };

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Add a Patents section with a placeholder patent scaffold.',
  });

  expect(result.error).toBeNull();
  expect(document.sections.map((section) => section.title)).toEqual(['Summary', 'Education', 'Patents']);
  const patents = document.sections[2];
  expect(patents?.customId).toBe('patents');
  expect(patents?.blocks).toHaveLength(2);
  expect(patents?.blocks[1]?.schema.component).toBe('component-list');
  const patentRecord = patents?.blocks[1]?.schema.componentListBlocks[0];
  expect(patentRecord?.schema.component).toBe('container');
  expect(patentRecord?.schema.id).toBe('patent-placeholder');
  expect(patentRecord?.schema.containerBlocks.map((block) => block.text)).toEqual(['Patent title', 'Patent number / status / date']);
});

test('requestAiDocumentEditTurn can create a root section at a zero-based index', async () => {
  queueAiToolResponses(
    '{"tool":"create_section","position":"append-root","new_position_index_from_0":1,"hvy":"<!--hvy: {\\"id\\":\\"patents\\"}-->\\n#! Patents\\n\\n <!--hvy:text {}-->\\n  Placeholder patent"}',
    '{"tool":"done","summary":"Inserted Patents section."}'
  );

  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {}-->
 Existing summary

<!--hvy: {"id":"education"}-->
#! Education

<!--hvy:text {}-->
 Existing education
`, '.hvy');
  seedStateForDocument(document);
  const settings: ChatSettings = { provider: 'anthropic', model: 'claude-sonnet-4-6' };

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Add Patents between Summary and Education.',
  });

  expect(result.error).toBeNull();
  expect(document.sections.map((section) => section.customId)).toEqual(['summary', 'patents', 'education']);
});

test('requestAiDocumentEditTurn can reorder a section to a zero-based sibling index', async () => {
  queueAiToolResponses(
    '{"tool":"reorder_section","section_ref":"education","new_position_index_from_0":0}',
    '{"tool":"done","summary":"Moved Education first."}'
  );

  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {}-->
 Existing summary

<!--hvy: {"id":"projects"}-->
#! Projects

<!--hvy:text {}-->
 Existing projects

<!--hvy: {"id":"education"}-->
#! Education

<!--hvy:text {}-->
 Existing education
`, '.hvy');
  seedStateForDocument(document);
  const settings: ChatSettings = { provider: 'anthropic', model: 'claude-sonnet-4-6' };

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Move Education to the first section.',
  });

  expect(result.error).toBeNull();
  expect(document.sections.map((section) => section.customId)).toEqual(['education', 'summary', 'projects']);
});

test('requestAiDocumentEditTurn retries invalid multi-tool transcripts without treating them as executed work', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce('document')
    .mockResolvedValueOnce(
      '{"tool":"create_section","position":"append-root","hvy":"<!--hvy: {\\"id\\":\\"imagined\\"}-->\\n#! Imagined"}\n\nThe result of this action was:\nNew section ref: imagined\n\n{"tool":"done","summary":"Imagined work."}'
    )
    .mockResolvedValueOnce('{"tool":"create_section","position":"append-root","hvy":"<!--hvy: {\\"id\\":\\"actual\\"}-->\\n#! Actual\\n\\n <!--hvy:text {}-->\\n  Real content"}')
    .mockResolvedValueOnce('{"tool":"done","summary":"Added the actual section."}');

  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {}-->
 Existing content
`, '.hvy');
  seedStateForDocument(document);
  const settings: ChatSettings = { provider: 'anthropic', model: 'claude-sonnet-4-6' };

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Add a section.',
  });

  expect(result.error).toBeNull();
  expect(document.sections.map((section) => section.customId)).toEqual(['summary', 'actual']);
  const retryMessages = requestProxyCompletionMock.mock.calls[2]?.[0]?.messages.map((message: ChatMessage) => message.content).join('\n') ?? '';
  expect(retryMessages).toContain('no tools were executed');
  expect(retryMessages).not.toContain('New section ref: imagined');
});

test('requestAiDocumentEditTurn can remove a section', async () => {
  requestProxyCompletionMock
    .mockResolvedValueOnce('document')
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
