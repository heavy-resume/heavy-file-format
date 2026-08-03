import type { JsonObject } from '../../hvy/types';

export type DbTableV2ColumnVisibility = 'visible' | 'compact' | 'hidden';

export interface DbTableV2ColumnConfig {
  label?: string;
  visibility?: DbTableV2ColumnVisibility;
  width?: string;
  wrap?: boolean;
  foreignDisplayColumn?: string;
}

export interface DbTableV2Config {
  source: string;
  table: string;
  queryLimit: number;
  columns: Record<string, DbTableV2ColumnConfig>;
}

export interface DbTableV2ColumnDefaults {
  generated: boolean;
}

const CSS_COLUMN_WIDTH = /^(?:auto|\d+(?:\.\d+)?(?:px|rem|em|ch|%))$/u;

export function readDbTableV2Config(value: JsonObject): DbTableV2Config {
  return {
    source: typeof value.source === 'string' && value.source.trim() ? value.source.trim() : 'with-file',
    table: typeof value.table === 'string' ? value.table.trim() : '',
    queryLimit: readDbTableV2QueryLimit(value.queryLimit),
    columns: readColumnConfigs(value.columns),
  };
}

export function readDbTableV2QueryLimit(value: unknown): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseInt(value, 10)
      : Number.NaN;
  return Number.isFinite(parsed) ? Math.max(1, Math.min(Math.floor(parsed), 1_000)) : 50;
}

export function readDbTableV2ColumnConfig(
  config: DbTableV2Config,
  columnName: string,
  defaults: DbTableV2ColumnDefaults
): Required<Pick<DbTableV2ColumnConfig, 'label' | 'visibility' | 'width' | 'wrap'>> & Pick<DbTableV2ColumnConfig, 'foreignDisplayColumn'> {
  const configured = config.columns[columnName] ?? {};
  const visibility = configured.visibility === 'hidden' || configured.visibility === 'compact'
    ? configured.visibility
    : defaults.generated
      ? 'compact'
      : 'visible';
  return {
    label: configured.label?.trim() || humanizeDbColumnName(columnName),
    visibility,
    width: normalizeDbTableV2ColumnWidth(configured.width) || (visibility === 'compact' ? '5rem' : '12rem'),
    wrap: configured.wrap === true,
    ...(configured.foreignDisplayColumn?.trim()
      ? { foreignDisplayColumn: configured.foreignDisplayColumn.trim() }
      : {}),
  };
}

export function updateDbTableV2ColumnConfig(
  config: DbTableV2Config,
  columnName: string,
  patch: DbTableV2ColumnConfig
): JsonObject {
  const current = config.columns[columnName] ?? {};
  const next: DbTableV2ColumnConfig = {
    ...current,
    ...patch,
  };
  if (typeof next.label === 'string' && next.label.trim().length === 0) delete next.label;
  if (typeof next.width === 'string') {
    const width = normalizeDbTableV2ColumnWidth(next.width);
    if (width) next.width = width;
    else delete next.width;
  }
  if (typeof next.foreignDisplayColumn === 'string' && next.foreignDisplayColumn.trim().length === 0) {
    delete next.foreignDisplayColumn;
  }
  return {
    columns: {
      ...config.columns,
      [columnName]: next,
    },
  };
}

export function renameDbTableV2ColumnConfig(
  config: DbTableV2Config,
  oldColumnName: string,
  nextColumnName: string
): JsonObject {
  if (oldColumnName === nextColumnName || !(oldColumnName in config.columns)) return {};
  const columns = { ...config.columns };
  columns[nextColumnName] = columns[oldColumnName]!;
  delete columns[oldColumnName];
  return { columns };
}

export function removeDbTableV2ColumnConfig(config: DbTableV2Config, columnName: string): JsonObject {
  if (!(columnName in config.columns)) return {};
  const columns = { ...config.columns };
  delete columns[columnName];
  return { columns };
}

export function normalizeDbTableV2ColumnWidth(value: unknown): string {
  const width = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return CSS_COLUMN_WIDTH.test(width) ? width : '';
}

export function humanizeDbColumnName(value: string): string {
  const words = value
    .replace(/[_-]+/gu, ' ')
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
  return words.map((word) => word.slice(0, 1).toUpperCase() + word.slice(1)).join(' ') || value;
}

function readColumnConfigs(value: unknown): Record<string, DbTableV2ColumnConfig> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([columnName, candidate]) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const raw = candidate as Record<string, unknown>;
    const visibility = raw.visibility === 'hidden' || raw.visibility === 'compact' || raw.visibility === 'visible'
      ? raw.visibility
      : undefined;
    const width = normalizeDbTableV2ColumnWidth(raw.width);
    const column: DbTableV2ColumnConfig = {
      ...(typeof raw.label === 'string' && raw.label.trim() ? { label: raw.label.trim() } : {}),
      ...(visibility ? { visibility } : {}),
      ...(width ? { width } : {}),
      ...(typeof raw.wrap === 'boolean' ? { wrap: raw.wrap } : {}),
      ...(typeof raw.foreignDisplayColumn === 'string' && raw.foreignDisplayColumn.trim()
        ? { foreignDisplayColumn: raw.foreignDisplayColumn.trim() }
        : {}),
    };
    return [[columnName, column]];
  }));
}
