import { state, getRefreshReaderPanels, refreshReaderPanelsOutsideActiveEditor, recordHistory, handleImageUpload, resolveBlockContext, syncReusableTemplateForBlock, handleBlockFieldInput } from './_imports';
import {
  encodeComponentListRuntimeView,
  getComponentListDisplayState,
  parseComponentListRuntimeView,
  persistComponentListDisplayState,
} from '../../editor/components/component-list/component-list-view';
import type { JsonObject } from '../../hvy/types';
import { PDF_DOCUMENT_PAGE_SIZE_OPTIONS, readPdfPageMetaObject } from '../../pdf-page-settings';
import { findPdfStylePreset } from '../../pdf-style-presets';
import { setSearchCategory, setSearchFilterEnabled } from '../../search/actions';
import { rememberEmptySectionHeadingLevel } from '../../section-heading-memory';
import type { SearchCategory } from '../../search/types';
import { runDocumentEditHooksAfterCommit } from '../../document-edit-hooks';


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

    if (field === 'image-upload' && target instanceof HTMLInputElement) {
      const file = target.files?.[0];
      if (!file) return;
      void handleImageUpload(target, file);
      return;
    }

    if (field === 'sort-value-enum' && target instanceof HTMLSelectElement) {
      const editor = target.closest<HTMLElement>('[data-field="block-rich"], [data-field="text-fill-in-rich"], [data-field="block-grid-rich"], [data-field="table-cell"]');
      if (!editor) {
        return;
      }
      Array.from(target.options).forEach((option) => {
        option.toggleAttribute('selected', option.selected);
      });
      if (handleBlockFieldInput(editor)) {
        const sectionKey = editor.dataset.sectionKey ?? '';
        const blockId = editor.dataset.blockId ?? '';
        const sortValueKey = target.dataset.sortValueKey ?? '';
        syncReusableTemplateForBlock(sectionKey, blockId);
        refreshReaderPanelsOutsideActiveEditor(editor);
        runDocumentEditHooksAfterCommit(null, () => {
          if (document.activeElement !== document.body) {
            return;
          }
          const nextTarget = [...app.querySelectorAll<HTMLSelectElement>('[data-field="sort-value-enum"]')]
            .find((candidate) =>
              candidate.dataset.sectionKey === sectionKey
              && candidate.dataset.blockId === blockId
              && candidate.dataset.sortValueKey === sortValueKey
            );
          nextTarget?.focus({ preventScroll: true });
        });
      }
      return;
    }

    if (field === 'component-list-reader-view' && target instanceof HTMLSelectElement) {
      const sectionKey = target.dataset.sectionKey;
      const blockId = target.dataset.blockId;
      if (!sectionKey || !blockId) {
        return;
      }
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      const key = `${sectionKey}:${blockId}`;
      const current = parseComponentListRuntimeView(state.componentListReaderViews[key] ?? '');
      const nextView = encodeComponentListRuntimeView({
        sortKey: target.value,
        sortKeyOverride: true,
        reversed: current.reversed,
        groupKey: current.groupKey,
      });
      persistComponentListDisplayState(context.block, getComponentListDisplayState(context.block, nextView));
      syncReusableTemplateForBlock(sectionKey, context.block.id);
      delete state.componentListReaderViews[key];
      getRefreshReaderPanels()();
      return;
    }

    if (field === 'component-list-reader-group' && target instanceof HTMLSelectElement) {
      const sectionKey = target.dataset.sectionKey;
      const blockId = target.dataset.blockId;
      if (!sectionKey || !blockId) {
        return;
      }
      const context = resolveBlockContext(target);
      if (!context) {
        return;
      }
      const key = `${sectionKey}:${blockId}`;
      const current = parseComponentListRuntimeView(state.componentListReaderViews[key] ?? '');
      const nextView = encodeComponentListRuntimeView({
        sortKey: current.sortKeyOverride ? current.sortKey : target.dataset.viewId || '',
        sortKeyOverride: current.sortKeyOverride || !!target.dataset.viewId,
        reversed: current.reversed,
        groupKey: target.value,
      });
      persistComponentListDisplayState(context.block, getComponentListDisplayState(context.block, nextView));
      syncReusableTemplateForBlock(sectionKey, context.block.id);
      delete state.componentListReaderViews[key];
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

  });
}

function writePdfPageMetaObject(pdfPage: JsonObject): void {
  if (Object.keys(pdfPage).length > 0) {
    state.document.meta.pdf_page = pdfPage;
  } else {
    delete state.document.meta.pdf_page;
  }
}
