import { beforeEach, expect, test, vi } from 'vitest';

import {
  buildDbTableEditContext,
  buildDbTableEditFormatInstructions,
  isDbTablePluginBlock,
  parseDbTableEditToolRequest,
} from '../src/ai-db-table-edit';
import { deserializeDocument } from '../src/serialization';
import type { ChatSettings } from '../src/types';
import type { DbTableAiSummary } from '../src/plugins/db-table';

const { requestProxyCompletionMock } = vi.hoisted(() => ({
  requestProxyCompletionMock: vi.fn(),
}));

vi.mock('../src/chat', async () => {
  const actual = await vi.importActual<typeof import('../src/chat')>('../src/chat');
  return {
    ...actual,
    requestProxyCompletion: requestProxyCompletionMock,
  };
});

const { executeDbTableQueryToolMock, executeDbTableWriteSqlMock, getDbTableAiSummaryMock } = vi.hoisted(() => ({
  executeDbTableQueryToolMock: vi.fn(),
  executeDbTableWriteSqlMock: vi.fn(),
  getDbTableAiSummaryMock: vi.fn(),
}));

vi.mock('../src/plugins/db-table', async () => {
  const actual = await vi.importActual<typeof import('../src/plugins/db-table')>('../src/plugins/db-table');
  return {
    ...actual,
    executeDbTableQueryTool: executeDbTableQueryToolMock,
    executeDbTableWriteSql: executeDbTableWriteSqlMock,
    getDbTableAiSummary: getDbTableAiSummaryMock,
  };
});

beforeEach(() => {
  requestProxyCompletionMock.mockReset();
  executeDbTableQueryToolMock.mockReset();
  executeDbTableWriteSqlMock.mockReset();
  getDbTableAiSummaryMock.mockReset();
});

const DOC_WITH_DB_TABLE = `---
hvy_version: 0.1
---

<!--hvy: {"id":"data"}-->
#! Data

 <!--hvy:plugin {"plugin":"dev.heavy.db-table","pluginConfig":{"source":"with-file","table":"work_items"}}-->
`;

function getDbTableBlock() {
  const document = deserializeDocument(DOC_WITH_DB_TABLE, '.hvy');
  const block = document.sections[0]?.blocks[0];
  if (!block) {
    throw new Error('fixture missing db-table block');
  }
  return { document, block };
}

const SUMMARY_FIXTURE: DbTableAiSummary = {
  tableName: 'work_items',
  schema: [
    { name: 'id', type: 'INTEGER', notNull: true, pk: true },
    { name: 'company', type: 'TEXT', notNull: false, pk: false },
    { name: 'status', type: 'TEXT', notNull: false, pk: false },
  ],
  sampleRows: [
    ['1', 'Acme', 'Open'],
    ['2', 'Globex', 'Done'],
  ],
  totalRows: 2,
  activeQuery: null,
};

test('getDocumentDbTableNames finds plugin blocks nested inside subsections', async () => {
  const { getDocumentDbTableNames } = await vi.importActual<typeof import('../src/plugins/db-table')>('../src/plugins/db-table');
  const nestedDoc = deserializeDocument(
    `---\nhvy_version: 0.1\n---\n\n<!--hvy: {"id":"root"}-->\n#! Root\n\n <!--hvy:text {}-->\n  Intro\n\n<!--hvy:subsection {"id":"pipeline"}-->\n#! Pipeline\n\n <!--hvy:plugin {"plugin":"dev.heavy.db-table","pluginConfig":{"source":"with-file","table":"job_applications"}}-->\n`,
    '.hvy'
  );

  expect(getDocumentDbTableNames(nestedDoc)).toEqual(['job_applications']);
});

test('isDbTablePluginBlock recognizes db-table plugin blocks', () => {
  const { block } = getDbTableBlock();
  expect(isDbTablePluginBlock(block)).toBe(true);
});

test('isDbTablePluginBlock rejects non-plugin and non-db-table blocks', () => {
  const textDoc = deserializeDocument(
    `---\nhvy_version: 0.1\n---\n\n#! S\n\n <!--hvy:text {}-->\n  Hello\n`,
    '.hvy'
  );
  expect(isDbTablePluginBlock(textDoc.sections[0]!.blocks[0]!)).toBe(false);
});

test('buildDbTableEditFormatInstructions names the table and lists all four tools', () => {
  const instructions = buildDbTableEditFormatInstructions('work_items');
  expect(instructions).toContain('work_items');
  expect(instructions).toContain('`query_db_table`');
  expect(instructions).toContain('`execute_sql`');
  expect(instructions).toContain('`edit_fragment`');
  expect(instructions).toContain('`done`');
  expect(instructions).toContain('SELECT is rejected here');
});

test('buildDbTableEditContext embeds schema, sample rows, and the component fragment', () => {
  const context = buildDbTableEditContext({
    document: getDbTableBlock().document,
    fragment: '<!--hvy:plugin {"plugin":"dev.heavy.db-table","pluginConfig":{"table":"work_items"}}-->',
    summary: SUMMARY_FIXTURE,
  });
  expect(context).toContain('Table name: work_items');
  expect(context).toContain('Total rows: 2');
  expect(context).toContain('- id INTEGER PRIMARY KEY NOT NULL');
  expect(context).toContain('- company TEXT');
  expect(context).toContain('id | company | status');
  expect(context).toContain('1 | Acme | Open');
  expect(context).toContain('Current component HVY');
});

test('parseDbTableEditToolRequest parses each tool shape', () => {
  expect(parseDbTableEditToolRequest('{"tool":"query_db_table","query":"SELECT 1","limit":5}').ok).toBe(true);
  expect(parseDbTableEditToolRequest('{"tool":"execute_sql","sql":"UPDATE t SET x=1"}').ok).toBe(true);
  expect(parseDbTableEditToolRequest('{"tool":"edit_fragment","hvy":"<!--hvy:plugin {}-->"}').ok).toBe(true);
  expect(parseDbTableEditToolRequest('{"tool":"done","summary":"ok"}').ok).toBe(true);
});

test('parseDbTableEditToolRequest rejects unknown tools', () => {
  expect(parseDbTableEditToolRequest('{"tool":"hack_db"}').ok).toBe(false);
});

test('parseDbTableEditToolRequest rejects execute_sql without sql', () => {
  expect(parseDbTableEditToolRequest('{"tool":"execute_sql"}').ok).toBe(false);
  expect(parseDbTableEditToolRequest('{"tool":"execute_sql","sql":"   "}').ok).toBe(false);
});

test('requestAiDbTableEdit runs execute_sql and finishes with done without changing HVY', async () => {
  const { requestAiDbTableEdit } = await import('../src/ai-db-table-edit');
  const { document, block } = getDbTableBlock();
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };

  getDbTableAiSummaryMock.mockResolvedValue(SUMMARY_FIXTURE);
  requestProxyCompletionMock
    .mockResolvedValueOnce('{"tool":"execute_sql","sql":"UPDATE work_items SET status = \'Done\' WHERE id = 1"}')
    .mockResolvedValueOnce('{"tool":"done","summary":"Marked row 1 done."}');
  executeDbTableWriteSqlMock.mockResolvedValueOnce('Rows affected: 1');

  const onBeforeMutation = vi.fn();
  const result = await requestAiDbTableEdit({ settings, document, block, request: 'mark row 1 done', onBeforeMutation });

  expect(executeDbTableWriteSqlMock).toHaveBeenCalledWith('UPDATE work_items SET status = \'Done\' WHERE id = 1');
  expect(onBeforeMutation).toHaveBeenCalledTimes(1);
  expect(result.block).toBe(block);
  expect(result.originalFragment).toBe(result.canonicalFragment);
});

test('requestAiDbTableEdit returns a replacement block when the model emits edit_fragment', async () => {
  const { requestAiDbTableEdit } = await import('../src/ai-db-table-edit');
  const { document, block } = getDbTableBlock();
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };

  getDbTableAiSummaryMock.mockResolvedValue(SUMMARY_FIXTURE);
  const replacementFragment =
    '<!--hvy:plugin {"plugin":"dev.heavy.db-table","pluginConfig":{"source":"with-file","table":"work_items","query":"SELECT * FROM work_items WHERE status != \'Rejected\'"}}-->';
  requestProxyCompletionMock.mockResolvedValueOnce(
    JSON.stringify({ tool: 'edit_fragment', hvy: replacementFragment, summary: 'set query' })
  );

  const onBeforeMutation = vi.fn();
  const result = await requestAiDbTableEdit({ settings, document, block, request: 'filter out rejected', onBeforeMutation });

  expect(onBeforeMutation).toHaveBeenCalledTimes(1);
  expect(result.block).not.toBe(block);
  expect(result.block.schema.plugin).toBe('dev.heavy.db-table');
  expect(result.block.schema.pluginConfig.query).toContain('Rejected');
  expect(executeDbTableWriteSqlMock).not.toHaveBeenCalled();
});

test('requestAiDbTableEdit surfaces tool errors back to the model and keeps going', async () => {
  const { requestAiDbTableEdit } = await import('../src/ai-db-table-edit');
  const { document, block } = getDbTableBlock();
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };

  getDbTableAiSummaryMock.mockResolvedValue(SUMMARY_FIXTURE);
  requestProxyCompletionMock
    .mockResolvedValueOnce('{"tool":"execute_sql","sql":"SELECT 1"}')
    .mockResolvedValueOnce('{"tool":"done","summary":"gave up"}');
  executeDbTableWriteSqlMock.mockImplementationOnce(() => {
    throw new Error('Use query_db_table for read-only SELECT statements.');
  });

  await requestAiDbTableEdit({ settings, document, block, request: 'try to select via execute_sql' });

  const secondCall = requestProxyCompletionMock.mock.calls[1]?.[0];
  const lastMessage = secondCall?.messages[secondCall.messages.length - 1];
  expect(lastMessage?.content).toContain('Use query_db_table');
});

test('requestAiDbTableEdit rejects blocks without a configured table name', async () => {
  const { requestAiDbTableEdit } = await import('../src/ai-db-table-edit');
  const doc = deserializeDocument(
    `---\nhvy_version: 0.1\n---\n\n#! S\n\n <!--hvy:plugin {"plugin":"dev.heavy.db-table","pluginConfig":{"source":"with-file"}}-->\n`,
    '.hvy'
  );
  const block = doc.sections[0]!.blocks[0]!;
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };

  await expect(
    requestAiDbTableEdit({ settings, document: doc, block, request: 'anything' })
  ).rejects.toThrow(/no configured table name/);
  expect(requestProxyCompletionMock).not.toHaveBeenCalled();
});
