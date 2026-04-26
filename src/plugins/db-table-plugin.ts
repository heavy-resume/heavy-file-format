import type {
  HvyPluginContext,
  HvyPluginFactory,
  HvyPluginInstance,
  HvyPluginRegistration,
} from './types';
import {
  renderDbTablePluginEditor,
  renderDbTablePluginReader,
  resetDbTableViewState,
} from './db-table';
import { findSectionByKey } from '../section-ops';
import { findBlockByIds } from '../block-ops';
import { getCachedComponentRenderHelpers } from '../state';
import { DB_TABLE_PLUGIN_ID } from './registry';

// DB-table is special: it integrates with the global bind layer (sqlite-cell
// inputs, sqlite-add-row buttons, db-table-frame scroll, etc.) which is
// attached at the app root, so we don't need to wire listeners locally — the
// existing handlers will see events bubbling up from inside the mounted div.
//
// We just need to keep the inner HTML in sync with state across re-renders,
// matching what main.ts's renderApp() used to do for the whole tree.

function build(ctx: HvyPluginContext): HvyPluginInstance {
  const root = document.createElement('div');
  root.className = `hvy-db-table-plugin hvy-db-table-plugin-${ctx.mode}`;

  const refresh = () => {
    const helpers = getCachedComponentRenderHelpers();
    if (ctx.mode === 'reader') {
      const section = findSectionByKey(ctx.rawDocument.sections, ctx.sectionKey);
      const block = findBlockByIds(ctx.sectionKey, ctx.block.id);
      if (!section || !block) {
        root.innerHTML = '';
        return;
      }
      root.innerHTML = renderDbTablePluginReader(section, block, helpers);
      return;
    }
    const block = findBlockByIds(ctx.sectionKey, ctx.block.id);
    if (!block) {
      root.innerHTML = '';
      return;
    }
    root.innerHTML = renderDbTablePluginEditor(ctx.sectionKey, block, helpers);
  };

  refresh();

  return {
    element: root,
    refresh,
    unmount: () => {
      resetDbTableViewState(ctx.sectionKey, ctx.block.id);
    },
  };
}

export const dbTablePluginFactory: HvyPluginFactory = build;

export const dbTablePluginRegistration: HvyPluginRegistration = {
  id: DB_TABLE_PLUGIN_ID,
  displayName: 'DB Table',
  create: dbTablePluginFactory,
};
