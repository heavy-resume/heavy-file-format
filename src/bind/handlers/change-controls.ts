import { state, getRenderApp, getRefreshReaderPanels, recordHistory, handleImageUpload, resolveBlockContext, syncReusableTemplateForBlock } from './_imports';
import { encodeComponentListRuntimeView, parseComponentListRuntimeView } from '../../editor/components/component-list/component-list-view';
import type { JsonObject } from '../../hvy/types';
import { PDF_DOCUMENT_PAGE_SIZE_OPTIONS, readPdfPageMetaObject } from '../../pdf-page-settings';
import { findPdfStylePreset } from '../../pdf-style-presets';
import { setSearchCategory, setSearchFilterEnabled } from '../../search/actions';
import { rememberEmptySectionHeadingLevel } from '../../section-heading-memory';
import type { SearchCategory } from '../../search/types';

const loadDbTableRuntime = () => import('../../plugins/db-table');

export function bindChangeControls(app: HTMLElement): void {
  app.addEventListener('change', (event) => {
    const target = event.target as HTMLElement;
    const field = target.dataset.field;
    if (!field) {
      return;
    }

    if (field === 'search-case-sensitive' && target instanceof HTMLInputElement) {
      state.search.caseSensitive = target.checked;
      return;
    }

    if (field === 'search-filter' && target instanceof HTMLInputElement) {
      setSearchFilterEnabled(target.checked);
      return;
    }

    if (field === 'search-category' && target instanceof HTMLInputElement) {
      const category = target.dataset.searchCategory as SearchCategory | undefined;
      if (category === 'tags' || category === 'contents' || category === 'description') {
        setSearchCategory(category, target.checked);
      }
      return;
    }

    if (field === 'meta-pdf-page-size' && target instanceof HTMLSelectElement) {
      const pageSize = target.value.trim().toUpperCase();
      if (!(PDF_DOCUMENT_PAGE_SIZE_OPTIONS as readonly string[]).includes(pageSize)) {
        return;
      }
      recordHistory('meta:pdf-page-size');
      const pdfPage = readPdfPageMetaObject(state.document.meta);
      pdfPage.size = pageSize;
      writePdfPageMetaObject(pdfPage);
      getRefreshReaderPanels()();
      return;
    }

    if (field === 'meta-pdf-style-preset' && target instanceof HTMLSelectElement) {
      const preset = findPdfStylePreset(state.pdfStylePresets, target.value);
      if (!preset) {
        return;
      }
      state.pdfStylePresetId = preset.id;
      const picker = target.closest<HTMLElement>('.meta-pdf-preset-picker');
      const description = picker?.nextElementSibling;
      if (description instanceof HTMLElement && description.matches('[data-pdf-preset-description]')) {
        description.textContent = preset.description?.trim() ?? '';
      }
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
        void loadDbTableRuntime()
          .then(({ materializeDbTableDraftRow }) => materializeDbTableDraftRow(tableName, columnName, target.value))
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
      void loadDbTableRuntime()
        .then(({ updateDbTableCell }) => updateDbTableCell(tableName, rowId, columnName, target.value))
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

    if (field === 'component-list-reader-view' && target instanceof HTMLSelectElement) {
      const sectionKey = target.dataset.sectionKey;
      const blockId = target.dataset.blockId;
      if (!sectionKey || !blockId) {
        return;
      }
      const current = parseComponentListRuntimeView(state.componentListReaderViews[`${sectionKey}:${blockId}`] ?? '');
      state.componentListReaderViews[`${sectionKey}:${blockId}`] = encodeComponentListRuntimeView({
        sortKey: target.value,
        sortKeyOverride: true,
        reversed: current.reversed,
        groupKey: current.groupKey,
      });
      getRefreshReaderPanels()();
      return;
    }

    if (field === 'component-list-reader-group' && target instanceof HTMLSelectElement) {
      const sectionKey = target.dataset.sectionKey;
      const blockId = target.dataset.blockId;
      if (!sectionKey || !blockId) {
        return;
      }
      const current = parseComponentListRuntimeView(state.componentListReaderViews[`${sectionKey}:${blockId}`] ?? '');
      state.componentListReaderViews[`${sectionKey}:${blockId}`] = encodeComponentListRuntimeView({
        sortKey: current.sortKeyOverride ? current.sortKey : target.dataset.viewId || '',
        sortKeyOverride: current.sortKeyOverride || !!target.dataset.viewId,
        reversed: current.reversed,
        groupKey: target.value,
      });
      getRefreshReaderPanels()();
      return;
    }

    if (
      (field === 'component-list-default-sort-key'
        || field === 'component-list-default-sort-direction'
        || field === 'component-list-default-group-key') && target instanceof HTMLSelectElement
    ) {
      const sectionKey = target.dataset.sectionKey;
      if (!sectionKey) {
        return;
      }
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      if (field === 'component-list-default-sort-key') {
        context.block.schema.componentListDefaultSortKey = target.value;
      } else if (field === 'component-list-default-sort-direction') {
        context.block.schema.componentListDefaultSortDirection = target.value === 'desc' ? 'desc' : 'asc';
      } else {
        context.block.schema.componentListDefaultGroupKey = target.value;
      }
      syncReusableTemplateForBlock(sectionKey, context.block.id);
      getRefreshReaderPanels()();
      return;
    }

    if (field === 'empty-section-heading-level' && target instanceof HTMLSelectElement) {
      const sectionKey = target.dataset.sectionKey;
      if (sectionKey) {
        rememberEmptySectionHeadingLevel(sectionKey, target.value);
      }
      return;
    }

    if (field === 'sqlite-column-name' && target instanceof HTMLInputElement) {
      const tableName = target.dataset.tableName ?? '';
      const oldColumnName = target.dataset.oldColumnName ?? '';
      if (tableName.length === 0 || oldColumnName.length === 0) {
        return;
      }
      const trimmed = target.value.trim();
      if (trimmed.length === 0) {
        const proceed = window.confirm(`Delete column "${oldColumnName}"?`);
        if (!proceed) {
          target.value = oldColumnName;
          return;
        }
        recordHistory(`sqlite-column-drop:${tableName}:${oldColumnName}`);
        void loadDbTableRuntime()
          .then(({ dropDbTableColumn }) => dropDbTableColumn(tableName, oldColumnName))
          .then(() => {
            getRenderApp()();
          })
          .catch((error) => {
            console.error('[hvy:sqlite-plugin] column drop failed', error);
            target.value = oldColumnName;
            window.alert(error instanceof Error ? error.message : 'Failed to delete column.');
            getRenderApp()();
          });
        return;
      }
      recordHistory(`sqlite-column:${tableName}:${oldColumnName}`);
      void loadDbTableRuntime()
        .then(({ renameDbTableColumn }) => renameDbTableColumn(tableName, oldColumnName, target.value))
        .then(() => {
          const nextColumnName = target.value.trim();
          if (nextColumnName.length === 0) {
            return;
          }
          target.dataset.oldColumnName = nextColumnName;
          void loadDbTableRuntime().then(({ syncSqliteColumnNameInDom }) => {
            syncSqliteColumnNameInDom(tableName, oldColumnName, nextColumnName, app);
          });
        })
        .catch((error) => {
          console.error('[hvy:sqlite-plugin] column rename failed', error);
          getRenderApp()();
        });
    }
  });
}

function writePdfPageMetaObject(pdfPage: JsonObject): void {
  if (Object.keys(pdfPage).length > 0) {
    state.document.meta.pdf_page = pdfPage;
  } else {
    delete state.document.meta.pdf_page;
  }
}
