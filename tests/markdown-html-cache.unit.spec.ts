import { beforeEach, expect, test, vi } from 'vitest';
import { marked } from 'marked';

import { markdownToReaderHtml } from '../src/markdown';
import type { TextPlaceholderDefinition } from '../src/editor/component-helpers';

const parse = vi.spyOn(marked, 'parse');

beforeEach(() => {
  parse.mockClear();
});

test('rendering the same text again reuses its parsed HTML', () => {
  const firstResult = markdownToReaderHtml('Fake **reuse** text');

  const secondResult = markdownToReaderHtml('Fake **reuse** text');

  expect(secondResult).toBe(firstResult);
  expect(parse).toHaveBeenCalledTimes(1);
});

test('different text gets its own HTML', () => {
  expect(markdownToReaderHtml('Fake **first** text')).toContain('<strong>first</strong>');
  expect(markdownToReaderHtml('Fake **second** text')).toContain('<strong>second</strong>');
});

test('the same text with different placeholder values shows each value', () => {
  const source = 'State: <!-- placeholder fake-status -->';
  const placeholder = (value: string): TextPlaceholderDefinition => ({
    name: 'fake-status',
    label: 'Fake status',
    render: () => `<span class="fake-status">${value}</span>`,
  });

  const firstResult = markdownToReaderHtml(source, { textPlaceholders: [placeholder('fake one')] });
  const secondResult = markdownToReaderHtml(source, { textPlaceholders: [placeholder('fake two')] });

  expect(firstResult).toContain('<span class="fake-status">fake one</span>');
  expect(firstResult).not.toContain('fake two');
  expect(secondResult).toContain('<span class="fake-status">fake two</span>');
  expect(secondResult).not.toContain('fake one');
});

test('the same text with different line styles applies each style', () => {
  const source = '^fake^Fake styled line';

  const redResult = markdownToReaderHtml(source, { textLineStyles: { fake: { label: 'Fake', css: 'color: red;' } } as never });
  const blueResult = markdownToReaderHtml(source, { textLineStyles: { fake: { label: 'Fake', css: 'color: blue;' } } as never });

  expect(redResult).toContain('red');
  expect(blueResult).toContain('blue');
});

test('the cache stays bounded and evicted text still renders correctly', () => {
  for (let index = 0; index < 5000; index += 1) {
    markdownToReaderHtml(`Fake eviction ${index}`);
  }
  parse.mockClear();

  expect(markdownToReaderHtml('Fake eviction 0')).toContain('Fake eviction 0');
  expect(parse).toHaveBeenCalledTimes(1);
  expect(markdownToReaderHtml('Fake eviction 4999')).toContain('Fake eviction 4999');
  expect(parse).toHaveBeenCalledTimes(1);
});
