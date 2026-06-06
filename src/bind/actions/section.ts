import { state, getRenderApp, REUSABLE_SECTION_DEF_PREFIX } from '../../state';
import { isDefaultUntitledSectionTitle, getSectionId, isHiddenEditorOnlySection, moveSectionByFilteredOffset, removeSectionByKey, makeBlockSubsection, removeSubsection, findSectionContainer } from '../../section-ops';
import { setActiveEditorBlock, setAiEditorHostBlock } from '../../block-ops';
import { createEmptySection, instantiateReusableSection } from '../../document-factory';
import { recordHistory } from '../../history';
import { closeModalIfTarget, navigateToSection } from '../../navigation';
import { getSectionDefs, getSectionTemplateKey } from '../../component-defs';
import { isPdfAllowedComponent, isPdfDocument } from '../../pdf-document-capabilities';
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

export function insertTopLevelSection(starter: string, flavorName?: string, location: SectionLocation = 'main'): void {
  if (isPdfDocument(state.document) && location === 'sidebar') {
    return;
  }
  recordHistory();
  const section = starter === 'blank'
    ? createEmptySection(1, state.currentView === 'ai' ? 'text' : '', false)
    : instantiateReusableSection(starter, 1, flavorName);
  if (!section) {
    return;
  }
  section.location = location;
  state.document.sections.push(section);
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
  getRenderApp()();
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
  return getSectionDefs().find((item) => item.name === normalizedName || getSectionTemplateKey(item) === normalizedName) ?? null;
}

function getSelectableSectionFlavors(definition: ReturnType<typeof getSelectedSectionDefinition>) {
  return (definition?.flavors ?? []).filter((flavor) => flavor.name.trim().length > 0 && !!flavor.template);
}

const spawnGhostChild: ActionHandler = ({ section }) => {
  if (!section || section.lock) {
    return;
  }
  const component = state.addComponentBySection[section.key] ?? 'container';
  if (isPdfDocument(state.document) && !isPdfAllowedComponent(component, state.document.meta)) {
    return;
  }
  recordHistory();
  const child = createEmptySection(Math.min(section.level + 1, 6), component, false);
  section.children.push(child);
  state.pendingEditorCenterSectionKey = child.key;
  getRenderApp()();
};

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

const removeSubsectionAction: ActionHandler = ({ section, sectionKey }) => {
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
  if (state.activeEditorBlock?.sectionKey === sectionKey) {
    state.activeEditorBlock = null;
  }
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

function isEditorOrderSibling(candidate: VisualSection, target: VisualSection, parent: VisualSection | null): boolean {
  if (candidate.isGhost || isHiddenEditorOnlySection(candidate, state.document.meta, state.showAdvancedEditor)) {
    return false;
  }
  return parent !== null || candidate.location === target.location;
}

const addChild: ActionHandler = ({ section }) => {
  if (!section || section.lock) {
    return;
  }
  const component = state.addComponentBySection[section.key] ?? 'container';
  if (isPdfDocument(state.document) && !isPdfAllowedComponent(component, state.document.meta)) {
    return;
  }
  recordHistory();
  const child = createEmptySection(Math.min(section.level + 1, 6), component, true);
  section.children.push(child);
  if (child.blocks[0]) {
    setActiveEditorBlock(child.key, child.blocks[0].id);
  }
  getRenderApp()();
};

const makeBlockSubsectionAction: ActionHandler = ({ section, sectionKey, blockId }) => {
  if (!section || section.lock || !blockId) {
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
};

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
  const section = cloneSectionFromEditorClipboard(1);
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
  const section = cloneSectionFromEditorClipboard(target.level);
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
  'spawn-child-ghost': spawnGhostChild,
  'spawn-block-ghost': spawnGhostChild,
  'toggle-section-location': toggleSectionLocation,
  'remove-subsection': removeSubsectionAction,
  'remove-section': removeSection,
  'move-section-up': moveSection(-1),
  'move-section-down': moveSection(1),
  'add-child': addChild,
  'make-block-subsection': makeBlockSubsectionAction,
  'realize-ghost': realizeGhost,
  'jump-to-reader': jumpToReader,
  'copy-section': copySection,
  'paste-section': pasteSection,
  'paste-section-after': pasteSectionAfter,
};
