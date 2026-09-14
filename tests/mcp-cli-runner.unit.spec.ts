import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';

import { runHvyCliOnFile } from '../scripts/hvy-mcp-cli.mjs';

test('expected result: MCP CLI runner loads SQL.js for schema inspection and lint', async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'hvy-mcp-cli-test-'));
  const filePath = join(temporaryDirectory, 'database.hvy');
  await writeFile(filePath, '---\nhvy_version: 0.1\n---\n');

  const expectedResult = await runHvyCliOnFile({
    filePath,
    commands: [
      'hvy plugin db-table exec "CREATE TABLE work_log_entries (id INTEGER PRIMARY KEY, category TEXT)"',
      'hvy plugin db-table schema work_log_entries',
      'hvy lint',
    ],
  });

  expect(expectedResult.results[1]?.output).toContain('category');
  expect(expectedResult.results[2]?.output).toBe('No lint issues.');
});
