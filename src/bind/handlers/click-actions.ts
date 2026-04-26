import { state, getRenderApp, getRefreshReaderPanels, handleRemoveTag, getThemeConfig, applyTheme, writeThemeConfig, findSectionByKey, isDefaultUntitledSectionTitle, getComponentDefs, getSectionDefs, isBuiltinComponent, findBlockByIds, setActiveEditorBlock, deactivateEditorBlock, createEmptySection, recordHistory, undoState, redoState, setSidebarOpen, setEditorSidebarOpen, closeModal, resetTransientUiState, deserializeDocument, serializeDocument, revertReusableComponent, detectExtension, clearChatConversation, copyChatMessageToHvySection, closeAiEditPopover, getRawEditorDiagnostics, tagStateHelpers } from './_imports';

export function bindClickActions(app: HTMLElement): void {
  app.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const actionButton = target.closest<HTMLElement>('[data-action]');
    if (!actionButton) {
      return;
    }

    const action = actionButton.dataset.action;
    if (!action) {
      return;
    }
    const sectionKey = actionButton.dataset.sectionKey ?? '';
    const blockId = actionButton.dataset.blockId ?? '';

    if (action === 'undo') {
      undoState();
      return;
    }

    if (action === 'switch-view') {
      const requestedView = actionButton.dataset.view;
      const view = requestedView === 'viewer' ? 'viewer' : requestedView === 'ai' ? 'ai' : 'editor';
      const crossingAiBoundary = (state.currentView === 'ai') !== (view === 'ai');
      if (crossingAiBoundary) {
        clearChatConversation(state.chat);
      }
      state.currentView = view;
      if (view !== 'ai') {
        closeAiEditPopover();
      }
      getRenderApp()();
      return;
    }

    if (action === 'close-ai-edit') {
      closeAiEditPopover();
      getRenderApp()();
      return;
    }

    if (action === 'set-editor-mode') {
      const editorMode = actionButton.dataset.editorMode === 'raw'
        ? 'raw'
        : actionButton.dataset.editorMode === 'advanced'
        ? 'advanced'
        : 'basic';
      state.editorMode = editorMode;
      state.showAdvancedEditor = editorMode === 'advanced';
      if (editorMode === 'raw') {
        state.rawEditorText = serializeDocument(state.document);
        state.rawEditorError = null;
        state.rawEditorDiagnostics = [];
      }
      if (!state.showAdvancedEditor) {
        state.metaPanelOpen = false;
      }
      state.activeEditorSectionTitleKey = null;
      getRenderApp()();
      return;
    }

    if (action === 'reset-raw-editor') {
      state.rawEditorText = serializeDocument(state.document);
      state.rawEditorError = null;
      state.rawEditorDiagnostics = [];
      getRenderApp()();
      return;
    }

    if (action === 'apply-raw-editor') {
      const diagnostics = getRawEditorDiagnostics(state.rawEditorText, state.filename);
      state.rawEditorDiagnostics = diagnostics;
      if (diagnostics.length > 0) {
        state.rawEditorError = 'Resolve the raw HVY issues before applying.';
        getRenderApp()();
        return;
      }
      try {
        recordHistory('raw-editor:apply');
        const previousAttachments = state.document.attachments;
        state.document = deserializeDocument(
          state.rawEditorText,
          detectExtension(state.filename, state.rawEditorText)
        );
        for (const next of state.document.attachments) {
          if (next.bytes.length === 0) {
            const previous = previousAttachments.find((entry) => entry.id === next.id);
            if (previous) {
              next.bytes = previous.bytes;
            }
          }
        }
        state.rawEditorText = serializeDocument(state.document);
        state.rawEditorError = null;
        state.rawEditorDiagnostics = [];
        clearChatConversation(state.chat);
        closeModal();
        resetTransientUiState();
      } catch (error) {
        state.rawEditorError = error instanceof Error ? error.message : 'Failed to parse raw document.';
      }
      getRenderApp()();
      return;
    }

    if (action === 'toggle-document-meta') {
      state.metaPanelOpen = !state.metaPanelOpen;
      getRenderApp()();
      return;
    }

    if (action === 'open-theme-modal') {
      state.themeModalOpen = true;
      getRenderApp()();
      return;
    }

    if (action === 'theme-add-color') {
      recordHistory('meta:theme-color-add');
      const theme = getThemeConfig();
      let i = 1;
      let name = `color-${i}`;
      while (name in theme.colors) {
        i += 1;
        name = `color-${i}`;
      }
      theme.colors[name] = '#000000';
      writeThemeConfig(theme);
      applyTheme();
      getRenderApp()();
      return;
    }

    if (action === 'theme-remove-color') {
      const name = actionButton.dataset.colorName ?? '';
      if (!name) return;
      recordHistory(`meta:theme-color-remove:${name}`);
      const theme = getThemeConfig();
      delete theme.colors[name];
      writeThemeConfig(theme);
      applyTheme();
      getRenderApp()();
      return;
    }

    if (action === 'theme-reset-color') {
      const name = actionButton.dataset.colorName ?? '';
      if (!name) return;
      recordHistory(`meta:theme-color-reset:${name}`);
      const theme = getThemeConfig();
      delete theme.colors[name];
      writeThemeConfig(theme);
      applyTheme();
      getRenderApp()();
      return;
    }

    if (action === 'toggle-viewer-sidebar') {
      setSidebarOpen(app, !state.viewerSidebarOpen);
      return;
    }

    if (action === 'clear-chat-history') {
      clearChatConversation(state.chat);
      getRenderApp()();
      return;
    }

    if (action === 'toggle-chat-panel') {
      state.chat.panelOpen = !state.chat.panelOpen;
      getRenderApp()();
      return;
    }

    if (action === 'copy-chat-response-to-hvy') {
      const messageId = actionButton?.dataset.messageId ?? '';
      const result = copyChatMessageToHvySection({
        messages: state.chat.messages,
        messageId,
      });
      if (!result.ok) {
        state.chat.error = result.error;
        getRenderApp()();
        return;
      }
      recordHistory('chat:copy-to-hvy');
      state.document.sections.push(result.section);
      state.rawEditorText = serializeDocument(state.document);
      state.rawEditorError = null;
      state.rawEditorDiagnostics = [];
      state.chat.error = null;
      getRenderApp()();
      return;
    }

    if (action === 'toggle-editor-sidebar') {
      setEditorSidebarOpen(app, !state.editorSidebarOpen);
      return;
    }

    if (action === 'activate-block' && blockId) {
      event.stopPropagation();
      setActiveEditorBlock(sectionKey, blockId);
      getRenderApp()();
      return;
    }

    if (action === 'activate-section-title' && sectionKey) {
      event.stopPropagation();
      state.activeEditorSectionTitleKey = sectionKey;
      const section = findSectionByKey(state.document.sections, sectionKey);
      state.clearSectionTitleOnFocusKey = section && isDefaultUntitledSectionTitle(section.title) ? sectionKey : null;
      getRenderApp()();
      return;
    }

    if (action === 'deactivate-block' && blockId) {
      event.stopPropagation();
      deactivateEditorBlock(sectionKey, blockId);
      getRenderApp()();
      return;
    }

    if (action === 'toggle-editor-expandable' && sectionKey && blockId) {
      event.stopPropagation();
      const block = findBlockByIds(sectionKey, blockId);
      if (!block) {
        return;
      }
      block.schema.expandableExpanded = !block.schema.expandableExpanded;
      getRefreshReaderPanels()();
      getRenderApp()();
      return;
    }

    if (action === 'toggle-expandable-editor-panel' && sectionKey && blockId) {
      event.stopPropagation();
      const panel = actionButton.dataset.expandablePanel === 'stub' ? 'stub' : 'expanded';
      const key = `${sectionKey}:${blockId}`;
      const current = state.expandableEditorPanels[key] ?? { stubOpen: false, expandedOpen: false };
      state.expandableEditorPanels[key] = {
        ...current,
        [panel === 'stub' ? 'stubOpen' : 'expandedOpen']: !current[panel === 'stub' ? 'stubOpen' : 'expandedOpen'],
      };
      getRenderApp()();
      return;
    }

    if (action === 'redo') {
      redoState();
      return;
    }

    if (action === 'add-component-def') {
      recordHistory();
      const defs = getComponentDefs();
      defs.push({
        name: `component-${defs.length + 1}`,
        baseType: 'text',
        tags: '',
        description: '',
      });
      state.document.meta.component_defs = defs;
      getRenderApp()();
      return;
    }

    if (action === 'remove-component-def') {
      recordHistory();
      const defIndex = Number.parseInt(actionButton.dataset.defIndex ?? '', 10);
      if (Number.isNaN(defIndex)) {
        return;
      }
      const defs = getComponentDefs();
      const [removed] = defs.splice(defIndex, 1);
      if (removed) {
        revertReusableComponent(removed);
      }
      state.document.meta.component_defs = defs;
      if (state.selectedReusableComponentName === removed?.name) {
        state.selectedReusableComponentName = defs[0]?.name ?? null;
      }
      getRenderApp()();
      return;
    }

    if (action === 'remove-section-def') {
      recordHistory();
      const defIndex = Number.parseInt(actionButton.dataset.sectionDefIndex ?? '', 10);
      if (Number.isNaN(defIndex)) {
        return;
      }
      const defs = getSectionDefs();
      if (!defs[defIndex]) {
        return;
      }
      defs.splice(defIndex, 1);
      state.document.meta.section_defs = defs;
      getRenderApp()();
      return;
    }

    if (action === 'open-save-component-def') {
      const sectionKey = actionButton.dataset.sectionKey;
      const blockId = actionButton.dataset.blockId;
      if (!sectionKey || !blockId) {
        return;
      }
      const block = findBlockByIds(sectionKey, blockId);
      if (!block) {
        return;
      }
      state.reusableSaveModal = {
        kind: 'component',
        sectionKey,
        blockId,
        draftName: isBuiltinComponent(block.schema.component) ? '' : block.schema.component,
      };
      getRenderApp()();
      return;
    }

    if (action === 'open-save-section-def') {
      const sectionKey = actionButton.dataset.sectionKey;
      if (!sectionKey) {
        return;
      }
      const section = findSectionByKey(state.document.sections, sectionKey);
      if (!section) {
        return;
      }
      state.reusableSaveModal = {
        kind: 'section',
        sectionKey,
        draftName: isDefaultUntitledSectionTitle(section.title) ? '' : section.title.trim(),
      };
      getRenderApp()();
      return;
    }

    if (action === 'focus-schema-component') {
      if (target.closest('select, input, button, textarea, label')) {
        return;
      }
      const select = actionButton.querySelector<HTMLSelectElement>('[data-field="block-component"]');
      select?.focus();
      select?.click();
      return;
    }

    if (action === 'remove-tag') {
      handleRemoveTag(actionButton, tagStateHelpers);
      return;
    }

    if (action === 'add-template-field') {
      recordHistory();
      const field = actionButton.dataset.templateField;
      if (!field) {
        return;
      }
      const newSection = createEmptySection(1, 'text');
      newSection.title = field;
      if (newSection.blocks[0]) {
        newSection.blocks[0].text = `{{${field}}}`;
        setActiveEditorBlock(newSection.key, newSection.blocks[0].id);
      }
      state.document.sections.push(newSection);
      getRenderApp()();
      return;
    }

  });
}
