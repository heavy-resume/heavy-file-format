import bundledResumeThvy from '../examples/resume.thvy?raw';
import bundledResumeHvy from '../examples/resume.hvy?raw';
import bundledCrmHvy from '../examples/crm.hvy?raw';
import bundledResumeViews from '../examples/resume-views.json';
import { state, getRenderApp, getRefreshReaderPanels } from './state';
import { findSectionByKey } from './section-ops';
import { findBlockByIds, setActiveEditorBlock } from './block-ops';
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
import { scheduleSidebarHelpAutoClose } from './bind/handlers/click-misc';
import { saveResumeState } from './state-persistence';
import { encodeComponentListRuntimeView, parseComponentListRuntimeView } from './editor/components/component-list/component-list-view';
import { getAiEditorDoubleClickDelayMs } from './reference-config';
import type { ReaderViewFilter } from './types';

const resumeViews = bundledResumeViews as Record<string, ReaderViewFilter>;

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
      action();
      return;
    }
    if (event instanceof MouseEvent && event.detail > 1) {
      return;
    }
    pendingAiReaderAction = window.setTimeout(() => {
      pendingAiReaderAction = null;
      action();
    }, getAiEditorDoubleClickDelayMs());
  };

  if (!newBtn || !fileInput || !downloadBtn || !downloadName) {
    throw new Error('Missing UI elements for binding.');
  }

  bindChatThreadUi(chatThread, chatScrollContainer, chatScrollBottomButton);
  bindImageDragAndDrop(app);
  scheduleSidebarHelpAutoClose(app);

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
    state.selectedExample = 'crm';
    state.history = [];
    state.future = [];
    clearChatConversation(state.chat);
    resetTransientUiState();
    saveResumeState(state);
    getRenderApp()();
  });

  const resumeTemplateBtn = app.querySelector<HTMLButtonElement>('#resumeTemplateBtn');
  resumeTemplateBtn?.addEventListener('click', () => {
    state.document = deserializeDocument(bundledResumeThvy, '.thvy');
    state.rawEditorText = serializeDocument(state.document);
    state.rawEditorError = null;
    state.rawEditorDiagnostics = [];
    state.filename = 'resume.thvy';
    state.selectedExample = 'resume-template';
    state.history = [];
    state.future = [];
    clearChatConversation(state.chat);
    resetTransientUiState();
    saveResumeState(state);
    getRenderApp()();
  });

  const resumeExampleBtn = app.querySelector<HTMLButtonElement>('#resumeExampleBtn');
  resumeExampleBtn?.addEventListener('click', () => {
    state.document = deserializeDocument(bundledResumeHvy, '.hvy');
    state.rawEditorText = serializeDocument(state.document);
    state.rawEditorError = null;
    state.rawEditorDiagnostics = [];
    state.filename = 'resume.hvy';
    state.selectedExample = 'resume-example';
    state.history = [];
    state.future = [];
    clearChatConversation(state.chat);
    resetTransientUiState();
    saveResumeState(state);
    getRenderApp()();
  });

  const applyReaderView = (view: ReaderViewFilter): void => {
    state.readerView = view;
    state.readerViewActivatedTargets = new Set<string>();
    state.readerContainerState = {};
    state.readerExpandableState = {};
    state.currentView = state.currentView === 'editor' ? 'viewer' : state.currentView;
    saveResumeState(state);
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
    saveResumeState(state);
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
    state.selectedExample = 'custom';
    state.document = deserializeDocumentBytes(bytes, extension);
    state.rawEditorText = serializeDocument(state.document);
    state.rawEditorError = null;
    state.rawEditorDiagnostics = [];
    clearChatConversation(state.chat);
    closeModal();
    resetTransientUiState();
    saveResumeState(state);
    getRenderApp()();
  });

  downloadName.addEventListener('input', () => {
    state.filename = downloadName.value;
    saveResumeState(state);
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

    const anchor = target.closest<HTMLAnchorElement>('a[href^="#"]');
    if (anchor) {
      event.preventDefault();
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
          section.expanded = true;
          const reverseList = target.closest<HTMLElement>('[data-reader-action="toggle-component-list-reverse"]');
          if (reverseList) {
            toggleComponentListReverse(reverseList);
          }
          getRefreshReaderPanels()();
          const select = target.closest<HTMLSelectElement>('select');
          if (select) {
            const blockId = select.dataset.blockId ?? '';
            window.setTimeout(() => {
              const nextSelect = app.querySelector<HTMLSelectElement>(
                `[data-field="${CSS.escape(select.dataset.field ?? 'component-list-reader-view')}"][data-section-key="${CSS.escape(sectionKey)}"][data-block-id="${CSS.escape(blockId)}"]`
              );
              nextSelect?.focus();
              (nextSelect as (HTMLSelectElement & { showPicker?: () => void }) | null)?.showPicker?.();
            }, 0);
          }
          return;
        }
      }
    }

    const reverseList = target.closest<HTMLElement>('[data-reader-action="toggle-component-list-reverse"]');
    if (reverseList) {
      event.stopPropagation();
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
        return;
      }
      event.stopPropagation();
      const key = viewCollapse.dataset.readerViewCollapseKey;
      if (!key) {
        return;
      }
      runReaderAction(event, () => {
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
          state.readerViewActivatedTargets.add(targetKey);
          getRefreshReaderPanels()();
        });
        return;
      }
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
      runReaderAction(event, () => {
        section.expanded = !section.expanded;
        getRefreshReaderPanels()();
      });
      return;
    }

    const expandable = target.closest<HTMLElement>('[data-reader-action="toggle-expandable"]');
    if (expandable) {
      if (target.closest('a, button, input, select, textarea, [contenteditable="true"], [role="button"]')) {
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
      if (state.currentView === 'ai' && activateAiExpandableTextTarget(target, expandable)) {
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
          window.setTimeout(() => {
            state.readerExpandableState[expandableStateKey] = false;
            getRefreshReaderPanels()();
          }, 160);
        } else {
          state.readerExpandableState[expandableStateKey] = true;
          getRefreshReaderPanels()();
          const readerEl = app.querySelector<HTMLElement>(`[data-expandable-id="${CSS.escape(blockId)}"]`);
          readerEl?.classList.add('is-expanding');
          window.setTimeout(() => {
            readerEl?.classList.remove('is-expanding');
          }, 360);
        }
      });
      return;
    }

    const container = target.closest<HTMLElement>('[data-reader-action="toggle-container"]');
    if (container) {
      if (target.closest('a, input, select, textarea, [contenteditable="true"]')) {
        return;
      }
      event.stopPropagation();
      const key = container.dataset.containerKey;
      if (!key) {
        return;
      }
      runReaderAction(event, () => {
        state.readerContainerState[key] = container.getAttribute('aria-expanded') !== 'true';
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

function activateAiExpandableTextTarget(target: HTMLElement, expandable: HTMLElement): boolean {
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
  const hasPlaceholder = String(block?.schema.placeholder ?? '').trim().length > 0;
  if ((!textBlock && !modelFallback) || block?.schema.component !== 'text' || !hasPlaceholder) {
    console.debug('[hvy:ai-reader-expandable-toggle]', {
      stage: 'text-activation-skip',
      skipReason: !textBlock && !modelFallback ? 'no-placeholder-target' : block?.schema.component !== 'text' ? 'resolved-block-not-text' : 'text-without-placeholder',
      target: describeElementForReaderLog(target),
      expandable: describeElementForReaderLog(expandable),
      expandableBlock: describeElementForReaderLog(expandableBlockElement),
      textBlock: describeElementForReaderLog(textBlock),
      modelFallback: modelFallback ? { sectionKey: modelFallback.sectionKey, blockId: modelFallback.blockId } : null,
      resolvedComponent: block?.schema.component ?? null,
      hasPlaceholder,
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
    hasPlaceholder,
  });
  state.aiModeTipDismissed = true;
  setActiveEditorBlock(sectionKey, blockId, { targetOnly: true });
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
    (child) => child.schema.component === 'text' && String(child.schema.placeholder ?? '').trim().length > 0
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
    return block?.schema.component === 'text' && String(block.schema.placeholder ?? '').trim().length > 0;
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
