import type { VisualBlock } from '../editor/types';
import { DEFAULT_DIAGRAM_SOURCE, DEFAULT_DIAGRAM_SYNTAX } from './diagram-defaults';
import { DIAGRAM_PLUGIN_ID, FORM_PLUGIN_ID, GRAPH_PLUGIN_ID, isDbTablePluginId, SCRIPTING_PLUGIN_ID } from './registry';
import { SCRIPTING_PLUGIN_VERSION } from './scripting/version';

export function configurePluginBlock(block: VisualBlock, pluginId: string): void {
  const nextId = pluginId.trim();
  block.schema.component = 'plugin';
  block.schema.plugin = nextId;
  block.schema.pluginConfig = isDbTablePluginId(nextId)
    ? { source: 'with-file' }
    : nextId === FORM_PLUGIN_ID
    ? { version: '0.1' }
    : nextId === SCRIPTING_PLUGIN_ID
      ? { version: SCRIPTING_PLUGIN_VERSION }
    : nextId === GRAPH_PLUGIN_ID
      ? { type: 'bar', title: '', xAxisLabel: '', yAxisLabel: '', legend: true }
    : nextId === DIAGRAM_PLUGIN_ID
      ? { syntax: DEFAULT_DIAGRAM_SYNTAX }
      : {};
  block.text = nextId === GRAPH_PLUGIN_ID
    ? 'Label,Value\nExample A,10\nExample B,20\nExample C,15'
    : nextId === DIAGRAM_PLUGIN_ID
      ? DEFAULT_DIAGRAM_SOURCE
      : '';
}
