import { state, getRenderApp, getRefreshChatSurface, getRefreshReaderPanels, getRefreshReaderSection, getRefreshReaderBlock, recordHistory, serializeDocument, appendUserChatMessage, buildDocumentEditCliSimRequest, requestChatTurn, requestDocumentEditChatTurn, saveChatSessionState, saveSessionState, submitAiEditRequest, submitCliCommand, restoreCliViewAfterRender, ENABLE_CHAT_CLI_SIM, findBlockInList } from './_imports';
import { applySearchFilter, submitSearch } from '../../search/actions';
import type { ChatCliMutationSummary } from '../../chat-cli/chat-cli-edit-loop';
import { findBlockForVirtualDirectory, findSectionForVirtualDirectory } from '../../cli-core/virtual-file-system';
import type { HvyVirtualPathNamingState } from '../../cli-core/virtual-file-system';
import type { VisualBlock, VisualSection } from '../../editor/types';
import { recordMeasurement } from '../../perf-trace';
import { isLikelyInformationalAnswerRequest } from '../../ai-document-tool-parsing';

interface PendingDocumentEditMutation {
  requiresFullRefresh: boolean;
  paths: Set<string>;
  refreshSectionPaths: Set<string>;
  virtualPathNaming?: HvyVirtualPathNamingState;
}

export function bindSubmit(app: HTMLElement): void {
  app.addEventListener('submit', async (event) => {
    const form = event.target as HTMLElement | null;
    if (form?.id === 'searchComposer') {
      event.preventDefault();
      if (state.search.activeTab === 'filter') {
        await applySearchFilter({ enabled: true });
        return;
      }
      await submitSearch(app);
      return;
    }

    if (form?.id === 'chatComposer') {
      event.preventDefault();
      console.debug('[hvy:chat-submit] submit event', {
        isSending: state.chat.isSending,
        currentView: state.currentView,
        draftLength: state.chat.draft.length,
        trimmedDraftLength: state.chat.draft.trim().length,
        provider: state.chat.settings.provider,
        model: state.chat.settings.model,
        requestNonce: state.chat.requestNonce,
      });
      if (state.chat.isSending) {
        console.debug('[hvy:chat-submit] ignored because request is already sending');
        return;
      }

      const question = state.chat.draft.trim();
      if (question.length === 0) {
        console.debug('[hvy:chat-submit] ignored because prompt is empty');
        return;
      }

      if (state.chat.settings.model.trim().length === 0) {
        console.debug('[hvy:chat-submit] blocked because model is empty');
        state.chat.error = 'Choose a model before sending.';
        getRenderApp()();
        return;
      }

      if (state.currentView !== 'viewer' && state.chat.cliSimEnabled && ENABLE_CHAT_CLI_SIM) {
        state.chat.cliSim = {
          requestPayload: null,
          requestJson: 'Preparing...',
          responseJson: '',
          responseOutput: '',
          reasoningSummary: '',
          commandResultMessage: '',
          turnState: null,
          isPreparing: true,
          isSending: false,
          error: null,
        };
        state.chat.error = null;
        getRenderApp()();
        try {
          const result = await buildDocumentEditCliSimRequest({
            settings: state.chat.settings,
            document: state.document,
            messages: state.chat.messages,
            request: question,
          });
          state.chat.cliSim = {
            requestPayload: result.requestPayload,
            requestJson: result.requestJson,
            responseJson: '',
            responseOutput: '',
            reasoningSummary: '',
            commandResultMessage: '',
            turnState: result.turnState,
            isPreparing: false,
            isSending: false,
            error: null,
          };
        } catch (error) {
          state.chat.cliSim = {
            requestPayload: null,
            requestJson: '',
            responseJson: '',
            responseOutput: '',
            reasoningSummary: '',
            commandResultMessage: '',
            turnState: null,
            isPreparing: false,
            isSending: false,
            error: error instanceof Error ? error.message : 'Failed to prepare CLI sim.',
          };
        }
        getRenderApp()();
        return;
      }

      const previousMessages = state.chat.messages;
      const nextMessages = appendUserChatMessage(previousMessages, question);

      state.chat.messages = nextMessages;
      state.chat.draft = '';
      state.chat.error = null;
      state.chat.isSending = true;
      state.chat.requestNonce += 1;
      const requestNonce = state.chat.requestNonce;
      const abortController = new AbortController();
      state.chat.abortController = abortController;
      const isDocumentEditChat = state.currentView !== 'viewer';
      const answerDocumentEditChatAsQuestion = isDocumentEditChat && isLikelyInformationalAnswerRequest(question);
      const useDocumentEditTurn = isDocumentEditChat && !answerDocumentEditChatAsQuestion;
      state.chat.status = useDocumentEditTurn ? 'Working through the request...' : 'Waiting for answer...';
      const saveChatOrSessionState = (): void => {
        if (isDocumentEditChat) {
          saveSessionState(state);
          return;
        }
        saveChatSessionState(state);
      };
      let documentEditMutationNeedsRender = false;
      const pendingDocumentEditMutation: PendingDocumentEditMutation = {
        requiresFullRefresh: false,
        paths: new Set<string>(),
        refreshSectionPaths: new Set<string>(),
      };
      const refreshDocumentEditMutation = (): void => {
        if (!tryRefreshDocumentEditMutationBlocks(app, pendingDocumentEditMutation)) {
          getRefreshReaderPanels()({ runVisibilityScripts: false });
        }
        documentEditMutationNeedsRender = false;
        resetPendingDocumentEditMutation(pendingDocumentEditMutation);
      };
      const refreshChatOrRenderApp = (options: { documentChanged?: boolean } = {}): void => {
        if (!options.documentChanged && getRefreshChatSurface()()) {
          return;
        }
        if (options.documentChanged && isDocumentEditChat && state.currentView === 'ai') {
          refreshDocumentEditMutation();
          if (getRefreshChatSurface()()) {
            return;
          }
        }
        getRenderApp()();
      };
      const refreshChatAfterStatusChange = async (): Promise<void> => {
        refreshChatOrRenderApp();
        await waitForNextFrame();
      };
      saveChatOrSessionState();
      console.debug('[hvy:chat-submit] started request', {
        requestNonce,
        currentView: state.currentView,
        isDocumentEditChat,
        answerDocumentEditChatAsQuestion,
        sections: state.document.sections.length,
      });
      refreshChatOrRenderApp();

      try {
        console.debug('[hvy:chat-submit] dispatching chat turn', {
          requestNonce,
          mode: useDocumentEditTurn ? 'document-edit' : 'qa',
        });
        let recordedDocumentEditMutation = false;
        const recordDocumentEditMutation = (_group?: string, mutation?: ChatCliMutationSummary): void => {
          documentEditMutationNeedsRender = true;
          mergePendingDocumentEditMutation(pendingDocumentEditMutation, mutation);
          if (recordedDocumentEditMutation) {
            return;
          }
          recordedDocumentEditMutation = true;
          recordHistory(`ai-document-edit:${requestNonce}`);
        };
        const result =
          useDocumentEditTurn
            ? await requestDocumentEditChatTurn({
                settings: state.chat.settings,
                document: state.document,
                messages: previousMessages,
                request: question,
                onMutation: recordDocumentEditMutation,
                onProgress: (message) => {
                  if (requestNonce !== state.chat.requestNonce || abortController.signal.aborted) {
                    console.debug('[hvy:chat-submit] ignored stale progress', {
                      requestNonce,
                      currentNonce: state.chat.requestNonce,
                      aborted: abortController.signal.aborted,
                      content: message.content,
                    });
                    return;
                  }
                  console.debug('[hvy:chat-submit] progress', {
                    requestNonce,
                    content: message.content,
                  });
                  state.chat.messages = upsertChatProgressMessage(state.chat.messages, message);
                  saveSessionState(state);
                  refreshChatOrRenderApp({ documentChanged: documentEditMutationNeedsRender });
                },
                signal: abortController.signal,
              })
            : await requestChatTurn({
                settings: state.chat.settings,
                document: state.document,
                messages: previousMessages,
                question,
                chatContext: state.chatContext,
                chatContextProvider: state.chatContextProvider,
                chatSearchCache: state.chatSearchCache,
                embeddingProvider: state.embeddingProvider,
                allowDbQaTools: !answerDocumentEditChatAsQuestion,
                onContextPreparation: async (event) => {
                  if (requestNonce !== state.chat.requestNonce || abortController.signal.aborted) {
                    return;
                  }
                  if (event.cached) {
                    return;
                  }
                  state.chat.status = event.phase === 'preparing-context'
                    ? 'Preparing document context...'
                    : 'Waiting for answer...';
                  if (event.phase === 'preparing-context') {
                    await refreshChatAfterStatusChange();
                    return;
                  }
                  refreshChatOrRenderApp();
                },
                signal: abortController.signal,
              });
        console.debug('[hvy:chat-submit] chat turn resolved', {
          requestNonce,
          currentNonce: state.chat.requestNonce,
          aborted: abortController.signal.aborted,
          error: result.error,
          messageCount: result.messages.length,
        });
        if (requestNonce !== state.chat.requestNonce || abortController.signal.aborted) {
          console.debug('[hvy:chat-submit] dropping result because request is stale or aborted', {
            requestNonce,
            currentNonce: state.chat.requestNonce,
            aborted: abortController.signal.aborted,
          });
          return;
        }
        state.chat.messages = result.messages;
        state.chat.error = result.error;
        saveChatOrSessionState();
        if (useDocumentEditTurn && !result.error) {
          state.rawEditorText = serializeDocument(state.document);
          state.rawEditorError = null;
          state.rawEditorDiagnostics = [];
          if (recordedDocumentEditMutation && document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
          }
        }
      } finally {
        if (requestNonce !== state.chat.requestNonce) {
          console.debug('[hvy:chat-submit] leaving newer request state untouched', {
            requestNonce,
            currentNonce: state.chat.requestNonce,
          });
          return;
        }
        console.debug('[hvy:chat-submit] finished request', {
          requestNonce,
          aborted: abortController.signal.aborted,
        });
        state.chat.abortController = null;
        state.chat.isSending = false;
        state.chat.status = null;
        saveChatOrSessionState();
        refreshChatOrRenderApp({ documentChanged: documentEditMutationNeedsRender });
      }
      return;
    }

    if (form?.id === 'aiEditComposer') {
      event.preventDefault();
      await submitAiEditRequest();
    }

    if (form?.id === 'cliComposer') {
      event.preventDefault();
      await submitCliCommand({
        state,
        command: state.cliDraft,
        recordHistory,
        refreshReaderPanels: getRefreshReaderPanels(),
      });
      state.rawEditorText = serializeDocument(state.document);
      state.rawEditorError = null;
      state.rawEditorDiagnostics = [];
      getRenderApp()();
      restoreCliViewAfterRender();
    }
  });
}

function mergePendingDocumentEditMutation(pending: PendingDocumentEditMutation, mutation?: ChatCliMutationSummary): void {
  if (!mutation) {
    pending.requiresFullRefresh = true;
    return;
  }
  pending.requiresFullRefresh = pending.requiresFullRefresh || Boolean(mutation.requiresFullRefresh);
  if (mutation.virtualPathNaming) {
    pending.virtualPathNaming = mutation.virtualPathNaming;
  }
  for (const path of mutation.paths ?? []) {
    pending.paths.add(path);
  }
  for (const path of mutation.refreshSectionPaths ?? []) {
    pending.refreshSectionPaths.add(path);
  }
  if (!mutation.paths?.length && !mutation.refreshSectionPaths?.length && !mutation.requiresFullRefresh) {
    pending.requiresFullRefresh = true;
  }
}

function resetPendingDocumentEditMutation(pending: PendingDocumentEditMutation): void {
  pending.requiresFullRefresh = false;
  pending.paths.clear();
  pending.refreshSectionPaths.clear();
  pending.virtualPathNaming = undefined;
}

function tryRefreshDocumentEditMutationBlocks(root: HTMLElement, pending: PendingDocumentEditMutation): boolean {
  if (pending.requiresFullRefresh || (pending.paths.size === 0 && pending.refreshSectionPaths.size === 0)) {
    recordMeasurement('chat.documentEdit.partialRefresh.skip', 0, {
      reason: pending.requiresFullRefresh ? 'requires-full-refresh' : 'no-local-paths',
      paths: pending.paths.size,
      refreshSectionPaths: pending.refreshSectionPaths.size,
    });
    return false;
  }
  const sectionTargets = resolveDocumentEditMutationSectionTargets([...pending.refreshSectionPaths], pending.virtualPathNaming);
  if (pending.refreshSectionPaths.size > 0 && !sectionTargets) {
    recordMeasurement('chat.documentEdit.partialRefresh.skip', 0, {
      reason: 'section-target-resolution',
      paths: pending.paths.size,
      refreshSectionPaths: pending.refreshSectionPaths.size,
    });
    return false;
  }
  const sectionKeys = new Set((sectionTargets ?? []).map((target) => target.sectionKey));
  const targets = resolveDocumentEditMutationBlockTargets([...pending.paths], pending.virtualPathNaming, sectionKeys);
  if (!targets) {
    recordMeasurement('chat.documentEdit.partialRefresh.skip', 0, {
      reason: 'block-target-resolution',
      paths: pending.paths.size,
      refreshSectionPaths: pending.refreshSectionPaths.size,
    });
    return false;
  }
  const refreshedSections = (sectionTargets ?? []).every((target) =>
    getRefreshReaderSection()(root, target.sectionKey, { runVisibilityScripts: false })
  );
  if (!refreshedSections) {
    recordMeasurement('chat.documentEdit.partialRefresh.skip', 0, {
      reason: 'section-dom-refresh',
      paths: pending.paths.size,
      refreshSectionPaths: pending.refreshSectionPaths.size,
      sectionTargets: sectionTargets?.length ?? 0,
    });
    return false;
  }
  const refreshedBlocks = targets.every((target) =>
    getRefreshReaderBlock()(root, target.sectionKey, target.blockId, { runVisibilityScripts: false })
  );
  recordMeasurement('chat.documentEdit.partialRefresh.result', 0, {
    refreshed: refreshedBlocks,
    paths: pending.paths.size,
    refreshSectionPaths: pending.refreshSectionPaths.size,
    sectionTargets: sectionTargets?.length ?? 0,
    blockTargets: targets.length,
  });
  return refreshedBlocks;
}

function resolveDocumentEditMutationBlockTargets(
  paths: string[],
  virtualPathNaming?: HvyVirtualPathNamingState,
  refreshedSectionKeys = new Set<string>()
): Array<{ sectionKey: string; blockId: string }> | null {
  const targets: Array<{ sectionKey: string; blockId: string }> = [];
  const seen = new Set<string>();
  for (const path of paths) {
    const directory = virtualFileDirectory(path);
    if (!directory) {
      return null;
    }
    const block = findBlockForVirtualDirectory(state.document, directory, virtualPathNaming) ?? findBlockForIdDirectory(directory);
    if (!block) {
      return null;
    }
    const section = findSectionOwningBlock(state.document.sections, block);
    if (!section) {
      return null;
    }
    if (refreshedSectionKeys.has(section.key)) {
      continue;
    }
    const key = `${section.key}\0${block.id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    targets.push({ sectionKey: section.key, blockId: block.id });
  }
  return targets;
}

function findSectionForBlockDirectory(directory: string, virtualPathNaming?: HvyVirtualPathNamingState): VisualSection | null {
  const block = findBlockForVirtualDirectory(state.document, directory, virtualPathNaming) ?? findBlockForIdDirectory(directory);
  return block ? findSectionOwningBlock(state.document.sections, block) : null;
}

function resolveDocumentEditMutationSectionTargets(
  paths: string[],
  virtualPathNaming?: HvyVirtualPathNamingState
): Array<{ sectionKey: string }> | null {
  const targets: Array<{ sectionKey: string }> = [];
  const seen = new Set<string>();
  for (const path of paths) {
    const directory = virtualDirectoryPath(path);
    if (!directory) {
      return null;
    }
    const section =
      findSectionForVirtualDirectory(state.document, directory, virtualPathNaming) ??
      findSectionForDirectory(directory) ??
      findSectionForBlockDirectory(directory, virtualPathNaming);
    if (!section) {
      return null;
    }
    if (seen.has(section.key)) {
      continue;
    }
    seen.add(section.key);
    targets.push({ sectionKey: section.key });
  }
  return targets;
}

function virtualDirectoryPath(path: string): string | null {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (!normalized.startsWith('/body/') && !normalized.startsWith('/id/')) {
    return null;
  }
  const lastSegment = normalized.split('/').pop() ?? '';
  return lastSegment.includes('.') ? virtualFileDirectory(normalized) : normalized;
}

function virtualFileDirectory(path: string): string | null {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const slashIndex = normalized.lastIndexOf('/');
  if (slashIndex <= 0) {
    return null;
  }
  const directory = normalized.slice(0, slashIndex);
  return directory.startsWith('/body/') || directory.startsWith('/id/') ? directory : null;
}

function findSectionOwningBlock(sections: VisualSection[], targetBlock: VisualBlock): VisualSection | null {
  for (const section of sections) {
    if (findBlockInList(section.blocks, targetBlock.id) === targetBlock) {
      return section;
    }
    const nested = findSectionOwningBlock(section.children, targetBlock);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function findBlockForIdDirectory(directory: string): VisualBlock | null {
  const match = /^\/id\/([^/]+)$/.exec(directory);
  if (!match) {
    return null;
  }
  const id = decodeURIComponent(match[1] ?? '');
  return findBlockByIdInSections(state.document.sections, id);
}

function findSectionForDirectory(directory: string): VisualSection | null {
  const match = /^\/(?:body|id)\/([^/]+)$/.exec(directory);
  if (!match) {
    return null;
  }
  const id = decodeURIComponent(match[1] ?? '');
  return findSectionById(state.document.sections, id);
}

function findSectionById(sections: VisualSection[], sectionId: string): VisualSection | null {
  for (const section of sections) {
    if (section.customId === sectionId || section.key === sectionId) {
      return section;
    }
    const nested = findSectionById(section.children, sectionId);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function findBlockByIdInSections(sections: VisualSection[], blockId: string): VisualBlock | null {
  for (const section of sections) {
    const block = findBlockInList(section.blocks, blockId) ?? findBlockBySchemaIdInList(section.blocks, blockId);
    if (block) {
      return block;
    }
    const nested = findBlockByIdInSections(section.children, blockId);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function findBlockBySchemaIdInList(blocks: VisualBlock[], schemaId: string, seen = new Set<VisualBlock>()): VisualBlock | null {
  for (const block of blocks) {
    if (seen.has(block)) {
      continue;
    }
    seen.add(block);
    if (block.schema.id === schemaId) {
      return block;
    }
    const nested =
      findBlockBySchemaIdInList(block.schema.containerBlocks ?? [], schemaId, seen) ??
      findBlockBySchemaIdInList(block.schema.componentListBlocks ?? [], schemaId, seen) ??
      findBlockBySchemaIdInList(block.schema.expandableStubBlocks?.children ?? [], schemaId, seen) ??
      findBlockBySchemaIdInList(block.schema.expandableContentBlocks?.children ?? [], schemaId, seen) ??
      findBlockBySchemaIdInList((block.schema.gridItems ?? []).map((item) => item.block), schemaId, seen);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function waitForNextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function upsertChatProgressMessage(messages: typeof state.chat.messages, message: typeof state.chat.messages[number]): typeof state.chat.messages {
  const existingIndex = messages.findIndex((candidate) => candidate.id === message.id);
  if (existingIndex < 0) {
    return [...messages, message];
  }
  return messages.map((candidate, index) => (index === existingIndex ? message : candidate));
}
