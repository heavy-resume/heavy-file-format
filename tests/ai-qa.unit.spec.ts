import { beforeEach, expect, test, vi } from 'vitest';

import { assertReadOnlyQuery, buildQaToolLoopFormatInstructions, parseQaToolRequest } from '../src/ai-qa';
import { deserializeDocument } from '../src/serialization';
import type { ChatSettings } from '../src/types';

const { requestProxyCompletionMock } = vi.hoisted(() => ({
  requestProxyCompletionMock: vi.fn(),
}));

vi.mock('../src/chat/chat', async () => {
  const actual = await vi.importActual<typeof import('../src/chat/chat')>('../src/chat/chat');
  return {
    ...actual,
    requestProxyCompletion: requestProxyCompletionMock,
  };
});

const { executeDbTableQueryToolMock } = vi.hoisted(() => ({
  executeDbTableQueryToolMock: vi.fn(),
}));

vi.mock('../src/plugins/db-table', async () => {
  const actual = await vi.importActual<typeof import('../src/plugins/db-table')>('../src/plugins/db-table');
  return {
    ...actual,
    executeDbTableQueryTool: executeDbTableQueryToolMock,
  };
});

beforeEach(() => {
  requestProxyCompletionMock.mockReset();
  executeDbTableQueryToolMock.mockReset();
});

const DOC_WITH_DB_TABLE = `---
hvy_version: 0.1
---

<!--hvy: {"id":"data"}-->
#! Data

 <!--hvy:plugin {"plugin":"dev.heavy.db-table","pluginConfig":{"source":"with-file","table":"work_items"}}-->
`;

const DOC_WITHOUT_DB_TABLE = `---
hvy_version: 0.1
---

#! Summary

 <!--hvy:text {}-->
  Plain doc.
`;

test('buildQaToolLoopFormatInstructions advertises query_db_table and answer tools', () => {
  const instructions = buildQaToolLoopFormatInstructions(['work_items', 'notes']);

  expect(instructions).toContain('`query_db_table`');
  expect(instructions).toContain('`answer`');
  expect(instructions).toContain('work_items, notes');
  expect(instructions).toContain('read-only');
});

test('parseQaToolRequest accepts an answer tool call', () => {
  const parsed = parseQaToolRequest('{"tool":"answer","answer":"Hello"}');
  expect(parsed.ok).toBe(true);
  if (parsed.ok) {
    expect(parsed.value).toEqual({ tool: 'answer', answer: 'Hello' });
  }
});

test('parseQaToolRequest accepts a query_db_table tool call with limit', () => {
  const parsed = parseQaToolRequest('{"tool":"query_db_table","table_name":"work_items","limit":5}');
  expect(parsed.ok).toBe(true);
  if (parsed.ok && parsed.value.tool === 'query_db_table') {
    expect(parsed.value.table_name).toBe('work_items');
    expect(parsed.value.limit).toBe(5);
  }
});

test('parseQaToolRequest rejects unknown tools', () => {
  const parsed = parseQaToolRequest('{"tool":"delete_everything"}');
  expect(parsed.ok).toBe(false);
});

test('runQaToolLoop executes query_db_table then returns the final answer', async () => {
  const { runQaToolLoop } = await import('../src/ai-qa');
  const document = deserializeDocument(DOC_WITH_DB_TABLE, '.hvy');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };

  requestProxyCompletionMock
    .mockResolvedValueOnce('{"tool":"query_db_table","table_name":"work_items","limit":3}')
    .mockResolvedValueOnce('{"tool":"answer","answer":"Three rows total."}');
  executeDbTableQueryToolMock.mockResolvedValueOnce('Returned rows: 3\nid | company\n---|---\n1 | Acme');

  const answer = await runQaToolLoop({ settings, document, messages: [], question: 'How many?' });

  expect(answer).toBe('Three rows total.');
  expect(executeDbTableQueryToolMock).toHaveBeenCalledWith(document, {
    tableName: 'work_items',
    query: undefined,
    limit: 3,
  });
  expect(requestProxyCompletionMock).toHaveBeenCalledTimes(2);
});

test('runQaToolLoop rejects write SQL statements before hitting the DB', async () => {
  const { runQaToolLoop } = await import('../src/ai-qa');
  const document = deserializeDocument(DOC_WITH_DB_TABLE, '.hvy');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };

  requestProxyCompletionMock
    .mockResolvedValueOnce('{"tool":"query_db_table","query":"DROP TABLE work_items"}')
    .mockResolvedValueOnce('{"tool":"answer","answer":"Refused to drop."}');

  const answer = await runQaToolLoop({ settings, document, messages: [], question: 'drop please' });

  expect(answer).toBe('Refused to drop.');
  expect(executeDbTableQueryToolMock).not.toHaveBeenCalled();
  const followupCall = requestProxyCompletionMock.mock.calls[1]?.[0];
  const forwardedMessages = followupCall?.messages ?? [];
  const lastUserMessage = forwardedMessages[forwardedMessages.length - 1];
  expect(lastUserMessage?.content).toContain('only accepts read-only');
});

test('assertReadOnlyQuery allows plain SELECT statements', () => {
  expect(() => assertReadOnlyQuery('SELECT * FROM work_items')).not.toThrow();
  expect(() => assertReadOnlyQuery('select id, company from work_items where status != "Rejected"')).not.toThrow();
});

test('assertReadOnlyQuery allows WITH / CTE queries', () => {
  expect(() =>
    assertReadOnlyQuery('WITH recent AS (SELECT * FROM work_items) SELECT company FROM recent')
  ).not.toThrow();
});

test('assertReadOnlyQuery allows SELECT with leading whitespace or line comments', () => {
  expect(() => assertReadOnlyQuery('   \n  SELECT 1')).not.toThrow();
  expect(() => assertReadOnlyQuery('-- note: read only\nSELECT 1')).not.toThrow();
  expect(() => assertReadOnlyQuery('/* block */ SELECT 1')).not.toThrow();
});

test('assertReadOnlyQuery allows SELECT touching columns whose names contain reserved keywords', () => {
  expect(() => assertReadOnlyQuery('SELECT inserted_stuff FROM work_items')).not.toThrow();
  expect(() => assertReadOnlyQuery('SELECT created_by, updated_at FROM work_items')).not.toThrow();
  expect(() => assertReadOnlyQuery('SELECT drop_date FROM events')).not.toThrow();
});

test('assertReadOnlyQuery allows SELECT with a column literally named "drop" in quotes', () => {
  expect(() => assertReadOnlyQuery('SELECT "drop" FROM t')).not.toThrow();
  expect(() => assertReadOnlyQuery('SELECT id AS "update" FROM t')).not.toThrow();
});

test('assertReadOnlyQuery allows SELECT with keyword-looking string literals or comments', () => {
  expect(() => assertReadOnlyQuery(`SELECT 'please drop' AS msg`)).not.toThrow();
  expect(() => assertReadOnlyQuery('SELECT 1 /* drop fix */')).not.toThrow();
});

test('assertReadOnlyQuery blocks statements whose leading token is not SELECT or WITH', () => {
  expect(() => assertReadOnlyQuery('DROP TABLE work_items')).toThrow(/read-only/);
  expect(() => assertReadOnlyQuery('INSERT INTO work_items VALUES (1)')).toThrow(/read-only/);
  expect(() => assertReadOnlyQuery('UPDATE work_items SET status = "Done"')).toThrow(/read-only/);
  expect(() => assertReadOnlyQuery('DELETE FROM work_items')).toThrow(/read-only/);
  expect(() => assertReadOnlyQuery('ALTER TABLE work_items ADD COLUMN x INT')).toThrow(/read-only/);
  expect(() => assertReadOnlyQuery('PRAGMA journal_mode = WAL')).toThrow(/read-only/);
  expect(() => assertReadOnlyQuery('ATTACH DATABASE "x" AS x')).toThrow(/read-only/);
  expect(() => assertReadOnlyQuery('VACUUM')).toThrow(/read-only/);
  expect(() => assertReadOnlyQuery('  \n  drop table t')).toThrow(/read-only/);
});

test('assertReadOnlyQuery blocks write statements hidden behind comments', () => {
  expect(() => assertReadOnlyQuery('-- hi\nDROP TABLE t')).toThrow(/read-only/);
  expect(() => assertReadOnlyQuery('/* spacer */ DELETE FROM t')).toThrow(/read-only/);
});

test('assertReadOnlyQuery is a no-op for undefined queries (table_name-only path)', () => {
  expect(() => assertReadOnlyQuery(undefined)).not.toThrow();
  expect(() => assertReadOnlyQuery('')).not.toThrow();
});

test('runQaToolLoop requires at least one DB table', async () => {
  const { runQaToolLoop } = await import('../src/ai-qa');
  const document = deserializeDocument(DOC_WITHOUT_DB_TABLE, '.hvy');
  const settings: ChatSettings = { provider: 'openai', model: 'gpt-5-mini' };

  await expect(
    runQaToolLoop({ settings, document, messages: [], question: 'anything' })
  ).rejects.toThrow(/requires at least one DB table/);
});
