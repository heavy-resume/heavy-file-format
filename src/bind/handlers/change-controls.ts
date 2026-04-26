import { getRenderApp, recordHistory, materializeDbTableDraftRow, renameDbTableColumn, syncSqliteColumnNameInDom, updateDbTableCell, handleImageUpload } from './_imports';

export function bindChangeControls(app: HTMLElement): void {
  app.addEventListener('change', (event) => {
    const target = event.target as HTMLElement;
    const field = target.dataset.field;
    if (!field) {
      return;
    }

    if (field === 'sqlite-cell' && target instanceof HTMLInputElement) {
      const tableName = target.dataset.tableName ?? '';
      const columnName = target.dataset.columnName ?? '';
      const rowId = Number.parseInt(target.dataset.rowid ?? '', 10);
      const isDraftRow = target.dataset.sqliteDraftRow === 'true';
      if (tableName.length === 0 || columnName.length === 0) {
        return;
      }
      if (isDraftRow) {
        if (target.value.length === 0) {
          return;
        }
        recordHistory(`sqlite-draft-row:${tableName}:${columnName}`);
        void materializeDbTableDraftRow(tableName, columnName, target.value)
          .then(() => {
            getRenderApp()();
          })
          .catch((error) => {
            console.error('[hvy:sqlite-plugin] draft row materialization failed', error);
          });
        return;
      }
      if (Number.isNaN(rowId)) {
        return;
      }
      recordHistory(`sqlite-cell:${tableName}:${rowId}:${columnName}`);
      void updateDbTableCell(tableName, rowId, columnName, target.value)
        .catch((error) => {
          console.error('[hvy:sqlite-plugin] cell update failed', error);
        });
      return;
    }

    if (field === 'image-upload' && target instanceof HTMLInputElement) {
      const file = target.files?.[0];
      if (!file) return;
      void handleImageUpload(target, file);
      return;
    }

    if (field === 'sqlite-column-name' && target instanceof HTMLInputElement) {
      const tableName = target.dataset.tableName ?? '';
      const oldColumnName = target.dataset.oldColumnName ?? '';
      if (tableName.length === 0 || oldColumnName.length === 0) {
        return;
      }
      recordHistory(`sqlite-column:${tableName}:${oldColumnName}`);
      void renameDbTableColumn(tableName, oldColumnName, target.value)
        .then(() => {
          const nextColumnName = target.value.trim();
          if (nextColumnName.length === 0) {
            return;
          }
          target.dataset.oldColumnName = nextColumnName;
          syncSqliteColumnNameInDom(tableName, oldColumnName, nextColumnName, app);
        })
        .catch((error) => {
          console.error('[hvy:sqlite-plugin] column rename failed', error);
          getRenderApp()();
        });
    }
  });
}
