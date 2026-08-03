import type { VisualDocument } from './types';

export interface DatabaseChangeSnapshot {
  revision: number;
  tables: string[];
  complete: boolean;
}

interface DatabaseChangeRecord extends DatabaseChangeSnapshot {}

interface DatabaseChangeState {
  revision: number;
  records: DatabaseChangeRecord[];
}

const MAX_DATABASE_CHANGE_RECORDS = 200;
const states = new WeakMap<VisualDocument, DatabaseChangeState>();

function getState(document: VisualDocument): DatabaseChangeState {
  let changeState = states.get(document);
  if (!changeState) {
    changeState = { revision: 0, records: [] };
    states.set(document, changeState);
  }
  return changeState;
}

export function getDatabaseChangeRevision(document: VisualDocument): number {
  return getState(document).revision;
}

export function recordDatabaseTablesChanged(
  document: VisualDocument,
  tables: Iterable<string>,
  complete = true
): DatabaseChangeSnapshot {
  const state = getState(document);
  const record: DatabaseChangeRecord = {
    revision: ++state.revision,
    tables: [...new Set([...tables].map((table) => table.trim()).filter(Boolean))].sort(),
    complete,
  };
  state.records.push(record);
  if (state.records.length > MAX_DATABASE_CHANGE_RECORDS) {
    state.records.splice(0, state.records.length - MAX_DATABASE_CHANGE_RECORDS);
  }
  return { ...record, tables: [...record.tables] };
}

export function getDatabaseChangesSince(
  document: VisualDocument,
  revision: number
): DatabaseChangeSnapshot {
  const state = getState(document);
  if (revision >= state.revision) {
    return { revision: state.revision, tables: [], complete: true };
  }
  const records = state.records.filter((record) => record.revision > revision);
  const historyComplete = records.length > 0 && records[0]!.revision === revision + 1;
  return {
    revision: state.revision,
    tables: [...new Set(records.flatMap((record) => record.tables))].sort(),
    complete: historyComplete && records.every((record) => record.complete),
  };
}
