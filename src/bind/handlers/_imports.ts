export { state, appEventsBound, setAppEventsBound, shortcutsBound, setShortcutsBound, setDraggedSectionKey, setDraggedTableItem, draggedSectionKey, draggedTableItem, incrementInputEventCount, getRenderApp, getRefreshReaderPanels } from '../../state';
export { commitTagEditorDraft, handleRemoveTag, handleTagEditorInput, handleTagEditorKeydown } from '../../editor/tag-editor';
export { getThemeConfig, applyTheme, writeThemeConfig, colorValueToAlpha, colorValueToPickerHex, getResolvedThemeColor, getThemeResetColor, mergeAlphaIntoCssColor } from '../../theme';
export { assignSectionTitleAndGeneratedId, findSectionByKey, getSectionId, isDefaultUntitledSectionTitle, moveSectionRelative, moveSectionByOffset, removeSectionByKey, findBlockContainerById, findBlockContainerInList, makeBlockSubsection, removeSubsection } from '../../section-ops';
export { getComponentDefs, getSectionDefs, getReusableNameFromSectionKey, isBuiltinComponent } from '../../component-defs';
export { findBlockByIds, resolveBlockContext, handleBlockFieldInput, commitInlineTableEdit, setActiveEditorBlock, setAiEditorHostBlock, clearActiveEditorBlock, deactivateEditorBlock, cancelEditorBlockEdit, applyRichAction, completePendingRichAnnotation, handleRichEditorClick, handleRichEditorKeydown, handleRichEditorKeyup, handleRichEditorBeforeInput, handleRichEditorCopy, handleRichEditorPlainTextPaste, refreshRichToolbarState, moveBlockByOffset, getTagState, setTagState, getTagRenderOptions, removeBlockFromList, findBlockInList } from '../../block-ops';
export { createEmptyBlock, createEmptySection, createDefaultTableRow, instantiateReusableSection, ensureContainerBlocks, ensureComponentListBlocks, ensureExpandableBlocks, ensureGridItems, coerceAlign, getReusableTemplateByName } from '../../document-factory';
export { recordHistory, undoState, redoState } from '../../history';
export { setSidebarOpen, setEditorSidebarOpen, closeModal, closeModalIfTarget, navigateToSection, resetTransientUiState } from '../../navigation';
export { deserializeDocument, serializeDocument } from '../../serialization';
export { saveSessionState } from '../../state-persistence';
export { syncReusableTemplateForBlock, revertReusableComponent, findReusableOwner } from '../../reusable';
export { addTableColumn, removeTableColumn, getTableColumns, moveTableColumn, moveTableRow } from '../../table-ops';
export { createGridItem } from '../../grid-ops';
export { detectExtension, sanitizeOptionalId, moveItem } from '../../utils';
export { openLinkInlineModal } from '../../bind-link-modal';
export { clearChatConversation, ENABLE_CHAT_CLI_SIM, getDefaultModelForProvider, persistChatSettings } from '../../chat/chat';
export { appendUserChatMessage, buildDocumentEditCliSimRequest, copyChatMessageToHvySection, requestChatTurn, requestDocumentEditChatTurn } from '../../chat/chat-session';
export { areTablesEnabled } from '../../reference-config';
export { handleDbTableFrameScroll, toggleDbTableSort } from '../../plugins/db-table-model';
export { parseAttachedComponentBlocks } from '../../plugins/db-table-fragment';
export { openAiEditPopover, closeAiEditPopover, submitAiEditRequest } from '../../ai-edit-popover';
export { handleInlineCheckboxBackspace } from '../../editor/inline-checkbox';
export { getRawEditorDiagnostics } from '../../raw-editor-diagnostics';
export { applyImagePreset, handleImageUpload, useExistingImageAttachment } from '../../editor/components/image/image';
export { submitCliCommand } from '../../cli-ui/submit';
export { restoreCliViewAfterRender } from '../../cli-ui/focus';

import { getTagState, setTagState, getTagRenderOptions } from '../../block-ops';
import { parseTags } from '../../editor/tag-editor';
import { setSearchExcludeTags } from '../../search/actions';
import { state as appState } from '../../state';
export const tagStateHelpers = {
  getTagState: (target: HTMLElement) => target.dataset.field === 'search-exclude-tags-input' || target.dataset.tagField === 'search-exclude-tags'
    ? parseTags(appState.search.excludeTags ?? '')
    : getTagState(target),
  setTagState: (target: HTMLElement, tags: string[]) => {
    if (target.dataset.field === 'search-exclude-tags-input' || target.dataset.tagField === 'search-exclude-tags') {
      setSearchExcludeTags(tags);
      return;
    }
    setTagState(target, tags);
  },
  getRenderOptions: (target: HTMLElement) => target.dataset.field === 'search-exclude-tags-input' || target.dataset.tagField === 'search-exclude-tags'
    ? {}
    : getTagRenderOptions(target),
};
