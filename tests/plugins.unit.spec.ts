import { describe, expect, test, beforeEach, vi } from 'vitest';

import { deserializeDocument } from '../src/serialization';
import { serializeDocument } from '../src/serialization';
import {
  registerHostPlugin,
  setHostPlugins,
  getAvailableDocumentPlugins,
  getAvailableOutputGenerators,
  getHostPlugins,
  getOutputGenerator,
  getPluginDisplayName,
  DB_TABLE_PLUGIN_ID,
  FORM_PLUGIN_ID,
  PROGRESS_BAR_PLUGIN_ID,
  SCRIPTING_PLUGIN_ID,
  VIDEO_PLUGIN_ID,
} from '../src/plugins/registry';
import { SCRIPTING_PLUGIN_VERSION } from '../src/plugins/scripting/version';
import { initCallbacks, initState, state } from '../src/state';
import type { AppState } from '../src/types';
import { createTestState } from './serialization-test-helpers';
import { editorStateActions } from '../src/bind/app-actions/editor-state';
import { syncSortValuesForDocument } from '../src/sort-values';

function bootstrapState(hvy: string): void {
  const document = deserializeDocument(hvy, '.hvy');
  initState({ document } as unknown as AppState);
}

beforeEach(() => {
  setHostPlugins([]);
});

describe('plugin host registry', () => {
  test('registerHostPlugin appends and dedupes by id', () => {
    registerHostPlugin({ id: 'a.test', displayName: 'A', create: () => ({ element: document.createElement('div') }) });
    registerHostPlugin({ id: 'b.test', displayName: 'B', create: () => ({ element: document.createElement('div') }) });
    registerHostPlugin({ id: 'a.test', displayName: 'A v2', create: () => ({ element: document.createElement('div') }) });

    const ids = getHostPlugins().map((entry) => entry.id);
    expect(ids).toEqual(['a.test', 'b.test']);
    expect(getPluginDisplayName('a.test')).toBe('A v2');
  });

  test('getAvailableDocumentPlugins falls back to installed host plugins when document has none', () => {
    registerHostPlugin({ id: DB_TABLE_PLUGIN_ID, displayName: 'DB Table', create: () => ({ element: document.createElement('div') }) });
    registerHostPlugin({ id: PROGRESS_BAR_PLUGIN_ID, displayName: 'Progress Bar', create: () => ({ element: document.createElement('div') }) });

    bootstrapState(`---\nhvy_version: 1.0\n---\n`);

    const ids = getAvailableDocumentPlugins().map((entry) => entry.id);
    expect(ids).toEqual([DB_TABLE_PLUGIN_ID, PROGRESS_BAR_PLUGIN_ID]);
  });

  test('getAvailableDocumentPlugins prefers document-declared plugins when present', () => {
    registerHostPlugin({ id: DB_TABLE_PLUGIN_ID, displayName: 'DB Table', create: () => ({ element: document.createElement('div') }) });

    bootstrapState(`---\nhvy_version: 1.0\nplugins:\n  - id: com.example.custom\n    source: builtin://custom\n---\n`);

    const ids = getAvailableDocumentPlugins().map((entry) => entry.id);
    expect(ids).toEqual(['com.example.custom']);
  });

  test('output generators are registered by plugin-qualified key and reject duplicates', () => {
    registerHostPlugin({
      id: 'hvy.resume',
      displayName: 'Resume',
      outputGenerators: [{
        key: 'hvy.resume.skill-description',
        label: 'Generate description',
        requiredVariables: ['skill'],
        generate: () => ({ answer: 'Generated description' }),
      }],
    });

    expect(getAvailableOutputGenerators().map((generator) => generator.key)).toEqual(['hvy.resume.skill-description']);
    expect(getOutputGenerator('hvy.resume.skill-description')?.label).toBe('Generate description');
    expect(() => registerHostPlugin({
      id: 'hvy.other',
      displayName: 'Other',
      outputGenerators: [{
        key: 'hvy.resume.skill-description',
        generate: () => ({ answer: 'Duplicate' }),
      }],
    })).toThrow('Duplicate output generator key "hvy.resume.skill-description".');
  });

  test('output-only plugins do not appear as document plugin components', () => {
    registerHostPlugin({
      id: 'hvy.resume-generators',
      displayName: 'Resume Generators',
      outputGenerators: [{
        key: 'hvy.resume.skill-description',
        generate: () => ({ answer: 'Generated description' }),
      }],
    });
    registerHostPlugin({
      id: PROGRESS_BAR_PLUGIN_ID,
      displayName: 'Progress Bar',
      create: () => ({ element: document.createElement('div') }),
    });
    bootstrapState(`---\nhvy_version: 1.0\n---\n`);

    expect(getAvailableDocumentPlugins().map((plugin) => plugin.id)).toEqual([PROGRESS_BAR_PLUGIN_ID]);
  });
});

describe('progress-bar plugin block round-trip', () => {
  test('preserves unavailable plugin block across save-style round-trip', () => {
    const before = `---\nhvy_version: 1.0\nplugins:\n  - id: com.example.unavailable\n    source: https://plugins.example.invalid/unavailable.hvyplugin\n---\n\n#! External Widget\n\n<!--hvy:plugin {"plugin":"com.example.unavailable","pluginConfig":{"answer":42,"mode":"compact"}}-->\n plugin-owned body\n`;

    const documentBeforeSave = deserializeDocument(before, '.hvy');
    const serializedAfterSave = serializeDocument(documentBeforeSave);
    const documentAfterSave = deserializeDocument(serializedAfterSave, '.hvy');

    const expectedResult = documentAfterSave.sections[0]?.blocks.find((block) => block.schema.component === 'plugin');
    expect(expectedResult).toBeDefined();
    expect(expectedResult?.schema.kind).toBe('plugin');
    expect(expectedResult?.schema.plugin).toBe('com.example.unavailable');
    expect(expectedResult?.schema.pluginConfig).toEqual({ answer: 42, mode: 'compact' });
    expect(expectedResult?.text.trim()).toBe('plugin-owned body');
    expect(serializedAfterSave).toContain('id: com.example.unavailable');
    expect(serializedAfterSave).toContain('"plugin":"com.example.unavailable"');
  });

  test('preserves pluginConfig and text body across serialize/deserialize', () => {
    const input = `---\nhvy_version: 1.0\n---\n\n#! Status\n\n<!--hvy:plugin {"plugin":"hvy.progress-bar","pluginConfig":{"min":0,"max":100,"value":42,"color":"#3b82f6"}}-->\n \`\${value}%\`\n`;
    const doc = deserializeDocument(input, '.hvy');
    const block = doc.sections[0]?.blocks.find((b) => b.schema.component === 'plugin');
    expect(block).toBeDefined();
    expect(block?.schema.plugin).toBe(PROGRESS_BAR_PLUGIN_ID);
    expect(block?.schema.pluginConfig).toMatchObject({ min: 0, max: 100, value: 42, color: '#3b82f6' });
    expect(block?.text.trim()).toBe('`${value}%`');

    const reserialized = serializeDocument(doc);
    expect(reserialized).toContain('"plugin":"hvy.progress-bar"');
    expect(reserialized).toContain('"value":42');
    expect(reserialized).toContain('${value}%');
  });
});

describe('scripting plugin block metadata', () => {
  test('preserves scripting plugin version in pluginConfig across serialize/deserialize', () => {
    const input = `---\nhvy_version: 1.0\n---\n\n#! Script\n\n<!--hvy:plugin {"plugin":"hvy.scripting","pluginConfig":{"version":"${SCRIPTING_PLUGIN_VERSION}"}}-->\nprint("hello")\n`;
    const doc = deserializeDocument(input, '.hvy');
    const block = doc.sections[0]?.blocks.find((b) => b.schema.component === 'plugin');
    expect(block).toBeDefined();
    expect(block?.schema.plugin).toBe(SCRIPTING_PLUGIN_ID);
    expect(block?.schema.pluginConfig).toMatchObject({ version: SCRIPTING_PLUGIN_VERSION });

    const reserialized = serializeDocument(doc);
    expect(reserialized).toContain('"plugin":"hvy.scripting"');
    expect(reserialized).toContain(`"version":"${SCRIPTING_PLUGIN_VERSION}"`);
    expect(reserialized).toContain('print("hello")');
  });
});

describe('video plugin block round-trip', () => {
  test('preserves video plugin config across serialize/deserialize', () => {
    const input = `---\nhvy_version: 1.0\n---\n\n#! Video\n\n<!--hvy:plugin {"plugin":"hvy.video","pluginConfig":{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ&autoplay=1","title":"Demo"}}-->\n`;
    const doc = deserializeDocument(input, '.hvy');
    const block = doc.sections[0]?.blocks.find((b) => b.schema.component === 'plugin');
    expect(block).toBeDefined();
    expect(block?.schema.plugin).toBe(VIDEO_PLUGIN_ID);
    expect(block?.schema.pluginConfig).toMatchObject({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&autoplay=1',
      title: 'Demo',
    });

    const reserialized = serializeDocument(doc);
    expect(reserialized).toContain('"plugin":"hvy.video"');
    expect(reserialized).toContain('"title":"Demo"');
  });
});

describe('form plugin block round-trip', () => {
  test('preserves form plugin config and YAML body across serialize/deserialize', () => {
    const input = `---\nhvy_version: 1.0\n---\n\n#! Order\n\n<!--hvy:plugin {"plugin":"hvy.form","pluginConfig":{"version":"0.1","submitScript":"submit_form"}}-->\n fields:\n   - label: Food\n     type: select\n     options:\n       - Apple\n       - label: Soup\n         value: soup\n scripts:\n   submit_form: |\n     doc.header.set("submitted", doc.form.get_values())\n`;
    const doc = deserializeDocument(input, '.hvy');
    const block = doc.sections[0]?.blocks.find((b) => b.schema.component === 'plugin');
    expect(block).toBeDefined();
    expect(block?.schema.plugin).toBe(FORM_PLUGIN_ID);
    expect(block?.schema.pluginConfig).toMatchObject({ version: '0.1' });
    expect(block?.text).toContain('fields:');
    expect(block?.text).toContain('submit_form');

    const reserialized = serializeDocument(doc);
    expect(reserialized).toContain('"plugin":"hvy.form"');
    expect(reserialized).toContain('"version":"0.1"');
    expect(reserialized).toContain('type: select');
    expect(reserialized).toContain('doc.form.get_values');
  });
});

describe('plugin block selector swap', () => {
  test('swapping plugin id resets pluginConfig and text', () => {
    const input = `---\nhvy_version: 1.0\n---\n\n#! Status\n\n<!--hvy:plugin {"plugin":"hvy.db-table","pluginConfig":{"source":"with-file","table":"work"}}-->\n SELECT * FROM work\n`;
    const doc = deserializeDocument(input, '.hvy');
    const block = doc.sections[0]?.blocks.find((b) => b.schema.component === 'plugin');
    expect(block).toBeDefined();

    // Simulate the same mutation block-ops.ts does on plugin swap.
    if (!block) throw new Error('unreachable');
    block.schema.plugin = PROGRESS_BAR_PLUGIN_ID;
    block.schema.pluginConfig = {};
    block.text = '';

    const reserialized = serializeDocument(doc);
    expect(reserialized).toContain('"plugin":"hvy.progress-bar"');
    expect(reserialized).not.toContain('SELECT * FROM work');
    expect(reserialized).not.toContain('"table":"work"');
  });
});

describe('plugin sort values in AI mode', () => {
  test('sort sync materializes plugin-declared values before Done without requiring resort', () => {
    const document = deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: skill-record
    baseType: container
    sortValueDefs:
      Strength:
        type: number
    schema:
      containerBlocks: []
---

<!--hvy: {"id":"skills"}-->
#! Skills

 <!--hvy:component-list {"id":"skill-list","componentListComponent":"skill-record"}-->

  <!--hvy:component-list:0 {}-->

   <!--hvy:skill-record {"id":"skill-alpha"}-->

    <!--hvy:container:0 {}-->

     <!--hvy:plugin {"id":"rating-alpha","plugin":"example.skill-rating","pluginSortValues":{"Strength":4}}-->
`, '.hvy');
    initCallbacks({
      renderApp: () => {},
      refreshReaderPanels: () => {},
      refreshModalPreview: () => {},
      componentRenderHelpers: null,
      readerRenderer: null,
    });
    initState(createTestState(document));
    state.currentView = 'ai';
    const sectionKey = document.sections[0]!.key;
    const item = document.sections[0]!.blocks[0]!.schema.componentListBlocks[0]!;
    state.activeEditorBlock = { sectionKey, blockId: item.id };
    state.activeEditorBlockPath = [{ sectionKey, blockId: item.id }];
    vi.stubGlobal('CSS', { escape: (value: string) => value });
    vi.stubGlobal('HTMLElement', class {});
    vi.stubGlobal('document', { activeElement: null });

    expect(item.schema.sortKeys).toEqual({});
    // Simulates the backend sync that ctx.sortValues.set performs in AI mode
    // without requiring a reader-panel refresh/reorder.
    expect(syncSortValuesForDocument(document)).toBe(true);
    expect(item.schema.sortKeys).toEqual({ Strength: 4 });

    editorStateActions['deactivate-block']({
      app: { querySelector: () => null } as unknown as HTMLElement,
      event: { stopPropagation: () => {} } as Event,
      sectionKey,
      blockId: item.id,
      section: document.sections[0]!,
      actionButton: {} as HTMLElement,
      reusableName: null,
    });

    expect(item.schema.sortKeys).toEqual({ Strength: 4 });
    expect(item.schema.derivedSortKeyNames).toEqual(['Strength']);
    vi.unstubAllGlobals();
  });
});
