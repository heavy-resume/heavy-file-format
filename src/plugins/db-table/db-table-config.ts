import type { JsonObject } from '../../hvy/types';

export type DbTableColumnVisibility = 'visible' | 'compact' | 'hidden';

export interface DbTableColumnConfig {
  label?: string;
  visibility?: DbTableColumnVisibility;
  width?: string;
  wrap?: boolean;
  foreignDisplayColumn?: string;
}

export interface DbTableConfig {
  source: string;
  table: string;
  queryLimit: number;
  columns: Record<string, DbTableColumnConfig>;
}

export interface DbTableColumnDefaults {
  generated: boolean;
}

const CSS_COLUMN_WIDTH = /^(?:auto|\d+(?:\.\d+)?(?:px|rem|em|ch|%))$/u;
const CSS_MAX_COLUMN_WIDTH = /^\d+(?:\.\d+)?(?:px|rem|em|ch)$/u;

export const DEFAULT_DB_TABLE_MAX_COLUMN_WIDTH = '40rem';

export function readDbTableConfig(value: JsonObject): DbTableConfig {
  return {
    source: typeof value.source === 'string' && value.source.trim() ? value.source.trim() : 'with-file',
    table: typeof value.table === 'string' ? value.table.trim() : '',
    queryLimit: readDbTableQueryLimit(value.queryLimit),
    columns: readColumnConfigs(value.columns),
  };
}

export function readDbTableQueryLimit(value: unknown): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseInt(value, 10)
      : Number.NaN;
  return Number.isFinite(parsed) ? Math.max(1, Math.min(Math.floor(parsed), 1_000)) : 50;
}

export function readDbTableColumnConfig(
  config: DbTableConfig,
  columnName: string,
  defaults: DbTableColumnDefaults
): Required<Pick<DbTableColumnConfig, 'label' | 'visibility' | 'width' | 'wrap'>> & Pick<DbTableColumnConfig, 'foreignDisplayColumn'> {
  const configured = config.columns[columnName] ?? {};
  const visibility = configured.visibility === 'hidden' || configured.visibility === 'compact'
    ? configured.visibility
    : defaults.generated
      ? 'compact'
      : 'visible';
  return {
    label: configured.label?.trim() || humanizeDbColumnName(columnName),
    visibility,
    width: normalizeDbTableColumnWidth(configured.width) || (visibility === 'compact' ? '5rem' : '12rem'),
    wrap: configured.wrap === true,
    ...(configured.foreignDisplayColumn?.trim()
      ? { foreignDisplayColumn: configured.foreignDisplayColumn.trim() }
      : {}),
  };
}

export function formatEffectiveDbTableColumns(
  config: DbTableConfig,
  columns: Array<{ name: string; generated: boolean }>
): JsonObject {
  return Object.fromEntries(columns.map((column) => {
    const effective = readDbTableColumnConfig(config, column.name, { generated: column.generated });
    return [column.name, {
      label: effective.label,
      visibility: effective.visibility,
      width: effective.width,
      wrap: effective.wrap,
      foreignDisplayColumn: effective.foreignDisplayColumn ?? '',
    }];
  }));
}

export function parseSparseDbTableColumns(
  config: DbTableConfig,
  raw: JsonObject,
  columns: Array<{ name: string; generated: boolean }>
): Record<string, DbTableColumnConfig> {
  const schemaByName = new Map(columns.map((column) => [column.name, column]));
  const unknownColumns = Object.keys(raw).filter((name) => !schemaByName.has(name));
  if (unknownColumns.length > 0) {
    throw new Error(`db-table presentation column does not exist: ${unknownColumns.join(', ')}`);
  }
  const sparse: Record<string, DbTableColumnConfig> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`db-table presentation for ${name} must be a JSON object.`);
    }
    const candidate = value as JsonObject;
    const unknownProperties = Object.keys(candidate).filter((property) =>
      !['label', 'visibility', 'width', 'wrap', 'foreignDisplayColumn'].includes(property)
    );
    if (unknownProperties.length > 0) {
      throw new Error(`db-table presentation for ${name} has unsupported properties: ${unknownProperties.join(', ')}`);
    }
    if (typeof candidate.label !== 'string') {
      throw new Error(`db-table presentation label for ${name} must be a string.`);
    }
    if (candidate.visibility !== 'visible' && candidate.visibility !== 'compact' && candidate.visibility !== 'hidden') {
      throw new Error(`db-table presentation visibility for ${name} must be visible, compact, or hidden.`);
    }
    const width = normalizeDbTableColumnWidth(candidate.width);
    if (!width) {
      throw new Error(`db-table presentation width for ${name} must be a CSS width using px, rem, em, ch, %, or auto.`);
    }
    if (typeof candidate.wrap !== 'boolean') {
      throw new Error(`db-table presentation wrap for ${name} must be a boolean.`);
    }
    if (typeof candidate.foreignDisplayColumn !== 'string') {
      throw new Error(`db-table presentation foreignDisplayColumn for ${name} must be a string.`);
    }
    const column = schemaByName.get(name)!;
    const defaults = readDbTableColumnConfig({ ...config, columns: {} }, name, { generated: column.generated });
    const next: DbTableColumnConfig = {};
    const label = candidate.label.trim();
    const foreignDisplayColumn = candidate.foreignDisplayColumn.trim();
    if (label && label !== defaults.label) next.label = label;
    if (candidate.visibility !== defaults.visibility) next.visibility = candidate.visibility;
    if (width !== defaults.width) next.width = width;
    if (candidate.wrap) next.wrap = true;
    if (foreignDisplayColumn) next.foreignDisplayColumn = foreignDisplayColumn;
    if (Object.keys(next).length > 0) sparse[name] = next;
  }
  return sparse;
}

export function updateDbTableColumnConfig(
  config: DbTableConfig,
  columnName: string,
  patch: DbTableColumnConfig
): JsonObject {
  const current = config.columns[columnName] ?? {};
  const next: DbTableColumnConfig = {
    ...current,
    ...patch,
  };
  if (typeof next.label === 'string' && next.label.trim().length === 0) delete next.label;
  if (typeof next.width === 'string') {
    const width = normalizeDbTableColumnWidth(next.width);
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

export function renameDbTableSourceColumnConfig(
  config: DbTableConfig,
  oldColumnName: string,
  nextColumnName: string
): JsonObject {
  if (oldColumnName === nextColumnName) return {};
  const columns = { ...config.columns };
  columns[nextColumnName] = {
    ...(columns[oldColumnName] ?? {}),
    label: columns[oldColumnName]?.label ?? humanizeDbColumnName(oldColumnName),
  };
  delete columns[oldColumnName];
  return { columns };
}

export function removeDbTableColumnConfig(config: DbTableConfig, columnName: string): JsonObject {
  if (!(columnName in config.columns)) return {};
  const columns = { ...config.columns };
  delete columns[columnName];
  return { columns };
}

export function normalizeDbTableColumnWidth(value: unknown): string {
  const width = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return CSS_COLUMN_WIDTH.test(width) ? width : '';
}

export function normalizeDbTableMaxColumnWidth(value: unknown): string {
  const width = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return CSS_MAX_COLUMN_WIDTH.test(width) ? width : '';
}

export function humanizeDbColumnName(value: string): string {
  const words = value
    .replace(/[_-]+/gu, ' ')
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
  return words.map((word) => word.slice(0, 1).toUpperCase() + word.slice(1)).join(' ') || value;
}

function readColumnConfigs(value: unknown): Record<string, DbTableColumnConfig> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([columnName, candidate]) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const raw = candidate as Record<string, unknown>;
    const visibility = raw.visibility === 'hidden' || raw.visibility === 'compact' || raw.visibility === 'visible'
      ? raw.visibility
      : undefined;
    const width = normalizeDbTableColumnWidth(raw.width);
    const column: DbTableColumnConfig = {
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
