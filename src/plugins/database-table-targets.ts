import { visitBlocks } from '../section-ops';
import type { VisualDocument } from '../types';
import { getDocumentDbTableNames } from './db-table-model';
import type { VisualBlock } from '../editor/types';
import { isDbTablePluginId } from './registry';

export function isDatabaseTablePluginBlock(block: VisualBlock): boolean {
  return block.schema.component === 'plugin' && isDbTablePluginId(block.schema.plugin);
}

export function getDocumentDatabaseTableNames(document: VisualDocument): string[] {
  const names = new Set(getDocumentDbTableNames(document));
  visitBlocks(document.sections, (block) => {
    if (!isDatabaseTablePluginBlock(block)) return;
    if (block.schema.plugin === 'hvy.db-table-v2') {
      const source = typeof block.schema.pluginConfig.source === 'string'
        ? block.schema.pluginConfig.source.trim()
        : 'with-file';
      if (source && source !== 'with-file') return;
    }
    const tableName = typeof block.schema.pluginConfig.table === 'string' ? block.schema.pluginConfig.table.trim() : '';
    if (tableName) names.add(tableName);
  });
  return [...names];
}

export function hasDocumentDatabaseTables(document: VisualDocument): boolean {
  return getDocumentDatabaseTableNames(document).length > 0;
}
