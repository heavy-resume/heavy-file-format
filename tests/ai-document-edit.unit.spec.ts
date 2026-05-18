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

import {
  buildImportPlanForDocument,
  importTextIntoDocument,
  requestAiDocumentEditTurn,
  summarizeDocumentStructure,
  summarizeHeaderStructure,
} from '../src/ai-document-edit';
import {
  buildDocumentEditFormatInstructions,
  buildDocumentEditToolHelp,
  buildInitialDocumentEditPrompt,
  buildHeaderEditFormatInstructions,
} from '../src/ai-document-edit-instructions';
import { autoUpdatePlanAndWorkNote, createInitialWorkNote, findAutoCompletedPlanStep, recordWorkLedgerItem } from '../src/ai-document-loop-state';
import { getDocumentEditPhaseTools } from '../src/ai-document-edit-phases';
import { parseDocumentEditToolRequest } from '../src/ai-document-tool-parsing';
import { executePatchHeaderTool } from '../src/ai-header-edit-tools';
import { deserializeDocument, serializeDocument, serializeSectionFragment } from '../src/serialization';
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

  expect(summary.summary).toContain('Effective style defaults:');
  expect(summary.summary).toContain('- section default css: "margin: 0 0 0.5rem;"');
  expect(summary.summary).toContain('- implicit block default css: "margin: 0.5rem 0;"');
  expect(summary.summary).toContain('<!-- section id="skills" title="Skills" location="main" -->');
  expect(summary.summary).toContain('# Skills');
  expect(summary.summary).toContain('Python - Automation <!-- xref-card id="skill-python-card" -->');
  expect(summary.summary).toContain('Python usage <!-- expandable id="python-details" -->');
  expect(summary.sectionRefs.get('skills')?.title).toBe('Skills');
  expect(summary.componentRefs.get('skill-python-card')?.component).toBe('xref-card');
});

test('summarizeDocumentStructure describes table responsive annotations as visible text', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"history"}-->
#! History

<!--hvy:table {"id":"history-table","tableColumns":["TITLE","<!--hvy:alt {\\"compact\\":\\"ORG\\"}-->ORGANIZATION<!--/hvy:alt-->","YEAR(S)"],"tableRows":[]}-->
`, '.hvy');

  const summary = summarizeDocumentStructure(document).summary;

  expect(summary).toContain('columns: TITLE, ORGANIZATION, YEAR(S)');
  expect(summary).not.toContain('hvy:alt');
});

test('summarizeDocumentStructure includes plugin AI hints', () => {
  setHostPlugins([dbTablePluginRegistration]);
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"chores"}-->
#! Chores

<!--hvy:plugin {"id":"chores-table","plugin":"hvy.db-table","pluginConfig":{"source":"with-file","table":"chores"}}-->
 SELECT * FROM chores WHERE completed_by IS NULL
`, '.hvy');

  const summary = summarizeDocumentStructure(document).summary;

  expect(summary).toContain('plugin id="chores-table"');
  expect(summary).toContain('AI hint: Dynamic data-backed table/view display. Target: "chores".');
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
  expect(instructions).not.toContain('- Form (hvy.form)');
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
    pluginHints: [{ id: 'hvy.db-table', displayName: 'DB Table', hint: 'Renders SQLite rows.' }],
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
    pluginHints: [{ id: 'hvy.db-table', displayName: 'DB Table', hint: 'Renders SQLite rows.' }],
    request: 'Create a db table viewer.',
    phase: 'database',
  });
  expect(explicitDbPhaseInstructions).toContain('Current edit phase: database.');
  expect(explicitDbPhaseInstructions).toContain('Valid tools for this phase are: `answer`, `plan`, `query_db_table`, `execute_sql`, `view_component`, `done`.');

  const dbPluginOnlyInstructions = buildDocumentEditFormatInstructions({
    pluginHints: [{ id: 'hvy.db-table', displayName: 'DB Table', hint: 'Renders SQLite rows.' }],
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
  expect(headerInstructions).toContain('{"tool":"plan","steps":["Find the component template definition","Patch the YAML","Verify the header"],"reason":"optional"}');
  expect(headerInstructions).toContain('The header is YAML front matter only.');
  expect(headerInstructions).toContain('component_defs');
  expect(headerInstructions).toContain('Do not invent metadata fields.');
  expect(headerInstructions).toContain('For `section_defaults`, the only supported field is `css`');
  expect(headerInstructions).toContain('Do not use `section_defaults` to satisfy requests about visible spacing between existing sections');
  expect(headerInstructions).toContain('including table colors: `--hvy-table-header`, `--hvy-table-row-bg-1`, and `--hvy-table-row-bg-2`');
  expect(headerInstructions).toContain('Use `grep_header` to search the YAML header with a regex pattern before viewing or patching a specific component template or section template definition.');
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

test('buildImportPlanForDocument stops after mocked plan without mutating the document', async () => {
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"steps":[{"section":"Summary","sectionId":"summary"}]}'
  );
  const document = deserializeDocument(`---
hvy_version: 0.1
ai-context: Use the target section inventory as the resume structure.
ai-import-guidance: Awards mentioned inside work history should still target the Awards reusable section.
section_defs:
  - name: Details
    template:
      id: details-template
      title: Details
      blocks: []
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"intro"}-->
 Existing content

<!--hvy: {"id":"details"}-->
#! Details

<!--hvy:text {"id":"details-text"}-->
 Other content
`, '.hvy');
  const before = serializeDocument(document);
  const progress = vi.fn();
  const beforeLlmCall = vi.fn();
  const importClient = { complete: vi.fn() };

  const result = await buildImportPlanForDocument(document, {
    sourceName: 'notes.txt',
    sourceText: 'Imported summary',
    instructions: 'Keep resume entries in reverse chronological order.',
    llm: {
      settings: { provider: 'openai', model: 'gpt-5-mini' },
      client: importClient,
    },
    beforeLlmCall,
    onProgress: progress,
  });

  expect(result).toEqual({
    status: 'ready',
    steps: [
      {
        sectionTitle: 'Summary',
        instruction: 'Create the Summary section.',
        target: {
          kind: 'body',
          id: 'summary',
          title: 'Summary',
          name: undefined,
        },
      },
    ],
  });
  expect(serializeDocument(document)).toBe(before);
  expect(requestProxyCompletionMock).toHaveBeenCalledTimes(1);
  expect(requestProxyCompletionMock.mock.calls.every((call) => call[0]?.client === importClient)).toBe(true);
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.debugLabel).toBe('ai-import-plan');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.messages[0]?.content).toContain('Additional import instructions:');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.messages[0]?.content).toContain('Keep resume entries in reverse chronological order.');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.messages[0]?.content).not.toContain('Imported summary');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.messages[0]?.content).toContain('Do not use tools. Do not mutate anything.');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.messages[0]?.content).toContain('Plan section-sized work only.');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.messages[0]?.content).toContain('not an ordering requirement');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.messages[0]?.content).toContain('Use one step per final document section.');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.messages[0]?.content).toContain('matching existing body section by sectionId');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.messages[0]?.content).toContain('Do not copy specific source facts into the plan.');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.messages[0]?.content).toContain('Decide from the imported source text');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.messages[0]?.content).toContain('Do not write conditional');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.messages[0]?.content).toContain('Use only facts present in the imported source text');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).toContain('=== BEGIN TEMPLATE SECTIONS ===');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).toContain('=== BEGIN DOCUMENT AI IMPORT GUIDANCE ===');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).toContain('General AI context:\nUse the target section inventory as the resume structure.');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).toContain('Import guidance:\nAwards mentioned inside work history should still target the Awards reusable section.');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).toContain('Template section inventory for resolving section targets; this is not an ordering requirement:');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).toContain('- body: Summary (id: summary)');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).toContain('- definition: Details (id: details-template, name: Details)');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).not.toContain('Existing content');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).not.toContain('```hvy');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).toContain('=== END TEMPLATE SECTIONS ===');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).toContain('=== BEGIN SOURCE DOCUMENT ===');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).toContain('Imported summary');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).toContain('=== END SOURCE DOCUMENT ===');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.responseInstructions).toContain('Return exactly one JSON object and no prose.');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.responseInstructions).toContain('"sectionId":"blip-overview"');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.responseInstructions).toContain('"templateName":"Widget Records"');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.responseInstructions).toContain('Every step must be unconditional and source-backed.');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.responseInstructions).toContain('Do not include `instruction` unless');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.responseInstructions).toContain('Do not copy specific source facts into the plan');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.responseInstructions).toContain('Do not include steps containing conditional language');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.responseInstructions).toContain('Do not impose a step count limit.');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.responseInstructions).toContain('split that into one step per section');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.responseInstructions).toContain('Do not include component-level steps');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.beforeRequest).toEqual(expect.any(Function));
  await requestProxyCompletionMock.mock.calls[0]?.[0]?.beforeRequest('ai-import-plan');
  expect(beforeLlmCall).toHaveBeenCalledTimes(1);
  expect(beforeLlmCall).toHaveBeenNthCalledWith(1, {
    callIndex: 1,
    debugLabel: 'ai-import-plan',
    phase: 'thinking',
  });
  expect(progress.mock.calls.map((call) => call[0].phase)).toContain('thinking');
});

test('buildImportPlanForDocument rejects conditional plan steps', async () => {
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"steps":["Create any additional Resume Section entries only if a source-backed extra section is needed; otherwise leave the template scaffold unmodified"]}'
  );
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary
`, '.hvy');

  const result = await buildImportPlanForDocument(document, {
    sourceName: 'resume.txt',
    sourceText: 'Awards\nBest Internal Tool 2024',
    llm: {
      settings: { provider: 'openai', model: 'gpt-5-mini' },
      client: { complete: vi.fn() },
    },
  });

  expect(result).toEqual({
    status: 'error',
    message: 'The import planner did not return a usable plan.',
  });
});

test('buildImportPlanForDocument uses importPreplan groups to extract approved section information', async () => {
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"sections":{"summary":{"import_selection":"has_data_include","information":"Summary facts."},"resume-awards":{"import_selection":"has_data_include","information":"Award facts."},"missing-body":{"import_selection":"no_data_exclude","information":"Source-backed generic resume section content is not present in the source text."}}}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"sections":{"resume-projects":{"import_selection":"has_data_include","information":"Project facts."}}}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce('{"sections":{}}');
  const document = deserializeDocument(`---
hvy_version: 0.1
importPreplan:
  - [summary, missing-body, resume-awards]
  - resume-projects
section_defs:
  - name: Awards
    key: resume-awards
    template:
      id: awards
      title: Awards
      blocks: []
  - name: Projects
    key: resume-projects
    template:
      id: projects
      title: Projects
      blocks: []
---

<!--hvy: {"id":"summary"}-->
#! Summary
`, '.hvy');

  const result = await buildImportPlanForDocument(document, {
    sourceName: 'resume.txt',
    sourceText: 'Summary and projects',
    llm: {
      settings: { provider: 'openai', model: 'gpt-5-mini' },
      client: { complete: vi.fn() },
    },
  });

  expect(result.status).toBe('ready');
  expect(result.steps?.map((step) => ({
    title: step.sectionTitle,
    target: step.target,
    group: step.preplanGroupIndex,
    preplanTargetId: step.preplanTargetId,
    information: step.extractedInformation,
  }))).toEqual([
    {
      title: 'Summary',
      target: { kind: 'body', id: 'summary', title: 'Summary', name: undefined },
      group: 0,
      preplanTargetId: 'summary',
      information: 'Summary facts.',
    },
    {
      title: 'Awards',
      target: { kind: 'definition', id: 'awards', title: 'Awards', name: 'Awards' },
      group: 0,
      preplanTargetId: 'resume-awards',
      information: 'Award facts.',
    },
    {
      title: 'Projects',
      target: { kind: 'definition', id: 'projects', title: 'Projects', name: 'Projects' },
      group: 1,
      preplanTargetId: 'resume-projects',
      information: 'Project facts.',
    },
  ]);
  expect(requestProxyCompletionMock.mock.calls.map((call) => call[0]?.debugLabel)).toEqual([
    'ai-import-preplan-data:1',
    'ai-import-preplan-data:2',
    'ai-import-missing-sections',
  ]);
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).toBe('');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.messages).toHaveLength(2);
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.messages[0]?.content).toContain('=== BEGIN SOURCE DOCUMENT ===');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.messages[0]?.content).toContain('Approved import section plan:');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.messages[1]?.content).toContain('Target key: resume-awards');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.messages[1]?.content).toContain('=== BEGIN DOCUMENT AI IMPORT GUIDANCE ===');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.responseInstructions).not.toContain('"resume-awards"');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.responseInstructions).toContain('"import_selection"');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.responseInstructions).toContain('has_data_include');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.responseInstructions).toContain('An omitted key, an empty string value');
  expect(requestProxyCompletionMock.mock.calls.map((call) => call[0]?.debugLabel)).not.toContain('ai-import-plan');
});

test('buildImportPlanForDocument excludes sections marked exclude_from_import', async () => {
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"sections":{"summary":{"import_selection":"has_data_include","information":"Summary facts."}}}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce('{"sections":{}}');
  const document = deserializeDocument(`---
hvy_version: 0.1
importPreplan:
  - [summary, private-notes, resume-awards]
section_defs:
  - name: Awards
    key: resume-awards
    template:
      id: awards
      title: Awards
      exclude_from_import: true
      blocks: []
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy: {"id":"private-notes","exclude_from_import":true}-->
#! Private Notes
`, '.hvy');

  const result = await buildImportPlanForDocument(document, {
    sourceName: 'notes.txt',
    sourceText: 'Summary and private notes',
    llm: {
      settings: { provider: 'openai', model: 'gpt-5-mini' },
      client: { complete: vi.fn() },
    },
  });

  expect(result.status).toBe('ready');
  expect(result.steps?.map((step) => step.preplanTargetId)).toEqual(['summary']);
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.messages[0]?.content).toContain('Summary');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.messages[0]?.content).not.toContain('Private Notes');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.messages[1]?.content).toContain('Target key: summary');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.messages[1]?.content).not.toContain('private-notes');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.messages[1]?.content).not.toContain('resume-awards');
});

test('resume template importPreplan resolves expected grouped targets', async () => {
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"sections":{"header":{"import_selection":"has_data_include","information":"Header facts."},"summary":{"import_selection":"has_data_include","information":"Summary facts."},"locations":{"import_selection":"has_data_include","information":"Location facts."}}}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"sections":{"skills":{"import_selection":"has_data_include","information":"Skill facts."},"tools-technologies":{"import_selection":"has_data_include","information":"Tool facts."},"resume-languages":{"import_selection":"has_data_include","information":"Language facts."},"top-skills-tools-technologies":{"import_selection":"has_data_include","information":"Featured facts."}}}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"sections":{"history":{"import_selection":"has_data_include","information":"History facts."},"resume-awards":{"import_selection":"has_data_include","information":"Award facts."}}}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"sections":{"resume-projects":{"import_selection":"has_data_include","information":"Project facts."},"resume-publications":{"import_selection":"has_data_include","information":"Publication facts."}}}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"sections":{"resume-certifications":{"import_selection":"has_data_include","information":"Certification facts."},"education":{"import_selection":"has_data_include","information":"Education facts."}}}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce('{"sections":{}}');
  requestProxyCompletionMock.mockResolvedValueOnce('{"sections":{}}');
  const source = readFileSync(new URL('../examples/resume.thvy', import.meta.url), 'utf8');
  const document = deserializeDocument(source, '.thvy');

  const result = await buildImportPlanForDocument(document, {
    sourceName: 'resume.txt',
    sourceText: 'Resume source',
    llm: {
      settings: { provider: 'openai', model: 'gpt-5-mini' },
      client: { complete: vi.fn() },
    },
  });

  expect(result.status).toBe('ready');
  expect(result.steps?.map((step) => [step.preplanGroupIndex, step.target.kind, step.target.id, step.target.name])).toEqual([
    [0, 'body', 'header', undefined],
    [0, 'body', 'summary', undefined],
    [0, 'body', 'locations', undefined],
    [1, 'body', 'skills', undefined],
    [1, 'body', 'tools-technologies', undefined],
    [1, 'definition', 'languages', 'Languages'],
    [1, 'body', 'top-skills-tools-technologies', undefined],
    [2, 'body', 'history', undefined],
    [2, 'definition', 'awards', 'Awards'],
    [3, 'definition', 'projects', 'Projects'],
    [3, 'definition', 'publications', 'Publications'],
    [4, 'definition', 'certifications', 'Certifications'],
    [4, 'body', 'education', undefined],
  ]);
  expect(result.steps?.map((step) => step.extractedInformation)).toEqual([
    'Header facts.',
    'Summary facts.',
    'Location facts.',
    'Skill facts.',
    'Tool facts.',
    'Language facts.',
    'Featured facts.',
    'History facts.',
    'Award facts.',
    'Project facts.',
    'Publication facts.',
    'Certification facts.',
    'Education facts.',
  ]);
  expect(requestProxyCompletionMock.mock.calls.map((call) => call[0]?.debugLabel)).toEqual([
    'ai-import-preplan-data:1',
    'ai-import-preplan-data:2',
    'ai-import-preplan-data:3',
    'ai-import-preplan-data:4',
    'ai-import-preplan-data:5',
    'ai-import-preplan-data:6',
    'ai-import-missing-sections',
  ]);
});

test('buildImportPlanForDocument exposes forced template structure metadata for usable templates', async () => {
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"steps":[{"section":"Awards","templateName":"Award Section"},{"section":"Notes","templateName":"Notes"}]}'
  );
  const document = deserializeDocument(`---
hvy_version: 0.1
section_defs:
  - name: Award Section
    templateVariables:
      section_title:
        label: Section title
    template:
      title: "{% section_title %}"
      blocks:
        - text: "# {% section_title %}"
          schema:
            component: text
        - text: ""
          schema:
            id: awards-list
            component: component-list
            componentListComponent: award-record
            componentListItemLabel: award
  - name: Notes
    template:
      title: Notes
      blocks:
        - text: "# Notes"
          schema:
            component: text
component_defs:
  - name: award-record
    baseType: expandable
    templateVariables:
      award:
        label: Award
      issuer:
        label: Issuer
      details:
        label: Details
    schema:
      component: award-record
      tags: award
      xrefTitle: "{% award %}"
      xrefDetail: "{% issuer %}"
      expandableStubBlocks:
        children:
          - text: "### {% award %}"
            schema:
              component: text
      expandableContentBlocks:
        children:
          - text: "{% issuer %}"
            schema:
              component: text
          - text: "{% details | block %}"
            schema:
              component: text
---

<!--hvy: {"id":"summary"}-->
#! Summary
`, '.hvy');

  const result = await buildImportPlanForDocument(document, {
    sourceName: 'resume.txt',
    sourceText: 'Awards\nBest Internal Tool',
    llm: {
      settings: { provider: 'openai', model: 'gpt-5-mini' },
      client: { complete: vi.fn() },
    },
  });

  expect(result.status).toBe('ready');
  expect(result.steps?.[0]?.templateStructure).toEqual({
    id: 'definition:award-section',
    label: 'Award Section template',
    target: {
      kind: 'definition',
      id: undefined,
      title: 'Award Section',
      name: 'Award Section',
    },
    jsonSchema: {
      type: 'object',
      properties: {
        section_title: {
          type: 'string',
          title: 'Section title',
          description: 'Single-line value.',
        },
        awards_list: {
          type: 'array',
          title: 'award',
          description: 'Repeatable award items.',
          items: {
            type: 'object',
            properties: {
              award: {
                type: 'string',
                title: 'Award',
                description: 'Single-line value.',
              },
              issuer: {
                type: 'string',
                title: 'Issuer',
                description: 'Single-line value.',
              },
              details: {
                type: 'string',
                title: 'Details',
                description: 'May contain multiple lines.',
              },
            },
            required: ['award', 'issuer', 'details'],
            additionalProperties: false,
          },
        },
      },
      required: ['section_title', 'awards_list'],
      additionalProperties: false,
    },
  });
  expect(result.steps?.[1]?.templateStructure).toBeUndefined();
});

test('buildImportPlanForDocument keeps plan rows when optional template structure cannot be derived', async () => {
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"steps":[{"section":"Languages","sectionId":"languages"}]}'
  );
  const document = deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: language-record
    baseType: expandable
    schema:
      component: language-record
      xrefDetail: "{% proficiency %}"
      expandableContentBlocks:
        children:
          - text: "{% proficiency | block %}"
            schema:
              component: text
---

<!--hvy: {"id":"languages","location":"sidebar"}-->
#! Languages

<!--hvy:component-list {"componentListComponent":"language-record","componentListItemLabel":"language"}-->
`, '.hvy');

  const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
  const result = await buildImportPlanForDocument(document, {
    sourceName: 'resume.txt',
    sourceText: 'Languages\nEnglish - native proficiency',
    llm: {
      settings: { provider: 'openai', model: 'gpt-5-mini' },
      client: { complete: vi.fn() },
    },
  });
  debug.mockRestore();

  expect(result.status).toBe('ready');
  expect(result.steps?.[0]?.sectionTitle).toBe('Languages');
  expect(result.steps?.[0]?.target).toEqual({ kind: 'body', id: 'languages', title: 'Languages' });
  expect(result.steps?.[0]?.templateStructure).toBeUndefined();
});

test('importTextIntoDocument executes approved steps with mocked LLM calls', async () => {
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"targets":[{"id":"summary","title":"Summary","kind":"section","description":"Summary is the imported summary section."}]}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"information":"Imported summary"}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"hvy":"<!--hvy: {\\"id\\":\\"imported-summary\\"}-->\\n#! Imported Summary\\n\\n <!--hvy:text {\\"id\\":\\"imported-summary-text\\"}-->\\n  Imported summary"}'
  );
  const document = deserializeDocument(`---
hvy_version: 0.1
text_line_styles:
  role:
    label: Role heading
    css: "margin: 0.5rem 0; font-weight: 700;"
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"intro"}-->
 Existing content

<!--hvy: {"id":"details"}-->
#! Details

<!--hvy:text {"id":"details-text"}-->
 Other content
`, '.hvy');
  const onMutation = vi.fn();
  const progress = vi.fn();

  const result = await importTextIntoDocument(document, {
    sourceName: 'notes.txt',
    sourceText: 'Imported summary',
    steps: ['Create a Summary section from the imported summary'],
    llm: {
      settings: { provider: 'openai', model: 'gpt-5-mini' },
      client: { complete: vi.fn() },
    },
    onMutation,
    onProgress: progress,
  });

  expect(result.status).toBe('complete');
  expect(serializeDocument(document)).toContain('"id":"imported-summary"');
  expect(serializeDocument(document)).toContain('Imported summary');
  expect(serializeDocument(document)).not.toContain('Existing content');
  expect(serializeDocument(document)).toContain('Other content');
  expect(onMutation).toHaveBeenCalledWith('ai-edit:section');
  expect(requestProxyCompletionMock).toHaveBeenCalledTimes(3);
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.debugLabel).toBe('ai-import-xref-targets');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.messages[0]?.content).toContain('Identify planned xref targets');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).toContain('Template section inventory for resolving section targets; this is not an ordering requirement:');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.responseInstructions).toContain('"targets"');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.debugLabel).toBe('ai-import-section-data:1');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.messages[0]?.content).toContain('Extract source information');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.messages[0]?.content).toContain('Do not generate HVY in this step.');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).not.toContain('=== BEGIN TEMPLATE SECTION STRUCTURE ===');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).toContain('=== BEGIN SECTION APPLICATION ===');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).toContain('=== BEGIN DOCUMENT RELATIONSHIPS ===');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).toContain('summary: Summary');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).toContain('Existing xref-card references already present');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).toContain('=== BEGIN PLANNED XREF TARGETS ===');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).toContain('- summary: Summary [section] - Summary is the imported summary section.');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).toContain('Application: replace existing body section.');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).toContain('Matched section title: Summary');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).toContain('=== BEGIN MATCHED SECTION TEMPLATE ===');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).toContain('Existing content');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).not.toContain('Other content');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).toContain('=== BEGIN SOURCE DOCUMENT ===');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).toContain('=== END SOURCE DOCUMENT ===');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).toContain('1. [current] Summary: Create a Summary section from the imported summary (body section: Summary (summary))');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.responseInstructions).toContain('`information` is a concise text document');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.debugLabel).toBe('ai-import-section-hvy:1');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.messages[0]?.content).toContain('Generate one complete HVY section');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.context).toContain('=== BEGIN SECTION APPLICATION ===');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.context).toContain('=== BEGIN DOCUMENT RELATIONSHIPS ===');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.context).toContain('summary: Summary');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.context).toContain('=== BEGIN PLANNED XREF TARGETS ===');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.context).toContain('Application: replace existing body section.');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.context).toContain('Existing content');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.context).toContain('=== BEGIN DOCUMENT PARAGRAPH STYLES ===');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.context).toContain('- role: label="Role heading"; css="margin: 0.5rem 0; font-weight: 700;"; marker="^role^"');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.context).toContain('Do not invent paragraph style names.');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.context).toContain('=== END DOCUMENT PARAGRAPH STYLES ===');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.context).toContain('=== BEGIN SECTION INFORMATION ===');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.context).toContain('Imported summary');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.context).toContain('=== END SECTION INFORMATION ===');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.context).not.toContain('=== BEGIN SOURCE DOCUMENT ===');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.context).toContain('=== BEGIN HVY FORMAT REFERENCE ===');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.context).toContain('=== END HVY FORMAT REFERENCE ===');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.context).not.toContain('Return raw HVY for exactly one complete section.');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.messages[0]?.content).toContain('Return exactly one top-level section.');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.messages[0]?.content).toContain('Return raw HVY only; do not call or describe tools.');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.messages[0]?.content).toContain('IDs are for navigation and exact xref targets.');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.messages[0]?.content).toContain('Do not put `id` on xref-card components');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.messages[0]?.content).toContain('preserve the template grid shape');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.responseInstructions).toContain('`hvy` must be one complete valid HVY section');
  expect(progress.mock.calls.map((call) => call[0].phase)).not.toContain('tool_call');
  expect(progress.mock.calls.map((call) => call[0])).toContainEqual({
    phase: 'thinking',
    message: 'Applying section 1.',
  });
});

test('importTextIntoDocument forced template mode fills JSON and instantiates nested list records', async () => {
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"targets":[{"id":"award-best-tool","title":"Best Tool","kind":"award","description":"Best Tool is an imported award."}]}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"values":{"section_title":"Awards","awards_list":[{"award":"Best Tool","issuer":"Engineering Guild","details":"Won for developer tooling."},{"award":"Quality Prize","issuer":"QA Team","details":"Recognized for reliable releases."}]}}'
  );
  const document = deserializeDocument(`---
hvy_version: 0.1
section_defs:
  - name: Award Section
    templateVariables:
      section_title:
        label: Section title
    template:
      title: "{% section_title %}"
      blocks:
        - text: "# {% section_title %}"
          schema:
            component: text
        - text: ""
          schema:
            id: awards-list
            component: component-list
            componentListComponent: award-record
            componentListItemLabel: award
component_defs:
  - name: award-record
    baseType: expandable
    templateVariables:
      award:
        label: Award
      issuer:
        label: Issuer
      details:
        label: Details
    schema:
      component: award-record
      tags: award
      xrefTitle: "{% award %}"
      xrefDetail: "{% issuer %}"
      expandableAlwaysShowStub: true
      expandableStubBlocks:
        children:
          - text: "### {% award %}"
            schema:
              component: text
      expandableContentBlocks:
        children:
          - text: "{% issuer %}"
            schema:
              component: text
          - text: "{% details | block %}"
            schema:
              component: text
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {}-->
 Existing summary
`, '.hvy');
  const onMutation = vi.fn();

  const result = await importTextIntoDocument(document, {
    sourceName: 'resume.txt',
    sourceText: 'Awards\nBest Tool - Engineering Guild\nQuality Prize - QA Team',
    steps: [{ section: 'Awards', templateName: 'Award Section', importMode: 'template', templateStructureId: 'definition:award-section' }],
    llm: {
      settings: { provider: 'openai', model: 'gpt-5-mini' },
      client: { complete: vi.fn() },
    },
    onMutation,
  });
  const serialized = serializeDocument(document);

  expect(result.status).toBe('complete');
  expect(requestProxyCompletionMock).toHaveBeenCalledTimes(2);
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.debugLabel).toBe('ai-import-template-values:1');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.messages[0]?.content).toContain('Return only source-backed JSON values');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).toContain('=== BEGIN TEMPLATE JSON SCHEMA ===');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.responseInstructions).toContain('"values"');
  expect(serialized).toContain('# Awards');
  expect(serialized).toContain('<!--hvy:award-record');
  expect(serialized).toContain('"id":"best-tool"');
  expect(serialized).toContain('"id":"quality-prize"');
  expect(serialized).toContain('Best Tool');
  expect(serialized).toContain('Engineering Guild');
  expect(serialized).toContain('Quality Prize');
  expect(serialized).toContain('Recognized for reliable releases.');
  expect(onMutation).toHaveBeenCalledWith('ai-edit:section');
});

test('importTextIntoDocument repairs imported xrefs from created target inventory', async () => {
  requestProxyCompletionMock.mockResolvedValueOnce('{"targets":[]}');
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"values":{"section_title":"Tools","tools_list":[{"tool":"Widget","detail":"Reliable builds","notes":"Used for reliable builds."}]}}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce('{"information":"Project used Widget for reliable builds."}');
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"hvy":"<!--hvy: {\\"id\\":\\"projects\\"}-->\\n#! Projects\\n\\n <!--hvy:xref-card {\\"xrefTitle\\":\\"Widget\\",\\"xrefTarget\\":\\"wrong-widget\\"}-->"}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"hvy":"<!--hvy: {\\"id\\":\\"projects\\"}-->\\n#! Projects\\n\\n <!--hvy:xref-card {\\"xrefTitle\\":\\"Widget\\",\\"xrefDetail\\":\\"Used for reliable builds.\\",\\"xrefTarget\\":\\"widget\\"}-->"}'
  );
  const document = deserializeDocument(`---
hvy_version: 0.1
section_defs:
  - name: Tool Section
    templateVariables:
      section_title:
        label: Section title
    template:
      title: "{% section_title %}"
      blocks:
        - text: "# {% section_title %}"
          schema:
            component: text
        - text: ""
          schema:
            id: tools-list
            component: component-list
            componentListComponent: tool-record
            componentListItemLabel: tool
component_defs:
  - name: tool-record
    baseType: expandable
    templateVariables:
      tool:
        label: Tool
      detail:
        label: Detail
      notes:
        label: Notes
    schema:
      component: tool-record
      tags: tool
      xrefTitle: "{% tool %}"
      xrefDetail: "{% detail %}"
      expandableStubBlocks:
        children:
          - text: "### {% tool %}"
            schema:
              component: text
      expandableContentBlocks:
        children:
          - text: "{% notes | block %}"
            schema:
              component: text
---

<!--hvy: {"id":"summary"}-->
#! Summary
`, '.hvy');

  const result = await importTextIntoDocument(document, {
    sourceName: 'resume.txt',
    sourceText: 'Widget. Project used Widget for reliable builds.',
    steps: [
      { section: 'Tools', templateName: 'Tool Section', importMode: 'template' },
      { section: 'Projects' },
    ],
    llm: {
      settings: { provider: 'openai', model: 'gpt-5-mini' },
      client: { complete: vi.fn() },
    },
  });

  const serialized = serializeDocument(document);
  expect(result.status).toBe('complete');
  expect(requestProxyCompletionMock.mock.calls.map((call) => call[0]?.debugLabel)).toEqual([
    'ai-import-xref-targets',
    'ai-import-template-values:1',
    'ai-import-section-data:2',
    'ai-import-section-hvy:2',
    'ai-import-xref-repair:1',
  ]);
  expect(requestProxyCompletionMock.mock.calls[4]?.[0]?.context).toContain('=== BEGIN CREATED IMPORT TARGETS ===');
  expect(requestProxyCompletionMock.mock.calls[4]?.[0]?.context).toContain('- widget: Widget [expandable]');
  expect(serialized).toContain('"id":"widget"');
  expect(serialized).toContain('"xrefTarget":"widget"');
  expect(serialized).not.toContain('wrong-widget');
});

test('importTextIntoDocument uses grouped importPreplan extraction and missing sections pass', async () => {
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"sections":{"summary":{"import_selection":"has_data_include","information":"Imported summary facts."},"resume-awards":{"import_selection":"has_data_include","information":"Award facts."}}}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"sections":{"Conference Talks":{"target":{"kind":"definition","name":"Resume Section"},"information":"Talk facts."},"Volunteer Work":{"target":{"kind":"blank","title":"Volunteer Work"},"information":"Volunteer facts."}}}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce('{"targets":[]}');
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"hvy":"<!--hvy: {\\"id\\":\\"summary\\"}-->\\n#! Summary\\n\\n <!--hvy:text {}-->\\n  Imported summary"}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"values":{"section_title":"Awards","awards_list":[{"award":"Best Tool","details":"Award facts."}]}}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"values":{"section_title":"Conference Talks","details":"Talk facts."}}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"hvy":"<!--hvy: {\\"id\\":\\"volunteer-work\\",\\"hideIfUnmodified\\":true}-->\\n#! Volunteer Work\\n\\n <!--hvy:text {}-->\\n  Volunteer facts"}'
  );
  const document = deserializeDocument(`---
hvy_version: 0.1
importPreplan:
  - [summary, resume-awards]
section_defs:
  - name: Awards
    key: resume-awards
    templateVariables:
      section_title:
        label: Section title
    template:
      id: awards
      title: "{% section_title %}"
      hideIfUnmodified: true
      blocks:
        - text: "# {% section_title %}"
          schema:
            component: text
        - text: ""
          schema:
            id: awards-list
            component: component-list
            componentListComponent: award-record
            componentListItemLabel: award
  - name: Resume Section
    key: resume-section
    repeatable: true
    templateVariables:
      section_title:
        label: Section title
      details:
        label: Details
    template:
      title: "{% section_title %}"
      hideIfUnmodified: true
      blocks:
        - text: "# {% section_title %}"
          schema:
            component: text
        - text: "{% details | block %}"
          schema:
            component: text
component_defs:
  - name: award-record
    baseType: expandable
    templateVariables:
      award:
        label: Award
      details:
        label: Details
    schema:
      component: award-record
      expandableStubBlocks:
        children:
          - text: "### {% award %}"
            schema:
              component: text
      expandableContentBlocks:
        children:
          - text: "{% details | block %}"
            schema:
              component: text
---

<!--hvy: {"id":"summary","hideIfUnmodified":true}-->
#! Summary

<!--hvy:text {}-->
 Old summary
`, '.hvy');

  const plan = await buildImportPlanForDocument(document, {
    sourceName: 'resume.txt',
    sourceText: 'Summary, awards, talks, and volunteer work',
    llm: {
      settings: { provider: 'openai', model: 'gpt-5-mini' },
      client: { complete: vi.fn() },
    },
  });
  expect(plan.status).toBe('ready');

  const result = await importTextIntoDocument(document, {
    sourceName: 'resume.txt',
    sourceText: 'Summary, awards, talks, and volunteer work',
    steps: plan.steps ?? [],
    llm: {
      settings: { provider: 'openai', model: 'gpt-5-mini' },
      client: { complete: vi.fn() },
    },
  });

  expect(result.status).toBe('complete');
  expect(requestProxyCompletionMock.mock.calls.map((call) => call[0]?.debugLabel)).toEqual([
    'ai-import-preplan-data:1',
    'ai-import-missing-sections',
    'ai-import-xref-targets',
    'ai-import-section-hvy:1',
    'ai-import-template-values:2',
    'ai-import-template-values:3',
    'ai-import-section-hvy:4',
  ]);
  expect(requestProxyCompletionMock.mock.calls.map((call) => call[0]?.debugLabel)).not.toContain('ai-import-section-data:1');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.context).toBe('');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.messages).toHaveLength(2);
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.messages[1]?.content).toContain('Target key: summary');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.messages[1]?.content).toContain('Target key: resume-awards');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.responseInstructions).not.toContain('"summary"');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.responseInstructions).not.toContain('"resume-awards"');
  expect(requestProxyCompletionMock.mock.calls[4]?.[0]?.context).toContain('=== BEGIN SECTION INFORMATION ===');
  expect(requestProxyCompletionMock.mock.calls[4]?.[0]?.context).toContain('Award facts.');
  const serialized = serializeDocument(document);
  expect(serialized).toContain('Imported summary');
  expect(serialized).toContain('# Awards');
  expect(serialized).toContain('Best Tool');
  expect(serialized).toContain('# Conference Talks');
  expect(serialized).toContain('Talk facts.');
  expect(serialized).toContain('Volunteer facts');
  expect(document.sections.find((section) => section.customId === 'summary')?.hideIfUnmodified).toBe(false);
  expect(document.sections.find((section) => section.title === 'Awards')?.hideIfUnmodified).toBe(false);
  expect(document.sections.find((section) => section.title === 'Conference Talks')?.hideIfUnmodified).toBe(false);
  expect(document.sections.find((section) => section.customId === 'volunteer-work')?.hideIfUnmodified).toBe(false);
});

test('importTextIntoDocument forced template mode lets JSON pick component template flavors', async () => {
  requestProxyCompletionMock.mockResolvedValueOnce('{"targets":[]}');
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"values":{"section_title":"Awards","awards_list":[{"_flavor":"compact","award":"Quick Thanks","issuer":"QA Team"},{"_flavor":"detailed","award":"Best Tool","issuer":"Engineering Guild","details":"Won for developer tooling."}]}}'
  );
  const document = deserializeDocument(`---
hvy_version: 0.1
section_defs:
  - name: Award Section
    templateVariables:
      section_title:
        label: Section title
    template:
      title: "{% section_title %}"
      blocks:
        - text: "# {% section_title %}"
          schema:
            component: text
        - text: ""
          schema:
            id: awards-list
            component: component-list
            componentListComponent: award-record
            componentListItemLabel: award
component_defs:
  - name: award-record
    baseType: expandable
    templateVariables:
      award:
        label: Award
      issuer:
        label: Issuer
      details:
        label: Details
    schema:
      component: award-record
      tags: award
      expandableStubBlocks:
        children:
          - text: "### {% award %}"
            schema:
              component: text
      expandableContentBlocks:
        children:
          - text: "{% issuer %}"
            schema:
              component: text
    flavors:
      - name: compact
        description: Use for awards with only a title and issuer.
        schema:
          component: award-record
          tags: award
          expandableStubBlocks:
            children:
              - text: "### {% award %}"
                schema:
                  component: text
          expandableContentBlocks:
            children:
              - text: "{% issuer %}"
                schema:
                  component: text
      - name: detailed
        description: Use when the source has narrative award details.
        schema:
          component: award-record
          tags: award
          expandableStubBlocks:
            children:
              - text: "### {% award %}"
                schema:
                  component: text
          expandableContentBlocks:
            children:
              - text: "{% issuer %}"
                schema:
                  component: text
              - text: "{% details | block %}"
                schema:
                  component: text
---

<!--hvy: {"id":"summary"}-->
#! Summary
`, '.hvy');

  const result = await importTextIntoDocument(document, {
    sourceName: 'resume.txt',
    sourceText: 'Best Tool - Engineering Guild. Won for developer tooling.',
    steps: [{ section: 'Awards', templateName: 'Award Section', importMode: 'template' }],
    llm: {
      settings: { provider: 'openai', model: 'gpt-5-mini' },
      client: { complete: vi.fn() },
    },
  });
  const serialized = serializeDocument(document);

  expect(result.status).toBe('complete');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).toContain('=== BEGIN TEMPLATE FLAVORS ===');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).toContain('detailed: Use when the source has narrative award details.');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.responseInstructions).toContain('_flavor');
  expect(serialized).toContain('Quick Thanks');
  expect(serialized).toContain('Won for developer tooling.');
});

test('importTextIntoDocument forced template mode uses selected section flavor list structure', async () => {
  requestProxyCompletionMock.mockResolvedValueOnce('{"targets":[]}');
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"values":{"_sectionFlavor":"linear","history_list":[{"role":"Engineer","organization":"Example Co","details":"Built useful systems."}]}}'
  );
  const document = deserializeDocument(`---
hvy_version: 0.1
section_defs:
  - name: History
    key: resume-history
    template:
      id: history
      title: History
      blocks:
        - text: ""
          schema:
            component: table
            description: History table header
        - text: ""
          schema:
            id: history-list
            component: component-list
            componentListComponent: history-record
            componentListItemLabel: job
    flavors:
      - name: tableform
        description: Use for longer histories with many items.
        template:
          id: history
          title: History
          blocks:
            - text: ""
              schema:
                component: table
                description: History table header
            - text: ""
              schema:
                id: history-list
                component: component-list
                componentListComponent: history-record
                componentListItemLabel: job
      - name: linear
        description: Use for shorter histories.
        template:
          id: history
          title: History
          blocks:
            - text: ""
              schema:
                id: history-list
                component: component-list
                componentListComponent: history-record
                componentListItemLabel: job
                componentListBlocks:
                  - text: ""
                    schema:
                      component: history-record
                      expandableStubBlocks:
                        children: []
                      expandableContentBlocks:
                        children:
                          - text: "{% organization %}\\n{% role %}\\n{% details | block %}"
                            schema:
                              component: text
component_defs:
  - name: history-record
    baseType: expandable
    schema:
      component: history-record
      expandableStubBlocks:
        children:
          - text: "{% role %} / {% organization %} / {% years %}"
            schema:
              component: text
      expandableContentBlocks:
        children:
          - text: "{% details | block %}"
            schema:
              component: text
---

<!--hvy: {"id":"history","templateKey":"resume-history"}-->
#! History

<!--hvy:component-list {"id":"history-list","componentListComponent":"history-record","componentListItemLabel":"job"}-->
`, '.hvy');

  const result = await importTextIntoDocument(document, {
    sourceName: 'resume.txt',
    sourceText: 'Example Co, Engineer, 2020-2024. Built useful systems.',
    steps: [{ section: 'History', target: { kind: 'body', id: 'history', title: 'History' }, importMode: 'template' }],
    llm: {
      settings: { provider: 'openai', model: 'gpt-5-mini' },
      client: { complete: vi.fn() },
    },
  });
  const historySection = document.sections[0];

  expect(result.status).toBe('complete');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).toContain('linear: Use for shorter histories.');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.responseInstructions).toContain('_sectionFlavor');
  expect(historySection).toBeTruthy();
  const generatedHistory = serializeSectionFragment(historySection!, document.meta);
  expect(generatedHistory).toContain('Built useful systems.');
  expect(generatedHistory).not.toContain('History table header');
  expect(generatedHistory).not.toContain('Engineer / Example Co / 2020-2024');
});

test('importTextIntoDocument rejects invalid forced template JSON without raw HVY fallback', async () => {
  requestProxyCompletionMock.mockResolvedValueOnce('{"targets":[]}');
  requestProxyCompletionMock.mockResolvedValueOnce('{"values":{"section_title":"Awards","extra":"bad"}}');
  const document = deserializeDocument(`---
hvy_version: 0.1
section_defs:
  - name: Award Section
    templateVariables:
      section_title:
        label: Section title
    template:
      title: "{% section_title %}"
      blocks:
        - text: "# {% section_title %}"
          schema:
            component: text
---

<!--hvy: {"id":"summary"}-->
#! Summary
`, '.hvy');

  const result = await importTextIntoDocument(document, {
    sourceName: 'resume.txt',
    sourceText: 'Awards',
    steps: [{ section: 'Awards', templateName: 'Award Section', importMode: 'template' }],
    llm: {
      settings: { provider: 'openai', model: 'gpt-5-mini' },
      client: { complete: vi.fn() },
    },
  });

  expect(result.status).toBe('error');
  expect(result.message).toContain('invalid template values');
  expect(result.message).toContain('Extra keys: extra');
  expect(requestProxyCompletionMock).toHaveBeenCalledTimes(2);
  expect(serializeDocument(document)).not.toContain('Awards');
});

test('importTextIntoDocument returns aborted during forced template JSON fill', async () => {
  requestProxyCompletionMock.mockResolvedValueOnce('{"targets":[]}');
  requestProxyCompletionMock.mockImplementationOnce(async (request: { beforeRequest?: (debugLabel: string) => Promise<void> | void; debugLabel: string }) => {
    await request.beforeRequest?.(request.debugLabel);
    return '{"values":{"section_title":"Awards"}}';
  });
  const document = deserializeDocument(`---
hvy_version: 0.1
section_defs:
  - name: Award Section
    templateVariables:
      section_title:
        label: Section title
    template:
      title: "{% section_title %}"
      blocks:
        - text: "# {% section_title %}"
          schema:
            component: text
---

<!--hvy: {"id":"summary"}-->
#! Summary
`, '.hvy');
  const controller = new AbortController();

  const result = await importTextIntoDocument(document, {
    sourceName: 'resume.txt',
    sourceText: 'Awards',
    steps: [{ section: 'Awards', templateName: 'Award Section', importMode: 'template' }],
    llm: {
      settings: { provider: 'openai', model: 'gpt-5-mini' },
      client: { complete: vi.fn() },
    },
    signal: controller.signal,
    beforeLlmCall(event) {
      if (event.debugLabel === 'ai-import-template-values:1') {
        controller.abort();
      }
    },
  });

  expect(result).toEqual({
    status: 'aborted',
    message: 'Import was aborted.',
  });
  expect(requestProxyCompletionMock).toHaveBeenCalledTimes(2);
  expect(serializeDocument(document)).not.toContain('# Awards');
});

test('importTextIntoDocument can mix forced template and raw HVY steps', async () => {
  requestProxyCompletionMock.mockResolvedValueOnce('{"targets":[]}');
  requestProxyCompletionMock.mockResolvedValueOnce('{"values":{"section_title":"Awards"}}');
  requestProxyCompletionMock.mockResolvedValueOnce('{"information":"Imported summary"}');
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"hvy":"<!--hvy: {\\"id\\":\\"summary\\"}-->\\n#! Summary\\n\\n <!--hvy:text {}-->\\n  Imported summary"}'
  );
  const document = deserializeDocument(`---
hvy_version: 0.1
section_defs:
  - name: Award Section
    templateVariables:
      section_title:
        label: Section title
    template:
      title: "{% section_title %}"
      blocks:
        - text: "# {% section_title %}"
          schema:
            component: text
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {}-->
 Existing summary
`, '.hvy');

  const result = await importTextIntoDocument(document, {
    sourceName: 'resume.txt',
    sourceText: 'Summary and awards',
    steps: [
      { section: 'Awards', templateName: 'Award Section', importMode: 'template' },
      { section: 'Summary', sectionId: 'summary' },
    ],
    llm: {
      settings: { provider: 'openai', model: 'gpt-5-mini' },
      client: { complete: vi.fn() },
    },
  });

  expect(result.status).toBe('complete');
  expect(requestProxyCompletionMock.mock.calls.map((call) => call[0]?.debugLabel)).toEqual([
    'ai-import-xref-targets',
    'ai-import-template-values:1',
    'ai-import-section-data:2',
    'ai-import-section-hvy:2',
  ]);
  expect(serializeDocument(document)).toContain('# Awards');
  expect(serializeDocument(document)).toContain('Imported summary');
});

test('importTextIntoDocument re-resolves later section targets after fresh loading applied sections', async () => {
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"targets":[]}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"information":"Imported summary"}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"hvy":"<!--hvy: {\\"id\\":\\"summary\\"}-->\\n#! Summary\\n\\n <!--hvy:text {\\"id\\":\\"summary-text\\"}-->\\n  Imported summary"}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"information":"Imported tools"}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"hvy":"<!--hvy: {\\"id\\":\\"tools\\"}-->\\n#! Tools & Technologies\\n\\n <!--hvy:text {\\"id\\":\\"tools-text\\"}-->\\n  Imported tools"}'
  );
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"old-summary"}-->
 Old summary

<!--hvy: {"id":"tools"}-->
#! Tools & Technologies

<!--hvy:text {"id":"old-tools"}-->
 Old tools
`, '.hvy');

  const result = await importTextIntoDocument(document, {
    sourceName: 'notes.txt',
    sourceText: 'Imported summary and tools',
    steps: [
      { section: 'Summary', sectionId: 'summary' },
      { section: 'Tools & Technologies', sectionId: 'tools' },
    ],
    llm: {
      settings: { provider: 'openai', model: 'gpt-5-mini' },
      client: { complete: vi.fn() },
    },
  });

  const serialized = serializeDocument(document);
  expect(result.status).toBe('complete');
  expect(serialized).toContain('Imported summary');
  expect(serialized).toContain('Imported tools');
  expect(serialized).not.toContain('Old summary');
  expect(serialized).not.toContain('Old tools');
});

test('importTextIntoDocument includes recursively referenced reusable definition examples for matched sections', async () => {
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"targets":[]}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"information":"Imported tools"}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"hvy":"<!--hvy: {\\"id\\":\\"tools\\"}-->\\n#! Tools\\n\\n <!--hvy:text {\\"id\\":\\"tools-text\\"}-->\\n  Imported tools"}'
  );
  const document = deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: tool-row
    baseType: expandable
    description: Tool row
    templateVariables:
      tool_name:
        label: Tool Name
    schema:
      expandableContentBlocks:
        children:
          - text: "{% tool_name %}"
            schema:
              component: tool-note
              placeholder: Tool note
  - name: tool-note
    baseType: text
    description: Tool note
    schema:
      placeholder: Tool detail
  - name: unused-row
    baseType: text
    description: Unused row
    schema:
      placeholder: Unused
---

<!--hvy: {"id":"tools"}-->
#! Tools

<!--hvy:component-list {"id":"tools-list","componentListComponent":"tool-row","componentListItemLabel":"tool"}-->
`, '.hvy');

  const result = await importTextIntoDocument(document, {
    sourceName: 'notes.txt',
    sourceText: 'Imported tools',
    steps: [{ section: 'Tools', sectionId: 'tools' }],
    llm: {
      settings: { provider: 'openai', model: 'gpt-5-mini' },
      client: { complete: vi.fn() },
    },
  });

  expect(result.status).toBe('complete');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).toContain('=== BEGIN MATCHED REUSABLE DEFINITIONS ===');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).toContain('Component template examples referenced by the matched section/template');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).toContain('Component: tool-row');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).toContain('<!--hvy:tool-row {}-->');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).toContain('TOOL_NAME');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).toContain('Component: tool-note');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).toContain('<!--hvy:tool-note {}-->');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).not.toContain('Component: unused-row');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).not.toContain('component_defs:');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.context).toContain('=== BEGIN MATCHED REUSABLE DEFINITIONS ===');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.context).toContain('Component: tool-row');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.context).toContain('Component: tool-note');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.context).not.toContain('Component: unused-row');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.context).not.toContain('component_defs:');
});

test('importTextIntoDocument shows xref-card reusable examples with target fields', async () => {
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"targets":[]}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"information":"Imported tools"}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"hvy":"<!--hvy: {\\"id\\":\\"tools\\"}-->\\n#! Tools\\n\\n <!--hvy:text {}-->\\n  Imported tools"}'
  );
  const document = deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: skill-xref-card
    baseType: xref-card
    description: Skill reference
  - name: tool-tech-xref-card
    baseType: xref-card
    description: Tool / technology reference
---

<!--hvy: {"id":"tools"}-->
#! Tools

<!--hvy:component-list {"id":"skills","componentListComponent":"skill-xref-card"}-->

<!--hvy:component-list {"id":"tools-tech","componentListComponent":"tool-tech-xref-card"}-->
`, '.hvy');

  const result = await importTextIntoDocument(document, {
    sourceName: 'notes.txt',
    sourceText: 'Imported tools',
    steps: [{ section: 'Tools', sectionId: 'tools' }],
    llm: {
      settings: { provider: 'openai', model: 'gpt-5-mini' },
      client: { complete: vi.fn() },
    },
  });

  expect(result.status).toBe('complete');
  const context = requestProxyCompletionMock.mock.calls[2]?.[0]?.context ?? '';
  expect(context).toContain('Component: skill-xref-card');
  expect(context).toContain('<!--hvy:skill-xref-card {"xrefTitle":"EXAMPLE_TARGET_TITLE","xrefDetail":"Short source-backed detail","xrefTarget":"example-target-id"}-->');
  expect(context).toContain('Component: tool-tech-xref-card');
  expect(context).toContain('<!--hvy:tool-tech-xref-card {"xrefTitle":"EXAMPLE_TARGET_TITLE","xrefDetail":"Short source-backed detail","xrefTarget":"example-target-id"}-->');
  expect(context).not.toContain('<!--hvy:skill-xref-card {}-->');
  expect(context).not.toContain('<!--hvy:skill-xref-card {"id"');
  expect(context).not.toContain('<!--hvy:tool-tech-xref-card {"id"');
});

test('importTextIntoDocument seeds fallback reusable examples by base type', async () => {
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"targets":[]}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"information":"Imported catalog"}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"hvy":"<!--hvy: {\\"id\\":\\"catalog\\"}-->\\n#! Catalog\\n\\n <!--hvy:text {}-->\\n  Imported catalog"}'
  );
  const document = deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: example-record
    baseType: expandable
    description: Example expandable record
  - name: example-list
    baseType: component-list
    description: Example repeated list
  - name: example-grid
    baseType: grid
    description: Example two-column layout
  - name: example-table
    baseType: table
    description: Example table
  - name: example-text
    baseType: text
    description: Example text block
---

<!--hvy: {"id":"catalog"}-->
#! Catalog

<!--hvy:example-record {}-->

<!--hvy:example-list {}-->

<!--hvy:example-grid {}-->

<!--hvy:example-table {}-->

<!--hvy:example-text {}-->
`, '.hvy');

  const result = await importTextIntoDocument(document, {
    sourceName: 'catalog.txt',
    sourceText: 'Imported catalog',
    steps: [{ section: 'Catalog', sectionId: 'catalog' }],
    llm: {
      settings: { provider: 'openai', model: 'gpt-5-mini' },
      client: { complete: vi.fn() },
    },
  });

  expect(result.status).toBe('complete');
  const context = requestProxyCompletionMock.mock.calls[2]?.[0]?.context ?? '';
  expect(context).toContain('Component: example-record');
  expect(context).toContain('<!--hvy:example-record {}-->');
  expect(context).toContain('<!--hvy:expandable:stub {}-->');
  expect(context).toContain('Example summary');
  expect(context).toContain('<!--hvy:expandable:content {}-->');
  expect(context).toContain('Example expanded details.');
  expect(context).toContain('Component: example-list');
  expect(context).toContain('<!--hvy:example-list {}-->');
  expect(context).toContain('<!--hvy:component-list:0 {}-->');
  expect(context).toContain('Example list item.');
  expect(context).toContain('Component: example-grid');
  expect(context).toContain('<!--hvy:example-grid {}-->');
  expect(context).toContain('<!--hvy:grid:0 {"id":"example-left"}-->');
  expect(context).toContain('<!--hvy:grid:1 {"id":"example-right"}-->');
  expect(context).toContain('Component: example-table');
  expect(context).toContain('<!--hvy:example-table {"tableColumns":["Example","Detail"],"tableRows":[{"cells":["Example value","Detail value"]}]}-->');
  expect(context).toContain('Component: example-text');
  expect(context).toContain('Example source-backed text.');
});

test('importTextIntoDocument appends generated section when approved step matches only a template section', async () => {
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"targets":[]}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"information":"Imported details"}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"hvy":"<!--hvy: {\\"id\\":\\"imported-details\\"}-->\\n#! Details\\n\\n <!--hvy:text {\\"id\\":\\"imported-details-text\\"}-->\\n  Imported details"}'
  );
  const document = deserializeDocument(`---
hvy_version: 0.1
section_defs:
  - name: Details
    template:
      id: details-template
      title: Details
      blocks: []
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"intro"}-->
 Existing content
`, '.hvy');

  const result = await importTextIntoDocument(document, {
    sourceName: 'notes.txt',
    sourceText: 'Imported details',
    steps: ['Create the Details section from imported details'],
    llm: {
      settings: { provider: 'openai', model: 'gpt-5-mini' },
      client: { complete: vi.fn() },
    },
  });

  const serialized = serializeDocument(document);
  expect(result.status).toBe('complete');
  expect(serialized).toContain('"id":"summary"');
  expect(serialized).toContain('Existing content');
  expect(serialized).toContain('"id":"imported-details"');
  expect(serialized.indexOf('"id":"summary"')).toBeLessThan(serialized.indexOf('"id":"imported-details"'));
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).not.toContain('<!-- Template section: Details -->');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.context).toContain('=== BEGIN SECTION INFORMATION ===');
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.context).not.toContain('=== BEGIN SOURCE DOCUMENT ===');
});

test('importTextIntoDocument accepts model HVY responses with escaped directive brackets', async () => {
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"targets":[]}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"information":"Imported summary"}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"hvy":"&lt;!--hvy: {&quot;id&quot;:&quot;imported-summary&quot;}--&gt;\\n#! Imported Summary\\n\\n &lt;!--hvy:text {&quot;id&quot;:&quot;imported-summary-text&quot;}--&gt;\\n  Imported summary"}'
  );
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"intro"}-->
 Existing content
`, '.hvy');

  const result = await importTextIntoDocument(document, {
    sourceName: 'notes.txt',
    sourceText: 'Imported summary',
    steps: [{ section: 'Summary', sectionId: 'summary' }],
    llm: {
      settings: { provider: 'openai', model: 'gpt-5-mini' },
      client: { complete: vi.fn() },
    },
  });

  const serialized = serializeDocument(document);
  expect(result.status).toBe('complete');
  expect(serialized).toContain('"id":"imported-summary"');
  expect(serialized).toContain('<!--hvy:text {"id":"imported-summary-text"}-->');
  expect(serialized).not.toContain('&lt;!--');
});

test('importTextIntoDocument removes generated ids from xref-card components', async () => {
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"targets":[{"id":"tool-widget","title":"Widget","kind":"tool","description":"Widget is a source-backed tool."}]}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"information":"Widget is relevant."}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"hvy":"<!--hvy: {\\"id\\":\\"summary\\"}-->\\n#! Summary\\n\\n <!--hvy:xref-card {\\"id\\":\\"widget-card\\",\\"xrefTitle\\":\\"Widget\\",\\"xrefTarget\\":\\"tool-widget\\"}-->"}'
  );
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {}-->
 Existing content
`, '.hvy');

  const result = await importTextIntoDocument(document, {
    sourceName: 'notes.txt',
    sourceText: 'Widget is relevant.',
    steps: [{ section: 'Summary', sectionId: 'summary' }],
    llm: {
      settings: { provider: 'openai', model: 'gpt-5-mini' },
      client: { complete: vi.fn() },
    },
  });

  const serialized = serializeDocument(document);
  expect(result.status).toBe('complete');
  expect(serialized).toContain('<!--hvy:xref-card {"xrefTitle":"Widget","xrefTarget":"tool-widget"}-->');
  expect(serialized).not.toContain('widget-card');
});

test('importTextIntoDocument accepts LLM safety closures and preserves blanked template fill-ins', async () => {
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"targets":[]}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"information":"No source value for the display name."}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"hvy":"<!--hvy: {\\"id\\":\\"profile\\"}-->\\n#! Profile\\n\\n <!--hvy:container {\\"id\\":\\"profile-panel\\"}-->\\n <!--hvy:text {\\"id\\":\\"display-name\\"}-->\\n <!-- /container -->"}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce('{"fills":{"display-name":""}}');
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"profile"}-->
#! Profile

<!--hvy:container {"id":"profile-panel"}-->
 <!--hvy:text {"id":"display-name","placeholder":"Display name","fillIn":true}-->
  # <!-- value {"placeholder":"Display name"} -->
`, '.hvy');

  const result = await importTextIntoDocument(document, {
    sourceName: 'notes.txt',
    sourceText: 'No display name was provided.',
    steps: [{ section: 'Profile', sectionId: 'profile' }],
    llm: {
      settings: { provider: 'openai', model: 'gpt-5-mini' },
      client: { complete: vi.fn() },
    },
  });

  const serialized = serializeDocument(document);
  expect(result.status).toBe('complete');
  expect(serialized).toContain('<!--hvy:container {"id":"profile-panel"}-->');
  expect(serialized).toContain('<!--hvy:text {"id":"display-name","placeholder":"Display name","fillIn":true}-->');
  expect(serialized).toContain('# <!-- value {"placeholder":"Display name"} -->');
  expect(serialized).not.toContain('<!-- /container -->');
});

test('importTextIntoDocument fills preserved template fill-ins from source document', async () => {
  requestProxyCompletionMock.mockResolvedValueOnce('{"targets":[]}');
  requestProxyCompletionMock.mockResolvedValueOnce('{"information":"Profile details exist."}');
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"hvy":"<!--hvy: {\\"id\\":\\"profile\\"}-->\\n#! Profile\\n\\n <!--hvy:text {\\"id\\":\\"display-name\\"}-->"}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce('{"fills":{"display-name":"# Ada Lovelace"}}');
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"profile"}-->
#! Profile

<!--hvy:text {"id":"display-name","placeholder":"Display name","fillIn":true}-->
 # <!-- value {"placeholder":"Display name"} -->
`, '.hvy');

  const result = await importTextIntoDocument(document, {
    sourceName: 'profile.txt',
    sourceText: 'Name: Ada Lovelace',
    steps: [{ section: 'Profile', sectionId: 'profile' }],
    llm: {
      settings: { provider: 'openai', model: 'gpt-5-mini' },
      client: { complete: vi.fn() },
    },
  });

  const serialized = serializeDocument(document);
  expect(result.status).toBe('complete');
  expect(requestProxyCompletionMock.mock.calls.map((call) => call[0]?.debugLabel)).toEqual([
    'ai-import-xref-targets',
    'ai-import-section-data:1',
    'ai-import-section-hvy:1',
    'ai-import-fill-ins:1',
  ]);
  expect(requestProxyCompletionMock.mock.calls[3]?.[0]?.context).toContain('=== BEGIN SOURCE DOCUMENT ===');
  expect(serialized).toContain('# Ada Lovelace');
  expect(serialized).not.toContain('"fillIn":true');
});

test('importTextIntoDocument applies parent safety closures when a child closer is forgotten', async () => {
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"targets":[]}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"information":"Blip Alpha is a source-backed item."}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce(
    JSON.stringify({
      hvy: `<!--hvy: {"id":"blips"}-->
#! Blips

 <!--hvy:component-list {"id":"blip-list","componentListComponent":"blip-record"}-->

  <!--hvy:component-list:0 {}-->

   <!--hvy:blip-record {"id":"blip-alpha"}-->

 <!--hvy:expandable:stub {}-->

 <!--hvy:text {}-->
  ### Blip Alpha
 <!-- /expandable:stub -->

 <!--hvy:expandable:content {}-->

 <!--hvy:text {}-->
  Blip Alpha is a source-backed item.
 <!-- /expandable:content -->
  <!-- /component-list:0 -->`,
    })
  );
  const document = deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: blip-record
    baseType: expandable
    schema:
      expandableAlwaysShowStub: true
      expandableStubBlocks:
        children: []
      expandableContentBlocks:
        children: []
---

<!--hvy: {"id":"blips"}-->
#! Blips

<!--hvy:component-list {"id":"blip-list","componentListComponent":"blip-record"}-->
`, '.hvy');

  const result = await importTextIntoDocument(document, {
    sourceName: 'notes.txt',
    sourceText: 'Blip Alpha is a source-backed item.',
    steps: [{ section: 'Blips', sectionId: 'blips' }],
    llm: {
      settings: { provider: 'openai', model: 'gpt-5-mini' },
      client: { complete: vi.fn() },
    },
  });

  const list = document.sections[0]?.blocks[0];
  const record = list?.schema.componentListBlocks[0];
  const serialized = serializeDocument(document);
  expect(result.status).toBe('complete');
  expect(record?.schema.component).toBe('blip-record');
  expect(record?.schema.expandableStubBlocks.children[0]?.text).toBe('### Blip Alpha');
  expect(record?.schema.expandableContentBlocks.children[0]?.text).toBe('Blip Alpha is a source-backed item.');
  expect(serialized).not.toContain('<!-- /expandable:stub -->');
  expect(serialized).not.toContain('<!-- /component-list:0 -->');
});

test('importTextIntoDocument treats explicit blank targets as binding even when text mentions an existing section', async () => {
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"targets":[]}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"information":"Imported summary"}'
  );
  requestProxyCompletionMock.mockResolvedValueOnce(
    '{"hvy":"<!--hvy: {\\"id\\":\\"imported-blank-summary\\"}-->\\n#! Imported Summary\\n\\n <!--hvy:text {\\"id\\":\\"imported-blank-summary-text\\"}-->\\n  Imported summary"}'
  );
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"intro"}-->
 Existing content
`, '.hvy');

  const result = await importTextIntoDocument(document, {
    sourceName: 'notes.txt',
    sourceText: 'Imported summary',
    steps: [
      {
        sectionTitle: 'Imported Summary',
        instruction: 'Create a Summary section from imported summary as a new blank section',
        target: { kind: 'blank', title: 'Imported Summary' },
      },
    ],
    llm: {
      settings: { provider: 'openai', model: 'gpt-5-mini' },
      client: { complete: vi.fn() },
    },
  });

  const serialized = serializeDocument(document);
  expect(result.status).toBe('complete');
  expect(serialized).toContain('"id":"summary"');
  expect(serialized).toContain('Existing content');
  expect(serialized).toContain('"id":"imported-blank-summary"');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).toContain('Application: create an empty new section from scratch.');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).not.toContain('Application: replace existing body section.');
});

test('importTextIntoDocument errors when an explicit body target is missing', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary
`, '.hvy');

  const result = await importTextIntoDocument(document, {
    sourceName: 'notes.txt',
    sourceText: 'Imported summary',
    steps: [
      {
        sectionTitle: 'Summary',
        instruction: 'Create a Summary section from imported summary',
        target: { kind: 'body', id: 'missing-summary', title: 'Summary' },
      },
    ],
    llm: {
      settings: { provider: 'openai', model: 'gpt-5-mini' },
      client: { complete: vi.fn() },
    },
  });

  expect(result.status).toBe('error');
  expect(result.message).toContain('Import plan target was not found');
  expect(result.message).toContain('missing-summary');
  expect(requestProxyCompletionMock).not.toHaveBeenCalled();
});

test('importTextIntoDocument returns error for empty approved steps without calling the LLM', async () => {
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');

  const result = await importTextIntoDocument(document, {
    sourceName: 'notes.txt',
    sourceText: 'Imported summary',
    steps: [],
    llm: {
      settings: { provider: 'openai', model: 'gpt-5-mini' },
      client: { complete: vi.fn() },
    },
  });

  expect(result).toEqual({
    status: 'error',
    message: 'Import requires at least one approved plan step.',
  });
  expect(requestProxyCompletionMock).not.toHaveBeenCalled();
});

test('buildImportPlanForDocument reports aborted status from an aborted signal', async () => {
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
  const abortController = new AbortController();
  abortController.abort();

  const result = await buildImportPlanForDocument(document, {
    sourceName: 'notes.txt',
    sourceText: 'Imported summary',
    llm: {
      settings: { provider: 'openai', model: 'gpt-5-mini' },
      client: { complete: vi.fn() },
    },
    signal: abortController.signal,
  });

  expect(result.status).toBe('aborted');
  expect(requestProxyCompletionMock).not.toHaveBeenCalled();
});

test('importTextIntoDocument returns aborted status during execution abort', async () => {
  requestProxyCompletionMock.mockImplementationOnce(({ signal }: { signal?: AbortSignal }) => {
    signal?.dispatchEvent(new Event('abort'));
    throw new DOMException('The operation was aborted.', 'AbortError');
  });
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary
`, '.hvy');
  const abortController = new AbortController();

  const result = await importTextIntoDocument(document, {
    sourceName: 'notes.txt',
    sourceText: 'Imported summary',
    steps: ['Add imported summary'],
    llm: {
      settings: { provider: 'openai', model: 'gpt-5-mini' },
      client: { complete: vi.fn() },
    },
    signal: abortController.signal,
  });

  expect(result.status).toBe('aborted');
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
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.responseInstructions).not.toContain('Tool shapes:');
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.responseInstructions).not.toContain('Available plugins for `<!--hvy:plugin ...-->` blocks:');
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
  expect(requestProxyCompletionMock.mock.calls[2]?.[0]?.responseInstructions).not.toContain('{"tool":"plan"');
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

test('requestAiDocumentEditTurn uses chat tool-loop compaction settings', async () => {
  queueAiToolResponses(
    '{"tool":"grep","query":"Existing 1","max_count":1}',
    '{"tool":"grep","query":"Existing 2","max_count":1}',
    '{"tool":"done","summary":"Compaction settings checked."}'
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
  const settings: ChatSettings = {
    provider: 'openai',
    model: 'gpt-5-mini',
    toolLoopCompaction: {
      compactAfterMessages: 2,
      keepRecentMessages: 1,
      latestToolResultContextChars: 80,
      toolResultChatChars: 80,
    },
  };

  const result = await requestAiDocumentEditTurn({
    settings,
    document,
    messages: [],
    request: 'Inspect with custom compaction.',
  });

  expect(result.error).toBeNull();
  const secondToolCall = requestProxyCompletionMock.mock.calls[2]?.[0];
  expect(secondToolCall?.messages.some((message: ChatMessage) => message.content.includes('Context summary for pruned older tool-loop history'))).toBe(true);
  expect(secondToolCall?.messages.length).toBe(3);
  expect(secondToolCall?.context).toContain('Latest tool result');
  expect(secondToolCall?.context.length).toBeLessThan(1600);
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
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.responseInstructions).toContain('`answer`');
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

<!--hvy: {"id":"summary","css":"padding: 0.5rem; border: 1px solid red;"}-->
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

<!--hvy: {"id":"summary","css":"padding: 0.5rem; color: red;"}-->
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
  expect(document.sections[0]?.css).toBe('padding: 1rem; margin: 0;');
  expect(document.sections[0]?.blocks[0]?.schema.css).toBe('margin: 0; padding: 1rem;');
});

test('requestAiDocumentEditTurn does not route metadata wording to header tools', async () => {
  queueAiToolResponses('{"tool":"done","summary":"Stayed on the document edit path."}');
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
  expect(document.meta.title).toBe('Old Resume');
  expect(document.meta.component_defs).toEqual([
    {
      name: 'skill-card',
      baseType: 'xref-card',
      description: 'Skill card',
    },
  ]);
  expect(requestProxyCompletionMock.mock.calls[0]?.[0]?.debugLabel).toBe('ai-document-notes');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.debugLabel).toBe('ai-document-edit:1');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).toContain('AI-generated document notes:');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).toContain('Reduced component/section index:');
  expect(requestProxyCompletionMock.mock.calls[1]?.[0]?.context).not.toContain('Header outline and properties');
  expect(result.messages.at(-1)).toEqual(
    expect.objectContaining({
      role: 'assistant',
      content: 'Stayed on the document edit path.',
    })
  );
});

test('executePatchHeaderTool rejects invented section default fields', () => {
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

  expect(() => executePatchHeaderTool({
    tool: 'patch_header',
    edits: [{ op: 'replace', start_line: 3, end_line: 4, text: 'section_defaults:\n  wrapper_style: "margin-bottom: 24px;"' }],
  }, document)).toThrow('section_defaults only supports the "css" field. Unsupported field: wrapper_style.');
  expect(document.meta.section_defaults).toEqual({ css: 'margin: 0 0 0.5rem;' });
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
  css: "margin: 0 0 0.5rem;"
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
    '{"tool":"create_section","position":"after","target_section_ref":"education","hvy":"<!--hvy: {\\"id\\":\\"patents\\"}-->\\n#! Patents\\n\\n <!--hvy:text {}-->\\n  # Patents\\n\\n <!--hvy:component-list {\\"componentListComponent\\":\\"patent-record\\"}-->\\n\\n  <!--hvy:component-list:0 {}-->\\n\\n   <!--hvy:container {\\"id\\":\\"patent-placeholder\\"}-->\\n\\n    <!--hvy:text {\\"placeholder\\":\\"Patent title\\"}-->\\n     Patent title\\n\\n    <!--hvy:text {\\"placeholder\\":\\"Patent number, status, and date\\"}-->\\n     Patent number / status / date"}',
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
    '{"tool":"create_component","position":"append-to-section","section_ref":"summary","hvy":"<!--hvy:plugin {\\"id\\":\\"assign-form\\",\\"plugin\\":\\"hvy.form\\",\\"pluginConfig\\":{\\"version\\":\\"0.1\\",\\"submitLabel\\":\\"Assign\\"}}-->\\n```yaml\\nfields:\\n  - label: Chore\\n    type: text\\n```"}',
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
  const firstToolInstructions = requestProxyCompletionMock.mock.calls[1]?.[0]?.responseInstructions ?? '';
  expect(firstToolInstructions).toContain('Registered plugin ids: hvy.form.');
  expect(firstToolInstructions).toContain('Use `get_help` only when it is listed for the current phase and exact syntax is missing from the notes or recent tool help.');
  expect(firstToolInstructions).not.toContain('Form UI. Fields and script hooks live in the YAML body.');
  const retryMessages = requestProxyCompletionMock.mock.calls[2]?.[0]?.messages.map((message: ChatMessage) => message.content).join('\n') ?? '';
  expect(retryMessages).toContain('unsupported `hvy:form` syntax');
  expect(retryMessages).toContain('Use a registered plugin id from the prompt');
  const serialized = serializeDocument(document);
  expect(serialized).toContain('"plugin":"hvy.form"');
  expect(serialized).toContain('"submitLabel":"Assign"');
  expect(serialized).not.toContain('```yaml');
  expect(serialized).not.toContain('hvy:form');
});

test('requestAiDocumentEditTurn can fetch detailed plugin help on demand', async () => {
  setHostPlugins([formPluginRegistration]);
  queueAiToolResponses(
    '{"tool":"get_help","topic":"plugin:hvy.form","reason":"Need exact form syntax."}',
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
  expect(helpResult).toContain('Form (hvy.form)');
  expect(helpResult).toContain('Supported form YAML keys include `fields`');
  expect(helpResult).toContain('Form-level behavior keys live in pluginConfig');
  expect(helpResult).toContain('Form scripts receive `doc` plus `doc.form`');
  expect(helpResult).toContain('Use `doc.form.get_value`');
  expect(helpResult).not.toContain('doc.db.query');
  const contextAfterHelp = requestProxyCompletionMock.mock.calls[2]?.[0]?.context ?? '';
  expect(contextAfterHelp).toContain('Recent tool help already fetched; reuse this before calling `get_help` again for the same syntax:');
  expect(contextAfterHelp).toContain('Form (hvy.form)');
  expect(contextAfterHelp).toContain('Supported form YAML keys include `fields`');
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

<!--hvy:plugin {"id":"add-chore-form","plugin":"hvy.form","pluginConfig":{"version":"0.1","submitLabel":"Add Chore"}}-->
 fields:
 - label: Chore Title
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

<!--hvy:plugin {"plugin":"hvy.db-table","pluginConfig":{"source":"with-file","table":"work_items"}}-->
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
  expect(firstToolCall?.responseInstructions).toContain('`execute_sql`');
  expect(firstToolCall?.responseInstructions).not.toContain('`query_db_table`,');
  expect(firstToolCall?.responseInstructions).toContain('Treat pluginConfig.source as storage selection, not a schema fix.');
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
