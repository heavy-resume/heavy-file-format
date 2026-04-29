import bundledResumeThvy from '../examples/resume.thvy?raw';
import bundledResumeHvy from '../examples/resume.hvy?raw';
import bundledCrmHvy from '../examples/crm.hvy?raw';
import { state, getRenderApp, getRefreshReaderPanels } from './state';
import { findSectionByKey } from './section-ops';
import { findBlockByIds } from './block-ops';
import { navigateToSection, closeModal, resetTransientUiState, resetToBlankDocument } from './navigation';
import { deserializeDocument, deserializeDocumentBytes, serializeDocument, serializeDocumentBytes } from './serialization';
import { detectExtension, normalizeFilename, normalizeMarkdownImportFilename, downloadBinaryFile } from './utils';
import { bindModal } from './bind-modal';
import { bindLinkInlineModal } from './bind-link-modal';
import { clearChatConversation } from './chat/chat';
import { restoreDbTableFrameScroll } from './plugins/db-table';
import { bindChatThreadUi } from './chat/chat-thread-ui';
import { bindImageDragAndDrop } from './editor/components/image/image';
import { bindAppEvents } from './bind/app-events';

export function bindUi(app: HTMLElement): void {
  const newBtn = app.querySelector<HTMLButtonElement>('#newBtn');
  const fileInput = app.querySelector<HTMLInputElement>('#fileInput');
  const downloadBtn = app.querySelector<HTMLButtonElement>('#downloadBtn');
  const downloadName = app.querySelector<HTMLInputElement>('#downloadName');
  const readerDocument = app.querySelector<HTMLDivElement>('#readerDocument');
  const readerSidebarSections = app.querySelector<HTMLDivElement>('#readerSidebarSections');
  const aiReaderDocument = app.querySelector<HTMLDivElement>('#aiReaderDocument');
  const aiSidebarSections = app.querySelector<HTMLDivElement>('#aiSidebarSections');
  const readerNav = app.querySelector<HTMLDivElement>('#readerNav');
  const chatThread = app.querySelector<HTMLDivElement>('.chat-thread');
  const chatScrollContainer = app.querySelector<HTMLDivElement>('[data-chat-scroll-container]');
  const chatScrollBottomButton = app.querySelector<HTMLButtonElement>('[data-action="chat-scroll-bottom"]');

  if (!newBtn || !fileInput || !downloadBtn || !downloadName) {
    throw new Error('Missing UI elements for binding.');
  }

  bindChatThreadUi(chatThread, chatScrollContainer, chatScrollBottomButton);
  bindImageDragAndDrop(app);

  newBtn.addEventListener('click', () => {
    resetToBlankDocument();
  });

  const crmExampleBtn = app.querySelector<HTMLButtonElement>('#crmExampleBtn');
  crmExampleBtn?.addEventListener('click', () => {
    state.document = deserializeDocument(bundledCrmHvy, '.hvy');
    state.rawEditorText = serializeDocument(state.document);
    state.rawEditorError = null;
    state.rawEditorDiagnostics = [];
    state.filename = 'crm.hvy';
    state.history = [];
    state.future = [];
    clearChatConversation(state.chat);
    resetTransientUiState();
    getRenderApp()();
  });

  const resumeTemplateBtn = app.querySelector<HTMLButtonElement>('#resumeTemplateBtn');
  resumeTemplateBtn?.addEventListener('click', () => {
    state.document = deserializeDocument(bundledResumeThvy, '.thvy');
    state.rawEditorText = serializeDocument(state.document);
    state.rawEditorError = null;
    state.rawEditorDiagnostics = [];
    state.filename = 'resume.thvy';
    state.history = [];
    state.future = [];
    clearChatConversation(state.chat);
    resetTransientUiState();
    getRenderApp()();
  });

  const resumeExampleBtn = app.querySelector<HTMLButtonElement>('#resumeExampleBtn');
  resumeExampleBtn?.addEventListener('click', () => {
    state.document = deserializeDocument(bundledResumeHvy, '.hvy');
    state.rawEditorText = serializeDocument(state.document);
    state.rawEditorError = null;
    state.rawEditorDiagnostics = [];
    state.filename = 'resume.hvy';
    state.history = [];
    state.future = [];
    clearChatConversation(state.chat);
    resetTransientUiState();
    getRenderApp()();
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) {
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    const extension = detectExtension(file.name, text);
    state.filename = extension === '.md' ? normalizeMarkdownImportFilename(file.name) : file.name;
    state.document = deserializeDocumentBytes(bytes, extension);
    state.rawEditorText = serializeDocument(state.document);
    state.rawEditorError = null;
    state.rawEditorDiagnostics = [];
    clearChatConversation(state.chat);
    closeModal();
    resetTransientUiState();
    getRenderApp()();
  });

  downloadName.addEventListener('input', () => {
    state.filename = downloadName.value;
  });

  downloadBtn.addEventListener('click', () => {
    const normalized = normalizeFilename(state.filename || 'document.hvy');
    state.filename = normalized;
    const bytes = serializeDocumentBytes(state.document);
    downloadBinaryFile(normalized, bytes);
    getRenderApp()();
  });

  bindAppEvents(app);

  const handleReaderAreaClick = (event: Event) => {
    const target = event.target as HTMLElement;

    const anchor = target.closest<HTMLAnchorElement>('a[href^="#"]');
    if (anchor) {
      event.preventDefault();
      const id = anchor.getAttribute('href')?.slice(1) ?? '';
      navigateToSection(id, app);
      return;
    }

    const toggle = target.closest<HTMLElement>('[data-reader-action="toggle-expand"]');
    if (toggle) {
      event.stopPropagation();
      const sectionKey = toggle.dataset.sectionKey;
      if (!sectionKey) {
        return;
      }
      const section = findSectionByKey(state.document.sections, sectionKey);
      if (!section) {
        return;
      }
      section.expanded = !section.expanded;
      getRefreshReaderPanels()();
      return;
    }

    const expandable = target.closest<HTMLElement>('[data-reader-action="toggle-expandable"]');
    if (expandable) {
      // When clicking inside the content area, guard against interactive descendants
      if (expandable.dataset.expandableContent === 'true' && target.closest('a, button, input, select, textarea')) {
        return;
      }
      event.stopPropagation();
      const sectionKey = expandable.dataset.sectionKey;
      const blockId = expandable.dataset.blockId;
      if (!sectionKey || !blockId) {
        return;
      }
      const block = findBlockByIds(sectionKey, blockId);
      if (!block) {
        return;
      }
      const willCollapse = block.schema.expandableExpanded;
      if (willCollapse) {
        // Animate collapse before re-rendering
        const readerEl = app.querySelector<HTMLElement>(`[data-expandable-id="${CSS.escape(blockId)}"]`);
        readerEl?.classList.add('is-collapsing');
        window.setTimeout(() => {
          block.schema.expandableExpanded = false;
          getRefreshReaderPanels()();
        }, 160);
      } else {
        block.schema.expandableExpanded = true;
        getRefreshReaderPanels()();
      }
    }
  };

  readerDocument?.addEventListener('click', handleReaderAreaClick);
  readerSidebarSections?.addEventListener('click', handleReaderAreaClick);
  aiReaderDocument?.addEventListener('click', handleReaderAreaClick);
  aiSidebarSections?.addEventListener('click', handleReaderAreaClick);

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
