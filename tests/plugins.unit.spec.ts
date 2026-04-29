import { describe, expect, test, beforeEach } from 'vitest';

import { deserializeDocument } from '../src/serialization';
import { serializeDocument } from '../src/serialization';
import {
  registerHostPlugin,
  setHostPlugins,
  getAvailableDocumentPlugins,
  getHostPlugins,
  getPluginDisplayName,
  DB_TABLE_PLUGIN_ID,
  PROGRESS_BAR_PLUGIN_ID,
  SCRIPTING_PLUGIN_ID,
} from '../src/plugins/registry';
import { SCRIPTING_PLUGIN_VERSION } from '../src/plugins/scripting/version';
import { initState } from '../src/state';
import type { AppState } from '../src/types';

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
});

describe('progress-bar plugin block round-trip', () => {
  test('preserves pluginConfig and text body across serialize/deserialize', () => {
    const input = `---\nhvy_version: 1.0\n---\n\n#! Status\n\n<!--hvy:plugin {"plugin":"dev.heavy.progress-bar","pluginConfig":{"min":0,"max":100,"value":42,"color":"#3b82f6"}}-->\n \`\${value}%\`\n`;
    const doc = deserializeDocument(input, '.hvy');
    const block = doc.sections[0]?.blocks.find((b) => b.schema.component === 'plugin');
    expect(block).toBeDefined();
    expect(block?.schema.plugin).toBe(PROGRESS_BAR_PLUGIN_ID);
    expect(block?.schema.pluginConfig).toMatchObject({ min: 0, max: 100, value: 42, color: '#3b82f6' });
    expect(block?.text.trim()).toBe('`${value}%`');

    const reserialized = serializeDocument(doc);
    expect(reserialized).toContain('"plugin":"dev.heavy.progress-bar"');
    expect(reserialized).toContain('"value":42');
    expect(reserialized).toContain('${value}%');
  });
});

describe('scripting plugin block metadata', () => {
  test('preserves scripting plugin version in pluginConfig across serialize/deserialize', () => {
    const input = `---\nhvy_version: 1.0\n---\n\n#! Script\n\n<!--hvy:plugin {"plugin":"dev.heavy.scripting","pluginConfig":{"version":"${SCRIPTING_PLUGIN_VERSION}"}}-->\nprint("hello")\n`;
    const doc = deserializeDocument(input, '.hvy');
    const block = doc.sections[0]?.blocks.find((b) => b.schema.component === 'plugin');
    expect(block).toBeDefined();
    expect(block?.schema.plugin).toBe(SCRIPTING_PLUGIN_ID);
    expect(block?.schema.pluginConfig).toMatchObject({ version: SCRIPTING_PLUGIN_VERSION });

    const reserialized = serializeDocument(doc);
    expect(reserialized).toContain('"plugin":"dev.heavy.scripting"');
    expect(reserialized).toContain(`"version":"${SCRIPTING_PLUGIN_VERSION}"`);
    expect(reserialized).toContain('print("hello")');
  });
});

describe('plugin block selector swap', () => {
  test('swapping plugin id resets pluginConfig and text', () => {
    const input = `---\nhvy_version: 1.0\n---\n\n#! Status\n\n<!--hvy:plugin {"plugin":"dev.heavy.db-table","pluginConfig":{"source":"with-file","table":"work"}}-->\n SELECT * FROM work\n`;
    const doc = deserializeDocument(input, '.hvy');
    const block = doc.sections[0]?.blocks.find((b) => b.schema.component === 'plugin');
    expect(block).toBeDefined();

    // Simulate the same mutation block-ops.ts does on plugin swap.
    if (!block) throw new Error('unreachable');
    block.schema.plugin = PROGRESS_BAR_PLUGIN_ID;
    block.schema.pluginConfig = {};
    block.text = '';

    const reserialized = serializeDocument(doc);
    expect(reserialized).toContain('"plugin":"dev.heavy.progress-bar"');
    expect(reserialized).not.toContain('SELECT * FROM work');
    expect(reserialized).not.toContain('"table":"work"');
  });
});
