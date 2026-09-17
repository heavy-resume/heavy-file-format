import { expect, test } from 'vitest';
import { isAiEditablePlaceholderTextBlock } from '../src/ai-placeholder';
import { defaultBlockSchema } from '../src/document-factory';

test.each(['Location', 'loc', '**Location**', 'A different value'])('saved text %s is not an empty placeholder', (text) => {
  expect(isAiEditablePlaceholderTextBlock({
    id: 'example-text', text, schemaMode: false,
    schema: { ...defaultBlockSchema('text'), placeholder: 'location' },
  })).toBe(false);
});

test('empty text with a placeholder remains editable on click', () => {
  expect(isAiEditablePlaceholderTextBlock({
    id: 'example-empty', text: '  ', schemaMode: false,
    schema: { ...defaultBlockSchema('text'), placeholder: 'Example placeholder' },
  })).toBe(true);
});
