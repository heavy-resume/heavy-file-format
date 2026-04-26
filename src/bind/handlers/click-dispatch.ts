import { state, getRenderApp, getRefreshReaderPanels, findSectionByKey, getSectionId, isDefaultUntitledSectionTitle, moveSectionByOffset, removeSectionByKey, findBlockContainerById, findBlockContainerInList, makeBlockSubsection, removeSubsection, getReusableNameFromSectionKey, findBlockByIds, resolveBlockContext, setActiveEditorBlock, clearActiveEditorBlock, applyRichAction, moveBlockByOffset, removeBlockFromList, findBlockInList, createEmptyBlock, createEmptySection, createDefaultTableRow, instantiateReusableSection, ensureContainerBlocks, ensureComponentListBlocks, ensureExpandableBlocks, ensureGridItems, coerceAlign, getReusableTemplateByName, recordHistory, closeModalIfTarget, navigateToSection, syncReusableTemplateForBlock, findReusableOwner, addTableColumn, removeTableColumn, getTableColumns, createGridItem, moveItem, openLinkInlineModal, areTablesEnabled, addDbTableColumn, addDbTableRow, getSqliteRowComponent, parseAttachedComponentBlocks, toggleDbTableSort, applyImagePreset } from './_imports';

export function bindClickDispatch(app: HTMLElement): void {
  app.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;

    if (target.closest('select') || target.closest('input')) {
      return;
    }

    const richButton = target.closest<HTMLElement>('[data-rich-action]');
    if (richButton) {
      event.preventDefault();
      const sectionKey = richButton.dataset.sectionKey;
      const blockId = richButton.dataset.blockId;
      const action = richButton.dataset.richAction;
      const richField = richButton.dataset.richField ?? 'block-rich';
      const gridItemId = richButton.dataset.gridItemId;
      const rowIndex = richButton.dataset.rowIndex;
      if (sectionKey && blockId && action) {
        const selectorBase = `[data-section-key="${sectionKey}"][data-block-id="${blockId}"][data-field="${richField}"]`;
        const editable = rowIndex
          ? app.querySelector<HTMLElement>(`${selectorBase}[data-row-index="${rowIndex}"]`)
          : gridItemId
          ? app.querySelector<HTMLElement>(`${selectorBase}[data-grid-item-id="${gridItemId}"]`)
          : app.querySelector<HTMLElement>(selectorBase);
        if (editable) {
          if (action === 'link') {
            openLinkInlineModal(app, editable);
            return;
          }
          editable.focus();
          applyRichAction(action, editable);
        }
      }
      return;
    }

    const actionButton = target.closest<HTMLElement>('[data-action]');
    if (!actionButton) {
      return;
    }

    const action = actionButton.dataset.action;
    const sectionKey = actionButton.dataset.sectionKey;
    const blockId = actionButton.dataset.blockId;

    if (!action) {
      return;
    }

    if (action === 'add-top-level-section') {
      recordHistory();
      const starter = state.addComponentBySection.__top_level__ ?? 'blank';
      const section = starter === 'blank' ? createEmptySection(1, '', false) : instantiateReusableSection(starter, 1);
      if (!section) {
        return;
      }
      state.document.sections.push(section);
      if (section.blocks[0]) {
        setActiveEditorBlock(section.key, section.blocks[0].id);
      } else {
        state.activeEditorSectionTitleKey = section.key;
        state.clearSectionTitleOnFocusKey = isDefaultUntitledSectionTitle(section.title) ? section.key : null;
      }
      getRenderApp()();
      return;
    }

    if (!sectionKey) {
      return;
    }

    const reusableName = getReusableNameFromSectionKey(sectionKey);
    const section = reusableName ? null : findSectionByKey(state.document.sections, sectionKey);
    if (!section && !reusableName) {
      return;
    }

    if (action === 'spawn-child-ghost') {
      if (!section || section.lock) {
        return;
      }
      recordHistory();
      const component = state.addComponentBySection[section.key] ?? 'container';
      const child = createEmptySection(Math.min(section.level + 1, 6), component, false);
      section.children.push(child);
      state.pendingEditorCenterSectionKey = child.key;
      getRenderApp()();
      return;
    }

    if (action === 'spawn-block-ghost') {
      if (!section || section.lock) {
        return;
      }
      recordHistory();
      const component = state.addComponentBySection[section.key] ?? 'container';
      const child = createEmptySection(Math.min(section.level + 1, 6), component, false);
      section.children.push(child);
      state.pendingEditorCenterSectionKey = child.key;
      getRenderApp()();
      return;
    }


    if (action === 'toggle-section-location') {
      if (!section) {
        return;
      }
      recordHistory();
      section.location = section.location === 'sidebar' ? 'main' : 'sidebar';
      getRenderApp()();
      return;
    }

    if (action === 'remove-subsection') {
      if (!section) {
        return;
      }
      recordHistory();
      if (!removeSubsection(state.document.sections, sectionKey)) {
        return;
      }
      if (state.activeEditorSectionTitleKey === sectionKey) {
        state.activeEditorSectionTitleKey = null;
      }
      if (state.activeEditorBlock?.sectionKey === sectionKey) {
        state.activeEditorBlock = null;
      }
      getRenderApp()();
      return;
    }

    if (action === 'remove-section') {
      if (!section) {
        return;
      }
      recordHistory();
      removeSectionByKey(state.document.sections, sectionKey);
      closeModalIfTarget(sectionKey);
      if (state.activeEditorSectionTitleKey === sectionKey) {
        state.activeEditorSectionTitleKey = null;
      }
      if (state.activeEditorBlock?.sectionKey === sectionKey) {
        state.activeEditorBlock = null;
      }
      getRenderApp()();
      return;
    }

    if (action === 'move-section-up') {
      if (!section) {
        return;
      }
      recordHistory();
      if (moveSectionByOffset(state.document.sections, sectionKey, -1)) {
        getRenderApp()();
      }
      return;
    }

    if (action === 'move-section-down') {
      if (!section) {
        return;
      }
      recordHistory();
      if (moveSectionByOffset(state.document.sections, sectionKey, 1)) {
        getRenderApp()();
      }
      return;
    }

    if (action === 'add-child') {
      if (!section || section.lock) {
        return;
      }
      recordHistory();
      const component = state.addComponentBySection[section.key] ?? 'container';
      const child = createEmptySection(Math.min(section.level + 1, 6), component, true);
      section.children.push(child);
      if (child.blocks[0]) {
        setActiveEditorBlock(child.key, child.blocks[0].id);
      }
      getRenderApp()();
      return;
    }

    if (action === 'add-block') {
      if (!section || section.lock) {
        return;
      }
      recordHistory();
      const component = (state.addComponentBySection[section.key] ?? 'text').trim() || 'text';
      const newBlock = createEmptyBlock(component);
      // Anchor any currently-unanchored child sections to the previous last block so
      // the new block lands at the visual bottom (where the add-component button sits)
      // rather than being inserted ahead of trailing subsections.
      const previousLastBlockId = section.blocks.length > 0 ? section.blocks[section.blocks.length - 1].id : '';
      for (const child of section.children) {
        if (child.renderAfterBlockId == null) {
          child.renderAfterBlockId = previousLastBlockId;
        }
      }
      section.blocks.push(newBlock);
      setActiveEditorBlock(section.key, newBlock.id);
      getRenderApp()();
      return;
    }

    if (action === 'add-component-list-item' && blockId) {
      recordHistory();
      const block = findBlockByIds(sectionKey, blockId);
      if (!block || block.schema.lock) {
        return;
      }
      ensureComponentListBlocks(block);
      const newBlock = createEmptyBlock(block.schema.componentListComponent || 'text');
      block.schema.componentListBlocks.push(newBlock);
      syncReusableTemplateForBlock(sectionKey, block.id);
      setActiveEditorBlock(sectionKey, newBlock.id);
      getRenderApp()();
      return;
    }

    if (action === 'add-container-block' && blockId) {
      recordHistory();
      const block = findBlockByIds(sectionKey, blockId);
      if (!block || block.schema.lock) {
        return;
      }
      ensureContainerBlocks(block);
      const addKey = `container:${sectionKey}:${blockId}`;
      const newBlock = createEmptyBlock(state.addComponentBySection[addKey] ?? 'text');
      block.schema.containerBlocks.push(newBlock);
      syncReusableTemplateForBlock(sectionKey, block.id);
      setActiveEditorBlock(sectionKey, newBlock.id);
      getRenderApp()();
      return;
    }

    if (action === 'add-expandable-stub-block' && blockId) {
      recordHistory();
      const block = findBlockByIds(sectionKey, blockId);
      if (!block || block.schema.expandableStubBlocks.lock) {
        return;
      }
      ensureExpandableBlocks(block);
      const addKey = `expandable-stub:${sectionKey}:${blockId}`;
      const newBlock = createEmptyBlock(state.addComponentBySection[addKey] ?? 'container');
      block.schema.expandableStubBlocks.children.push(newBlock);
      syncReusableTemplateForBlock(sectionKey, block.id);
      setActiveEditorBlock(sectionKey, newBlock.id);
      getRenderApp()();
      return;
    }

    if (action === 'add-expandable-content-block' && blockId) {
      recordHistory();
      const block = findBlockByIds(sectionKey, blockId);
      if (!block || block.schema.expandableContentBlocks.lock) {
        return;
      }
      ensureExpandableBlocks(block);
      const addKey = `expandable-content:${sectionKey}:${blockId}`;
      const newBlock = createEmptyBlock(state.addComponentBySection[addKey] ?? 'container');
      block.schema.expandableContentBlocks.children.push(newBlock);
      syncReusableTemplateForBlock(sectionKey, block.id);
      setActiveEditorBlock(sectionKey, newBlock.id);
      getRenderApp()();
      return;
    }

    if (action === 'toggle-schema' && blockId) {
      recordHistory();
      const block = resolveBlockContext(actionButton)?.block ?? null;
      if (!block) {
        return;
      }
      block.schemaMode = !block.schemaMode;
      getRenderApp()();
      return;
    }

    if (action === 'image-preset' && blockId) {
      const preset = actionButton.dataset.imagePreset ?? '';
      applyImagePreset(sectionKey, blockId, preset);
      return;
    }

    if (action === 'set-block-align' && blockId) {
      recordHistory();
      const block = resolveBlockContext(actionButton)?.block ?? null;
      if (!block) {
        return;
      }
      block.schema.align = coerceAlign(actionButton.dataset.alignValue ?? 'left');
      syncReusableTemplateForBlock(sectionKey, block.id);
      getRefreshReaderPanels()();
      getRenderApp()();
      return;
    }

    if (action === 'make-block-subsection' && blockId) {
      if (!section || section.lock) {
        return;
      }
      recordHistory();
      const newSub = makeBlockSubsection(state.document.sections, sectionKey, blockId);
      if (!newSub) {
        return;
      }
      const movedBlock = newSub.blocks[0];
      if (movedBlock) {
        setActiveEditorBlock(newSub.key, movedBlock.id);
      }
      getRenderApp()();
      return;
    }


    if (action === 'remove-block' && blockId) {
      recordHistory();
      const sqliteRowModal = state.sqliteRowComponentModal;
      if (sqliteRowModal?.sectionKey === sectionKey) {
        const activeBlockId = state.activeEditorBlock?.sectionKey === sectionKey
          ? (state.activeEditorBlock?.blockId ?? null)
          : null;
        const removedBlock = activeBlockId ? findBlockByIds(sectionKey, blockId) : null;
        const activeIsAffected = activeBlockId !== null && (
          activeBlockId === blockId ||
          (removedBlock !== null && findBlockInList([removedBlock], activeBlockId) !== null)
        );
        const parentId = activeIsAffected
          ? findBlockContainerInList(sqliteRowModal.blocks, blockId, null)?.ownerBlockId ?? null
          : null;
        removeBlockFromList(sqliteRowModal.blocks, blockId);
        if (activeIsAffected && activeBlockId) {
          clearActiveEditorBlock(activeBlockId);
        }
        if (parentId) {
          setActiveEditorBlock(sectionKey, parentId);
        }
        state.sqliteRowComponentModal = {
          ...sqliteRowModal,
          blocks: [...sqliteRowModal.blocks],
          error: null,
        };
        getRenderApp()();
        return;
      }
      const reusableOwnerId = findReusableOwner(sectionKey, blockId)?.id ?? null;
      // Find parent before removal so we can restore edit mode if the deleted block
      // was the active one OR contained the active one (otherwise deletion would
      // exit edit mode entirely when removing a parent while a child is active).
      const activeBlockId = state.activeEditorBlock?.sectionKey === sectionKey
        ? (state.activeEditorBlock?.blockId ?? null)
        : null;
      const removedBlock = activeBlockId ? findBlockByIds(sectionKey, blockId) : null;
      const activeIsAffected = activeBlockId !== null && (
        activeBlockId === blockId ||
        (removedBlock !== null && findBlockInList([removedBlock], activeBlockId) !== null)
      );
      const parentId = activeIsAffected
        ? findBlockContainerById(state.document.sections, sectionKey, blockId)?.ownerBlockId ?? null
        : null;
      if (section) {
        removeBlockFromList(section.blocks, blockId);
      } else {
        const template = reusableName ? getReusableTemplateByName(reusableName) : null;
        if (template) {
          removeBlockFromList([template], blockId);
        }
      }
      syncReusableTemplateForBlock(sectionKey, reusableOwnerId ?? blockId);
      if (activeIsAffected && activeBlockId) {
        clearActiveEditorBlock(activeBlockId);
      }
      if (parentId) {
        setActiveEditorBlock(sectionKey, parentId);
      }
      getRenderApp()();
      return;
    }

    if (action === 'move-block-up' && blockId) {
      recordHistory();
      const sqliteRowModal = state.sqliteRowComponentModal;
      if (sqliteRowModal?.sectionKey === sectionKey) {
        const location = findBlockContainerInList(sqliteRowModal.blocks, blockId, null);
        if (!location) {
          return;
        }
        const targetIndex = location.index - 1;
        if (targetIndex < 0) {
          return;
        }
        const [movedBlock] = location.container.splice(location.index, 1);
        if (!movedBlock) {
          return;
        }
        location.container.splice(targetIndex, 0, movedBlock);
        state.sqliteRowComponentModal = {
          ...sqliteRowModal,
          blocks: [...sqliteRowModal.blocks],
        };
        getRenderApp()();
        return;
      }
      if (moveBlockByOffset(sectionKey, blockId, -1)) {
        getRenderApp()();
      }
      return;
    }

    if (action === 'move-block-down' && blockId) {
      recordHistory();
      const sqliteRowModal = state.sqliteRowComponentModal;
      if (sqliteRowModal?.sectionKey === sectionKey) {
        const location = findBlockContainerInList(sqliteRowModal.blocks, blockId, null);
        if (!location) {
          return;
        }
        const targetIndex = location.index + 1;
        if (targetIndex >= location.container.length) {
          return;
        }
        const [movedBlock] = location.container.splice(location.index, 1);
        if (!movedBlock) {
          return;
        }
        location.container.splice(targetIndex, 0, movedBlock);
        state.sqliteRowComponentModal = {
          ...sqliteRowModal,
          blocks: [...sqliteRowModal.blocks],
        };
        getRenderApp()();
        return;
      }
      if (moveBlockByOffset(sectionKey, blockId, 1)) {
        getRenderApp()();
      }
      return;
    }

    if (action === 'add-table-row' && blockId) {
      if (!areTablesEnabled()) {
        return;
      }
      recordHistory();
      const block = resolveBlockContext(actionButton)?.block ?? findBlockByIds(sectionKey, blockId);
      if (!block) {
        return;
      }
      const columnCount = getTableColumns(block.schema).length;
      block.schema.tableRows.push(createDefaultTableRow(columnCount));
      syncReusableTemplateForBlock(sectionKey, block.id);
      setActiveEditorBlock(sectionKey, block.id);
      getRenderApp()();
      return;
    }

    if (action === 'sqlite-add-row') {
      const tableName = actionButton.dataset.tableName ?? '';
      if (tableName.length === 0) {
        return;
      }
      recordHistory(`sqlite-add-row:${tableName}`);
      void addDbTableRow(tableName)
        .then(() => {
          getRenderApp()();
        })
        .catch((error) => {
          console.error('[hvy:sqlite-plugin] add row failed', error);
        });
      return;
    }

    if (action === 'sqlite-add-column') {
      const tableName = actionButton.dataset.tableName ?? '';
      if (tableName.length === 0) {
        return;
      }
      recordHistory(`sqlite-add-column:${tableName}`);
      void addDbTableColumn(tableName)
        .then(() => {
          getRenderApp()();
        })
        .catch((error) => {
          console.error('[hvy:sqlite-plugin] add column failed', error);
        });
      return;
    }

    if (action === 'db-table-open-query-editor') {
      const targetSectionKey = sectionKey ?? '';
      const targetBlockId = blockId ?? '';
      if (targetSectionKey.length === 0 || targetBlockId.length === 0) {
        return;
      }
      const block = findBlockByIds(targetSectionKey, targetBlockId);
      if (!block) {
        return;
      }
      const pluginConfig = block.schema.pluginConfig ?? {};
      const tableName = typeof pluginConfig.table === 'string' ? pluginConfig.table : '';
      const dynamicWindow = typeof pluginConfig.queryDynamicWindow === 'boolean' ? pluginConfig.queryDynamicWindow : true;
      const rawLimit = typeof pluginConfig.queryLimit === 'number'
        ? pluginConfig.queryLimit
        : typeof pluginConfig.queryLimit === 'string'
          ? Number.parseInt(pluginConfig.queryLimit, 10)
          : NaN;
      state.dbTableQueryModal = {
        sectionKey: targetSectionKey,
        blockId: targetBlockId,
        tableName,
        draftQuery: block.text,
        dynamicWindow,
        queryLimit: Number.isFinite(rawLimit) ? Math.max(1, Math.min(Math.floor(rawLimit), 99)) : 50,
        error: null,
      };
      getRenderApp()();
      return;
    }

    if (action === 'db-table-toggle-sort') {
      const targetSectionKey = sectionKey ?? '';
      const targetBlockId = blockId ?? '';
      const columnName = actionButton.dataset.columnName ?? '';
      if (targetSectionKey.length === 0 || targetBlockId.length === 0 || columnName.length === 0) {
        return;
      }
      toggleDbTableSort(targetSectionKey, targetBlockId, columnName);
      getRenderApp()();
      return;
    }

    if (action === 'sqlite-open-row-component-editor' || action === 'sqlite-open-row-component-view') {
      const targetSectionKey = sectionKey ?? '';
      const targetBlockId = blockId ?? '';
      const tableName = actionButton.dataset.tableName ?? '';
      const rowId = Number.parseInt(actionButton.dataset.rowid ?? '', 10);
      if (tableName.length === 0 || Number.isNaN(rowId) || targetBlockId.length === 0 || targetSectionKey.length === 0) {
        return;
      }
      if (action === 'sqlite-open-row-component-view' && state.currentView === 'editor') {
        setActiveEditorBlock(targetSectionKey, targetBlockId);
        getRenderApp()();
        return;
      }

      void getSqliteRowComponent(tableName, rowId)
        .then((fragment) => {
          const modalBlocks = fragment ? parseAttachedComponentBlocks(fragment) : [];
          const rawDraft = fragment ?? '';
          const modalState = {
            sectionKey: targetSectionKey,
            blockId: targetBlockId,
            tableName,
            rowId,
            blocks: modalBlocks,
            error: null,
            readOnly: action === 'sqlite-open-row-component-view',
            previousActiveEditorBlock: state.activeEditorBlock ? { ...state.activeEditorBlock } : null,
            mode: state.editorMode,
            rawDraft,
          };
          state.sqliteRowComponentModal = modalState;
          if (!modalState.readOnly && modalBlocks[0]) {
            state.activeEditorBlock = {
              sectionKey: targetSectionKey,
              blockId: modalBlocks[0].id,
            };
          }
          getRenderApp()();
        })
        .catch((error) => {
          console.error('[hvy:sqlite-plugin] load row component failed', error);
        });
      return;
    }

    if (action === 'sqlite-row-component-add-block') {
      const modal = state.sqliteRowComponentModal;
      if (!modal || modal.readOnly) {
        return;
      }
      recordHistory(`sqlite-row-component-add:${modal.tableName}:${modal.rowId}`);
      const addKey = `sqlite-row-component:${modal.sectionKey}:${modal.rowId}`;
      const component = (state.addComponentBySection[addKey] ?? 'text').trim() || 'text';
      const newBlock = createEmptyBlock(component);
      state.sqliteRowComponentModal = {
        ...modal,
        blocks: [...modal.blocks, newBlock],
        error: null,
      };
      setActiveEditorBlock(modal.sectionKey, newBlock.id);
      getRenderApp()();
      return;
    }

    if (action === 'add-table-column' && blockId) {
      if (!areTablesEnabled()) {
        return;
      }
      recordHistory();
      const block = findBlockByIds(sectionKey, blockId);
      if (!block || block.schema.lock) {
        return;
      }
      addTableColumn(block.schema);
      syncReusableTemplateForBlock(sectionKey, block.id);
      getRenderApp()();
      return;
    }

    if (action === 'remove-table-column' && blockId) {
      if (!areTablesEnabled()) {
        return;
      }
      recordHistory();
      const columnIndex = Number.parseInt(actionButton.dataset.columnIndex ?? '', 10);
      const block = findBlockByIds(sectionKey, blockId);
      if (!block || block.schema.lock || Number.isNaN(columnIndex)) {
        return;
      }
      removeTableColumn(block.schema, columnIndex);
      syncReusableTemplateForBlock(sectionKey, block.id);
      getRenderApp()();
      return;
    }

    if (action === 'remove-table-row' && blockId) {
      if (!areTablesEnabled()) {
        return;
      }
      recordHistory();
      const rowIndex = Number.parseInt(actionButton.dataset.rowIndex ?? '', 10);
      const block = findBlockByIds(sectionKey, blockId);
      if (!block || Number.isNaN(rowIndex)) {
        return;
      }
      block.schema.tableRows.splice(rowIndex, 1);
      syncReusableTemplateForBlock(sectionKey, block.id);
      getRenderApp()();
      return;
    }

    if (action === 'focus-modal') {
      state.modalSectionKey = sectionKey;
      getRenderApp()();
      return;
    }

    if (action === 'open-component-meta' && blockId) {
      state.componentMetaModal = { sectionKey, blockId };
      getRenderApp()();
      return;
    }

    if (action === 'add-grid-item' && blockId) {
      recordHistory();
      const block = resolveBlockContext(actionButton)?.block ?? null;
      if (!block || block.schema.lock) {
        return;
      }
      ensureGridItems(block.schema);
      const item = createGridItem(block.schema.gridItems.length, block.schema.gridColumns, (c, _s) => createEmptyBlock(c, true));
      item.block = createEmptyBlock(state.gridAddComponentByBlock[blockId] ?? 'text');
      block.schema.gridItems.push(item);
      syncReusableTemplateForBlock(sectionKey, block.id);
      getRenderApp()();
      return;
    }

    if (action === 'remove-grid-item' && blockId) {
      recordHistory();
      const block = resolveBlockContext(actionButton)?.block ?? null;
      const gridItemId = actionButton.dataset.gridItemId;
      if (!block || !gridItemId) {
        return;
      }
      block.schema.gridItems = block.schema.gridItems.filter((item) => item.id !== gridItemId);
      syncReusableTemplateForBlock(sectionKey, block.id);
      ensureGridItems(block.schema);
      getRenderApp()();
      return;
    }

    if ((action === 'move-grid-item-up' || action === 'move-grid-item-down') && blockId) {
      recordHistory();
      const block = resolveBlockContext(actionButton)?.block ?? null;
      const gridItemId = actionButton.dataset.gridItemId;
      if (!block || !gridItemId) {
        return;
      }
      const currentIndex = block.schema.gridItems.findIndex((item) => item.id === gridItemId);
      if (currentIndex < 0) {
        return;
      }
      const nextIndex = action === 'move-grid-item-up' ? currentIndex - 1 : currentIndex + 1;
      if (nextIndex < 0 || nextIndex >= block.schema.gridItems.length) {
        return;
      }
      block.schema.gridItems = moveItem(block.schema.gridItems, currentIndex, nextIndex);
      syncReusableTemplateForBlock(sectionKey, block.id);
      getRenderApp()();
      return;
    }

    if (action === 'realize-ghost') {
      if (!section) {
        return;
      }
      recordHistory();
      section.isGhost = false;
      getRenderApp()();
      return;
    }

    if (action === 'jump-to-reader') {
      if (!section) {
        return;
      }
      navigateToSection(getSectionId(section), app);
    }
  });
}
