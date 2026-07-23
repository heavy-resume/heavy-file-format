import { expect, test, vi } from 'vitest';

import { buildChatCliPersistentInstructions } from '../src/chat-cli/chat-cli-instructions';
import { createChatCliInterface } from '../src/chat-cli/chat-cli-interface';
import { deserializeDocument, serializeDocument } from '../src/serialization';
import type { HvyEmbeddingProvider } from '../src/types';

function createChatCliTestDocument() {
  return deserializeDocument(`---
hvy_version: 0.1
title: Chat CLI Test
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"intro"}-->
 Existing content
`, '.hvy');
}

test('chat cli persistent instructions stay model-facing', () => {
  const cli = createChatCliInterface(createChatCliTestDocument());
  const instructions = buildChatCliPersistentInstructions();

  expect(instructions).toContain('virtual filesystem');
  expect(instructions).toContain('will become one .hvy file');
  expect(instructions).toContain('/scratchpad.txt is optional temporary working memory');
  expect(instructions).toContain('Do not use /scratchpad.txt to report completion');
  expect(instructions).toContain('CSS values are inline declaration strings');
  expect(instructions).toContain('Use hvy request_structure');
  expect(instructions).toContain('localized, exhaustive, or a searchable batch');
  expect(instructions).toContain('semantic search does not prove completeness');
  expect(instructions).toContain('man/help');
  expect(instructions).not.toContain('HVY quick reference');
  expect(instructions).not.toContain('ai_cli_log.txt');
  expect(instructions).not.toContain('hvy plugin db-table query [SELECT/WITH SQL]');
  expect('persistentInstructions' in cli).toBe(false);
  expect(cli.snapshot().scratchpad).toContain('You havent written your plan yet.');
  expect(cli.snapshot().scratchpadEdited).toBe(false);
  expect(cli.snapshot().cwd).toBe('/');
});

test('chat cli exposes an ephemeral scratchpad file for task notes', async () => {
  const document = createChatCliTestDocument();
  const cli = createChatCliInterface(document);

  expect((await cli.run('ls /')).output).toContain('file scratchpad.txt');
  expect((await cli.run('cat scratchpad.txt')).output).toContain('You havent written your plan yet.');
  expect(cli.snapshot().scratchpadEdited).toBe(false);
  expect((await cli.run('echo "Found summary section" > scratchpad.txt')).output).toBe('/scratchpad.txt: written');
  expect(cli.snapshot().scratchpadEdited).toBe(true);
  expect(cli.snapshot().scratchpadCommandsSinceEdit).toEqual([]);
  await cli.run('pwd');
  await cli.run('ls /body');
  expect(cli.snapshot().scratchpadCommandsSinceEdit).toEqual(['pwd', 'ls /body']);
  expect((await cli.run('echo "Added chores section" >> /scratchpad.txt')).output).toBe('/scratchpad.txt: appended');
  expect(cli.snapshot().scratchpadCommandsSinceEdit).toEqual([]);
  expect((await cli.run('nl scratchpad.txt')).output).toContain('Found summary section');
  expect((await cli.run('cat /scratchpad.txt')).output).toContain('Added chores section');
  expect(serializeDocument(document)).not.toContain('Found summary section');
});

test('chat cli runs commands against the document filesystem and persists mutations', async () => {
  const document = createChatCliTestDocument();
  const cli = createChatCliInterface(document);

  expect((await cli.run('pwd')).output).toBe('/');
  expect((await cli.run('hvy insert 0 section /body chores "Chores"')).mutated).toBe(true);
  const addTextResult = await cli.run('hvy insert 0 text /body/chores note');
  expect(addTextResult.output).toContain('/body/chores/note: created');
  expect(addTextResult.output).toContain('file text.json');
  expect(addTextResult.output).toContain('file text.txt');
  expect((await cli.run('echo "Weekly chore plan" > /body/chores/note/text.txt')).mutated).toBe(true);
  expect((await cli.run('find /body -type d -maxdepth 1')).output).toContain('/body/chores');
  expect((await cli.run('cat /chores/note/text.txt')).output).toBe('Weekly chore plan\n');
  expect(cli.snapshot().cwd).toBe('/body/chores/note');
  expect(serializeDocument(document)).toContain('Weekly chore plan');
});

test('expected result: chat CLI hvy search uses embeddings when embedding retrieval is enabled', async () => {
  const embeddingProvider: HvyEmbeddingProvider = vi.fn(async (request) =>
    request.inputs.map((input) => ({
      id: input.id,
      vector: input.id === 'query' || /existing content|intro/i.test(input.text)
        ? [1, 0]
        : [0, 1],
    }))
  );
  const cli = createChatCliInterface(createChatCliTestDocument(), undefined, {
    chatContext: { mode: 'embedding-retrieval' },
    embeddingProvider,
  });

  const expectedResult = await cli.run('hvy search "intro content" --max 5 --json');
  const parsed = JSON.parse(expectedResult.output);

  expect(parsed.mode).toBe('embeddings');
  expect(parsed.results[0]).toEqual(expect.objectContaining({
    path: '/body/summary/intro',
    kind: 'component',
    type: 'text',
  }));
  expect(expectedResult.output).not.toContain('"score"');
  expect(embeddingProvider).toHaveBeenCalled();
});
