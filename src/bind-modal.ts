import { state, getRenderApp, getRefreshReaderPanels, getRefreshModalPreview } from './state';
import { findSectionByKey } from './section-ops';
import { closeModal } from './navigation';
import { saveReusableFromModal } from './reusable';
import { findBlockByIds } from './block-ops';
import { recordHistory } from './history';
import { setSqliteRowComponent } from './plugin-sqlite';

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
      recordHistory(`sqlite-row-component:${modal.tableName}:${modal.rowId}`);
      void setSqliteRowComponent(modal.tableName, modal.rowId, modal.draft)
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
  const sqliteRowComponentInput = modalRoot.querySelector<HTMLTextAreaElement>('#sqliteRowComponentInput');
  if (sqliteRowComponentInput && state.sqliteRowComponentModal) {
    sqliteRowComponentInput.addEventListener('input', () => {
      if (!state.sqliteRowComponentModal) {
        return;
      }
      state.sqliteRowComponentModal = {
        ...state.sqliteRowComponentModal,
        draft: sqliteRowComponentInput.value,
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
