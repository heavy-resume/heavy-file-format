import { describe, expect, test } from 'vitest';
import { diffTextGraphemes, segmentTextGraphemes } from '../src/target-text-comparison/target-text-diff';

describe('target text comparison diff', () => {
  test('expected result: unchanged graphemes stay unmarked around separate edits', () => {
    const before = segmentTextGraphemes('Fake small team.').map(({ segment }) => segment);
    const after = segmentTextGraphemes('Fake smarter team!').map(({ segment }) => segment);
    const expectedResult = diffTextGraphemes(before, after);

    expect(before.filter((_value, index) => expectedResult.removed[index]).join('')).toBe('ll.');
    expect(after.filter((_value, index) => expectedResult.added[index]).join('')).toBe('rter!');
  });

  test('expected result: emoji grapheme clusters are never split', () => {
    const before = segmentTextGraphemes('Fake 👩🏽‍💻 draft');
    const after = segmentTextGraphemes('Fake ✅ draft');
    const expectedResult = diffTextGraphemes(
      before.map(({ segment }) => segment),
      after.map(({ segment }) => segment)
    );

    expect(before.filter((_value, index) => expectedResult.removed[index]).map(({ segment }) => segment)).toEqual(['👩🏽‍💻']);
    expect(after.filter((_value, index) => expectedResult.added[index]).map(({ segment }) => segment)).toEqual(['✅']);
  });
});
