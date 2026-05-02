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

// Captured focus state inside a db-table editor before its inner HTML is
// rebuilt. Each input is identified by its data-* attributes (which db-table
// emits stably) rather than by element reference, so we can re-find the
// equivalent input after the rebuild even when the original element is gone.
interface DbTableFocusKey {
  field: string;
  rowId: string;
  columnName: string;
  oldColumnName: string;
  isDraftRow: boolean;
  selectionStart: number | null;
  selectionEnd: number | null;
  selectionDirection: 'forward' | 'backward' | 'none' | null;
}

function captureDbTableFocus(root: HTMLElement): DbTableFocusKey | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLInputElement)) {
    return null;
  }
  if (!root.contains(active)) {
    return null;
  }
  const field = active.dataset.field ?? '';
  if (field.length === 0) {
    return null;
  }
  let selectionStart: number | null = null;
  let selectionEnd: number | null = null;
  let selectionDirection: 'forward' | 'backward' | 'none' | null = null;
  try {
    selectionStart = active.selectionStart;
    selectionEnd = active.selectionEnd;
    selectionDirection = active.selectionDirection ?? null;
  } catch {
    // Some input types disallow selection access — that's fine.
  }
  return {
    field,
    rowId: active.dataset.rowid ?? '',
    columnName: active.dataset.columnName ?? '',
    oldColumnName: active.dataset.oldColumnName ?? '',
    isDraftRow: active.dataset.sqliteDraftRow === 'true',
    selectionStart,
    selectionEnd,
    selectionDirection,
  };
}

function restoreDbTableFocus(root: HTMLElement, key: DbTableFocusKey | null): void {
  if (!key) return;

  const cssEsc = (value: string): string => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/(["\\])/g, '\\$1'));

  const candidates: string[] = [];
  if (key.field === 'sqlite-cell') {
    if (key.rowId.length > 0) {
      candidates.push(`input[data-field="sqlite-cell"][data-rowid="${cssEsc(key.rowId)}"][data-column-name="${cssEsc(key.columnName)}"]`);
    }
    if (key.isDraftRow) {
      // The draft row may have just been materialized; the new "first row"
      // input for the same column is the natural successor.
      candidates.push(`input[data-field="sqlite-cell"][data-column-name="${cssEsc(key.columnName)}"]:not([data-sqlite-draft-row="true"])`);
    }
    candidates.push(`input[data-field="sqlite-cell"][data-column-name="${cssEsc(key.columnName)}"]`);
  } else if (key.field === 'sqlite-column-name') {
    const oldName = key.oldColumnName.length > 0 ? key.oldColumnName : key.columnName;
    if (oldName.length > 0) {
      candidates.push(`input[data-field="sqlite-column-name"][data-old-column-name="${cssEsc(oldName)}"]`);
    }
  } else {
    candidates.push(`input[data-field="${cssEsc(key.field)}"]`);
  }

  let next: HTMLInputElement | null = null;
  for (const selector of candidates) {
    next = root.querySelector<HTMLInputElement>(selector);
    if (next) break;
  }
  if (!next) return;

  try {
    next.focus({ preventScroll: true });
    if (key.selectionStart !== null && key.selectionEnd !== null) {
      next.setSelectionRange(key.selectionStart, key.selectionEnd, key.selectionDirection ?? undefined);
    }
  } catch {
    // Best-effort.
  }
}

function build(ctx: HvyPluginContext): HvyPluginInstance {
  const root = document.createElement('div');
  root.className = `hvy-db-table-plugin hvy-db-table-plugin-${ctx.mode}`;

  const refresh = () => {
    const helpers = getCachedComponentRenderHelpers();
    const focusKey = captureDbTableFocus(root);

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
    restoreDbTableFocus(root, focusKey);
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
  aiHint: (block) => {
    const table = typeof block.schema.pluginConfig.table === 'string' && block.schema.pluginConfig.table.trim().length > 0
      ? block.schema.pluginConfig.table.trim()
      : '(unset)';
    return [
      `db-table owns SQLite table "${table}".`,
      'Rendered DB table errors usually belong to this plugin block.',
      'Fix table selection in pluginConfig.table or fix the SQL query stored in the plugin body text.',
      'Inspect table columns with query_db_table before writing WHERE clauses.',
    ].join(' ');
  },
  create: dbTablePluginFactory,
};
