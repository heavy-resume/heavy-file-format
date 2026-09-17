import { expect, test } from 'vitest';
import { isLinkInputValue, normalizeLinkInputValue, serializeMarkdownLinkDestination } from '../src/link-value';
import { markdownToReaderHtml, turndown } from '../src/markdown';

for (const [input, normalized, destination] of [
  [' Pub URL ', 'Pub URL', 'Pub%20URL'],
  ['fake.example', 'https://fake.example', 'https://fake.example'],
  ['fake@fake.example', 'mailto:fake@fake.example', 'mailto:fake@fake.example'],
  ['https://fake.example/Fake File(1)', 'https://fake.example/Fake File(1)', 'https://fake.example/Fake%20File\\(1\\)'],
  ['https://fake.example/Fake%20File', 'https://fake.example/Fake%20File', 'https://fake.example/Fake%20File'],
  ['#fake-target', '#fake-target', '#fake-target'],
  ['', '', ''],
]) {
  test(`expected result: shared link conversion preserves the editor behavior for ${JSON.stringify(input)}`, () => {
    expect(normalizeLinkInputValue(input)).toBe(normalized);
    expect(serializeMarkdownLinkDestination(normalizeLinkInputValue(input))).toBe(destination);
    if (destination) {
      expect(markdownToReaderHtml(`[Fake link](${destination})`)).toContain('<a href=');
      expect(turndown.turndown(`<a href="${normalized}">Fake link</a>`)).toBe(`[Fake link](${destination})`);
    }
  });
}

test('expected result: selection inference still distinguishes recognized addresses from manually entered relative destinations', () => {
  expect(isLinkInputValue(normalizeLinkInputValue('fake.example'))).toBe(true);
  expect(isLinkInputValue(normalizeLinkInputValue('fake@fake.example'))).toBe(true);
  expect(isLinkInputValue('Pub URL')).toBe(false);
});
