import { describe, expect, test } from 'vitest';
import {
  normalizeCanvasDrawing,
  parseCanvasDrawing,
  readCanvasConfig,
  serializeCanvasDrawing,
} from '../src/plugins/canvas/canvas';
import { configurePluginBlock } from '../src/plugins/plugin-block';
import { deserializeDocument } from '../src/serialization';

describe('canvas plugin model', () => {
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
    });
  });

  test('round-trips valid authored strokes', () => {
    const expectedResult = {
      version: 1 as const,
      strokes: [{
        color: '#123456',
        width: 3,
        points: [{ x: 10, y: 12 }, { x: 14, y: 18 }],
      }],
    };

    expect(parseCanvasDrawing(serializeCanvasDrawing(expectedResult))).toEqual(expectedResult);
  });

  test('drops invalid strokes and keeps valid strokes readable', () => {
    expect(normalizeCanvasDrawing({
      version: 99,
      strokes: [
        { color: '#abcdef', width: 2, points: [{ x: 1, y: 2 }] },
        { color: '#000000', width: 2, points: [{ x: 'bad', y: 2 }] },
      ],
    })).toEqual({
      version: 1,
      strokes: [{ color: '#abcdef', width: 2, points: [{ x: 1, y: 2 }] }],
    });
  });

  test('treats malformed plugin text as an empty drawing', () => {
    expect(parseCanvasDrawing('{not json')).toEqual({ version: 1, strokes: [] });
  });

  test('plugin selection starts with a versioned empty drawing', () => {
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
    });
    expect(parseCanvasDrawing(block.text)).toEqual({ version: 1, strokes: [] });
  });
});
