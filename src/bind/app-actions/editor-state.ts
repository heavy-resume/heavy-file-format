import { state, getRenderApp, getRefreshReaderPanels } from '../../state';
import { findSectionByKey, isDefaultUntitledSectionTitle } from '../../section-ops';
import { findBlockByIds, setActiveEditorBlock, deactivateEditorBlock, cancelEditorBlockEdit } from '../../block-ops';
import { recordHistory } from '../../history';
import { captureEditorDeactivationAnchor, capturePaneScroll } from '../../scroll';
import type { AppActionHandler } from './types';
import { buildBlockDescriptionParentTree, buildDescriptionRequest, generateDescription } from '../../descriptions/provider';
import { populateMissingDescriptions } from '../../descriptions/populate';

let descriptionPopulateAbortController: AbortController | null = null;

const activateBlock: AppActionHandler = ({ app, event, sectionKey, blockId }) => {
  if (!blockId) {
    return;
  }
  event.stopPropagation();
  const targetElement = event.target as HTMLElement | null;
  const passiveBlock = targetElement?.closest<HTMLElement>('.editor-block-passive');
  const passiveContent = targetElement?.closest<HTMLElement>('.reader-block') ?? passiveBlock?.querySelector<HTMLElement>('.reader-block');
  const anchor = passiveBlock ? getPassiveTextAnchor(passiveContent, targetElement) : undefined;
  state.activeEditorBlockReturnScroll = capturePaneScroll(state.paneScroll, app);
  setActiveEditorBlock(sectionKey, blockId);
  if (typeof anchor?.top === 'number' && state.pendingEditorActivation) {
    state.pendingEditorActivation = {
      ...state.pendingEditorActivation,
      anchorTop: anchor.top,
      clientX: event.clientX,
      clientY: event.clientY,
      preferTextFocus: true,
    };
  }
  getRenderApp()();
};

type PassiveTextAnchor = {
  top: number;
  parentTag: string | null;
  parentClass: string | null;
  textPreview: string;
};

function getPassiveTextAnchor(passiveContent: HTMLElement | null | undefined, targetElement: HTMLElement | null): PassiveTextAnchor | undefined {
  if (!passiveContent) {
    return targetElement ? getFirstTextAnchor(targetElement) : undefined;
  }
  if (targetElement && targetElement !== passiveContent && passiveContent.contains(targetElement)) {
    return getFirstTextAnchor(targetElement);
  }
  return getFirstTextAnchor(passiveContent);
}

function getFirstTextAnchor(root: HTMLElement): PassiveTextAnchor | undefined {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const text = node.textContent ?? '';
    const firstTextIndex = text.search(/\S/);
    if (firstTextIndex >= 0) {
      const range = document.createRange();
      range.setStart(node, firstTextIndex);
      range.setEnd(node, text.length);
      const rect = range.getClientRects()[0];
      range.detach();
      if (rect) {
        const parent = node.parentElement;
        return {
          top: rect.top,
          parentTag: parent?.tagName.toLowerCase() ?? null,
          parentClass: parent?.className ?? null,
          textPreview: text.slice(firstTextIndex).replace(/\s+/g, ' ').trim().slice(0, 80),
        };
      }
    }
    node = walker.nextNode();
  }
  return undefined;
}

const activateSectionTitle: AppActionHandler = ({ event, sectionKey }) => {
  if (!sectionKey) {
    return;
  }
  event.stopPropagation();
  state.activeEditorSectionTitleKey = sectionKey;
  const section = findSectionByKey(state.document.sections, sectionKey);
  state.clearSectionTitleOnFocusKey = section && isDefaultUntitledSectionTitle(section.title) ? sectionKey : null;
  getRenderApp()();
};

const deactivateBlock: AppActionHandler = ({ app, event, sectionKey, blockId }) => {
  if (!blockId) {
    return;
  }
  event.stopPropagation();
  const deactivationAnchor = captureEditorDeactivationAnchor(app, sectionKey, blockId);
  const result = deactivateEditorBlock(sectionKey, blockId);
  if (result === 'closed') {
    state.pendingEditorDeactivation = deactivationAnchor;
    state.activeEditorBlockReturnScroll = null;
  }
  getRenderApp()();
};

const cancelBlockEdit: AppActionHandler = ({ app, event, sectionKey, blockId }) => {
  if (!blockId) {
    return;
  }
  event.stopPropagation();
  const deactivationAnchor = captureEditorDeactivationAnchor(app, sectionKey, blockId);
  const result = cancelEditorBlockEdit(sectionKey, blockId);
  if (result === 'closed') {
    state.pendingEditorDeactivation = deactivationAnchor;
    state.activeEditorBlockReturnScroll = null;
  }
  getRefreshReaderPanels()();
  getRenderApp()();
};

const toggleEditorExpandable: AppActionHandler = ({ event, sectionKey, blockId }) => {
  if (!sectionKey || !blockId) {
    return;
  }
  event.stopPropagation();
  const block = findBlockByIds(sectionKey, blockId);
  if (!block) {
    return;
  }
  block.schema.expandableExpanded = !block.schema.expandableExpanded;
  getRefreshReaderPanels()();
  getRenderApp()();
};

const toggleExpandableEditorPanel: AppActionHandler = ({ event, actionButton, sectionKey, blockId }) => {
  if (!sectionKey || !blockId) {
    return;
  }
  event.stopPropagation();
  const panel = actionButton.dataset.expandablePanel === 'stub' ? 'stub' : 'expanded';
  const key = `${sectionKey}:${blockId}`;
  const current = state.expandableEditorPanels[key] ?? { stubOpen: false, expandedOpen: false };
  state.expandableEditorPanels[key] = {
    ...current,
    [panel === 'stub' ? 'stubOpen' : 'expandedOpen']: !current[panel === 'stub' ? 'stubOpen' : 'expandedOpen'],
  };
  getRenderApp()();
};

const focusSchemaComponent: AppActionHandler = ({ actionButton, target }) => {
  if (target.closest('select, input, button, textarea, label')) {
    return;
  }
  const select = actionButton.querySelector<HTMLSelectElement>('[data-field="block-component"]');
  select?.focus();
  select?.click();
};

const populateMissingDocumentDescriptions: AppActionHandler = () => {
  void populateMissingDocumentDescriptionsAsync();
};

async function populateMissingDocumentDescriptionsAsync(): Promise<void> {
  if (state.descriptionPopulate?.isRunning) {
    return;
  }
  descriptionPopulateAbortController = new AbortController();
  state.descriptionPopulate = {
    isRunning: true,
    status: 'Generating structural descriptions parent-first...',
    completed: 0,
    total: 0,
    current: 'Preparing descriptions...',
    skippedLeaves: 0,
    lastGenerated: '',
  };
  getRenderApp()();
  try {
    recordHistory('document:descriptions:populate-missing');
    const result = await populateMissingDescriptions(state.document, {
      signal: descriptionPopulateAbortController.signal,
      onProgress: (progress) => {
        state.descriptionPopulate = {
          isRunning: true,
          status: progress.total === 0
            ? 'No missing structural descriptions.'
            : `Generated ${progress.updated} of ${progress.total} structural description${progress.total === 1 ? '' : 's'}.`,
          completed: progress.completed,
          total: progress.total,
          current: progress.current,
          skippedLeaves: progress.skippedLeaves,
          lastGenerated: progress.lastGenerated,
        };
        getRenderApp()();
      },
    });
    descriptionPopulateAbortController = null;
    state.descriptionPopulate = {
      isRunning: false,
      status: result.updated === 0 ? 'No missing descriptions.' : `Generated ${result.updated} missing description${result.updated === 1 ? '' : 's'}.`,
      completed: result.completed,
      total: result.total,
      current: '',
      skippedLeaves: result.skippedLeaves,
      lastGenerated: result.lastGenerated,
    };
    getRefreshReaderPanels()();
    getRenderApp()();
  } catch (error) {
    const aborted = descriptionPopulateAbortController?.signal.aborted || error instanceof DOMException && error.name === 'AbortError';
    descriptionPopulateAbortController = null;
    state.descriptionPopulate = {
      isRunning: false,
      status: aborted
        ? 'Description generation stopped.'
        : error instanceof Error ? `Description generation failed: ${error.message}` : 'Description generation failed.',
      completed: state.descriptionPopulate?.completed ?? 0,
      total: state.descriptionPopulate?.total ?? 0,
      current: '',
      skippedLeaves: state.descriptionPopulate?.skippedLeaves ?? 0,
      lastGenerated: state.descriptionPopulate?.lastGenerated ?? '',
    };
    getRenderApp()();
  }
}

const stopPopulateMissingDescriptions: AppActionHandler = () => {
  descriptionPopulateAbortController?.abort();
};

const generateSectionDescription: AppActionHandler = ({ actionButton, sectionKey }) => {
  void generateSectionDescriptionAsync(actionButton, sectionKey);
};

async function generateSectionDescriptionAsync(actionButton: HTMLElement, sectionKey: string): Promise<void> {
  const section = findSectionByKey(state.document.sections, sectionKey);
  if (!section || section.description.trim()) {
    return;
  }
  setGenerateButtonBusy(actionButton, true);
  try {
    recordHistory(`section:${sectionKey}:description:generate`);
    section.description = await generateDescription(buildDescriptionRequest({
      document: state.document,
      section,
      kind: 'section',
    }));
    getRefreshReaderPanels()();
    updateDescriptionFieldDom(actionButton, section.description);
  } catch (error) {
    setGenerateButtonError(actionButton, error);
  }
}

const generateBlockDescription: AppActionHandler = ({ actionButton, sectionKey, blockId }) => {
  void generateBlockDescriptionAsync(actionButton, sectionKey, blockId);
};

async function generateBlockDescriptionAsync(actionButton: HTMLElement, sectionKey: string, blockId: string): Promise<void> {
  const section = findSectionByKey(state.document.sections, sectionKey);
  const block = findBlockByIds(sectionKey, blockId);
  if (!section || !block || block.schema.description.trim()) {
    return;
  }
  setGenerateButtonBusy(actionButton, true);
  try {
    recordHistory(`block:${blockId}:description:generate`);
    block.schema.description = await generateDescription(buildDescriptionRequest({
      document: state.document,
      section,
      block,
      kind: 'block',
      parentTrail: [section.title],
      parentTree: buildBlockDescriptionParentTree(section, block),
    }));
    getRefreshReaderPanels()();
    updateDescriptionFieldDom(actionButton, block.schema.description);
  } catch (error) {
    setGenerateButtonError(actionButton, error);
  }
}

const generateExpandablePaneDescription: AppActionHandler = ({ actionButton, sectionKey, blockId }) => {
  void generateExpandablePaneDescriptionAsync(actionButton, sectionKey, blockId);
};

async function generateExpandablePaneDescriptionAsync(actionButton: HTMLElement, sectionKey: string, blockId: string): Promise<void> {
  const section = findSectionByKey(state.document.sections, sectionKey);
  const block = findBlockByIds(sectionKey, blockId);
  const pane = actionButton.dataset.expandablePane === 'expanded' ? 'expanded' : 'stub';
  if (!section || !block) {
    return;
  }
  if (pane === 'stub' && block.schema.expandableStubDescription.trim()) {
    return;
  }
  if (pane === 'expanded' && block.schema.expandableContentDescription.trim()) {
    return;
  }
  setGenerateButtonBusy(actionButton, true);
  try {
    recordHistory(`block:${blockId}:expandable-${pane}:description:generate`);
    const description = await generateDescription(buildDescriptionRequest({
      document: state.document,
      section,
      block,
      kind: pane === 'stub' ? 'expandable-stub' : 'expandable-content',
      parentTrail: [section.title],
      parentTree: buildBlockDescriptionParentTree(section, block),
    }));
    if (pane === 'stub') {
      block.schema.expandableStubDescription = description;
    } else {
      block.schema.expandableContentDescription = description;
    }
    getRefreshReaderPanels()();
    updateDescriptionFieldDom(actionButton, description);
  } catch (error) {
    setGenerateButtonError(actionButton, error);
  }
}

function updateDescriptionFieldDom(actionButton: HTMLElement, description: string): void {
  const label = actionButton.closest('label');
  const textarea = label?.querySelector<HTMLTextAreaElement>('textarea');
  if (textarea) {
    textarea.value = description;
  }
  actionButton.remove();
}

function setGenerateButtonBusy(actionButton: HTMLElement, busy: boolean): void {
  actionButton.toggleAttribute('disabled', busy);
  actionButton.textContent = busy ? 'Generating...' : 'Generate';
  actionButton.removeAttribute('title');
}

function setGenerateButtonError(actionButton: HTMLElement, error: unknown): void {
  actionButton.toggleAttribute('disabled', false);
  actionButton.textContent = 'Generate failed';
  actionButton.title = error instanceof Error ? error.message : 'Description generation failed.';
}

export const editorStateActions: Record<string, AppActionHandler> = {
  'activate-block': activateBlock,
  'activate-section-title': activateSectionTitle,
  'deactivate-block': deactivateBlock,
  'cancel-block-edit': cancelBlockEdit,
  'toggle-editor-expandable': toggleEditorExpandable,
  'toggle-expandable-editor-panel': toggleExpandableEditorPanel,
  'focus-schema-component': focusSchemaComponent,
  'populate-missing-descriptions': populateMissingDocumentDescriptions,
  'stop-populate-missing-descriptions': stopPopulateMissingDescriptions,
  'generate-section-description': generateSectionDescription,
  'generate-block-description': generateBlockDescription,
  'generate-expandable-pane-description': generateExpandablePaneDescription,
};
