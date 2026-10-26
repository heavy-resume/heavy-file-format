import { expect, test } from 'vitest';

import { renderAddComponentPicker } from '../src/editor/component-picker';
import { deserializeDocument } from '../src/serialization';
import { initState, state } from '../src/state';
import { createConditionallyAllowedPlugin } from '../src/plugins/authorization/conditional-plugin';
import { setPluginAuthorizationMode } from '../src/plugins/authorization/plugin-authorization-policy';
import { setHostPlugins } from '../src/plugins/registry';
import { scriptingPlugin } from '../src/plugins/scripting/scripting';
import { createTestState } from './serialization-test-helpers';

const pickerDeps = {
  escapeAttr: (value: string) => value,
  escapeHtml: (value: string) => value,
  getComponentDefs: () => [],
};

function setupDocument(extension: '.hvy' | '.phvy'): void {
  initState(createTestState(deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"fake-section"}-->
#! Fake Section
`, extension)));
  setHostPlugins([scriptingPlugin]);
}

function renderPickerRow(sectionKey: string, rowAttribute: string): string {
  const html = renderAddComponentPicker({ sectionKey, action: 'add-block' }, pickerDeps);
  return html.split('<button').find((chunk) => chunk.includes(rowAttribute)) ?? '';
}

test('basic mode lists scripting disabled with an Advanced badge', () => {
  setupDocument('.hvy');
  state.showAdvancedEditor = false;

  const scriptingRow = renderPickerRow(state.document.sections[0]!.key, 'data-plugin-id="hvy.scripting"');

  expect(scriptingRow).toContain('data-component-picker-disabled="true"');
  expect(scriptingRow).toContain('<span class="component-picker-row-badge">Advanced</span>');
  expect(scriptingRow).not.toContain('data-action="add-block"');
});

test('advanced mode lists scripting as addable without a badge', () => {
  setupDocument('.hvy');
  state.showAdvancedEditor = true;

  const scriptingRow = renderPickerRow(state.document.sections[0]!.key, 'data-plugin-id="hvy.scripting"');

  expect(scriptingRow).toContain('data-action="add-block"');
  expect(scriptingRow).not.toContain('component-picker-row-badge');
  expect(scriptingRow).not.toContain('data-component-picker-disabled');
});

test('PHVY documents disable unsupported components with a reason and no Advanced badge', () => {
  setupDocument('.phvy');
  state.showAdvancedEditor = false;

  const scriptingRow = renderPickerRow(state.document.sections[0]!.key, 'data-plugin-id="hvy.scripting"');

  expect(scriptingRow).toContain('data-disabled-reason="Not supported in PHVY"');
  expect(scriptingRow).not.toContain('component-picker-row-badge');
});

test('component location is offered only while editing a template', () => {
  setupDocument('.hvy');

  expect(renderPickerRow(state.document.sections[0]!.key, 'data-component="location-marker"')).toBe('');
  expect(renderPickerRow('section-def:fake-template', 'data-component="location-marker"')).toContain('data-action="add-block"');
});

test('host-hidden plugins are not offered in basic or advanced mode', () => {
  initState(createTestState(deserializeDocument(`---
hvy_version: 0.1
plugins:
  - id: example.conditional
    uuid: conditional-primary
---

<!--hvy: {"id":"fake-section"}-->
#! Fake Section
`, '.hvy')));
  setHostPlugins([createConditionallyAllowedPlugin({
    id: 'example.conditional',
    uuid: 'conditional-primary',
    version: '1.0.0',
    hvyApiVersion: '0.1',
    displayName: 'Conditional Example',
    load: async () => { throw new Error('Host-hidden plugin must not load.'); },
  })]);
  const sectionKey = state.document.sections[0]!.key;

  expect(renderPickerRow(sectionKey, 'data-plugin-id="example.conditional"')).toContain('data-action="add-block"');

  setPluginAuthorizationMode('hidden');
  state.showAdvancedEditor = false;
  expect(renderPickerRow(sectionKey, 'data-plugin-id="example.conditional"')).toBe('');
  state.showAdvancedEditor = true;
  expect(renderPickerRow(sectionKey, 'data-plugin-id="example.conditional"')).toBe('');
});
