import { describe, expect, test } from 'vitest';
import type { CanvasDrawing, CanvasItem } from '../src/plugins/canvas/canvas-drawing-format';
import { collectGuideTargets, snapBoundsToGuides, snapPointToGuides } from '../src/plugins/canvas/canvas-guides';
import { findItemsInBox, findTopmostItem, resizeBounds, transformItem } from '../src/plugins/canvas/canvas-selection';
import { applySizeToRuns, runsToLines, runsToTextFields, textItemRuns } from '../src/plugins/canvas/canvas-text-runs';

const box: CanvasItem = { kind: 'shape', id: 'shape-box', shape: 'rect', from: { x: 100, y: 100 }, to: { x: 200, y: 160 }, color: '#111111', width: 2 };
const arrow: CanvasItem = { kind: 'shape', id: 'shape-arrow', shape: 'line', from: { x: 200, y: 130 }, to: { x: 320, y: 130 }, color: '#111111', width: 2 };
const scribble: CanvasItem = { kind: 'brush', id: 'brush-scribble', color: '#111111', width: 4, points: [{ x: 120, y: 120 }, { x: 180, y: 140 }] };
const label: CanvasItem = { kind: 'text', id: 'text-label', text: 'Placeholder', at: { x: 400, y: 50 }, size: 20, color: '#111111', font: 'sans-serif' };

function twoLayers(below: CanvasItem[], above: CanvasItem[]): CanvasDrawing {
  return {
    version: 2,
    layers: [
      { id: 'below', name: 'Below', visible: true, locked: false, items: below },
      { id: 'above', name: 'Above', visible: true, locked: false, items: above },
    ],
  };
}

describe('canvas selection', () => {
  test('clicking picks the topmost item, searching only the selected layers', () => {
    const drawing = twoLayers([box], [scribble]);

    expect(findTopmostItem(drawing, new Set(['below', 'above']), { x: 150, y: 130 }, 3)?.item.id).toBe('brush-scribble');
    expect(findTopmostItem(drawing, new Set(['below']), { x: 150, y: 130 }, 3)?.item.id).toBe('shape-box');
    expect(findTopmostItem(drawing, new Set(['below', 'above']), { x: 600, y: 300 }, 3)).toBeNull();
  });

  test('a selection box picks only items entirely inside it, on selected layers', () => {
    const drawing = twoLayers([box, arrow], [scribble, label]);

    expect(findItemsInBox(drawing, new Set(['below', 'above']), { left: 90, top: 90, right: 210, bottom: 170 })).toEqual(['shape-box', 'brush-scribble']);
    expect(findItemsInBox(drawing, new Set(['above']), { left: 90, top: 90, right: 210, bottom: 170 })).toEqual(['brush-scribble']);
  });

  test('dragging a corner handle with Shift keeps proportions; edges stretch one axis', () => {
    const bounds = { left: 0, top: 0, right: 100, bottom: 50 };

    expect(resizeBounds(bounds, 'se', { x: 300, y: 60 }, true, 1)).toEqual({ left: 0, top: 0, right: 300, bottom: 150 });
    expect(resizeBounds(bounds, 'e', { x: 200, y: 999 }, false, 1)).toEqual({ left: 0, top: 0, right: 200, bottom: 50 });
    expect(resizeBounds(bounds, 'w', { x: 500, y: 0 }, false, 1)).toEqual({ left: 99, top: 0, right: 100, bottom: 50 });
  });

  test('scaling a brush stroke by its box moves its points and keeps its width', () => {
    const from = { left: 120, top: 120, right: 180, bottom: 140 };
    const to = { left: 120, top: 120, right: 240, bottom: 160 };

    expect(transformItem(scribble, from, to)).toEqual({ ...scribble, points: [{ x: 120, y: 120 }, { x: 240, y: 160 }] });
  });
});

describe('canvas alignment guides', () => {
  test('a point snaps each axis independently to item key points within range, and holds until released', () => {
    const targets = collectGuideTargets(twoLayers([box], [arrow]), new Set());

    const firstSnap = snapPointToGuides({ x: 203, y: 127 }, targets, 6, { x: null, y: null });
    expect(firstSnap.point).toEqual({ x: 200, y: 130 });

    // 8 units from the held x is beyond the 6-unit range but within the 9-unit release reach.
    const held = snapPointToGuides({ x: 208, y: 40 }, targets, 6, firstSnap.hold);
    expect(held.point).toEqual({ x: 200, y: 40 });
    expect(held.lines).toEqual({ x: 200, y: null });

    expect(snapPointToGuides({ x: 215, y: 40 }, targets, 6, held.hold).point).toEqual({ x: 215, y: 40 });
  });

  test('a moving box snaps by whichever of its edges or center lands nearest', () => {
    const targets = collectGuideTargets(twoLayers([box], []), new Set());

    // The top edge is 3 units below the box's bottom edge; nothing lines up on x.
    const snapped = snapBoundsToGuides({ left: 300, top: 163, right: 340, bottom: 203 }, targets, 6, { x: null, y: null });

    expect(snapped.dx).toBe(0);
    expect(snapped.dy).toBe(-3);
    expect(snapped.lines).toEqual({ x: null, y: 160 });
  });

  test('the items being moved are not their own snap targets', () => {
    const targets = collectGuideTargets(twoLayers([box], [arrow]), new Set(['shape-box']));

    expect(targets.xs).toEqual([200, 320]);
  });
});

describe('canvas text with mixed font sizes', () => {
  test('before, size a word, after: the text keeps its base size and gains one size range', () => {
    const runs = textItemRuns({ text: 'Placeholder words', size: 24 });

    const sized = applySizeToRuns(runs, 12, 17, 48);

    expect(runsToTextFields(sized)).toEqual({ text: 'Placeholder words', size: 24, sizes: [{ start: 12, end: 17, size: 48 }] });
  });

  test('runs from stored ranges round-trip, and resizing everything removes the ranges', () => {
    const item = { text: 'One\nTwo three', size: 18, sizes: [{ start: 4, end: 7, size: 32 }] };
    const runs = textItemRuns(item);

    expect(runs).toEqual([{ text: 'One\n', size: 18 }, { text: 'Two', size: 32 }, { text: ' three', size: 18 }]);
    expect(runsToTextFields(runs)).toEqual(item);
    expect(runsToTextFields(applySizeToRuns(runs, 0, 13, 12))).toEqual({ text: 'One\nTwo three', size: 12 });
  });

  test('lines split at newlines and keep each piece size', () => {
    expect(runsToLines([{ text: 'One\nTw', size: 18 }, { text: 'o', size: 32 }])).toEqual([
      [{ text: 'One', size: 18 }],
      [{ text: 'Tw', size: 18 }, { text: 'o', size: 32 }],
    ]);
  });
});
