import './modal.css';
import { state, getRenderApp, getRefreshReaderPanels, getRefreshModalPreview } from './state';
import { findSectionByKey } from './section-ops';
import { closeModal } from './navigation';
import { saveReusableFromModal } from './reusable';
import { findBlockByIds, markActiveEditorBlockAsNew, setActiveEditorBlock, setAiEditorHostBlock } from './block-ops';
import { recordHistory } from './history';
import { parseAttachedComponentBlocks, resetDbTableViewState, setSqliteRowComponent } from './plugins/db-table';
import { serializeBlockFragment } from './serialization';
import { ensureComponentListBlocks, ensureContainerBlocks, ensureExpandableBlocks } from './document-factory';
import { createGridItem } from './grid-ops';
import { syncReusableTemplateForBlock } from './reusable';
import { createBlockFromReusableTemplateValues } from './bind/actions/reusable-template';
import { assignAutoBlockId } from './auto-block-id';
import { applyXrefTargetDefaults } from './xref-ops';

export function bindModal(app: HTMLElement): void {
  const modalRoot = app.querySelector<HTMLDivElement>('#modalRoot');
  if (!modalRoot) {
    return;
  }

  modalRoot.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.dataset.modalAction === 'close-overlay') {
      closeModal();
      getRenderApp()();
      return;
    }

    const closeBtn = target.closest<HTMLElement>('[data-modal-action="close"]');
    if (closeBtn) {
      closeModal();
      getRenderApp()();
      return;
    }

    const saveBtn = target.closest<HTMLElement>('[data-modal-action="save-reusable"]');
    if (saveBtn) {
      saveReusableFromModal(app, {
        findBlockByIds,
        recordHistory,
        closeModal,
      });
      return;
    }

    const updateReusableBtn = target.closest<HTMLElement>('[data-modal-action="update-reusable"]');
    if (updateReusableBtn) {
      saveReusableFromModal(
        app,
        {
          findBlockByIds,
          recordHistory,
          closeModal,
        },
        { mode: 'update-existing' }
      );
      return;
    }

    const insertReusableTemplateBtn = target.closest<HTMLElement>('[data-modal-action="insert-reusable-template"]');
    if (insertReusableTemplateBtn && state.reusableTemplateModal) {
      insertReusableTemplateFromModal(modalRoot);
      return;
    }

    const saveDbTableQueryBtn = target.closest<HTMLElement>('[data-modal-action="db-table-query-save"]');
    if (saveDbTableQueryBtn && state.dbTableQueryModal) {
      const modal = state.dbTableQueryModal;
      const block = findBlockByIds(modal.sectionKey, modal.blockId);
      if (!block) {
        closeModal();
        getRenderApp()();
        return;
      }
      recordHistory(`db-table-query:${modal.tableName || modal.blockId}`);
      block.text = modal.draftQuery;
      block.schema.pluginConfig = {
        ...block.schema.pluginConfig,
        source: 'with-file',
        table: modal.tableName,
        queryDynamicWindow: modal.dynamicWindow,
        queryLimit: modal.dynamicWindow ? undefined : modal.queryLimit,
      };
      if (modal.dynamicWindow) {
        delete block.schema.pluginConfig.queryLimit;
      }
      resetDbTableViewState(modal.sectionKey, modal.blockId);
      getRefreshReaderPanels()();
      closeModal();
      getRenderApp()();
      return;
    }

    const saveSqliteRowComponentBtn = target.closest<HTMLElement>('[data-modal-action="sqlite-row-component-save"]');
    if (saveSqliteRowComponentBtn && state.sqliteRowComponentModal) {
      const modal = state.sqliteRowComponentModal;
      const nextSerialized = modal.mode === 'raw' ? modal.rawDraft.trim() : modal.blocks.map((block) => serializeBlockFragment(block)).join('\n\n');
      if (nextSerialized.length === 0) {
        state.sqliteRowComponentModal = {
          ...modal,
          error: 'Add at least one component before saving this row attachment.',
        };
        getRenderApp()();
        return;
      }
      recordHistory(`sqlite-row-component:${modal.tableName}:${modal.rowId}`);
      void setSqliteRowComponent(modal.tableName, modal.rowId, nextSerialized)
        .then(() => {
          closeModal();
          getRenderApp()();
        })
        .catch((error) => {
          state.sqliteRowComponentModal = {
            ...modal,
            error: error instanceof Error ? error.message : 'Failed to save attached component.',
          };
          getRenderApp()();
        });
      return;
    }

    const sqliteRowComponentModeBtn = target.closest<HTMLElement>('[data-modal-action="sqlite-row-component-mode"]');
    if (sqliteRowComponentModeBtn && state.sqliteRowComponentModal) {
      const modal = state.sqliteRowComponentModal;
      const nextMode = sqliteRowComponentModeBtn.dataset.modalMode;
      if (nextMode !== 'basic' && nextMode !== 'advanced' && nextMode !== 'raw') {
        return;
      }
      if (nextMode === modal.mode) {
        return;
      }

      if (modal.mode === 'raw' && nextMode !== 'raw') {
        try {
          const parsedBlocks = parseAttachedComponentBlocks(modal.rawDraft);
          state.sqliteRowComponentModal = {
            ...modal,
            mode: nextMode,
            blocks: parsedBlocks,
            error: null,
          };
          if (parsedBlocks[0]) {
            state.activeEditorBlock = {
              sectionKey: modal.sectionKey,
              blockId: parsedBlocks[0].id,
            };
          }
        } catch (error) {
          state.sqliteRowComponentModal = {
            ...modal,
            error: error instanceof Error ? error.message : 'Attached HVY is invalid.',
          };
        }
        getRenderApp()();
        return;
      }

      state.sqliteRowComponentModal = {
        ...modal,
        mode: nextMode,
        rawDraft: nextMode === 'raw' ? modal.blocks.map((block) => serializeBlockFragment(block)).join('\n\n') : modal.rawDraft,
        error: null,
      };
      getRenderApp()();
      return;
    }

    const clearSqliteRowComponentBtn = target.closest<HTMLElement>('[data-modal-action="sqlite-row-component-clear"]');
    if (clearSqliteRowComponentBtn && state.sqliteRowComponentModal) {
      const modal = state.sqliteRowComponentModal;
      recordHistory(`sqlite-row-component-clear:${modal.tableName}:${modal.rowId}`);
      void setSqliteRowComponent(modal.tableName, modal.rowId, '')
        .then(() => {
          closeModal();
          getRenderApp()();
        })
        .catch((error) => {
          state.sqliteRowComponentModal = {
            ...modal,
            error: error instanceof Error ? error.message : 'Failed to remove attached component.',
          };
          getRenderApp()();
        });
      return;
    }

    const toggleSectionLockBtn = target.closest<HTMLElement>('[data-modal-action="toggle-section-lock"]');
    if (toggleSectionLockBtn) {
      const sectionKey = toggleSectionLockBtn.dataset.sectionKey;
      const section = sectionKey ? findSectionByKey(state.document.sections, sectionKey) : null;
      if (!section) {
        return;
      }
      section.lock = !section.lock;
      getRefreshReaderPanels()();
      getRenderApp()();
      return;
    }

    const toggleComponentLockBtn = target.closest<HTMLElement>('[data-modal-action="toggle-component-lock"]');
    if (toggleComponentLockBtn) {
      const sectionKey = toggleComponentLockBtn.dataset.sectionKey;
      const blockId = toggleComponentLockBtn.dataset.blockId;
      const block = sectionKey && blockId ? findBlockByIds(sectionKey, blockId) : null;
      if (!block) {
        return;
      }
      block.schema.lock = !block.schema.lock;
      getRefreshReaderPanels()();
      getRenderApp()();
      return;
    }
  });

  const reusableNameInput = modalRoot.querySelector<HTMLInputElement>('#reusableNameInput');
  if (reusableNameInput && state.reusableSaveModal) {
    reusableNameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        saveReusableFromModal(
          app,
          {
            findBlockByIds,
            recordHistory,
            closeModal,
          },
          { mode: 'save-as-new' }
        );
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        closeModal();
        getRenderApp()();
      }
    });
  }

  const cssInput = modalRoot.querySelector<HTMLTextAreaElement>('#modalCssInput');
  const sqliteRowComponentRawInput = modalRoot.querySelector<HTMLTextAreaElement>('#sqliteRowComponentRawInput');
  const dbTableQueryInput = modalRoot.querySelector<HTMLTextAreaElement>('#dbTableQueryInput');
  const dbTableQueryDynamicWindowInput = modalRoot.querySelector<HTMLInputElement>('#dbTableQueryDynamicWindowInput');
  const dbTableQueryLimitInput = modalRoot.querySelector<HTMLInputElement>('#dbTableQueryLimitInput');

  if (sqliteRowComponentRawInput && state.sqliteRowComponentModal) {
    sqliteRowComponentRawInput.addEventListener('input', () => {
      if (!state.sqliteRowComponentModal) {
        return;
      }
      state.sqliteRowComponentModal = {
        ...state.sqliteRowComponentModal,
        rawDraft: sqliteRowComponentRawInput.value,
        error: null,
      };
    });
  }

  if (dbTableQueryInput && state.dbTableQueryModal) {
    dbTableQueryInput.addEventListener('input', () => {
      if (!state.dbTableQueryModal) {
        return;
      }
      state.dbTableQueryModal = {
        ...state.dbTableQueryModal,
        draftQuery: dbTableQueryInput.value,
        error: null,
      };
    });
  }

  if (dbTableQueryDynamicWindowInput && state.dbTableQueryModal) {
    dbTableQueryDynamicWindowInput.addEventListener('change', () => {
      if (!state.dbTableQueryModal) {
        return;
      }
      state.dbTableQueryModal = {
        ...state.dbTableQueryModal,
        dynamicWindow: dbTableQueryDynamicWindowInput.checked,
        error: null,
      };
      getRenderApp()();
    });
  }

  if (dbTableQueryLimitInput && state.dbTableQueryModal) {
    dbTableQueryLimitInput.addEventListener('input', () => {
      if (!state.dbTableQueryModal) {
        return;
      }
      const parsed = Number.parseInt(dbTableQueryLimitInput.value, 10);
      state.dbTableQueryModal = {
        ...state.dbTableQueryModal,
        queryLimit: Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, 99)) : state.dbTableQueryModal.queryLimit,
        error: null,
      };
    });
  }

  if (!cssInput || !state.modalSectionKey) {
    return;
  }

  cssInput.addEventListener('input', () => {
    const section = findSectionByKey(state.document.sections, state.modalSectionKey ?? '');
    if (!section) {
      return;
    }
    section.css = cssInput.value;
    getRefreshReaderPanels()();
    getRefreshModalPreview()();
  });
}

function insertReusableTemplateFromModal(modalRoot: HTMLDivElement): void {
  const modal = state.reusableTemplateModal;
  if (!modal) {
    return;
  }
  const values: Record<string, string> = {};
  modalRoot.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('[data-template-variable]').forEach((input) => {
    const key = input.dataset.templateVariable;
    if (key) {
      values[key] = input.value;
    }
  });
  let newBlock;
  try {
    newBlock = createBlockFromReusableTemplateValues(modal.component, values);
    applyXrefTargetDefaults(newBlock);
  } catch (error) {
    console.error('[hvy:template] failed to insert reusable component from template modal', error);
    return;
  }

  const target = modal.target;
  recordHistory(`reusable-template:${modal.component}`);
  if (target.kind === 'section') {
    const section = findSectionByKey(state.document.sections, target.sectionKey);
    if (!section || section.lock) {
      closeModal();
      getRenderApp()();
      return;
    }
    assignAutoBlockId(newBlock, { document: state.document, inheritedTags: section.tags, sourceValues: values });
    section.blocks.push(newBlock);
  } else {
    const block = findBlockByIds(target.sectionKey, target.blockId);
    if (!block || block.schema.lock) {
      closeModal();
      getRenderApp()();
      return;
    }
    assignAutoBlockId(newBlock, { document: state.document, inheritedTags: block.schema.tags, sourceValues: values });
    if (target.kind === 'component-list') {
      ensureComponentListBlocks(block);
      block.schema.componentListBlocks.push(newBlock);
    } else if (target.kind === 'container') {
      ensureContainerBlocks(block);
      block.schema.containerBlocks.push(newBlock);
    } else if (target.kind === 'grid') {
      block.schema.gridItems.push(createGridItem(block.schema.gridItems.length, block.schema.gridColumns, () => newBlock));
      block.schema.gridItems[block.schema.gridItems.length - 1].block = newBlock;
    } else {
      ensureExpandableBlocks(block);
      const expandableTarget = target.part === 'stub' ? block.schema.expandableStubBlocks.children : block.schema.expandableContentBlocks.children;
      expandableTarget.push(newBlock);
    }
    syncReusableTemplateForBlock(target.sectionKey, target.blockId);
  }
  setActiveEditorBlock(target.sectionKey, newBlock.id, { targetOnly: target.kind !== 'section' });
  if (state.currentView === 'ai' && (target.kind === 'section' || !state.aiEditorHostBlock)) {
    setAiEditorHostBlock(target.sectionKey, newBlock.id);
  }
  markActiveEditorBlockAsNew(newBlock.id);
  closeModal();
  getRenderApp()();
}
