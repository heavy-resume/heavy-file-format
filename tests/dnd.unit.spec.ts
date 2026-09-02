import { expect, test } from 'vitest';

import {
  calculateSectionDragAutoScrollDelta,
  getSectionDropPosition,
  getTableItemMoveIndex,
  getTableRowDragImageSize,
  getTableRowDropPosition,
} from '../src/bind/handlers/dnd';

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

test('getTableRowDropPosition splits row targets into before and after zones', () => {
  expect(getTableRowDropPosition(109, { top: 100, height: 20 })).toBe('before');
  expect(getTableRowDropPosition(111, { top: 100, height: 20 })).toBe('after');
});

test('getTableItemMoveIndex resolves visual insertion edges in either drag direction', () => {
  expect(getTableItemMoveIndex(0, 2, 'before', 4)).toBe(1);
  expect(getTableItemMoveIndex(0, 2, 'after', 4)).toBe(2);
  expect(getTableItemMoveIndex(3, 1, 'before', 4)).toBe(1);
  expect(getTableItemMoveIndex(3, 1, 'after', 4)).toBe(2);
});

test('getTableRowDragImageSize preserves ordinary rows and caps overflow to the preview frame', () => {
  expect(getTableRowDragImageSize(
    { width: 760, height: 80 },
    { width: 800, height: 600 }
  )).toEqual({ width: 760, height: 80 });
  expect(getTableRowDragImageSize(
    { width: 1200, height: 400 },
    { width: 800, height: 600 }
  )).toEqual({ width: 680, height: 210 });
});
