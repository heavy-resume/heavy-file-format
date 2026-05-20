import type { VisualDocument } from '../types';
import { visitBlocks } from '../section-ops';
import { DB_TABLE_PLUGIN_ID } from './registry';

export const DB_TABLE_DEFAULT_STATIC_QUERY_LIMIT = 50;
export const DB_TABLE_MAX_QUERY_ROWS = 99;
export const DB_TABLE_WINDOW_SIZE = 50;
export const DB_TABLE_FORWARD_SCROLL_TRIGGER = 75;
export const DB_TABLE_BACKWARD_SCROLL_TRIGGER = 25;
export const DB_TABLE_ESTIMATED_ROW_HEIGHT = 40;

interface DbTableViewState {
  offset: number;
  scrollTop: number;
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc' | null;
}

const dbTableViewState = new Map<string, DbTableViewState>();

export function getPluginConfigValue(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  return typeof value === 'string' ? value : '';
}

export function getDbTableQueryDynamicWindow(config: Record<string, unknown>): boolean {
  return typeof config.queryDynamicWindow === 'boolean' ? config.queryDynamicWindow : true;
}

export function getDbTableQueryLimit(config: Record<string, unknown>): number {
  const rawValue = config.queryLimit;
  const parsed = typeof rawValue === 'number'
    ? rawValue
    : typeof rawValue === 'string'
      ? Number.parseInt(rawValue, 10)
      : NaN;
  if (!Number.isFinite(parsed)) {
    return DB_TABLE_DEFAULT_STATIC_QUERY_LIMIT;
  }
  return clampDbTableQueryLimit(parsed);
}

export function getDbTableViewState(sectionKey: string, blockId: string): DbTableViewState {
  const key = getDbTableViewKey(sectionKey, blockId);
  const existing = dbTableViewState.get(key);
  if (existing) {
    return existing;
  }
  const created: DbTableViewState = {
    offset: 0,
    scrollTop: 0,
    sortColumn: null,
    sortDirection: null,
  };
  dbTableViewState.set(key, created);
  return created;
}

export function resetDbTableViewState(sectionKey: string, blockId: string): void {
  dbTableViewState.set(getDbTableViewKey(sectionKey, blockId), {
    offset: 0,
    scrollTop: 0,
    sortColumn: null,
    sortDirection: null,
  });
}

export function clearDbTableViewState(): void {
  dbTableViewState.clear();
}

export function toggleDbTableSort(sectionKey: string, blockId: string, columnName: string): void {
  const viewState = getDbTableViewState(sectionKey, blockId);
  if (viewState.sortColumn !== columnName) {
    viewState.sortColumn = columnName;
    viewState.sortDirection = 'asc';
  } else if (viewState.sortDirection === 'asc') {
    viewState.sortDirection = 'desc';
  } else {
    viewState.sortColumn = null;
    viewState.sortDirection = null;
  }
  viewState.offset = 0;
  viewState.scrollTop = 0;
}

export function handleDbTableFrameScroll(frame: HTMLElement): boolean {
  if (frame.dataset.dbTableDynamicWindow === 'false') {
    return false;
  }
  const sectionKey = frame.dataset.sectionKey ?? '';
  const blockId = frame.dataset.blockId ?? '';
  if (sectionKey.length === 0 || blockId.length === 0) {
    return false;
  }
  const viewState = getDbTableViewState(sectionKey, blockId);
  viewState.scrollTop = frame.scrollTop;
  const firstVisibleRow = Math.floor(frame.scrollTop / DB_TABLE_ESTIMATED_ROW_HEIGHT);
  let nextOffset = viewState.offset;
  if (firstVisibleRow > viewState.offset + DB_TABLE_FORWARD_SCROLL_TRIGGER) {
    nextOffset += DB_TABLE_WINDOW_SIZE;
  } else if (viewState.offset > 0 && firstVisibleRow < viewState.offset + DB_TABLE_BACKWARD_SCROLL_TRIGGER) {
    nextOffset -= DB_TABLE_WINDOW_SIZE;
  }
  nextOffset = Math.max(0, nextOffset);
  if (nextOffset === viewState.offset) {
    return false;
  }
  viewState.offset = nextOffset;
  return true;
}

export function restoreDbTableFrameScroll(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-db-table-frame="true"]').forEach((frame) => {
    const sectionKey = frame.dataset.sectionKey ?? '';
    const blockId = frame.dataset.blockId ?? '';
    if (sectionKey.length === 0 || blockId.length === 0) {
      return;
    }
    const viewState = getDbTableViewState(sectionKey, blockId);
    frame.scrollTop = viewState.scrollTop;
  });
}

export function getDocumentDbTableNames(document: VisualDocument): string[] {
  const tableNames = new Set<string>();
  visitBlocks(document.sections, (block) => {
    if (block.schema.component !== 'plugin' || block.schema.plugin !== DB_TABLE_PLUGIN_ID) {
      return;
    }
    const tableName = getPluginConfigValue(block.schema.pluginConfig, 'table').trim();
    if (tableName.length > 0) {
      tableNames.add(tableName);
    }
  });
  return [...tableNames];
}

export function hasDocumentDbTables(document: VisualDocument): boolean {
  return getDocumentDbTableNames(document).length > 0;
}

export function clampDbTableOffset(offset: number, totalRows: number): number {
  const maxOffset = Math.max(totalRows - DB_TABLE_WINDOW_SIZE, 0);
  return Math.max(0, Math.min(offset, maxOffset));
}

export function clampDbTableQueryLimit(value: number): number {
  return Math.max(1, Math.min(Math.floor(value), DB_TABLE_MAX_QUERY_ROWS));
}

function getDbTableViewKey(sectionKey: string, blockId: string): string {
  return `${sectionKey}:${blockId}`;
}
