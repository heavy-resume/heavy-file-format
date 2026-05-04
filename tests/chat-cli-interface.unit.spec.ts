import { expect, test } from 'vitest';

import { createChatCliInterface } from '../src/chat-cli/chat-cli-interface';
import { deserializeDocument, serializeDocument } from '../src/serialization';

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

test('chat cli gives minimal persistent filesystem-oriented instructions', () => {
  const cli = createChatCliInterface(createChatCliTestDocument());

  expect(cli.persistentInstructions).toContain('virtual filesystem');
  expect(cli.persistentInstructions).toContain('will become one .hvy file');
  expect(cli.persistentInstructions).toContain('/scratchpad.txt contains your ephemeral task notes');
  expect(cli.persistentInstructions).toContain('Use shell commands and `help` or `man`');
  expect(cli.persistentInstructions).not.toContain('HVY quick reference');
  expect(cli.persistentInstructions).not.toContain('ai_cli_log.txt');
  expect(cli.persistentInstructions).not.toContain('hvy plugin db-table query [SELECT/WITH SQL]');
  expect(cli.snapshot().persistentInstructions).toBe(cli.persistentInstructions);
  expect(cli.snapshot().scratchpad).toContain('No notes yet');
  expect(cli.snapshot().cwd).toBe('/');
});

test('chat cli exposes an ephemeral scratchpad file for task notes', async () => {
  const document = createChatCliTestDocument();
  const cli = createChatCliInterface(document);

  expect((await cli.run('ls /')).output).toContain('file scratchpad.txt');
  expect((await cli.run('cat scratchpad.txt')).output).toContain('No notes yet');
  expect((await cli.run('echo "Found summary section" > scratchpad.txt')).output).toBe('/scratchpad.txt: written');
  expect((await cli.run('echo "Added chores section" >> /scratchpad.txt')).output).toBe('/scratchpad.txt: appended');
  expect((await cli.run('nl scratchpad.txt')).output).toContain('Found summary section');
  expect((await cli.run('cat /scratchpad.txt')).output).toContain('Added chores section');
  expect(serializeDocument(document)).not.toContain('Found summary section');
});

test('chat cli runs commands against the document filesystem and persists mutations', async () => {
  const document = createChatCliTestDocument();
  const cli = createChatCliInterface(document);

  expect((await cli.run('pwd')).output).toBe('/');
  expect((await cli.run('hvy add section /body chores "Chores"')).mutated).toBe(true);
  expect((await cli.run('hvy add text /body/chores note "Weekly chore plan"')).output).toBe('/body/chores/note');
  expect((await cli.run('find /body -type d -maxdepth 1')).output).toContain('/body/chores');
  expect((await cli.run('cat /chores/note/text.txt')).output).toBe('Weekly chore plan');
  expect(cli.snapshot().cwd).toBe('/');
  expect(serializeDocument(document)).toContain('Weekly chore plan');
});
