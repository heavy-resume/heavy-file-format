import { expect, test } from 'vitest';

import type { VisualBlock } from '../src/editor/types';
import { defaultBlockSchema } from '../src/document-factory';
import { readDiagramConfig, createDiagramRenderId } from '../src/plugins/diagram';
import { configurePluginBlock } from '../src/plugins/plugin-block';
import { DIAGRAM_PLUGIN_ID } from '../src/plugins/registry';

test('readDiagramConfig defaults to Mermaid syntax', () => {
  expect(readDiagramConfig(undefined)).toEqual({ syntax: 'mermaid' });
  expect(readDiagramConfig({ syntax: 'unknown' })).toEqual({ syntax: 'mermaid' });
  expect(readDiagramConfig({ syntax: 'mermaid' })).toEqual({ syntax: 'mermaid' });
});

test('createDiagramRenderId returns stable unique Mermaid render ids', () => {
  const firstId = createDiagramRenderId();
  const secondId = createDiagramRenderId();

  expect(firstId).toMatch(/^hvy-diagram-\d+$/);
  expect(secondId).toMatch(/^hvy-diagram-\d+$/);
  expect(secondId).not.toBe(firstId);
});

test('configurePluginBlock seeds diagram plugin config and Mermaid body text', () => {
  const block: VisualBlock = {
    id: 'diagram',
    text: '',
    schema: defaultBlockSchema('text'),
    schemaMode: false,
  };

  configurePluginBlock(block, DIAGRAM_PLUGIN_ID);

  expect(block.schema.component).toBe('plugin');
  expect(block.schema.plugin).toBe(DIAGRAM_PLUGIN_ID);
  expect(block.schema.pluginConfig).toEqual({ syntax: 'mermaid' });
  expect(block.text).toContain('flowchart TD');
  expect(block.text).toContain('-->');
});
