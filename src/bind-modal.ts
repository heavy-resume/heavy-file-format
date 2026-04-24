import { state, getRenderApp, getRefreshReaderPanels, getRefreshModalPreview } from './state';
import { findSectionByKey } from './section-ops';
import { closeModal } from './navigation';
import { saveReusableFromModal } from './reusable';
import { findBlockByIds } from './block-ops';
import { recordHistory } from './history';
import { parseAttachedComponentBlocks, setSqliteRowComponent } from './plugins/db-table';
import { serializeBlockFragment } from './serialization';

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
        saveReusableFromModal(app, {
          findBlockByIds,
          recordHistory,
          closeModal,
        });
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

  if (!cssInput || !state.modalSectionKey) {
    return;
  }

  cssInput.addEventListener('input', () => {
    const section = findSectionByKey(state.document.sections, state.modalSectionKey ?? '');
    if (!section) {
      return;
    }
    section.customCss = cssInput.value;
    getRefreshReaderPanels()();
    getRefreshModalPreview()();
  });
}
