import { beforeEach, expect, test } from 'vitest';
import {
  DEFAULT_COMPONENT_EDITOR_MINIMUM_WIDTH,
  DEFAULT_COMPONENT_EDITOR_PREFERRED_WIDTH,
  getComponentEditorMinimumWidth,
  getComponentEditorPreferredWidth,
  normalizeComponentEditorMinimumWidth,
  normalizeComponentEditorPreferredWidth,
} from '../src/editor/component-editor-width';
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

test('expected result: built-in components keep the shared defaults unless they declare their own widths', () => {
  expect(getComponentEditorMinimumWidth({ schema: { kind: 'block', component: 'text' } } as VisualBlock))
    .toBe(DEFAULT_COMPONENT_EDITOR_MINIMUM_WIDTH);
  expect(getComponentEditorPreferredWidth({ schema: { kind: 'block', component: 'text' } } as VisualBlock))
    .toBe(DEFAULT_COMPONENT_EDITOR_PREFERRED_WIDTH);
  expect(getComponentEditorMinimumWidth({ schema: { kind: 'block', component: 'xref-card' } } as VisualBlock)).toBe('180px');
  expect(getComponentEditorPreferredWidth({ schema: { kind: 'block', component: 'xref-card' } } as VisualBlock)).toBe('18rem');
});

test('expected result: preferred widths fall back to the modal default when they are not usable lengths', () => {
  expect(DEFAULT_COMPONENT_EDITOR_PREFERRED_WIDTH).toBe('760px');
  expect(normalizeComponentEditorPreferredWidth(undefined)).toBe('760px');
  expect(normalizeComponentEditorPreferredWidth('snug')).toBe('760px');
  expect(normalizeComponentEditorPreferredWidth('18rem')).toBe('18rem');
});

test('expected result: plugins declare a snug modal width and registration rejects unusable ones', () => {
  registerHostPlugin({
    id: 'example.snug-editor',
    displayName: 'Snug Editor',
    preferredEditorWidth: '20rem',
    create: () => ({ element: document.createElement('div') }),
  });
  expect(getComponentEditorPreferredWidth({
    schema: { kind: 'plugin', plugin: 'example.snug-editor' },
  } as VisualBlock)).toBe('20rem');
  expect(getComponentEditorPreferredWidth({
    schema: { kind: 'plugin', plugin: 'example.unregistered' },
  } as VisualBlock)).toBe(DEFAULT_COMPONENT_EDITOR_PREFERRED_WIDTH);
  expect(() => registerHostPlugin({
    id: 'example.invalid-preferred-width',
    displayName: 'Invalid Preferred Width',
    preferredEditorWidth: 'snug',
    create: () => ({ element: document.createElement('div') }),
  })).toThrow(/invalid preferredEditorWidth/);
});
