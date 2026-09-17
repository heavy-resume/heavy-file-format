import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';

import {
  buildHvyEmbeddingsOnFile,
  runHvyCliOnFile,
  searchHvyFile,
  walkHvyFile,
} from '../scripts/hvy-mcp-cli.mjs';

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

test('expected result: MCP runner walks and persists searchable embeddings for anonymous components', async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'hvy-mcp-agent-tools-test-'));
  const filePath = join(temporaryDirectory, 'document.hvy');
  await writeFile(filePath, `---
hvy_version: 0.1
---

<!--hvy: {"id":"alpha"}-->
#! Alpha

<!--hvy:text {}-->
 alpha facts
`);
  const embeddingProvider = {
    provider: 'openai',
    baseUrl: 'https://embedding.test/v1',
    apiKey: 'test-key',
  };
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    const input = JSON.parse(String(init?.body)).input as string[];
    return new Response(JSON.stringify({
      data: input.map(() => ({ embedding: [1, 0, 0] })),
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }));

  const walk = await walkHvyFile({ filePath, limit: 1 });
  expect(walk.items).toHaveLength(1);
  expect(walk.reviewedThrough).toBe(1);

  const built = await buildHvyEmbeddingsOnFile({
    filePath,
    embeddingProvider,
    embeddingModel: 'test-model',
    embeddingBatchSize: 256,
  });
  expect(built.rebuiltChunks).toBeGreaterThan(0);
  expect(new TextDecoder().decode(await readFile(filePath))).toContain('application/vnd.hvy.embedding-index');

  const search = await searchHvyFile({
    filePath,
    query: 'alpha',
    semantic: true,
    embeddingProvider,
    embeddingModel: 'test-model',
    embeddingBatchSize: 256,
  });
  expect(search.mode).toBe('embeddings');
  expect(search.results.length).toBeGreaterThan(0);
  expect(fetch).toHaveBeenCalledTimes(2);
  vi.unstubAllGlobals();
});

test('expected result: MCP persists targeted template edits beyond the raw document limit and preserves tail bytes', async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'hvy-mcp-templates-test-'));
  const filePath = join(temporaryDirectory, 'fake-large.thvy');
  await writeFile(filePath, Buffer.concat([
    Buffer.from(`---\nhvy_version: 0.1\ndescription: ${'Fake large document. '.repeat(300)}\n---\n\n<!--hvy:tail {"id":"fake-attachment","mime":"application/octet-stream","length":4}-->\n--HVY-TAIL--\n`),
    Buffer.from([0, 255, 10, 128]),
  ]));

  const expectedResult = await runHvyCliOnFile({
    filePath,
    commands: [
      'ls /',
      'hvy insert -1 text /templates/components --id fake-text',
      'printf "Fake saved text" > /templates/components/fake-text/schema/text.txt',
      'hvy insert -1 section /templates/sections --id fake-section',
      'hvy insert -1 fake-text /templates/sections/fake-section/template --id fake-child',
    ],
  });

  expect(expectedResult.mutated).toBe(true);
  expect(expectedResult.results[0].output).toContain('raw-preview.hvy.txt');
  expect(expectedResult.results[0].output).not.toMatch(/file raw\.hvy/);
  expect((await readFile(filePath)).subarray(-4)).toEqual(Buffer.from([0, 255, 10, 128]));
  expect((await runHvyCliOnFile({ filePath, commands: [
    'cat /templates/components/fake-text/schema/text.txt',
    'cat /templates/sections/fake-section/template/fake-child/fake-text.txt',
  ] })).results.map((result: { output: string }) => result.output.trim())).toEqual(['Fake saved text', 'Fake saved text']);
});
