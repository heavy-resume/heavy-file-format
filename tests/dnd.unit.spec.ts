import { expect, test } from 'vitest';

import { calculateSectionDragAutoScrollDelta, getSectionDropPosition } from '../src/bind/handlers/dnd';

test('calculateSectionDragAutoScrollDelta scrolls up near the top edge', () => {
  const expectedResult = calculateSectionDragAutoScrollDelta(116, { top: 100, bottom: 500 });

  expect(expectedResult).toBeLessThan(0);
});

test('calculateSectionDragAutoScrollDelta scrolls down near the bottom edge', () => {
  const expectedResult = calculateSectionDragAutoScrollDelta(484, { top: 100, bottom: 500 });

  expect(expectedResult).toBeGreaterThan(0);
});

test('calculateSectionDragAutoScrollDelta does not scroll away from edges', () => {
  const expectedResult = calculateSectionDragAutoScrollDelta(300, { top: 100, bottom: 500 });

  expect(expectedResult).toBe(0);
});

test('getSectionDropPosition splits section targets into before and after zones', () => {
  expect(getSectionDropPosition(120, { top: 100, height: 100 })).toBe('before');
  expect(getSectionDropPosition(180, { top: 100, height: 100 })).toBe('after');
});
