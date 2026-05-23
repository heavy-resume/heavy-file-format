import bundledResumeThvy from '../examples/resume.thvy?raw';
import bundledResumeHvy from '../examples/resume.hvy?raw';
import bundledCrmHvy from '../examples/crm.hvy?raw';
import bundledStudyToolsHvy from '../examples/study-tools.hvy?raw';
import bundledGuideHvy from '../hvy-guide.hvy?raw';
import bundledExampleHvyUrl from '../examples/example.hvy?url';
import bundledResumeViews from '../examples/resume-views.json';
import {
  state,
  getActiveStateRuntime,
  getRenderApp,
  getRefreshReaderPanels,
  runWithStateRuntime,
  runWithStateRuntimeAsync,
} from './state';
import { findSectionByKey } from './section-ops';
import { findBlockByIds, setActiveEditorBlock, setAiEditorHostBlock } from './block-ops';
import { navigateToSection, closeModal, resetTransientUiState, resetToBlankDocument } from './navigation';
import { deserializeDocumentBytes, serializeDocument, serializeDocumentBytes } from './serialization';
import { detectExtension, normalizeFilename, normalizeMarkdownImportFilename, downloadBinaryFile } from './utils';
import { bindModal } from './bind-modal';
import { bindLinkInlineModal } from './bind-link-modal';
import { clearChatConversation } from './chat/chat';
import { restoreDbTableFrameScroll } from './plugins/db-table-model';
import { bindChatThreadUi } from './chat/chat-thread-ui';
import { bindImageDragAndDrop } from './editor/components/image/image';
import { bindCarouselInteractions } from './editor/components/carousel/carousel';
import { bindAppEvents } from './bind/app-events';
import { scheduleSidebarHelpAutoClose } from './sidebar-help';
import { saveSessionState } from './state-persistence';
import { createDocumentFilterSnapshot } from './search/document-filter';
import { createDefaultSearchState } from './search/state';
import { externalSearchSnapshotToDocumentState } from './search/snapshot';
import { traceSemanticFilterEvent } from './search/semantic-trace';
import type { HvySearchSnapshot } from './search/types';
import { encodeComponentListRuntimeView, parseComponentListRuntimeView } from './editor/components/component-list/component-list-view';
import { getAiEditorDoubleClickDelayMs } from './reference-config';
import { isAiEditablePlaceholderTextBlock } from './ai-placeholder';
import { logClickTrace } from './bind/click-trace';
import { expandSingletonVirtualGroupChild } from './reader/singleton-group-expand';
import type { ReaderViewFilter, SelectedExample } from './types';

const resumeViews = bundledResumeViews as Record<string, ReaderViewFilter>;
const IMPORT_REFERENCE_API_PATH = '/api/import-reference-document';
const HVY_GUIDE_API_PATH = '/api/hvy-guide-document';
const SCRIPTING_HELP_API_PATH = '/api/scripting-help-document';
const IMPORT_REFERENCE_SOURCE_DOCUMENT = {
  apiPath: IMPORT_REFERENCE_API_PATH,
  errorLabel: 'import reference document',
};
const SCRIPTING_HELP_SOURCE_DOCUMENT = {
  apiPath: SCRIPTING_HELP_API_PATH,
  errorLabel: 'scripting help document',
};
const SOURCE_DOCUMENTS_BY_EXAMPLE: Partial<Record<SelectedExample, { apiPath: string; errorLabel: string }>> = {
  guide: {
    apiPath: HVY_GUIDE_API_PATH,
    errorLabel: 'HVY guide document',
  },
  'import-reference': IMPORT_REFERENCE_SOURCE_DOCUMENT,
  'scripting-help': SCRIPTING_HELP_SOURCE_DOCUMENT,
};

interface HvyFileSystemFileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{
    write(data: Uint8Array): Promise<void>;
    close(): Promise<void>;
  }>;
}

let currentFileHandle: HvyFileSystemFileHandle | null = null;

interface ReplaceLoadedDocumentOptions {
  searchSnapshot?: HvySearchSnapshot | null;
  currentView?: typeof state.currentView;
  metaFilter?: Partial<typeof state.metaFilter>;
}

function supportsFileSystemAccess(): boolean {
  return typeof (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker === 'function';
}

function replaceLoadedDocument(
  raw: string | Uint8Array,
  filename: string,
  selectedExample: typeof state.selectedExample,
  options: ReplaceLoadedDocumentOptions = {}
): void {
  const extension = detectExtension(filename);
  const bytes = typeof raw === 'string' ? new TextEncoder().encode(raw) : raw;
  state.selectedExample = selectedExample;
  state.document = deserializeDocumentBytes(bytes, extension);
  state.rawEditorText = serializeDocument(state.document);
  state.rawEditorError = null;
  state.rawEditorDiagnostics = [];
  state.filename = extension === '.md'
    ? normalizeMarkdownImportFilename(filename)
    : normalizeFilename(filename);
  state.history = [];
  state.future = [];
  clearChatConversation(state.chat);
  resetTransientUiState();
  if (options.searchSnapshot) {
    state.search = externalSearchSnapshotToDocumentState(options.searchSnapshot, state.document);
  }
  state.currentView = options.currentView ?? state.currentView;
  state.metaFilter = {
    query: '',
    mode: state.search.filterQueryMode,
    isRunning: false,
    status: null,
    error: null,
    resultCount: null,
    ...options.metaFilter,
  };
  saveSessionState(state);
  getRenderApp()();
}

async function openLocalDocumentWithPicker(): Promise<void> {
  const picker = (window as unknown as {
    showOpenFilePicker?: (options?: unknown) => Promise<HvyFileSystemFileHandle[]>;
  }).showOpenFilePicker;
  if (!picker) {
    return;
  }
  const [handle] = await picker({
    multiple: false,
    types: [
      {
        description: 'HVY documents',
        accept: {
          'text/plain': ['.hvy', '.thvy', '.md', '.markdown'],
        },
      },
    ],
  });
  if (!handle) {
    return;
  }
  const file = await handle.getFile();
  const bytes = new Uint8Array(await file.arrayBuffer());
  replaceLoadedDocument(bytes, file.name, 'custom');
  currentFileHandle = handle;
}

async function loadSourceDocumentFromServer(
  source: { apiPath: string; errorLabel: string },
  filename: string,
  selectedExample: SelectedExample
): Promise<void> {
  const response = await fetch(source.apiPath, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Could not load ${source.errorLabel}: ${response.status} ${response.statusText}`);
  }
  currentFileHandle = null;
  replaceLoadedDocument(await response.text(), filename, selectedExample);
}

async function loadDefaultExampleDocument(): Promise<void> {
  const response = await fetch(bundledExampleHvyUrl, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Could not load default example: ${response.status} ${response.statusText}`);
  }
  currentFileHandle = null;
  replaceLoadedDocument(new Uint8Array(await response.arrayBuffer()), 'example.hvy', 'default');
}

function loadBundledTextDocument(raw: string, filename: string, selectedExample: typeof state.selectedExample): void {
  currentFileHandle = null;
  replaceLoadedDocument(raw, filename, selectedExample);
}

async function saveCurrentDocumentInPlace(downloadName: HTMLInputElement): Promise<void> {
  const normalized = normalizeFilename(state.filename || 'document.hvy');
  state.filename = normalized;
  downloadName.value = normalized;
  const bytes = serializeDocumentBytes(state.document);
  const sourceDocument = state.selectedExample ? SOURCE_DOCUMENTS_BY_EXAMPLE[state.selectedExample] : undefined;
  if (sourceDocument) {
    const response = await fetch(sourceDocument.apiPath, {
      method: 'PUT',
      headers: {
        'content-type': 'text/plain; charset=utf-8',
      },
      body: new TextDecoder().decode(bytes),
    });
    if (!response.ok) {
      throw new Error(`Could not save ${sourceDocument.errorLabel}: ${response.status} ${response.statusText}`);
    }
    saveSessionState(state);
    getRenderApp()();
    return;
  }
  if (!currentFileHandle) {
    downloadBinaryFile(normalized, bytes);
    getRenderApp()();
    return;
  }
  const writable = await currentFileHandle.createWritable();
  await writable.write(bytes);
  await writable.close();
  saveSessionState(state);
  getRenderApp()();
}

export function bindUi(app: HTMLElement): void {
  const runtime = getActiveStateRuntime();
  const runInBoundRuntime = <T>(action: () => T): T => runWithStateRuntime(runtime, action);
  const runInBoundRuntimeAsync = <T>(action: () => Promise<T>): Promise<T> => runWithStateRuntimeAsync(runtime, action);
  const newBtn = app.querySelector<HTMLButtonElement>('#newBtn');
  const fileInput = app.querySelector<HTMLInputElement>('#fileInput');
  const downloadBtn = app.querySelector<HTMLButtonElement>('#downloadBtn');
  const downloadName = app.querySelector<HTMLInputElement>('#downloadName');
  const openLocalFileBtn = app.querySelector<HTMLButtonElement>('#openLocalFileBtn');
  const saveFileBtn = app.querySelector<HTMLButtonElement>('#saveFileBtn');
  const readerDocument = app.querySelector<HTMLDivElement>('#readerDocument');
  const readerSidebarSections = app.querySelector<HTMLDivElement>('#readerSidebarSections');
  const aiReaderDocument = app.querySelector<HTMLDivElement>('#aiReaderDocument');
  const aiSidebarSections = app.querySelector<HTMLDivElement>('#aiSidebarSections');
  const readerNav = app.querySelector<HTMLDivElement>('#readerNav');
  const chatThread = app.querySelector<HTMLDivElement>('.chat-thread');
  const chatScrollContainer = app.querySelector<HTMLDivElement>('[data-chat-scroll-container]');
  const chatScrollBottomButton = app.querySelector<HTMLButtonElement>('[data-action="chat-scroll-bottom"]');
  const metaFilterComposer = app.querySelector<HTMLFormElement>('#metaFilterComposer');
  const metaFilterQuery = app.querySelector<HTMLInputElement>('#metaFilterQuery');
  const clearMetaFilterButton = app.querySelector<HTMLButtonElement>('[data-action="clear-meta-filter"]');
  const metaFilterModeButtons = app.querySelectorAll<HTMLButtonElement>('[data-action="set-meta-filter-mode"]');
  const metaFilterBehaviorButtons = app.querySelectorAll<HTMLButtonElement>('[data-action="set-meta-filter-behavior"]');
  let pendingAiReaderAction: number | null = null;

  const clearPendingAiReaderAction = (): void => {
    if (pendingAiReaderAction !== null) {
      window.clearTimeout(pendingAiReaderAction);
      pendingAiReaderAction = null;
    }
  };

  const runReaderAction = (event: Event, action: () => void): void => {
    clearPendingAiReaderAction();
    if (state.currentView !== 'ai') {
      runInBoundRuntime(action);
      return;
    }
    if (event instanceof MouseEvent && event.detail > 1) {
      return;
    }
    pendingAiReaderAction = window.setTimeout(() => {
      runInBoundRuntime(() => {
        pendingAiReaderAction = null;
        action();
      });
    }, getAiEditorDoubleClickDelayMs());
  };

  if (!newBtn || !fileInput || !downloadBtn || !downloadName) {
    throw new Error('Missing UI elements for binding.');
  }

  bindChatThreadUi(chatThread, chatScrollContainer, chatScrollBottomButton);
  bindImageDragAndDrop(app);
  bindCarouselInteractions(app);
  scheduleSidebarHelpAutoClose(app);

  metaFilterQuery?.addEventListener('input', () => {
    state.metaFilter.query = metaFilterQuery.value;
    state.metaFilter.error = null;
    state.metaFilter.status = null;
  });

  metaFilterComposer?.addEventListener('submit', (event) => {
    event.preventDefault();
    void runInBoundRuntimeAsync(async () => {
      const query = state.metaFilter.query.trim();
      if (!query || state.metaFilter.isRunning) {
        return;
      }
      state.metaFilter.isRunning = true;
      state.metaFilter.error = null;
      state.metaFilter.status = 'Preparing semantic filter...';
      state.metaFilter.resultCount = null;
      getRenderApp()();
      try {
        const documentBytes = serializeDocumentBytes(state.document);
        const documentExtension = state.document.extension;
        const filename = state.filename || `document${documentExtension}`;
        const detachedDocument = deserializeDocumentBytes(documentBytes, documentExtension);
        const traceRunId = `meta-semantic-filter:${Date.now().toString(36)}`;
        const snapshot = await createDocumentFilterSnapshot({
          document: detachedDocument,
          query,
          mode: state.search.filterQueryMode,
          view: state.currentView,
          filterMode: state.search.filterMode,
          traceRunId,
          onSemanticProgress: (progress) => {
            state.metaFilter.status = `Semantic windows ${progress.completedWindows}/${progress.totalWindows}; ${progress.matchedCandidates} match${progress.matchedCandidates === 1 ? '' : 'es'}`;
            getRenderApp()();
          },
        });
        replaceLoadedDocument(documentBytes, filename, state.selectedExample, {
          searchSnapshot: snapshot,
          currentView: 'viewer',
          metaFilter: {
            query,
            mode: state.search.filterQueryMode,
            resultCount: snapshot.results.length,
            status: snapshot.results.length > 0 ? 'Loaded document with meta filter snapshot.' : 'Loaded document with no meta filter matches.',
            error: null,
          },
        });
        state.search.open = false;
        state.search.resultsCollapsed = false;
        traceSemanticFilterEvent({ traceRunId }, 'meta_filter_loaded_document_state', {
          query,
          currentView: state.currentView,
          filterEnabled: state.search.filterEnabled,
          filterMode: state.search.filterMode,
          filterQueryMode: state.search.filterQueryMode,
          submittedFilterQueryMode: state.search.submittedFilterQueryMode,
          resultCount: state.search.results.length,
          resultLabels: state.search.results.map((result) => result.label),
          visibleBehavior: state.search.filterMode,
        });
        getRefreshReaderPanels()();
      } catch (error: unknown) {
        state.metaFilter.error = error instanceof Error ? error.message : 'Meta filter failed.';
        getRenderApp()();
      } finally {
        state.metaFilter.isRunning = false;
        getRenderApp()();
      }
    });
  });

  metaFilterModeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.dataset.metaFilterMode;
      if (mode !== 'keyword' && mode !== 'semantic') {
        return;
      }
      runInBoundRuntime(() => {
        state.search.filterQueryMode = mode;
        state.metaFilter.mode = mode;
        state.metaFilter.error = null;
        state.metaFilter.status = null;
        state.metaFilter.resultCount = null;
        getRenderApp()();
      });
    });
  });

  metaFilterBehaviorButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.dataset.metaFilterBehavior;
      if (mode !== 'deprioritize' && mode !== 'hide') {
        return;
      }
      runInBoundRuntime(() => {
        state.search.filterMode = mode;
        state.metaFilter.error = null;
        state.metaFilter.status = null;
        state.metaFilter.resultCount = null;
        getRenderApp()();
      });
    });
  });

  clearMetaFilterButton?.addEventListener('click', () => {
    runInBoundRuntime(() => {
      const mode = state.search.filterQueryMode;
      state.search = createDefaultSearchState();
      state.search.filterQueryMode = mode;
      state.search.submittedFilterQueryMode = mode;
      state.metaFilter = {
        query: '',
        mode,
        isRunning: false,
        status: null,
        error: null,
        resultCount: null,
      };
      saveSessionState(state);
      getRefreshReaderPanels()();
      getRenderApp()();
    });
  });

  newBtn.addEventListener('click', () => {
    currentFileHandle = null;
    resetToBlankDocument();
  });

  const defaultExampleBtn = app.querySelector<HTMLButtonElement>('#defaultExampleBtn');
  defaultExampleBtn?.addEventListener('click', () => {
    void runInBoundRuntimeAsync(async () => {
      try {
        await loadDefaultExampleDocument();
      } catch (error: unknown) {
        state.rawEditorError = error instanceof Error ? error.message : 'Could not load the default example.';
        getRenderApp()();
      }
    });
  });

  const guideBtn = app.querySelector<HTMLButtonElement>('#guideBtn');
  guideBtn?.addEventListener('click', () => {
    loadBundledTextDocument(bundledGuideHvy, 'hvy-guide.hvy', 'guide');
  });

  const crmExampleBtn = app.querySelector<HTMLButtonElement>('#crmExampleBtn');
  crmExampleBtn?.addEventListener('click', () => {
    loadBundledTextDocument(bundledCrmHvy, 'crm.hvy', 'crm');
  });

  const studyToolsExampleBtn = app.querySelector<HTMLButtonElement>('#studyToolsExampleBtn');
  studyToolsExampleBtn?.addEventListener('click', () => {
    loadBundledTextDocument(bundledStudyToolsHvy, 'study-tools.hvy', 'study-tools');
  });

  const resumeTemplateBtn = app.querySelector<HTMLButtonElement>('#resumeTemplateBtn');
  resumeTemplateBtn?.addEventListener('click', () => {
    loadBundledTextDocument(bundledResumeThvy, 'resume.thvy', 'resume-template');
  });

  const resumeExampleBtn = app.querySelector<HTMLButtonElement>('#resumeExampleBtn');
  resumeExampleBtn?.addEventListener('click', () => {
    loadBundledTextDocument(bundledResumeHvy, 'resume.hvy', 'resume-example');
  });

  const importReferenceBtn = app.querySelector<HTMLButtonElement>('#importReferenceBtn');
  importReferenceBtn?.addEventListener('click', () => {
    void runInBoundRuntimeAsync(async () => {
      try {
        await loadSourceDocumentFromServer(
          IMPORT_REFERENCE_SOURCE_DOCUMENT,
          'ai-import-hvy-format-reference.hvy',
          'import-reference'
        );
      } catch (error: unknown) {
        state.rawEditorError = error instanceof Error ? error.message : 'Could not load the import reference document.';
        getRenderApp()();
      }
    });
  });

  const scriptingHelpBtn = app.querySelector<HTMLButtonElement>('#scriptingHelpBtn');
  scriptingHelpBtn?.addEventListener('click', () => {
    void runInBoundRuntimeAsync(async () => {
      try {
        await loadSourceDocumentFromServer(
          SCRIPTING_HELP_SOURCE_DOCUMENT,
          'scripting-help.hvy',
          'scripting-help'
        );
      } catch (error: unknown) {
        state.rawEditorError = error instanceof Error ? error.message : 'Could not load the scripting help document.';
        getRenderApp()();
      }
    });
  });

  if (openLocalFileBtn) {
    openLocalFileBtn.hidden = !supportsFileSystemAccess();
    openLocalFileBtn.addEventListener('click', () => {
      void runInBoundRuntimeAsync(async () => {
        try {
          await openLocalDocumentWithPicker();
        } catch (error: unknown) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            return;
          }
          state.rawEditorError = error instanceof Error ? error.message : 'Could not open the selected file.';
          getRenderApp()();
        }
      });
    });
  }

  saveFileBtn?.addEventListener('click', () => {
    void runInBoundRuntimeAsync(async () => {
      try {
        await saveCurrentDocumentInPlace(downloadName);
      } catch (error: unknown) {
        state.rawEditorError = error instanceof Error ? error.message : 'Could not save the current document.';
        getRenderApp()();
      }
    });
  });

  const applyReaderView = (view: ReaderViewFilter): void => {
    state.readerView = view;
    state.readerViewActivatedTargets = new Set<string>();
    state.readerContainerState = {};
    state.readerExpandableState = {};
    state.currentView = state.currentView === 'editor' ? 'viewer' : state.currentView;
    saveSessionState(state);
    getRenderApp()();
  };

  app.querySelector<HTMLButtonElement>('#typescriptResumeViewBtn')?.addEventListener('click', () => {
    if (state.selectedExample !== 'resume-example') {
      return;
    }
    applyReaderView(resumeViews.typescript ?? {});
  });

  app.querySelector<HTMLButtonElement>('#llmEngineerResumeViewBtn')?.addEventListener('click', () => {
    if (state.selectedExample !== 'resume-example') {
      return;
    }
    applyReaderView(resumeViews['llm-engineer'] ?? {});
  });

  app.querySelector<HTMLButtonElement>('#clearReaderViewBtn')?.addEventListener('click', () => {
    state.readerView = {};
    state.readerViewActivatedTargets = new Set<string>();
    state.readerContainerState = {};
    state.readerExpandableState = {};
    saveSessionState(state);
    getRenderApp()();
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) {
      return;
    }
    currentFileHandle = null;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const extension = detectExtension(file.name);
    state.filename = extension === '.md' ? normalizeMarkdownImportFilename(file.name) : file.name;
    state.selectedExample = 'custom';
    state.document = deserializeDocumentBytes(bytes, extension);
    state.rawEditorText = serializeDocument(state.document);
    state.rawEditorError = null;
    state.rawEditorDiagnostics = [];
    clearChatConversation(state.chat);
    closeModal();
    resetTransientUiState();
    saveSessionState(state);
    getRenderApp()();
  });

  downloadName.addEventListener('input', () => {
    state.filename = downloadName.value;
    saveSessionState(state);
  });

  downloadBtn.addEventListener('click', () => {
    const normalized = normalizeFilename(state.filename || 'document.hvy');
    state.filename = normalized;
    const bytes = serializeDocumentBytes(state.document);
    downloadBinaryFile(normalized, bytes);
    getRenderApp()();
  });

  bindAppEvents(app);

  const toggleComponentListReverse = (reverseList: HTMLElement): void => {
    const sectionKey = reverseList.dataset.sectionKey;
    const blockId = reverseList.dataset.blockId;
    const viewId = reverseList.dataset.viewId ?? '';
    if (!sectionKey || !blockId) {
      return;
    }
    const key = `${sectionKey}:${blockId}`;
    const current = parseComponentListRuntimeView(state.componentListReaderViews[key] ?? viewId);
    state.componentListReaderViews[key] = encodeComponentListRuntimeView({
      sortKey: current.sortKeyOverride ? current.sortKey : viewId,
      sortKeyOverride: current.sortKeyOverride || !!viewId,
      reversed: !current.reversed,
      groupKey: current.groupKey,
    });
  };

  const handleCollapsedListControlPointerDown = (event: Event) => {
    const target = event.target as HTMLElement;
    const select = target.closest<HTMLSelectElement>('select');
    const listControls = select?.closest<HTMLElement>('[data-component-list-reader-controls="true"]');
    const collapsedSection = listControls?.closest<HTMLElement>('.reader-section.is-collapsed-preview');
    const sectionKey = select?.dataset.sectionKey;
    const blockId = select?.dataset.blockId ?? '';
    if (!select || !listControls || !collapsedSection || !sectionKey) {
      return;
    }
    const section = findSectionByKey(state.document.sections, sectionKey);
    if (!section || section.expanded) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    section.expanded = true;
    const field = select.dataset.field ?? 'component-list-reader-view';
    getRefreshReaderPanels()();
    const nextSelect = app.querySelector<HTMLSelectElement>(
      `[data-field="${CSS.escape(field)}"][data-section-key="${CSS.escape(sectionKey)}"][data-block-id="${CSS.escape(blockId)}"]`
    );
    nextSelect?.focus();
    (nextSelect as (HTMLSelectElement & { showPicker?: () => void }) | null)?.showPicker?.();
  };

  const handleReaderAreaClick = (event: Event) => {
    const target = event.target as HTMLElement;
    const nearestReaderAction = target.closest<HTMLElement>('[data-reader-action]');
    logClickTrace(event, 'reader-area:enter', {
      currentView: state.currentView,
      readerSurface: target.closest('#aiReaderDocument')
        ? 'ai-document'
        : target.closest('#aiSidebarSections')
          ? 'ai-sidebar'
          : target.closest('#readerDocument')
            ? 'reader-document'
            : target.closest('#readerSidebarSections')
              ? 'reader-sidebar'
              : null,
    });
    blurActiveFillInWhenClickingOutside(target);
    refreshCompletedFillInsOnReaderClick(target);
    if (target.closest('[data-action]')) {
      logClickTrace(event, 'reader-area:skip', {
        skipReason: 'data-action-target',
      });
      return;
    }

    const anchor = target.closest<HTMLAnchorElement>('a[href^="#"]');
    if (anchor) {
      event.preventDefault();
      logClickTrace(event, 'reader-area:handled:anchor-navigation', {
        href: anchor.getAttribute('href'),
      });
      const id = anchor.getAttribute('href')?.slice(1) ?? '';
      runReaderAction(event, () => navigateToSection(id, app));
      return;
    }

    const listControls = target.closest<HTMLElement>('[data-component-list-reader-controls="true"]');
    if (listControls) {
      const collapsedSection = listControls.closest<HTMLElement>('.reader-section.is-collapsed-preview');
      const sectionKey = listControls.querySelector<HTMLElement>('[data-section-key]')?.dataset.sectionKey;
      if (collapsedSection && sectionKey) {
        const section = findSectionByKey(state.document.sections, sectionKey);
          if (section && !section.expanded) {
            event.stopPropagation();
            logClickTrace(event, 'reader-area:handled:collapsed-list-controls', {
              sectionKey,
            });
            section.expanded = true;
          const reverseList = target.closest<HTMLElement>('[data-reader-action="toggle-component-list-reverse"]');
          if (reverseList) {
            toggleComponentListReverse(reverseList);
          }
          getRefreshReaderPanels()();
          const select = target.closest<HTMLSelectElement>('select');
          if (select) {
            const blockId = select.dataset.blockId ?? '';
            window.setTimeout(() => runInBoundRuntime(() => {
              const nextSelect = app.querySelector<HTMLSelectElement>(
                `[data-field="${CSS.escape(select.dataset.field ?? 'component-list-reader-view')}"][data-section-key="${CSS.escape(sectionKey)}"][data-block-id="${CSS.escape(blockId)}"]`
              );
              nextSelect?.focus();
              (nextSelect as (HTMLSelectElement & { showPicker?: () => void }) | null)?.showPicker?.();
            }), 0);
          }
          return;
        }
      }
    }

    const reverseList = target.closest<HTMLElement>('[data-reader-action="toggle-component-list-reverse"]');
    if (reverseList) {
      event.stopPropagation();
      logClickTrace(event, 'reader-area:handled:component-list-reverse');
      runReaderAction(event, () => {
        toggleComponentListReverse(reverseList);
        getRefreshReaderPanels()();
      });
      return;
    }

    const viewCollapse = target.closest<HTMLElement>('[data-reader-action="toggle-view-collapse"]');
    if (viewCollapse) {
      if (nearestReaderAction !== viewCollapse) {
        // Let nested reader controls, such as expandables inside a collapsed view wrapper, handle the click.
      } else {
      if (target.closest('a, input, select, textarea, [contenteditable="true"]')) {
        logClickTrace(event, 'reader-area:skip', {
          skipReason: 'view-collapse-interactive-target',
        });
        return;
      }
      event.stopPropagation();
      const key = viewCollapse.dataset.readerViewCollapseKey;
      if (!key) {
        return;
      }
      runReaderAction(event, () => {
        logClickTrace(event, 'reader-area:handled:view-collapse', {
          key,
        });
        state.readerContainerState[key] = viewCollapse.getAttribute('aria-expanded') !== 'true';
        getRefreshReaderPanels()();
      });
      return;
      }
    }

    const dimmedTarget = target.closest<HTMLElement>('[data-reader-view-dimmed="true"][data-reader-view-target]');
    if (dimmedTarget) {
      const targetKey = dimmedTarget.dataset.readerViewTarget;
      if (targetKey) {
        runReaderAction(event, () => {
          logClickTrace(event, 'reader-area:handled:dimmed-target', {
            targetKey,
          });
          state.readerViewActivatedTargets.add(targetKey);
          getRefreshReaderPanels()();
        });
        return;
      }
    }

    const toggle = target.closest<HTMLElement>('[data-reader-action="toggle-expand"]');
    if (toggle) {
      if (nearestReaderAction !== toggle) {
        // Let nested reader controls, such as expandables inside a section preview, handle the click.
      } else {
      event.stopPropagation();
      logClickTrace(event, 'reader-area:handled:section-toggle:start', {
        sectionKey: toggle.dataset.sectionKey ?? null,
      });
      const sectionKey = toggle.dataset.sectionKey;
      if (!sectionKey) {
        return;
      }
      const section = findSectionByKey(state.document.sections, sectionKey);
      if (!section) {
        return;
      }
      runReaderAction(event, () => {
        logClickTrace(event, 'reader-area:handled:section-toggle:run', {
          sectionKey,
          willExpand: !section.expanded,
        });
        section.expanded = !section.expanded;
        getRefreshReaderPanels()();
      });
      return;
      }
    }

    const expandable = target.closest<HTMLElement>('[data-reader-action="toggle-expandable"]');
    if (expandable) {
      logClickTrace(event, 'reader-area:expandable:candidate', {
        sectionKey: expandable.dataset.sectionKey ?? null,
        blockId: expandable.dataset.blockId ?? null,
      });
      if (target.closest('a, button, input, select, textarea, [contenteditable="true"], [role="button"]')) {
        logClickTrace(event, 'reader-area:skip', {
          skipReason: 'expandable-interactive-target',
        });
        if (state.currentView === 'ai') {
          console.debug('[hvy:ai-reader-expandable-toggle]', {
            stage: 'skip',
            skipReason: 'interactive-target',
            eventType: event.type,
            defaultPrevented: event.defaultPrevented,
            target: describeElementForReaderLog(target),
            expandable: describeElementForReaderLog(expandable),
            interactiveAncestor: describeElementForReaderLog(target.closest('a, button, input, select, textarea, [contenteditable="true"], [role="button"]')),
          });
        }
        return;
      }
      if (state.currentView === 'ai' && expandableContainsActiveEditor(expandable)) {
        event.stopPropagation();
        logClickTrace(event, 'reader-area:skip', {
          skipReason: 'expandable-contains-active-editor',
        });
        return;
      }
      if (state.currentView === 'ai' && activateAiExpandableTextTarget(target, expandable)) {
        logClickTrace(event, 'reader-area:handled:ai-expandable-text-target');
        return;
      }
      event.stopPropagation();
      const sectionKey = expandable.dataset.sectionKey;
      const blockId = expandable.dataset.blockId;
      if (!sectionKey || !blockId) {
        if (state.currentView === 'ai') {
          console.debug('[hvy:ai-reader-expandable-toggle]', {
            stage: 'skip',
            skipReason: 'missing-expandable-ids',
            eventType: event.type,
            defaultPrevented: event.defaultPrevented,
            target: describeElementForReaderLog(target),
            expandable: describeElementForReaderLog(expandable),
            sectionKey,
            blockId,
          });
        }
        logClickTrace(event, 'reader-area:skip', {
          skipReason: 'expandable-missing-ids',
          sectionKey,
          blockId,
        });
        return;
      }
      const block = findBlockByIds(sectionKey, blockId);
      if (!block) {
        if (state.currentView === 'ai') {
          console.debug('[hvy:ai-reader-expandable-toggle]', {
            stage: 'skip',
            skipReason: 'missing-block',
            eventType: event.type,
            defaultPrevented: event.defaultPrevented,
            target: describeElementForReaderLog(target),
            expandable: describeElementForReaderLog(expandable),
            sectionKey,
            blockId,
          });
        }
        logClickTrace(event, 'reader-area:skip', {
          skipReason: 'expandable-missing-block',
          sectionKey,
          blockId,
        });
        return;
      }
      if (state.currentView === 'ai') {
        console.debug('[hvy:ai-reader-expandable-toggle]', {
          stage: 'schedule',
          eventType: event.type,
          defaultPrevented: event.defaultPrevented,
          target: describeElementForReaderLog(target),
          expandable: describeElementForReaderLog(expandable),
          nearestReaderBlock: describeElementForReaderLog(target.closest('.reader-block')),
          sectionKey,
          blockId,
          eventDetail: event instanceof MouseEvent ? event.detail : null,
        });
      }
      runReaderAction(event, () => {
        const expandableStateKey = `${sectionKey}:${blockId}`;
        const willCollapse = state.readerExpandableState[expandableStateKey] ?? block.schema.expandableExpanded;
        logClickTrace(event, 'reader-area:handled:expandable-toggle:run', {
          sectionKey,
          blockId,
          expandableStateKey,
          willCollapse,
          storedExpanded: state.readerExpandableState[expandableStateKey] ?? null,
          schemaExpanded: block.schema.expandableExpanded,
        });
        if (state.currentView === 'ai') {
          console.debug('[hvy:ai-reader-expandable-toggle]', {
            stage: 'run',
            sectionKey,
            blockId,
            expandableStateKey,
            willCollapse,
            storedExpanded: state.readerExpandableState[expandableStateKey] ?? null,
            schemaExpanded: block.schema.expandableExpanded,
          });
        }
        if (willCollapse) {
          // Animate collapse before re-rendering
          const readerEl = app.querySelector<HTMLElement>(`[data-expandable-id="${CSS.escape(blockId)}"]`);
          readerEl?.classList.add('is-collapsing');
          window.setTimeout(() => runInBoundRuntime(() => {
            state.readerExpandableState[expandableStateKey] = false;
            getRefreshReaderPanels()();
          }), 160);
        } else {
          state.readerExpandableState[expandableStateKey] = true;
          getRefreshReaderPanels()();
          const readerEl = app.querySelector<HTMLElement>(`[data-expandable-id="${CSS.escape(blockId)}"]`);
          readerEl?.classList.add('is-expanding');
          window.setTimeout(() => runInBoundRuntime(() => {
            readerEl?.classList.remove('is-expanding');
          }), 360);
        }
      });
      return;
    }

    const container = target.closest<HTMLElement>('[data-reader-action="toggle-container"]');
    if (container) {
      if (target.closest('a, input, select, textarea, [contenteditable="true"]')) {
        logClickTrace(event, 'reader-area:skip', {
          skipReason: 'container-interactive-target',
        });
        return;
      }
      event.stopPropagation();
      const key = container.dataset.containerKey;
      if (!key) {
        logClickTrace(event, 'reader-area:skip', {
          skipReason: 'container-missing-key',
        });
        return;
      }
      runReaderAction(event, () => {
        const willExpand = container.getAttribute('aria-expanded') !== 'true';
        logClickTrace(event, 'reader-area:handled:container-toggle', {
          key,
          willExpand,
        });
        state.readerContainerState[key] = willExpand;
        if (willExpand) {
          expandSingletonVirtualGroupChild(container);
        }
        getRefreshReaderPanels()();
      });
    }
  };

  readerDocument?.addEventListener('pointerdown', handleCollapsedListControlPointerDown);
  readerSidebarSections?.addEventListener('pointerdown', handleCollapsedListControlPointerDown);
  aiReaderDocument?.addEventListener('pointerdown', handleCollapsedListControlPointerDown);
  aiSidebarSections?.addEventListener('pointerdown', handleCollapsedListControlPointerDown);

  readerDocument?.addEventListener('click', handleReaderAreaClick);
  readerSidebarSections?.addEventListener('click', handleReaderAreaClick);
  aiReaderDocument?.addEventListener('click', handleReaderAreaClick);
  aiSidebarSections?.addEventListener('click', handleReaderAreaClick);
  aiReaderDocument?.addEventListener('dblclick', clearPendingAiReaderAction);
  aiSidebarSections?.addEventListener('dblclick', clearPendingAiReaderAction);

  chatThread?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;

    const anchor = target.closest<HTMLAnchorElement>('a[href^="#"]');
    if (anchor) {
      const id = anchor.getAttribute('href')?.slice(1) ?? '';
      if (id) {
        event.preventDefault();
        navigateToSection(id, app);
        return;
      }
    }

    const expandable = target.closest<HTMLElement>('[data-chat-action="toggle-expandable"]');
    if (!expandable) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const readerEl = expandable.closest<HTMLElement>('[data-expandable-id]');
    if (!readerEl) {
      return;
    }

    const currentlyExpanded = expandable.getAttribute('aria-expanded') === 'true';
    const nextExpanded = !currentlyExpanded;

    readerEl.querySelectorAll<HTMLElement>('[data-chat-action="toggle-expandable"]').forEach((element) => {
      element.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
    });

    const expandedPane = readerEl.querySelector<HTMLElement>('.expandable-reader-pane-expanded');
    if (nextExpanded) {
      if (expandedPane) {
        expandedPane.style.display = '';
      }
      return;
    }

    if (expandedPane) {
      expandedPane.style.display = 'none';
    }
  });

  readerNav?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const nav = target.closest<HTMLElement>('[data-nav-id]');
    if (!nav) {
      return;
    }
    const sectionId = nav.dataset.navId;
    if (!sectionId) {
      return;
    }
    navigateToSection(sectionId, app);
  });

  bindModal(app);
  bindLinkInlineModal(app);
  restoreDbTableFrameScroll(app);
}

function expandableContainsActiveEditor(expandable: HTMLElement): boolean {
  return Boolean(expandable.querySelector('.editor-block[data-active-editor-block="true"]'));
}

function blurActiveFillInWhenClickingOutside(target: HTMLElement): void {
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  if (active?.dataset.field !== 'text-fill-in-value') {
    return;
  }
  const activeEditor = active.closest<HTMLElement>('.text-fill-in-editor');
  if (activeEditor && activeEditor.contains(target)) {
    return;
  }
  active.blur();
}

function refreshCompletedFillInsOnReaderClick(target: HTMLElement): void {
  const surface = target.closest<HTMLElement>('.hvy-ai-reader-surface');
  if (!surface || target.closest('.text-fill-in-editor')) {
    return;
  }
  const completed = Array.from(surface.querySelectorAll<HTMLElement>('.text-fill-in-reader-editor')).some((editor) => {
    const sectionKey = editor.querySelector<HTMLElement>('[data-field="text-fill-in-value"]')?.dataset.sectionKey ?? '';
    const blockId = editor.querySelector<HTMLElement>('[data-field="text-fill-in-value"]')?.dataset.blockId ?? '';
    const block = sectionKey && blockId ? findBlockByIds(sectionKey, blockId) : null;
    return Boolean(block && !block.schema.fillIn);
  });
  if (completed) {
    getRefreshReaderPanels()();
  }
}

function activateAiExpandableTextTarget(target: HTMLElement, expandable: HTMLElement): boolean {
  if (expandable.getAttribute('aria-expanded') === 'false') {
    return false;
  }
  const expandableBlockElement = expandable.closest<HTMLElement>('.reader-block[data-component="expandable"][data-section-key][data-block-id]');
  const expandableSectionKey = expandableBlockElement?.dataset.sectionKey ?? expandable.dataset.sectionKey ?? '';
  const expandableBlockId = expandableBlockElement?.dataset.blockId ?? expandable.dataset.blockId ?? '';
  const directTextBlock = target.closest<HTMLElement>('.reader-block[data-component="text"][data-section-key][data-block-id]');
  const textBlock = directTextBlock && expandable.contains(directTextBlock)
    ? directTextBlock
    : findFirstPlaceholderTextBlock(expandableBlockElement ?? expandable);
  const modelFallback = !textBlock && expandableSectionKey && expandableBlockId
    ? findFirstPlaceholderTextBlockInExpandableModel(expandableSectionKey, expandableBlockId)
    : null;
  const sectionKey = textBlock?.dataset.sectionKey ?? modelFallback?.sectionKey ?? '';
  const blockId = textBlock?.dataset.blockId ?? modelFallback?.blockId ?? '';
  const block = modelFallback?.block ?? (sectionKey && blockId ? findBlockByIds(sectionKey, blockId) : null);
  const editablePlaceholder = isAiEditablePlaceholderTextBlock(block);
  if ((!textBlock && !modelFallback) || block?.schema.component !== 'text' || !editablePlaceholder) {
    console.debug('[hvy:ai-reader-expandable-toggle]', {
      stage: 'text-activation-skip',
      skipReason: !textBlock && !modelFallback
        ? 'no-placeholder-target'
        : block?.schema.component !== 'text'
        ? 'resolved-block-not-text'
        : String(block?.schema.placeholder ?? '').trim().length === 0
        ? 'text-without-placeholder'
        : 'text-placeholder-already-filled',
      target: describeElementForReaderLog(target),
      expandable: describeElementForReaderLog(expandable),
      expandableBlock: describeElementForReaderLog(expandableBlockElement),
      textBlock: describeElementForReaderLog(textBlock),
      modelFallback: modelFallback ? { sectionKey: modelFallback.sectionKey, blockId: modelFallback.blockId } : null,
      resolvedComponent: block?.schema.component ?? null,
      hasPlaceholder: String(block?.schema.placeholder ?? '').trim().length > 0,
      editablePlaceholder,
    });
    return false;
  }
  console.debug('[hvy:ai-reader-expandable-toggle]', {
    stage: 'text-activation',
    target: describeElementForReaderLog(target),
    expandable: describeElementForReaderLog(expandable),
    expandableBlock: describeElementForReaderLog(expandableBlockElement),
    textBlock: describeElementForReaderLog(textBlock),
    modelFallback: modelFallback ? { sectionKey: modelFallback.sectionKey, blockId: modelFallback.blockId } : null,
    sectionKey,
    blockId,
    editablePlaceholder,
  });
  state.aiModeTipDismissed = true;
  setActiveEditorBlock(sectionKey, blockId, { targetOnly: true });
  setAiEditorHostBlock(expandableSectionKey || sectionKey, expandableBlockId || blockId);
  if (state.pendingEditorActivation) {
    state.pendingEditorActivation.immediateFocus = true;
  }
  getRenderApp()();
  return true;
}

function findFirstPlaceholderTextBlockInExpandableModel(
  sectionKey: string,
  expandableBlockId: string
): { sectionKey: string; blockId: string; block: NonNullable<ReturnType<typeof findBlockByIds>> } | null {
  const expandableBlock = findBlockByIds(sectionKey, expandableBlockId);
  if (expandableBlock?.schema.component !== 'expandable') {
    return null;
  }
  const children = [
    ...(expandableBlock.schema.expandableStubBlocks?.children ?? []),
    ...(expandableBlock.schema.expandableContentBlocks?.children ?? []),
  ];
  const placeholder = children.find(
    (child) => isAiEditablePlaceholderTextBlock(child)
  );
  return placeholder ? { sectionKey, blockId: placeholder.id, block: placeholder } : null;
}

function findFirstPlaceholderTextBlock(expandable: HTMLElement): HTMLElement | null {
  return Array.from(
    expandable.querySelectorAll<HTMLElement>('.reader-block[data-component="text"][data-section-key][data-block-id]')
  ).find((textBlock) => {
    const sectionKey = textBlock.dataset.sectionKey ?? '';
    const blockId = textBlock.dataset.blockId ?? '';
    const block = sectionKey && blockId ? findBlockByIds(sectionKey, blockId) : null;
    return isAiEditablePlaceholderTextBlock(block);
  }) ?? null;
}

function describeElementForReaderLog(element: Element | null | undefined): Record<string, string | null> | null {
  if (!element) {
    return null;
  }
  const htmlElement = element as HTMLElement;
  return {
    tag: element.tagName.toLowerCase(),
    id: htmlElement.id || null,
    className: typeof htmlElement.className === 'string' ? htmlElement.className : null,
    component: htmlElement.dataset?.component ?? null,
    sectionKey: htmlElement.dataset?.sectionKey ?? null,
    blockId: htmlElement.dataset?.blockId ?? null,
    action: htmlElement.dataset?.action ?? null,
    readerAction: htmlElement.dataset?.readerAction ?? null,
    text: htmlElement.textContent?.replace(/\s+/g, ' ').trim().slice(0, 120) ?? null,
  };
}
