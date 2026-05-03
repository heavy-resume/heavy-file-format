import { beforeEach, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const { requestProxyCompletionMock, requestAiComponentEditMock, traceAgentLoopEventMock } = vi.hoisted(() => ({
  requestProxyCompletionMock: vi.fn(),
  requestAiComponentEditMock: vi.fn(),
  traceAgentLoopEventMock: vi.fn(),
}));

vi.mock('../src/chat/chat', () => ({
  requestProxyCompletion: requestProxyCompletionMock,
  traceAgentLoopEvent: traceAgentLoopEventMock,
}));

vi.mock('../src/ai-component-edit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ai-component-edit')>();
  return {
    ...actual,
    requestAiComponentEdit: requestAiComponentEditMock,
  };
});

import { requestAiDocumentEditTurn, summarizeDocumentStructure, summarizeHeaderStructure } from '../src/ai-document-edit';
import {
  buildDocumentEditFormatInstructions,
  buildDocumentEditToolHelp,
  buildInitialDocumentEditPrompt,
  buildHeaderEditFormatInstructions,
} from '../src/ai-document-edit-instructions';
import { autoUpdatePlanAndWorkNote, createInitialWorkNote, findAutoCompletedPlanStep, recordWorkLedgerItem } from '../src/ai-document-loop-state';
import { getDocumentEditPhaseTools } from '../src/ai-document-edit-phases';
import { parseDocumentEditToolRequest } from '../src/ai-document-tool-parsing';
import { deserializeDocument, serializeDocument } from '../src/serialization';
import { initCallbacks, initState } from '../src/state';
import type { ChatMessage, ChatSettings } from '../src/types';
import { dbTablePluginRegistration } from '../src/plugins/db-table-plugin';
import { formPluginRegistration } from '../src/plugins/form';
import { setHostPlugins } from '../src/plugins/registry';

beforeEach(() => {
  requestProxyCompletionMock.mockReset();
  requestAiComponentEditMock.mockReset();
  traceAgentLoopEventMock.mockReset();
  initCallbacks({
    renderApp: () => {},
    refreshReaderPanels: () => {},
    refreshModalPreview: () => {},
    componentRenderHelpers: null,
    readerRenderer: null,
  });
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
  requestProxyCompletionMock.mockResolvedValueOnce('AI note: reviewed the document chunks.\n\nTargets to review:\n- Use the refs named in the request and context.');
  for (const response of responses) {
    requestProxyCompletionMock.mockResolvedValueOnce(response);
  }
}

function lastToolResultBeforeCall(callIndex: number): string {
  const nextCall = requestProxyCompletionMock.mock.calls[callIndex + 1]?.[0];
  const context = nextCall?.context ?? '';
  const latestResult = context.match(/Latest tool result \(exact recent observation; use this for the immediate next decision\):\n([\s\S]*?)\nEnd latest tool result\./)?.[1];
  return latestResult ?? nextCall?.messages.at(-1)?.content ?? '';
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
  expect(summary).toContain('AI hint: SQLite table/view display. Target: "chores".');
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
  expect(getDocumentEditPhaseTools('database')).toEqual(['answer', 'plan', 'view_component', 'grep', 'done']);
  expect(getDocumentEditPhaseTools('database', { optionalTools: ['query_db_table', 'execute_sql'] })).toEqual([
    'answer',
    'plan',
    'query_db_table',
    'execute_sql',
    'view_component',
    'done',
  ]);
  expect(getDocumentEditPhaseTools('repair', { optionalTools: ['query_db_table'] })).toEqual([
    'query_db_table',
    'view_component',
    'patch_component',
    'edit_component',
    'remove_component',
    'get_help',
    'done',
  ]);

  const instructions = buildDocumentEditFormatInstructions({
    pluginHints: [
      {
        id: 'dev.test.widget',
        displayName: 'Widget',
        hint: 'Use widget YAML in the component body.',
      },
    ],
  });
  expect(instructions).toContain('Current edit phase: planning.');
  expect(instructions).toContain('Valid tools for this phase are: `answer`, `plan`, `grep`, `search_components`, `view_component`, `done`.');
  expect(instructions).toContain('Create one concrete plan from the notes, or run one targeted search/view if targets are still unclear. Do not mutate in this phase.');
  expect(instructions).toContain('Use the notes to create one linear plan or run the next concrete tool call.');
  expect(instructions).toContain('Use the notes to create one linear plan or run the next concrete tool call.');
  expect(instructions).toContain('Use `batch` only when it is listed for the current phase and the calls are a known ordered sequence of concrete tool calls.');
  expect(instructions).toContain('Plan at tool-action granularity: one plan step should be completable by one normal tool call or one batch.');
  expect(instructions).toContain('If several edits will be executed together in one batch, describe that whole batch outcome as one plan step');
  expect(instructions).toContain('Registered plugin ids: dev.test.widget.');
  expect(instructions).toContain('Plan shape: `{"tool":"plan","steps":["Modify component X to remove Y","Verify no Y remains"]}`.');
  expect(instructions).toContain('Batch shape: `{"tool":"batch","calls":[{"tool":"remove_component","component_ref":"id"}]}`.');
  expect(instructions).toContain('Use `get_help` only when it is listed for the current phase and exact syntax is missing from the notes or recent tool help.');
  expect(instructions).toContain('For larger work, create one plan after reviewing the notes.');
  expect(instructions).toContain('Plan steps must be document changes or final verification, not discovery.');
  expect(instructions).toContain('Return HVY only inside create/patch payload fields; never HTML/JSX/DOM.');
  expect(instructions).not.toContain('Available plugins for `<!--hvy:plugin ...-->` blocks:');
  expect(instructions).not.toContain('- Widget (dev.test.widget): Use widget YAML in the component body.');
  expect(instructions).not.toContain('- Form (dev.heavy.form)');
  expect(instructions).not.toContain('Tool shapes:');
  expect(instructions).not.toContain('{"tool":"answer","answer":"Direct answer to the user."}');
  expect(instructions).toContain('Do not put `answer`, `done`, `plan`, `mark_step_done`, or another `batch` inside a batch.');
  expect(buildInitialDocumentEditPrompt('Update the document.')).toContain('AI-generated section/chunk notes are in context.');
  expect(buildInitialDocumentEditPrompt('Update the document.')).toContain('First review those notes. Then create one linear plan or run the next concrete tool call.');
  expect(buildInitialDocumentEditPrompt('Update the document.')).not.toContain('You have at most 50 tool steps.');
  expect(buildDocumentEditToolHelp('tool:patch_component')).toContain('"tool":"patch_component"');
  expect(buildDocumentEditToolHelp('tool:batch')).toContain('"tool":"batch"');
  expect(buildDocumentEditToolHelp('tool:batch')).toContain('A batch counts as one plan step.');
  expect(buildDocumentEditToolHelp('patch_component, edit_component, and batch call syntax')).toContain('Help for tool:patch_component:');
  expect(buildDocumentEditToolHelp('patch_component, edit_component, and batch call syntax')).toContain('Help for tool:edit_component:');
  expect(buildDocumentEditToolHelp('patch_component, edit_component, and batch call syntax')).toContain('Help for tool:batch:');
  expect(buildDocumentEditToolHelp('tool:remove_component')).toContain('"component_ref":"tool-typescript"');

  const dbInstructions = buildDocumentEditFormatInstructions({ dbTableNames: ['work_items'], request: 'Show the database table.' });
  expect(dbInstructions).toContain('`query_db_table`');
  expect(dbInstructions).toContain('Current edit phase: database.');
  expect(dbInstructions).toContain('Valid tools for this phase are: `answer`, `plan`, `query_db_table`, `grep`, `view_component`, `done`.');
  expect(dbInstructions).toContain('SQLite tables/views available: work_items');
  expect(dbInstructions).not.toContain('`execute_sql`');
  expect(dbInstructions).not.toContain('reason":"Add a live db-table component showing all rows"');

  const dbPluginInstructions = buildDocumentEditFormatInstructions({
    dbTableNames: ['work_items'],
    pluginHints: [{ id: 'dev.heavy.db-table', displayName: 'DB Table', hint: 'Renders SQLite rows.' }],
    request: 'Create a db table viewer.',
  });
  expect(dbPluginInstructions).toContain('Current edit phase: database.');
  expect(dbPluginInstructions).toContain('Valid tools for this phase are: `answer`, `plan`, `query_db_table`, `execute_sql`, `view_component`, `done`.');
  expect(dbPluginInstructions).toContain('SQLite tables/views available: work_items');
  expect(dbPluginInstructions).toContain('For relational displays, prefer shared tables plus joins/views over one table per display column.');
  expect(dbPluginInstructions).toContain('Treat pluginConfig.source as storage selection, not a schema fix.');
  expect(buildDocumentEditToolHelp('tool:execute_sql')).toContain('CREATE TABLE IF NOT EXISTS chores');

  const explicitDbPhaseInstructions = buildDocumentEditFormatInstructions({
    dbTableNames: ['work_items'],
    pluginHints: [{ id: 'dev.heavy.db-table', displayName: 'DB Table', hint: 'Renders SQLite rows.' }],
    request: 'Create a db table viewer.',
    phase: 'database',
  });
  expect(explicitDbPhaseInstructions).toContain('Current edit phase: database.');
  expect(explicitDbPhaseInstructions).toContain('Valid tools for this phase are: `answer`, `plan`, `query_db_table`, `execute_sql`, `view_component`, `done`.');

  const dbPluginOnlyInstructions = buildDocumentEditFormatInstructions({
    pluginHints: [{ id: 'dev.heavy.db-table', displayName: 'DB Table', hint: 'Renders SQLite rows.' }],
  });
  expect(dbPluginOnlyInstructions).not.toContain('`execute_sql`');
  expect(dbPluginOnlyInstructions).toContain(
    'Valid tools for this phase are: `answer`, `plan`, `grep`, `search_components`, `view_component`, `done`.'
  );

  const noPluginInstructions = buildDocumentEditFormatInstructions();
  expect(noPluginInstructions).not.toContain('Registered plugin ids:');

  const activePlanInstructions = buildDocumentEditFormatInstructions({ planActive: true, phase: 'mutation' });
  expect(activePlanInstructions).toContain('Current edit phase: mutation.');
  expect(activePlanInstructions).toContain(
    'Valid tools for this phase are: `batch`, `edit_component`, `patch_component`, `view_component`, `mark_step_done`, `done`.'
  );
  expect(activePlanInstructions).not.toContain('Plan shape:');

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

test('parseDocumentEditToolRequest accepts table as a query_db_table table_name alias', () => {
  const parsed = parseDocumentEditToolRequest('{"tool":"query_db_table","table":"chores","limit":3}');

  expect(parsed.ok).toBe(true);
  if (parsed.ok && parsed.value.tool === 'query_db_table') {
    expect(parsed.value.table_name).toBe('chores');
    expect(parsed.value.limit).toBe(3);
  }
});

test('requestAiDocumentEditTurn returns a compact schema summary after execute_sql writes', async () => {
  setHostPlugins([dbTablePluginRegistration]);
  queueAiToolResponses(
    '{"tool":"execute_sql","sql":"CREATE TABLE chores (id INTEGER PRIMARY KEY, title TEXT NOT NULL)","reason":"Create the chores table."}',
    '{"tool":"done","summary":"Created chores table."}'
  );
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
  seedStateForDocument(document);
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Create a database table for chores.',
  });

  expect(result.error).toBeNull();
  const writeResult = lastToolResultBeforeCall(1);
  expect(writeResult).toContain('Rows affected: 0');
  expect(writeResult).toContain('Available SQLite tables/views: chores');
  expect(writeResult).toContain('SQLite schema now:');
  expect(writeResult).toContain('- chores (table): id, title');
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

test('requestAiDocumentEditTurn can batch document tool calls in one model turn', async () => {
  queueAiToolResponses(
    '{"tool":"batch","calls":[{"tool":"grep","query":"Python","max_count":1},{"tool":"view_component","component_ref":"skill-python-card"}],"reason":"Inspect the language card before editing."}',
    '{"tool":"done","summary":"Batch inspection complete."}'
  );

  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"skills"}-->
#! Skills

<!--hvy:xref-card {"id":"skill-python-card","xrefTitle":"Python","xrefDetail":"Automation","xrefTarget":"tool-python"}-->
`, '.hvy');
  seedStateForDocument(document);
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const onProgress = vi.fn();

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Inspect Python before editing.',
    onProgress,
  });

  expect(result.error).toBeNull();
  const noteTakingContext = requestProxyCompletionMock.mock.calls[0]?.[0]?.context ?? '';
  expect(noteTakingContext).toContain('Serialized document chunks for AI note-taking (section-by-section, up to 100 serialized lines per chunk):');
  expect(noteTakingContext).toContain('Walk note: section="Skills"');
  expect(noteTakingContext).toContain('refs=skills, skill-python-card, tool-python');
  expect(noteTakingContext).toContain('Reduced component/section index:');
  const initialDocumentEditContext = requestProxyCompletionMock.mock.calls[1]?.[0]?.context ?? '';
  expect(initialDocumentEditContext).toContain('AI-generated document notes:');
  expect(initialDocumentEditContext).toContain('AI note: reviewed the document chunks.');
  expect(initialDocumentEditContext).toContain('Reduced component/section index:');
  expect(traceAgentLoopEventMock).toHaveBeenCalledWith(expect.objectContaining({
    phase: 'document-edit',
    type: 'client_event',
    payload: expect.objectContaining({
      event: 'document_walk_chunks',
      chunks: expect.any(Number),
      context: expect.stringContaining('Walk note: section="Skills"'),
    }),
  }));
  expect(traceAgentLoopEventMock).toHaveBeenCalledWith(expect.objectContaining({
    phase: 'document-edit',
    type: 'client_event',
    payload: expect.objectContaining({
      event: 'ai_document_notes',
      chunks: expect.any(Number),
      notes: expect.stringContaining('AI note: reviewed the document chunks.'),
    }),
  }));
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.formatInstructions).not.toContain('Tool shapes:');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.formatInstructions).not.toContain('Available plugins for `<!--hvy:plugin ...-->` blocks:');
  const batchResult = lastToolResultBeforeCall(1);
  expect(batchResult).toContain('Tool result for batch:');
  expect(batchResult).toContain('Call 1: grep(Python)');
  expect(batchResult).toContain('Tool result for grep:');
  expect(batchResult).toContain('Call 2: view_component(skill-python-card)');
  expect(batchResult).toContain('Component HVY with 1-based line numbers:');
  const progressContents = onProgress.mock.calls.map((call) => (call[0] as ChatMessage).content);
  expect(progressContents).not.toContain('Preparing document chunks for note-taking.');
  expect(progressContents).not.toContain('Reviewing document chunks and taking section notes.');
  expect(progressContents).toContain('Running 2 document tool calls.');
  expect(progressContents).toContain('Searching the document for `Python`.');
  expect(progressContents).toContain('Viewing component skill-python-card.');
});

test('requestAiDocumentEditTurn rejects control tools inside batch calls', async () => {
  queueAiToolResponses(
    '{"tool":"batch","calls":[{"tool":"done","summary":"too soon"}]}',
    '{"tool":"done","summary":"Recovered from invalid batch."}'
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
    request: 'Try a batch.',
  });

  expect(result.error).toBeNull();
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.messages.at(-1)?.content).toContain('cannot use control tool "done"');
});

test('requestAiDocumentEditTurn can batch a mutation followed by inspection', async () => {
  queueAiToolResponses(
    '{"tool":"batch","calls":[{"tool":"patch_component","component_ref":"summary-text","edits":[{"op":"replace","start_line":2,"end_line":2,"text":" Updated content"}]},{"tool":"view_component","component_ref":"summary-text"}],"reason":"Patch and immediately inspect the result."}',
    '{"tool":"done","summary":"Updated summary."}'
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
    request: 'Update the summary.',
  });

  expect(result.error).toBeNull();
  expect(serializeDocument(document)).toContain('Updated content');
  const batchResult = lastToolResultBeforeCall(1);
  expect(batchResult).toContain('Patched component summary-text with 1 edit.');
  expect(batchResult).toContain('Updated content');
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
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.context).toContain('1. [ ] Find the summary text');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.formatInstructions).not.toContain('{"tool":"plan"');
  expect(requestProxyCompletionMock.mock.calls[4]?.[0]?.context).toContain('1. [x] Find the summary text — Found the summary text.');
  expect(result.messages.some((message) => message.progress && message.content.includes('Plan progress:'))).toBe(true);
  expect(result.messages.some((message) => message.progress && message.content.includes('Find the summary text'))).toBe(true);
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
  expect(lastToolResultBeforeCall(2)).toContain('A plan already exists and the `plan` tool is no longer available');
  expect(lastToolResultBeforeCall(2)).toContain('Find the summary text');
  expect(lastToolResultBeforeCall(2)).not.toContain('Start over with a different plan');
});

test('requestAiDocumentEditTurn does not emit repeated progress for already completed plan steps', async () => {
  queueAiToolResponses(
    '{"tool":"plan","steps":["Find the summary text","Patch the summary text"]}',
    '{"tool":"mark_step_done","step":1,"summary":"Found the summary text."}',
    '{"tool":"mark_step_done","step":1,"summary":"Found the summary text again."}',
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
  const onProgress = vi.fn();

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Make a couple of careful updates to the summary.',
    onProgress,
  });

  expect(result.error).toBeNull();
  const progressContents = onProgress.mock.calls.map((call) => (call[0] as ChatMessage).content);
  expect(progressContents.filter((content) => content.includes('1. [x] Find the summary text'))).toHaveLength(1);
  expect(lastToolResultBeforeCall(3)).toContain('Plan step 1 is already marked done.');
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
    content: expect.stringContaining('1. [x] Find the summary text'),
  }));
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
  expect(onProgress).not.toHaveBeenCalledWith(expect.objectContaining({
    content: expect.stringContaining('Choosing whether to edit'),
  }));
  expect(result.messages.some((message) => message.progress && message.content.includes('Searching the document'))).toBe(true);
});

test('requestAiDocumentEditTurn recovers from unknown component refs', async () => {
  queueAiToolResponses(
    '{"tool":"view_component","component_ref":"top-tools-technologies","reason":"Inspect the tools section."}',
    '{"tool":"request_structure","reason":"Refresh refs after the unknown component ref error."}',
    '{"tool":"done","summary":"Recovered by refreshing refs."}'
  );

  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"top-skills-tools-technologies"}-->
 Tools and technologies
`, '.hvy');
  seedStateForDocument(document);
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Inspect the tools and technologies component.',
  });

  expect(result.error).toBeNull();
  expect(lastToolResultBeforeCall(1)).toContain('Tool result for view_component:');
  expect(lastToolResultBeforeCall(1)).toContain('Tool failed: Unknown component ref "top-tools-technologies".');
  expect(result.messages.at(-1)?.content).toBe('Recovered by refreshing refs.');
});

test('requestAiDocumentEditTurn aborts after more than two tool failures in five calls', async () => {
  queueAiToolResponses(
    '{"tool":"view_component","component_ref":"missing-a","reason":"Inspect missing component A."}',
    '{"tool":"view_component","component_ref":"missing-b","reason":"Inspect missing component B."}',
    '{"tool":"view_component","component_ref":"missing-c","reason":"Inspect missing component C."}',
    '{"tool":"done","summary":"This should not be reached."}'
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
    request: 'Inspect missing components.',
    onProgress,
  });

  expect(result.error).toBeNull();
  expect(result.messages.at(-1)?.content).toBe('Stopped after repeated tool failures. The AI can continue if you send another request.');
  expect(requestProxyCompletionMock).toHaveBeenCalledTimes(4);
  const progressContents = onProgress.mock.calls.map((call) => (call[0] as ChatMessage).content).join('\n');
  expect(progressContents).toContain('Stopped after repeated tool failures.');
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

test('requestAiDocumentEditTurn can view an explicit nested id hidden from the reduced outline', async () => {
  queueAiToolResponses(
    '{"tool":"view_component","component_ref":"tool-typescript","reason":"Inspect the nested TypeScript item."}',
    '{"tool":"done","summary":"Inspected nested item."}'
  );

  const input = readFileSync(new URL('./fixtures/resume-structure-input.hvy', import.meta.url), 'utf8');
  seedStateForParsing();
  const document = deserializeDocument(input, '.hvy');
  seedStateForDocument(document);
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Inspect the TypeScript tool card.',
  });

  expect(result.error).toBeNull();
  expect(summarizeDocumentStructure(document).summary).toContain('... contents hidden ... ids: tool-typescript');
  const viewResult = lastToolResultBeforeCall(1);
  expect(viewResult).toContain('Tool result for view_component:');
  expect(viewResult).toContain('Component id: tool-typescript');
  expect(viewResult).toContain('Component location: section "Tools & Technologies" (tools-technologies) > component-list "C11"');
  expect(viewResult).toContain('TypeScript');
});

test('requestAiDocumentEditTurn can view a grid slot by id and exposes nested target refs', async () => {
  queueAiToolResponses(
    '{"tool":"view_component","component_ref":"top-tools-technologies","reason":"Inspect the top tools grid cell."}',
    '{"tool":"done","summary":"Inspected top tools grid cell."}'
  );

  const input = readFileSync(new URL('./fixtures/resume-structure-input.hvy', import.meta.url), 'utf8');
  seedStateForParsing();
  const document = deserializeDocument(input, '.hvy');
  seedStateForDocument(document);
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Inspect the top tools grid cell.',
  });

  expect(result.error).toBeNull();
  const viewResult = lastToolResultBeforeCall(1);
  expect(viewResult).toContain('Component type: component-list');
  expect(viewResult).toContain('Component location: section "Top Skills, Tools, and Technologies"');
  expect(viewResult).toContain('grid cell 1 (top-tools-technologies)');
  expect(viewResult).toContain('Valid nested component_ref values: top-tools-technologies.list[0], top-tools-technologies.list[1]');
  expect(viewResult).toContain('TypeScript');
});

test('requestAiDocumentEditTurn can inspect a section id passed to view_component', async () => {
  queueAiToolResponses(
    '{"tool":"view_component","component_ref":"top-skills-tools-technologies","reason":"Inspect the top skills and tools section."}',
    '{"tool":"done","summary":"Inspected top skills and tools section."}'
  );

  const input = readFileSync(new URL('./fixtures/resume-structure-input.hvy', import.meta.url), 'utf8');
  seedStateForParsing();
  const document = deserializeDocument(input, '.hvy');
  seedStateForDocument(document);
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Inspect the top skills and tools section.',
  });

  expect(result.error).toBeNull();
  const viewResult = lastToolResultBeforeCall(1);
  expect(viewResult).toContain('Section id: top-skills-tools-technologies');
  expect(viewResult).toContain('Matched a section ref, not a component ref.');
  expect(viewResult).toContain('Section HVY with 1-based line numbers:');
  expect(viewResult).toContain('<!--hvy:grid:1 {"id":"top-tools-technologies"}-->');
  expect(viewResult).toContain('TypeScript');
});

test('requestAiDocumentEditTurn accepts component_id aliases for component tools', async () => {
  queueAiToolResponses(
    '{"tool":"view_component","component_id":"top-tools-technologies","reason":"Inspect the top tools grid cell."}',
    '{"tool":"done","summary":"Inspected top tools grid cell."}'
  );

  const input = readFileSync(new URL('./fixtures/resume-structure-input.hvy', import.meta.url), 'utf8');
  seedStateForParsing();
  const document = deserializeDocument(input, '.hvy');
  seedStateForDocument(document);
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Inspect the top tools grid cell.',
  });

  expect(result.error).toBeNull();
  expect(lastToolResultBeforeCall(1)).toContain('Component location: section "Top Skills, Tools, and Technologies"');
  expect(lastToolResultBeforeCall(1)).toContain('grid cell 1 (top-tools-technologies)');
});

test('requestAiDocumentEditTurn can remove an explicit nested component id directly', async () => {
  queueAiToolResponses(
    '{"tool":"remove_component","component_ref":"tool-typescript","reason":"Remove the programming language item."}',
    '{"tool":"done","summary":"Removed TypeScript."}'
  );

  const input = readFileSync(new URL('./fixtures/resume-structure-input.hvy', import.meta.url), 'utf8');
  seedStateForParsing();
  const document = deserializeDocument(input, '.hvy');
  seedStateForDocument(document);
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Remove references to programming languages.',
  });

  expect(result.error).toBeNull();
  const serialized = serializeDocument(document);
  expect(serialized).not.toContain('id":"tool-typescript"');
  expect(serialized).toContain('id":"tool-python"');
  expect(lastToolResultBeforeCall(1)).toContain('Removed component tool-typescript');
  expect(lastToolResultBeforeCall(1)).toContain('Tools & Technologies');
});

test('requestAiDocumentEditTurn auto-marks a completed plan step after a successful tool action', async () => {
  queueAiToolResponses(
    '{"tool":"plan","steps":["Remove component remove-me"],"reason":"Remove the target component."}',
    '{"tool":"remove_component","component_ref":"remove-me","reason":"Remove component remove-me."}'
  );

  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"remove-me"}-->
 Remove this
`, '.hvy');
  seedStateForDocument(document);
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const onProgress = vi.fn();

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Remove the target component.',
    onProgress,
  });

  expect(result.error).toBeNull();
  expect(serializeDocument(document)).not.toContain('remove-me');
  const progressContents = onProgress.mock.calls.map((call) => (call[0] as ChatMessage).content).join('\n');
  expect(progressContents).toContain('1. [x] Remove component remove-me');
  expect(progressContents).toContain('Completed all plan steps.');
  expect(requestProxyCompletionMock).toHaveBeenCalledTimes(3);
});

test('requestAiDocumentEditTurn treats a batch as one completed plan step', async () => {
  queueAiToolResponses(
    '{"tool":"plan","steps":["Remove components remove-a and remove-b together"],"reason":"Batch related removals as one step."}',
    '{"tool":"batch","calls":[{"tool":"remove_component","component_ref":"remove-a"},{"tool":"remove_component","component_ref":"remove-b"}],"reason":"Remove both related components together."}'
  );

  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"remove-a"}-->
 Remove A

<!--hvy:text {"id":"remove-b"}-->
 Remove B
`, '.hvy');
  seedStateForDocument(document);
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const onProgress = vi.fn();

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Remove both target components.',
    onProgress,
  });

  expect(result.error).toBeNull();
  const serialized = serializeDocument(document);
  expect(serialized).not.toContain('remove-a');
  expect(serialized).not.toContain('remove-b');
  const progressContents = onProgress.mock.calls.map((call) => (call[0] as ChatMessage).content).join('\n');
  expect(progressContents).toContain('1. [x] Remove components remove-a and remove-b together');
  expect(progressContents).toContain('Completed all plan steps.');
  expect(requestProxyCompletionMock).toHaveBeenCalledTimes(3);
});

test('requestAiDocumentEditTurn accepts fenced JSON tool calls and safely removes ascending list refs', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:component-list {"id":"languages","componentListComponent":"text"}-->
 <!--hvy:component-list:0 {}-->

  <!--hvy:text {"id":"heading"}-->
   Tools

 <!--hvy:component-list:1 {}-->

  <!--hvy:text {"id":"typescript-entry"}-->
   TypeScript

 <!--hvy:component-list:2 {}-->

  <!--hvy:text {"id":"python-entry"}-->
   Python

 <!--hvy:component-list:3 {}-->

  <!--hvy:text {"id":"containers-entry"}-->
   Developer Containers
`, '.hvy');
  seedStateForDocument(document);
  const snapshot = summarizeDocumentStructure(document);
  const typeScriptRef = [...snapshot.deepComponentRefs.values()].find((entry) => entry.componentId === 'typescript-entry' && /\.list\[\d+\]$/.test(entry.ref))?.ref;
  const pythonRef = [...snapshot.deepComponentRefs.values()].find((entry) => entry.componentId === 'python-entry' && /\.list\[\d+\]$/.test(entry.ref))?.ref;
  expect(typeScriptRef).toBeTruthy();
  expect(pythonRef).toBeTruthy();
  queueAiToolResponses(
    `I found the two language entries.\n\n\`\`\`json\n{"tool":"batch","calls":[{"tool":"remove_component","component_ref":"${typeScriptRef}"},{"tool":"remove_component","component_ref":"${pythonRef}"}],"reason":"Remove language entries."}\n\`\`\``,
    '{"tool":"done","summary":"Removed language entries."}'
  );
  const settings: ChatSettings = { provider: 'anthropic', model: 'claude-sonnet-4-6' };

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Delete programming language entries.',
  });

  expect(result.error).toBeNull();
  const serialized = serializeDocument(document);
  expect(serialized).not.toContain('TypeScript');
  expect(serialized).not.toContain('Python');
  expect(serialized).toContain('Developer Containers');
});

test('requestAiDocumentEditTurn accepts section-scoped nested refs copied from component locations', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:component-list {"id":"languages","componentListComponent":"text"}-->
 <!--hvy:component-list:0 {}-->

  <!--hvy:text {"id":"heading"}-->
   Tools

 <!--hvy:component-list:1 {}-->

  <!--hvy:text {"id":"typescript-entry"}-->
   TypeScript

 <!--hvy:component-list:2 {}-->

  <!--hvy:text {"id":"python-entry"}-->
   Python
`, '.hvy');
  seedStateForDocument(document);
  queueAiToolResponses(
    '{"tool":"remove_component","component_ref":"summary nested.block[0].list[1]","reason":"Remove the TypeScript entry."}',
    '{"tool":"done","summary":"Removed TypeScript."}'
  );
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Delete TypeScript.',
  });

  expect(result.error).toBeNull();
  const serialized = serializeDocument(document);
  expect(serialized).not.toContain('TypeScript');
  expect(serialized).toContain('Python');
});

test('requestAiDocumentEditTurn only auto-marks plan steps for compatible tool actions', async () => {
  queueAiToolResponses(
    '{"tool":"plan","steps":["Run grep across the serialized document for TypeScript.","Re-run grep to verify there are no remaining TypeScript mentions."],"reason":"Find language mentions."}',
    '{"tool":"get_help","topic":"tool:grep"}',
    '{"tool":"grep","query":"TypeScript","flags":"i","reason":"Search document for TypeScript mentions."}',
    '{"tool":"done","summary":"Stopped after initial grep."}'
  );

  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"summary-text"}-->
 TypeScript
`, '.hvy');
  seedStateForDocument(document);
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const onProgress = vi.fn();

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Remove programming language references.',
    onProgress,
  });

  expect(result.error).toBeNull();
  const progressContents = onProgress.mock.calls.map((call) => (call[0] as ChatMessage).content);
  const afterHelpPlan = progressContents.find((content) => content.includes('Fetched help for tool:grep'));
  expect(afterHelpPlan).toBeUndefined();
  const finalPlan = progressContents.filter((content) => content.startsWith('Plan progress:')).at(-1) ?? '';
  expect(finalPlan).toContain('1. [x] Run grep across the serialized document for TypeScript.');
  expect(finalPlan).toContain('2. [ ] Re-run grep to verify there are no remaining TypeScript mentions.');
});

test('findAutoCompletedPlanStep matches removal batches to patch steps that remove content before verification steps', () => {
  const plan = {
    steps: [
      {
        text: 'Patch component C6 to remove the TypeScript and Python xref-card entries.',
        done: false,
      },
      {
        text: 'Verify removal by grepping component C6; if any references remain, remove them.',
        done: false,
      },
    ],
  };
  const toolCall = {
    tool: 'batch' as const,
    calls: [
      {
        tool: 'remove_component' as const,
        component_ref: 'C6.grid[1].list[1]',
      },
      {
        tool: 'remove_component' as const,
        component_ref: 'C6.grid[1].list[2]',
      },
    ],
    reason: 'Remove both language xref-card entries from C6.',
  };
  const toolResult = [
    'Tool result for batch:',
    'Call 1 remove_component: Removed component C6.grid[1].list[1].',
    'Call 2 remove_component: Removed component C6.grid[1].list[2].',
  ].join('\n');

  expect(findAutoCompletedPlanStep(plan, toolCall, toolResult)).toBe(0);
});

test('autoUpdatePlanAndWorkNote completes steps from the tool reason when the tool succeeds', () => {
  const plan = {
    steps: [
      {
        text: 'Create DB schema: tables for family_members, chores, chore_assignments with completed flag and completed_at timestamp',
        done: false,
      },
      {
        text: 'Create section Chore Chart with a db-table component',
        done: false,
      },
    ],
  };
  const note = createInitialWorkNote('Create a chore chart.');
  const result = autoUpdatePlanAndWorkNote(
    plan,
    note,
    {
      tool: 'execute_sql',
      sql: 'CREATE TABLE IF NOT EXISTS family_members (id INTEGER PRIMARY KEY, name TEXT);',
      reason: 'Create DB schema: tables for family_members, chores, chore_assignments with completed flag and completed_at timestamp',
    },
    'Tool result for execute_sql:\n\nExecuted: CREATE TABLE IF NOT EXISTS family_members'
  );

  expect(result.changed).toBe(true);
  expect(plan.steps[0]?.done).toBe(true);
  expect(plan.steps[0]?.text).toBe('Create DB schema: tables for family_members, chores, chore_assignments with completed flag and completed_at timestamp');
  expect(plan.steps[1]?.done).toBe(false);
  expect(result.workNote.done).toContain('Create DB schema: tables for family_members, chores, chore_assignments with completed flag and completed_at timestamp');
});

test('findAutoCompletedPlanStep does not complete UI section steps from SQL view creation', () => {
  const plan = {
    steps: [
      {
        text: 'Create a view or query approach for the leaderboard (completions in last 7 days per member)',
        done: false,
      },
      {
        text: 'Create section Leaderboard Past 7 Days with a db-table showing completions ranked by family member',
        done: false,
      },
    ],
  };
  const toolCall = {
    tool: 'execute_sql' as const,
    sql: 'CREATE VIEW IF NOT EXISTS leaderboard_7days AS SELECT member_id, COUNT(*) AS completions FROM chore_completions GROUP BY member_id;',
  };
  const toolResult = [
    'Tool result for execute_sql:',
    'Executed: CREATE VIEW IF NOT EXISTS leaderboard_7days AS SELECT member_id, COUNT(*) AS completions FROM chore_completions GROUP BY member_id',
    'Rows affected: 0',
  ].join('\n');

  expect(findAutoCompletedPlanStep(plan, toolCall, toolResult)).toBe(0);
});

test('recordWorkLedgerItem records successful declared work instead of only the raw tool type', () => {
  const ledger: Parameters<typeof recordWorkLedgerItem>[0] = [];

  recordWorkLedgerItem(
    ledger,
    {
      tool: 'execute_sql',
      sql: 'CREATE TABLE chores (id INTEGER PRIMARY KEY);',
      reason: 'Create DB schema for the chore chart',
    },
    'Create DB schema for the chore chart',
    'Tool result for execute_sql:\n\nExecuted: CREATE TABLE chores'
  );

  expect(ledger[0]?.summary).toBe('Create DB schema for the chore chart');
  expect(ledger[0]?.action).toBe('execute_sql');
});

test('requestAiDocumentEditTurn drops bookkeeping-only plan steps', async () => {
  queueAiToolResponses(
    '{"tool":"plan","steps":["Remove component remove-me","Mark each edit step done and finish with a summary of changes."],"reason":"Remove target."}',
    '{"tool":"done","summary":"Stopped after planning."}'
  );

  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"remove-me"}-->
 Remove this
`, '.hvy');
  seedStateForDocument(document);
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const onProgress = vi.fn();

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Remove the target component.',
    onProgress,
  });

  expect(result.error).toBeNull();
  const progressContents = onProgress.mock.calls.map((call) => (call[0] as ChatMessage).content).join('\n');
  expect(progressContents).toContain('1. [ ] Remove component remove-me');
  expect(progressContents).not.toContain('Mark each edit step done');
});

test('requestAiDocumentEditTurn sends a recovery prompt when the loop stalls', async () => {
  queueAiToolResponses(
    'not json',
    'still not json',
    'definitely not json',
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

test('requestAiDocumentEditTurn stops after repeated no-progress batch actions', async () => {
  queueAiToolResponses(
    '{"tool":"batch","calls":[{"tool":"view_component","component_ref":"summary-text"},{"tool":"view_component","component_ref":"summary-text"}],"reason":"Inspect the target."}',
    '{"tool":"batch","calls":[{"tool":"view_component","component_ref":"summary-text"},{"tool":"view_component","component_ref":"summary-text"}],"reason":"Inspect the target again."}',
    '{"tool":"batch","calls":[{"tool":"view_component","component_ref":"summary-text"},{"tool":"view_component","component_ref":"summary-text"}],"reason":"Inspect the target a third time."}'
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
    request: 'Inspect the same content repeatedly.',
  });

  expect(result.error).toBeNull();
  expect(result.messages.at(-1)?.content).toBe('Stopped because the AI edit loop appeared stuck repeating actions without making progress. The AI can continue if you send another request.');
  expect(requestProxyCompletionMock).toHaveBeenCalledTimes(4);
});

test('requestAiDocumentEditTurn compacts older tool-loop history into an operational summary', async () => {
  queueAiToolResponses(
    '{"tool":"grep","query":"Existing 1","max_count":1}',
    '{"tool":"grep","query":"Existing 2","max_count":1}',
    '{"tool":"grep","query":"Existing 3","max_count":1}',
    '{"tool":"grep","query":"Existing 4","max_count":1}',
    '{"tool":"grep","query":"Existing 5","max_count":1}',
    '{"tool":"grep","query":"Existing 6","max_count":1}',
    '{"tool":"grep","query":"Existing 7","max_count":1}',
    '{"tool":"request_structure"}',
    '{"tool":"view_component","component_ref":"summary-text"}',
    '{"tool":"grep","query":"Missing 1","max_count":1}',
    '{"tool":"grep","query":"Missing 2","max_count":1}',
    '{"tool":"grep","query":"Missing 3","max_count":1}',
    '{"tool":"grep","query":"Missing 4","max_count":1}',
    '{"tool":"grep","query":"Missing 5","max_count":1}',
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
  expect(lastModelCall?.messages.length).toBeLessThanOrEqual(22);
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
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.messages[0]?.content).toContain('AI-generated section/chunk notes are in context');
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
  expect(grepResult).toContain(`  12 | ${' '.repeat(2)}${'a'.repeat(398)}`);
  expect(grepResult).toContain(`  13 | ${'a'.repeat(12)}wrapped-needle`);
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
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).toContain('Header outline and properties');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).toContain('component_defs:');
  const headerGrep = requestProxyCompletionMock.mock.calls[1]?.[0]?.messages.at(-1)?.content ?? '';
  expect(headerGrep).toContain('Tool result for grep_header:');
  expect(headerGrep).toContain('Header match 1 of 1');
  expect(headerGrep).toContain('name: skill-card');
  const headerView = lastToolResultBeforeCall(1);
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
    .mockResolvedValueOnce('{"tool":"patch_header","edits":[{"op":"replace","start_line":3,"end_line":4,"text":"section_defaults:\\n  wrapper_style: \\"margin-bottom: 24px;\\""}]}');

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
    request: 'Patch the header section_defaults with vertical margin.',
  });

  expect(result.error).toBe('section_defaults only supports the "css" field. Unsupported field: wrapper_style.');
  expect(document.meta.section_defaults).toEqual({ css: 'margin: 0.5rem 0;' });
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
reader_max_width: 60rem
section_defaults:
  css: "margin: 0.5rem 0;"
---

<!--hvy: {"id":"summary","lock":false,"expanded":true,"highlight":false}-->
#! Summary

 <!--hvy:text {"id":"summary-text"}-->
  Updated content
`);
});

test('requestAiDocumentEditTurn summarizes invalid nested patch failures in progress', async () => {
  queueAiToolResponses(
    '{"tool":"patch_component","component_ref":"items","edits":[{"op":"replace","start_line":4,"end_line":4,"text":"  <!--hvy:expandable:stub {}-->"}]}',
    '{"tool":"done","summary":"Stopped after failed patch."}'
  );

  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:component-list {"id":"items","componentListComponent":"text"}-->

 <!--hvy:component-list:0 {}-->

  <!--hvy:text {}-->
   Item
`, '.hvy');
  seedStateForDocument(document);
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };
  const onProgress = vi.fn();

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Patch the nested list badly.',
    onProgress,
  });

  expect(result.error).toBeNull();
  const progressContents = onProgress.mock.calls.map((call) => (call[0] as ChatMessage).content);
  expect(progressContents).toContain('Tool failed: Patch failed because the HVY fragment was invalid; retrying with a smaller edit.');
  expect(progressContents.join('\n')).not.toContain('An expandable needs a stub slot');
  const retryPacket = lastToolResultBeforeCall(1);
  expect(retryPacket).toContain('Repair only this malformed HVY payload. Do not reread the whole document.');
  expect(retryPacket).toContain('Syntax problem:');
  expect(retryPacket).toContain('Before:');
  expect(retryPacket).toContain('Attempted after:');
  expect(retryPacket).toContain('Reference example:');
  expect(retryPacket).toContain('"tool":"patch_component"');
  expect(retryPacket).not.toContain('Reduced outline context');
});

test('requestAiDocumentEditTurn preserves indentation for local nested component patches', async () => {
  queueAiToolResponses(
    '{"tool":"patch_component","component_ref":"items","edits":[{"op":"replace","start_line":4,"end_line":4,"text":"<!--hvy:xref-card {\\"xrefTitle\\":\\"OpenAI API\\",\\"xrefDetail\\":\\"Model integration\\",\\"xrefTarget\\":\\"tool-openai-api\\"}-->"}]}',
    '{"tool":"done","summary":"Updated nested card."}'
  );

  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:component-list {"id":"items","componentListComponent":"xref-card"}-->

 <!--hvy:component-list:0 {}-->

  <!--hvy:xref-card {"xrefTitle":"TypeScript","xrefDetail":"Primary application language","xrefTarget":"tool-typescript"}-->
`, '.hvy');
  seedStateForDocument(document);
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Replace the TypeScript card.',
  });

  expect(result.error).toBeNull();
  const serialized = serializeDocument(document);
  expect(serialized).toContain('xrefTitle":"OpenAI API"');
  expect(serialized).not.toContain('TypeScript');
});

test('requestAiDocumentEditTurn patches custom component fragments with document component defs', async () => {
  queueAiToolResponses(
    '{"tool":"patch_component","component_ref":"tool-typescript","edits":[{"op":"replace","start_line":5,"end_line":5,"text":"    Programming systems"}],"reason":"Replace the visible label."}',
    '{"tool":"done","summary":"Updated custom component label."}'
  );

  const input = readFileSync(new URL('./fixtures/resume-structure-input.hvy', import.meta.url), 'utf8');
  seedStateForParsing();
  const document = deserializeDocument(input, '.hvy');
  seedStateForDocument(document);
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Rename the TypeScript tool label.',
  });

  expect(result.error).toBeNull();
  const serialized = serializeDocument(document);
  expect(serialized).toContain('Programming systems');
});

test('requestAiDocumentEditTurn returns focused repair context for malformed create_component HVY', async () => {
  queueAiToolResponses(
    '{"tool":"create_component","position":"append-to-section","section_ref":"summary","hvy":"<!--hvy:expandable:stub {}-->\\n Bad"}',
    '{"tool":"done","summary":"Stopped after malformed component."}'
  );

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
  const onProgress = vi.fn();

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Add a malformed component.',
    onProgress,
  });

  expect(result.error).toBeNull();
  const progressContents = onProgress.mock.calls.map((call) => (call[0] as ChatMessage).content);
  expect(progressContents.join('\n')).toContain('Tool failed: Create component failed because the HVY fragment was invalid; retrying with corrected HVY.');
  expect(progressContents.join('\n')).not.toContain('Section "AI Response"');
  const retryPacket = lastToolResultBeforeCall(1);
  expect(retryPacket).toContain('Repair only this malformed HVY payload. Do not reread the whole document.');
  expect(retryPacket).toContain('Attempted after:');
  expect(retryPacket).toContain('Reference example:');
  expect(retryPacket).toContain('"tool":"create_component"');
  expect(retryPacket).not.toContain('Reduced outline context');
});

test('requestAiDocumentEditTurn can create a component in a section', async () => {
  queueAiToolResponses(
    '{"tool":"create_component","position":"append-to-section","section_ref":"summary","hvy":"<!--hvy:text {}-->\\n Added content"}',
    '{"tool":"done","summary":"Added a new text component."}'
  );

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
  queueAiToolResponses(
    '{"tool":"create_section","position":"append-root","hvy":"<!--hvy: {\\"id\\":\\"imagined\\"}-->\\n#! Imagined"}\n\nThe result of this action was:\nNew section ref: imagined\n\n{"tool":"done","summary":"Imagined work."}',
    '{"tool":"create_section","position":"append-root","hvy":"<!--hvy: {\\"id\\":\\"actual\\"}-->\\n#! Actual\\n\\n <!--hvy:text {}-->\\n  Real content"}',
    '{"tool":"done","summary":"Added the actual section."}'
  );

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
  expect(retryMessages).toContain('Return one valid tool JSON object using the documented shapes.');
  expect(retryMessages).not.toContain('previous response was invalid');
  expect(retryMessages).not.toContain('New section ref: imagined');
});

test('requestAiDocumentEditTurn keeps only one invalid JSON correction in history', async () => {
  queueAiToolResponses(
    'not json',
    'still not json',
    '{"tool":"done","summary":"Recovered from invalid JSON."}'
  );

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
    request: 'Check the summary.',
  });

  expect(result.error).toBeNull();
  const retryMessages = requestProxyCompletionMock.mock.calls[3]?.[0]?.messages.map((message: ChatMessage) => message.content).join('\n') ?? '';
  expect(retryMessages.match(/Return one valid tool JSON object using the documented shapes\./g)).toHaveLength(1);
});

test('requestAiDocumentEditTurn gives a focused correction for malformed plan JSON', async () => {
  queueAiToolResponses(
    '{"tool":"plan","plan":"Remove language names from relevant components."}',
    '{"tool":"done","summary":"Recovered from malformed plan."}'
  );

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
    request: 'Remove language names.',
  });

  expect(result.error).toBeNull();
  const retryMessages = requestProxyCompletionMock.mock.calls[2]?.[0]?.messages.map((message: ChatMessage) => message.content).join('\n') ?? '';
  expect(retryMessages).toContain('plan must use `steps` as an array');
  expect(retryMessages).toContain('{"tool":"plan","steps":["Modify component X","Verify the result"]}');
});

test('requestAiDocumentEditTurn rejects HTML create payloads and asks for HVY', async () => {
  queueAiToolResponses(
    '{"tool":"create_section","position":"append-root","hvy":"<section><h1>Chores</h1><table><tr><td>Dad</td></tr></table></section>"}',
    '{"tool":"create_section","position":"append-root","hvy":"<!--hvy: {\\"id\\":\\"chores\\"}-->\\n#! Chores\\n\\n <!--hvy:text {}-->\\n  Chore chart"}',
    '{"tool":"done","summary":"Created chores section."}'
  );

  const document = deserializeDocument(`---
hvy_version: 0.1
---
`, '.hvy');
  seedStateForDocument(document);
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Create a chore chart.',
  });

  expect(result.error).toBeNull();
  const retryMessages = requestProxyCompletionMock.mock.calls[2]?.[0]?.messages.map((message: ChatMessage) => message.content).join('\n') ?? '';
  expect(retryMessages).toContain('contains HTML/DOM markup');
  expect(retryMessages).toContain('document edit tools only accept serialized HVY');
  const serialized = serializeDocument(document);
  expect(serialized).toContain('#! Chores');
  expect(serialized).toContain('Chore chart');
  expect(serialized).not.toContain('<section>');
});

test('requestAiDocumentEditTurn rejects invented hvy form components and asks for the form plugin', async () => {
  setHostPlugins([formPluginRegistration]);
  queueAiToolResponses(
    '{"tool":"create_component","position":"append-to-section","section_ref":"summary","hvy":"<!--hvy:form {\\"id\\":\\"assign-form\\"}-->"}',
    '{"tool":"create_component","position":"append-to-section","section_ref":"summary","hvy":"<!--hvy:plugin {\\"id\\":\\"assign-form\\",\\"plugin\\":\\"dev.heavy.form\\",\\"pluginConfig\\":{\\"version\\":\\"0.1\\"}}-->\\n```yaml\\nfields:\\n  - name: chore\\n    label: Chore\\n    type: text\\nsubmitLabel: Assign\\n```"}',
    '{"tool":"done","summary":"Created form plugin."}'
  );

  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary
`, '.hvy');
  seedStateForDocument(document);
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Create an actual assign chore form.',
  });

  expect(result.error).toBeNull();
  const firstToolInstructions = requestProxyCompletionMock.mock.calls[1]?.[0]?.formatInstructions ?? '';
  expect(firstToolInstructions).toContain('Registered plugin ids: dev.heavy.form.');
  expect(firstToolInstructions).toContain('Use `get_help` only when it is listed for the current phase and exact syntax is missing from the notes or recent tool help.');
  expect(firstToolInstructions).not.toContain('Form UI. Fields and script hooks live in the YAML body.');
  const retryMessages = requestProxyCompletionMock.mock.calls[2]?.[0]?.messages.map((message: ChatMessage) => message.content).join('\n') ?? '';
  expect(retryMessages).toContain('unsupported `hvy:form` syntax');
  expect(retryMessages).toContain('Use a registered plugin id from the prompt');
  const serialized = serializeDocument(document);
  expect(serialized).toContain('"plugin":"dev.heavy.form"');
  expect(serialized).toContain('submitLabel: Assign');
  expect(serialized).not.toContain('```yaml');
  expect(serialized).not.toContain('hvy:form');
});

test('requestAiDocumentEditTurn can fetch detailed plugin help on demand', async () => {
  setHostPlugins([formPluginRegistration]);
  queueAiToolResponses(
    '{"tool":"get_help","topic":"plugin:dev.heavy.form","reason":"Need exact form syntax."}',
    '{"tool":"done","summary":"Looked up form help."}'
  );

  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary
`, '.hvy');
  seedStateForDocument(document);
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Create an actual assign chore form.',
  });

  expect(result.error).toBeNull();
  const helpResult = lastToolResultBeforeCall(1);
  expect(helpResult).toContain('Tool result for get_help:');
  expect(helpResult).toContain('Form (dev.heavy.form)');
  expect(helpResult).toContain('Supported YAML keys include `fields`');
  expect(helpResult).toContain('Form scripts receive `doc` plus `doc.form`');
  expect(helpResult).toContain('Use `doc.form.get_value`');
  expect(helpResult).not.toContain('doc.db.query');
  const contextAfterHelp = requestProxyCompletionMock.mock.calls[2]?.[0]?.context ?? '';
  expect(contextAfterHelp).toContain('Recent tool help already fetched; reuse this before calling `get_help` again for the same syntax:');
  expect(contextAfterHelp).toContain('Form (dev.heavy.form)');
  expect(contextAfterHelp).toContain('Supported YAML keys include `fields`');
  expect(contextAfterHelp).toContain('Form scripts receive `doc` plus `doc.form`');
  expect(contextAfterHelp).not.toContain('doc.db.query');
});

test('requestAiDocumentEditTurn can search existing components and carries a work ledger', async () => {
  queueAiToolResponses(
    '{"tool":"search_components","query":"Add Chore form","max_count":3,"reason":"Check for an existing add chore form before creating another one."}',
    '{"tool":"done","summary":"Checked for duplicates."}'
  );

  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"chores"}-->
#! Chores

<!--hvy:plugin {"id":"add-chore-form","plugin":"dev.heavy.form","pluginConfig":{"version":"0.1"}}-->
 submitLabel: "Add Chore"
 fields:
 - name: title
   label: Chore Title
   type: text
`, '.hvy');
  seedStateForDocument(document);
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Add a chore form.',
  });

  expect(result.error).toBeNull();
  const searchResult = lastToolResultBeforeCall(1);
  expect(searchResult).toContain('Tool result for search_components:');
  expect(searchResult).toContain('add-chore-form');
  expect(searchResult).toContain('If one of these already satisfies the intended purpose');
  const contextAfterSearch = requestProxyCompletionMock.mock.calls[2]?.[0]?.context ?? '';
  expect(contextAfterSearch).toContain('Work ledger (recent completed/attempted tool actions; use this to avoid duplicating components/sections):');
  expect(contextAfterSearch).toContain('Check for an existing add chore form before creating another one.');
  expect(contextAfterSearch).toContain('search_components(Add Chore form)');
  expect(contextAfterSearch).toContain('Related existing components for current intent');
});

test('requestAiDocumentEditTurn distinguishes configured db-table targets from existing SQLite objects', async () => {
  setHostPlugins([dbTablePluginRegistration]);
  queueAiToolResponses('{"tool":"done","summary":"Inspected DB table setup."}');

  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"data"}-->
#! Data

<!--hvy:plugin {"plugin":"dev.heavy.db-table","pluginConfig":{"source":"with-file","table":"work_items"}}-->
 SELECT * FROM work_items;
`, '.hvy');
  seedStateForDocument(document);
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Fix the missing DB table error.',
  });

  expect(result.error).toBeNull();
  const firstToolCall = requestProxyCompletionMock.mock.calls[1]?.[0];
  expect(firstToolCall?.context).toContain('Configured db-table component targets: work_items');
  expect(firstToolCall?.context).toContain('Missing SQLite tables/views targeted by db-table components: work_items.');
  expect(firstToolCall?.context).not.toContain('SQLite tables/views available for query_db_table: work_items');
  expect(firstToolCall?.formatInstructions).toContain('`execute_sql`');
  expect(firstToolCall?.formatInstructions).not.toContain('`query_db_table`,');
  expect(firstToolCall?.formatInstructions).toContain('Treat pluginConfig.source as storage selection, not a schema fix.');
});

test('requestAiDocumentEditTurn can remove a section', async () => {
  queueAiToolResponses(
    '{"tool":"remove_section","section_ref":"details"}',
    '{"tool":"done","summary":"Removed the extra section."}'
  );

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
