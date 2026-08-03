import { getActiveStateRuntime, type StateRuntime } from '../state';
import type { VisualDocument } from '../types';

export type HvyDatabaseTableValue = number | string | Uint8Array | null;

export interface HvyDatabaseTableForeignOption {
  value: HvyDatabaseTableValue;
  label: string;
}

export interface HvyDatabaseTableForeignKey {
  referencedTable: string;
  localColumn: string;
  referencedColumn: string;
  onDelete: string;
  options: HvyDatabaseTableForeignOption[];
  displayColumnOptions: string[];
}

export interface HvyDatabaseTableColumn {
  name: string;
  type: string;
  notNull: boolean;
  defaultValue: HvyDatabaseTableValue;
  primaryKeyOrder: number;
  generated: boolean;
  foreignKey: HvyDatabaseTableForeignKey | null;
}

export interface HvyDatabaseTableRow {
  rowId: number | null;
  hasAttachedComponent: boolean;
  values: Record<string, HvyDatabaseTableValue>;
}

export interface HvyDatabaseTablePageRequest {
  document: VisualDocument;
  table: string;
  query: string;
  pageSize: number;
  offset: number;
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc' | null;
  relationshipDisplayColumns: Record<string, string>;
}

export interface HvyDatabaseTablePage {
  objectType: 'table' | 'view';
  editable: boolean;
  queryActive: boolean;
  columns: HvyDatabaseTableColumn[];
  rows: HvyDatabaseTableRow[];
  offset: number;
  hasNextPage: boolean;
  hasTriggers: boolean;
}

export interface HvyDatabaseTableSource {
  id: string;
  label?: string;
  readPage(request: HvyDatabaseTablePageRequest): Promise<HvyDatabaseTablePage>;
}

const builtInSources = new Map<string, HvyDatabaseTableSource>();
const fallbackHostSources: HvyDatabaseTableSource[] = [];
const hostSourcesByRuntime = new WeakMap<StateRuntime, HvyDatabaseTableSource[]>();

export function registerBuiltInDatabaseTableSource(source: HvyDatabaseTableSource): void {
  const id = normalizeSourceId(source.id);
  if (builtInSources.has(id)) throw new Error(`Database table source "${id}" is already registered.`);
  builtInSources.set(id, { ...source, id });
}

export function setHostDatabaseTableSources(sources: HvyDatabaseTableSource[]): void {
  const normalized = sources.map((source) => ({ ...source, id: normalizeSourceId(source.id) }));
  const ids = new Set<string>();
  for (const source of normalized) {
    if (source.id === 'with-file' || builtInSources.has(source.id)) throw new Error(`Database table source "${source.id}" is built in and cannot be replaced.`);
    if (ids.has(source.id)) throw new Error(`Database table source "${source.id}" is declared more than once.`);
    ids.add(source.id);
  }
  const target = getMutableHostSources();
  target.splice(0, target.length, ...normalized);
}

export function getDatabaseTableSource(id: string): HvyDatabaseTableSource | null {
  const normalized = normalizeSourceId(id);
  return builtInSources.get(normalized)
    ?? getMutableHostSources().find((source) => source.id === normalized)
    ?? null;
}

export function getDatabaseTableSources(): HvyDatabaseTableSource[] {
  return [...builtInSources.values(), ...getMutableHostSources()];
}

function getMutableHostSources(): HvyDatabaseTableSource[] {
  try {
    const runtime = getActiveStateRuntime();
    let sources = hostSourcesByRuntime.get(runtime);
    if (!sources) {
      sources = [...fallbackHostSources];
      hostSourcesByRuntime.set(runtime, sources);
    }
    return sources;
  } catch {
    return fallbackHostSources;
  }
}

function normalizeSourceId(value: string): string {
  const id = value.trim();
  if (!id) throw new Error('Database table source ids cannot be empty.');
  return id;
}
