import { describe, expect, test } from 'vitest';
import { readCanvasConfig } from '../src/plugins/canvas/canvas';
import {
  normalizeCanvasDrawing,
  normalizeLayerFilter,
  parseCanvasDrawing,
  serializeCanvasDrawing,
  type CanvasDrawing,
  type CanvasItem,
} from '../src/plugins/canvas/canvas-drawing-format';
import { eraseCanvasDrawing } from '../src/plugins/canvas/canvas-erase';
import { applyCanvasHistoryData, createCanvasHistoryData } from '../src/plugins/canvas/canvas-history';
import { addCanvasLineSample, fitCanvasLine, MAX_LINE_SAMPLES } from '../src/plugins/canvas/canvas-line-fit';
import { constrainShapeEnd, lineMidpoint, resizeShape, snapToShapeOutline } from '../src/plugins/canvas/canvas-shapes';
import { configurePluginBlock } from '../src/plugins/plugin-block';
import { deserializeDocument } from '../src/serialization';

function singleLayer(items: CanvasItem[]): CanvasDrawing {
  return { version: 2, layers: [{ id: 'layer-1', name: 'Layer 1', visible: true, locked: false, items }] };
}

describe('canvas drawing format', () => {
  test('normalizes configuration to safe logical canvas bounds', () => {
    expect(readCanvasConfig({
      width: 12,
      height: 9000,
      viewerDrawing: true,
      strokeColor: ' #123456 ',
      strokeWidth: 0,
    })).toEqual({
      width: 100,
      height: 4096,
      viewerDrawing: true,
      strokeColor: '#123456',
      strokeWidth: 1,
      drawing: '',
      gridSize: 20,
    });
  });

  test('round-trips every item kind across layers', () => {
    const expectedResult: CanvasDrawing = {
      version: 2,
      layers: [
        {
          id: 'background',
          name: 'Background',
          visible: true,
          locked: true,
          items: [
            { kind: 'fill', color: '#abcdef', cutouts: [{ width: 12, points: [{ x: 5, y: 5 }, { x: 9, y: 9 }] }] },
            { kind: 'brush', color: '#123456', width: 3, dash: 'dashed', points: [{ x: 1, y: 1 }, { x: 4, y: 4 }] },
          ],
        },
        {
          id: 'diagram',
          name: 'Diagram',
          visible: false,
          locked: false,
          items: [
            { kind: 'shape', id: 'shape-box', shape: 'rect', from: { x: 10, y: 10 }, to: { x: 60, y: 40 }, color: '#111111', width: 2 },
            { kind: 'shape', id: 'shape-arrow', shape: 'line', from: { x: 60, y: 25 }, to: { x: 120, y: 25 }, control: { x: 90, y: 5 }, color: '#111111', width: 2, dash: 'dotted', startHead: true, endHead: true },
            { kind: 'text', id: 'text-label', text: 'Placeholder\nlabel', at: { x: 35, y: 25 }, size: 18, color: '#222222', font: 'sans-serif' },
          ],
        },
      ],
    };

    expect(parseCanvasDrawing(serializeCanvasDrawing(expectedResult))).toEqual(expectedResult);
  });

  test('drops invalid items and unknown kinds, and drops cutouts and heads where they do not apply', () => {
    expect(normalizeCanvasDrawing({
      version: 2,
      layers: [{
        id: 'layer-1',
        items: [
          { kind: 'brush', color: '#abcdef', width: 2, points: [{ x: 1, y: 2 }], cutouts: [{ width: 4, points: [{ x: 0, y: 0 }] }] },
          { kind: 'brush', color: '#000000', width: 2, points: [{ x: 'bad', y: 2 }] },
          { kind: 'shape', id: 'shape-box', shape: 'rect', from: { x: 0, y: 0 }, to: { x: 5, y: 5 }, endHead: true, control: { x: 1, y: 1 } },
          { kind: 'text', id: 'text-empty', text: '   ', at: { x: 0, y: 0 } },
          { kind: 'sticker', id: 'unknown' },
        ],
      }],
    })).toEqual(singleLayer([
      { kind: 'brush', color: '#abcdef', width: 2, points: [{ x: 1, y: 2 }] },
      { kind: 'shape', id: 'shape-box', shape: 'rect', from: { x: 0, y: 0 }, to: { x: 5, y: 5 }, color: '#1f2937', width: 4 },
    ]));
  });

  test('treats malformed or empty data as one empty layer, and keeps layer ids unique', () => {
    expect(parseCanvasDrawing('{not json')).toEqual(singleLayer([]));
    expect(normalizeCanvasDrawing({ layers: [{ id: 'same' }, { id: 'same' }] }).layers.map((layer) => layer.id)).toEqual(['same', 'same-copy']);
  });

  test('plugin selection keeps vector data out of the AI-facing text body', () => {
    const document = deserializeDocument('---\nhvy_version: 0.1\n---\n\n#! Drawing\n\n<!--hvy:plugin {}-->\n', '.hvy');
    const block = document.sections[0]?.blocks[0];
    if (!block) throw new Error('Expected a plugin block.');

    configurePluginBlock(block, 'hvy.canvas');

    expect(block.schema.pluginConfig).toEqual({
      width: 800,
      height: 450,
      viewerDrawing: false,
      strokeColor: '',
      strokeWidth: 4,
      drawing: expect.stringMatching(/^canvas-[0-9a-f]{8}$/),
    });
    expect(block.text).toBe('Canvas drawing. Vector artwork is stored in the HVY tail attachment.');
  });
});

describe('canvas eraser', () => {
  test('before, erase across the middle, after: the stroke becomes two strokes ending at the eraser edge', () => {
    const before = singleLayer([{ kind: 'brush', color: '#123456', width: 4, dash: 'dashed', points: [{ x: 0, y: 50 }, { x: 200, y: 50 }] }]);

    const after = eraseCanvasDrawing(before, 'layer-1', [{ x: 100, y: 0 }, { x: 100, y: 100 }], 10);

    expect(after).toEqual(singleLayer([
      { kind: 'brush', color: '#123456', width: 4, dash: 'dashed', points: [{ x: 0, y: 50 }, { x: 93, y: 50 }] },
      { kind: 'brush', color: '#123456', width: 4, dash: 'dashed', points: [{ x: 107, y: 50 }, { x: 200, y: 50 }] },
    ]));
  });

  test('before, erase over a corner, after: the cut follows both segments around the vertex', () => {
    const before = singleLayer([{ kind: 'brush', color: '#123456', width: 2, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] }]);

    const after = eraseCanvasDrawing(before, 'layer-1', [{ x: 100, y: 0 }], 18);

    expect(after).toEqual(singleLayer([
      { kind: 'brush', color: '#123456', width: 2, points: [{ x: 0, y: 0 }, { x: 90, y: 0 }] },
      { kind: 'brush', color: '#123456', width: 2, points: [{ x: 100, y: 10 }, { x: 100, y: 100 }] },
    ]));
  });

  test('before, erase over a dot and a fill, after: the dot is removed and the fill gets a cutout', () => {
    const before = singleLayer([
      { kind: 'fill', color: '#abcdef' },
      { kind: 'brush', color: '#123456', width: 4, points: [{ x: 50, y: 50 }] },
    ]);

    const after = eraseCanvasDrawing(before, 'layer-1', [{ x: 40, y: 50 }, { x: 60, y: 50 }], 4);

    expect(after).toEqual(singleLayer([
      { kind: 'fill', color: '#abcdef', cutouts: [{ width: 4, points: [{ x: 40, y: 50 }, { x: 60, y: 50 }] }] },
    ]));
  });

  test('before, a drag erasing segment by segment over a fill, after: the segments join into one cutout path', () => {
    const afterFirstSegment = eraseCanvasDrawing(singleLayer([{ kind: 'fill', color: '#abcdef' }]), 'layer-1', [{ x: 10, y: 10 }, { x: 20, y: 10 }], 6);
    const afterSecondSegment = eraseCanvasDrawing(afterFirstSegment, 'layer-1', [{ x: 20, y: 10 }, { x: 30, y: 15 }], 6);
    const afterSeparateErase = eraseCanvasDrawing(afterSecondSegment, 'layer-1', [{ x: 80, y: 80 }], 6);

    expect(afterSeparateErase.layers[0]!.items[0]).toEqual({
      kind: 'fill',
      color: '#abcdef',
      cutouts: [
        { width: 6, points: [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 30, y: 15 }] },
        { width: 6, points: [{ x: 80, y: 80 }] },
      ],
    });
  });

  test('before, erase through a rectangle edge, after: the rectangle becomes selectable brush strokes with a gap', () => {
    const before = singleLayer([{ kind: 'shape', id: 'shape-box', shape: 'rect', from: { x: 0, y: 0 }, to: { x: 100, y: 50 }, color: '#111111', width: 2, dash: 'dashed' }]);

    const after = eraseCanvasDrawing(before, 'layer-1', [{ x: 50, y: -10 }, { x: 50, y: 10 }], 8);

    const roundedItems = after.layers[0]!.items.map((item) => (item.kind === 'brush'
      ? { ...item, points: item.points.map((point) => ({ x: Math.round(point.x * 1000) / 1000, y: Math.round(point.y * 1000) / 1000 })) }
      : item));
    expect(roundedItems).toEqual([
      { kind: 'brush', id: 'shape-box', color: '#111111', width: 2, dash: 'dashed', points: [{ x: 0, y: 0 }, { x: 45, y: 0 }] },
      { kind: 'brush', id: 'shape-box@55,0', color: '#111111', width: 2, dash: 'dashed', points: [{ x: 55, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }, { x: 0, y: 0 }] },
    ]);
  });

  test('before, erase over text and beside a shape, after: the text is removed and the shape is untouched', () => {
    const shape = { kind: 'shape' as const, id: 'shape-box', shape: 'rect' as const, from: { x: 200, y: 200 }, to: { x: 260, y: 240 }, color: '#111111', width: 2 };
    const before = singleLayer([
      shape,
      { kind: 'text', id: 'text-label', text: 'Placeholder', at: { x: 50, y: 50 }, size: 20, color: '#111111', font: 'sans-serif' },
    ]);

    const after = eraseCanvasDrawing(before, 'layer-1', [{ x: 50, y: 50 }], 4);

    expect(after.layers[0]!.items).toEqual([shape]);
    expect(after.layers[0]!.items[0]).toBe(shape);
  });

  test('erasing only touches the given layer, and a miss returns the same drawing', () => {
    const before: CanvasDrawing = {
      version: 2,
      layers: [
        { id: 'below', name: 'Below', visible: true, locked: false, items: [{ kind: 'brush', color: '#111111', width: 4, points: [{ x: 0, y: 50 }, { x: 200, y: 50 }] }] },
        { id: 'above', name: 'Above', visible: true, locked: false, items: [{ kind: 'brush', color: '#222222', width: 4, points: [{ x: 0, y: 50 }, { x: 200, y: 50 }] }] },
      ],
    };

    const after = eraseCanvasDrawing(before, 'above', [{ x: 100, y: 0 }, { x: 100, y: 100 }], 10);

    expect(after.layers[0]).toBe(before.layers[0]);
    expect(after.layers[1]!.items).toHaveLength(2);
    expect(eraseCanvasDrawing(before, 'above', [{ x: 0, y: 0 }, { x: 200, y: 0 }], 10)).toBe(before);
  });
});

describe('canvas shape geometry', () => {
  test('shift constraints make squares and snap lines to 45 degrees', () => {
    expect(constrainShapeEnd('rect', { x: 0, y: 0 }, { x: 30, y: -10 }, true)).toEqual({ x: 30, y: -30 });
    const snapped = constrainShapeEnd('line', { x: 0, y: 0 }, { x: 100, y: 90 }, true);
    expect(snapped.x).toBeCloseTo(snapped.y, 6);
  });

  test('line ends snap to the nearest box outline within reach', () => {
    const box = { kind: 'shape' as const, id: 'shape-box', shape: 'rect' as const, from: { x: 100, y: 100 }, to: { x: 200, y: 160 }, color: '#111111', width: 2 };

    expect(snapToShapeOutline([box], { x: 92, y: 130 }, 12, null)?.point).toEqual({ x: 100, y: 130 });
    expect(snapToShapeOutline([box], { x: 150, y: 150 }, 12, null)?.point).toEqual({ x: 150, y: 160 });
    expect(snapToShapeOutline([box], { x: 60, y: 130 }, 12, null)).toBeNull();
  });

  test('dragging the curve handle bends the line through the dragged point', () => {
    const line = { kind: 'shape' as const, id: 'shape-arrow', shape: 'line' as const, from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, color: '#111111', width: 2 };

    const curved = resizeShape(line, 'control', { x: 50, y: 30 }, false);

    expect(lineMidpoint(curved)).toEqual({ x: 50, y: 30 });
  });
});

describe('canvas whiteboard history steps', () => {
  const brushA: CanvasItem = { kind: 'brush', color: '#111111', width: 4, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] };
  const brushB: CanvasItem = { kind: 'brush', color: '#222222', width: 4, points: [{ x: 0, y: 5 }, { x: 10, y: 5 }] };

  test("an action inside one layer records only that layer's item splice", () => {
    expect(createCanvasHistoryData('canvas:sketch', { plugin: 'hvy.canvas' }, singleLayer([brushA]), singleLayer([brushA, brushB]))).toEqual({
      attachmentId: 'canvas:sketch',
      attachmentMeta: { plugin: 'hvy.canvas' },
      changes: [{ kind: 'items', layerId: 'layer-1', index: 1, removed: [], inserted: [brushB] }],
    });
  });

  test('identical drawings record no step', () => {
    expect(createCanvasHistoryData('canvas:sketch', {}, singleLayer([brushA]), singleLayer([brushA]))).toBeNull();
  });

  test('before, undo then redo, after: adding a layer is removed and restored', () => {
    const before = singleLayer([brushA]);
    const after: CanvasDrawing = { version: 2, layers: [...before.layers, { id: 'layer-2', name: 'Layer 2', visible: true, locked: false, items: [] }] };
    const step = createCanvasHistoryData('canvas:sketch', {}, before, after)!;

    const afterUndo = applyCanvasHistoryData(after, step, 'undo');
    expect(afterUndo).toEqual(before);

    expect(applyCanvasHistoryData(afterUndo, step, 'redo')).toEqual(after);
  });

  test('before, undo then redo, after: reordering and hiding layers are reversed and reapplied', () => {
    const before: CanvasDrawing = {
      version: 2,
      layers: [
        { id: 'below', name: 'Below', visible: true, locked: false, items: [brushA] },
        { id: 'above', name: 'Above', visible: true, locked: false, items: [brushB] },
      ],
    };
    const after: CanvasDrawing = { version: 2, layers: [{ ...before.layers[1]!, visible: false }, before.layers[0]!] };
    const step = createCanvasHistoryData('canvas:sketch', {}, before, after)!;

    expect(step.changes.map((change) => change.kind)).toEqual(['layer-order', 'layer-settings']);
    const afterUndo = applyCanvasHistoryData(after, step, 'undo');
    expect(afterUndo).toEqual(before);
    expect(applyCanvasHistoryData(afterUndo, step, 'redo')).toEqual(after);
  });

  test('before, undo after a script changed the layer, after: the drawing is left untouched', () => {
    const step = createCanvasHistoryData('canvas:sketch', {}, singleLayer([brushA]), singleLayer([brushA, brushB]))!;
    const changedByScript = singleLayer([brushB]);

    expect(applyCanvasHistoryData(changedByScript, step, 'undo')).toBe(changedByScript);
  });
});

describe('canvas best-fit lines', () => {
  test('a wobbly but straight drag stays a straight line', () => {
    const samples = [{ x: 20, y: 1.5 }, { x: 40, y: -2 }, { x: 60, y: 2.5 }, { x: 80, y: -1 }];

    expect(fitCanvasLine({ x: 0, y: 0 }, { x: 100, y: 0 }, samples, 4).control).toBeNull();
  });

  test('a drag along an arc becomes a curve whose control point reproduces the arc', () => {
    const start = { x: 0, y: 0 };
    const control = { x: 50, y: 80 };
    const end = { x: 100, y: 0 };
    const onCurve = (t: number) => ({
      x: (1 - t) ** 2 * start.x + 2 * (1 - t) * t * control.x + t * t * end.x,
      y: (1 - t) ** 2 * start.y + 2 * (1 - t) * t * control.y + t * t * end.y,
    });

    const fit = fitCanvasLine(start, end, [0.2, 0.35, 0.5, 0.65, 0.8].map(onCurve), 4);

    expect(fit.control!.x).toBeCloseTo(50, 0);
    expect(Math.abs(fit.control!.y - 80)).toBeLessThan(6);
  });

  test('past the sample limit, a sample from the most crowded spot is dropped', () => {
    const start = { x: 0, y: 0 };
    const end = { x: 110, y: 0 };
    // Evenly spaced except for two samples crowded together.
    const samples = [
      { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 21, y: 0 }, { x: 30, y: 0 }, { x: 40, y: 0 },
      { x: 50, y: 0 }, { x: 60, y: 0 }, { x: 70, y: 0 }, { x: 80, y: 0 }, { x: 90, y: 0 },
    ];

    const afterLimit = addCanvasLineSample(start, end, samples, { x: 100, y: 0 });

    expect(afterLimit).toHaveLength(MAX_LINE_SAMPLES);
    expect(afterLimit.filter((sample) => sample.x === 20 || sample.x === 21)).toHaveLength(1);
  });

  test('past the sample limit, the highest and lowest x and y samples are kept even when crowded', () => {
    const start = { x: 0, y: 0 };
    const end = { x: 100, y: 0 };
    // The topmost and bottommost samples sit right next to other samples.
    const samples = [
      { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: -50 }, { x: 31, y: -49 }, { x: 40, y: 0 },
      { x: 50, y: 0 }, { x: 60, y: 0 }, { x: 70, y: 49 }, { x: 71, y: 50 }, { x: 80, y: 0 },
    ];

    const afterLimit = addCanvasLineSample(start, end, samples, { x: 90, y: 0 });

    expect(afterLimit).toHaveLength(MAX_LINE_SAMPLES);
    expect(afterLimit).toContainEqual({ x: 30, y: -50 });
    expect(afterLimit).toContainEqual({ x: 71, y: 50 });
    expect(afterLimit).toContainEqual({ x: 10, y: 0 });
    expect(afterLimit).toContainEqual({ x: 90, y: 0 });
  });

  test('a slow, long curve keeps samples spread over the whole drag, including its newest part', () => {
    const start = { x: 0, y: 0 };
    let samples: Array<{ x: number; y: number }> = [];
    let end = start;
    // Forty samples along a half circle, arriving one at a time as the pointer moves on.
    for (let step = 1; step <= 40; step += 1) {
      const angle = Math.PI - (step / 40) * Math.PI;
      end = { x: 100 + Math.cos(angle) * 100, y: -Math.sin(angle) * 100 };
      samples = addCanvasLineSample(start, end, samples, end);
    }

    expect(samples).toHaveLength(MAX_LINE_SAMPLES);
    expect(Math.min(...samples.map((sample) => sample.x))).toBeLessThan(30);
    expect(Math.max(...samples.map((sample) => sample.x))).toBeGreaterThan(170);
  });
});

describe('canvas layer filters', () => {
  test('filters that would change nothing are dropped, and values are clamped', () => {
    expect(normalizeLayerFilter({ multiply: { r: 255, g: 255, b: 255, a: 1 } })).toBeNull();
    expect(normalizeLayerFilter({ invert: true, multiply: { r: 300, g: -5, b: 128.4, a: 2 } })).toEqual({ invert: true, multiply: { r: 255, g: 0, b: 128, a: 1 } });
  });

  test('before, add a filter, undo then redo: the layer loses and regains it', () => {
    const before = singleLayer([]);
    const after: CanvasDrawing = { version: 2, layers: [{ ...before.layers[0]!, filter: { invert: true } }] };
    const step = createCanvasHistoryData('canvas:sketch', {}, before, after)!;

    const afterUndo = applyCanvasHistoryData(after, step, 'undo');
    expect(afterUndo.layers[0]!.filter).toBeUndefined();
    expect(applyCanvasHistoryData(afterUndo, step, 'redo').layers[0]!.filter).toEqual({ invert: true });
  });
});
