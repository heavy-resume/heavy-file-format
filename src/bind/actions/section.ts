import { state, getInsertEditorTopLevelSection, getRenderApp, REUSABLE_SECTION_DEF_PREFIX } from '../../state';
import { isDefaultUntitledSectionTitle, getSectionId, isHiddenEditorOnlySection, moveSectionByFilteredOffset, removeSectionByKey, findSectionContainer } from '../../section-ops';
import { clearOpenEditorSection, setActiveEditorBlock, setAiEditorHostBlock } from '../../block-ops';
import { createEmptySectionWithMeta, instantiateReusableSection } from '../../document-factory';
import { recordHistory } from '../../history';
import { closeModalIfTarget, navigateToSection } from '../../navigation';
import { getAvailableSectionDefs, getSectionTemplateKey } from '../../component-defs';
import { isPdfDocument } from '../../pdf-document-capabilities';
import {
  cloneSectionFromEditorClipboard,
  collectSectionAttachments,
  copySectionToEditorClipboard,
  installEditorClipboardAttachments,
  installEditorClipboardComponentDefinitions,
  prepareSectionForDocumentPasteWithResult,
} from '../../editor-clipboard';
import { showTransientNotice } from '../../transient-notice';
import type { ActionHandler } from './types';
import type { SectionLocation, VisualSection } from '../../editor/types';

const addTopLevelSection: ActionHandler = ({ actionButton }) => {
  const location: SectionLocation = actionButton.dataset.sectionLocation === 'sidebar' ? 'sidebar' : 'main';
  if (isPdfDocument(state.document) && location === 'sidebar') {
    return;
  }
  const pickerKey = location === 'sidebar' ? '__sidebar_top_level__' : '__top_level__';
  const starter = state.addComponentBySection[pickerKey] ?? 'blank';
  if (openSectionFlavorChooserIfNeeded(starter, location)) {
    getRenderApp()();
    return;
  }
  insertTopLevelSection(starter, undefined, location);
};

const insertTopLevelSectionBefore: ActionHandler = ({ actionButton, sectionKey }) => {
  const location: SectionLocation = actionButton.dataset.sectionLocation === 'sidebar' ? 'sidebar' : 'main';
  insertTopLevelSection('blank', undefined, location, sectionKey);
};

export function insertTopLevelSection(
  starter: string,
  flavorName?: string,
  location: SectionLocation = 'main',
  beforeSectionKey?: string
): void {
  if (isPdfDocument(state.document) && location === 'sidebar') {
    return;
  }
  if (starter !== 'blank' && !getSelectedSectionDefinition(starter)) {
    return;
  }
  recordHistory();
  const section = starter === 'blank'
    ? createEmptySectionWithMeta(state.currentView === 'ai' ? 'text' : '', false, state.document.meta)
    : instantiateReusableSection(starter, flavorName);
  if (!section) {
    return;
  }
  section.location = location;
  const beforeIndex = beforeSectionKey
    ? state.document.sections.findIndex((candidate) => candidate.key === beforeSectionKey && candidate.location === location)
    : -1;
  if (beforeIndex >= 0) {
    state.document.sections.splice(beforeIndex, 0, section);
  } else {
    state.document.sections.push(section);
  }
  state.pendingEditorCenterSectionKey = section.key;
  if (section.blocks[0]) {
    setActiveEditorBlock(section.key, section.blocks[0].id);
    if (state.currentView === 'ai') {
      setAiEditorHostBlock(section.key, section.blocks[0].id);
      state.aiEditorHostSectionKey = section.key;
      if (state.pendingEditorActivation) {
        state.pendingEditorActivation.immediateFocus = true;
      }
    }
  } else {
    state.activeEditorSectionTitleKey = section.key;
    state.clearSectionTitleOnFocusKey = isDefaultUntitledSectionTitle(section.title) ? section.key : null;
  }
  if (beforeIndex >= 0 || !getInsertEditorTopLevelSection()(section.key, location)) {
    getRenderApp()();
  }
}

function openSectionFlavorChooserIfNeeded(starter: string, location: SectionLocation): boolean {
  if (starter === 'blank') {
    return false;
  }
  const definition = getSelectedSectionDefinition(starter);
  const flavors = getSelectableSectionFlavors(definition);
  if (!definition || flavors.length < 2) {
    return false;
  }
  state.sectionTemplateFlavorModal = { templateName: definition.name, location };
  return true;
}

function getSelectedSectionDefinition(starter: string) {
  const normalizedName = starter.startsWith(REUSABLE_SECTION_DEF_PREFIX) ? starter.slice(REUSABLE_SECTION_DEF_PREFIX.length) : starter;
  return getAvailableSectionDefs().find((item) => item.name === normalizedName || getSectionTemplateKey(item) === normalizedName) ?? null;
}

function getSelectableSectionFlavors(definition: ReturnType<typeof getSelectedSectionDefinition>) {
  return (definition?.flavors ?? []).filter((flavor) => flavor.name.trim().length > 0 && !!flavor.template);
}

const toggleSectionLocation: ActionHandler = ({ section }) => {
  if (!section) {
    return;
  }
  if (isPdfDocument(state.document)) {
    return;
  }
  recordHistory();
  section.location = section.location === 'sidebar' ? 'main' : 'sidebar';
  getRenderApp()();
};

const removeSection: ActionHandler = ({ section, sectionKey }) => {
  if (!section) {
    return;
  }
  recordHistory();
  removeSectionByKey(state.document.sections, sectionKey);
  closeModalIfTarget(sectionKey);
  if (state.activeEditorSectionTitleKey === sectionKey) {
    state.activeEditorSectionTitleKey = null;
  }
  clearOpenEditorSection(sectionKey);
  if (state.aiEditorHostBlock?.sectionKey === sectionKey) {
    state.aiEditorHostBlock = null;
  }
  if (state.aiEditorHostSectionKey === sectionKey) {
    state.aiEditorHostSectionKey = null;
  }
  if (state.componentPlacement?.sectionKey === sectionKey) {
    state.componentPlacement = null;
  }
  getRenderApp()();
};

const moveSection = (offset: -1 | 1): ActionHandler => ({ section, sectionKey }) => {
  if (!section) {
    return;
  }
  recordHistory();
  if (moveSectionByFilteredOffset(state.document.sections, sectionKey, offset, isEditorOrderSibling)) {
    getRenderApp()();
  }
};

function isEditorOrderSibling(candidate: VisualSection, target: VisualSection): boolean {
  if (candidate.isGhost || isHiddenEditorOnlySection(candidate, state.document.meta, state.showAdvancedEditor)) {
    return false;
  }
  return candidate.location === target.location;
}

const realizeGhost: ActionHandler = ({ section }) => {
  if (!section) {
    return;
  }
  recordHistory();
  section.isGhost = false;
  getRenderApp()();
};

const jumpToReader: ActionHandler = ({ section, app }) => {
  if (!section) {
    return;
  }
  navigateToSection(getSectionId(section), app);
};

const copySection: ActionHandler = ({ section }) => {
  if (!section) {
    return;
  }
  copySectionToEditorClipboard(section, collectSectionAttachments(state.document, section), state.document);
  state.contextMenu = null;
  getRenderApp()();
};

const pasteSection: ActionHandler = ({ actionButton }) => {
  state.contextMenu = null;
  const location: SectionLocation = actionButton.dataset.sectionLocation === 'sidebar' ? 'sidebar' : 'main';
  if (isPdfDocument(state.document) && location === 'sidebar') {
    return;
  }
  const section = cloneSectionFromEditorClipboard();
  if (!section) {
    return;
  }
  recordHistory('section-paste');
  installEditorClipboardComponentDefinitions(state.document);
  installEditorClipboardAttachments(state.document);
  const prepared = prepareSectionForDocumentPasteWithResult(state.document, section);
  if (prepared.removedCount > 0) {
    showTransientNotice('Some components were altered for PHVY compatibility.');
  }
  section.location = location;
  state.document.sections.push(section);
  activatePastedSection(section);
  getRenderApp()();
};

const pasteSectionAfter: ActionHandler = ({ sectionKey }) => {
  state.contextMenu = null;
  const targetLocation = findSectionContainer(state.document.sections, sectionKey);
  const target = targetLocation?.container[targetLocation.index] ?? null;
  if (!targetLocation || !target) {
    return;
  }
  const section = cloneSectionFromEditorClipboard();
  if (!section) {
    return;
  }
  recordHistory('section-paste');
  installEditorClipboardComponentDefinitions(state.document);
  installEditorClipboardAttachments(state.document);
  const prepared = prepareSectionForDocumentPasteWithResult(state.document, section);
  if (prepared.removedCount > 0) {
    showTransientNotice('Some components were altered for PHVY compatibility.');
  }
  section.location = target.location;
  targetLocation.container.splice(targetLocation.index + 1, 0, section);
  activatePastedSection(section);
  getRenderApp()();
};

function activatePastedSection(section: VisualSection): void {
  state.pendingEditorCenterSectionKey = section.key;
  if (section.blocks[0]) {
    setActiveEditorBlock(section.key, section.blocks[0].id);
    return;
  }
  state.activeEditorSectionTitleKey = section.key;
  state.clearSectionTitleOnFocusKey = isDefaultUntitledSectionTitle(section.title) ? section.key : null;
}

export const sectionActions: Record<string, ActionHandler> = {
  'add-top-level-section': addTopLevelSection,
  'insert-top-level-section-before': insertTopLevelSectionBefore,
  'toggle-section-location': toggleSectionLocation,
  'remove-section': removeSection,
  'move-section-up': moveSection(-1),
  'move-section-down': moveSection(1),
  'realize-ghost': realizeGhost,
  'jump-to-reader': jumpToReader,
  'copy-section': copySection,
  'paste-section': pasteSection,
  'paste-section-after': pasteSectionAfter,
};
