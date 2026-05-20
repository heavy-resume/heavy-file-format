import { expect, test } from 'vitest';

import { completeCliInput } from '../src/cli-ui/completion';
import { deserializeDocument } from '../src/serialization';

function createCompletionDocument() {
  return deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"intro"}-->
 Hello world

<!--hvy: {"id":"skills"}-->
#! Skills

<!--hvy:text {"id":"skill-one"}-->
 Skill one
`, '.hvy');
}

test('CLI tab completion completes command names', () => {
  const document = createCompletionDocument();
  const result = completeCliInput({
    document,
    session: { cwd: '/' },
    value: 'ca',
    selectionStart: 2,
    selectionEnd: 2,
  });

  expect(result).toEqual({ value: 'cat', selectionStart: 3, selectionEnd: 3 });
});

test('CLI tab completion completes absolute paths', () => {
  const document = createCompletionDocument();
  const result = completeCliInput({
    document,
    session: { cwd: '/' },
    value: 'ls /body/sum',
    selectionStart: 'ls /body/sum'.length,
    selectionEnd: 'ls /body/sum'.length,
  });

  expect(result).toEqual({
    value: 'ls /body/summary/',
    selectionStart: 'ls /body/summary/'.length,
    selectionEnd: 'ls /body/summary/'.length,
  });
});

test('CLI tab completion completes relative paths from cwd', () => {
  const document = createCompletionDocument();
  const result = completeCliInput({
    document,
    session: { cwd: '/body/summary' },
    value: 'cat in',
    selectionStart: 'cat in'.length,
    selectionEnd: 'cat in'.length,
  });

  expect(result).toEqual({
    value: 'cat intro/',
    selectionStart: 'cat intro/'.length,
    selectionEnd: 'cat intro/'.length,
  });
});

test('CLI tab completion leaves ambiguous matches unchanged when there is no longer shared prefix', () => {
  const document = createCompletionDocument();
  const result = completeCliInput({
    document,
    session: { cwd: '/' },
    value: 'ls /body/s',
    selectionStart: 'ls /body/s'.length,
    selectionEnd: 'ls /body/s'.length,
  });

  expect(result).toBeNull();
});
