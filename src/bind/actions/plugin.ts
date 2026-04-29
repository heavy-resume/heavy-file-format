import { findBlockByIds } from '../../block-ops';
import { recordHistory } from '../../history';
import { syncReusableTemplateForBlock } from '../../reusable';
import { getRenderApp, getRefreshReaderPanels } from '../../state';
import { isDbTablePluginId, SCRIPTING_PLUGIN_ID } from '../../plugins/registry';
import { SCRIPTING_PLUGIN_VERSION } from '../../plugins/scripting/version';
import type { ActionHandler } from './types';

const commitPlugin: ActionHandler = ({ actionButton, sectionKey, blockId }) => {
  if (!sectionKey || !blockId) {
    return;
  }
  const block = findBlockByIds(sectionKey, blockId);
  if (!block) {
    return;
  }
  if (block.schema.plugin.trim().length > 0) {
    return;
  }

  const select = actionButton.parentElement?.querySelector<HTMLSelectElement>('select[data-field="block-plugin-pending"]')
    ?? actionButton.closest('.editor-block-head')?.querySelector<HTMLSelectElement>('select[data-field="block-plugin-pending"]')
    ?? null;
  const nextId = (select?.value ?? '').trim();
  if (nextId.length === 0) {
    return;
  }

  recordHistory(`plugin-commit:${sectionKey}:${blockId}:${nextId}`);
  block.schema.plugin = nextId;
  block.schema.pluginConfig = isDbTablePluginId(nextId)
    ? { source: 'with-file' }
    : nextId === SCRIPTING_PLUGIN_ID
      ? { version: SCRIPTING_PLUGIN_VERSION }
      : {};
  block.text = '';
  syncReusableTemplateForBlock(sectionKey, blockId);
  getRefreshReaderPanels()();
  getRenderApp()();
};

export const pluginActions: Record<string, ActionHandler> = {
  'commit-plugin': commitPlugin,
};
