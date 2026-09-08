import './modal.css';
import { parse as parseYaml } from 'yaml';
import { state, getRenderApp, getRefreshReaderPanels, getRefreshModalPreview } from './state';
import { findSectionByKey } from './section-ops';
import { closeModal } from './navigation';
import { saveReusableFromModal } from './reusable';
import { clearActiveEditorBlock, findBlockByIds, markActiveEditorBlockAsNew, setActiveEditorBlock } from './block-ops';
import { recordHistory } from './history';
import { resetDbTableViewState } from './plugins/db-table-model';
import { parseAttachedComponentBlocks } from './plugins/db-table-fragment';
import { serializeBlockFragment } from './serialization';
import { cloneReusableBlock, cloneReusableSection, createEmptyBlock, ensureComponentListBlocks, ensureContainerBlocks, ensureExpandableBlocks, getReusableTemplate } from './document-factory';
import { createGridItem } from './grid-ops';
import { syncReusableTemplateForBlock } from './reusable';
import { createBlockFromReusableTemplateValues } from './bind/actions/reusable-template';
import { insertTopLevelSection } from './bind/actions/section';
import { assignAutoBlockId } from './auto-block-id';
import { applyXrefTargetDefaults } from './xref-ops';
import { getOutputGenerator } from './plugins/registry';
import { configurePluginBlock } from './plugins/plugin-block';
import { getComponentDefsFromMeta, getSectionDefsFromMeta } from './component-defs';
import { createReusableTemplateVariableName, extractReusableTemplateVariablesFromDefinition, extractReusableTemplateVariablesFromFlavor, extractReusableTemplateVariablesFromSectionDefinition, extractReusableTemplateVariablesFromSectionFlavor, renameReusableTemplateVariable, replaceReusableTemplateVariableOccurrenceWithText, setReusableTemplateVariableType } from './reusable-template-values';
import { resolveOutputGeneratorResponse } from './template-output-generators';
import { exportCurrentDocumentPdfWithTemplateBytes, runNextPdfTemplateImportLlmStep } from './pdf-export/action';
import { changeEncryptedComponentKeyInDocument, decryptComponentInDocument, encryptComponentInDocument } from './encrypted-components';
import { showTransientNotice } from './transient-notice';

const loadDbTableRuntime = () => import('./plugins/db-table');

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

    const changeEncryptionKeyBtn = target.closest<HTMLButtonElement>('[data-modal-action="change-encryption-key"]');
    if (changeEncryptionKeyBtn && state.encryptionModal && !changeEncryptionKeyBtn.disabled) {
      void changeEncryptionKeyFromModal(modalRoot, changeEncryptionKeyBtn);
      return;
    }

    const generateEncryptionBtn = target.closest<HTMLButtonElement>('[data-modal-action="generate-component-encryption"]');
    if (generateEncryptionBtn && state.encryptionModal && !generateEncryptionBtn.disabled) {
      void generateEncryptionFromModal(modalRoot, generateEncryptionBtn);
      return;
    }

    const removeEncryptionBtn = target.closest<HTMLButtonElement>('[data-modal-action="remove-component-encryption"]');
    if (removeEncryptionBtn && state.encryptionModal && !removeEncryptionBtn.disabled) {
      void removeEncryptionFromModal(modalRoot, removeEncryptionBtn);
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

    const addReusableFlavorBtn = target.closest<HTMLElement>('[data-modal-action="add-reusable-flavor"]');
    if (addReusableFlavorBtn) {
      saveReusableFromModal(
        app,
        {
          findBlockByIds,
          recordHistory,
          closeModal,
        },
        { mode: 'add-flavor' }
      );
      return;
    }

    const insertReusableTemplateBtn = target.closest<HTMLElement>('[data-modal-action="insert-reusable-template"]');
    if (insertReusableTemplateBtn && state.reusableTemplateModal) {
      insertReusableTemplateFromModal(modalRoot);
      return;
    }

    const reusableDefinitionCloseBtn = target.closest<HTMLElement>('[data-modal-action="save-reusable-definition-close"]');
    if (reusableDefinitionCloseBtn && state.reusableDefinitionEditModal) {
      saveReusableDefinitionModalAndClose();
      return;
    }

    const reusableDefinitionCancelBtn = target.closest<HTMLElement>('[data-modal-action="reusable-definition-cancel"]');
    if (reusableDefinitionCancelBtn && state.reusableDefinitionEditModal) {
      cancelReusableDefinitionModal();
      return;
    }

    const addReusableDefinitionComponentButton = target.closest<HTMLElement>('[data-action="reusable-definition-add-component"]');
    if (addReusableDefinitionComponentButton) {
      event.stopPropagation();
      addReusableDefinitionComponent(addReusableDefinitionComponentButton);
      return;
    }
    if (target.closest('[data-modal-action="reusable-definition-open-flavors"]')) {
      openReusableFlavorManager('browse');
      return;
    }
    if (target.closest('[data-modal-action="reusable-definition-add-flavor"]')) {
      openReusableFlavorManager('create');
      return;
    }
    if (target.closest('[data-modal-action="reusable-definition-flavor-manager-close"]')) {
      closeReusableFlavorManager();
      return;
    }
    if (target.closest('[data-modal-action="reusable-definition-flavor-manager-create"]')) {
      createReusableDefinitionFlavorFromManager();
      return;
    }
    if (target.closest('[data-modal-action="reusable-definition-flavor-manager-edit"]')) {
      editReusableDefinitionFlavorFromManager();
      return;
    }
    if (target.closest('[data-modal-action="reusable-definition-flavor-manager-main"]')) {
      editMainReusableDefinitionFromManager();
      return;
    }
    if (target.closest('[data-modal-action="reusable-definition-flavor-remove"]')) {
      mutateActiveFlavor('remove');
      return;
    }
    if (target.closest('[data-modal-action="reusable-definition-flavor-left"]')) {
      mutateActiveFlavor('left');
      return;
    }
    if (target.closest('[data-modal-action="reusable-definition-flavor-right"]')) {
      mutateActiveFlavor('right');
      return;
    }
    const unmarkVariable = target.closest<HTMLElement>('[data-modal-action="reusable-definition-variable-unmark"]');
    if (unmarkVariable) {
      unmarkBuilderTemplateVariable(
        unmarkVariable.dataset.variableName ?? '',
        Number.parseInt(unmarkVariable.dataset.occurrenceIndex ?? '0', 10)
      );
      return;
    }
    const findVariable = target.closest<HTMLElement>('[data-modal-action="reusable-definition-variable-find"]');
    if (findVariable) {
      findBuilderTemplateVariableOccurrence(
        findVariable.dataset.variableName ?? '',
        Number.parseInt(findVariable.dataset.occurrenceIndex ?? '0', 10)
      );
      return;
    }

    const templateGeneratorBtn = target.closest<HTMLButtonElement>('[data-modal-action="run-template-generator"]');
    if (templateGeneratorBtn && state.reusableTemplateModal) {
      void runReusableTemplateGenerator(modalRoot, templateGeneratorBtn);
      return;
    }

    const chooseSectionFlavorBtn = target.closest<HTMLElement>('[data-modal-action="choose-section-template-flavor"]');
    if (chooseSectionFlavorBtn && state.sectionTemplateFlavorModal) {
      const templateName = chooseSectionFlavorBtn.dataset.sectionTemplateName ?? state.sectionTemplateFlavorModal.templateName;
      const flavorName = chooseSectionFlavorBtn.dataset.sectionTemplateFlavor ?? '';
      const location = state.sectionTemplateFlavorModal.location ?? 'main';
      closeModal();
      insertTopLevelSection(templateName, flavorName, location);
      return;
    }

    const pdfTemplateExportBtn = target.closest<HTMLButtonElement>('[data-modal-action="pdf-template-import-export"]');
    if (pdfTemplateExportBtn && state.pdfTemplateImportModal) {
      const fileInput = modalRoot.querySelector<HTMLInputElement>('#pdfTemplateFileInput');
      const file = fileInput?.files?.[0] ?? null;
      if (!file) {
        state.pdfTemplateImportModal = {
          ...state.pdfTemplateImportModal,
          error: 'Choose a PHVY template before exporting.',
        };
        getRenderApp()();
        return;
      }
      if (!file.name.toLowerCase().endsWith('.phvy')) {
        state.pdfTemplateImportModal = {
          ...state.pdfTemplateImportModal,
          error: 'Choose a .phvy template file.',
        };
        getRenderApp()();
        return;
      }
      state.pdfTemplateImportModal = {
        ...state.pdfTemplateImportModal,
        isRunning: true,
        status: `Reading ${file.name}.`,
        error: null,
        steps: state.pdfTemplateImportModal.steps.map((step) => step.id === 'read' ? { ...step, status: 'running' } : step),
      };
      getRenderApp()();
      void file.arrayBuffer()
        .then((buffer) => {
          if (state.pdfTemplateImportModal) {
            state.pdfTemplateImportModal = {
              ...state.pdfTemplateImportModal,
              steps: state.pdfTemplateImportModal.steps.map((step) => step.id === 'read' ? { ...step, status: 'complete' } : step),
            };
            getRenderApp()();
          }
          return exportCurrentDocumentPdfWithTemplateBytes(new Uint8Array(buffer), file.name);
        })
        .then(() => {
          closeModal();
          getRenderApp()();
        })
        .catch((error) => {
          const modal = state.pdfTemplateImportModal;
          state.pdfTemplateImportModal = {
            isRunning: false,
            status: null,
            error: error instanceof Error ? error.message : 'PDF template export failed.',
            steps: (modal?.steps ?? []).map((step) => step.status === 'running' ? { ...step, status: 'error' } : step),
            totalTokenUsage: modal?.totalTokenUsage ?? {},
            awaitingLlmStep: false,
            awaitingLlmStepId: null,
            requestLog: modal?.requestLog ?? [],
          };
          getRenderApp()();
        });
      return;
    }

    const pdfTemplateNextLlmBtn = target.closest<HTMLButtonElement>('[data-modal-action="pdf-template-import-next-llm"]');
    if (pdfTemplateNextLlmBtn && state.pdfTemplateImportModal) {
      runNextPdfTemplateImportLlmStep();
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

    const saveDbTableRowComponentBtn = target.closest<HTMLElement>('[data-modal-action="db-table-row-component-save"]');
    if (saveDbTableRowComponentBtn && state.dbTableRowComponentModal) {
      const modal = state.dbTableRowComponentModal;
      const nextSerialized = modal.mode === 'raw' ? modal.rawDraft.trim() : modal.blocks.map((block) => serializeBlockFragment(block)).join('\n\n');
      if (nextSerialized.length === 0) {
        state.dbTableRowComponentModal = {
          ...modal,
          error: 'Add at least one component before saving this row attachment.',
        };
        getRenderApp()();
        return;
      }
      recordHistory(`db-table-row-component:${modal.tableName}:${modal.rowId}`);
      void loadDbTableRuntime()
        .then(({ setDbTableRowComponent }) => setDbTableRowComponent(modal.tableName, modal.rowId, nextSerialized))
        .then(() => {
          closeModal();
          getRenderApp()();
        })
        .catch((error) => {
          state.dbTableRowComponentModal = {
            ...modal,
            error: error instanceof Error ? error.message : 'Failed to save attached component.',
          };
          getRenderApp()();
        });
      return;
    }

    const dbTableRowComponentModeBtn = target.closest<HTMLElement>('[data-modal-action="db-table-row-component-mode"]');
    if (dbTableRowComponentModeBtn && state.dbTableRowComponentModal) {
      const modal = state.dbTableRowComponentModal;
      const nextMode = dbTableRowComponentModeBtn.dataset.modalMode;
      if (nextMode !== 'basic' && nextMode !== 'advanced' && nextMode !== 'raw') {
        return;
      }
      if (nextMode === modal.mode) {
        return;
      }

      if (modal.mode === 'raw' && nextMode !== 'raw') {
        try {
          const parsedBlocks = parseAttachedComponentBlocks(modal.rawDraft);
          state.dbTableRowComponentModal = {
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
          state.dbTableRowComponentModal = {
            ...modal,
            error: error instanceof Error ? error.message : 'Attached HVY is invalid.',
          };
        }
        getRenderApp()();
        return;
      }

      state.dbTableRowComponentModal = {
        ...modal,
        mode: nextMode,
        rawDraft: nextMode === 'raw' ? modal.blocks.map((block) => serializeBlockFragment(block)).join('\n\n') : modal.rawDraft,
        error: null,
      };
      getRenderApp()();
      return;
    }

    const clearDbTableRowComponentBtn = target.closest<HTMLElement>('[data-modal-action="db-table-row-component-clear"]');
    if (clearDbTableRowComponentBtn && state.dbTableRowComponentModal) {
      const modal = state.dbTableRowComponentModal;
      recordHistory(`db-table-row-component-clear:${modal.tableName}:${modal.rowId}`);
      void loadDbTableRuntime()
        .then(({ setDbTableRowComponent }) => setDbTableRowComponent(modal.tableName, modal.rowId, ''))
        .then(() => {
          closeModal();
          getRenderApp()();
        })
        .catch((error) => {
          state.dbTableRowComponentModal = {
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

  setupReusableTemplateGeneratorControls(modalRoot);
  setupReusableDefinitionBuilderControls(modalRoot);

  const cssInput = modalRoot.querySelector<HTMLTextAreaElement>('#modalCssInput');
  const dbTableRowComponentRawInput = modalRoot.querySelector<HTMLTextAreaElement>('#dbTableRowComponentRawInput');
  const dbTableQueryInput = modalRoot.querySelector<HTMLTextAreaElement>('#dbTableQueryInput');
  const dbTableQueryDynamicWindowInput = modalRoot.querySelector<HTMLInputElement>('#dbTableQueryDynamicWindowInput');
  const dbTableQueryLimitInput = modalRoot.querySelector<HTMLInputElement>('#dbTableQueryLimitInput');


  if (dbTableRowComponentRawInput && state.dbTableRowComponentModal) {
    dbTableRowComponentRawInput.addEventListener('input', () => {
      if (!state.dbTableRowComponentModal) {
        return;
      }
      state.dbTableRowComponentModal = {
        ...state.dbTableRowComponentModal,
        rawDraft: dbTableRowComponentRawInput.value,
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

async function changeEncryptionKeyFromModal(modalRoot: HTMLDivElement, actionButton: HTMLButtonElement): Promise<void> {
  const modal = state.encryptionModal;
  if (!modal) return;
  setEncryptionModalBusy(modalRoot, actionButton);
  try {
    recordHistory(`component:${modal.blockId}:change-encryption-key`);
    const result = await changeEncryptedComponentKeyInDocument(state.document, modal.sectionKey, modal.blockId, state.encryption ?? null);
    closeModal();
    showTransientNotice(`Changed encryption key to ${result.keyId}.`);
    getRenderApp()();
  } catch (error) {
    showTransientNotice(error instanceof Error ? error.message : 'Encryption key could not be changed.');
    getRenderApp()();
  }
}

async function generateEncryptionFromModal(modalRoot: HTMLDivElement, actionButton: HTMLButtonElement): Promise<void> {
  const modal = state.encryptionModal;
  if (!modal) return;
  setEncryptionModalBusy(modalRoot, actionButton);
  try {
    recordHistory(`component:${modal.blockId}:encrypt`);
    if (!state.encryption) state.encryption = { keyring: {} };
    const result = await encryptComponentInDocument(state.document, modal.sectionKey, modal.blockId, state.encryption);
    closeModal();
    setActiveEditorBlock(modal.sectionKey, result.encryptedBlockId);
    showTransientNotice(`Encrypted component with key ${result.keyId}.`);
    getRenderApp()();
  } catch (error) {
    showTransientNotice(error instanceof Error ? error.message : 'Component could not be encrypted.');
    getRenderApp()();
  }
}

async function removeEncryptionFromModal(modalRoot: HTMLDivElement, actionButton: HTMLButtonElement): Promise<void> {
  const modal = state.encryptionModal;
  if (!modal) return;
  const encrypted = findBlockByIds(modal.sectionKey, modal.blockId);
  const decryptedBlockId = encrypted?.schema.kind === 'encrypted' ? encrypted.schema.encryptedBlock?.id ?? '' : '';
  setEncryptionModalBusy(modalRoot, actionButton);
  try {
    recordHistory(`component:${modal.blockId}:remove-encryption`);
    await decryptComponentInDocument(state.document, modal.sectionKey, modal.blockId, state.encryption ?? null);
    closeModal();
    if (decryptedBlockId) setActiveEditorBlock(modal.sectionKey, decryptedBlockId);
    showTransientNotice('Removed component encryption.');
    getRenderApp()();
  } catch (error) {
    showTransientNotice(error instanceof Error ? error.message : 'Encryption could not be removed.');
    getRenderApp()();
  }
}

function setEncryptionModalBusy(modalRoot: HTMLDivElement, actionButton: HTMLButtonElement): void {
  modalRoot.querySelectorAll<HTMLButtonElement>('button').forEach((button) => { button.disabled = true; });
  actionButton.textContent = 'Working…';
}

function setupReusableTemplateGeneratorControls(modalRoot: HTMLDivElement): void {
  if (!state.reusableTemplateModal) {
    return;
  }
  updateReusableTemplateGeneratorButtons(modalRoot);
  modalRoot.addEventListener('input', (event) => {
    const target = event.target as HTMLElement;
    if (!target.dataset.templateVariable) {
      return;
    }
    updateReusableTemplateGeneratorButtons(modalRoot);
  });
}

function getActiveReusableDefinition(): { definition: any; flavor: any | null; template: any } | null {
  const modal = state.reusableDefinitionEditModal;
  if (!modal) return null;
  const definition = modal.kind === 'component'
    ? getComponentDefsFromMeta(state.document.meta)[modal.index]
    : getSectionDefsFromMeta(state.document.meta)[modal.index];
  if (!definition) return null;
  const flavor = modal.activeFlavorIndex == null ? null : definition.flavors?.[modal.activeFlavorIndex] ?? null;
  return {
    definition,
    flavor,
    template: flavor?.template ?? definition.template,
  };
}

function setupReusableDefinitionBuilderControls(modalRoot: HTMLDivElement): void {
  if (!state.reusableDefinitionEditModal) return;
  const nameInput = modalRoot.querySelector<HTMLInputElement>('[data-field="builder-definition-name"]');
  nameInput?.addEventListener('input', () => {
    if (state.reusableDefinitionEditModal) state.reusableDefinitionEditModal.draftName = nameInput.value;
  });

  const flavorManagerPicker = modalRoot.querySelector<HTMLSelectElement>('[data-field="builder-flavor-manager-picker"]');
  flavorManagerPicker?.addEventListener('change', () => {
    const modal = state.reusableDefinitionEditModal;
    if (!modal?.flavorManager) return;
    if (flavorManagerPicker.value === 'new') {
      openReusableFlavorManager('create');
      return;
    }
    modal.flavorManager.selectedIndex = Number.parseInt(flavorManagerPicker.value, 10);
    getRenderApp()();
  });
  const flavorCreatorName = modalRoot.querySelector<HTMLInputElement>('[data-field="builder-flavor-creator-name"]');
  flavorCreatorName?.addEventListener('input', () => {
    const manager = state.reusableDefinitionEditModal?.flavorManager;
    if (!manager) return;
    manager.draftName = flavorCreatorName.value;
    manager.error = null;
  });
  const flavorCreatorDescription = modalRoot.querySelector<HTMLTextAreaElement>('[data-field="builder-flavor-creator-description"]');
  flavorCreatorDescription?.addEventListener('input', () => {
    const manager = state.reusableDefinitionEditModal?.flavorManager;
    if (!manager) return;
    manager.draftDescription = flavorCreatorDescription.value;
  });

  const flavorName = modalRoot.querySelector<HTMLInputElement>('[data-field="builder-flavor-name"]');
  flavorName?.addEventListener('input', () => {
    const active = getActiveReusableDefinition();
    if (active?.flavor) active.flavor.name = flavorName.value;
  });
  const flavorDescription = modalRoot.querySelector<HTMLInputElement>('[data-field="builder-flavor-description"]');
  flavorDescription?.addEventListener('input', () => {
    const active = getActiveReusableDefinition();
    if (active?.flavor) active.flavor.description = flavorDescription.value;
  });

  modalRoot.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-variable-name]').forEach((control) => {
    const field = control.dataset.field;
    if (field === 'builder-template-variable-name') {
      control.addEventListener('change', () => renameBuilderTemplateVariable(control as HTMLInputElement));
      return;
    }
    if (field === 'builder-template-variable-type') {
      control.addEventListener('change', () => {
        const active = getActiveReusableDefinition();
        const name = control.dataset.variableName ?? '';
        if (!active || !name || (control.value !== 'text' && control.value !== 'block')) return;
        setReusableTemplateVariableType(active.template, name, control.value);
        getRenderApp()();
      });
      return;
    }
    control.addEventListener('input', () => {
      const active = getActiveReusableDefinition();
      const name = control.dataset.variableName ?? '';
      if (!active || !name) return;
      const owner = active.flavor ?? active.definition;
      owner.templateVariables = owner.templateVariables ?? {};
      const config = owner.templateVariables[name] ?? {};
      if (field === 'builder-template-variable-label') config.label = control.value;
      if (field === 'builder-template-variable-generator-label') {
        if (control.value) config.generatorLabel = control.value;
        else delete config.generatorLabel;
      }
      if (field === 'builder-template-variable-generator') {
        if (control.value) config.generator = control.value;
        else delete config.generator;
      }
      owner.templateVariables[name] = config;
    });
  });
  modalRoot.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea').forEach((control) => {
    if (control.closest('.reusable-template-variable-panel') || control.dataset.field === 'builder-definition-name') return;
    control.addEventListener('select', () => showBuilderInputUseAs(control));
    control.addEventListener('mouseup', () => showBuilderInputUseAs(control));
    control.addEventListener('keyup', () => showBuilderInputUseAs(control));
  });
}

function showBuilderInputUseAs(control: HTMLInputElement | HTMLTextAreaElement): void {
  const start = control.selectionStart ?? 0;
  const end = control.selectionEnd ?? start;
  const selected = control.value.slice(start, end).trim();
  control.parentElement?.querySelector(':scope > .builder-input-use-as')?.remove();
  if (!selected) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ghost builder-input-use-as';
  button.textContent = 'Use as template value';
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', () => {
    const active = getActiveReusableDefinition();
    const modal = state.reusableDefinitionEditModal;
    if (!active || !modal) return;
    const variables = modal.kind === 'component'
      ? active.flavor ? extractReusableTemplateVariablesFromFlavor(active.flavor, active.definition.templateVariables) : extractReusableTemplateVariablesFromDefinition(active.definition)
      : active.flavor ? extractReusableTemplateVariablesFromSectionFlavor(active.flavor, active.definition.templateVariables) : extractReusableTemplateVariablesFromSectionDefinition(active.definition);
    const name = createReusableTemplateVariableName(selected, variables.map((variable) => variable.name));
    const type = /\r|\n/.test(control.value.slice(start, end)) ? 'block' : 'text';
    const token = `{% ${name} | ${type} %}`;
    control.value = `${control.value.slice(0, start)}${token}${control.value.slice(end)}`;
    const owner = active.flavor ?? active.definition;
    owner.templateVariables = owner.templateVariables ?? {};
    owner.templateVariables[name] = { label: selected.replace(/\s+/g, ' ') };
    control.dispatchEvent(new InputEvent('input', { bubbles: true }));
    getRenderApp()();
  });
  control.insertAdjacentElement('afterend', button);
}

function renameBuilderTemplateVariable(input: HTMLInputElement): void {
  const active = getActiveReusableDefinition();
  const oldName = input.dataset.variableName ?? '';
  const newName = input.value.trim();
  if (!active || !oldName || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(newName)) {
    input.value = oldName;
    return;
  }
  const variables = state.reusableDefinitionEditModal?.kind === 'component'
    ? active.flavor ? extractReusableTemplateVariablesFromFlavor(active.flavor, active.definition.templateVariables) : extractReusableTemplateVariablesFromDefinition(active.definition)
    : active.flavor ? extractReusableTemplateVariablesFromSectionFlavor(active.flavor, active.definition.templateVariables) : extractReusableTemplateVariablesFromSectionDefinition(active.definition);
  if (variables.some((variable) => variable.name === newName && variable.name !== oldName)) {
    input.value = oldName;
    return;
  }
  renameReusableTemplateVariable(active.template, oldName, newName);
  const owner = active.flavor ?? active.definition;
  const config = owner.templateVariables?.[oldName];
  owner.templateVariables = owner.templateVariables ?? {};
  if (config) owner.templateVariables[newName] = config;
  delete owner.templateVariables[oldName];
  getRenderApp()();
}

function openReusableFlavorManager(mode: 'browse' | 'create'): void {
  const modal = state.reusableDefinitionEditModal;
  const active = getActiveReusableDefinition();
  if (!modal || !active) return;
  if (modal.draftName?.trim()) {
    applyReusableDefinitionName(active.definition, modal.draftName.trim());
    delete modal.draftName;
  }
  const flavors = active.definition.flavors ?? [];
  const selectedIndex = modal.flavorManager?.selectedIndex ?? modal.activeFlavorIndex ?? 0;
  const sourceIndex = mode === 'create'
    ? modal.flavorManager?.mode === 'browse' ? modal.flavorManager.selectedIndex : modal.activeFlavorIndex ?? null
    : selectedIndex;
  modal.flavorManager = {
    mode,
    selectedIndex: Math.max(0, Math.min(selectedIndex, flavors.length - 1)),
    sourceIndex,
    draftName: getUniqueReusableFlavorName(active.definition.name, flavors.map((flavor: { name: string }) => flavor.name)),
    draftDescription: '',
    error: null,
  };
  getRenderApp()();
}

function closeReusableFlavorManager(): void {
  const modal = state.reusableDefinitionEditModal;
  if (!modal) return;
  modal.flavorManager = null;
  getRenderApp()();
}

function editReusableDefinitionFlavorFromManager(): void {
  const modal = state.reusableDefinitionEditModal;
  if (!modal?.flavorManager) return;
  modal.activeFlavorIndex = modal.flavorManager.selectedIndex;
  modal.flavorManager = null;
  getRenderApp()();
}

function editMainReusableDefinitionFromManager(): void {
  const modal = state.reusableDefinitionEditModal;
  if (!modal) return;
  modal.activeFlavorIndex = null;
  modal.flavorManager = null;
  getRenderApp()();
}

function createReusableDefinitionFlavorFromManager(): void {
  const modal = state.reusableDefinitionEditModal;
  const active = getActiveReusableDefinition();
  const manager = modal?.flavorManager;
  if (!modal || !active || !manager || manager.mode !== 'create') return;
  const flavors = active.definition.flavors ?? [];
  const name = manager.draftName.trim();
  if (!name) {
    manager.error = 'Flavor name is required.';
    getRenderApp()();
    return;
  }
  if (name === active.definition.name || flavors.some((flavor: { name: string }) => flavor.name === name)) {
    manager.error = `A flavor named "${name}" already exists.`;
    getRenderApp()();
    return;
  }
  const sourceFlavor = manager.sourceIndex == null ? null : flavors[manager.sourceIndex] ?? null;
  const description = manager.draftDescription.trim();
  if (modal.kind === 'component') {
    const source = sourceFlavor?.template ?? active.definition.template ?? getReusableTemplate(active.definition);
    if (!source) return;
    const template = cloneReusableBlock(source);
    template.schema.component = active.definition.name;
    flavors.push({ name, ...(description ? { description } : {}), template, templateVariables: { ...(sourceFlavor?.templateVariables ?? active.definition.templateVariables ?? {}) } });
  } else {
    const source = sourceFlavor?.template ?? active.definition.template;
    if (!source) return;
    flavors.push({ name, ...(description ? { description } : {}), template: cloneReusableSection(source), templateVariables: { ...(sourceFlavor?.templateVariables ?? active.definition.templateVariables ?? {}) } });
  }
  active.definition.flavors = flavors;
  modal.activeFlavorIndex = flavors.length - 1;
  modal.flavorManager = null;
  getRenderApp()();
}

function getUniqueReusableFlavorName(templateName: string, flavorNames: string[]): string {
  const used = new Set([templateName, ...flavorNames]);
  let suffix = 2;
  let name = `${templateName} ${suffix}`;
  while (used.has(name)) {
    suffix += 1;
    name = `${templateName} ${suffix}`;
  }
  return name;
}

function addReusableDefinitionComponent(actionButton: HTMLElement): void {
  const modal = state.reusableDefinitionEditModal;
  const active = getActiveReusableDefinition();
  const component = actionButton.dataset.component?.trim() ?? '';
  if (!modal || modal.kind !== 'component' || !active || !component) return;
  if (modal.draftName?.trim()) {
    applyReusableDefinitionName(active.definition, modal.draftName.trim());
    delete modal.draftName;
  }
  const template = createEmptyBlock(component);
  if (component === 'plugin' && actionButton.dataset.pluginId) {
    configurePluginBlock(template, actionButton.dataset.pluginId);
  }
  template.schema.component = active.definition.name;
  active.definition.baseType = template.schema.kind;
  if (active.flavor) {
    active.flavor.template = template;
    active.flavor.schema = undefined;
  } else {
    active.definition.template = template;
    active.definition.schema = undefined;
  }
  const sectionKey = `__reusable__:${active.definition.name}${modal.activeFlavorIndex == null ? '' : `:flavor:${modal.activeFlavorIndex}`}`;
  setActiveEditorBlock(sectionKey, template.id);
  markActiveEditorBlockAsNew(template.id);
  getRenderApp()();
}

function mutateActiveFlavor(action: 'remove' | 'left' | 'right'): void {
  const modal = state.reusableDefinitionEditModal;
  const active = getActiveReusableDefinition();
  const index = modal?.activeFlavorIndex;
  const flavors = active?.definition.flavors;
  if (!modal || index == null || !flavors?.[index]) return;
  if (action === 'remove') {
    flavors.splice(index, 1);
    modal.activeFlavorIndex = flavors[index] ? index : flavors[index - 1] ? index - 1 : null;
  } else {
    const nextIndex = action === 'left' ? index - 1 : index + 1;
    if (!flavors[nextIndex]) return;
    [flavors[index], flavors[nextIndex]] = [flavors[nextIndex], flavors[index]];
    modal.activeFlavorIndex = nextIndex;
  }
  getRenderApp()();
}

function unmarkBuilderTemplateVariable(name: string, occurrenceIndex: number): void {
  const active = getActiveReusableDefinition();
  if (!active || !name) return;
  const owner = active.flavor ?? active.definition;
  const label = owner.templateVariables?.[name]?.label ?? name;
  replaceReusableTemplateVariableOccurrenceWithText(active.template, name, occurrenceIndex, label);
  const remainingVariables = state.reusableDefinitionEditModal?.kind === 'component'
    ? active.flavor ? extractReusableTemplateVariablesFromFlavor(active.flavor, active.definition.templateVariables) : extractReusableTemplateVariablesFromDefinition(active.definition)
    : active.flavor ? extractReusableTemplateVariablesFromSectionFlavor(active.flavor, active.definition.templateVariables) : extractReusableTemplateVariablesFromSectionDefinition(active.definition);
  if (!remainingVariables.some((variable) => variable.name === name) && owner.templateVariables) delete owner.templateVariables[name];
  getRenderApp()();
}

function findBuilderTemplateVariableOccurrence(name: string, occurrenceIndex: number): void {
  const matches = Array.from(document.querySelectorAll<HTMLElement>('.reusable-definition-modal .template-value-token'))
    .filter((marker) => marker.dataset.templateValueToken === name);
  const marker = matches[occurrenceIndex];
  if (!marker) return;
  marker.focus({ preventScroll: true });
  marker.scrollIntoView({ block: 'center', behavior: 'smooth' });
  marker.classList.remove('is-found');
  requestAnimationFrame(() => marker.classList.add('is-found'));
}

function cancelReusableDefinitionModal(): void {
  const modal = state.reusableDefinitionEditModal;
  if (!modal) return;
  const defs = modal.kind === 'component'
    ? getComponentDefsFromMeta(state.document.meta)
    : getSectionDefsFromMeta(state.document.meta);
  if (modal.isNew) {
    defs.splice(modal.index, 1);
  } else if (modal.originalRaw) {
    defs[modal.index] = parseYaml(modal.originalRaw) as never;
  }
  if (modal.kind === 'component') state.document.meta.component_defs = defs;
  else state.document.meta.section_defs = defs;
  restoreReusableDefinitionHistory(modal);
  clearActiveEditorBlock();
  closeReusableDefinitionBuilder();
  getRenderApp()();
  getRefreshReaderPanels()();
}

function saveReusableDefinitionModalAndClose(): void {
  const modal = state.reusableDefinitionEditModal;
  if (!modal) {
    return;
  }
  const active = getActiveReusableDefinition();
  if (active && modal.draftName?.trim()) {
    applyReusableDefinitionName(active.definition, modal.draftName.trim());
    delete modal.draftName;
  }
  if (!active || !active.definition.name?.trim()) {
    state.reusableDefinitionEditModal = { ...modal, error: 'Template definition needs a name.' };
    getRenderApp()();
    return;
  }
  const definitions = modal.kind === 'component'
    ? getComponentDefsFromMeta(state.document.meta)
    : getSectionDefsFromMeta(state.document.meta);
  if (definitions.some((definition, index) => index !== modal.index && definition.name === active.definition.name)) {
    state.reusableDefinitionEditModal = { ...modal, error: `A template named "${active.definition.name}" already exists.` };
    getRenderApp()();
    return;
  }
  const flavorNames = (active.definition.flavors ?? []).map((flavor: { name: string }) => flavor.name.trim());
  if (flavorNames.some((name: string) => !name)) {
    state.reusableDefinitionEditModal = { ...modal, error: 'Every flavor needs a name.' };
    getRenderApp()();
    return;
  }
  const allNames = [active.definition.name, ...flavorNames];
  if (new Set(allNames).size !== allNames.length) {
    state.reusableDefinitionEditModal = { ...modal, error: 'Template and flavor names must be unique.' };
    getRenderApp()();
    return;
  }
  try {
    if (modal.kind === 'component') {
      if (!active.definition.template) {
        throw new Error('Add a component before saving the template.');
      }
      if (active.definition.flavors?.some((flavor: any) => !flavor.template)) {
        throw new Error('Every flavor needs a component before saving.');
      }
      active.definition.baseType = active.definition.template.schema.kind;
      extractReusableTemplateVariablesFromDefinition(active.definition);
      active.definition.flavors?.forEach((flavor: any) => extractReusableTemplateVariablesFromFlavor(flavor, active.definition.templateVariables));
    } else {
      extractReusableTemplateVariablesFromSectionDefinition(active.definition);
      active.definition.flavors?.forEach((flavor: any) => extractReusableTemplateVariablesFromSectionFlavor(flavor));
    }
  } catch (error) {
    state.reusableDefinitionEditModal = {
      ...modal,
      error: error instanceof Error ? error.message : 'Template values are invalid.',
    };
    getRenderApp()();
    return;
  }
  clearActiveEditorBlock();
  closeReusableDefinitionBuilder();
  getRenderApp()();
  restoreReusableDefinitionHistory(modal);
  recordHistory();
  getRefreshReaderPanels()();
}

function applyReusableDefinitionName(definition: any, name: string): void {
  definition.name = name;
  if (state.reusableDefinitionEditModal?.kind !== 'component') return;
  if (definition.template) definition.template.schema.component = name;
  definition.flavors?.forEach((flavor: any) => {
    if (flavor.template) flavor.template.schema.component = name;
  });
}

function closeReusableDefinitionBuilder(): void {
  state.reusableDefinitionEditModal = null;
  state.modalSectionKey = null;
  state.componentMetaModal = null;
}

function restoreReusableDefinitionHistory(modal: NonNullable<typeof state.reusableDefinitionEditModal>): void {
  if (!modal.historyBeforeDraft) return;
  state.history = [...modal.historyBeforeDraft.history];
  state.future = [...modal.historyBeforeDraft.future];
}

function updateReusableTemplateGeneratorButtons(modalRoot: HTMLDivElement): void {
  modalRoot.querySelectorAll<HTMLButtonElement>('[data-modal-action="run-template-generator"]').forEach((button) => {
    const targetVariable = button.dataset.templateVariableTarget ?? '';
    const targetInput = targetVariable ? getTemplateInput(modalRoot, targetVariable) : null;
    const hasTargetValue = (targetInput?.value ?? '').trim().length > 0;
    button.hidden = hasTargetValue;
    const requiredVariables = parseRequiredVariables(button.dataset.requiredVariables ?? '');
    button.disabled = hasTargetValue || requiredVariables.some((key) => getTemplateInputValue(modalRoot, key).trim().length === 0) || button.dataset.busyState === 'busy';
  });
}

async function runReusableTemplateGenerator(modalRoot: HTMLDivElement, button: HTMLButtonElement): Promise<void> {
  const modal = state.reusableTemplateModal;
  const generatorKey = button.dataset.templateGenerator ?? '';
  const targetVariable = button.dataset.templateVariableTarget ?? '';
  const generator = getOutputGenerator(generatorKey);
  if (!modal || !generator || !targetVariable || button.disabled) {
    return;
  }
  const variable = extractReusableTemplateVariablesFromDefinition(
    getComponentDefsFromMeta(state.document.meta).find((item) => item.name === modal.component)
  ).find((item) => item.name === targetVariable);
  const outputInput = getTemplateInput(modalRoot, targetVariable);
  if (!variable || !outputInput) {
    return;
  }

  const status = modalRoot.querySelector<HTMLElement>(`[data-template-generator-status="${cssEscape(targetVariable)}"]`);
  const setStatus = (message: string, error = false) => {
    if (!status) {
      return;
    }
    status.textContent = message;
    status.classList.toggle('is-error', error);
  };

  button.dataset.busyState = 'busy';
  const idleLabel = button.textContent ?? 'Generate';
  button.dataset.idleLabel = idleLabel;
  button.textContent = 'Generating...';
  button.disabled = true;
  outputInput.disabled = true;
  setStatus('Generating...');
  try {
    const response = await generator.generate({
      document: state.document,
      component: modal.component,
      variable: variable.name,
      variableType: variable.type,
      label: variable.label,
      values: collectProvidedTemplateValues(modalRoot),
      target: modal.target,
    });
    const output = await resolveOutputGeneratorResponse({
      response,
      settings: state.chat.settings,
    });
    outputInput.value = output;
    outputInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
    setStatus('Done.');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Generation failed.', true);
  } finally {
    button.dataset.busyState = 'idle';
    button.textContent = button.dataset.idleLabel ?? 'Generate';
    delete button.dataset.idleLabel;
    outputInput.disabled = false;
    updateReusableTemplateGeneratorButtons(modalRoot);
  }
}

function collectProvidedTemplateValues(modalRoot: HTMLDivElement): Record<string, string> {
  const values: Record<string, string> = {};
  modalRoot.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('[data-template-variable]').forEach((input) => {
    const key = input.dataset.templateVariable;
    const value = input.value.trim();
    if (key && value.length > 0) {
      values[key] = value;
    }
  });
  return values;
}

function getTemplateInput(modalRoot: HTMLDivElement, key: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null {
  return modalRoot.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[data-template-variable="${cssEscape(key)}"]`);
}

function getTemplateInputValue(modalRoot: HTMLDivElement, key: string): string {
  return getTemplateInput(modalRoot, key)?.value ?? '';
}

function parseRequiredVariables(raw: string): string[] {
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(value)
    : value.replace(/["\\]/g, '\\$&');
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
    console.error('[hvy:template] failed to insert component template from template modal', error);
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
  if (state.currentView !== 'ai') {
    setActiveEditorBlock(target.sectionKey, newBlock.id, { targetOnly: target.kind !== 'section' });
    markActiveEditorBlockAsNew(newBlock.id);
  }
  closeModal();
  getRenderApp()();
}
