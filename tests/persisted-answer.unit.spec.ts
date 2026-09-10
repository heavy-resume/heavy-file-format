import { describe, expect, test } from 'vitest';

import { convertInlineAnswerMarkerRange, updateInlineAnswerMarkerStates } from '../src/block-ops';

describe('inline text answers', () => {
  test('converts only the selected consecutive marker range', () => {
    expect(convertInlineAnswerMarkerRange('[ ] Separate\n\n- [x] One\n- [x] Two', 1, 2, true)).toBe(
      '[ ] Separate\n\n- (x) One\n- ( ) Two'
    );
  });

  test('converting to radio preserves at most one selected answer', () => {
    expect(convertInlineAnswerMarkerRange('- [x] One\n- [ ] Two\n- [x] Three', 0, 2, true)).toBe(
      '- (x) One\n- ( ) Two\n- ( ) Three'
    );
  });

  test('updates persisted marker state without changing its control type', () => {
    expect(updateInlineAnswerMarkerStates('- (x) Email\n- ( ) Phone\n\n[ ] Copy', new Map([[0, false], [1, true], [2, true]]))).toBe(
      '- ( ) Email\n- (x) Phone\n\n[x] Copy'
    );
  });
});
