import { expect, test } from 'vitest';

import { normalizeMarkdownIndentation } from '../src/markdown';

test('normalizes fully indented text so indentation alone does not imply code', () => {
  expect(normalizeMarkdownIndentation('    Seattle, WA')).toBe('Seattle, WA');
});

test('preserves fenced code relative indentation after removing outer indentation', () => {
  expect(normalizeMarkdownIndentation('  ```ts\n    const answer = 42;\n  ```')).toBe('```ts\n  const answer = 42;\n```');
});

test('preserves nested list indentation when content starts at column zero', () => {
  expect(normalizeMarkdownIndentation('Skills\n  - TypeScript\n  - Testing')).toBe('Skills\n  - TypeScript\n  - Testing');
});
