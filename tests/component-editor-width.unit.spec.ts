import { beforeEach, expect, test } from 'vitest';
import { DEFAULT_COMPONENT_EDITOR_MINIMUM_WIDTH, getComponentEditorMinimumWidth, normalizeComponentEditorMinimumWidth } from '../src/editor/component-editor-width';
import { getHostPlugin, registerHostPlugin, setHostPlugins } from '../src/plugins/registry';
import type { VisualBlock } from '../src/editor/types';

beforeEach(() => {
  setHostPlugins([]);
});

test('expected result: component editors default to 300px and accept CSS length units', () => {
  expect(DEFAULT_COMPONENT_EDITOR_MINIMUM_WIDTH).toBe('300px');
  expect(normalizeComponentEditorMinimumWidth(undefined)).toBe('300px');
  expect(normalizeComponentEditorMinimumWidth('24rem')).toBe('24rem');
  expect(normalizeComponentEditorMinimumWidth('42ch')).toBe('42ch');
  registerHostPlugin({
    id: 'example.wide-editor',
    displayName: 'Wide Editor',
    minimumEditorWidth: '32rem',
    create: () => ({ element: document.createElement('div') }),
  });
  expect(getHostPlugin('example.wide-editor')?.minimumEditorWidth).toBe('32rem');
  expect(getComponentEditorMinimumWidth({
    schema: { kind: 'plugin', plugin: 'example.wide-editor' },
  } as VisualBlock)).toBe('32rem');
});

test('expected result: invalid editor widths fall back and plugin registration rejects them', () => {
  expect(normalizeComponentEditorMinimumWidth('wide')).toBe('300px');
  expect(() => registerHostPlugin({
    id: 'example.invalid-width',
    displayName: 'Invalid Width',
    minimumEditorWidth: 'wide',
    create: () => ({ element: document.createElement('div') }),
  })).toThrow(/invalid minimumEditorWidth/);
});
